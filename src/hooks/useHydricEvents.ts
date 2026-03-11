import { useState, useEffect, useCallback } from 'react';
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
        console.log(`🚀 [HydricEvents] ===== ACTIVANDO PROTOCOLO: ${tipo} =====`);
        console.log('🚀 [HydricEvents] Datos extras:', JSON.stringify(extras));
        
        try {
            // 1. Obtener usuario actual
            const { data: userData, error: authError } = await supabase.auth.getUser();
            if (authError) {
                console.error('❌ [HydricEvents] Error de autenticación:', authError);
                throw new Error('Sin autenticación: ' + authError.message);
            }
            console.log('✅ [HydricEvents] Usuario autenticado:', userData.user?.email);

            // 2. Desactivar TODOS los eventos anteriores manualmente
            console.log('🔄 [HydricEvents] Desactivando eventos anteriores...');
            const { error: updateError, count } = await supabase
                .from('sica_eventos_log')
                .update({ esta_activo: false })
                .eq('esta_activo', true);
            
            if (updateError) {
                console.warn('⚠️ [HydricEvents] Error al desactivar anteriores (puede ser normal si no hay):', updateError);
                // No lanzamos error aquí, continuamos
            } else {
                console.log(`✅ [HydricEvents] Desactivados ${count ?? '?'} eventos anteriores`);
            }

            // 3. Insertar nuevo protocolo
            console.log('📝 [HydricEvents] Insertando nuevo protocolo...');
            const insertPayload = {
                evento_tipo: tipo,
                notas: extras.notas || '',
                esta_activo: true,
                autorizado_por: userData.user?.id || null,
                gasto_solicitado_m3s: extras.gasto_solicitado_m3s || null,
                porcentaje_apertura_presa: extras.porcentaje_apertura_presa || null,
                valvulas_activas: extras.valvulas_activas || null,
                hora_apertura_real: extras.hora_apertura_real || null
            };
            console.log('📝 [HydricEvents] Payload:', JSON.stringify(insertPayload));

            const { data: insertedData, error: insertError } = await supabase
                .from('sica_eventos_log')
                .insert(insertPayload)
                .select()
                .single();

            if (insertError) {
                console.error('❌ [HydricEvents] ERROR DE INSERT:', insertError);
                console.error('❌ [HydricEvents] Código:', insertError.code);
                console.error('❌ [HydricEvents] Detalle:', insertError.details);
                console.error('❌ [HydricEvents] Hint:', insertError.hint);
                throw insertError;
            }

            console.log('✅ [HydricEvents] PROTOCOLO REGISTRADO:', insertedData);
            
            // 4. Actualizar estado local inmediatamente
            setActiveEvent(insertedData);
            toast.success(`✅ Protocolo ${tipo} activado`);

            // 5. Re-fetch de seguridad después de medio segundo
            setTimeout(() => {
                console.log('🔄 [HydricEvents] Re-fetch de confirmación...');
                fetchActiveEvent();
            }, 800);

        } catch (err: any) {
            console.error('💀 [HydricEvents] ===== ERROR COMPLETO =====');
            console.error('💀 [HydricEvents] Mensaje:', err.message);
            console.error('💀 [HydricEvents] Objeto completo:', err);
            setError(err.message);
            toast.error(`❌ Error: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    }, [fetchActiveEvent]);

    useEffect(() => {
        fetchActiveEvent();

        const channel = supabase.channel('sica_eventos_realtime')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'sica_eventos_log'
            }, (payload) => {
                console.log('🔴 [Realtime] Cambio detectado:', payload);
                fetchActiveEvent();
            })
            .subscribe((status) => {
                console.log('📡 [Realtime] Estado de suscripción:', status);
            });

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchActiveEvent]);

    return {
        activeEvent,
        isLoading,
        error,
        activateEvent,
        refresh: fetchActiveEvent
    };
};
