import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';

export type HydraulicEvent = 'LLENADO' | 'ESTABILIZACION' | 'CONTINGENCIA_LLUVIA' | 'VACIADO' | 'ANOMALIA_BAJA';

export interface SICAEventLog {
    id: string;
    evento_tipo: HydraulicEvent;
    fecha_inicio: string;
    notas: string;
    esta_activo: boolean;
    autorizado_por?: string;
    gasto_solicitado_m3s?: number;
    porcentaje_apertura_presa?: number;
    valvulas_activas?: string[];
    hora_apertura_real?: string;
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

    const activateEvent = async (tipo: HydraulicEvent, extras: Partial<SICAEventLog> = {}) => {
        setIsLoading(true);
        try {
            const { data: userData } = await supabase.auth.getUser();

            // 1. Desactivar cualquier protocolo anterior (Garantizar "Un dato, una sola verdad")
            await supabase
                .from('sica_eventos_log')
                .update({ esta_activo: false })
                .eq('esta_activo', true);

            // 2. Insertar el nuevo protocolo
            const { error } = await supabase
                .from('sica_eventos_log')
                .insert({
                    evento_tipo: tipo,
                    notas: extras.notas || '',
                    esta_activo: true,
                    autorizado_por: userData.user?.id,
                    gasto_solicitado_m3s: extras.gasto_solicitado_m3s,
                    porcentaje_apertura_presa: extras.porcentaje_apertura_presa,
                    valvulas_activas: extras.valvulas_activas,
                    hora_apertura_real: extras.hora_apertura_real
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

        const channel = supabase.channel('sica_eventos_realtime')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'sica_eventos_log'
            }, () => {
                console.log('🔄 Cambio en protocolo detectado. Actualizando...');
                fetchActiveEvent();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    return {
        activeEvent,
        isLoading,
        error,
        activateEvent,
        refresh: fetchActiveEvent
    };
};
