import type { LibroDerivado } from '../derivacion/tipos'
import { inferirCriterios } from './criterio'
import { verificarFisica } from './fisica'
import { verificarIntegridad } from './integridad'
import type { EstadoVerif, ResultadoVerif, ResumenVerif, VerificacionLibro } from './tipos'
import { unirTramosConFichas } from './uniones'

const ESTADOS: readonly EstadoVerif[] = ['cuadra', 'atipico', 'no_cuadra', 'no_evaluable', 'informativo']

export function resumir(resultados: readonly ResultadoVerif[]): ResumenVerif {
  const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, 0])) as Record<EstadoVerif, number>
  for (const r of resultados) porEstado[r.estado]++
  return { total: resultados.length, porEstado }
}

/**
 * Verifica el diagnóstico de un libro: Nivel 1 (integridad), Nivel 2 (criterio del libro) y Nivel 3 (razonabilidad
 * física), cada uno con su base declarada. Función pura: mismo libro, mismo resultado.
 */
export function verificarLibro(libro: LibroDerivado): VerificacionLibro {
  const uniones = unirTramosConFichas(libro)
  const n2 = inferirCriterios(libro, uniones)
  const resultados = [...verificarIntegridad(libro, uniones), ...n2.resultados, ...verificarFisica(libro, uniones)]
  return { resultados, criterios: n2.criterios, resumen: resumir(resultados), uniones }
}

const CACHE = new WeakMap<LibroDerivado, VerificacionLibro>()

/** Misma verificación sin repetir el cálculo cuando varias pantallas piden el mismo libro (el libro es inmutable). */
export function verificarLibroCacheado(libro: LibroDerivado): VerificacionLibro {
  const previa = CACHE.get(libro)
  if (previa) return previa
  const v = verificarLibro(libro)
  CACHE.set(libro, v)
  return v
}
