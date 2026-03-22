
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { onTable } from '../lib/realtimeHub';

export interface SegmentLoss {
    tramo_inicio: string;
    tramo_fin: string;
    km_inicio: number;
    km_fin: number;
    q_entrada: number;
    q_salida: number;
    q_entregado: number;
    q_perdida: number;
    eficiencia_pct: number;
    estatus: string;
}

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
            setSegments(data || []);
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
