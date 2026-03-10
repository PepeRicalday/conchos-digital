
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

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
        // Subscribe to changes in scales or reports to refresh
        const channel = supabase.channel('leak-monitor')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'lecturas_escalas' }, () => fetchLeaks())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'reportes_operacion' }, () => fetchLeaks())
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    return { segments, loading, error, refresh: fetchLeaks };
};
