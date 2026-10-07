import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { onTable } from '../lib/realtimeHub';
import { useUmbralesClima, usePolling } from './useClimaOperativo';
import type { AlertaFila } from '../utils/alertasPantalla';

export interface AlertaActiva extends AlertaFila {
    accion: string | null;
}

export const PERIODOS = ['Último Día', 'Última Semana', 'Este Mes', 'Últimos 3 Meses'] as const;
export type Periodo = typeof PERIODOS[number];

export function periodoInicioISO(periodo: Periodo, ahora = new Date()): string {
    if (periodo === 'Este Mes') return new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString();
    const d = new Date(ahora);
    if (periodo === 'Últimos 3 Meses') d.setMonth(d.getMonth() - 3);
    else d.setDate(d.getDate() - (periodo === 'Última Semana' ? 7 : 1));
    return d.toISOString();
}

const COLS = 'id, tipo_riesgo, categoria, titulo, mensaje, origen_id, fecha_deteccion, coordenadas';

/**
 * Datos de la pantalla Alertas. Las activas se refrescan en silencio (realtime + 5 min): `cargando` solo es true en la
 * primera carga, de modo que la lista no parpadea ni pierde el scroll. Los errores se exponen (no se tragan): un fallo
 * de red NO debe verse como "sin alertas".
 */
export function useAlertasPantalla(periodo: Periodo) {
    const [activas, setActivas] = useState<AlertaFila[]>([]);
    const [periodoFilas, setPeriodoFilas] = useState<AlertaFila[]>([]);
    const [errorActivas, setErrorActivas] = useState<string | null>(null);
    const [errorPeriodo, setErrorPeriodo] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [corteMs, setCorteMs] = useState(0);
    const umbrales = useUmbralesClima();

    const cargarActivas = useCallback(async () => {
        const { data, error } = await supabase.from('registro_alertas').select(COLS).eq('resuelta', false)
            .order('fecha_deteccion', { ascending: false }).limit(500);
        if (error) setErrorActivas(error.message);
        else { setErrorActivas(null); setActivas((data ?? []) as AlertaFila[]); setCorteMs(Date.now()); }
        setCargando(false);
    }, []);

    const cargarPeriodo = useCallback(async () => {
        const { data, error } = await supabase.from('registro_alertas').select(COLS)
            .gte('fecha_deteccion', periodoInicioISO(periodo)).order('fecha_deteccion', { ascending: true }).limit(2000);
        if (error) setErrorPeriodo(error.message);
        else { setErrorPeriodo(null); setPeriodoFilas((data ?? []) as AlertaFila[]); }
    }, [periodo]);

    usePolling(cargarActivas, 5 * 60_000);
    useEffect(() => {
        const unsub = onTable('registro_alertas', '*', () => { void cargarActivas(); void cargarPeriodo(); });
        return () => unsub();
    }, [cargarActivas, cargarPeriodo]);
    usePolling(cargarPeriodo, 5 * 60_000);

    const acciones = useMemo(
        () => Object.fromEntries(umbrales.filter((u) => u.accion).map((u) => [u.clave, u.accion as string])),
        [umbrales],
    );
    const activasConAccion: AlertaActiva[] = useMemo(() => activas.map((a) => {
        const partes = (a.origen_id ?? '').split('-');
        const clave = partes[0]?.toLowerCase() === 'clima' ? partes[1]?.toLowerCase() ?? '' : '';
        return { ...a, accion: acciones[clave] ?? null };
    }), [activas, acciones]);

    /** Resuelve una alerta. Devuelve null si salió bien o el mensaje de error. */
    const atender = useCallback(async (id: string): Promise<string | null> => {
        // La tabla aún no tiene `resuelto_por`: enviarlo hacía fallar el UPDATE en silencio. Se registra solo la fecha.
        const { error } = await supabase.from('registro_alertas')
            .update({ resuelta: true, fecha_resolucion: new Date().toISOString() }).eq('id', id);
        if (error) return error.message;
        setActivas((prev) => prev.filter((a) => a.id !== id));
        return null;
    }, []);

    return {
        activas: activasConAccion, periodoFilas, cargando, corteMs,
        error: errorActivas ?? errorPeriodo, recargar: () => { void cargarActivas(); void cargarPeriodo(); }, atender,
    };
}
