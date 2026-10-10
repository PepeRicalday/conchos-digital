import { dec } from '../nucleo/num/decimal'

/**
 * Parámetros de la verificación, a la vista del usuario (la UI los muestra). No son los PAR-xx de la matriz:
 * promoverlos a reglas del motor es una fase posterior.
 */
export const PARAMETROS_VERIF = {
  /** Precisión de la longitud en km (3 decimales): igual a la que usa INV-001 (PRECISION_KM). */
  tolKm: { valor: dec('0.0005'), fuente: 'Precisión de captura del Anexo 1 (longitud, 3 decimales); igual a INV-001' },
  /** Nivel 2: tolerancia relativa para decir que un tramo "sigue" el criterio del libro (el libro redondea a 3-4 decimales). */
  tolCriterioRel: 0.001,
  /** Nivel 2: fracción mínima de tramos de un grupo que debe compartir un criterio para considerarlo recuperable. */
  coberturaMinima: 0.6,
  /** Nivel 2: un grupo con menos tramos no se evalúa (un criterio con 1-2 casos no se distingue de la casualidad). */
  minTramosGrupo: 3,
  /** Nivel 3 · norma: pérdida de capacidad que se acepta antes de desazolvar (Anexo Técnico General §2.2, PDF p. 7). */
  perdidaCapacidad: { valor: 0.15, fuente: 'Anexo Técnico General 2026 §2.2 (PDF p. 7): se acepta perder hasta 15 % de la capacidad proyectada' },
  /**
   * Nivel 3 · referencia técnica (NO normativa): bandas de rugosidad de Manning por tipo de revestimiento. Son amplias a propósito:
   * solo señalan valores que ninguna práctica usual justificaría. Confirmar con la fuente que adopte la SRL.
   */
  manning: {
    concreto: { min: 0.01, max: 0.025 },
    mamposteria: { min: 0.015, max: 0.035 },
    tierra: { min: 0.018, max: 0.05 },
    fuente: 'Valores usuales de ingeniería hidráulica; fuera del corpus normativo del Manual 2026. Informativos.',
  },
  /** Redondeo de captura de cantidades y totales. */
  tolSuma: { valor: dec('0.01'), fuente: 'Redondeo de captura del libro (igual que la conciliación de módulos)' },
} as const
