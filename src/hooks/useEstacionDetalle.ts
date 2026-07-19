import { useState, useEffect } from 'react';
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

/** Ventanas ofrecidas al operador (días hacia atrás). */
export const VENTANAS = [7, 30, 90] as const;
export type Ventana = (typeof VENTANAS)[number];

export function useEstacionDetalle(est: EstacionConLectura | null, ventana: Ventana) {
    const [detalle, setDetalle] = useState<DetalleEstacion | null>(null);
    const [lecturas, setLecturas] = useState<LecturaClima[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!est) { setDetalle(null); setLecturas([]); setError(null); return; }

        let cancelado = false;
        const cargar = async () => {
            setLoading(true);
            setError(null);
            try {
                const desde = new Date(Date.now() - ventana * 864e5).toISOString();
                const { data, error: e } = await supabase
                    .from('clima_estacion_lecturas')
                    .select('*')
                    .eq('estacion_id', est.id)
                    .gte('ts', desde)
                    .order('ts', { ascending: true });
                if (e) throw e;
                if (cancelado) return;

                const rows = (data ?? []) as LecturaClima[];
                setLecturas(rows);
                setDetalle(construyeDetalle(est, rows));
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
    }, [est, ventana]);

    return { detalle, lecturas, loading, error };
}
