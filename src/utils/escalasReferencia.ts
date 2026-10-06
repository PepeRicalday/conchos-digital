/**
 * escalasReferencia — K-64 y K-94+200 son escalas de SOLO REFERENCIA: no tienen compuertas ni estructura de control,
 * así que no tienen gasto propio (el que aparecía, p. ej. ~53 m³/s en K-64, es un artefacto de aplicar la fórmula
 * `compuertas_m1` a una escala sin compuertas) ni nivel aguas abajo. Aportan únicamente su nivel como punto intermedio
 * de la lámina.
 *
 * Consecuencia: NO cortan un tramo de balance. Los tramos reales son K-62 → K-68 y K-94+057 → K-104. Cualquier lista
 * de extremos de tramo debe pasar por `soloEscalasDeControl` (mismo criterio que InformeOperativo/InformeTendencias).
 */

/** Kilómetros de las escalas de referencia (con tolerancia por redondeo de la BD). */
export const KM_ESCALAS_REFERENCIA = [64, 94.2] as const;

const NOMBRE_REF = /(^|[^0-9])K-?64(?![0-9+])|K-?94\+?200/i;

export interface EscalaIdentificable { nombre?: string | null; km?: number | string | null }

export function esEscalaReferencia(e: EscalaIdentificable): boolean {
    const km = e.km == null || e.km === '' ? null : Number(e.km);
    if (km != null && Number.isFinite(km) && KM_ESCALAS_REFERENCIA.some((k) => Math.abs(km - k) < 0.01)) return true;
    return !!e.nombre && NOMBRE_REF.test(e.nombre);
}

/** Escalas con control de gasto (las que pueden ser extremo de un tramo de balance). */
export function soloEscalasDeControl<T extends EscalaIdentificable>(escalas: T[]): T[] {
    return escalas.filter((e) => !esEscalaReferencia(e));
}

/** ¿Un tramo (por nombres de sus extremos) toca una escala de referencia? */
export function tramoTocaReferencia(inicio?: string | null, fin?: string | null): boolean {
    return esEscalaReferencia({ nombre: inicio }) || esEscalaReferencia({ nombre: fin });
}
