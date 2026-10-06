import { useCallback, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePolling } from './useClimaOperativo';
import {
    normalizaEscalas, normalizaTomas, propagaSifones,
    type EscalaBalance, type FilaEscalaRaw, type FilaTomaRaw, type TomaBalance,
} from '../utils/balanceTramos';
import { soloEscalasDeControl } from '../utils/escalasReferencia';
import type { PerfilTramo } from '../utils/hydraulics';

// El perfil de diseño casi nunca cambia: se pide una vez por sesión, no en cada cambio de fecha.
let perfilCache: PerfilTramo[] | null = null;

export interface BalanceDia {
    escalas: EscalaBalance[];
    sinKm: number;
    tomas: TomaBalance[];
    tomasDescartadas: number;
    perfil: PerfilTramo[];
    error: string | null;
    cargando: boolean;
    actualizadoEn: number | null;
    recargar: () => Promise<void>;
}

/**
 * Escalas, tomas y perfil de diseño del día elegido. Descarta respuestas de una fecha ya abandonada (antes una
 * petición lenta podía pisar a la actual), expone el error en lugar de tragarlo y no recarga el perfil por fecha.
 */
export function useBalanceDia(fecha: string): BalanceDia {
    const [estado, setEstado] = useState<Omit<BalanceDia, 'recargar' | 'cargando' | 'error'>>({
        escalas: [], sinKm: 0, tomas: [], tomasDescartadas: 0, perfil: perfilCache ?? [], actualizadoEn: null,
    });
    const [error, setError] = useState<string | null>(null);
    const [claveCargada, setClaveCargada] = useState<string | null>(null);
    const generacion = useRef(0);

    const recargar = useCallback(async () => {
        const mia = ++generacion.current;
        const [escRes, tomasRes] = await Promise.all([
            supabase.from('resumen_escalas_diario').select('escala_id, nombre, km, nivel_actual, gasto_calculado_m3s, seccion_nombre').eq('fecha', fecha).order('km', { ascending: true }),
            // reportes_operacion (captura de tomas por día); el hook predictivo usa reportes_diarios, hoy vacío.
            supabase.from('reportes_operacion').select('punto_id, puntos_entrega(nombre, km), caudal_promedio, estado').eq('fecha', fecha).in('estado', ['inicio', 'continua', 'reabierto', 'modificacion']),
        ]);
        let perfilError: string | null = null;
        if (!perfilCache) {
            const p = await supabase.from('perfil_hidraulico_canal').select('km_inicio, km_fin, nombre_tramo, plantilla_m, talud_z, rugosidad_n, pendiente_s0, tirante_diseno_m, capacidad_diseno_m3s, velocidad_diseno_ms, bordo_libre_m, ancho_corona_m').order('km_inicio', { ascending: true });
            if (p.error) perfilError = p.error.message; else perfilCache = (p.data ?? []) as PerfilTramo[];
        }

        let filas = (escRes.data ?? []) as FilaEscalaRaw[];
        // Respaldo: si el resumen diario trae menos de 2 escalas, leer lecturas_escalas del día (la más reciente por escala).
        if (!escRes.error && filas.length < 2) {
            const { data } = await supabase.from('lecturas_escalas').select('escala_id, nivel_m, gasto_calculado_m3s, escalas(nombre, km)').eq('fecha', fecha).order('hora_lectura', { ascending: false });
            const vistos = new Set<string>();
            const lect = (data ?? []) as unknown as { escala_id: string; nivel_m: number | null; gasto_calculado_m3s: number | null; escalas: { nombre: string; km: number } | null }[];
            const dedup = lect.filter((l) => (vistos.has(l.escala_id) ? false : (vistos.add(l.escala_id), true)));
            if (dedup.length >= 2) filas = dedup.map((l) => ({ escala_id: l.escala_id, nombre: l.escalas?.nombre, km: l.escalas?.km, nivel_actual: l.nivel_m, gasto_calculado_m3s: l.gasto_calculado_m3s }));
        }
        if (mia !== generacion.current) return; // llegó tarde: otra fecha ya está en pantalla

        const fallo = escRes.error?.message ?? tomasRes.error?.message ?? perfilError;
        setError(fallo ?? null);
        if (!escRes.error) {
            const { escalas, sinKm } = normalizaEscalas(filas);
            const { tomas, descartadas } = normalizaTomas((tomasRes.data ?? []) as unknown as FilaTomaRaw[]);
            // K-64 y K-94+200 son referencias (sin gasto propio): no son extremos de tramo.
            setEstado({ escalas: propagaSifones(soloEscalasDeControl(escalas)), sinKm, tomas, tomasDescartadas: descartadas, perfil: perfilCache ?? [], actualizadoEn: Date.now() });
        }
        setClaveCargada(fecha);
    }, [fecha]);

    usePolling(recargar, 5 * 60_000);
    return { ...estado, error, cargando: claveCargada !== fecha, recargar };
}
