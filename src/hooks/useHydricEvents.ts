import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';

export type HydraulicEvent = 'LLENADO' | 'ESTABILIZACION' | 'CONTINGENCIA_LLUVIA' | 'VACIADO';

export interface SICAEventLog {
    id: string;
    evento_tipo: HydraulicEvent;
    fecha_inicio: string;
    notas: string;
    esta_activo: boolean;
    autorizado_por?: string;
}

export const useHydricEvents = () => {
    const [activeEvent, setActiveEvent] = useState<SICAEventLog | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchActiveEvent = async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('sica_eventos_log')
                .select('*')
                .eq('esta_activo', true)
                .maybeSingle();

            if (error) throw error;
            setActiveEvent(data);
        } catch (err: any) {
            console.error('Error fetching hydraulic event:', err);
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const activateEvent = async (tipo: HydraulicEvent, notas: string = '') => {
        setIsLoading(true);
        try {
            const { data: userData } = await supabase.auth.getUser();

            const { error } = await supabase
                .from('sica_eventos_log')
                .insert({
                    evento_tipo: tipo,
                    notas,
                    esta_activo: true,
                    autorizado_por: userData.user?.id
                });

            if (error) throw error;

            toast.success(`Protocolo ${tipo} activado exitosamente`);
            await fetchActiveEvent();
        } catch (err: any) {
            console.error('Error activating event:', err);
            toast.error('Error al activar protocolo: ' + err.message);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchActiveEvent();
    }, []);

    return {
        activeEvent,
        isLoading,
        error,
        activateEvent,
        refresh: fetchActiveEvent
    };
};
