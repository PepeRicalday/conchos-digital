import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { EstacionConLectura, LecturaClima } from './useClimaEstaciones';
import { construyeDetalle, type DetalleEstacion } from '../utils/estacionDetalle';

/**
 * Histórico de UNA estación, cargado bajo demanda al abrir su detalle.
 *
 * Deliberadamente NO se precarga para las 4 estaciones al montar la página: son
 * ~12 lecturas/día cada una y la vista de red no usa nada de esto. Se consulta
 * al abrir el panel y se descarta al cerrarlo.
 */

/** Ventanas fijas ofrecidas al operador (días hacia atrás desde hoy). */
export const VENTANAS = [7, 30, 90] as const;
export type Ventana = (typeof VENTANAS)[number];

/** Rango de fechas explícito (inicio/fin en formato YYYY-MM-DD, local). */
export interface RangoManual { desde: string; hasta: string; }

/** Ventana fija o rango personalizado — lo que el selector de periodo produce. */
export type RangoAnalisis = { tipo: 'ventana'; dias: Ventana } | { tipo: 'manual'; rango: RangoManual };

/** Días que abarca el rango (para el segundo bloque de balance y el informe). */
export function diasDelRango(r: RangoAnalisis): number {
    if (r.tipo === 'ventana') return r.dias;
    const ini = new Date(`${r.rango.desde}T00:00:00`);
    const fin = new Date(`${r.rango.hasta}T00:00:00`);
    return Math.max(1, Math.round((fin.getTime() - ini.getTime()) / 864e5) + 1);
}

export function useEstacionDetalle(est: EstacionConLectura | null, rango: RangoAnalisis) {
    const [detalle, setDetalle] = useState<DetalleEstacion | null>(null);
    const [lecturas, setLecturas] = useState<LecturaClima[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Límites de consulta: una ventana relativa a "ahora", o el rango manual
    // exacto (hasta el final del día seleccionado, no su medianoche).
    const { desde, hasta } = useMemo(() => {
        if (rango.tipo === 'manual') {
            return {
                desde: new Date(`${rango.rango.desde}T00:00:00`).toISOString(),
                hasta: new Date(`${rango.rango.hasta}T23:59:59`).toISOString(),
            };
        }
        return { desde: new Date(Date.now() - rango.dias * 864e5).toISOString(), hasta: null as string | null };
    }, [rango]);

    useEffect(() => {
        if (!est) { setDetalle(null); setLecturas([]); setError(null); return; }

        let cancelado = false;
        const cargar = async () => {
            setLoading(true);
            setError(null);
            try {
                let q = supabase
                    .from('clima_estacion_lecturas')
                    .select('*')
                    .eq('estacion_id', est.id)
                    .gte('ts', desde)
                    .order('ts', { ascending: true });
                if (hasta) q = q.lte('ts', hasta);
                const { data, error: e } = await q;
                if (e) throw e;
                if (cancelado) return;

                const rows = (data ?? []) as LecturaClima[];
                setLecturas(rows);
                setDetalle(construyeDetalle(est, rows, diasDelRango(rango)));
            } catch (err) {
                if (cancelado) return;
                setError(err instanceof Error ? err.message : 'No se pudo cargar el histórico de la estación');
                setDetalle(null);
                setLecturas([]);
            } finally {
                if (!cancelado) setLoading(false);
            }
        };
        void cargar();
        // Evita que una respuesta lenta de la estación anterior pise a la nueva.
        return () => { cancelado = true; };
    }, [est, desde, hasta, rango]);

    return { detalle, lecturas, loading, error };
}
