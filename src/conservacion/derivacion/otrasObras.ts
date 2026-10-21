import type { VistaLibro } from '../nucleo/libro/vista'
import type { HojaOtraObra, InventarioOtraObra, ObraOtra } from './tipos'

/**
 * Lectura de las hojas de inventario de obras que no son canal, dren ni camino: presas de almacenamiento (IO5a) y derivadoras (IO5b),
 * plantas de bombeo (IO5c), pozos profundos (IO5d) y red de comunicación (IO6). Solo lectura. Una hoja sin obras es «sin obras»; si el
 * formato dice «NO APLICA» se declara así (es el caso de la SRL en presas, plantas y pozos). Los módulos sí pueden traer pozos.
 */

const FILA_DESDE = 14
const ROTULO: Readonly<Record<HojaOtraObra, string>> = {
  IO5a: 'Presas de almacenamiento', IO5b: 'Presas derivadoras', IO5c: 'Plantas de bombeo', IO5d: 'Pozos profundos', IO6: 'Red de comunicación',
}
const NO_APLICA = /^\s*no\s+aplica\s*\.?\s*$/i
const PLANTILLA = /^\s*colocar\s+nombre/i

interface CeldaPos { readonly col: string; readonly colN: number; readonly fila: number; readonly ref: string }

function posicion(ref: string): CeldaPos | null {
  const m = /^([A-Z]{1,3})(\d+)$/.exec(ref)
  if (!m) return null
  const col = m[1] ?? ''
  let n = 0
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64)
  return { col, colN: n, fila: Number(m[2]), ref }
}

/** Texto de la celda (un número se vuelve texto); null si está vacía. */
function textoDe(libro: VistaLibro, hoja: string, celda: string): string | null {
  const c = libro.celda(hoja, celda)
  if (c === undefined) return null
  const t = c.tipo === 'texto' ? c.valor : c.tipo === 'numero' ? String(c.valor) : ''
  const l = t.replace(/\s+/g, ' ').trim()
  return l === '' ? null : l
}

/** Primera celda de la hoja desde `filaDesde` que dice «NO APLICA». */
function buscarNoAplica(libro: VistaLibro, hoja: string, filaDesde: number): string | null {
  const celdas = libro.hoja(hoja)?.celdas
  if (celdas === undefined) return null
  let hallada: CeldaPos | null = null
  for (const [ref, c] of celdas) {
    if (c.tipo !== 'texto' || !NO_APLICA.test(c.valor)) continue
    const p = posicion(ref)
    if (p === null || p.fila < filaDesde) continue
    if (hallada === null || p.fila < hallada.fila || (p.fila === hallada.fila && p.colN < hallada.colN)) hallada = p
  }
  return hallada === null ? null : `${hoja}!${hallada.ref}`
}

/** IO5c e IO5d: una obra por fila con número de inventario en la columna A (la fila siguiente, sin inventario, continúa datos). */
function leerPorFilas(libro: VistaLibro, hoja: 'IO5c' | 'IO5d'): ObraOtra[] {
  const n = libro.hoja(hoja)?.nfilas ?? 0
  const obras: ObraOtra[] = []
  for (let r = FILA_DESDE; r <= n; r++) {
    const inv = textoDe(libro, hoja, `A${r}`)
    if (inv === null || NO_APLICA.test(inv)) continue
    obras.push({ fila: r, inventario: inv, nombre: textoDe(libro, hoja, `B${r}`), cantidad: 1, ref: `${hoja}!A${r}` })
  }
  return obras
}

/** IO5a e IO5b: una presa por columna; el nombre está en la fila 11 y «Colocar Nombre de la Presa N» es la plantilla sin llenar. */
function leerPorColumnas(libro: VistaLibro, hoja: 'IO5a' | 'IO5b'): ObraOtra[] {
  const celdas = libro.hoja(hoja)?.celdas
  if (celdas === undefined) return []
  const obras: (ObraOtra & { colN: number })[] = []
  for (const [ref, c] of celdas) {
    const p = posicion(ref)
    if (p === null || p.fila !== 11 || p.colN < 2 || c.tipo !== 'texto') continue
    const nombre = c.valor.replace(/\s+/g, ' ').trim()
    if (nombre === '' || PLANTILLA.test(nombre)) continue
    obras.push({ fila: 11, inventario: null, nombre, cantidad: 1, ref: `${hoja}!${p.col}11`, colN: p.colN })
  }
  return obras.sort((a, b) => a.colN - b.colN).map((o) => ({ fila: o.fila, inventario: o.inventario, nombre: o.nombre, cantidad: o.cantidad, ref: o.ref }))
}

/** IO6: cada renglón con descripción (B) trae el número de equipos en la columna F. */
function leerComunicacion(libro: VistaLibro): ObraOtra[] {
  const n = libro.hoja('IO6')?.nfilas ?? 0
  const obras: ObraOtra[] = []
  for (let r = FILA_DESDE - 1; r <= n; r++) {
    const nombre = textoDe(libro, 'IO6', `B${r}`)
    const num = libro.numero('IO6', `F${r}`)
    if (nombre === null && !num.ok) continue
    obras.push({ fila: r, inventario: textoDe(libro, 'IO6', `A${r}`), nombre, cantidad: num.ok ? num.valor.toNumber() : null, ref: `IO6!F${r}` })
  }
  return obras
}

export function leerOtrasObras(libro: VistaLibro): InventarioOtraObra[] {
  const salida: InventarioOtraObra[] = []
  for (const hoja of ['IO5a', 'IO5b', 'IO5c', 'IO5d', 'IO6'] as const) {
    if (libro.hoja(hoja) === undefined) continue
    const obras = hoja === 'IO6' ? leerComunicacion(libro) : hoja === 'IO5a' || hoja === 'IO5b' ? leerPorColumnas(libro, hoja) : leerPorFilas(libro, hoja)
    const cantidad = obras.reduce((s, o) => s + (o.cantidad ?? 0), 0)
    const refNoAplica = buscarNoAplica(libro, hoja, hoja === 'IO5a' || hoja === 'IO5b' ? 12 : FILA_DESDE)
    salida.push({ hoja, rotulo: ROTULO[hoja], noAplica: refNoAplica !== null && cantidad === 0, refNoAplica, cantidad, obras })
  }
  return salida
}
