import type { Dec } from './decimal'

/** Unidades de trabajo y paramétricas que el comprobador distingue. No se suman unidades distintas. */
export type Unidad = 'km' | 'm' | 'ha' | 'm3' | 'm3/km' | 'pza' | 'MXN' | 'h' | 'maq' | 'km/he' | 'ha/he' | 'm3/he' | 'sin_unidad'

const ALIAS: Readonly<Record<string, Unidad>> = {
  km: 'km', m: 'm', ha: 'ha', 'm3': 'm3', 'm³': 'm3', 'm3/km': 'm3/km', pza: 'pza', pieza: 'pza', piezas: 'pza',
  $: 'MXN', mxn: 'MXN', pesos: 'MXN', h: 'h', he: 'h', hr: 'h', hrs: 'h', 'km/he': 'km/he', 'ha/he': 'ha/he', 'm3/he': 'm3/he',
}

/** null si la etiqueta no es una unidad conocida (se informa como pendiente, no se adivina). */
export function normalizarUnidad(etiqueta: string): Unidad | null {
  return ALIAS[etiqueta.trim().toLowerCase().replace(/\s+/g, '')] ?? null
}

export interface Cantidad {
  readonly valor: Dec
  readonly unidad: Unidad
}

export class UnidadesIncompatibles extends Error {
  readonly a: Unidad
  readonly b: Unidad
  constructor(a: Unidad, b: Unidad) {
    super(`No se pueden sumar ${a} con ${b}`)
    this.name = 'UnidadesIncompatibles'
    this.a = a
    this.b = b
  }
}

export function sumar(a: Cantidad, b: Cantidad): Cantidad {
  if (a.unidad !== b.unidad) throw new UnidadesIncompatibles(a.unidad, b.unidad)
  return { valor: a.valor.plus(b.valor), unidad: a.unidad }
}
