import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';

export interface PuntoEntrega {
    id: string;
    modulo_id?: string;
    seccion_id?: string;
    nombre: string;
    km: number;
    tipo: 'toma' | 'lateral' | 'carcamo' | 'escala' | 'estacion';
    capacidad_max: number;
    coords_x?: number;
    coords_y?: number;
    zona?: string;
    seccion_texto?: string;
    // Agregados virtuales desde JOINs
    m_codigo_corto?: string;
    s_nombre?: string;
}

export interface ModuloOpcion {
    id: string;
    nombre: string;
    codigo_corto: string;
}

export interface SeccionOpcion {
    id: string;
    nombre: string;
}

export const useInfraestructura = () => {
    const [puntos, setPuntos] = useState<PuntoEntrega[]>([]);
    const [modulos, setModulos] = useState<ModuloOpcion[]>([]);
    const [secciones, setSecciones] = useState<SeccionOpcion[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        setLoading(true);
        try {
            // 1. Catálogos
            const [{ data: modData }, { data: secData }] = await Promise.all([
                supabase.from('modulos').select('id, nombre, codigo_corto').order('codigo_corto'),
                supabase.from('secciones').select('id, nombre').order('nombre')
            ]);

            setModulos(modData as ModuloOpcion[] || []);
            setSecciones(secData as SeccionOpcion[] || []);

            // 2. Puntos
            const { data: ptsData, error } = await supabase
                .from('puntos_entrega')
                .select(`
                    *,
                    modulos ( codigo_corto ),
                    secciones ( nombre )
                `)
                .order('km');

            if (error) throw error;

            const mapped = ptsData.map((p: any) => ({
                ...p,
                m_codigo_corto: p.modulos?.codigo_corto,
                s_nombre: p.secciones?.nombre
            }));

            setPuntos(mapped);

        } catch (error: any) {
            toast.error('Error al cargar infraestructura: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const savePunto = async (punto: Partial<PuntoEntrega>) => {
        try {
            // Remove virtual props
            const { m_codigo_corto, s_nombre, ...payload } = punto;

            const { data, error } = await supabase
                .from('puntos_entrega')
                .upsert(payload)
                .select()
                .single();

            if (error) throw error;
            toast.success('Punto Guardado Exitosamente');
            fetchData();
            return data;
        } catch (err: any) {
            toast.error('Error al guardar punto: ' + err.message);
            throw err;
        }
    };

    const deletePunto = async (id: string) => {
        try {
            const { error } = await supabase.from('puntos_entrega').delete().eq('id', id);
            if (error) throw error;
            toast.success('Punto Eliminado');
            fetchData();
        } catch (err: any) {
            toast.error('No se pudo eliminar: ' + err.message);
            throw err;
        }
    };

    return {
        puntos,
        modulos,
        secciones,
        loading,
        savePunto,
        deletePunto,
        refresh: fetchData
    };
};
