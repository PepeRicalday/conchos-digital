import Decimal from 'decimal.js'

/** Decimal aislado del global: precisión alta y redondeo "lejos de cero" (el de Excel). */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP })
export type Dec = InstanceType<typeof D>

export const dec = (x: number | string | Dec): Dec => new D(x)

export interface Tolerancia {
  /** Diferencia absoluta admitida. */
  readonly absoluta: Dec
  /** Diferencia relativa admitida respecto del valor de referencia. */
  readonly relativa: Dec
  /** Qué precisión justifica esta tolerancia (PAR-15: se declara antes de comparar). */
  readonly descripcion: string
}

export const TOLERANCIA_EXACTA: Tolerancia = {
  absoluta: dec('1e-9'),
  relativa: dec(0),
  descripcion: 'Ruido de coma flotante; conteos exactos',
}

export function dentroDeTolerancia(observado: Dec, esperado: Dec, t: Tolerancia): boolean {
  const dif = observado.minus(esperado).abs()
  const margen = Decimal.max(t.absoluta, esperado.abs().times(t.relativa))
  return dif.lessThanOrEqualTo(margen)
}

/** Serializa sin notación científica, para que el JSON de salida sea estable. */
export function aCadena(x: Dec): string {
  return x.toFixed()
}
