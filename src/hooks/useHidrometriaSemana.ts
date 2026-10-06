import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePolling } from './useClimaOperativo';
import type { EntregaDia, SolicitudSemana } from '../utils/hidrometria';

/** Reloj en ms que se actualiza cada `ms` (los renders se mantienen puros: no se llama Date.now() al pintar). */
export function useAhora(ms = 60_000): number {
    const [t, setT] = useState(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setT(Date.now()), ms);
        return () => window.clearInterval(id);
    }, [ms]);
    return t;
}

export interface DatosSemana {
    solicitudes: SolicitudSemana[];
    entregas: EntregaDia[];
    /** Fecha más reciente con captura de entrega por módulo (de cualquier semana). */
    ultimaCaptura: string | null;
    error: string | null;
    cargando: boolean;
    actualizadoEn: number | null;
    recargar: () => Promise<void>;
}

/**
 * Solicitudes y entregas de una semana de riego. Las respuestas de una semana ya abandonada se descartan (antes una
 * petición lenta de otra semana podía pisar a la actual) y los errores se exponen en lugar de quedarse en consola.
 */
export function useHidrometriaSemana(inicio: string, fin: string): DatosSemana {
    const [solicitudes, setSolicitudes] = useState<SolicitudSemana[]>([]);
    const [entregas, setEntregas] = useState<EntregaDia[]>([]);
    const [ultimaCaptura, setUltimaCaptura] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Semana (inicio) cuyos datos ya llegaron; "cargando" se deriva, sin setState síncrono en efectos.
    const [cargadaClave, setCargadaClave] = useState<string | null>(null);
    const [actualizadoEn, setActualizadoEn] = useState<number | null>(null);
    const generacion = useRef(0);

    const recargar = useCallback(async () => {
        const mia = ++generacion.current;
        const [sol, ent, ult] = await Promise.all([
            supabase.from('solicitudes_riego_semanal').select('modulo_id, volumen_solicitado_mm3').eq('fecha_inicio', inicio),
            // reportes_diarios está vacía (captura legada): entregas_modulo es la fuente viva (igual que useHydraStore).
            supabase.from('entregas_modulo').select('modulo_id, fecha, volumen_m3, gasto_m3s').gte('fecha', inicio).lte('fecha', fin),
            supabase.from('entregas_modulo').select('fecha').order('fecha', { ascending: false }).limit(1),
        ]);
        if (mia !== generacion.current) return; // llegó tarde: otra semana ya está en pantalla
        const fallo = sol.error ?? ent.error ?? ult.error;
        if (fallo) {
            setError(fallo.message);
        } else {
            setError(null);
            setSolicitudes((sol.data ?? []) as SolicitudSemana[]);
            setEntregas((ent.data ?? []) as EntregaDia[]);
            setUltimaCaptura((ult.data?.[0]?.fecha as string | undefined) ?? null);
            setActualizadoEn(Date.now());
        }
        setCargadaClave(inicio);
    }, [inicio, fin]);

    usePolling(recargar, 5 * 60_000);
    return { solicitudes, entregas, ultimaCaptura, error, cargando: cargadaClave !== inicio, actualizadoEn, recargar };
}

/** Fecha más reciente con captura de entrega por módulo (para rotular de cuándo es el "gasto actual" de Distribución). */
export function useUltimaCaptura(): string | null {
    const [fecha, setFecha] = useState<string | null>(null);
    const cargar = useCallback(async () => {
        const { data } = await supabase.from('entregas_modulo').select('fecha').order('fecha', { ascending: false }).limit(1);
        setFecha((data?.[0]?.fecha as string | undefined) ?? null);
    }, []);
    usePolling(cargar, 5 * 60_000);
    return fecha;
}
