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

interface FilaResumenMensual {
    estacion_id: string;
    estacion_nombre: string;
    n_muestras: number;
    temp_c_prom: number | null;
    viento_ms_prom: number | null;
    viento_dir_deg_dominante: number | null;
    rad_solar_wm2_prom: number | null;
    lluvia_mm_acumulada: number | null;
}

/**
 * Trae el resumen de un mes calendario (1-12, año de 4 dígitos) para las
 * estaciones dadas (se usa `estacionesBase` para heredar lat/lon/rol/nombre
 * — el RPC no conoce geografía, solo agrega lecturas) y arma un
 * EstacionConLectura[] sintético listo para exportClimaGeoInforme.
 *
 * n_muestras se traduce a una etiqueta de confiabilidad simple: con las ~13
 * lecturas/día de la red (sync cada 2h), un mes completo trae ~390-420
 * muestras; menos de la mitad de eso (mes en curso, estación con caídas de
 * sync) se marca como confiabilidad reducida en `calidad.etiqueta`, siguiendo
 * el mismo principio de nunca presentar un promedio pobre con la misma
 * confianza visual que uno robusto.
 */
export async function estacionesDesdeResumenMensual(
    estacionesBase: EstacionConLectura[], anio: number, mes: number,
): Promise<EstacionConLectura[]> {
    const desde = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const ultimoDia = new Date(anio, mes, 0).getDate(); // día 0 del mes siguiente = último día de este mes
    const hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;

    const { data, error } = await supabase.rpc('fn_clima_resumen_mensual', { p_desde: desde, p_hasta: hasta });
    if (error) throw new Error(`No se pudo obtener el resumen mensual: ${error.message}`);
    const filas = (data ?? []) as FilaResumenMensual[];
    const porId = new Map(filas.map(f => [f.estacion_id, f]));

    // Umbral de muestras esperadas para un mes completo con la cadencia
    // actual de sync (~13/día × días del mes) — por debajo de 60% se marca
    // la confiabilidad como reducida (mes en curso, estación intermitente).
    const muestrasEsperadas = ultimoDia * 13;

    return estacionesBase.map((e): EstacionConLectura => {
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
                calidad: { status: 'expired', flags: ['missing'], edadMin: null, usableComoActual: false, etiqueta: 'SIN DATOS EN EL MES', color: '#94a3b8' },
                pronostico: null, pronosticoSerie: [],
                cielo: CIELO_NO_DETERMINADO,
                nubosidadEstPct: null, clearnessIndex: null,
            };
        }
        const cobertura = f.n_muestras / muestrasEsperadas;
        const confiable = cobertura >= 0.6;
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
}

/**
 * Serie histórica mes a mes, por estación, para graficar la evolución del
 * promedio (o acumulado, en lluvia) — un RPC por mes disponible (hoy 2-4
 * meses, volumen trivial). Usada por el Informe Geoclimático en modo
 * "mes específico" para mostrar tendencia, no solo el número aislado del
 * mes elegido.
 */
export async function obtenSerieMensual(meses: MesDisponible[]): Promise<PuntoMensual[]> {
    const resultados = await Promise.all(meses.map(async (m) => {
        const desde = `${m.anio}-${String(m.mes).padStart(2, '0')}-01`;
        const ultimoDia = new Date(m.anio, m.mes, 0).getDate();
        const hasta = `${m.anio}-${String(m.mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
        const { data, error } = await supabase.rpc('fn_clima_resumen_mensual', { p_desde: desde, p_hasta: hasta });
        if (error || !data) return [];
        return (data as FilaResumenMensual[]).map((f): PuntoMensual => ({
            anio: m.anio, mes: m.mes,
            estacionId: f.estacion_id, estacionNombre: f.estacion_nombre,
            tempCProm: f.temp_c_prom, vientoMsProm: f.viento_ms_prom,
            radSolarWm2Prom: f.rad_solar_wm2_prom, lluviaMmAcumulada: f.lluvia_mm_acumulada,
            nMuestras: f.n_muestras,
        }));
    }));
    return resultados.flat();
}
