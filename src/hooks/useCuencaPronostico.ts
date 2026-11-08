import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { FilaPronostico, FilaVerificacion } from '../utils/cuencaPronostico';
import type { PuntoCuenca } from '../utils/planosDatos';

const PAGINA = 1000;
const n = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export interface PronosticoCuenca {
    puntos: PuntoCuenca[];
    filas: FilaPronostico[];
    verificacion: FilaVerificacion[];
    /** Hora de la corrida más reciente (ISO); null si no hay pronóstico. */
    corridaEn: string | null;
}

/**
 * Pronóstico de 7 días en los puntos de la cuenca (cuenca_puntos + v_cuenca_pronostico_vigente, 3 modelos) y su verificación contra JCAS
 * (fn_cuenca_verificacion, 30 días). Tablas aparte de las del distrito. Si algo falla devuelve error y la vista sigue sin el pronóstico.
 */
export function useCuencaPronostico(refrescoMs = 30 * 60_000) {
    const [datos, setDatos] = useState<PronosticoCuenca | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);
    const recargar = useCallback(() => setTick((t) => t + 1), []);

    useEffect(() => {
        let vivo = true;
        (async () => {
            try {
                const { data: ps, error: e1 } = await supabase.from('cuenca_puntos').select('id, nombre, fuente, latitud, longitud, elevacion_dem_m, grupo_ciudad').eq('activo', true).order('id');
                if (e1) throw new Error(e1.message);
                const puntos: PuntoCuenca[] = (ps ?? []).map((r) => ({
                    id: String(r.id), nombre: String(r.nombre), lat: Number(r.latitud), lon: Number(r.longitud), elevM: n(r.elevacion_dem_m),
                    grupo: (r.grupo_ciudad as string | null) ?? null, fuente: r.fuente === 'weatherlink' ? 'weatherlink' : 'jcas',
                }));
                const filas: FilaPronostico[] = [];
                let corridaEn: string | null = null;
                for (let from = 0; ; from += PAGINA) {
                    const { data, error: e2 } = await supabase.from('v_cuenca_pronostico_vigente')
                        .select('punto_id, modelo, fecha, precip_mm, temp_media_c, hum_media_pct, viento_medio_kmh, corrida_en')
                        .order('punto_id').order('modelo').order('fecha').range(from, from + PAGINA - 1);
                    if (e2) throw new Error(e2.message);
                    for (const r of data ?? []) {
                        filas.push({ punto_id: String(r.punto_id), modelo: String(r.modelo), fecha: String(r.fecha), precip_mm: n(r.precip_mm), temp_media_c: n(r.temp_media_c), hum_media_pct: n(r.hum_media_pct), viento_medio_kmh: n(r.viento_medio_kmh) });
                        const c = r.corrida_en as string | null;
                        if (c && (!corridaEn || c > corridaEn)) corridaEn = c;
                    }
                    if ((data?.length ?? 0) < PAGINA) break;
                }
                // la verificación es opcional: sin ella el pronóstico se muestra con "confiabilidad en construcción"
                const { data: v } = await supabase.rpc('fn_cuenca_verificacion', { p_dias: 30, p_umbral_mm: 1 });
                const verificacion: FilaVerificacion[] = ((v as Record<string, unknown>[] | null) ?? []).map((r) => ({
                    punto_id: String(r.punto_id), nombre: String(r.nombre), n_dias: Number(r.n_dias) || 0, aciertos: Number(r.aciertos) || 0, omisiones: Number(r.omisiones) || 0,
                    falsas_alarmas: Number(r.falsas_alarmas) || 0, correctos_negativos: Number(r.correctos_negativos) || 0, pod: n(r.pod), far: n(r.far), brier: n(r.brier),
                    mm_fc_medio: n(r.mm_fc_medio), mm_obs_medio: n(r.mm_obs_medio), n_temp: Number(r.n_temp) || 0, temp_mae: n(r.temp_mae), temp_sesgo: n(r.temp_sesgo),
                    n_viento: Number(r.n_viento) || 0, viento_mae: n(r.viento_mae), viento_sesgo: n(r.viento_sesgo),
                }));
                if (vivo) { setDatos({ puntos, filas, verificacion, corridaEn }); setError(null); }
            } catch (e) {
                if (vivo) setError((e as Error).message || 'No se pudo cargar el pronóstico de la cuenca');
            } finally {
                if (vivo) setLoading(false);
            }
        })();
        return () => { vivo = false; };
    }, [tick]);

    useEffect(() => {
        const t = window.setInterval(recargar, refrescoMs);
        return () => window.clearInterval(t);
    }, [recargar, refrescoMs]);

    return { datos, loading, error, recargar };
}
