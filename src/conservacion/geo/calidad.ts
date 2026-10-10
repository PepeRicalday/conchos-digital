import type { Estructura, FichaCanal, FichasInventario, Ramal } from '../derivacion/tipos'
import { cuerdaPorPK, distanciaKm, ejeDe, kmALatLng, pkAMetros, subtrazoPorPK, usaTrazo } from './kmALatLng'
import type { Ancla, AnclaDescartada, EjeCanal, EjesCanal, SaltoCadenamiento } from './kmALatLng'
import { distanciaAPolilineaM, haversineM } from './trazo'
import type { LonLat } from './trazo'

/**
 * Calidad geométrica del inventario: ¿las coordenadas declaradas son coherentes con el cadenamiento?
 *
 * Por tramo se compara la distancia geodésica en línea recta entre sus dos extremos (Δ coordenadas) con su longitud por
 * cadenamiento (Δ PK). El canal es sinuoso, así que la cuerda es igual o menor que el recorrido: razón = geodésica / cadenamiento
 * ≤ 1 (con holgura de medición). Una razón > 1 + holgura es imposible y delata coordenadas o cadenamiento mal capturados; una razón
 * muy baja es un tramo muy curvo o un punto mal ubicado. Es un dato técnico: no corrige nada.
 */

/** Holgura de la razón > 1: la precisión de los DMS (centésimas de segundo, ~0.3 m) y de los PK (1 m) en tramos de ~1 km. */
export const HOLGURA_RAZON = 0.01
/** Debajo de esta razón la cuerda es menos de la mitad del recorrido: tramo anómalo o punto mal ubicado. */
export const RAZON_MINIMA = 0.5

export interface TramoCalidad {
  readonly fila: number
  readonly ramal: Ramal
  readonly pkIni: string
  readonly pkFin: string
  readonly kmCadenamiento: number
  readonly kmGeodesico: number
  /** (geodésica − cadenamiento) en metros: negativo = la cuerda es más corta (lo normal). */
  readonly diferenciaM: number
  readonly razon: number
  readonly motivo: 'razon_mayor_que_1' | 'razon_muy_baja' | null
}

export interface ResumenCalidad {
  readonly tramos: readonly TramoCalidad[]
  /** Tramos sin los dos extremos completos (no se pueden comparar). */
  readonly omitidos: readonly { readonly fila: number; readonly motivo: string }[]
  readonly maxAbsM: number | null
  readonly medianaAbsM: number | null
  readonly maxRazon: number | null
  readonly minRazon: number | null
  readonly medianaRazon: number | null
  readonly atipicos: readonly TramoCalidad[]
}

const mediana = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2
}

export function calidadGeometrica(fichas: readonly FichaCanal[]): ResumenCalidad {
  const tramos: TramoCalidad[] = []
  const omitidos: { fila: number; motivo: string }[] = []
  for (const f of fichas) {
    const { ini, fin } = f
    if (ini === undefined || fin === undefined) { omitidos.push({ fila: f.fila, motivo: 'la ficha no trae extremos (extractor anterior a v4)' }); continue }
    const a = pkAMetros(ini.pk), b = pkAMetros(fin.pk)
    if (a === null || b === null || ini.lon === null || ini.lat === null || fin.lon === null || fin.lat === null) {
      omitidos.push({ fila: f.fila, motivo: 'falta cadenamiento o una coordenada en un extremo' })
      continue
    }
    const kmCad = (b - a) / 1000
    if (kmCad <= 0) { omitidos.push({ fila: f.fila, motivo: 'cadenamiento no creciente' }); continue }
    const kmGeo = distanciaKm(ini.lat, ini.lon, fin.lat, fin.lon)
    const razon = kmGeo / kmCad
    tramos.push({
      fila: f.fila, ramal: f.ramal ?? 'principal', pkIni: ini.pk as string, pkFin: fin.pk as string, kmCadenamiento: kmCad, kmGeodesico: kmGeo,
      diferenciaM: (kmGeo - kmCad) * 1000, razon,
      motivo: razon > 1 + HOLGURA_RAZON ? 'razon_mayor_que_1' : razon < RAZON_MINIMA ? 'razon_muy_baja' : null,
    })
  }
  const abs = tramos.map((t) => Math.abs(t.diferenciaM))
  const razones = tramos.map((t) => t.razon)
  return {
    tramos, omitidos,
    maxAbsM: abs.length === 0 ? null : Math.max(...abs), medianaAbsM: mediana(abs),
    maxRazon: razones.length === 0 ? null : Math.max(...razones), minRazon: razones.length === 0 ? null : Math.min(...razones), medianaRazon: mediana(razones),
    atipicos: tramos.filter((t) => t.motivo !== null),
  }
}

export interface DesviacionEstructura {
  readonly fila: number
  readonly tipoCrudo: string
  readonly pk: string
  /** Distancia en metros entre las coordenadas declaradas y la posición interpolada con su cadenamiento. */
  readonly metros: number
}

/**
 * Para las estructuras con coordenadas Y cadenamiento válidos: ¿qué tan lejos cae lo declarado de lo que dice el eje? La
 * interpolación es una cuerda entre vértices, así que una desviación de decenas de metros es normal en tramos sinuosos; cientos
 * o miles de metros apuntan a un PK o una coordenada mal capturados.
 */
export function desviacionEstructuras(estructuras: readonly Estructura[], ejes: EjesCanal): { filas: DesviacionEstructura[]; maxM: number | null; medianaM: number | null } {
  const filas: DesviacionEstructura[] = []
  for (const e of estructuras) {
    if (e.ubicacion.estado !== 'valida' || e.pkMetros === null || e.lon === null || e.lat === null) continue
    const eje = ejeDe(ejes, e.ramal)
    const p = eje === null ? null : kmALatLng(e.pkMetros, eje)
    if (p === null) continue
    filas.push({ fila: e.fila, tipoCrudo: e.tipoCrudo, pk: e.pk as string, metros: distanciaKm(e.lat, e.lon, p.lat, p.lon) * 1000 })
  }
  const m = filas.map((x) => x.metros)
  return { filas, maxM: m.length === 0 ? null : Math.max(...m), medianaM: mediana(m) }
}

/* ───────────────────────── contorno real (trazo) ───────────────────────── */

/** Un tramo se considera respaldado por un ancla si está a menos de esta distancia de cadenamiento de ella. */
export const RADIO_RESPALDO_M = 1000

export interface ResumenContornoEje {
  readonly conTrazo: boolean
  readonly nAnclas: number
  readonly anclasDescartadas: readonly AnclaDescartada[]
  readonly saltos: readonly SaltoCadenamiento[]
  /** Distancia al trazo de las anclas usadas: mediana y máxima (m). */
  readonly medianaDistanciaAnclaM: number | null
  readonly maxDistanciaAnclaM: number | null
  /** Rango de PK (m) cubierto por anclas; fuera de él no hay contorno (null sin trazo). */
  readonly rangoPk: readonly [number, number] | null
}

export function resumenContornoEje(eje: EjeCanal): ResumenContornoEje {
  const an = eje.anclas ?? []
  const d = an.map((a) => a.d)
  const conTrazo = usaTrazo(eje)
  return {
    conTrazo, nAnclas: an.length, anclasDescartadas: eje.anclasDescartadas ?? [], saltos: eje.saltos ?? [],
    medianaDistanciaAnclaM: mediana(d), maxDistanciaAnclaM: d.length === 0 ? null : Math.max(...d),
    rangoPk: conTrazo ? [(an[0] as Ancla).pk, (an[an.length - 1] as Ancla).pk] : null,
  }
}

export interface ResumenContornoTramo {
  readonly calidad: 'ancla' | 'interpolada' | 'cuerda'
  readonly nAnclasEnTramo: number
  /** Fracción [0, 1] de la longitud del tramo a ≤ `RADIO_RESPALDO_M` (en cadenamiento) de alguna ancla; null sin contorno real. */
  readonly respaldoAncla: number | null
  /** Máxima distancia de cadenamiento (m) de un punto del tramo a su ancla más cercana; null sin contorno real. */
  readonly maxDistanciaAnclaPkM: number | null
  readonly saltosEnTramo: readonly SaltoCadenamiento[]
  /** Longitud del contorno (m) y de la cuerda recta entre vértices (m); null si no se pudo situar. */
  readonly longitudContornoM: number | null
  readonly longitudCuerdaM: number | null
  /** Desviación máxima (Hausdorff, m) entre la cuerda y el contorno: lo que la línea recta ocultaba. null sin contorno real. */
  readonly desviacionCuerdaMaxM: number | null
}

const largoM = (pol: readonly LonLat[]): number => {
  let s = 0
  for (let i = 1; i < pol.length; i++) s += haversineM((pol[i - 1] as LonLat)[0], (pol[i - 1] as LonLat)[1], (pol[i] as LonLat)[0], (pol[i] as LonLat)[1])
  return s
}

/** Muestrea una polilínea cada ~`paso` m (incluye los vértices). */
function densificar(pol: readonly LonLat[], paso: number): LonLat[] {
  const out: LonLat[] = []
  for (let i = 0; i < pol.length - 1; i++) {
    const a = pol[i] as LonLat, b = pol[i + 1] as LonLat
    const n = Math.max(1, Math.ceil(haversineM(a[0], a[1], b[0], b[1]) / paso))
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  if (pol.length > 0) out.push(pol[pol.length - 1] as LonLat)
  return out
}

/** Desviación máxima entre dos polilíneas (Hausdorff simétrico, muestreando cada 10 m). */
export function desviacionMaximaM(a: readonly LonLat[], b: readonly LonLat[]): number | null {
  if (a.length < 2 || b.length < 2) return null
  let max = 0
  for (const p of densificar(a, 10)) max = Math.max(max, distanciaAPolilineaM(p, b) ?? 0)
  for (const p of densificar(b, 10)) max = Math.max(max, distanciaAPolilineaM(p, a) ?? 0)
  return max
}

/** Calidad del contorno de un tramo [pkA, pkB] (metros o `k+mmm`) y comparación cuerda-vs-trazo. */
export function resumenContornoTramo(eje: EjeCanal, pkA: number | string, pkB: number | string): ResumenContornoTramo {
  const sub = subtrazoPorPK(eje, pkA, pkB)
  const ma = typeof pkA === 'number' ? pkA : pkAMetros(pkA), mb = typeof pkB === 'number' ? pkB : pkAMetros(pkB)
  const cuerda = cuerdaPorPK(eje, pkA, pkB)
  const base = { longitudContornoM: sub.puntos.length < 2 ? null : largoM(sub.puntos), longitudCuerdaM: cuerda.length < 2 ? null : largoM(cuerda) }
  if (sub.calidad === 'cuerda' || ma === null || mb === null) {
    return { calidad: 'cuerda', nAnclasEnTramo: 0, respaldoAncla: null, maxDistanciaAnclaPkM: null, saltosEnTramo: [], desviacionCuerdaMaxM: null, ...base }
  }
  const a = Math.min(ma, mb), b = Math.max(ma, mb)
  const pks = (eje.anclas ?? []).map((x) => x.pk)
  const dentro = pks.filter((p) => p >= a && p <= b)
  let cubierto = 0, hasta = a
  for (const p of pks) {
    const i0 = Math.max(a, p - RADIO_RESPALDO_M, hasta), i1 = Math.min(b, p + RADIO_RESPALDO_M)
    if (i1 > i0) { cubierto += i1 - i0; hasta = i1 }
  }
  const cercana = (x: number): number => Math.min(...pks.map((p) => Math.abs(p - x)))
  const bordes = [a, ...dentro.filter((p) => p > a && p < b), b]
  const candidatos = bordes.slice(0, -1).map((v, i) => (v + (bordes[i + 1] as number)) / 2)
  return {
    calidad: sub.calidad, nAnclasEnTramo: dentro.length, respaldoAncla: b > a ? Math.min(1, cubierto / (b - a)) : 1,
    maxDistanciaAnclaPkM: Math.max(cercana(a), cercana(b), ...candidatos.map(cercana)),
    saltosEnTramo: (eje.saltos ?? []).filter((s) => s.pkFin > a && s.pkIni < b),
    desviacionCuerdaMaxM: desviacionMaximaM(cuerda, sub.puntos), ...base,
  }
}

/**
 * Contradicción conocida del PacOT de la SRL: IO3 (caminos) declara el final del camino del canal en ~98+850, sobre la misma
 * coordenada donde IO1 pone K-98+951 (~100 m). Se expone como dato; null si IO3 no trae caminos o IO1 no trae final.
 * `diferenciaM` = PK final del canal principal (IO1) − PK final del camino más largo (IO3), ambos declarados.
 */
export interface ContradiccionFinCamino { readonly pkCanal: string; readonly pkCamino: string; readonly diferenciaM: number; readonly fila: number }

export function contradiccionFinCamino(fichas: Pick<FichasInventario, 'canales' | 'caminos'>): ContradiccionFinCamino | null {
  let finCanal: { pk: string; m: number } | null = null
  for (const c of fichas.canales) {
    if ((c.ramal ?? 'principal') !== 'principal') continue
    const m = pkAMetros(c.pkFinal)
    if (m !== null && c.pkFinal !== null && (finCanal === null || m > finCanal.m)) finCanal = { pk: c.pkFinal, m }
  }
  let camino: { pk: string; m: number; fila: number } | null = null
  for (const c of fichas.caminos) {
    const m = pkAMetros(c.pkFinal)
    if (m !== null && c.pkFinal !== null && (camino === null || m > camino.m)) camino = { pk: c.pkFinal, m, fila: c.fila }
  }
  if (finCanal === null || camino === null) return null
  const d = finCanal.m - camino.m
  return d === 0 ? null : { pkCanal: finCanal.pk, pkCamino: camino.pk, diferenciaM: d, fila: camino.fila }
}
