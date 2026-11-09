// ═══════════════════════════════════════════════════════════════════════════
// Horas frío y extremos de temperatura — puro (sin React ni red)
// ---------------------------------------------------------------------------
// Definición (la misma que usa fn_cuenca_horas_frio en SQL): una HORA FRÍO es una hora local (America/Chihuahua) con temperatura ≤ 7.2 °C.
// Una hora de HELADA es una hora con temperatura ≤ 0 °C. La temporada de acumulación va del 1 de noviembre al último día de febrero.
// Reglas del proyecto: S/D = null, nunca 0. Un día con menos del 80 % de sus 24 horas con dato es S/D; un acumulado con menos del 80 % de los días
// con dato es S/D. No se estima nada desde la temperatura media: sin serie horaria no hay horas frío.
// ═══════════════════════════════════════════════════════════════════════════

export const UMBRAL_HORA_FRIO_C = 7.2;
export const UMBRAL_HELADA_C = 0;
export const MIN_COBERTURA_HORAS = 0.8;
export const MIN_COBERTURA_DIAS_FRIO = 0.8;

const ISO = (t: number) => new Date(t).toISOString().slice(0, 10);
const DIA = 86_400_000;

export interface HorasFrioDia { horas: number | null; helada: number | null; horasConDato: number; tmax: number | null; tmin: number | null }

/**
 * Un día a partir de su media horaria (24 casillas, hora local 0–23; null = sin lectura en esa hora).
 * Con menos de 20 de 24 horas con dato, horas/helada son S/D (no se afirma cuántas horas frío hubo).
 */
export function horasFrioDia(porHora: (number | null)[], umbral = UMBRAL_HORA_FRIO_C): HorasFrioDia {
    const v = porHora.filter((x): x is number => x != null && Number.isFinite(x));
    const base = { horasConDato: v.length, tmax: v.length ? Math.max(...v) : null, tmin: v.length ? Math.min(...v) : null };
    if (v.length < Math.ceil(24 * MIN_COBERTURA_HORAS)) return { ...base, horas: null, helada: null };
    return { ...base, horas: v.filter((x) => x <= umbral).length, helada: v.filter((x) => x <= UMBRAL_HELADA_C).length };
}

export interface DiaFrio { fecha: string; horas: number | null; helada?: number | null }

/** Temporada de frío vigente a `hoy`: 1-nov → 28/29-feb. Fuera de nov–feb se reporta la temporada que terminó. */
export function temporadaFrio(hoy: string): { inicio: string; fin: string; enCurso: boolean } {
    const y = Number(hoy.slice(0, 4)), m = Number(hoy.slice(5, 7));
    const yIni = m >= 11 ? y : y - 1; // ene–feb: la de este invierno; mar–oct: la que terminó en febrero de este año
    const finFeb = ISO(Date.UTC(yIni + 1, 2, 1) - DIA);
    const inicio = `${yIni}-11-01`;
    const enCurso = hoy >= inicio && hoy <= finFeb;
    return { inicio, fin: enCurso ? hoy : finFeb, enCurso };
}

/**
 * Horas frío acumuladas de `inicio` a `fin` (inclusive). null si menos del 80 % de los días tiene dato (S/D, nunca 0).
 * `dias` con `horas === null` no cuentan como dato.
 */
export function acumularHorasFrio(dias: DiaFrio[], inicio: string, fin: string): { horas: number | null; helada: number | null; diasConDato: number; diasTotal: number } {
    const diasTotal = Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / DIA) + 1;
    const vistos = new Map<string, DiaFrio>();
    for (const d of dias) if (d.fecha >= inicio && d.fecha <= fin && d.horas != null && Number.isFinite(d.horas)) vistos.set(d.fecha, d);
    if (diasTotal < 1 || vistos.size < Math.ceil(diasTotal * MIN_COBERTURA_DIAS_FRIO)) return { horas: null, helada: null, diasConDato: vistos.size, diasTotal: Math.max(diasTotal, 0) };
    let h = 0, he = 0, hayHelada = false;
    for (const d of vistos.values()) { h += d.horas as number; if (d.helada != null) { he += d.helada; hayHelada = true; } }
    return { horas: h, helada: hayHelada ? he : null, diasConDato: vistos.size, diasTotal };
}

/** Extremos de una ventana de `n` días terminada en `fin`: máxima = mayor de las máximas, mínima = menor de las mínimas; ≥ 80 % de días con dato. */
export function extremosVentana(dias: { fecha: string; tmax: number | null; tmin: number | null }[], fin: string, n: number): { tmax: number | null; tmin: number | null } {
    const ini = ISO(Date.parse(`${fin}T00:00:00Z`) - (n - 1) * DIA);
    const sel = dias.filter((d) => d.fecha >= ini && d.fecha <= fin);
    const mx = sel.map((d) => d.tmax).filter((x): x is number => x != null && Number.isFinite(x));
    const mn = sel.map((d) => d.tmin).filter((x): x is number => x != null && Number.isFinite(x));
    const min = Math.ceil(n * MIN_COBERTURA_DIAS_FRIO);
    return { tmax: mx.length >= min ? Math.max(...mx) : null, tmin: mn.length >= min ? Math.min(...mn) : null };
}
