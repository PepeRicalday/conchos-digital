import { limpiarPK } from '../nucleo/num/pk'
import type { FichaCanal, PuntoCanal, Ramal } from '../derivacion/tipos'
import { proyectarAlTrazo, puntoEnArco, subtrazo } from './trazo'
import type { Trazo } from './trazo'

/**
 * Eje del canal a partir de los vértices REALES del inventario (IO1: extremos de cada tramo con su cadenamiento y coordenadas
 * declaradas). El cadenamiento se interpola linealmente entre vértices; fuera del primero y del último vértice no hay respuesta
 * (null): no se extrapola. El ramal auxiliar tiene su propio eje (su PK reinicia en 0) anclado al PK del principal donde nace;
 * los PK de un eje nunca se mezclan con los del otro.
 *
 * Una posición solo es exacta (`estimada: false`) si coincide con un vértice declarado; todo lo demás es interpolación.
 *
 * TRAZO REAL (opcional). Si `construirEjes` recibe el trazo del canal (geo/trazo.ts), el eje principal gana una tabla de ANCLAS
 * [pk, arco, d]: cada vértice declarado válido se proyecta al trazo; se descartan los que quedan a más de `DISTANCIA_MAX_ANCLA_M`
 * y los que rompen la monotonía arco↔PK (se conserva la subsecuencia creciente más larga, y se avisa). Entre anclas vecinas el
 * PK se interpola por ARCO del trazo (el contorno real, no la cuerda). Fuera del rango de anclas no se extrapola: null. Los saltos
 * de cadenamiento (razón Δarco/ΔPK fuera de [0.97, 1.03]) se marcan, no se corrigen. El eje auxiliar NUNCA recibe trazo (no está en él).
 * Sin trazo el comportamiento es el de siempre (cuerda entre vértices).
 */

export interface Vertice {
  /** Cadenamiento en metros dentro de su propio eje. */
  readonly metros: number
  readonly lon: number
  readonly lat: number
  /** 'declarado' = coordenadas del inventario; 'ancla' = tomado del eje principal en el PK donde nace el ramal. */
  readonly origen: 'declarado' | 'ancla'
}

/**
 * Calidad de una posición:
 *  'declarada'   coordenadas del inventario tal cual (vértice sin trazo, o coordenadas válidas de una estructura);
 *  'ancla'       vértice declarado que se proyectó al trazo con d ≤ 50 m (respaldado por el contorno real);
 *  'interpolada' entre dos anclas, siguiendo el arco del trazo;
 *  'estimada'    posición calculada por PK a partir de datos defectuosos (coordenadas inválidas) o anclada en otro eje;
 *  'cuerda'      línea recta entre vértices: sin contorno real.
 */
export type CalidadPunto = 'declarada' | 'ancla' | 'interpolada' | 'estimada' | 'cuerda'

/** Vértice declarado proyectado al trazo. `pk` y `arco` en metros; `d` = distancia al trazo en metros. */
export interface Ancla {
  readonly pk: number
  readonly arco: number
  readonly d: number
  /** Coordenadas declaradas (no las proyectadas). */
  readonly lon: number
  readonly lat: number
}

export interface AnclaDescartada {
  readonly pk: number
  readonly arco: number
  readonly d: number
  readonly motivo: 'lejos_del_trazo' | 'rompe_monotonia'
}

/** Par de anclas vecinas cuya razón Δarco/ΔPK queda fuera de [RAZON_SALTO_MIN, RAZON_SALTO_MAX]: el cadenamiento declarado no concuerda con la distancia del trazo. */
export interface SaltoCadenamiento {
  readonly pkIni: number
  readonly pkFin: number
  readonly arcoIni: number
  readonly arcoFin: number
  readonly deltaPkM: number
  readonly deltaArcoM: number
  readonly razon: number
}

export interface EjeCanal {
  readonly ramal: Ramal
  readonly vertices: readonly Vertice[]
  /** Solo si se construyó con trazo (eje principal). */
  readonly trazo?: Trazo
  readonly anclas?: readonly Ancla[]
  readonly anclasDescartadas?: readonly AnclaDescartada[]
  readonly saltos?: readonly SaltoCadenamiento[]
}

export interface PuntoEje {
  readonly lon: number
  readonly lat: number
  /** false solo si es exactamente un vértice declarado del inventario. */
  readonly estimada: boolean
  /** Presente solo en ejes construidos con trazo (ver `posicionPK` para obtenerla siempre). */
  readonly calidad?: CalidadPunto
}

export interface PuntoEjeCalidad extends PuntoEje { readonly calidad: CalidadPunto }

/** Un extremo de tramo con cadenamiento pero sin coordenadas completas: no es vértice y su posición, si se pide, será estimada. */
export interface PuntoSinCoordenadas {
  readonly ramal: Ramal
  readonly pk: string
  readonly metros: number
  readonly refs: readonly string[]
  readonly motivo: string
}

export interface EjesCanal {
  readonly principal: EjeCanal
  readonly auxiliar: EjeCanal | null
  readonly sinCoordenadas: readonly PuntoSinCoordenadas[]
  /** Extremos que coinciden en PK pero difieren en coordenadas (más de `TOLERANCIA_COINCIDENCIA_M`). */
  readonly conflictos: readonly string[]
  /** PK del principal donde nace el auxiliar, en metros; null si no se pudo leer. */
  readonly anclaMetros: number | null
  /** Avisos de la construcción con trazo (anclas descartadas, saltos de cadenamiento). Vacío sin trazo. */
  readonly avisosTrazo?: readonly string[]
}

export const TOLERANCIA_COINCIDENCIA_M = 5
/** Un vértice a más de esta distancia del trazo no sirve de ancla. */
export const DISTANCIA_MAX_ANCLA_M = 50
/** Razón Δarco/ΔPK aceptable entre anclas vecinas; fuera de ella hay un «salto de cadenamiento». */
export const RAZON_SALTO_MIN = 0.97
export const RAZON_SALTO_MAX = 1.03

/**
 * Distancia haversine en km (R = 6371), la misma fórmula que `distanciaKm` de src/utils/interpolacionClima.ts. Se repite aquí porque ese
 * archivo no compila bajo el tsconfig estricto de conservación (noUncheckedIndexedAccess) y no debe arrastrarse al núcleo.
 */
export function distanciaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(a))
}

/** `k+mmm` → metros, o null. */
export function pkAMetros(pk: string | null | undefined): number | null {
  if (pk === null || pk === undefined) return null
  return limpiarPK(`K-${pk}`).metros
}

/** metros → `k+mmm`. */
export function metrosAPk(m: number): string {
  const e = Math.round(m)
  return `${Math.floor(e / 1000)}+${String(e % 1000).padStart(3, '0')}`
}

const estaCompleto = (p: PuntoCanal): p is PuntoCanal & { lon: number; lat: number; pk: string } => p.lon !== null && p.lat !== null && p.pk !== null

function interpola(a: Vertice, b: Vertice, metros: number): { lon: number; lat: number } {
  const t = (metros - a.metros) / (b.metros - a.metros)
  return { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t }
}

/** ¿Este eje tiene contorno real (trazo con al menos 2 anclas)? */
export const usaTrazo = (eje: EjeCanal): boolean => eje.trazo !== undefined && eje.anclas !== undefined && eje.anclas.length >= 2

const aMetros = (pk: number | string): number | null => {
  const m = typeof pk === 'number' ? pk : pkAMetros(pk)
  return m === null || !Number.isFinite(m) ? null : m
}

/** Posición por cuerda (línea recta entre vértices declarados): el comportamiento sin trazo. */
function posicionCuerda(metros: number, eje: EjeCanal): PuntoEjeCalidad | null {
  const v = eje.vertices
  const primero = v[0], ultimo = v[v.length - 1]
  if (primero === undefined || ultimo === undefined || metros < primero.metros || metros > ultimo.metros) return null
  for (let i = 0; i < v.length; i++) {
    const a = v[i]
    if (a === undefined) continue
    if (a.metros === metros) return { lon: a.lon, lat: a.lat, estimada: a.origen !== 'declarado', calidad: a.origen === 'declarado' ? 'declarada' : 'estimada' }
    const b = v[i + 1]
    if (b !== undefined && metros > a.metros && metros < b.metros) return { ...interpola(a, b, metros), estimada: true, calidad: 'cuerda' }
  }
  return null
}

/** Arco del trazo (m) que corresponde a un PK, interpolando entre anclas vecinas. null sin trazo o fuera del rango de anclas. */
export function arcoDePK(pk: number | string, eje: EjeCanal): number | null {
  const m = aMetros(pk)
  const an = eje.anclas
  if (m === null || an === undefined || !usaTrazo(eje)) return null
  const primera = an[0] as Ancla, ultima = an[an.length - 1] as Ancla
  if (m < primera.pk || m > ultima.pk) return null
  for (let i = 0; i < an.length - 1; i++) {
    const a = an[i] as Ancla, b = an[i + 1] as Ancla
    if (m >= a.pk && m <= b.pk) return a.arco + ((m - a.pk) * (b.arco - a.arco)) / (b.pk - a.pk)
  }
  return null
}

/**
 * Posición de un cadenamiento con su CALIDAD. Con trazo: ancla exacta → coordenadas declaradas ('ancla'); entre anclas →
 * punto del trazo a ese arco ('interpolada'); fuera del rango de anclas → null (no se extrapola). Sin trazo: cuerda entre vértices.
 */
export function posicionPK(pk: number | string, eje: EjeCanal): PuntoEjeCalidad | null {
  const metros = aMetros(pk)
  if (metros === null) return null
  if (!usaTrazo(eje)) return posicionCuerda(metros, eje)
  const an = eje.anclas as readonly Ancla[]
  const exacta = an.find((a) => a.pk === metros)
  if (exacta !== undefined) return { lon: exacta.lon, lat: exacta.lat, estimada: false, calidad: 'ancla' }
  const arco = arcoDePK(metros, eje)
  const p = arco === null || eje.trazo === undefined ? null : puntoEnArco(eje.trazo, arco)
  return p === null ? null : { lon: p[0], lat: p[1], estimada: true, calidad: 'interpolada' }
}

/**
 * Posición de un cadenamiento (metros o `k+mmm`) sobre un eje. null = fuera del rango de los vértices (o de las anclas, con trazo).
 * En ejes SIN trazo el resultado es el de siempre ({lon, lat, estimada}); con trazo añade `calidad`.
 */
export function kmALatLng(pk: number | string, eje: EjeCanal): PuntoEje | null {
  const p = posicionPK(pk, eje)
  if (p === null) return null
  return eje.trazo === undefined ? { lon: p.lon, lat: p.lat, estimada: p.estimada } : p
}

export interface SubtrazoPK {
  /** Polilínea [lon, lat] del tramo; vacía si ni el trazo ni la cuerda pueden situarlo. */
  readonly puntos: Array<[number, number]>
  /** 'ancla' = ambos extremos son anclas; 'interpolada' = al menos uno entre anclas; 'cuerda' = recta entre vértices (sin contorno real). */
  readonly calidad: 'ancla' | 'interpolada' | 'cuerda'
  readonly arcoIni: number | null
  readonly arcoFin: number | null
}

/** Cuerda del tramo: extremos interpolados + vértices declarados intermedios (lo que se dibujaba antes del trazo). */
export function cuerdaPorPK(eje: EjeCanal, pkA: number | string, pkB: number | string): Array<[number, number]> {
  const a0 = aMetros(pkA), b0 = aMetros(pkB)
  if (a0 === null || b0 === null) return []
  const a = Math.min(a0, b0), b = Math.max(a0, b0)
  const pa = posicionCuerda(a, eje), pb = posicionCuerda(b, eje)
  if (pa === null || pb === null) return []
  const pts: Array<[number, number]> = [[pa.lon, pa.lat]]
  for (const v of eje.vertices) if (v.metros > a && v.metros < b) pts.push([v.lon, v.lat])
  pts.push([pb.lon, pb.lat])
  return pts.length < 2 ? [] : pts
}

/**
 * Polilínea [lon, lat] del tramo [pkA, pkB] siguiendo el trazo (extremos exactos en las anclas o interpolados por arco). Sin trazo,
 * sin ancla suficiente o con un extremo fuera del rango de anclas: la cuerda, con calidad 'cuerda' (el llamador la rotula «sin contorno real»).
 * Los extremos son puntos DEL TRAZO (una ancla declarada puede estar hasta 50 m a un lado: el marcador va en la coordenada declarada).
 */
export function subtrazoPorPK(eje: EjeCanal, pkA: number | string, pkB: number | string): SubtrazoPK {
  const a0 = aMetros(pkA), b0 = aMetros(pkB)
  if (a0 === null || b0 === null) return { puntos: [], calidad: 'cuerda', arcoIni: null, arcoFin: null }
  const a = Math.min(a0, b0), b = Math.max(a0, b0)
  const arcoA = arcoDePK(a, eje), arcoB = arcoDePK(b, eje)
  if (eje.trazo !== undefined && arcoA !== null && arcoB !== null) {
    const an = eje.anclas as readonly Ancla[]
    const ambas = an.some((x) => x.pk === a) && an.some((x) => x.pk === b)
    return { puntos: subtrazo(eje.trazo, arcoA, arcoB), calidad: ambas ? 'ancla' : 'interpolada', arcoIni: arcoA, arcoFin: arcoB }
  }
  return { puntos: cuerdaPorPK(eje, a, b), calidad: 'cuerda', arcoIni: null, arcoFin: null }
}

/** Distancia geodésica en km entre dos vértices. */
export const distanciaVerticesKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number => distanciaKm(a.lat, a.lon, b.lat, b.lon)

/** Proyecta los vértices declarados al trazo y arma la tabla de anclas (ver cabecera del archivo). */
function construirAnclas(vertices: readonly Vertice[], trazo: Trazo, avisos: string[]): { anclas: Ancla[]; anclasDescartadas: AnclaDescartada[]; saltos: SaltoCadenamiento[] } {
  const descartadas: AnclaDescartada[] = []
  const cand: Ancla[] = []
  for (const v of vertices) {
    if (v.origen !== 'declarado') continue
    const pr = proyectarAlTrazo([v.lon, v.lat], trazo)
    if (pr === null) continue
    if (pr.distancia > DISTANCIA_MAX_ANCLA_M) {
      descartadas.push({ pk: v.metros, arco: pr.arco, d: pr.distancia, motivo: 'lejos_del_trazo' })
      avisos.push(`K-${metrosAPk(v.metros)}: el vértice declarado queda a ${pr.distancia.toFixed(0)} m del trazo (> ${DISTANCIA_MAX_ANCLA_M} m); no se usa como ancla.`)
    } else cand.push({ pk: v.metros, arco: pr.arco, d: pr.distancia, lon: v.lon, lat: v.lat })
  }
  // Monotonía: se conserva la subsecuencia de arco estrictamente creciente (con PK creciente) más larga; el resto rompe la monotonía.
  const n = cand.length
  const largo = new Array<number>(n).fill(1), prev = new Array<number>(n).fill(-1)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if ((cand[j] as Ancla).arco < (cand[i] as Ancla).arco && (largo[j] as number) + 1 > (largo[i] as number)) { largo[i] = (largo[j] as number) + 1; prev[i] = j }
    }
  }
  let fin = -1
  for (let i = 0; i < n; i++) if (fin < 0 || (largo[i] as number) > (largo[fin] as number)) fin = i
  const quedan = new Set<number>()
  for (let i = fin; i >= 0; i = prev[i] as number) quedan.add(i)
  const anclas: Ancla[] = []
  cand.forEach((a, i) => {
    if (quedan.has(i)) anclas.push(a)
    else {
      descartadas.push({ pk: a.pk, arco: a.arco, d: a.d, motivo: 'rompe_monotonia' })
      avisos.push(`K-${metrosAPk(a.pk)}: su posición a lo largo del trazo (${a.arco.toFixed(0)} m) rompe la monotonía con el cadenamiento; no se usa como ancla.`)
    }
  })
  descartadas.sort((x, y) => x.pk - y.pk)
  const saltos: SaltoCadenamiento[] = []
  for (let i = 0; i < anclas.length - 1; i++) {
    const a = anclas[i] as Ancla, b = anclas[i + 1] as Ancla
    const dPk = b.pk - a.pk, dArco = b.arco - a.arco
    const razon = dArco / dPk
    if (razon < RAZON_SALTO_MIN || razon > RAZON_SALTO_MAX) {
      saltos.push({ pkIni: a.pk, pkFin: b.pk, arcoIni: a.arco, arcoFin: b.arco, deltaPkM: dPk, deltaArcoM: dArco, razon })
      avisos.push(`Salto de cadenamiento K-${metrosAPk(a.pk)} → K-${metrosAPk(b.pk)}: ${dPk.toFixed(0)} m declarados contra ${dArco.toFixed(0)} m de trazo (razón ${razon.toFixed(2)}).`)
    }
  }
  return { anclas, anclasDescartadas: descartadas, saltos }
}

/**
 * Construye los ejes con los extremos de las fichas de IO1. `anclaMetros` es el PK del principal donde nace el auxiliar
 * (del nombre «CANAL AUXILIAR K-68+582»). Si el auxiliar no trae vértice declarado en su PK 0, se ancla con el del principal.
 * `trazo` (opcional): contorno real del canal; solo el eje principal lo recibe.
 */
export function construirEjes(fichas: readonly FichaCanal[], anclaMetros: number | null, trazo?: Trazo | null): EjesCanal {
  const porRamal: Record<Ramal, Map<number, Vertice>> = { principal: new Map(), auxiliar: new Map() }
  const faltantes: Record<Ramal, Map<number, { refs: string[]; motivos: Set<string> }>> = { principal: new Map(), auxiliar: new Map() }
  const conflictos: string[] = []
  for (const f of fichas) {
    const ramal: Ramal = f.ramal ?? 'principal'
    for (const p of [f.ini, f.fin]) {
      if (p === undefined) continue
      const m = pkAMetros(p.pk)
      if (m === null) continue
      if (estaCompleto(p)) {
        const previo = porRamal[ramal].get(m)
        if (previo === undefined) { porRamal[ramal].set(m, { metros: m, lon: p.lon, lat: p.lat, origen: 'declarado' }); continue }
        const d = distanciaKm(previo.lat, previo.lon, p.lat, p.lon) * 1000
        if (d > TOLERANCIA_COINCIDENCIA_M) conflictos.push(`${p.refLon}: el punto K-${p.pk} difiere ${d.toFixed(0)} m del mismo cadenamiento en otra fila; se conserva el primero.`)
      } else {
        const e = faltantes[ramal].get(m) ?? { refs: [], motivos: new Set<string>() }
        e.refs.push(p.refLon, p.refLat)
        const mot: string[] = []
        if (p.lon === null) mot.push(`longitud ${p.defectoLon ?? 'S/D'}`)
        if (p.lat === null) mot.push(`latitud ${p.defectoLat ?? 'S/D'}`)
        e.motivos.add(mot.join(' y '))
        faltantes[ramal].set(m, e)
      }
    }
  }
  const ordenar = (mp: Map<number, Vertice>): Vertice[] => [...mp.values()].sort((a, b) => a.metros - b.metros)
  const verticesPrincipal = ordenar(porRamal.principal)
  const avisosTrazo: string[] = []
  const principal: EjeCanal = trazo === undefined || trazo === null
    ? { ramal: 'principal', vertices: verticesPrincipal }
    : { ramal: 'principal', vertices: verticesPrincipal, trazo, ...construirAnclas(verticesPrincipal, trazo, avisosTrazo) }
  // Un cadenamiento que otra fila sí declara completo no está «sin coordenadas».
  const sinCoordenadas: PuntoSinCoordenadas[] = []
  for (const ramal of ['principal', 'auxiliar'] as const) {
    for (const [m, e] of [...faltantes[ramal]].sort((a, b) => a[0] - b[0])) {
      if (porRamal[ramal].has(m)) continue
      sinCoordenadas.push({ ramal, pk: metrosAPk(m), metros: m, refs: [...new Set(e.refs)], motivo: [...e.motivos].join('; ') })
    }
  }
  let auxiliar: EjeCanal | null = null
  if (porRamal.auxiliar.size > 0 || faltantes.auxiliar.size > 0) {
    const mapa = new Map(porRamal.auxiliar)
    if (anclaMetros !== null && !mapa.has(0)) {
      const p = kmALatLng(anclaMetros, principal)
      if (p !== null) mapa.set(0, { metros: 0, lon: p.lon, lat: p.lat, origen: 'ancla' })
    }
    auxiliar = { ramal: 'auxiliar', vertices: ordenar(mapa) }
  }
  return { principal, auxiliar, sinCoordenadas, conflictos, anclaMetros, avisosTrazo }
}

/** Eje que corresponde al ramal de una obra. */
export const ejeDe = (ejes: EjesCanal, ramal: Ramal): EjeCanal | null => (ramal === 'auxiliar' ? ejes.auxiliar : ejes.principal)
