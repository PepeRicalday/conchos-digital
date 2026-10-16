// ═══════════════════════════════════════════════════════════════════════════
// Plausibilidad física de lecturas climáticas — SICA-005
// ---------------------------------------------------------------------------
// Mismos rangos que la vista de alertas v_clima_alertas_agro_eval
// (supabase/migrations/20261006100000_clima_operativo_salud_red_alertas.sql):
// temperatura −25…48 °C, viento 0…50 m/s, humedad 0…100 %. La BD no marca estos
// casos (qa_status llega NULL), así que cualquier informe que lea las lecturas
// crudas debe filtrarlas aquí: un sensor que reporta 82 °C no es un dato, es una
// avería, y promediarlo contamina el informe (Riego San Rafael, oct 2026).
//
// Un valor implausible se convierte en null (S/D) — nunca en 0.
// ═══════════════════════════════════════════════════════════════════════════

export const RANGOS_PLAUSIBLES = {
    tempC: [-25, 48],
    vientoMs: [0, 50],
    humPct: [0, 100],
    radSolarWm2: [0, 1500],
    lluviaMm: [0, 1000],
} as const;

export type CampoPlausible = keyof typeof RANGOS_PLAUSIBLES;

/** El valor, o null si falta o es físicamente imposible. */
export function valorPlausible(campo: CampoPlausible, v: number | null | undefined): number | null {
    if (v == null || !Number.isFinite(v)) return null;
    const [lo, hi] = RANGOS_PLAUSIBLES[campo];
    return v < lo || v > hi ? null : v;
}

/** true si el valor existe y está fuera de rango (distinto de "no hay dato"). */
export function esImplausible(campo: CampoPlausible, v: number | null | undefined): boolean {
    return v != null && Number.isFinite(v) && valorPlausible(campo, v) == null;
}
