/**
 * Enlaces de un hallazgo hacia la derivación de cálculos (puro). Un hallazgo cuyas celdas están en una hoja que la derivación
 * conoce (DIAG-01, IO1, IO2, IO3 o 3DN) puede abrirse en la derivación: la derivación resuelve la fila contra el libro cargado.
 */
export type HojaEnlazable = 'DIAG-01' | 'IO1' | 'IO2' | 'IO3' | '3DN'

export interface ReferenciaEnlazable { readonly hoja: HojaEnlazable; readonly fila: number }

const HOJAS: ReadonlySet<string> = new Set(['DIAG-01', 'IO1', 'IO2', 'IO3', '3DN'])
const CELDA = /^'?([A-Za-z0-9-]+)'?!\$?[A-Z]{1,3}\$?(\d+)(?::\$?[A-Z]{1,3}\$?\d+)?$/

/** Primera referencia del hallazgo que cae en una hoja enlazable; null si ninguna. */
export function referenciaEnlazable(referencias: readonly string[]): ReferenciaEnlazable | null {
  for (const r of referencias) {
    const m = CELDA.exec(r.trim())
    if (!m) continue
    const hoja = (m[1] ?? '').toUpperCase()
    const fila = Number(m[2])
    if (HOJAS.has(hoja) && Number.isInteger(fila) && fila > 0) return { hoja: hoja as HojaEnlazable, fila }
  }
  return null
}
