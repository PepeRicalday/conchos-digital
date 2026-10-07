/**
 * kcConstantes — aproximación lineal NDVI → Kc, módulo PURO (sin supabase) para que la use la pantalla, el informe y las pruebas.
 * La edge function `sentinel-ndvi-modulo-sync` (Deno) no puede importar este archivo y repite la misma fórmula en su
 * `ndviAKc`: si se cambia aquí, cambiarla allá también (la prueba de kcConstantes fija los valores de referencia).
 */
export const KC_BASE = 0.15;
export const KC_PENDIENTE = 1.10;
export const KC_MIN = 0.15;
export const KC_MAX = 1.05;

/** Kc ≈ 0.15 + 1.10·NDVI, acotado a [0.15, 1.05] y redondeado a 2 decimales. */
export function ndviAKc(ndvi: number): number {
    const kc = KC_BASE + KC_PENDIENTE * ndvi;
    return Math.max(KC_MIN, Math.min(KC_MAX, +kc.toFixed(2)));
}
