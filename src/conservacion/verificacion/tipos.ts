import type { TipoRed } from '../derivacion/tipos'
import type { CriterioInferido } from './criterio'
import type { Uniones } from './uniones'

/**
 * Verificación independiente del diagnóstico (DIAG-01). Cada resultado dice SOBRE QUÉ BASE se juzga:
 *  - integridad: aritmética y enlaces entre hojas; no depende de ningún criterio.
 *  - criterio_libro: lo que el propio libro hace en la mayoría de sus tramos (inferido, no es norma).
 *  - norma: umbral que fija el Manual 2026 o sus Anexos.
 *  - referencia_tecnica: práctica de ingeniería general, fuera del corpus normativo.
 * El sistema nunca declara un diagnóstico "correcto": una coincidencia aritmética no acredita la condición física.
 */
export type BaseJuicio = 'integridad' | 'criterio_libro' | 'norma' | 'referencia_tecnica'
export type NivelVerif = 1 | 2 | 3

/** cuadra · atipico (candidato a revisión) · no_cuadra (contradice una cuenta del propio libro) · no_evaluable · informativo. */
export type EstadoVerif = 'cuadra' | 'atipico' | 'no_cuadra' | 'no_evaluable' | 'informativo'

export interface PasoRecalculo {
  readonly etiqueta: string
  /** La operación, con los valores sustituidos, para poder rehacerla a mano. */
  readonly expresion: string
  readonly valor: string | null
}

export interface ResultadoVerif {
  /** Estable entre corridas del mismo libro: `regla:fila:concepto`. */
  readonly id: string
  readonly nivel: NivelVerif
  readonly base: BaseJuicio
  readonly estado: EstadoVerif
  readonly red: TipoRed | null
  readonly concepto: string | null
  readonly tramoFila: number | null
  readonly titulo: string
  readonly detalle: string
  /** `hoja!celda` de donde sale cada dato. */
  readonly refs: readonly string[]
  readonly esperado: string | null
  readonly observado: string | null
  readonly diferencia: string | null
  readonly recalculo: readonly PasoRecalculo[]
}

export interface ResumenVerif {
  readonly total: number
  readonly porEstado: Readonly<Record<EstadoVerif, number>>
}

export interface VerificacionLibro {
  readonly resultados: readonly ResultadoVerif[]
  /** Criterio que el libro aplica por red y concepto (Nivel 2), con su cobertura. */
  readonly criterios: readonly CriterioInferido[]
  readonly resumen: ResumenVerif
  /** Cada tramo de DIAG-01 con su ficha de inventario; la comprobación tramo por tramo parte de aquí. */
  readonly uniones: Uniones
}
