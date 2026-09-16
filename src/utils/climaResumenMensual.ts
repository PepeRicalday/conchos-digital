// ═══════════════════════════════════════════════════════════════════════════
// Resumen mensual de estaciones climáticas — SICA-005
// ---------------------------------------------------------------------------
// Consulta fn_clima_resumen_mensual (RPC, migración 2026-09-12) y construye
// un EstacionConLectura[] SINTÉTICO donde `lectura` trae el promedio (temp,
// viento, radiación) o ACUMULADO (lluvia — nunca promedio, ver la función
// SQL) del mes elegido en vez de la última lectura real. Con esto,
// exportClimaGeoInforme.ts (raster IDW, tablas, resumen ejecutivo) funciona
// SIN CAMBIOS sobre datos de periodo: todo el generador ya opera sobre
// EstacionConLectura[], no le importa si el número viene de un instante o de
// un mes agregado.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from '../lib/supabase';
import type { EstacionConLectura, EstacionClima, LecturaClima } from '../hooks/useClimaEstaciones';
import type { DiagnosticoCielo } from './cielo';
export { nombreMes } from './nombreMes';

/** El resumen mensual no reconstruye historial de nubosidad — el generador
 *  del informe geoclimático no consume `cielo` en absoluto, así que se
 *  declara "no determinado" de forma explícita en vez de omitir el campo. */
const CIELO_NO_DETERMINADO: DiagnosticoCielo = {
    estado: 'no_determinado', etiqueta: 'No determinado', icono: '', color: '#94a3b8',
    coberturaPct: null, procedencia: 'ninguna', confianzaPct: 0, confianzaEtiqueta: 'No concluyente',
    evidencia: [], discrepancias: [], nota: 'Resumen mensual: sin serie de nubosidad.',
};

export interface MesDisponible {
    anio: number;
    mes: number; // 1-12
    nLecturas: number;
}

/** Meses con al menos una lectura real — para poblar el selector sin ofrecer
 *  meses vacíos (ver fn_clima_meses_disponibles). */
export async function obtenMesesDisponibles(): Promise<MesDisponible[]> {
    const { data, error } = await supabase.rpc('fn_clima_meses_disponibles');
    if (error || !data) return [];
    return (data as any[]).map(r => ({ anio: r.anio, mes: r.mes, nLecturas: Number(r.n_lecturas) }));
}

/** Fecha (YYYY-MM-DD) de la lectura MÁS ANTIGUA de toda la red — cacheada en
 *  el módulo porque no cambia durante la sesión (el pasado no se reescribe) y
 *  varias llamadas a estacionesDesdeResumenMensual/obtenSerieMensual en el
 *  mismo informe no necesitan repetir la consulta. Usada por diasEsperados()
 *  para no penalizar el primer mes de operación de la red (ver ahí). */
let primerDiaConDatosCache: string | null | undefined;
async function primerDiaConDatos(): Promise<string | null> {
    if (primerDiaConDatosCache !== undefined) return primerDiaConDatosCache;
    const { data, error } = await supabase
        .from('clima_estacion_lecturas')
        .select('ts')
        .order('ts', { ascending: true })
        .limit(1);
    primerDiaConDatosCache = (!error && data?.[0]?.ts) ? String(data[0].ts).slice(0, 10) : null;
    return primerDiaConDatosCache;
}

/** Días a considerar para el umbral de cobertura de un rango [desde, hasta]
 *  (ambas 'YYYY-MM-DD', inclusive): recorta `hasta` a hoy si el rango llega
 *  hasta el futuro/hoy (un periodo que aún no termina no puede pedir
 *  cobertura de días que todavía no ocurren), y recorta `desde` al `piso`
 *  (fecha de la lectura más antigua de la red) si el rango arranca antes de
 *  que existieran datos.
 *
 * PRIMER MES DE LA RED (ej. julio 2026, red dada de alta el 18): sin este
 * ajuste, un mes que arrancó a mitad de camino se compara contra sus 31 días
 * completos — con solo ~14 días de datos posibles, la cobertura nunca pasa
 * ~45-50% aunque esos 14 días estén perfectamente completos, y el punto se
 * descarta como "no confiable" (hueco en la gráfica) cuando en realidad el
 * dato es bueno, solo cubre menos días porque antes NO EXISTÍA la estación.
 * Generalización de un cálculo por mes calendario a cualquier rango — mismo
 * criterio, aplicado a fechas explícitas en vez de año/mes/últimoDía. */
function diasEsperadosRango(desde: string, hasta: string, piso?: string | null): number {
    const hoyStr = new Date().toISOString().slice(0, 10);
    const desdeEfectivo = piso && piso > desde ? piso : desde;
    const hastaEfectivo = hasta > hoyStr ? hoyStr : hasta;
    const msPorDia = 24 * 60 * 60 * 1000;
    const dias = Math.round((Date.parse(hastaEfectivo) - Date.parse(desdeEfectivo)) / msPorDia) + 1;
    return Math.max(1, dias);
}

/** Compatibilidad: mismo cálculo que diasEsperadosRango, expresado en
 *  año/mes/últimoDía de un mes calendario — usado por estacionesDesdeResumenMensual
 *  y obtenSerieMensual, que operan mes a mes. */
function diasEsperados(anio: number, mes: number, ultimoDia: number, piso?: string | null): number {
    const desde = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
    return diasEsperadosRango(desde, hasta, piso);
}

interface FilaResumenMensual {
    estacion_id: string;
    estacion_nombre: string;
    n_muestras: number;
    temp_c_prom: number | null;
    viento_ms_prom: number | null;
    viento_dir_deg_dominante: number | null;
    rad_solar_wm2_prom: number | null;
    lluvia_mm_acumulada: number | null;
    dia_max_lluvia_fecha: string | null;
    dia_max_lluvia_mm: number | null;
}

/** Día de mayor lámina registrada dentro de un rango, por estación — para el
 *  informe geoclimático bajo periodo, donde "cuánto acumuló" no distingue un
 *  evento fuerte de lluvia repartida en varios días (operativamente muy
 *  distintos: infiltración/escorrentía). NO es un campo de `LecturaClima`
 *  (ese tipo es de una lectura real de estación, no de un derivado de rango)
 *  — se expone aparte, igual que `serieMensual`, para no forzar semántica de
 *  periodo dentro de un tipo pensado para instante. */
export interface DiaMaxLluvia {
    fecha: string | null;
    mm: number | null;
}

/**
 * Trae el resumen agregado de un rango de fechas arbitrario [desde, hasta]
 * ('YYYY-MM-DD', inclusive) para las estaciones dadas (se usa
 * `estacionesBase` para heredar lat/lon/rol/nombre — el RPC no conoce
 * geografía, solo agrega lecturas) y arma un EstacionConLectura[] sintético
 * listo para exportClimaGeoInforme — el mismo tipo que consume el resto del
 * generador del informe, sin importarle si el número viene de un instante o
 * de un periodo agregado (ver cabecera del archivo).
 *
 * n_muestras se traduce a una etiqueta de confiabilidad simple: por debajo
 * de 60% de las muestras esperadas para la duración del rango (con la
 * cadencia ~13 lecturas/día de la red) se marca como confiabilidad reducida
 * en `calidad.etiqueta`, siguiendo el mismo principio de nunca presentar un
 * promedio pobre con la misma confianza visual que uno robusto.
 */
export async function estacionesDesdeResumenRango(
    estacionesBase: EstacionConLectura[], desde: string, hasta: string,
): Promise<{ estaciones: EstacionConLectura[]; diaMaxLluviaPorId: Map<string, DiaMaxLluvia> }> {
    const { data, error } = await supabase.rpc('fn_clima_resumen_mensual', { p_desde: desde, p_hasta: hasta });
    if (error) throw new Error(`No se pudo obtener el resumen del periodo: ${error.message}`);
    const filas = (data ?? []) as FilaResumenMensual[];
    const porId = new Map(filas.map(f => [f.estacion_id, f]));
    const diaMaxLluviaPorId = new Map<string, DiaMaxLluvia>(
        filas.map(f => [f.estacion_id, { fecha: f.dia_max_lluvia_fecha, mm: f.dia_max_lluvia_mm }]),
    );

    // Umbral de muestras esperadas para el rango con la cadencia actual de
    // sync (~13/día) — por debajo de 60% se marca la confiabilidad como
    // reducida (periodo en curso, estación intermitente). diasEsperadosRango()
    // usa días TRANSCURRIDOS, no el total nominal del rango, para que un
    // periodo que aún no termina (o que arranca antes del alta de la red) no
    // penalice a estaciones con cobertura completa de sus días reales.
    const piso = await primerDiaConDatos();
    const muestrasEsperadas = diasEsperadosRango(desde, hasta, piso) * 13;

    const estaciones = estacionesBase.map((e): EstacionConLectura => {
        const f = porId.get(e.id);
        const base: EstacionClima = {
            id: e.id, station_id: e.station_id, nombre: e.nombre,
            latitud: e.latitud, longitud: e.longitud, elevacion_msnm: e.elevacion_msnm,
            ciudad: e.ciudad, presa_id: e.presa_id, modulo_id: e.modulo_id, zona_id: e.zona_id,
            rol: e.rol, activa: e.activa, ult_dato_en: e.ult_dato_en,
        };
        if (!f || f.n_muestras === 0) {
            return {
                ...base, lectura: null, edadHoras: null, enLinea: false,
                calidad: { status: 'expired', flags: ['missing'], edadMin: null, usableComoActual: false, etiqueta: 'SIN DATOS EN EL PERIODO', color: '#94a3b8' },
                pronostico: null, pronosticoSerie: [],
                cielo: CIELO_NO_DETERMINADO,
                nubosidadEstPct: null, clearnessIndex: null,
            };
        }
        const cobertura = f.n_muestras / muestrasEsperadas;
        const confiable = cobertura >= 0.6;
        // OJO al leer `lluvia_dia_mm` de este objeto sintético: aquí NO es
        // "la lluvia de hoy" (esa es su semántica en una lectura real de
        // useClimaEstaciones) — es el ACUMULADO de TODO el rango [desde,
        // hasta], igual que lluvia_mes_mm (mismo valor, a propósito: no hay
        // un campo separado en LecturaClima para "acumulado de periodo
        // arbitrario"). `lluvia_24h_mm`/`lluvia_anio_mm` quedan null a
        // propósito: son contadores nativos de la consola WeatherLink que no
        // tienen significado físico para un rango arbitrario elegido en el
        // modal (ver tablaPrecipitacion.ts, que por esto usa un modo de
        // columnas distinto bajo periodo). Cualquier código nuevo que lea
        // `lectura.lluvia_dia_mm` asumiendo "hoy" se romperá silenciosamente
        // si el objeto viene de aquí — revisar `calidad.status` primero para
        // saber si el origen es un instante real o este agregado.
        const lectura: LecturaClima = {
            estacion_id: e.id, station_id: e.station_id, fecha: hasta, ts: `${hasta}T23:59:59Z`,
            temp_c: f.temp_c_prom, temp_max_c: null, temp_min_c: null, hum_rel_pct: null,
            punto_rocio_c: null, presion_hpa: null, viento_ms: f.viento_ms_prom,
            viento_dir_deg: f.viento_dir_deg_dominante, viento_rafaga_ms: null,
            lluvia_dia_mm: f.lluvia_mm_acumulada, lluvia_24h_mm: null, lluvia_mes_mm: f.lluvia_mm_acumulada,
            lluvia_anio_mm: null, rad_solar_wm2: f.rad_solar_wm2_prom, uv_index: null,
            et_dia_mm: null, et_mes_mm: null, eto_mm: null, gdd: null, bar_trend_hpa: null,
        };
        return {
            ...base, lectura, edadHoras: null, enLinea: true,
            calidad: {
                status: confiable ? 'valid' : 'suspect', flags: confiable ? [] : ['missing'],
                edadMin: null, usableComoActual: true,
                etiqueta: confiable ? `${f.n_muestras} MUESTRAS` : `COBERTURA PARCIAL (${f.n_muestras} muestras)`,
                color: confiable ? '#0ca30c' : '#d98704',
            },
            pronostico: null, pronosticoSerie: [],
            cielo: CIELO_NO_DETERMINADO,
            nubosidadEstPct: null, clearnessIndex: null,
        };
    });
    return { estaciones, diaMaxLluviaPorId };
}

/** Wrapper de estacionesDesdeResumenRango para un mes calendario completo
 *  (1-12, año de 4 dígitos) — mantiene la firma histórica para quien ya la
 *  use, delegando el cálculo real a la versión de rango arbitrario. */
export async function estacionesDesdeResumenMensual(
    estacionesBase: EstacionConLectura[], anio: number, mes: number,
): Promise<{ estaciones: EstacionConLectura[]; diaMaxLluviaPorId: Map<string, DiaMaxLluvia> }> {
    const desde = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const ultimoDia = new Date(anio, mes, 0).getDate();
    const hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
    return estacionesDesdeResumenRango(estacionesBase, desde, hasta);
}

export interface PuntoMensual {
    anio: number;
    mes: number;
    estacionId: string;
    estacionNombre: string;
    tempCProm: number | null;
    vientoMsProm: number | null;
    radSolarWm2Prom: number | null;
    lluviaMmAcumulada: number | null;
    nMuestras: number;
    /** true si este mes es el PRIMERO con datos de toda la red (arrancó a
     *  mitad de mes calendario, ver diasEsperados) — el consumidor (gráfica
     *  de evolución) debe marcarlo como parcial en vez de presentarlo como un
     *  mes calendario completo más. */
    parcial: boolean;
}

/**
 * Serie histórica mes a mes, por estación, para graficar la evolución del
 * promedio (o acumulado, en lluvia) — un RPC por mes disponible (hoy 2-4
 * meses, volumen trivial). Usada por el Informe Geoclimático en modo
 * "mes específico" para mostrar tendencia, no solo el número aislado del
 * mes elegido.
 *
 * Una estación recién dada de alta puede tener un solo punto en el mes en
 * curso (p.ej. de alta hoy mismo, a mediodía): su "promedio" no es un
 * promedio de nada, es esa única lectura instantánea. Mezclado con estaciones
 * que sí tienen el mes completo (día+noche, docenas de lecturas), ese punto
 * dispara la escala de la gráfica y aplana las series reales — mismo umbral
 * de cobertura (60% de lo esperado con la cadencia de sync ~13/día) que ya
 * usa estacionesDesdeResumenMensual arriba para el modo "mes específico"; por
 * debajo de eso el punto se omite (null = hueco en la línea) en vez de
 * mostrarse con la misma confianza visual que un promedio robusto.
 */
export async function obtenSerieMensual(meses: MesDisponible[]): Promise<PuntoMensual[]> {
    const piso = await primerDiaConDatos();
    const resultados = await Promise.all(meses.map(async (m) => {
        const desde = `${m.anio}-${String(m.mes).padStart(2, '0')}-01`;
        const ultimoDia = new Date(m.anio, m.mes, 0).getDate();
        const hasta = `${m.anio}-${String(m.mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
        const { data, error } = await supabase.rpc('fn_clima_resumen_mensual', { p_desde: desde, p_hasta: hasta });
        if (error || !data) return [];
        const muestrasEsperadas = diasEsperados(m.anio, m.mes, ultimoDia, piso) * 13;
        const esPrimerMesDeLaRed = !!piso && piso.startsWith(`${m.anio}-${String(m.mes).padStart(2, '0')}`);
        return (data as FilaResumenMensual[]).map((f): PuntoMensual => {
            const confiable = f.n_muestras / muestrasEsperadas >= 0.6;
            return {
                anio: m.anio, mes: m.mes,
                estacionId: f.estacion_id, estacionNombre: f.estacion_nombre,
                tempCProm: confiable ? f.temp_c_prom : null,
                vientoMsProm: confiable ? f.viento_ms_prom : null,
                radSolarWm2Prom: confiable ? f.rad_solar_wm2_prom : null,
                lluviaMmAcumulada: confiable ? f.lluvia_mm_acumulada : null,
                nMuestras: f.n_muestras,
                parcial: esPrimerMesDeLaRed,
            };
        });
    }));
    return resultados.flat();
}
