/**
 * cuencaViz — geometría y reducción de datos para la visualización de la cuenca. Lógica PURA y testeable: los
 * componentes SVG solo pintan lo que sale de aquí.
 */
import type { FilaClimatologia } from './aqwpEstadistica';

// ── Tanques ───────────────────────────────────────────────────────────────────
/**
 * Ancho del tanque ∝ √NAMO, con piso. Con escala lineal Boquilla (2,847 Mm³) ocuparía el 95 % y El Rejón (6.5 Mm³) sería una
 * rendija de 1 px; con raíz cuadrada se distinguen las 7 y el tamaño sigue siendo legible (se rotula "ancho ∝ √capacidad").
 * Sin NAMO → piso (la presa se ve, pero no se inventa su tamaño: el piso se rotula).
 */
export function anchoTanque(namoMm3: number | null, maxNamoMm3: number, min = 56, max = 240): number {
  if (namoMm3 == null || !(namoMm3 > 0) || !(maxNamoMm3 > 0)) return min;
  return Math.round(min + (max - min) * Math.sqrt(Math.min(1, namoMm3 / maxNamoMm3)));
}

/** Alto del relleno de agua (0-100 % del alto útil). Sin dato: 0 y el tanque se dibuja vacío con trama (nunca "0 %"). */
export const alturaRelleno = (pct: number | null): number => (pct == null || !Number.isFinite(pct) ? 0 : Math.max(0, Math.min(100, pct)));

/** Posición (0-100 desde abajo) de la línea del volumen muerto: muerto / NAMO. null sin datos. */
export function posicionMuerto(muertoMm3: number | null, namoMm3: number | null): number | null {
  if (muertoMm3 == null || namoMm3 == null || !(namoMm3 > 0) || muertoMm3 < 0) return null;
  return Math.min(100, (muertoMm3 / namoMm3) * 100);
}

// ── Series ────────────────────────────────────────────────────────────────────
export interface PuntoSemanal { fecha: string; pct: number | null; dudoso: boolean }

const DIA_MS = 86_400_000;
const aMs = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/**
 * Reduce una serie diaria (≈365 puntos) a semanal (≈52): el ÚLTIMO dato de cada bloque de 7 días, contando hacia atrás desde
 * la fecha final. Menos nodos SVG y misma forma. Un bloque sin ningún dato queda null (S/D). `dudoso` = el dato del bloque
 * viene de un tramo "sin actualizar" (se dibuja punteado).
 */
export function serieSemanal(
  filas: { fecha: string; valor: number | null; dudoso?: boolean }[],
  meses = 12,
): PuntoSemanal[] {
  const validas = filas.filter((f) => f.fecha).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (validas.length === 0) return [];
  const fin = aMs(validas[validas.length - 1].fecha);
  const ini = fin - Math.round(meses * 30.4375) * DIA_MS;
  const bloques = new Map<number, { fecha: string; pct: number | null; dudoso: boolean }>();
  for (const f of validas) {
    const t = aMs(f.fecha);
    if (t < ini) continue;
    const k = Math.floor((fin - t) / (7 * DIA_MS));
    // Se recorre en orden ascendente: un dato con valor (más reciente) pisa al anterior; un null solo ocupa el bloque vacío.
    if (f.valor != null || !bloques.has(k)) bloques.set(k, { fecha: f.fecha, pct: f.valor, dudoso: !!f.dudoso });
  }
  return [...bloques.entries()].sort((a, b) => b[0] - a[0]).map(([, v]) => v);
}

/** Cambio en puntos porcentuales entre el último dato y el de hace ~`dias` días (null si no hay dato en alguno). */
export function cambioPuntos(serie: PuntoSemanal[], dias = 30): number | null {
  const con = serie.filter((p) => p.pct != null);
  if (con.length < 2) return null;
  const ult = con[con.length - 1];
  const objetivo = aMs(ult.fecha) - dias * DIA_MS;
  // el punto más cercano (hacia atrás) a la fecha objetivo, con tolerancia de una semana
  const previo = [...con].reverse().find((p) => aMs(p.fecha) <= objetivo + 7 * DIA_MS && aMs(p.fecha) < aMs(ult.fecha));
  if (!previo || Math.abs(aMs(previo.fecha) - objetivo) > 10 * DIA_MS) return null;
  return Math.round(((ult.pct as number) - (previo.pct as number)) * 10) / 10;
}

export interface PuntoBanda { fecha: string; p10: number | null; mediana: number | null; p90: number | null }

/** Día del año 1-366 (igual que extract(doy)). */
const doy = (iso: string) => Math.round((aMs(iso) - Date.UTC(Number(iso.slice(0, 4)), 0, 1)) / DIA_MS) + 1;

/**
 * Banda histórica (p10 / mediana / p90 del MISMO día del año, 2017-último año completo) expresada en % del NAMO ACTUAL,
 * alineada con las fechas de la serie. La climatología está en Mm³ (el NAMO cambió con los años); se divide entre el NAMO de
 * hoy para poder dibujarla en el mismo eje 0-100 %. Sin NAMO o sin climatología → null (se rotula el rango de 12 meses).
 */
export function bandaEnPct(clim: FilaClimatologia[] | undefined, fechas: string[], namoMm3: number | null): PuntoBanda[] | null {
  if (!clim || clim.length === 0 || namoMm3 == null || !(namoMm3 > 0)) return null;
  const porDia = new Map(clim.map((c) => [c.diaAnio, c]));
  const pct = (v: number | null) => (v == null ? null : Math.round((v / namoMm3) * 1000) / 10);
  return fechas.map((fecha) => {
    const c = porDia.get(doy(fecha));
    return { fecha, p10: pct(c?.p10 ?? null), mediana: pct(c?.mediana ?? null), p90: pct(c?.p90 ?? null) };
  });
}

/** Rango (mín–máx) de la propia serie de 12 meses: respaldo honesto cuando NO hay climatología. */
export function rangoPropio(serie: PuntoSemanal[]): { min: number; max: number } | null {
  const v = serie.map((p) => p.pct).filter((x): x is number => x != null);
  return v.length ? { min: Math.min(...v), max: Math.max(...v) } : null;
}

// ── Orden y alcance ───────────────────────────────────────────────────────────
export type OrdenCuenca = 'cuenca' | 'llenado' | 'volumen' | 'frescura';

interface Ordenable { ubicacionId: number; pct: number | null; namoMm3: number | null; atrasoDias: number | null }

/**
 * Ordena sin mutar. 'cuenca' conserva el orden recibido (distrito primero, luego aguas arriba → abajo).
 *  · llenado: la MENOS llena primero (la que más atención pide).
 *  · volumen: la de mayor capacidad (NAMO) primero = por tamaño.
 *  · frescura: la más atrasada primero.
 * Los S/D van SIEMPRE al final, nunca como si fueran 0 %.
 */
export function ordenarPresas<T extends Ordenable>(filas: T[], orden: OrdenCuenca): T[] {
  if (orden === 'cuenca') return [...filas];
  const clave = (f: T): number | null =>
    orden === 'llenado' ? f.pct : orden === 'volumen' ? f.namoMm3 : f.atrasoDias;
  return [...filas].sort((a, b) => {
    const ka = clave(a), kb = clave(b);
    if (ka == null && kb == null) return 0;
    if (ka == null) return 1;
    if (kb == null) return -1;
    return orden === 'llenado' ? ka - kb : kb - ka;
  });
}
