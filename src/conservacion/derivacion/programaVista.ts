/**
 * Programa de obra (SEG-3) como lista plana de renglones, lista para filtrar, paginar y enlazar a la cadena de cálculo y al tramo de DIAG-01.
 * Puro: sin React. El encabezado del libro arrastra los títulos de varias filas («LIMPIA Y DESHIERBE (…) / EXTRACCION DE PLANTAS TERRESTRES / …»);
 * aquí se reduce a la familia canónica del concepto y el rótulo original queda en `rotuloLibro`.
 */
import { nombreConcepto, redDeRotulo } from '../vocabulario'
import type { LibroDerivado, RenglonPrograma, TipoRed } from './tipos'
import type { Familia } from './conceptos'

export interface RenglonVista {
  readonly r: RenglonPrograma
  /** Nombre canónico del concepto; si no se reconoce, el rótulo del libro en minúsculas con inicial mayúscula. */
  readonly concepto: string
  readonly familia: Familia
  /** Rótulo original (encabezado) del libro, para el `title`. */
  readonly rotuloLibro: string
  /** Índice de la columna de DIAG-01 de este concepto; null si el programa no lo liga a una columna. */
  readonly indiceConcepto: number | null
  /** Fila de DIAG-01 del tramo que describe el renglón (misma obra y mismos extremos); null si no se pudo ligar. */
  readonly tramoFila: number | null
  /** Concepto de 3DN (bloque + rótulo) para abrir la cadena de cálculo; null si no hay uno de la misma familia y red. */
  readonly necesidad: { readonly bloque: string; readonly concepto: string } | null
}

const sinEspacios = (t: string): string => t.replace(/\s+/g, '').toLowerCase()

/** «K-0+000 AL K-2+000» → ['0+000', '2+000']; null si no es un rango legible. */
export function extremosDeLocalizacion(loc: string): [string, string] | null {
  const m = /k-?\s*(\d+\s*\+\s*\d{3})\s*(?:al|a|-|→)\s*(?:k)?-?\s*(\d+\s*\+\s*\d{3})/i.exec(loc)
  return m ? [sinEspacios(m[1] ?? ''), sinEspacios(m[2] ?? '')] : null
}

/** Primer título del encabezado que nombra un concepto conocido (el encabezado puede traer varios separados por « / »). */
function conceptoDeEncabezado(encabezado: string, red: TipoRed): { nombre: string; familia: Familia } {
  const partes = encabezado.split('/').map((p) => p.trim()).filter((p) => p !== '')
  for (const p of partes) {
    const n = nombreConcepto(p, { red })
    if (n.familia !== 'otro') return { nombre: n.canonico, familia: n.familia }
  }
  const primero = partes[0] ?? encabezado
  const n = nombreConcepto(primero, { red })
  return { nombre: n.canonico, familia: n.familia }
}

export function vistaPrograma(libro: LibroDerivado): RenglonVista[] {
  const columnas = libro.conceptosDiagnostico
  const necesidades = libro.necesidades
  return libro.programa.map((r) => {
    const c = conceptoDeEncabezado(r.encabezado, r.red)
    const i = c.familia === 'otro' ? -1 : columnas.findIndex((col) => nombreConcepto(col, { red: r.red }).familia === c.familia)
    const indiceConcepto = i >= 0 ? i : null
    // Con la columna de DIAG-01 de la misma familia, el concepto lleva su nombre canónico («Limpia y deshierbe», no el título largo del programa).
    const concepto = indiceConcepto !== null ? nombreConcepto(columnas[indiceConcepto] ?? '', { red: r.red }).canonico : c.nombre
    const ext = extremosDeLocalizacion(r.localizacion)
    const tramo = ext === null ? undefined : libro.tramos.find((t) =>
      t.red === r.red && t.inventario === r.inventario && t.obra.trim().toLowerCase() === r.obra.trim().toLowerCase()
      && sinEspacios(t.pkInicial) === ext[0] && sinEspacios(t.pkFinal) === ext[1])
    const nec = c.familia === 'otro' ? undefined : necesidades.find((n) => redDeRotulo(n.bloque) === r.red && nombreConcepto(n.concepto, { bloque: n.bloque }).familia === c.familia)
    return {
      r, concepto, familia: c.familia, rotuloLibro: r.encabezado, indiceConcepto,
      tramoFila: tramo?.fila ?? null, necesidad: nec ? { bloque: nec.bloque, concepto: nec.concepto } : null,
    }
  })
}

export interface FiltroPrograma { readonly concepto: string; readonly obra: string; readonly texto: string }

const norm = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function filtrarPrograma(filas: readonly RenglonVista[], f: FiltroPrograma): RenglonVista[] {
  const q = norm(f.texto.trim())
  return filas.filter((v) =>
    (f.concepto === '' || v.concepto === f.concepto) && (f.obra === '' || v.r.obra === f.obra)
    && (q === '' || norm(`${v.r.obra} ${v.r.localizacion} ${v.r.clave} ${v.concepto}`).includes(q)))
}

/** Página `pagina` (desde 1) de `n` elementos; la página se acota al rango válido. */
export function paginar<T>(items: readonly T[], pagina: number, tam: number): { items: T[]; pagina: number; paginas: number; desde: number; hasta: number } {
  const paginas = Math.max(1, Math.ceil(items.length / tam))
  const p = Math.min(Math.max(1, Math.trunc(pagina) || 1), paginas)
  const ini = (p - 1) * tam
  const trozo = items.slice(ini, ini + tam)
  return { items: trozo, pagina: p, paginas, desde: items.length === 0 ? 0 : ini + 1, hasta: ini + trozo.length }
}
