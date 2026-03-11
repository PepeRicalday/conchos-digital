import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';

export type LlenadoEstado = 'PREPARACION' | 'TRANSITO_RIO' | 'TRANSITO_CANAL' | 'COMPLETADO';

export interface PuntoControl {
    id?: string;
    evento_id: string;
    escala_id: string | null;
    punto_nombre: string;
    km: number;
    orden_secuencial: number;
    hora_estimada_original: string | null;
    segundos_modelo: number | null;
    hora_estimada_actual: string | null;
    recalculado_desde: string | null;
    hora_real: string | null;
    diferencia_minutos: number | null;
    nivel_arribo_m: number | null;
    gasto_paso_m3s: number | null;
    estado: 'PENDIENTE' | 'EN_TRANSITO' | 'CONFIRMADO' | 'ESTABILIZADO';
    notas: string | null;
    // Calculados en el frontend
    seconds_remaining: number;
}

export interface LlenadoState {
    estado_general: LlenadoEstado;
    evento_id: string | null;
    q_solicitado: number;
    hora_apertura_real: string | null;
    puntos: PuntoControl[];
    punto_ancla: PuntoControl | null;
    tiempo_transcurrido_s: number;
}

// Velocidades del canal por tramo (de perfil_hidraulico_canal)
const VELOCIDAD_CANAL_MS = 1.16; // m/s promedio de diseño
const DISTANCIA_RIO_M = 36000;   // 36 km Obra de Toma → KM 0

// Modelo empírico del río: v = 0.5 * Q^0.4 + 0.5
function calcVelocidadRio(q: number): number {
    return 0.5 * Math.pow(Math.max(q, 1), 0.4) + 0.5;
}

function calcSegundosRio(q: number): number {
    const v = calcVelocidadRio(q);
    return DISTANCIA_RIO_M / v;
}

function calcSegundosCanal(km: number): number {
    return (km * 1000) / VELOCIDAD_CANAL_MS;
}

export const useLlenadoTracker = (eventoId: string | null, qSolicitado: number, horaApertura: string | null) => {
    const [puntos, setPuntos] = useState<PuntoControl[]>([]);
    const [loading, setLoading] = useState(false);

    const estadoGeneral: LlenadoEstado = (() => {
        if (!horaApertura) return 'PREPARACION';
        const km0 = puntos.find(p => p.km === 0);
        if (!km0?.hora_real) return 'TRANSITO_RIO';
        const pendientes = puntos.filter(p => p.km > 0 && p.estado !== 'CONFIRMADO' && p.estado !== 'ESTABILIZADO');
        if (pendientes.length === 0 && puntos.length > 0) return 'COMPLETADO';
        return 'TRANSITO_CANAL';
    })();

    const puntoAncla = (() => {
        const confirmados = puntos.filter(p => p.hora_real).sort((a, b) => b.km - a.km);
        return confirmados[0] || null;
    })();

    // --- Generar puntos de control al activar llenado ---
    const generarPuntos = useCallback(async () => {
        if (!eventoId) return;
        setLoading(true);
        console.log('🏗️ [LlenadoTracker] Generando puntos de control...');

        try {
            // Verificar si ya existen puntos para este evento
            const { data: existing } = await supabase
                .from('sica_llenado_seguimiento')
                .select('id')
                .eq('evento_id', eventoId)
                .limit(1);

            if (existing && existing.length > 0) {
                console.log('✅ [LlenadoTracker] Puntos ya existen, cargando...');
                await fetchPuntos();
                setLoading(false);
                return;
            }

            // Obtener escalas activas del sistema
            const { data: escalas, error: escErr } = await supabase
                .from('escalas')
                .select('id, nombre, km')
                .eq('activa', true)
                .order('km', { ascending: true });

            if (escErr) throw escErr;

            // Obtener ciclo activo
            const { data: cicloData } = await supabase
                .from('ciclos_agricolas')
                .select('id')
                .eq('activo', true)
                .limit(1)
                .maybeSingle();

            // Construir lista de puntos: KM 0 + todas las escalas
            const puntosInsert = [
                {
                    evento_id: eventoId,
                    ciclo_id: cicloData?.id || null,
                    escala_id: null,
                    punto_nombre: 'KM 0+000',
                    km: 0,
                    orden_secuencial: 0,
                    estado: 'PENDIENTE'
                },
                ...(escalas || []).map((esc, i) => ({
                    evento_id: eventoId,
                    ciclo_id: cicloData?.id || null,
                    escala_id: esc.id,
                    punto_nombre: esc.nombre,
                    km: esc.km,
                    orden_secuencial: i + 1,
                    estado: 'PENDIENTE' as const
                }))
            ];

            const { error: insertErr } = await supabase
                .from('sica_llenado_seguimiento')
                .insert(puntosInsert);

            if (insertErr) {
                console.error('❌ [LlenadoTracker] Error al generar puntos:', insertErr);
                throw insertErr;
            }

            console.log(`✅ [LlenadoTracker] ${puntosInsert.length} puntos generados`);
            await fetchPuntos();
        } catch (err: any) {
            console.error('💀 [LlenadoTracker]', err);
            toast.error('Error generando puntos: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [eventoId]);

    // --- Fetch puntos existentes ---
    const fetchPuntos = useCallback(async () => {
        if (!eventoId) return;
        const { data, error } = await supabase
            .from('sica_llenado_seguimiento')
            .select('*')
            .eq('evento_id', eventoId)
            .order('orden_secuencial', { ascending: true });

        if (error) {
            console.error('❌ Fetch puntos:', error);
            return;
        }

        const now = Date.now();
        const mapped: PuntoControl[] = (data || []).map(d => ({
            ...d,
            seconds_remaining: d.hora_estimada_actual
                ? Math.max(0, (new Date(d.hora_estimada_actual).getTime() - now) / 1000)
                : -1  // -1 = sin ETA
        }));
        setPuntos(mapped);
    }, [eventoId]);

    // --- Calcular ETAs cuando se confirma hora de apertura ---
    const calcularETAs = useCallback(async () => {
        if (!eventoId || !horaApertura || puntos.length === 0) return;
        console.log('🧮 [LlenadoTracker] Calculando ETAs teóricas...');

        const apertura = new Date(horaApertura).getTime();
        const segRio = calcSegundosRio(qSolicitado);

        const updates = puntos.map(p => {
            let segTotales: number;
            if (p.km === 0) {
                segTotales = segRio; // Solo río
            } else {
                segTotales = segRio + calcSegundosCanal(p.km); // Río + canal
            }

            const eta = new Date(apertura + segTotales * 1000).toISOString();

            return {
                id: p.id,
                hora_estimada_original: p.hora_real ? p.hora_estimada_original : eta, // No sobreescribir si ya confirmado
                hora_estimada_actual: p.hora_real ? p.hora_estimada_actual : eta,
                segundos_modelo: segTotales,
                estado: p.hora_real ? p.estado : 'EN_TRANSITO'
            };
        });

        for (const u of updates) {
            if (!u.id) continue;
            await supabase
                .from('sica_llenado_seguimiento')
                .update({
                    hora_estimada_original: u.hora_estimada_original,
                    hora_estimada_actual: u.hora_estimada_actual,
                    segundos_modelo: u.segundos_modelo,
                    estado: u.estado
                })
                .eq('id', u.id);
        }

        console.log('✅ [LlenadoTracker] ETAs calculadas');
        await fetchPuntos();
    }, [eventoId, horaApertura, qSolicitado, puntos.length]);

    // --- Confirmar arribo real + recálculo en cascada ---
    const confirmarArribo = useCallback(async (puntoId: string, horaReal: string, nivelM?: number, gastoM3s?: number, notas?: string) => {
        console.log(`📍 [LlenadoTracker] Confirmando arribo en punto ${puntoId}`);

        // 1. Actualizar el punto confirmado
        const { error: updErr } = await supabase
            .from('sica_llenado_seguimiento')
            .update({
                hora_real: horaReal,
                nivel_arribo_m: nivelM || null,
                gasto_paso_m3s: gastoM3s || null,
                notas: notas || null,
                estado: 'CONFIRMADO',
                updated_at: new Date().toISOString()
            })
            .eq('id', puntoId);

        if (updErr) {
            toast.error('Error al confirmar: ' + updErr.message);
            return;
        }

        // 2. Obtener datos frescos
        await fetchPuntos();

        // 3. Recálculo en cascada
        const puntoConfirmado = puntos.find(p => p.id === puntoId);
        if (!puntoConfirmado) return;

        const kmAncla = puntoConfirmado.km;
        const horaAncla = new Date(horaReal).getTime();

        // Puntos posteriores no confirmados
        const posteriores = puntos.filter(p =>
            p.km > kmAncla && !p.hora_real
        );

        if (posteriores.length === 0) {
            toast.success(`✅ Arribo confirmado en ${puntoConfirmado.punto_nombre}`);
            return;
        }

        // Calcular velocidad real medida
        let velocidadReal: number;
        if (kmAncla === 0 && horaApertura) {
            // Velocidad medida en el río
            const tRealRio = (horaAncla - new Date(horaApertura).getTime()) / 1000;
            velocidadReal = DISTANCIA_RIO_M / Math.max(tRealRio, 1);
            console.log(`📐 Velocidad real río: ${velocidadReal.toFixed(2)} m/s (teórica: ${calcVelocidadRio(qSolicitado).toFixed(2)} m/s)`);
        } else {
            // Velocidad medida en el canal
            // Buscar el punto confirmado anterior para calcular velocidad del tramo
            const confirmadosAnteriores = puntos.filter(p => p.km < kmAncla && p.hora_real)
                .sort((a, b) => b.km - a.km);
            
            const puntoAnterior = confirmadosAnteriores[0];
            if (puntoAnterior?.hora_real) {
                const distTramo = (kmAncla - puntoAnterior.km) * 1000; // metros
                const tTramo = (horaAncla - new Date(puntoAnterior.hora_real).getTime()) / 1000;
                velocidadReal = distTramo / Math.max(tTramo, 1);
                console.log(`📐 Velocidad real canal (${puntoAnterior.punto_nombre} → ${puntoConfirmado.punto_nombre}): ${velocidadReal.toFixed(2)} m/s`);
            } else {
                // Fallback: usar velocidad de diseño con factor de corrección
                const etaOriginal = puntoConfirmado.hora_estimada_original 
                    ? new Date(puntoConfirmado.hora_estimada_original).getTime() : horaAncla;
                const factor = horaAncla / Math.max(etaOriginal, 1);
                velocidadReal = VELOCIDAD_CANAL_MS / Math.max(factor, 0.5);
                console.log(`📐 Velocidad estimada con factor: ${velocidadReal.toFixed(2)} m/s`);
            }
        }

        // Recalcular ETAs posteriores
        console.log(`🔄 [Cascada] Recalculando ${posteriores.length} puntos desde ${puntoConfirmado.punto_nombre}`);
        for (const p of posteriores) {
            const distRestante = (p.km - kmAncla) * 1000; // metros
            const tRestante = distRestante / velocidadReal; // segundos
            const nuevaETA = new Date(horaAncla + tRestante * 1000).toISOString();

            await supabase
                .from('sica_llenado_seguimiento')
                .update({
                    hora_estimada_actual: nuevaETA,
                    recalculado_desde: puntoConfirmado.punto_nombre,
                    updated_at: new Date().toISOString()
                })
                .eq('id', p.id);
        }

        toast.success(`✅ Arribo en ${puntoConfirmado.punto_nombre} → ${posteriores.length} puntos recalculados`);
        await fetchPuntos();
    }, [puntos, horaApertura, qSolicitado]);

    // --- Countdown en vivo ---
    useEffect(() => {
        if (estadoGeneral === 'PREPARACION') return;
        const interval = setInterval(() => {
            setPuntos(prev => prev.map(p => ({
                ...p,
                seconds_remaining: p.hora_estimada_actual
                    ? Math.max(0, (new Date(p.hora_estimada_actual).getTime() - Date.now()) / 1000)
                    : -1
            })));
        }, 1000);
        return () => clearInterval(interval);
    }, [estadoGeneral]);

    // --- Inicializar al montar ---
    useEffect(() => {
        if (eventoId) {
            generarPuntos();
        }
    }, [eventoId]);

    // --- Calcular ETAs cuando se confirma apertura ---
    useEffect(() => {
        if (horaApertura && puntos.length > 0) {
            const sinETA = puntos.some(p => !p.hora_estimada_original && !p.hora_real);
            if (sinETA) {
                calcularETAs();
            }
        }
    }, [horaApertura, puntos.length]);

    return {
        puntos,
        estadoGeneral,
        puntoAncla,
        loading,
        confirmarArribo,
        calcularETAs,
        refresh: fetchPuntos
    };
};
