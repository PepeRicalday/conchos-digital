import { z } from 'zod'
import type { Celda, Formula, Hoja, KindFormula, LibroNormalizado } from '../tipos/libro'

/**
 * Esquema de la extracción actual (data.json de la auditoría de Conchos): por hoja, `cells`
 * (value/type) y `formulas` (formula/kind/error). Los campos que no se usan se toleran.
 */
const esquemaCelda = z.looseObject({
  value: z.union([z.number(), z.string(), z.null()]),
  type: z.number().int(),
})

const esquemaFormula = z.looseObject({
  formula: z.string(),
  kind: z.string(),
  error: z.union([z.string(), z.null()]).optional(),
})

const esquemaHoja = z.looseObject({
  cells: z.record(z.string(), esquemaCelda),
  formulas: z.record(z.string(), esquemaFormula),
  nrows: z.number().int().nonnegative(),
  ncols: z.number().int().nonnegative(),
})

export const esquemaDataJson = z.record(z.string(), esquemaHoja)

const ETIQUETA_ERROR: Readonly<Record<number, string>> = {
  0: '#NULL!', 7: '#DIV/0!', 15: '#VALUE!', 23: '#REF!', 29: '#NAME?', 36: '#NUM!', 42: '#N/A',
}

function celda(tipo: number, valor: number | string | null): Celda {
  if (tipo === 2 && typeof valor === 'number') return { tipo: 'numero', valor }
  if (tipo === 1 && typeof valor === 'string') return { tipo: 'texto', valor }
  if (tipo === 5 && typeof valor === 'number') return { tipo: 'error', codigo: valor, etiqueta: ETIQUETA_ERROR[valor] ?? `#ERR(${valor})` }
  return { tipo: 'otro', codigoCrudo: tipo }
}

function kind(k: string, texto: string): KindFormula {
  if (/^SHARED FMLA/.test(texto)) return 'desconocida' // ancla tExp: no es una expresión operativa
  if (k === 'ordinary') return 'ordinary'
  if (k === 'shared_expanded') return 'shared_expanded'
  return 'desconocida'
}

export interface MetaLibro {
  readonly sha256: string
  readonly extractor: string
  readonly baseValores?: 'cache' | 'recalculo-nativo'
}

/** Valida y convierte la extracción. Lanza ZodError si el formato no es el esperado. */
export function normalizarDataJson(crudo: unknown, meta: MetaLibro): LibroNormalizado {
  const datos = esquemaDataJson.parse(crudo)
  const hojas = new Map<string, Hoja>()
  for (const [nombre, h] of Object.entries(datos)) {
    const celdas = new Map<string, Celda>()
    for (const [ref, c] of Object.entries(h.cells)) celdas.set(ref, celda(c.type, c.value))
    const formulas = new Map<string, Formula>()
    for (const [ref, f] of Object.entries(h.formulas)) {
      formulas.set(ref, { texto: f.formula, kind: kind(f.kind, f.formula), errorLector: f.error ?? null })
    }
    hojas.set(nombre, { nombre, nfilas: h.nrows, ncols: h.ncols, celdas, formulas })
  }
  return { sha256: meta.sha256, extractor: meta.extractor, baseValores: meta.baseValores ?? 'cache', hojas }
}
