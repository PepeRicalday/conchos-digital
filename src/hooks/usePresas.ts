import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useMetadataStore } from '../store/useMetadataStore';
import { getStartOfDateISO, getTodayString } from '../utils/dateHelpers';
import { onTable } from '../lib/realtimeHub';
import { agregarAlmacenamiento, calcularFrescura, lecturaMasReciente } from '../utils/presaMetrics';

// ─── Types ───────────────────────────────────────────
export interface PresaData {
    id: string;
    nombre: string;
    nombre_corto: string;
    codigo: string;
    rio: string;
    municipio: string;
    tipo_cortina: string;
    latitud: number;
    longitud: number;
    elevacion_corona_msnm: number;
    capacidad_max_mm3: number;
    // Lectura del día (o más reciente disponible)
    lectura: LecturaPresaData | null;
    // Curva EAC
    curva_capacidad: PuntoCurva[];
}

export interface LecturaPresaData {
    fecha: string;
    /**
     * Nivel/volumen: `null` = SIN DATO, distinto de 0 = medición de cero.
     * SICA Capture no captura estas columnas hoy; llegan nulas de la BD y no
     * deben colapsarse a 0 — ver src/utils/presaMetrics.ts.
     */
    escala_msnm: number | null;
    almacenamiento_mm3: number | null;
    porcentaje_llenado: number | null;
    extraccion_total_m3s: number;
    gasto_toma_baja_m3s: number | null;
    gasto_cfe_m3s: number | null;
    gasto_toma_izq_m3s: number | null;
    gasto_toma_der_m3s: number | null;
    area_ha: number;
    responsable: string | null;
    notas: string | null;
    // Variación en metros vs. la lectura de nivel anterior — null si no hay
    // elevación de hoy o no hay lectura previa con la que comparar.
    variacion_elevacion_m: number | null;
}

export interface PuntoCurva {
    elevacion_msnm: number;
    volumen_mm3: number;
    area_ha: number;
}

export interface ClimaPresaData {
    presa_id: string;
    fecha: string;
    temp_ambiente_c: number | null;
    temp_maxima_c: number | null;
    temp_minima_c: number | null;
    precipitacion_mm: number | null;
    evaporacion_mm: number | null;
    dir_viento: string | null;
    intensidad_viento: string | null;
    visibilidad: string | null;
    edo_tiempo: string | null;
    edo_tiempo_24h: string | null;
    dir_viento_24h: string | null;
    intensidad_24h: string | null;
}

export interface AforoDiarioData {
    estacion: string;
    fecha: string;
    escala: number | null;
    gasto_m3s: number | null;
}

export interface MovimientoPresaData {
    id: string;
    presa_id: string;
    fecha_hora: string;
    gasto_m3s: number;
    fuente_dato: string;
    // Desglose por obra de toma — null en movimientos legacy (un solo total).
    gasto_toma_baja_m3s?: number | null;
    gasto_cfe_m3s?: number | null;
    gasto_toma_izq_m3s?: number | null;
    gasto_toma_der_m3s?: number | null;
    // Posición de compuerta por obra (ej. {"tomaBaja": "1/10"}) — solo trazabilidad.
    posiciones_compuerta?: Record<string, string> | null;
}

// ─── Hook ────────────────────────────────────────────
export function usePresas(fecha: string) {
    const [presas, setPresas] = useState<PresaData[]>([]);
    const [clima, setClima] = useState<ClimaPresaData[]>([]);
    const [aforos, setAforos] = useState<AforoDiarioData[]>([]);
    const [movimientos, setMovimientos] = useState<MovimientoPresaData[]>([]);
    const [movimientosHistorial, setMovimientosHistorial] = useState<MovimientoPresaData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function fetchData() {
            try {
                setLoading(true);
                setError(null);

                const metaStore = useMetadataStore.getState();
                if (!metaStore.last_fetched) await metaStore.fetchMetadata();

                // 1. Parallel Fetch of all primary dynamic data sources
                const [
                    { data: lecturasDB, error: errL },
                    { data: climaDB, error: errC },
                    { data: aforosDB, error: errA },
                    { data: eventDBRaw },
                    { data: movsDB },
                    { data: movsHistorialDB },
                    { data: lecturasPreviasDB }
                ] = await Promise.all([
                    supabase.from('lecturas_presas').select('*').eq('fecha', fecha),
                    supabase.from('clima_presas').select('*').eq('fecha', fecha),
                    supabase.from('aforos_principales_diarios').select('*').eq('fecha', fecha),
                    // Ordena por fecha_inicio: sica_eventos_log no tiene columna
                    // creado_en, y pedirla devolvía 400 en cada carga de la página.
                    supabase.from('sica_eventos_log').select('*').eq('esta_activo', true).order('fecha_inicio', { ascending: false }).limit(1),
                    supabase.from('movimientos_presas').select('*')
                        // P1-6: end-of-day computed in America/Chihuahua to handle CDT↔CST transitions
                        .lte('fecha_hora', new Date(new Date(getStartOfDateISO(fecha)).getTime() + 86400000 - 1).toISOString())
                        .order('fecha_hora', { ascending: false })
                        .limit(100),
                    // 7-day historial ascendente — para streamgraph, no afecta lógica Capa 2
                    supabase.from('movimientos_presas').select('id, presa_id, fecha_hora, gasto_m3s, fuente_dato')
                        .gte('fecha_hora', new Date(Date.now() - 7 * 86400000).toISOString())
                        .order('fecha_hora', { ascending: true })
                        .limit(500),
                    // Lectura de nivel más reciente ANTERIOR a `fecha`, por presa. Sirve para
                    // dos cosas: (1) calcular la variación real en cm (reemplaza el regex
                    // sobre notas), y (2) arrastrar el último nivel conocido cuando la fila
                    // de HOY existe (ej. porque ya se capturó el gasto) pero sin nivel — el
                    // nivel se captura por separado y no siempre el mismo día que el gasto.
                    supabase.from('lecturas_presas').select('presa_id, fecha, escala_msnm, almacenamiento_mm3, porcentaje_llenado')
                        .lt('fecha', fecha)
                        .not('escala_msnm', 'is', null)
                        .order('fecha', { ascending: false })
                        .limit(60)
                ]);

                const eventDB = eventDBRaw && eventDBRaw.length > 0 ? eventDBRaw[0] : null;

                if (errL) throw errL;
                if (errC) throw errC;
                if (errA) throw errA;

                const presasDB = metaStore.presas;


                // 2. Fallback logic for missing data (Sequential only if necessary)
                let finalLecturas = lecturasDB;
                if (!finalLecturas || finalLecturas.length === 0) {
                    const { data: fallback, error: errFb } = await supabase
                        .from('lecturas_presas')
                        .select('*')
                        .lte('fecha', fecha)
                        .order('fecha', { ascending: false })
                        .limit(2);
                    if (errFb) throw errFb;
                    finalLecturas = fallback;
                }

                let finalClima = climaDB;
                if (!finalClima || finalClima.length === 0) {
                    const { data: climaFb } = await supabase
                        .from('clima_presas')
                        .select('*')
                        .lte('fecha', fecha)
                        .order('fecha', { ascending: false })
                        .limit(3);
                    finalClima = climaFb || [];
                }


                if (cancelled) return;

                // Index lecturas by presa_id
                const lecturaMap: Record<string, any> = {};
                (finalLecturas || []).forEach((l: any) => {
                    lecturaMap[l.presa_id] = l;
                });

                // Index lectura previa (más reciente antes de `fecha`) por presa_id —
                // ya viene ordenada desc, así que la primera que aparece por presa es la más reciente.
                const lecturaPreviaMap: Record<string, { escala_msnm: number; almacenamiento_mm3: number | null; porcentaje_llenado: number | null }> = {};
                (lecturasPreviasDB || []).forEach((l: any) => {
                    if (lecturaPreviaMap[l.presa_id] === undefined && l.escala_msnm != null) {
                        lecturaPreviaMap[l.presa_id] = {
                            escala_msnm: Number(l.escala_msnm),
                            almacenamiento_mm3: l.almacenamiento_mm3 != null ? Number(l.almacenamiento_mm3) : null,
                            porcentaje_llenado: l.porcentaje_llenado != null ? Number(l.porcentaje_llenado) : null,
                        };
                    }
                });

                // ─── JERARQUÍA DE FUENTES DE DATOS (gasto / extracción) ──────────────
                //
                // El valor de extraccion_total_m3s que se muestra en UI sigue esta cascada
                // de prioridad DESCENDENTE. Cada capa sobreescribe a la anterior:
                //
                //  CAPA 1 — lecturas_presas (LÍNEA BASE)
                //    Reporte diario capturado por el operador de campo.
                //    Fuente: tabla lecturas_presas, columna extraccion_total_m3s.
                //    Limitación: se captura una vez al día; puede no reflejar cambios
                //    intradía ni operaciones de fin de ciclo sin reporte formal.
                //
                //  CAPA 2 — movimientos_presas (CONTINUIDAD OPERATIVA)
                //    Último movimiento registrado (INSERT reciente en movimientos_presas).
                //    Sobreescribe el reporte diario si existe un movimiento más reciente.
                //    Fundamento: el gasto de una presa no cambia hasta que hay un nuevo
                //    movimiento explícito — principio de continuidad hidráulica.
                //    Limitación: la query usa offset fijo -06:00 (CDT). Ver P1-6.
                //
                //  CAPA 3 — sica_eventos_log / Protocolo Activo (SOLO SIN MEDICIÓN POSTERIOR)
                //    Solo aplica a Presa La Boquilla (PRE-001 / PLB).
                //    Si hay un protocolo activo, el gasto toma el valor
                //    gasto_solicitado_m3s del evento (o 34 m³/s por defecto en LLENADO).
                //
                //    CONDICIÓN DE VIGENCIA: el gasto solicitado es una INSTRUCCIÓN, no una
                //    medición. Solo prevalece mientras no exista un movimiento de campo
                //    POSTERIOR al inicio del protocolo. En cuanto el operador mide y registra
                //    en movimientos_presas, esa medición gana — la instrucción ya fue
                //    ejecutada y verificada en campo.
                //
                //    Sin esta condición, un protocolo abierto y no cerrado congela el valor
                //    mostrado indefinidamente: el evento ESTABILIZACION del 2026-03-17
                //    (gasto_solicitado 28) mantuvo la UI en 28 m³/s durante 124 días mientras
                //    el gasto real medido osciló entre 25.5 y 37.5 m³/s.
                //
                // ─────────────────────────────────────────────────────────────────────

                // Transform
                const result: PresaData[] = (presasDB || []).map((p: any) => {
                    const lect = lecturaMap[p.id];
                    const curva = (p.curvas_capacidad || [])
                        .sort((a: any, b: any) => Number(a.elevacion_msnm) - Number(b.elevacion_msnm))
                        .map((c: any) => ({
                            elevacion_msnm: Number(c.elevacion_msnm),
                            volumen_mm3: Number(c.volumen_mm3),
                            area_ha: Number(c.area_ha),
                        }));

                    // ── CAPA 1: Línea base del reporte diario ──
                    const latestMov = (movsDB || []).find((m: any) => m.presa_id === p.id);
                    // Último movimiento de ESTA presa que sí trae desglose por obra —
                    // puede no ser `latestMov` si el movimiento más reciente se capturó
                    // como total único (formulario viejo, o gasto_m3s de fin de ciclo).
                    // Una obra sigue en el mismo gasto hasta que se reporte lo contrario:
                    // sin este fallback, un movimiento-total nuevo hacía desaparecer el
                    // desglose de CFE/Toma Baja aunque nada haya cambiado en esas obras.
                    const latestMovConDesglose = (movsDB || []).find((m: any) =>
                        m.presa_id === p.id && (
                            m.gasto_toma_baja_m3s != null || m.gasto_cfe_m3s != null ||
                            m.gasto_toma_izq_m3s != null || m.gasto_toma_der_m3s != null
                        )
                    );
                    let extraccion = Number(lect?.extraccion_total_m3s) || 0;
                    let notas = lect?.notas || null;
                    let dataSource = lect ? 'lecturas_presas' : 'sin_lectura';

                    // ── CAPA 2: Continuidad operativa (último movimiento) ──
                    if (latestMov) {
                        extraccion = Number(latestMov.gasto_m3s);
                        dataSource = `movimientos_presas (${latestMov.fuente_dato ?? 'manual'})`;
                    }

                    // ── CAPA 3: Protocolo activo Hidro-Sincro (solo Boquilla) ──
                    const isBoquilla = p.id === 'PRE-001' || p.codigo === 'PLB' ||
                                     p.nombre_corto?.toUpperCase().includes('BOQUILLA') ||
                                     p.nombre?.toUpperCase().includes('BOQUILLA');

                    if (isBoquilla && eventDB && eventDB.esta_activo) {
                        const solicitado = Number(eventDB.gasto_solicitado_m3s);

                        // ¿Hay medición de campo POSTERIOR al inicio del protocolo?
                        // Si la hay, la instrucción ya fue ejecutada y verificada: la
                        // medición manda y el solicitado deja de aplicar.
                        const inicioProtocolo = eventDB.fecha_inicio
                            ? new Date(eventDB.fecha_inicio).getTime()
                            : null;
                        const fechaMov = latestMov?.fecha_hora
                            ? new Date(latestMov.fecha_hora).getTime()
                            : null;
                        const hayMedicionPosterior =
                            fechaMov != null && inicioProtocolo != null && fechaMov > inicioProtocolo;

                        // Si es LLENADO o hay un gasto específico solicitado, lo forzamos —
                        // salvo que exista medición de campo posterior al protocolo.
                        if ((eventDB.evento_tipo === 'LLENADO' || solicitado > 0) && !hayMedicionPosterior) {
                            const gastoFinal = solicitado > 0 ? solicitado : 34; // Default 34 si es LLENADO
                            extraccion = gastoFinal;
                            notas = (notas ? notas + ' | ' : '') + `[PROTOCOL-ACTIVE]: ${eventDB.evento_tipo} (${gastoFinal} m³/s)`;
                            dataSource = `sica_eventos_log (${eventDB.evento_tipo})`;
                        } else if (hayMedicionPosterior && solicitado > 0 && Math.abs(extraccion - solicitado) > 0.01) {
                            // La medición de campo difiere de lo solicitado: se conserva la
                            // medición (ya asignada en Capa 2) y se deja constancia de la
                            // desviación para trazabilidad operativa.
                            notas = (notas ? notas + ' | ' : '') +
                                `[PROTOCOL-SUPERSEDED]: ${eventDB.evento_tipo} solicitó ${solicitado} m³/s; ` +
                                `medición de campo ${extraccion} m³/s (${latestMov.fecha_hora}) prevalece.`;
                        }
                    }

                    console.debug(`[usePresas] ${p.nombre_corto ?? p.id} → fuente: ${dataSource} | extracción: ${extraccion} m³/s`);

                    // Nivel y gasto se capturan por separado y no siempre el mismo día
                    // (ej. hoy se reportó solo el movimiento de compuertas; el nivel del
                    // embalse fue de ayer). Si la fila de `fecha` no trae elevación, se
                    // arrastra la última conocida — igual que ya se hace con el gasto vía
                    // movimientos_presas. Sin esto, un día con solo gasto capturado volvía
                    // a mostrar "S/D" aunque el nivel real siguiera siendo el de ayer.
                    const nivelPrevio = lecturaPreviaMap[p.id];
                    const tieneNivelHoy = lect?.escala_msnm != null;

                    // Construimos el objeto lectura garantizando que el gasto aparezca aunque no haya reporte diario
                    // (Útil para fines de ciclo o días feriados donde no se captura escala pero sí hay gasto)
                    const readingObject = (lect || latestMov || nivelPrevio) ? {
                        fecha: lect?.fecha || latestMov?.fecha_hora?.split('T')[0] || fecha,
                        // "S/D nunca cero": se preserva null cuando ni hoy ni una lectura
                        // anterior traen el dato. `Number(null) || 0` daba 0 y volvía
                        // indistinguible un embalse vacío de uno sin lectura capturada.
                        escala_msnm: tieneNivelHoy ? Number(lect.escala_msnm) : (nivelPrevio?.escala_msnm ?? null),
                        almacenamiento_mm3: tieneNivelHoy && lect?.almacenamiento_mm3 != null ? Number(lect.almacenamiento_mm3) : (nivelPrevio?.almacenamiento_mm3 ?? null),
                        porcentaje_llenado: tieneNivelHoy && lect?.porcentaje_llenado != null ? Number(lect.porcentaje_llenado) : (nivelPrevio?.porcentaje_llenado ?? null),
                        extraccion_total_m3s: extraccion,
                        // Desglose por obra de toma — cascada: Capa 1 (lecturas_presas) →
                        // Capa 2 (último movimiento, si trae desglose) → último movimiento
                        // CON desglose aunque sea de un día anterior (una obra sigue en el
                        // mismo gasto hasta que se reporte lo contrario — no puede
                        // "olvidarse" solo porque el movimiento más reciente fue un total
                        // único) → regla legado SOLO para Boquilla cuando NINGUNA fuente
                        // trae desglose real: antes de que sica-capture reportara por obra,
                        // un movimiento traía un solo número y se asumía completo en Toma
                        // Baja. Con desglose real en cualquier capa anterior, esa regla ya
                        // no aplica y CFE deja de fantasmear en 0.00/CERRADA.
                        gasto_toma_baja_m3s: lect?.gasto_toma_baja_m3s != null ? Number(lect.gasto_toma_baja_m3s)
                            : latestMov?.gasto_toma_baja_m3s != null ? Number(latestMov.gasto_toma_baja_m3s)
                            : latestMovConDesglose?.gasto_toma_baja_m3s != null ? Number(latestMovConDesglose.gasto_toma_baja_m3s)
                            : (p.id === 'PRE-001' && extraccion > 0 && !latestMovConDesglose ? extraccion : null),
                        gasto_cfe_m3s: lect?.gasto_cfe_m3s != null ? Number(lect.gasto_cfe_m3s)
                            : latestMov?.gasto_cfe_m3s != null ? Number(latestMov.gasto_cfe_m3s)
                            : latestMovConDesglose?.gasto_cfe_m3s != null ? Number(latestMovConDesglose.gasto_cfe_m3s) : null,
                        gasto_toma_izq_m3s: lect?.gasto_toma_izq_m3s != null ? Number(lect.gasto_toma_izq_m3s)
                            : latestMov?.gasto_toma_izq_m3s != null ? Number(latestMov.gasto_toma_izq_m3s)
                            : latestMovConDesglose?.gasto_toma_izq_m3s != null ? Number(latestMovConDesglose.gasto_toma_izq_m3s) : null,
                        gasto_toma_der_m3s: lect?.gasto_toma_der_m3s != null ? Number(lect.gasto_toma_der_m3s)
                            : latestMov?.gasto_toma_der_m3s != null ? Number(latestMov.gasto_toma_der_m3s)
                            : latestMovConDesglose?.gasto_toma_der_m3s != null ? Number(latestMovConDesglose.gasto_toma_der_m3s) : null,
                        area_ha: Number(lect?.area_ha) || 0,
                        responsable: lect?.responsable || (latestMov ? 'Sistema (Movimiento)' : null),
                        notas: notas,
                        // Variación real vs. la lectura de nivel anterior — reemplaza el
                        // regex "Dif Elev: Xm" sobre notas (texto libre, frágil). null si
                        // no hay elevación de HOY (arrastrar el nivel de ayer no cuenta como
                        // variación) o no hay lectura previa con la que comparar.
                        variacion_elevacion_m: (tieneNivelHoy && nivelPrevio !== undefined)
                            ? Number(lect.escala_msnm) - nivelPrevio.escala_msnm
                            : null,
                    } : null;

                    return {
                        id: p.id,
                        nombre: p.nombre,
                        nombre_corto: p.nombre_corto || '',
                        codigo: p.codigo,
                        rio: p.rio || '',
                        municipio: p.municipio || '',
                        tipo_cortina: p.tipo_cortina || '',
                        latitud: Number(p.latitud) || 0,
                        longitud: Number(p.longitud) || 0,
                        elevacion_corona_msnm: Number(p.elevacion_corona_msnm) || 0,
                        capacidad_max_mm3: Number(p.capacidad_max),
                        lectura: readingObject,
                        curva_capacidad: curva,
                    };
                });

                setPresas(result);
                setClima((finalClima || []).map((c: any) => ({
                    presa_id: c.presa_id,
                    fecha: c.fecha,
                    temp_ambiente_c: c.temp_ambiente_c != null ? Number(c.temp_ambiente_c) : null,
                    temp_maxima_c: c.temp_maxima_c != null ? Number(c.temp_maxima_c) : null,
                    temp_minima_c: c.temp_minima_c != null ? Number(c.temp_minima_c) : null,
                    precipitacion_mm: c.precipitacion_mm != null ? Number(c.precipitacion_mm) : null,
                    evaporacion_mm: c.evaporacion_mm != null ? Number(c.evaporacion_mm) : null,
                    dir_viento: c.dir_viento,
                    intensidad_viento: c.intensidad_viento,
                    visibilidad: c.visibilidad,
                    edo_tiempo: c.edo_tiempo,
                    edo_tiempo_24h: c.edo_tiempo_24h,
                    dir_viento_24h: c.dir_viento_24h,
                    intensidad_24h: c.intensidad_24h,
                })));
                setAforos((aforosDB || []).map((a: any) => ({
                    estacion: a.estacion,
                    fecha: a.fecha,
                    escala: a.escala != null ? Number(a.escala) : null,
                    gasto_m3s: a.gasto_m3s != null ? Number(a.gasto_m3s) : null
                })));
                setMovimientos(movsDB || []);
                setMovimientosHistorial(movsHistorialDB || []);

            } catch (err: any) {
                if (!cancelled) {
                    console.error('usePresas Error:', err);
                    setError(err.message);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        fetchData();

        // C-3: Realtime via centralized hub (no direct channel — see realtimeHub.ts)
        const unsubLecturas   = onTable('lecturas_presas',   '*', () => { console.log('🏔️ Lectura de presa actualizada. Refrescando...'); fetchData(); });
        const unsubMovs       = onTable('movimientos_presas','*', () => { console.log('💧 Movimiento de presa detectado. Sincronizando gasto...'); fetchData(); });
        const unsubEventos    = onTable('sica_eventos_log',  '*', () => { console.log('📢 Protocolo hidráulico actualizado (EventLog). Refrescando...'); fetchData(); });

        // C-5: Refetch when tab becomes visible again
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') fetchData();
        };
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            cancelled = true;
            unsubLecturas();
            unsubMovs();
            unsubEventos();
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [fecha]);

    // Derived values — agregación vía módulo compartido (ver presaMetrics.ts).
    // Excluye presas sin lectura en lugar de contarlas como 0: incluirlas metía
    // su capacidad en el denominador y hundía el porcentaje a 0.0%.
    const almacenamiento = agregarAlmacenamiento(presas);
    const totalAlmacenamiento = almacenamiento.totalMm3;
    const totalCapacidad = almacenamiento.capacidadCatalogoMm3;
    // Calculamos el volumen total extraído proyectado para el día (en Millores de m3)
    const totalVolumenExtraidoMm3 = presas.reduce((acc, p) => {
        const flow = p.lectura?.extraccion_total_m3s || 0;
        // Si estamos viendo hoy, calculamos el volumen acumulado hasta este segundo
        const isTodayReq = fecha === getTodayString();
        
        if (isTodayReq) {
            // P1-6: startOfDay uses America/Chihuahua midnight, not browser-local midnight
            const secondsElapsed = (Date.now() - new Date(getStartOfDateISO(fecha)).getTime()) / 1000;
            return acc + (flow * secondsElapsed / 1000000);
        } else {
            // Para días pasados, asumimos el gasto constante por 24h
            return acc + (flow * 24 * 3600 / 1000000);
        }
    }, 0);
    const totalExtraccion = presas.reduce((acc, p) => acc + (p.lectura?.extraccion_total_m3s || 0), 0);
    const porcentajeLlenado = almacenamiento.porcentaje;

    // Vigencia de la lectura más reciente — para el sello de frescura en UI.
    const frescuraLectura = calcularFrescura(lecturaMasReciente(presas));

    return {
        presas,
        clima,
        aforos,
        movimientos,
        movimientosHistorial,
        loading,
        error,
        // Aggregates — `null` significa SIN DATO, nunca 0.
        totalAlmacenamiento,
        totalCapacidad,
        totalExtraccion,
        totalVolumenExtraidoMm3,
        porcentajeLlenado,
        /** Detalle de cobertura: cuántas presas aportaron dato y si es parcial. */
        almacenamiento,
        frescuraLectura,
    };
};
