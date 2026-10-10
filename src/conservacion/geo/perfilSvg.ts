import { FAMILIA_POR_ID } from '../estructuras/catalogo'
import type { FamiliaId } from '../estructuras/catalogo'

/**
 * Layout puro del perfil lineal del canal (eje de cadenamiento horizontal): dado un ancho en px, una ventana [kmA, kmB], los
 * tramos y las estructuras, devuelve las posiciones X ya calculadas y los ticks del eje. No dibuja ni toca el DOM: la pantalla y
 * la infografía comparten esta geometría y cada una pinta su SVG. Los km son kilómetros decimales (12.5 = K-12+500).
 */

export interface TramoPerfil { readonly id: string; readonly kmIni: number; readonly kmFin: number }
export interface EstructuraPerfil { readonly id: string; readonly km: number; readonly familia: FamiliaId | null }

export interface EntradaPerfil {
  /** Ancho total disponible en px (incluye márgenes). */
  readonly ancho: number
  readonly ventana: readonly [number, number]
  readonly tramos: readonly TramoPerfil[]
  readonly estructuras: readonly EstructuraPerfil[]
  readonly margenIzq?: number
  readonly margenDer?: number
  /** Número aproximado de ticks mayores (por defecto 8). */
  readonly ticksObjetivo?: number
}

export interface TickPerfil { readonly km: number; readonly x: number; readonly etiqueta: string; readonly mayor: boolean }

export interface TramoGeom {
  readonly id: string
  readonly x0: number
  readonly x1: number
  readonly ancho: number
  /** La banda continúa fuera de la ventana por ese lado: se dibuja sin borde de cierre. */
  readonly recortadoIzq: boolean
  readonly recortadoDer: boolean
}

export interface EstructuraGeom {
  readonly id: string
  readonly x: number
  readonly familia: FamiliaId | null
  /** Carril vertical = orden de la familia (0 = arriba); -1 si no tiene familia («sin clasificar»). */
  readonly carril: number
}

export interface Perfil {
  readonly valido: boolean
  /** Rango X de la zona de dibujo (sin márgenes). */
  readonly x0: number
  readonly x1: number
  readonly kmA: number
  readonly kmB: number
  readonly pxPorKm: number
  readonly tramos: readonly TramoGeom[]
  readonly estructuras: readonly EstructuraGeom[]
  readonly ticks: readonly TickPerfil[]
  /** Estructuras / tramos que quedan fuera de la ventana (para decir «N fuera de la vista»). */
  readonly estructurasFuera: number
  readonly tramosFuera: number
  readonly xDeKm: (km: number) => number
  readonly kmDeX: (x: number) => number
}

/** `12.5` → `K-12+500`. */
export function etiquetaKm(km: number): string {
  const m = Math.round(km * 1000)
  return `K-${Math.floor(m / 1000)}+${String(m % 1000).padStart(3, '0')}`
}

/** Valores «redondos» (1, 2, 5 × 10ⁿ) que cubren [min, max], unos `objetivo` aproximadamente. */
export function niceTicks(min: number, max: number, objetivo = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || objetivo < 1) return []
  const bruto = (max - min) / objetivo
  const pot = 10 ** Math.floor(Math.log10(bruto))
  const f = bruto / pot
  const paso = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pot
  const ticks: number[] = []
  const inicio = Math.ceil(min / paso - 1e-9)
  for (let i = inicio; i * paso <= max + paso * 1e-9; i++) ticks.push(Math.round(i * paso * 1e6) / 1e6 + 0) // + 0: evita -0
  return ticks
}

export function calcularPerfil(e: EntradaPerfil): Perfil {
  const [kmA, kmB] = e.ventana
  const x0 = e.margenIzq ?? 0
  const x1 = e.ancho - (e.margenDer ?? 0)
  const valido = Number.isFinite(kmA) && Number.isFinite(kmB) && kmB > kmA && x1 > x0
  const pxPorKm = valido ? (x1 - x0) / (kmB - kmA) : 0
  const xDeKm = (km: number): number => x0 + (km - kmA) * pxPorKm
  const kmDeX = (x: number): number => (pxPorKm === 0 ? kmA : kmA + (x - x0) / pxPorKm)
  if (!valido) {
    return { valido, x0, x1, kmA, kmB, pxPorKm, tramos: [], estructuras: [], ticks: [], estructurasFuera: e.estructuras.length, tramosFuera: e.tramos.length, xDeKm, kmDeX }
  }
  const tramos: TramoGeom[] = []
  for (const t of e.tramos) {
    if (t.kmFin <= kmA || t.kmIni >= kmB) continue
    const a = Math.max(t.kmIni, kmA), b = Math.min(t.kmFin, kmB)
    tramos.push({ id: t.id, x0: xDeKm(a), x1: xDeKm(b), ancho: xDeKm(b) - xDeKm(a), recortadoIzq: t.kmIni < kmA, recortadoDer: t.kmFin > kmB })
  }
  const estructuras: EstructuraGeom[] = []
  for (const s of e.estructuras) {
    if (s.km < kmA || s.km > kmB) continue
    estructuras.push({ id: s.id, x: xDeKm(s.km), familia: s.familia, carril: s.familia === null ? -1 : FAMILIA_POR_ID[s.familia].orden })
  }
  const nice = niceTicks(kmA, kmB, e.ticksObjetivo ?? 8)
  const ticks: TickPerfil[] = nice.map((km) => ({ km, x: xDeKm(km), etiqueta: etiquetaKm(km), mayor: true }))
  return {
    valido, x0, x1, kmA, kmB, pxPorKm, tramos, estructuras, ticks,
    estructurasFuera: e.estructuras.length - estructuras.length, tramosFuera: e.tramos.length - tramos.length, xDeKm, kmDeX,
  }
}

/** Ventana [kmA, kmB] de ancho `largo` centrada en `centro` y sujeta a [0, total]: no se sale del canal. */
export function ventanaCentrada(centro: number, largo: number, total: number): [number, number] {
  const l = Math.min(Math.max(largo, 0), total)
  const a = Math.min(Math.max(centro - l / 2, 0), total - l)
  return [a, a + l]
}
