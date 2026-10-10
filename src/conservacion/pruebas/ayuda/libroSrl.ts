import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { normalizarDataJson, VistaLibro } from '../../nucleo'
import { extraerLibro } from '../../derivacion/extraer'
import type { LibroDerivado } from '../../derivacion/tipos'

/** PacOT real de la SRL Unidad Conchos (solo lectura). `CONCHOS_EVIDENCIAS` apunta a otra carpeta con `data.json`. */
export const carpetaEvidencias = process.env.CONCHOS_EVIDENCIAS ?? path.resolve(process.cwd(), '../Conservacion/Skill/ejemplo_Conchos/evidencias')
export const hayEvidencias = existsSync(path.join(carpetaEvidencias, 'data.json'))

let cache: { vista: VistaLibro; libro: LibroDerivado } | null = null

export function libroSrl(): { vista: VistaLibro; libro: LibroDerivado } {
  if (cache === null) {
    const vista = new VistaLibro(normalizarDataJson(JSON.parse(readFileSync(path.join(carpetaEvidencias, 'data.json'), 'utf8')) as unknown, { sha256: 'srl-prueba', extractor: 'prueba' }))
    cache = { vista, libro: extraerLibro(vista) }
  }
  return cache
}
