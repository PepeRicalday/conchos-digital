import type { PuntoHidro } from './hidroEstaciones';

/**
 * Comparación Ojinaga Sutron (C6300760) ↔ USIBWC (08373000): mismo sitio, dos fuentes.
 * Se alinean por instante redondeado a 15 min; solo cuentan pares con ambos valores (nunca se rellena con 0).
 * Es un contraste de fuentes, no un balance hidráulico.
 */
const PASO_MS = 15 * 60000;
/** Pares mínimos para opinar (≈ 6 h a 15 min). */
export const PARES_MIN_COMPARACION = 24;
/** Razón de gasto fuera de [1/3, 3] = discrepancia (la diferencia normal de curva entre fuentes es de unos %). */
export const RAZON_GASTO_UMBRAL = 3;

export interface ComparacionOjinaga {
    pares: number;
    /** Mediana de (nivel Sutron − nivel IBWC), m. */
    offsetNivelM: number | null;
    /** Mediana de gasto Sutron / gasto IBWC. */
    razonGasto: number | null;
    /** Mediana de (gasto Sutron − gasto IBWC), m³/s. */
    difGastoM3s: number | null;
    discrepante: boolean;
    suficiente: boolean;
}

const mediana = (a: number[]): number | null => {
    if (a.length === 0) return null;
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const aRejilla = (p: PuntoHidro[]): Map<number, number> => {
    const m = new Map<number, number>();
    for (const x of p) if (Number.isFinite(x.t) && Number.isFinite(x.v)) m.set(Math.round(x.t / PASO_MS) * PASO_MS, x.v);
    return m;
};

export function compararOjinaga(
    sutron: { nivel?: PuntoHidro[]; gasto?: PuntoHidro[] },
    ibwc: { nivel?: PuntoHidro[]; gasto?: PuntoHidro[] },
): ComparacionOjinaga {
    const sn = aRejilla(sutron.nivel ?? []), sg = aRejilla(sutron.gasto ?? []);
    const inv = aRejilla(ibwc.nivel ?? []), ig = aRejilla(ibwc.gasto ?? []);
    const dn: number[] = [], dg: number[] = [], rg: number[] = [];
    for (const [t, v] of sn) { const o = inv.get(t); if (o != null) dn.push(v - o); }
    for (const [t, v] of sg) {
        const o = ig.get(t);
        if (o == null) continue;
        dg.push(v - o);
        if (o > 0.05) rg.push(v / o); // gasto IBWC ≈ 0 no admite razón
    }
    const pares = Math.max(dn.length, dg.length);
    const razonGasto = mediana(rg);
    const suficiente = rg.length >= PARES_MIN_COMPARACION;
    return {
        pares,
        offsetNivelM: mediana(dn),
        razonGasto,
        difGastoM3s: mediana(dg),
        suficiente,
        discrepante: suficiente && razonGasto != null && (razonGasto > RAZON_GASTO_UMBRAL || razonGasto < 1 / RAZON_GASTO_UMBRAL),
    };
}
