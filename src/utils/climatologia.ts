// ═══════════════════════════════════════════════════════════════════════════
// CLIMATOLOGÍA HISTÓRICA — comparación contra el promedio de años anteriores
// ---------------------------------------------------------------------------
// Consulta clima_historico_satelital (NASA POWER, ver migración
// 20260802120000_clima_historico_satelital_nasa_power.sql) y calcula el
// promedio de la MISMA fecha (mes/día) en años anteriores para las estaciones
// dadas — la base para responder "¿hoy llovió más o menos que lo normal?".
//
// La tabla se creó el 2026-08-02 y crece día a día vía el cron de
// clima-historico-satelital-sync: hoy solo tiene ~días de historia, no años.
// Por diseño esta función NUNCA falla el informe si no hay suficiente
// historial — devuelve promedios null y aniosDisponibles: 0, y quien la
// consume decide si oculta la sección (ver exportClimaReport.ts).
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from '../lib/supabase';

export interface ClimatologiaResultado {
    aniosDisponibles: number;
    /** Por debajo de este umbral, el promedio histórico es una muestra
     *  preliminar y se etiqueta como tal en el informe (no se oculta). */
    aniosMinimos: number;
    tempProm: number | null;
    precipProm: number | null;
    etoProm: number | null;
    fechaConsultada: string;
}

const ANIOS_MINIMOS = 3;

const vacio = (fechaConsultada: string): ClimatologiaResultado => ({
    aniosDisponibles: 0,
    aniosMinimos: ANIOS_MINIMOS,
    tempProm: null,
    precipProm: null,
    etoProm: null,
    fechaConsultada,
});

const promedio = (vals: (number | null)[]): number | null => {
    const nums = vals.filter((v): v is number => v != null);
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
};

/**
 * Promedio histórico de la fecha `fechaHoy` (mes/día) en años ANTERIORES al
 * actual, para las estaciones dadas. No propaga errores: si la consulta falla
 * (red, tabla vacía, etc.) devuelve el resultado "sin historia" para que el
 * informe se siga generando igual.
 */
export async function climatologiaHistorica(
    estacionIds: string[],
    fechaHoy: string, // YYYY-MM-DD, hora local del distrito
): Promise<ClimatologiaResultado> {
    if (!estacionIds.length) return vacio(fechaHoy);

    try {
        const [anioActual, mes, dia] = fechaHoy.split('-').map(Number);

        const { data, error } = await supabase
            .from('clima_historico_satelital')
            .select('fecha, temp_sat_c, precip_sat_mm, eto_sat_mm')
            .in('estacion_id', estacionIds);

        if (error || !data?.length) return vacio(fechaHoy);

        // Filtra en JS por mismo mes/día, excluyendo el año en curso — el
        // volumen de la tabla hoy (días, no años) hace innecesario expresar
        // esto como filtro en el query builder.
        const filas = (data as { fecha: string; temp_sat_c: number | null; precip_sat_mm: number | null; eto_sat_mm: number | null }[])
            .filter((f) => {
                const [anio, m, d] = f.fecha.split('-').map(Number);
                return anio < anioActual && m === mes && d === dia;
            });

        if (!filas.length) return vacio(fechaHoy);

        const aniosDisponibles = new Set(filas.map((f) => f.fecha.slice(0, 4))).size;

        return {
            aniosDisponibles,
            aniosMinimos: ANIOS_MINIMOS,
            tempProm: promedio(filas.map((f) => f.temp_sat_c)),
            precipProm: promedio(filas.map((f) => f.precip_sat_mm)),
            etoProm: promedio(filas.map((f) => f.eto_sat_mm)),
            fechaConsultada: fechaHoy,
        };
    } catch {
        return vacio(fechaHoy);
    }
}
