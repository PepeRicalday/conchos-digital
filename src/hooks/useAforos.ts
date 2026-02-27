import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Database } from '../types/database.types';

export type AforoData = Database['public']['Tables']['aforos']['Row'];

export function useAforos(fecha: string) {
    const [aforos, setAforos] = useState<AforoData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function fetchAforos() {
            try {
                setLoading(true);
                setError(null);

                const { data, error: err } = await supabase
                    .from('aforos')
                    .select('*')
                    .eq('fecha', fecha)
                    .order('hora_fin', { ascending: false });

                if (err) throw err;

                if (!cancelled) {
                    setAforos(data || []);
                }

            } catch (err: any) {
                if (!cancelled) {
                    console.error('useAforos Error:', err);
                    setError(err.message);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        fetchAforos();
        return () => { cancelled = true; };
    }, [fecha]);

    // Derived values specifically for the OfficialDamReport
    // For now we map to the exact strings used in the report: km0_580, km106, km104
    const aforosReporte = {
        km0_580: aforos.find(a => a.punto_control_id?.toLowerCase().includes('0+580') || a.punto_control_id === 'PE-001') || null,
        km106: aforos.find(a => a.punto_control_id?.includes('106')) || null,
        km104: aforos.find(a => a.punto_control_id?.includes('104')) || null,
    };

    return { aforos, aforosReporte, loading, error };
}
