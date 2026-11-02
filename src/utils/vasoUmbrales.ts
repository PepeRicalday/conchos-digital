/**
 * Umbrales del Manejo de vaso — UNA sola definición para pantalla, informe y BD.
 * Los equivalentes en SQL viven en check_desviacion_vaso_ndwi / fn_recalibra_curva_batimetrica
 * (migración 20261101180000): si cambias uno aquí, cámbialo también allá.
 */

/** Tolerancia (días) entre la fecha de los píxeles de una escena y el nivel del embalse con que se compara. */
export const DIAS_NIVEL_ESCENA = 2;
/** Escenas con más % de la huella del vaso nublada/sin dato no se validan contra la curva. */
export const NUBES_VASO_MAX_PCT = 5;
/**
 * Desvío área satelital vs. curva oficial: hasta aquí "coincide". Calibrado con las 7 escenas v2 (10 m) de 2026 con nivel
 * del día: 83-95 % de la curva, media −11.6 % ± 4 — sesgo sistemático del píxel en la orilla somera y la cola con
 * vegetación, no azolve. Con 10 % casi todas salían "Revisar" y la alerta de BD se disparaba cada mes (2026-11-01).
 */
export const DESVIO_ATENCION_PCT = 15;
/** Más allá de esto "discrepa" (alerta crítica en BD). */
export const DESVIO_CRITICO_PCT = 25;
/** Índice de fragmentación: desvío del ratio de elongación contra el promedio de la propia presa. */
export const FRAGMENTACION_ATENCION_PCT = 15;
export const FRAGMENTACION_CRITICA_PCT = 30;
/** Escena satelital más vieja que esto se advierte en el informe. */
export const DIAS_ESCENA_VIEJA = 20;

export type ClaveSemaforo = 'ok' | 'warn' | 'crit' | 'sd';
export interface Semaforo { clave: ClaveSemaforo; etiqueta: string }

/** Semáforo del desvío (en %, con signo o sin él) del área satelital contra la curva oficial. */
export function semaforoDesvio(desvioPct: number | null | undefined): Semaforo {
    if (desvioPct == null || !Number.isFinite(desvioPct)) return { clave: 'sd', etiqueta: 'S/D' };
    const d = Math.abs(desvioPct);
    if (d <= DESVIO_ATENCION_PCT) return { clave: 'ok', etiqueta: 'Coincide' };
    if (d <= DESVIO_CRITICO_PCT) return { clave: 'warn', etiqueta: 'Revisar' };
    return { clave: 'crit', etiqueta: 'Discrepa' };
}
