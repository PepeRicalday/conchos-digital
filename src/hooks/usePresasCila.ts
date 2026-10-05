import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { onTable } from '../lib/realtimeHub';

export interface LecturaCila {
    presa_id: string;
    fecha: string;
    ts_reporte: string;
    /** null = S/D (nunca 0). El reporte CILA trae la elevación como N/A. */
    almacenamiento_mm3: number | null;
    elevacion_msnm: number | null;
    extraccion_m3s: number | null;
    pct_conservacion: number | null;
    cap_conservacion_mm3: number | null;
    cap_inundacion_mm3: number | null;
    archivo_last_modified: string | null;
}

const num = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Última lectura oficial CILA/USIBWC de una presa (tabla lecturas_presas_cila). */
export function usePresasCila(presaId: string) {
    const [lectura, setLectura] = useState<LecturaCila | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let vivo = true;
        const fetchData = async () => {
            const { data } = await supabase
                .from('lecturas_presas_cila')
                .select('presa_id, fecha, ts_reporte, almacenamiento_mm3, elevacion_msnm, extraccion_m3s, pct_conservacion, cap_conservacion_mm3, cap_inundacion_mm3, archivo_last_modified')
                .eq('presa_id', presaId)
                .order('fecha', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (!vivo) return;
            setLectura(data ? {
                ...data,
                almacenamiento_mm3: num(data.almacenamiento_mm3),
                elevacion_msnm: num(data.elevacion_msnm),
                extraccion_m3s: num(data.extraccion_m3s),
                pct_conservacion: num(data.pct_conservacion),
                cap_conservacion_mm3: num(data.cap_conservacion_mm3),
                cap_inundacion_mm3: num(data.cap_inundacion_mm3),
            } : null);
            setLoading(false);
        };
        fetchData();
        const unsub = onTable('lecturas_presas_cila', '*', fetchData);
        return () => { vivo = false; unsub(); };
    }, [presaId]);

    return { lectura, loading };
}
