/**
 * formato — formateadores únicos con la regla "S/D nunca cero": null/undefined/NaN se rotulan "S/D", jamás "0".
 * Sustituyen los helpers locales (`f`, `num`, `nf`) que cada pantalla definía por su cuenta.
 */
export const SD = 'S/D';

const esNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Número con `d` decimales, o "S/D". */
export function fmt(v: number | null | undefined, d = 1): string {
    return esNum(v) ? v.toFixed(d) : SD;
}

/** Número con separador de miles (es-MX) y `d` decimales, o "S/D". */
export function fmtMiles(v: number | null | undefined, d = 0): string {
    return esNum(v) ? v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }) : SD;
}

/** "12.3 m³/s" — la unidad solo acompaña a un valor real (nunca "S/D m³/s"). */
export function fmtUnidad(v: number | null | undefined, unidad: string, d = 1): string {
    return esNum(v) ? `${v.toFixed(d)} ${unidad}` : SD;
}

export const fmtPct = (v: number | null | undefined, d = 1): string => (esNum(v) ? `${v.toFixed(d)} %` : SD);

/** Antigüedad legible a partir de minutos: "hace 12 min", "hace 3 h", "hace 2 d"; "sin lectura" si no hay dato. */
export function fmtEdadMin(min: number | null | undefined): string {
    if (!esNum(min) || min < 0) return 'sin lectura';
    if (min < 1) return 'hace instantes';
    if (min < 60) return `hace ${Math.round(min)} min`;
    if (min < 1440) return `hace ${Math.floor(min / 60)} h`;
    return `hace ${Math.floor(min / 1440)} d`;
}

/** Caudal en L/s a partir de m³/s (null se conserva). */
export const m3sALps = (q: number | null | undefined): number | null => (esNum(q) ? q * 1000 : null);
