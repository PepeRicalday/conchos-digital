import { declararParametros, type DeclaracionParametro, type Parametros } from '../parametros/catalogo'
import type { PerfilFormato } from '../libro/perfil'
import type { VistaLibro } from '../libro/vista'
import { reglaDyp006 } from '../reglas/dyp'
import { reglaInv002, reglaInv003 } from '../reglas/inv'
import { reglaMaq003, reglaMaq004, reglaMaq005 } from '../reglas/maq'
import { reglaMaq006 } from '../reglas/balance'
import { reglaDyp014, reglaDyp015, type ApuDeclarado } from '../reglas/precios'
import { reglaDyp018, type FilaAvance } from '../reglas/seguimiento'
import { reglaTrv001, reglaTrv004 } from '../reglas/trv'
import type { ContextoEvaluacion, Regla, Resultado } from '../tipos/regla'

/** Reglas del primer corte vertical (8 de 52). */
export const REGLAS_PRIMER_CORTE: readonly Regla[] = [
  reglaMaq003, reglaMaq004, reglaMaq005, reglaDyp006, reglaTrv001, reglaInv003, reglaInv002, reglaTrv004,
]

/** Corte 1b: reglas puras, que no necesitan leer el libro (cierran TC-05 a TC-10). */
export const REGLAS_CORTE_1B: readonly Regla[] = [reglaMaq006, reglaDyp014, reglaDyp015, reglaDyp018]

export const REGLAS_IMPLEMENTADAS: readonly Regla[] = [...REGLAS_PRIMER_CORTE, ...REGLAS_CORTE_1B]

export const TOTAL_REGLAS_MATRIZ = 52
export const VERSION_MOTOR = '0.2.0-corte1b'

export interface EntradaEjecucion {
  readonly libro: VistaLibro | null
  readonly parametros: Parametros
  readonly perfil: PerfilFormato | null
  readonly fechaReferencia: string
  readonly apus?: readonly ApuDeclarado[]
  readonly seguimiento?: readonly FilaAvance[]
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
  /** Reglas que respondieron 'no evaluable' por falta de datos: se informan, no se dan por superadas. */
  readonly reglasSinDatos: readonly string[]
  /** Deja explícito que no encontrar hallazgos no equivale a un programa correcto. */
  readonly coberturaReglas: { readonly implementadas: number; readonly totales: number; readonly ejecutadas: number }
  readonly resumen: { readonly hallazgos: number; readonly alta: number; readonly media: number; readonly informativa: number }
}

/** Ejecuta las reglas en orden determinista. Un fallo interno de una regla nunca se convierte en aprobación. */
export function ejecutar(entrada: EntradaEjecucion, reglas: readonly Regla[] = REGLAS_IMPLEMENTADAS): InformeEjecucion {
  const ctx: ContextoEvaluacion = {
    libro: entrada.libro, parametros: entrada.parametros, perfil: entrada.perfil, fechaReferencia: entrada.fechaReferencia,
    ...(entrada.apus ? { apus: entrada.apus } : {}), ...(entrada.seguimiento ? { seguimiento: entrada.seguimiento } : {}),
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
    reglasSinDatos: resultados.filter((r) => r.estado === 'no_evaluable').map((r) => r.reglaId),
    coberturaReglas: { implementadas: reglas.length, totales: TOTAL_REGLAS_MATRIZ, ejecutadas: resultados.filter((r) => r.estado !== 'error_interno').length },
    resumen: {
      hallazgos: todos.length,
      alta: todos.filter((h) => h.severidad === 'alta').length,
      media: todos.filter((h) => h.severidad === 'media').length,
      informativa: todos.filter((h) => h.severidad === 'informativa').length,
    },
  }
}
