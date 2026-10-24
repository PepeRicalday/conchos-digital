/**
 * estadisticaBasica — utilidades mínimas compartidas por los informes (antes `media` estaba copiada en cuatro archivos).
 * Regla "S/D nunca cero": se ignoran null/undefined/NaN y, si no queda ningún valor, el resultado es null (no 0).
 */

/** Los valores numéricos finitos de una lista. */
export const soloValidos = (v: (number | null | undefined)[]): number[] => v.filter((x): x is number => x != null && Number.isFinite(x));

/** Media aritmética de los valores válidos; null si no hay ninguno. */
export function media(v: (number | null | undefined)[]): number | null {
    const x = soloValidos(v);
    return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null;
}

/** 'AAAA-MM' de una fecha o mes ('AAAA-MM-DD' → 'AAAA-MM'). */
export const mesDe = (m: string | null | undefined): string => (m ?? '').slice(0, 7);
