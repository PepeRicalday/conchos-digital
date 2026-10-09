import { D, type Dec } from './decimal'

/**
 * Regla de redondeo declarada. Nunca se redondea de forma implícita (MAQ-003 exige distinguir
 * truncado de redondeo). PAR-17: por defecto las horas son exactas.
 */
export type ReglaRedondeo =
  | { readonly tipo: 'exacto' }
  | { readonly tipo: 'mitad_arriba'; readonly decimales: number }
  | { readonly tipo: 'truncar'; readonly decimales: number }

export const REDONDEO_EXACTO: ReglaRedondeo = { tipo: 'exacto' }

export function redondear(x: Dec, regla: ReglaRedondeo): Dec {
  switch (regla.tipo) {
    case 'exacto':
      return x
    case 'mitad_arriba':
      return x.toDecimalPlaces(regla.decimales, D.ROUND_HALF_UP)
    case 'truncar':
      return x.toDecimalPlaces(regla.decimales, D.ROUND_DOWN)
  }
}

/** Describe qué regla reproduce un valor capturado a partir del exacto, o null si ninguna. */
export function reglaQueReproduce(exacto: Dec, capturado: Dec, decimales: number): 'truncado' | 'redondeo' | null {
  if (redondear(exacto, { tipo: 'truncar', decimales }).equals(capturado)) return 'truncado'
  if (redondear(exacto, { tipo: 'mitad_arriba', decimales }).equals(capturado)) return 'redondeo'
  return null
}
