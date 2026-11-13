/**
 * comparadorCuenca — series de % NAMO de los cierres mensuales para comparar vasos entre sí o años de un mismo vaso.
 * Pura. Un mes sin cierre o sin cifra es hueco (null): jamás se interpola ni se rellena con 0, y la línea se corta.
 * El color sigue a la ENTIDAD (su posición fija en el catálogo), no a su rango ni al orden de selección.
 */
import type { CierreMensual, CuerpoAgua } from './cuerposAgua';

export const MAX_SERIES = 4;

export interface PuntoSerie { x: number; v: number | null; etiqueta: string }
export interface SerieComparada { id: string; nombre: string; /** Posición fija 0..7: decide el color. */ slot: number; puntos: PuntoSerie[]; conDato: number }
export interface ModeloComparador { modo: 'vasos' | 'anios'; xs: { x: number; etiqueta: string }[]; series: SerieComparada[]; max: number }

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const pct = (c: CierreMensual | undefined): number | null => (c && c.pctNamo != null && Number.isFinite(c.pctNamo) ? c.pctNamo : null);
/** Posición de un mes (AAAA-MM-01) en meses absolutos. */
const idxMes = (mes: string) => Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7)) - 1;
const etqMes = (i: number) => `${MESES[((i % 12) + 12) % 12]} ${String(Math.floor(i / 12)).slice(2)}`;

/** Un slot estable por cuerpo (orden del catálogo): al quitar un vaso de la selección los demás no cambian de color. */
export const slotDe = (cuerpos: CuerpoAgua[], id: string): number => Math.max(0, cuerpos.findIndex((c) => c.id === id)) % 8;

/** Techo del eje: 100 % salvo que un cierre pase del NAMO (entonces se redondea a la decena de arriba; nunca se recorta el dato). */
function techo(series: SerieComparada[]): number {
  const m = Math.max(100, ...series.flatMap((s) => s.puntos.map((p) => p.v ?? 0)));
  return m > 100 ? Math.ceil(m / 10) * 10 : 100;
}

/** Vasos: línea de tiempo continua de todos los meses con cierre, una línea por cuerpo elegido. */
export function compararVasos(cuerpos: CuerpoAgua[], cierres: CierreMensual[], ids: string[]): ModeloComparador {
  const elegidos = ids.slice(0, MAX_SERIES).map((id) => cuerpos.find((c) => c.id === id)).filter((c): c is CuerpoAgua => !!c);
  const meses = cierres.filter((c) => elegidos.some((e) => e.id === c.cuerpoId) && pct(c) != null).map((c) => idxMes(c.mes));
  if (!meses.length) {
    return { modo: 'vasos', xs: [], series: elegidos.map((c) => ({ id: c.id, nombre: c.etiqueta, slot: slotDe(cuerpos, c.id), puntos: [], conDato: 0 })), max: 100 };
  }
  const a = Math.min(...meses), b = Math.max(...meses);
  const xs = Array.from({ length: b - a + 1 }, (_, k) => ({ x: a + k, etiqueta: etqMes(a + k) }));
  const series = elegidos.map((c) => {
    const por = new Map(cierres.filter((x) => x.cuerpoId === c.id).map((x) => [idxMes(x.mes), pct(x)]));
    const puntos = xs.map((p) => ({ x: p.x, v: por.get(p.x) ?? null, etiqueta: p.etiqueta }));
    return { id: c.id, nombre: c.etiqueta, slot: slotDe(cuerpos, c.id), puntos, conDato: puntos.filter((p) => p.v != null).length };
  });
  return { modo: 'vasos', xs, series, max: techo(series) };
}

/** Años: un vaso, una línea por año sobre los meses calendario (ene–dic), para ver el mismo mes año contra año. */
export function compararAnios(cuerpo: CuerpoAgua, cierres: CierreMensual[], anios: number[]): ModeloComparador {
  const mios = cierres.filter((c) => c.cuerpoId === cuerpo.id);
  const xs = MESES.map((m, i) => ({ x: i, etiqueta: m }));
  const series = anios.slice(0, MAX_SERIES).map((anio, k) => {
    const puntos = xs.map((p) => ({ x: p.x, v: pct(mios.find((c) => c.mes === `${anio}-${String(p.x + 1).padStart(2, '0')}-01`)), etiqueta: `${p.etiqueta} ${anio}` }));
    return { id: String(anio), nombre: String(anio), slot: k, puntos, conDato: puntos.filter((q) => q.v != null).length };
  });
  return { modo: 'anios', xs, series, max: techo(series) };
}

/** Años con al menos un cierre con % NAMO de ese cuerpo, del más reciente al más antiguo. */
export const aniosConDato = (cierres: CierreMensual[], cuerpoId: string): number[] =>
  [...new Set(cierres.filter((c) => c.cuerpoId === cuerpoId && pct(c) != null).map((c) => Number(c.mes.slice(0, 4))))].sort((a, b) => b - a);

/** Segmentos continuos de una serie: un hueco (null) corta la línea. */
export function tramosContinuos(puntos: PuntoSerie[]): PuntoSerie[][] {
  const out: PuntoSerie[][] = [];
  let cur: PuntoSerie[] = [];
  for (const p of puntos) {
    if (p.v == null) { if (cur.length) out.push(cur); cur = []; } else cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}
