import { declararParametros, type DeclaracionParametro, type Parametros } from '../parametros/catalogo'
import type { PerfilFormato } from '../libro/perfil'
import type { VistaLibro } from '../libro/vista'
import { reglaDyp006 } from '../reglas/dyp'
import { reglaInv002, reglaInv003 } from '../reglas/inv'
import { reglaMaq003, reglaMaq004, reglaMaq005 } from '../reglas/maq'
import { reglaTrv001, reglaTrv004 } from '../reglas/trv'
import type { ContextoEvaluacion, Regla, Resultado } from '../tipos/regla'

/** Reglas del primer corte vertical (8 de 52). */
export const REGLAS_PRIMER_CORTE: readonly Regla[] = [
  reglaMaq003, reglaMaq004, reglaMaq005, reglaDyp006, reglaTrv001, reglaInv003, reglaInv002, reglaTrv004,
]

export const TOTAL_REGLAS_MATRIZ = 52
export const VERSION_MOTOR = '0.1.0-corte1'

export interface EntradaEjecucion {
  readonly libro: VistaLibro | null
  readonly parametros: Parametros
  readonly perfil: PerfilFormato | null
  readonly fechaReferencia: string
  /** SHA-256 de la matriz usada, calculado por quien invoca (el núcleo no accede a archivos). */
  readonly matrizSha256?: string
}

export interface InformeEjecucion {
  readonly versionMotor: string
  readonly matrizSha256: string | null
  readonly libroSha256: string | null
  readonly baseValores: 'cache' | 'recalculo-nativo' | 'sin_libro'
  readonly fechaReferencia: string
  /** NOR-001: parámetros usados, con fuente y alternos. */
  readonly declaracionParametros: readonly DeclaracionParametro[]
  readonly resultados: readonly Resultado[]
  readonly reglasNoEjecutadas: ReadonlyArray<{ readonly id: string; readonly motivo: 'sin_libro' }>
  /** Deja explícito que no encontrar hallazgos no equivale a un programa correcto. */
  readonly coberturaReglas: { readonly implementadas: number; readonly totales: number; readonly ejecutadas: number }
  readonly resumen: { readonly hallazgos: number; readonly alta: number; readonly media: number; readonly informativa: number }
}

/** Ejecuta las reglas en orden determinista. Un fallo interno de una regla nunca se convierte en aprobación. */
export function ejecutar(entrada: EntradaEjecucion, reglas: readonly Regla[] = REGLAS_PRIMER_CORTE): InformeEjecucion {
  const ctx: ContextoEvaluacion = {
    libro: entrada.libro, parametros: entrada.parametros, perfil: entrada.perfil, fechaReferencia: entrada.fechaReferencia,
  }
  const ordenadas = [...reglas].sort((a, b) => a.meta.id.localeCompare(b.meta.id))
  const resultados: Resultado[] = []
  const noEjecutadas: Array<{ id: string; motivo: 'sin_libro' }> = []
  for (const r of ordenadas) {
    if (r.meta.requiereLibro && !entrada.libro) { noEjecutadas.push({ id: r.meta.id, motivo: 'sin_libro' }); continue }
    try {
      resultados.push(...r.evaluar(ctx))
    } catch (e) {
      resultados.push({
        reglaId: r.meta.id, estado: 'error_interno', hallazgos: [], calculos: [],
        cobertura: { revisados: 0, identificados: 0, unidad: 'n/a' }, pendientes: [],
        motivo: `Fallo interno de la regla: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }
  const todos = resultados.flatMap((r) => r.hallazgos)
  return {
    versionMotor: VERSION_MOTOR,
    matrizSha256: entrada.matrizSha256 ?? null,
    libroSha256: entrada.libro ? entrada.libro.libro.sha256 : null,
    baseValores: entrada.libro ? entrada.libro.libro.baseValores : 'sin_libro',
    fechaReferencia: entrada.fechaReferencia,
    declaracionParametros: declararParametros(entrada.parametros),
    resultados,
    reglasNoEjecutadas: noEjecutadas,
    coberturaReglas: { implementadas: reglas.length, totales: TOTAL_REGLAS_MATRIZ, ejecutadas: resultados.filter((r) => r.estado !== 'error_interno').length },
    resumen: {
      hallazgos: todos.length,
      alta: todos.filter((h) => h.severidad === 'alta').length,
      media: todos.filter((h) => h.severidad === 'media').length,
      informativa: todos.filter((h) => h.severidad === 'informativa').length,
    },
  }
}
