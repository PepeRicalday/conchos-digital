import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';

export interface CicloAgricola {
    id: string;
    nombre: string;
    clave: string;
    fecha_inicio: string;
    fecha_fin: string;
    activo: boolean;
    notas?: string;
    volumen_autorizado_mm3: number;
}

export interface Modulo {
    id: string;
    nombre: string;
    codigo_corto: string;
}

export interface ModuloCiclo {
    id: string;
    ciclo_id: string;
    modulo_id: string;
    volumen_autorizado_mm3: number;
    volumen_consumido_mm3: number;
}

export const useCiclos = () => {
    const [ciclos, setCiclos] = useState<CicloAgricola[]>([]);
    const [modulos, setModulos] = useState<Modulo[]>([]);
    const [modulosCiclos, setModulosCiclos] = useState<ModuloCiclo[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        setLoading(true);
        try {
            // 1. Obtener Ciclos
            const { data: ciclosData, error: ciclosError } = await supabase
                .from('ciclos_agricolas')
                .select('*')
                .order('creado_en', { ascending: false });

            if (ciclosError) throw ciclosError;

            // 2. Obtener Módulos
            const { data: modulosData, error: modulosError } = await supabase
                .from('modulos')
                .select('id, nombre, codigo_corto')
                .order('codigo_corto');

            if (modulosError) throw modulosError;

            // 3. Obtener Relación (Presupuestos de Ciclo por Modulo)
            const { data: mcData, error: mcError } = await supabase
                .from('modulos_ciclos')
                .select('*');

            if (mcError) throw mcError;

            setCiclos(ciclosData as CicloAgricola[]);
            setModulos(modulosData as Modulo[]);
            setModulosCiclos(mcData as ModuloCiclo[]);

        } catch (error: any) {
            console.error('Error fetching ciclos data:', error);
            toast.error('Error al cargar datos del ciclo: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const saveCiclo = async (ciclo: Partial<CicloAgricola>) => {
        try {
            const { data, error } = await supabase
                .from('ciclos_agricolas')
                .upsert(ciclo)
                .select()
                .single();

            if (error) throw error;
            toast.success('Ciclo guardado correctamente.');
            await fetchData();
            return data;
        } catch (error: any) {
            toast.error('Error al guardar ciclo: ' + error.message);
            throw error;
        }
    };

    const saveModuloCiclo = async (id: string | null, ciclo_id: string, modulo_id: string, vol: number) => {
        try {
            const payload = { ciclo_id, modulo_id, volumen_autorizado_mm3: vol };
            if (id) {
                // Update
                const { error } = await supabase
                    .from('modulos_ciclos')
                    .update({ volumen_autorizado_mm3: vol })
                    .eq('id', id);
                if (error) throw error;
            } else {
                // Insert
                const { error } = await supabase
                    .from('modulos_ciclos')
                    .insert(payload);
                if (error) throw error;
            }
            await fetchData();
            toast.success('Presupuesto de Módulo Actualizado');
        } catch (error: any) {
            toast.error('Error al guardar módulos_ciclo: ' + error.message);
        }
    };

    return {
        ciclos,
        modulos,
        modulosCiclos,
        loading,
        saveCiclo,
        saveModuloCiclo,
        refresh: fetchData
    };
};
