/**
 * estadisticaHistorica — estadística pura para el Informe Histórico de presas.
 *
 * Regla rectora "S/D nunca cero": toda función devuelve `null` si no hay datos suficientes y filtra los
 * `null` de entrada; jamás devuelve 0 por falta de información.
 */

export interface ResumenSerie { n: number; media: number; mediana: number; min: number; max: number; desv: number }

const validos = (v: (number | null | undefined)[]): number[] => v.filter((x): x is number => x != null && Number.isFinite(x));

export function resumenSerie(v: (number | null | undefined)[]): ResumenSerie | null {
    const x = validos(v);
    if (!x.length) return null;
    const media = x.reduce((a, b) => a + b, 0) / x.length;
    const desv = x.length > 1 ? Math.sqrt(x.reduce((a, b) => a + (b - media) ** 2, 0) / (x.length - 1)) : 0;
    return { n: x.length, media, mediana: percentil(x, 50) as number, min: Math.min(...x), max: Math.max(...x), desv };
}

/** Percentil por interpolación lineal (p entre 0 y 100). */
export function percentil(v: (number | null | undefined)[], p: number): number | null {
    const x = validos(v).sort((a, b) => a - b);
    if (!x.length) return null;
    if (x.length === 1) return x[0];
    const pos = (Math.min(100, Math.max(0, p)) / 100) * (x.length - 1);
    const i = Math.floor(pos);
    return x[i] + (x[Math.min(i + 1, x.length - 1)] - x[i]) * (pos - i);
}

export interface PercentilesHistoricos { p10: number; p25: number; p50: number; p75: number; p90: number; n: number; fragil: boolean }

/** Percentiles de los valores históricos. Con menos de 10 años son frágiles: se marca para advertirlo en el informe. */
export function percentilesHistoricos(valores: (number | null | undefined)[]): PercentilesHistoricos | null {
    const x = validos(valores);
    if (x.length < 2) return null;
    return {
        p10: percentil(x, 10)!, p25: percentil(x, 25)!, p50: percentil(x, 50)!, p75: percentil(x, 75)!, p90: percentil(x, 90)!,
        n: x.length, fragil: x.length < 10,
    };
}

export interface Anomalia { abs: number; pct: number | null; promedio: number; n: number }

/** Desviación del valor frente al promedio de los años de referencia (que NO incluyen al año base). */
export function anomaliaVsPromedio(valor: number | null | undefined, historicos: (number | null | undefined)[]): Anomalia | null {
    const h = validos(historicos);
    if (valor == null || !Number.isFinite(valor) || !h.length) return null;
    const promedio = h.reduce((a, b) => a + b, 0) / h.length;
    return { abs: valor - promedio, pct: promedio !== 0 ? ((valor - promedio) / Math.abs(promedio)) * 100 : null, promedio, n: h.length };
}

export interface Tendencia { pendiente: number; intercepto: number; r2: number; n: number }

/** Regresión lineal por mínimos cuadrados. Exige al menos 3 puntos. Es descriptiva, no predictiva. */
export function tendenciaLineal(pts: { x: number; y: number | null }[]): Tendencia | null {
    const p = pts.filter((q): q is { x: number; y: number } => q.y != null && Number.isFinite(q.y));
    if (p.length < 3) return null;
    const n = p.length;
    const mx = p.reduce((a, q) => a + q.x, 0) / n;
    const my = p.reduce((a, q) => a + q.y, 0) / n;
    const sxx = p.reduce((a, q) => a + (q.x - mx) ** 2, 0);
    if (sxx === 0) return null;
    const sxy = p.reduce((a, q) => a + (q.x - mx) * (q.y - my), 0);
    const syy = p.reduce((a, q) => a + (q.y - my) ** 2, 0);
    const pendiente = sxy / sxx;
    const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
    return { pendiente, intercepto: my - pendiente * mx, r2, n };
}

export type EstadoSemaforo = 'verde' | 'ambar' | 'rojo' | 'sd';

/**
 * Semáforo por terciles de la posición histórica (1 = el más bajo de `de` años): tercio inferior rojo,
 * medio ámbar, superior verde. Con menos de 3 años comparables no se clasifica (S/D).
 */
export function semaforo(pos: { posicion: number; de: number } | null): EstadoSemaforo {
    if (!pos || pos.de < 3) return 'sd';
    const r = (pos.posicion - 1) / (pos.de - 1);
    return r < 1 / 3 ? 'rojo' : r < 2 / 3 ? 'ambar' : 'verde';
}

export interface Hueco { desde: string; hasta: string; dias: number }

/** Tramos consecutivos sin dato dentro de una lista ordenada de {fecha, hayDato}. */
export function huecos(dias: { fecha: string; hayDato: boolean }[]): Hueco[] {
    const out: Hueco[] = [];
    let ini: string | null = null;
    let fin = '';
    let n = 0;
    for (const d of dias) {
        if (!d.hayDato) {
            if (ini == null) ini = d.fecha;
            fin = d.fecha;
            n++;
        } else if (ini != null) {
            out.push({ desde: ini, hasta: fin, dias: n });
            ini = null;
            n = 0;
        }
    }
    if (ini != null) out.push({ desde: ini, hasta: fin, dias: n });
    return out;
}
