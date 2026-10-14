
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { onTable } from '../lib/realtimeHub';
import { esEscalaReferencia } from '../utils/escalasReferencia';
import { normalizaTramoFuga, type FilaVistaFugas, type SegmentLoss } from '../utils/tramosFuga';

export type { SegmentLoss };

export const useLeakMonitor = () => {
    const [segments, setSegments] = useState<SegmentLoss[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchLeaks = async () => {
        try {
            setLoading(true);
            const { data, error: err } = await supabase
                .from('dashboard_vulnerabilidad_fugas')
                .select('*')
                .order('km_inicio', { ascending: true });

            if (err) throw err;
            // La vista parte el canal en TODAS las escalas; los tramos que tocan K-64 o K-94+200 (referencias sin gasto propio)
            // no son tramos de balance reales y producían falsas fugas / eficiencias absurdas.
            const filas = (data || []) as FilaVistaFugas[];
            setSegments(filas
                .filter((f) => !esEscalaReferencia({ nombre: f.escala_inicio_nombre ?? '' }) && !esEscalaReferencia({ nombre: f.escala_fin_nombre ?? '' }))
                .map(normalizaTramoFuga));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLeaks();
        const unsubEscalas  = onTable('lecturas_escalas',   '*', () => fetchLeaks());
        const unsubReportes = onTable('reportes_operacion',  '*', () => fetchLeaks());

        return () => {
            unsubEscalas();
            unsubReportes();
        };
    }, []);

    return { segments, loading, error, refresh: fetchLeaks };
};
