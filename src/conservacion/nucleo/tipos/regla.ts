import type { Parametros } from '../parametros/catalogo'
import type { VistaLibro } from '../libro/vista'
import type { PerfilFormato } from '../libro/perfil'
import type { ApuDeclarado } from '../reglas/precios'
import type { FilaAvance } from '../reglas/seguimiento'

export type ClaseRegla =
  | 'MARCO NORMATIVO'
  | 'INVENTARIO'
  | 'DIAGNÓSTICOS Y PROGRAMA'
  | 'UTILIZACIÓN DE MAQUINARIA'
  | 'TRANSVERSAL'

export type Severidad = 'alta' | 'media' | 'informativa'

export type EstadoEvidencia =
  | 'verificada_en_archivo'
  | 'aclarada_por_usuario'
  | 'sustentada_documentalmente'
  | 'pendiente_de_evidencia'

/** Un error del PacOT, una ambigüedad del formato institucional o una discrepancia de la propia norma (TRV-006). */
export type OrigenHallazgo = 'pacot' | 'formato' | 'norma'

export type Dimension =
  | 'aritmetica' | 'dimensiones' | 'frecuencia' | 'condicion_fisica'
  | 'referencias' | 'viabilidad' | 'financiamiento' | 'ejecucion'

export interface FuenteNorma {
  readonly documento: string
  readonly seccion: string
  readonly pagina?: number
}

export interface ReglaMeta {
  /** Debe existir en la matriz (lo comprueba una prueba). */
  readonly id: string
  readonly clase: ClaseRegla
  readonly titulo: string
  readonly severidadBase: Severidad
  readonly fuentes: readonly FuenteNorma[]
  readonly requiereLibro: boolean
  readonly casosOro: readonly string[]
}

export interface ParametroUsado {
  readonly id: string
  readonly valor: string
  readonly fuente: FuenteNorma
}

export interface Hallazgo {
  /** Clave estable: reimportar el mismo archivo no duplica hallazgos. */
  readonly id: string
  readonly reglaId: string
  readonly titulo: string
  readonly detalle: string
  readonly origen: OrigenHallazgo
  readonly severidad: Severidad
  /** La aritmética nunca cierra la condición física: esa dimensión queda 'pendiente'. */
  readonly dimensiones: Readonly<Partial<Record<Dimension, 'abierta' | 'verificada' | 'pendiente'>>>
  readonly fuentes: readonly FuenteNorma[]
  /** `hoja!celda`; el texto proviene del documento y debe escaparse al mostrarse. */
  readonly referencias: readonly string[]
  readonly esperado?: string
  readonly observado?: string
  readonly diferencia?: string
  readonly estadoEvidencia: EstadoEvidencia
  readonly baseValores: 'cache' | 'recalculo-nativo' | 'sin_libro'
  readonly parametrosUsados: readonly ParametroUsado[]
  readonly limites: readonly string[]
}

export interface TrazaCalculo {
  readonly descripcion: string
  readonly entradas: Readonly<Record<string, string>>
  readonly salida: string
}

export type EstadoPrueba = 'superada' | 'hallazgo' | 'no_evaluable' | 'no_aplica' | 'error_interno'

export interface Resultado {
  readonly reglaId: string
  readonly estado: EstadoPrueba
  readonly hallazgos: readonly Hallazgo[]
  readonly calculos: readonly TrazaCalculo[]
  /** n/N de elementos revisados; nunca se suma entre reglas. */
  readonly cobertura: { readonly revisados: number; readonly identificados: number; readonly unidad: string }
  /** Elementos vistos pero no interpretados (se informan, no se descartan). */
  readonly pendientes: readonly string[]
  /** Obligatorio si el estado es no_evaluable, no_aplica o error_interno. */
  readonly motivo?: string
}

export interface ContextoEvaluacion {
  readonly libro: VistaLibro | null
  readonly parametros: Parametros
  readonly perfil: PerfilFormato | null
  /** ISO. Las reglas no leen el reloj. */
  readonly fechaReferencia: string
  /** APU declarados (de un libro o de un documento). Sin ellos, DYP-014 y DYP-015 quedan pendientes de evidencia. */
  readonly apus?: readonly ApuDeclarado[]
  /** Filas de seguimiento con ejecución. Sin ellas, DYP-018 queda pendiente de evidencia. */
  readonly seguimiento?: readonly FilaAvance[]
}

export interface Regla {
  readonly meta: ReglaMeta
  evaluar(ctx: ContextoEvaluacion): Resultado[]
}
