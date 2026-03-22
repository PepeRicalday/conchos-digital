import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { onTable } from '../lib/realtimeHub';
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

    const fetchActiveEvent = useCallback(async () => {
        try {
            console.log('📡 [HydricEvents] Consultando evento activo...');
            const { data, error: fetchError } = await supabase
                .from('sica_eventos_log')
                .select('*')
                .eq('esta_activo', true)
                .order('fecha_inicio', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (fetchError) {
                console.error('❌ [HydricEvents] Error en consulta:', fetchError);
                throw fetchError;
            }
            
            console.log('📡 [HydricEvents] Resultado:', data ? `${data.evento_tipo} (ID: ${data.id})` : 'NULL - Sin evento activo');
            setActiveEvent(data);
            setError(null);
        } catch (err: any) {
            console.error('❌ [HydricEvents] Error fatal en fetch:', err);
            setError(err.message);
        }
    }, []);

    const activateEvent = useCallback(async (tipo: HydraulicEvent, extras: Partial<SICAEventLog> = {}) => {
        setIsLoading(true);
        setError(null);
        console.log(`🚀 [HydricEvents] Activando protocolo: ${tipo}`);

        try {
            // 1. Verificar autenticación
            const { data: userData, error: authError } = await supabase.auth.getUser();
            if (authError || !userData.user) {
                throw new Error('Sin autenticación: ' + (authError?.message ?? 'usuario nulo'));
            }

            // 2. Llamada atómica a la RPC — desactiva anteriores e inserta nuevo
            //    en UNA SOLA transacción PostgreSQL. Elimina condición de carrera
            //    que existía en la secuencia UPDATE → INSERT → UPDATE anterior.
            const { data: evento, error: rpcError } = await supabase.rpc(
                'activar_protocolo_hidrico',
                {
                    p_tipo:                  tipo,
                    p_notas:                 extras.notas ?? '',
                    p_autorizado_por:        userData.user.id,
                    p_gasto_solicitado_m3s:  extras.gasto_solicitado_m3s   ?? null,
                    p_porcentaje_apertura:   extras.porcentaje_apertura_presa ?? null,
                    p_valvulas_activas:      extras.valvulas_activas        ?? null,
                    p_hora_apertura_real:    extras.hora_apertura_real      ?? null,
                }
            );

            if (rpcError) {
                // Conflicto de concurrencia: otro operador activó un protocolo al mismo tiempo
                if (rpcError.message?.includes('PROTOCOL_CONFLICT')) {
                    toast.error('⚠️ Conflicto: otro protocolo fue activado simultáneamente. Verifique el estado actual.');
                    await fetchActiveEvent(); // Refrescar para mostrar el que ganó
                    return;
                }
                throw rpcError;
            }

            console.log('✅ [HydricEvents] Protocolo activado atómicamente:', evento?.evento_tipo);
            setActiveEvent(evento);
            toast.success(`✅ Protocolo ${tipo} activado`);

        } catch (err: any) {
            console.error('❌ [HydricEvents] Error en activación:', err.message);
            setError(err.message);
            toast.error(`❌ Error: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    }, [fetchActiveEvent]);

    const updateEvent = useCallback(async (eventId: string, updates: Partial<SICAEventLog>) => {
        setIsLoading(true);
        setError(null);
        try {
            const { error: updateError } = await supabase
                .from('sica_eventos_log')
                .update(updates)
                .eq('id', eventId);
            
            if (updateError) throw updateError;
            
            await fetchActiveEvent();
            toast.success('✅ Protocolo actualizado');
        } catch (err: any) {
            setError(err.message);
            toast.error(`❌ Error al actualizar: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    }, [fetchActiveEvent]);

    useEffect(() => {
        fetchActiveEvent();

        const unsub = onTable('sica_eventos_log', '*', (payload) => {
            console.log('🔴 [Realtime] Cambio detectado:', payload);
            fetchActiveEvent();
        });

        return () => unsub();
    }, [fetchActiveEvent]);

    return {
        activeEvent,
        isLoading,
        error,
        activateEvent,
        updateEvent,
        refresh: fetchActiveEvent
    };
};
