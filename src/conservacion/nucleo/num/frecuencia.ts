import { dec, dentroDeTolerancia, type Dec, type Tolerancia } from './decimal'

/**
 * Frecuencia F = V/T [veces/año] (Manual 2026 §5.6). Se despeja de las cantidades; la etiqueta
 * del formato no se interpreta (DYP-006). Una columna "Frecuencia" puede contener la periodicidad
 * (cada T años) en lugar de F: se detecta comparando contra 1/F.
 */
export function despejarFrecuencia(cantidadAnual: Dec, cantidadTotal: Dec): Dec | null {
  return cantidadTotal.isZero() ? null : cantidadAnual.dividedBy(cantidadTotal)
}

export type DiagnosticoFrecuencia =
  | { readonly tipo: 'consistente'; readonly fDespejada: Dec }
  | { readonly tipo: 'periodicidad_en_columna_de_frecuencia'; readonly fDespejada: Dec; readonly periodoAnios: Dec }
  | { readonly tipo: 'redondeo_de_presentacion'; readonly fDespejada: Dec; readonly fExacta: Dec; readonly periodoAnios: Dec }
  | { readonly tipo: 'incongruente'; readonly fDespejada: Dec }
  | { readonly tipo: 'no_evaluable'; readonly motivo: string }

export interface EntradaFrecuencia {
  readonly cantidadTotal: Dec
  readonly cantidadAnual: Dec
  readonly fImpresa: Dec
  readonly tolerancia: Tolerancia
  /** Máxima diferencia atribuible al redondeo con que se muestra F (p. ej. 0.3 por 1/3). */
  readonly pasoDePresentacion?: Dec
}

export function diagnosticarFrecuencia(e: EntradaFrecuencia): DiagnosticoFrecuencia {
  const f = despejarFrecuencia(e.cantidadAnual, e.cantidadTotal)
  if (f === null) return { tipo: 'no_evaluable', motivo: 'La cantidad total es cero: no se puede despejar la frecuencia' }
  if (dentroDeTolerancia(f, e.fImpresa, e.tolerancia)) return { tipo: 'consistente', fDespejada: f }

  // ¿La columna trae la periodicidad (años) en lugar de F?
  if (!e.fImpresa.isZero() && dentroDeTolerancia(f, dec(1).dividedBy(e.fImpresa), e.tolerancia)) {
    return { tipo: 'periodicidad_en_columna_de_frecuencia', fDespejada: f, periodoAnios: e.fImpresa }
  }

  // ¿F exacta = 1/n con n entero y la impresa es solo el redondeo de presentación?
  if (!f.isZero()) {
    const periodo = dec(1).dividedBy(f)
    const n = periodo.toDecimalPlaces(0)
    if (n.greaterThanOrEqualTo(1) && periodo.minus(n).abs().dividedBy(periodo).lessThan('0.01')) {
      const fExacta = dec(1).dividedBy(n)
      const paso = e.pasoDePresentacion ?? dec('0.05')
      if (e.fImpresa.minus(fExacta).abs().lessThanOrEqualTo(paso)) {
        return { tipo: 'redondeo_de_presentacion', fDespejada: f, fExacta, periodoAnios: n }
      }
    }
  }
  return { tipo: 'incongruente', fDespejada: f }
}

export type SemanticaEtiqueta = 'anual' | 'mensual' | 'periodo' | 'desconocida'

/** Clasifica el rótulo de la columna de frecuencia sin asumir su significado. */
export function clasificarEtiqueta(etiqueta: string): SemanticaEtiqueta {
  const t = etiqueta.toLowerCase()
  if (/(a[nñ]o|anual)/.test(t)) return 'anual'
  if (/\bmes\b|mensual|\/mes/.test(t)) return 'mensual'
  if (/cada|per[ií]odo|periodicidad/.test(t)) return 'periodo'
  return 'desconocida'
}
