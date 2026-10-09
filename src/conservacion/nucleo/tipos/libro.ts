import type { Dec } from '../num/decimal'

/**
 * Libro normalizado: lo que el lector (BIFF/xlsx) entrega al núcleo. El núcleo no abre archivos.
 * Los códigos de tipo del extractor actual (data.json) son los de xlrd: 1 texto, 2 número, 5 error.
 * Solo se observaron esos tres; cualquier otro se conserva como 'otro' y nunca se trata como número.
 */
export interface RefCelda {
  readonly hoja: string
  readonly celda: string
}

export type Celda =
  | { readonly tipo: 'numero'; readonly valor: number }
  | { readonly tipo: 'texto'; readonly valor: string }
  | { readonly tipo: 'error'; readonly codigo: number; readonly etiqueta: string }
  | { readonly tipo: 'otro'; readonly codigoCrudo: number }

export type KindFormula = 'ordinary' | 'shared_expanded' | 'array' | 'desconocida'

export interface Formula {
  readonly texto: string
  readonly kind: KindFormula
  readonly errorLector: string | null
}

export interface Hoja {
  readonly nombre: string
  readonly nfilas: number
  readonly ncols: number
  readonly celdas: ReadonlyMap<string, Celda>
  readonly formulas: ReadonlyMap<string, Formula>
}

export interface LibroNormalizado {
  readonly sha256: string
  readonly extractor: string
  /** Lo que exige la skill: declarar si los valores son caché o recálculo nativo. */
  readonly baseValores: 'cache' | 'recalculo-nativo'
  readonly hojas: ReadonlyMap<string, Hoja>
}

/** Una celda vacía, un texto o un error NUNCA se convierten en cero. */
export type LecturaNumero =
  | { readonly ok: true; readonly valor: Dec; readonly ref: RefCelda }
  | { readonly ok: false; readonly motivo: 'vacia' | 'texto' | 'error' | 'otro' | 'sin_hoja'; readonly ref: RefCelda }
