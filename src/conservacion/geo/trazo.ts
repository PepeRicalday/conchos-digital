/**
 * Trazo real del canal (geometría pura, sin React ni DOM): polilínea [lon, lat] con arco acumulado en metros, proyección de un
 * punto sobre ella, extracción de sub-tramos y simplificación Douglas-Peucker.
 *
 * Convenciones:
 *  - Distancias a lo largo del trazo (arco) con haversine de R = 6 371 000 m, la misma R de `distanciaKm` (kmALatLng.ts, R = 6371 km).
 *    La diferencia con R = 6 371 008.8 es de 1.4 partes por millón (≈ 0.14 m en 99 km): despreciable.
 *  - La proyección y la distancia punto-trazo se calculan en un plano equirrectangular local del segmento (válido a escala de km).
 *  - El arco del trazo NO es el cadenamiento (PK) del PacOT: el PK declarado tiene saltos; el trazo solo da la forma.
 *  - Las propiedades del GeoJSON (LONGITUD, KM) no se usan como longitud real: solo la geometría.
 */

export const RADIO_TIERRA_M = 6_371_000
const RAD = Math.PI / 180

/** Punto [lon, lat] en grados. */
export type LonLat = readonly [number, number]

export interface Trazo {
  /** Vértices [lon, lat] en orden de recorrido (K-0 → K-98). */
  readonly puntos: readonly LonLat[]
  /** Arco acumulado en metros en cada vértice (arco[0] = 0). */
  readonly arco: readonly number[]
  /** Longitud total (haversine) en metros. */
  readonly longitudM: number
}

export interface ProyeccionTrazo {
  /** Arco (m desde el inicio del trazo) del punto proyectado. */
  readonly arco: number
  /** Distancia en metros del punto al trazo. */
  readonly distancia: number
  /** Índice i del segmento (puntos[i] → puntos[i+1]) sobre el que cae. */
  readonly segmento: number
  /** Punto proyectado sobre el trazo [lon, lat]. */
  readonly punto: LonLat
}

/** Distancia haversine en metros. */
export function haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const a = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2
  return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(a))
}

/** Construye un trazo desde vértices [lon, lat]. Exige ≥ 2 puntos finitos. */
export function trazoDesdePuntos(puntos: readonly LonLat[]): Trazo | null {
  if (puntos.length < 2) return null
  const arco: number[] = [0]
  for (let i = 1; i < puntos.length; i++) {
    const a = puntos[i - 1] as LonLat, b = puntos[i] as LonLat
    if (![a[0], a[1], b[0], b[1]].every(Number.isFinite)) return null
    arco.push((arco[i - 1] as number) + haversineM(a[0], a[1], b[0], b[1]))
  }
  return { puntos, arco, longitudM: arco[arco.length - 1] as number }
}

/**
 * Lee un GeoJSON (FeatureCollection, Feature o geometría) cuyo primer LineString es el trazo. Un MultiLineString se toma si trae
 * una sola línea. Cualquier otra forma → null (no se adivina).
 */
export function parsearTrazoGeoJSON(geo: unknown): Trazo | null {
  const g = geo as { type?: string; features?: unknown[]; geometry?: unknown; coordinates?: unknown } | null
  if (g === null || typeof g !== 'object') return null
  type Geom = { type?: string; coordinates?: unknown }
  let geometria: Geom | null = null
  if (g.type === 'FeatureCollection' && Array.isArray(g.features)) {
    for (const f of g.features) {
      const geom = (f as { geometry?: { type?: string } } | null)?.geometry
      if (geom?.type === 'LineString') { geometria = geom as Geom; break }
    }
  } else if (g.type === 'Feature') geometria = (g.geometry ?? null) as Geom | null
  else if (g.type === 'LineString') geometria = g as Geom
  if (geometria === null || geometria.type !== 'LineString' || !Array.isArray(geometria.coordinates)) return null
  const pts: LonLat[] = []
  for (const c of geometria.coordinates) {
    if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') return null
    pts.push([c[0], c[1]])
  }
  return trazoDesdePuntos(pts)
}

/** Proyecta un punto sobre el segmento más cercano del trazo. null si el trazo no es válido. */
export function proyectarAlTrazo(punto: LonLat, trazo: Trazo): ProyeccionTrazo | null {
  const n = trazo.puntos.length
  if (n < 2) return null
  let mejor: ProyeccionTrazo | null = null
  for (let i = 0; i < n - 1; i++) {
    const a = trazo.puntos[i] as LonLat, b = trazo.puntos[i + 1] as LonLat
    const lat0 = (a[1] + b[1]) / 2
    const kx = RADIO_TIERRA_M * RAD * Math.cos(lat0 * RAD), ky = RADIO_TIERRA_M * RAD
    const bx = (b[0] - a[0]) * kx, by = (b[1] - a[1]) * ky
    const px = (punto[0] - a[0]) * kx, py = (punto[1] - a[1]) * ky
    const l2 = bx * bx + by * by
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / l2))
    const d = Math.hypot(px - t * bx, py - t * by)
    if (mejor === null || d < mejor.distancia) {
      const seg = (trazo.arco[i + 1] as number) - (trazo.arco[i] as number)
      mejor = { arco: (trazo.arco[i] as number) + t * seg, distancia: d, segmento: i, punto: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] }
    }
  }
  return mejor
}

export function distanciaAlTrazo(punto: LonLat, trazo: Trazo): number | null {
  return proyectarAlTrazo(punto, trazo)?.distancia ?? null
}

/** Índice i tal que arco[i] ≤ a < arco[i+1] (acotado a [0, n−2]). */
function segmentoDeArco(trazo: Trazo, a: number): number {
  let lo = 0, hi = trazo.arco.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((trazo.arco[mid] as number) <= a) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Punto del trazo a `arco` metros del inicio. null fuera de [0, longitud] (no se extrapola). */
export function puntoEnArco(trazo: Trazo, arco: number): LonLat | null {
  if (!Number.isFinite(arco) || arco < 0 || arco > trazo.longitudM || trazo.puntos.length < 2) return null
  const i = segmentoDeArco(trazo, arco)
  const a = trazo.puntos[i] as LonLat, b = trazo.puntos[i + 1] as LonLat
  const seg = (trazo.arco[i + 1] as number) - (trazo.arco[i] as number)
  const t = seg === 0 ? 0 : (arco - (trazo.arco[i] as number)) / seg
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
}

/**
 * Polilínea del trazo entre dos arcos: el punto interpolado exacto en A, los vértices del trazo con arco estrictamente entre A y B,
 * y el punto interpolado exacto en B. Si A > B se invierten (el orden resultante es el del trazo). Fuera de [0, longitud] se acota.
 */
export function subtrazo(trazo: Trazo, arcoA: number, arcoB: number): Array<[number, number]> {
  const a = Math.max(0, Math.min(arcoA, arcoB)), b = Math.min(trazo.longitudM, Math.max(arcoA, arcoB))
  if (!(b >= a)) return []
  const pa = puntoEnArco(trazo, a), pb = puntoEnArco(trazo, b)
  if (pa === null || pb === null) return []
  const out: Array<[number, number]> = [[pa[0], pa[1]]]
  for (let i = segmentoDeArco(trazo, a) + 1; i < trazo.puntos.length; i++) {
    if ((trazo.arco[i] as number) >= b) break
    if ((trazo.arco[i] as number) > a) { const p = trazo.puntos[i] as LonLat; out.push([p[0], p[1]]) }
  }
  if (b > a) out.push([pb[0], pb[1]])
  return out
}

/**
 * Douglas-Peucker en plano equirrectangular local (lat media). Conserva siempre el primer y el último punto. `tolM` en metros.
 * Sobre el trazo real: 10 m ≈ 300 puntos, 50 m ≈ 145 (de 1 233).
 */
export function simplificarDP(pol: readonly LonLat[], tolM: number): Array<[number, number]> {
  const n = pol.length
  if (n <= 2) return pol.map((p) => [p[0], p[1]])
  const lat0 = pol.reduce((s, p) => s + p[1], 0) / n
  const kx = RADIO_TIERRA_M * RAD * Math.cos(lat0 * RAD), ky = RADIO_TIERRA_M * RAD
  const xs = pol.map((p) => p[0] * kx), ys = pol.map((p) => p[1] * ky)
  const conservar = new Uint8Array(n)
  conservar[0] = 1; conservar[n - 1] = 1
  const pila: Array<[number, number]> = [[0, n - 1]]
  while (pila.length > 0) {
    const [i0, i1] = pila.pop() as [number, number]
    const ax = xs[i0] as number, ay = ys[i0] as number, dx = (xs[i1] as number) - ax, dy = (ys[i1] as number) - ay
    const l2 = dx * dx + dy * dy
    let dMax = -1, k = -1
    for (let i = i0 + 1; i < i1; i++) {
      const px = (xs[i] as number) - ax, py = (ys[i] as number) - ay
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / l2))
      const d = Math.hypot(px - t * dx, py - t * dy)
      if (d > dMax) { dMax = d; k = i }
    }
    if (k >= 0 && dMax > tolM) { conservar[k] = 1; pila.push([i0, k], [k, i1]) }
  }
  const out: Array<[number, number]> = []
  for (let i = 0; i < n; i++) if (conservar[i] === 1) out.push([(pol[i] as LonLat)[0], (pol[i] as LonLat)[1]])
  return out
}

/** Distancia (m) de un punto a una polilínea [lon, lat] cualquiera, en plano local. null si tiene < 2 puntos. */
export function distanciaAPolilineaM(punto: LonLat, pol: readonly LonLat[]): number | null {
  if (pol.length < 2) return null
  let min = Infinity
  for (let i = 0; i < pol.length - 1; i++) {
    const a = pol[i] as LonLat, b = pol[i + 1] as LonLat
    const kx = RADIO_TIERRA_M * RAD * Math.cos(((a[1] + b[1]) / 2) * RAD), ky = RADIO_TIERRA_M * RAD
    const bx = (b[0] - a[0]) * kx, by = (b[1] - a[1]) * ky, px = (punto[0] - a[0]) * kx, py = (punto[1] - a[1]) * ky
    const l2 = bx * bx + by * by
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / l2))
    min = Math.min(min, Math.hypot(px - t * bx, py - t * by))
  }
  return min
}
