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
    telemetria: LlenadoTelemetry;
}

export interface LlenadoTelemetry {
    velocidad_promedio_m_s: number;
    velocidad_promedio_km_h: number;
    tiempo_desde_km0_s: number;
    distancia_recorrida_km: number;
    avance_porcentaje: number;
    volumen_estimado_inyectado_mm3: number;
}

// Rangos físicos de velocidad de onda por medio hidráulico
const V_CANAL_MIN      = 0.3;   // m/s — canal revestido con baja carga
const V_CANAL_MAX      = 1.2;   // m/s — canal a plena capacidad con onda positiva
const V_CANAL_FALLBACK = 0.70;  // m/s — si perfil hidráulico no disponible aún
const V_RIO_MIN        = 0.8;   // m/s — río a caudal mínimo operativo
const V_RIO_MAX        = 4.0;   // m/s — río en avenida
const DISTANCIA_RIO_M  = 36000; // 36 km Obra de Toma → KM 0
const G                = 9.81;  // m/s²
const WAVE_K           = 1.3;   // factor empírico para frentes de onda positivos

interface PerfilTramo {
    km_inicio: number;
    km_fin: number;
    plantilla_m: number;
    talud_z: number;
    tirante_diseno_m: number;
}

// Modelo empírico del río: v = 0.5 * Q^0.4 + 0.5
function calcVelocidadRio(q: number): number {
    return 0.5 * Math.pow(Math.max(q, 1), 0.4) + 0.5;
}

function calcSegundosRio(q: number): number {
    const v = calcVelocidadRio(q);
    return DISTANCIA_RIO_M / v;
}

// Velocidad de frente de onda en canal trapezoidal (celeridad real, no constante)
// V_w = (Q/A + √(g·A/T)) · WAVE_K
// A = (b + z·y)·y  |  T = b + 2·z·y  (sección trapezoidal)
function calcVelocidadOndaCanal(km: number, q: number, perfil: PerfilTramo[]): number {
    const tramo = perfil.find(t => km >= t.km_inicio && km <= t.km_fin) ?? perfil[0];
    if (!tramo) return V_CANAL_FALLBACK;

    const b = tramo.plantilla_m;
    const z = tramo.talud_z;
    const y = tramo.tirante_diseno_m;
    const A = (b + z * y) * y;
    const T = b + 2 * z * y;
    if (A <= 0 || T <= 0) return V_CANAL_FALLBACK;

    const V = q / A;                 // velocidad media del flujo
    const c = Math.sqrt(G * A / T);  // celeridad de onda (sección irregular)
    return Math.max(V_CANAL_MIN, Math.min(V_CANAL_MAX, (V + c) * WAVE_K));
}

function calcSegundosOndaCanal(km: number, q: number, perfil: PerfilTramo[]): number {
    return (km * 1000) / calcVelocidadOndaCanal(km, q, perfil);
}

export const useLlenadoTracker = (eventoId: string | null, qSolicitado: number, horaApertura: string | null) => {
    const [puntos, setPuntos] = useState<PuntoControl[]>([]);
    const [loading, setLoading] = useState(false);
    const [perfilCanal, setPerfilCanal] = useState<PerfilTramo[]>([]);

    // Cargar geometría del canal una sola vez (para calcular celeridad por tramo)
    useEffect(() => {
        supabase
            .from('perfil_hidraulico_canal')
            .select('km_inicio, km_fin, plantilla_m, talud_z, tirante_diseno_m')
            .order('km_inicio')
            .then(({ data }) => {
                if (data && data.length > 0) {
                    setPerfilCanal(data.map(t => ({
                        km_inicio: Number(t.km_inicio),
                        km_fin:    Number(t.km_fin),
                        plantilla_m:      Number(t.plantilla_m),
                        talud_z:          Number(t.talud_z),
                        tirante_diseno_m: Number(t.tirante_diseno_m),
                    })));
                }
            });
    }, []);

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
                segTotales = segRio + calcSegundosOndaCanal(p.km, qSolicitado, perfilCanal); // Río + Canal
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
    }, [eventoId, horaApertura, qSolicitado, puntos, perfilCanal, fetchPuntos]);

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

        // ── P1-7: Validación de velocidad de propagación antes de cascada ────────
        // Río y canal son medios hidráulicamente distintos con rangos físicos diferentes.
        // La velocidad medida en el río NO debe usarse directamente para predecir el canal.
        //
        //  TRAMO RÍO   (Presa → KM 0, 36 km): rango esperado V_RIO_MIN – V_RIO_MAX
        //  TRAMO CANAL (KM 0 → KM 104):        rango esperado V_CANAL_MIN – V_CANAL_MAX
        //
        // Cuando se activa el clamp se emite un toast para que el operador sepa
        // que las ETAs usan un valor corregido, no el medido.
        // ────────────────────────────────────────────────────────────────────────

        let velocidadCascada: number;

        if (kmAncla === 0 && (puntos.find(p => p.km === -36)?.hora_real || horaApertura)) {
            // Velocidad medida en el río (desde Presa hasta KM 0)
            const horaInicio = new Date(puntos.find(p => p.km === -36)?.hora_real || horaApertura || '').getTime();
            const tRealRio = (horaAncla - horaInicio) / 1000;
            const vRioMedida = DISTANCIA_RIO_M / Math.max(tRealRio, 1);
            const vRioTeorica = calcVelocidadRio(qSolicitado);

            if (vRioMedida < V_RIO_MIN || vRioMedida > V_RIO_MAX) {
                console.warn(`⚠️ [LlenadoTracker] Velocidad río fuera de rango: ${vRioMedida.toFixed(2)} m/s (esperado ${V_RIO_MIN}–${V_RIO_MAX} m/s). Verifique el timestamp de apertura.`);
                toast.warning(`⚠️ Velocidad de onda en río (${vRioMedida.toFixed(2)} m/s) fuera del rango esperado ${V_RIO_MIN}–${V_RIO_MAX} m/s. Verifique el timestamp.`);
            }
            console.log(`📐 Velocidad real río: ${vRioMedida.toFixed(2)} m/s (teórica: ${vRioTeorica.toFixed(2)} m/s)`);

            // IMPORTANTE: río y canal tienen dinámicas distintas — la velocidad del
            // tránsito fluvial no es representativa de la onda en el canal.
            // Para la cascada canal se usa la celeridad hidráulica calculada en KM 0.
            velocidadCascada = calcVelocidadOndaCanal(0, qSolicitado, perfilCanal);
            console.log(`📐 [Cascada canal] Velocidad de onda en KM 0: ${velocidadCascada.toFixed(2)} m/s (calculada con geometría real, no extrapolada del río)`);

        } else {
            // Velocidad medida en el canal (tramo entre puntos confirmados)
            const confirmadosAnteriores = puntos
                .filter(p => p.km < kmAncla && p.hora_real)
                .sort((a, b) => b.km - a.km);

            const puntoAnterior = confirmadosAnteriores[0];
            if (puntoAnterior?.hora_real) {
                const distTramo = (kmAncla - puntoAnterior.km) * 1000; // metros
                const tTramo = (horaAncla - new Date(puntoAnterior.hora_real).getTime()) / 1000;
                const vMedida = distTramo / Math.max(tTramo, 1);

                // Advertir si el valor cae fuera del rango físico del canal
                if (vMedida < V_CANAL_MIN || vMedida > V_CANAL_MAX) {
                    console.warn(`⚠️ [LlenadoTracker] Velocidad canal fuera de rango: ${vMedida.toFixed(2)} m/s → corregida a [${V_CANAL_MIN}, ${V_CANAL_MAX}] m/s`);
                    toast.warning(`⚠️ Velocidad de onda en canal (${vMedida.toFixed(2)} m/s) fuera del rango ${V_CANAL_MIN}–${V_CANAL_MAX} m/s. ETAs recalculadas con valor corregido.`);
                }

                // Advertir si la desviación respecto al modelo teórico es significativa
                const vTeoricaTramo = calcVelocidadOndaCanal(kmAncla, qSolicitado, perfilCanal);
                const desviacionPct = Math.abs(vMedida - vTeoricaTramo) / vTeoricaTramo * 100;
                if (desviacionPct > 40) {
                    console.warn(`⚠️ [LlenadoTracker] Velocidad medida (${vMedida.toFixed(2)} m/s) se desvía ${desviacionPct.toFixed(0)}% de la teórica (${vTeoricaTramo.toFixed(2)} m/s en KM ${kmAncla}). Posible error de captura.`);
                }

                velocidadCascada = Math.max(V_CANAL_MIN, Math.min(V_CANAL_MAX, vMedida));
                console.log(`📐 Velocidad real canal (${puntoAnterior.punto_nombre} → ${puntoConfirmado.punto_nombre}): ${vMedida.toFixed(2)} m/s → usando ${velocidadCascada.toFixed(2)} m/s`);
            } else {
                // Sin punto anterior confirmado: calcular con geometría del tramo actual
                velocidadCascada = calcVelocidadOndaCanal(kmAncla, qSolicitado, perfilCanal);
                console.log(`📐 Velocidad de onda en KM ${kmAncla}: ${velocidadCascada.toFixed(2)} m/s (geometría hidráulica, sin confirmación anterior)`);
            }
        }

        // Recalcular ETAs posteriores
        console.log(`🔄 [Cascada] Recalculando ${posteriores.length} puntos desde ${puntoConfirmado.punto_nombre} a ${velocidadCascada.toFixed(2)} m/s`);
        for (const p of posteriores) {
            const distRestante = (p.km - kmAncla) * 1000; // metros
            const tRestante = distRestante / velocidadCascada; // segundos
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
    }, [puntos, horaApertura, qSolicitado, perfilCanal, fetchPuntos]);

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

    // --- Telemetría Extendida (Modelación de Información) ---
    const telemetria: LlenadoTelemetry = (() => {
        const tTotal = horaApertura ? Math.max(1, (Date.now() - new Date(horaApertura).getTime()) / 1000) : 0;
        const km0 = puntos.find(p => p.km === 0);
        const tDesdeKm0 = (km0?.hora_real) ? Math.max(0, (Date.now() - new Date(km0.hora_real).getTime()) / 1000) : 0;
        
        // Distancia total desde el origen (KM -36)
        const distTotalKm = puntoAncla ? (puntoAncla.km + 36) : 0;
        const vPromMS = tTotal > 0 ? (distTotalKm * 1000) / tTotal : 0;
        
        // Porcentaje de avance (Río 36km + Canal 104km = 140km total)
        const totalCuencaKm = 140;
        const pctAvance = (distTotalKm / totalCuencaKm) * 100;

        // Volumen inyectado (Q * t)
        const volMm3 = (qSolicitado * tTotal) / 1000000;

        return {
            velocidad_promedio_m_s: vPromMS,
            velocidad_promedio_km_h: vPromMS * 3.6,
            tiempo_desde_km0_s: tDesdeKm0,
            distancia_recorrida_km: distTotalKm,
            avance_porcentaje: pctAvance,
            volumen_estimado_inyectado_mm3: volMm3
        };
    })();

    return {
        puntos,
        estadoGeneral,
        puntoAncla,
        telemetria,
        loading,
        confirmarArribo,
        calcularETAs,
        refresh: fetchPuntos,
        syncTelemetry
    };
};
