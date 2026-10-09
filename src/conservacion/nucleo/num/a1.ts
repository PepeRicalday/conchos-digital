/** Referencias estilo A1 (BIFF8 llega hasta IV, 256 columnas; aquí se admiten hasta ZZZ). */

export function colAIndice(col: string): number {
  let n = 0
  for (const ch of col.toUpperCase()) {
    const v = ch.charCodeAt(0) - 64
    if (v < 1 || v > 26) throw new Error(`Columna inválida: ${col}`)
    n = n * 26 + v
  }
  return n - 1
}

export function indiceACol(indice: number): string {
  if (!Number.isInteger(indice) || indice < 0) throw new Error(`Índice de columna inválido: ${indice}`)
  let n = indice + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export interface PartesA1 {
  readonly col: string
  readonly fila: number
}

/** Acepta `$` y devuelve null si no es una celda A1. */
export function parseA1(ref: string): PartesA1 | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref.trim())
  if (!m || m[1] === undefined || m[2] === undefined) return null
  const fila = Number(m[2])
  return fila >= 1 ? { col: m[1].toUpperCase(), fila } : null
}

export const refA1 = (col: string, fila: number): string => `${col.toUpperCase()}${fila}`
