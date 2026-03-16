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
const VELOCIDAD_CANAL_MS = 0.70; // m/s promedio ajustado para llenado (antes 1.16)
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

        // Deduplicar por km (quedarse con el primero de cada km)
        const seen = new Set<number>();
        const deduped = (data || []).filter(d => {
            if (seen.has(d.km)) return false;
            seen.add(d.km);
            return true;
        });

        const now = Date.now();
        const mapped: PuntoControl[] = deduped.map(d => ({
            ...d,
            seconds_remaining: d.hora_estimada_actual
                ? Math.max(0, (new Date(d.hora_estimada_actual).getTime() - now) / 1000)
                : -1  // -1 = sin ETA
        }));
        setPuntos(mapped);
    }, [eventoId]);

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

            // Obtener el ciclo_id del evento
            const { data: evento } = await supabase
                .from('sica_eventos_log')
                .select('ciclo_id')
                .eq('id', eventoId)
                .maybeSingle();

            // Obtener escalas activas del sistema
            const { data: escalas, error: escErr } = await supabase
                .from('escalas')
                .select('id, nombre, km')
                .eq('activa', true)
                .order('km', { ascending: true });

            if (escErr) throw escErr;

            // Construir lista de puntos: Presa + KM 0 + todas las escalas
            const uniquePuntos = new Map<number, any>();
            
            // 1. ORIGEN: Presa (KM -36)
            uniquePuntos.set(-36, {
                evento_id: eventoId,
                ciclo_id: evento?.ciclo_id || null,
                punto_nombre: 'Presa La Boquilla / San Fco.',
                km: -36,
                orden_secuencial: -1,
                estado: horaApertura ? 'CONFIRMADO' : 'PENDIENTE',
                hora_real: horaApertura || null
            });

            // 2. KM 0 (Obra de Toma)
            uniquePuntos.set(0, {
                evento_id: eventoId,
                ciclo_id: evento?.ciclo_id || null,
                punto_nombre: 'KM 0+000 (Obra de Toma)',
                km: 0,
                orden_secuencial: 0,
                estado: 'PENDIENTE'
            });

            // 3. Escalas
            (escalas || []).forEach((esc, i) => {
                if (!uniquePuntos.has(esc.km)) {
                    uniquePuntos.set(esc.km, {
                        evento_id: eventoId,
                        ciclo_id: evento?.ciclo_id || null,
                        punto_nombre: esc.nombre,
                        km: esc.km,
                        orden_secuencial: i + 1,
                        estado: 'PENDIENTE'
                    });
                }
            });

            const puntosInsert = Array.from(uniquePuntos.values());

            const { error: insertErr } = await supabase
                .from('sica_llenado_seguimiento')
                .insert(puntosInsert);

            if (insertErr) {
                console.error('❌ [LlenadoTracker] Error al generar puntos:', insertErr);
                throw insertErr;
            }

            console.log(`✅ [LlenadoTracker] ${puntosInsert.length} puntos generados`);
            await fetchPuntos();
        } catch (err) {
            const error = err as Error;
            console.error('💀 [LlenadoTracker]', error);
            toast.error('Error generando puntos: ' + error.message);
        } finally {
            setLoading(false);
        }
    }, [eventoId, fetchPuntos]);

    // --- Calcular ETAs cuando se confirma hora de apertura ---
    const calcularETAs = useCallback(async () => {
        if (!eventoId || !horaApertura || puntos.length === 0) return;
        console.log('🧮 [LlenadoTracker] Calculando ETAs teóricas...');

        const apertura = new Date(horaApertura).getTime();
        const segRio = calcSegundosRio(qSolicitado);

        const updates = puntos.map(p => {
            let segTotales: number;
            if (p.km === -36) {
                segTotales = 0; // Origen en Presa
            } else if (p.km === 0) {
                segTotales = segRio; // Tránsito por Río
            } else {
                segTotales = segRio + calcSegundosCanal(p.km); // Río + Canal
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
    }, [eventoId, horaApertura, qSolicitado, puntos, fetchPuntos]);

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
        if (kmAncla === 0 && (puntos.find(p => p.km === -36)?.hora_real || horaApertura)) {
            // Velocidad medida en el río (desde Presa hasta KM 0)
            const horaInicio = new Date(puntos.find(p => p.km === -36)?.hora_real || horaApertura || '').getTime();
            const tRealRio = (horaAncla - horaInicio) / 1000;
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
                // Fallback: usar velocidad conservadora de llenado (0.7 m/s)
                velocidadReal = 0.7;
                console.log(`📐 Velocidad estimada conservadora: ${velocidadReal.toFixed(2)} m/s`);
            }
        }

        // Limitar velocidad para evitar modelos irreales (Min: 0.3, Max: 1.2)
        velocidadReal = Math.max(0.3, Math.min(1.2, velocidadReal));

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
    }, [puntos, horaApertura, qSolicitado, fetchPuntos]);

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
    // --- Sincronización con Telemetría (SICA Capture) ---
    const syncTelemetry = useCallback(async () => {
        if (!eventoId || puntos.length === 0) return;
        console.log('📡 [LlenadoTracker] Sincronizando con telemetría de campo...');
        
        try {
            // 1. Obtener todas las escalas config para el mapeo
            const { data: escalas } = await supabase.from('escalas').select('id, km').eq('activa', true);
            if (!escalas) return;
            const idToKm = new Map(escalas.map(e => [e.id, e.km]));

            // 2. Obtener lecturas recientes (últimas 100 para cubrir todos los puntos si es necesario)
            const { data: readings } = await supabase
                .from('lecturas_escalas')
                .select('escala_id, nivel_m, creado_en')
                .gt('nivel_m', 0.1) 
                .order('creado_en', { ascending: false })
                .limit(100);

            if (!readings || readings.length === 0) return;

            // 3. Buscar nuevos arribos
            let huboCambios = false;
            for (const r of readings) {
                const readingKm = idToKm.get(r.escala_id);
                if (readingKm === undefined) continue;

                // Buscar punto en el tracker que coincida con el KM
                const target = puntos.find(p => Math.abs(p.km - readingKm) < 0.1);
                
                if (target) {
                    if (!target.hora_real) {
                        // 3a. ARRIBO NUEVO: Confirmar por primera vez
                        console.log(`✨ [LlenadoTracker] ¡Arribo detectado vía Telemetría! ${target.punto_nombre} (KM ${target.km})`);
                        await confirmarArribo(target.id!, r.creado_en, r.nivel_m);
                        huboCambios = true;
                    } else {
                        // 3b. PUNTO YA CONFIRMADO: Actualizar a nivel más reciente si es necesario
                        // (Solo si la lectura es posterior a la hora de arribo real para reflejar estado actual)
                        if (new Date(r.creado_en) > new Date(target.hora_real) && target.nivel_arribo_m !== r.nivel_m) {
                            console.log(`🔄 [LlenadoTracker] Actualizando nivel en ${target.punto_nombre}: ${target.nivel_arribo_m}m -> ${r.nivel_m}m`);
                            await supabase
                                .from('sica_llenado_seguimiento')
                                .update({ nivel_arribo_m: r.nivel_m })
                                .eq('id', target.id);
                            huboCambios = true;
                        }
                    }
                }
            }
            if (huboCambios) await fetchPuntos();
            if (!huboCambios) console.log('✅ [LlenadoTracker] Telemetría sincronizada (sin nuevos cambios).');
        } catch (err) {
            console.error('❌ [LlenadoTracker] Error en syncTelemetry:', err);
        }
    }, [eventoId, puntos, confirmarArribo]);

    // --- Sincronización Automática (Cada 60s) ---
    useEffect(() => {
        if (!eventoId || estadoGeneral === 'PREPARACION' || estadoGeneral === 'COMPLETADO') return;
        
        // Ejecutar sync inicial
        const timer = setTimeout(() => syncTelemetry(), 3000);

        const interval = setInterval(() => {
            syncTelemetry();
        }, 60000);

        return () => {
            clearTimeout(timer);
            clearInterval(interval);
        };
    }, [eventoId, estadoGeneral, syncTelemetry]);

    // --- Inicializar al montar ---
    useEffect(() => {
        if (eventoId) {
            generarPuntos();
        }
    }, [eventoId, generarPuntos]);

    // --- Calcular ETAs cuando se confirma apertura ---
    useEffect(() => {
        if (horaApertura && puntos.length > 0) {
            const sinETA = puntos.some(p => !p.hora_estimada_original && !p.hora_real);
            if (sinETA) {
                calcularETAs();
            }
        }
    }, [horaApertura, puntos, calcularETAs]);

    return {
        puntos,
        estadoGeneral,
        puntoAncla,
        loading,
        confirmarArribo,
        calcularETAs,
        refresh: fetchPuntos,
        syncTelemetry
    };
};
