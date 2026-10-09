import { z } from 'zod'
import type { InformeEjecucion } from '../nucleo'

/**
 * Archivo de informe de SICA Conservación: lo produce el comando local (scripts/conservacion-analizar.mjs)
 * y lo abre la plataforma. Es una entrada NO confiable (un archivo que alguien eligió): se valida con Zod
 * antes de pintarlo y todo texto del documento se trata como dato.
 */
export const FORMATO_INFORME = 'sica-conservacion-informe'
export const VERSION_FORMATO = 1

const texto = z.string()
const textoOpc = z.string().nullable().optional()

const fuente = z.looseObject({ documento: texto, seccion: texto, pagina: z.number().optional() })

const hallazgo = z.looseObject({
  id: texto,
  reglaId: texto,
  titulo: texto,
  detalle: texto,
  origen: z.enum(['pacot', 'formato', 'norma']),
  severidad: z.enum(['alta', 'media', 'informativa']),
  dimensiones: z.record(z.string(), z.string()),
  fuentes: z.array(fuente),
  referencias: z.array(texto),
  esperado: z.string().optional(),
  observado: z.string().optional(),
  diferencia: z.string().optional(),
  estadoEvidencia: texto,
  baseValores: texto,
  parametrosUsados: z.array(z.looseObject({ id: texto, valor: texto, fuente })),
  limites: z.array(texto),
})

const resultado = z.looseObject({
  reglaId: texto,
  estado: z.enum(['superada', 'hallazgo', 'no_evaluable', 'no_aplica', 'error_interno']),
  hallazgos: z.array(hallazgo),
  cobertura: z.looseObject({ revisados: z.number(), identificados: z.number(), unidad: texto }),
  pendientes: z.array(texto),
  motivo: z.string().optional(),
})

const informe = z.looseObject({
  versionMotor: texto,
  matrizSha256: textoOpc,
  libroSha256: textoOpc,
  baseValores: texto,
  fechaReferencia: texto,
  declaracionParametros: z.array(z.looseObject({
    id: texto, nombre: texto, valor: texto, fuente, origen: texto, alternos: z.array(texto), sustento: z.string().optional(),
  })),
  resultados: z.array(resultado),
  reglasNoEjecutadas: z.array(z.looseObject({ id: texto, motivo: texto })),
  reglasSinDatos: z.array(texto),
  coberturaReglas: z.looseObject({ implementadas: z.number(), totales: z.number(), ejecutadas: z.number() }),
  resumen: z.looseObject({ hallazgos: z.number(), alta: z.number(), media: z.number(), informativa: z.number() }),
})

export const esquemaArchivoInforme = z.looseObject({
  formato: z.literal(FORMATO_INFORME),
  version: z.literal(VERSION_FORMATO),
  generadoEn: texto,
  origen: z.looseObject({
    archivoNombre: texto,
    archivoSha256: textoOpc,
    moduloId: textoOpc,
    moduloNombre: textoOpc,
    ciclo: textoOpc,
    lector: textoOpc,
  }),
  catalogoReglas: z.array(z.looseObject({ id: texto, clase: texto, regla: texto, severidad: texto })),
  informe,
})

export interface EntradaCatalogo {
  readonly id: string
  readonly clase: string
  readonly regla: string
  readonly severidad: string
}

export interface OrigenInforme {
  readonly archivoNombre: string
  readonly archivoSha256?: string | null
  readonly moduloId?: string | null
  readonly moduloNombre?: string | null
  readonly ciclo?: string | null
  readonly lector?: string | null
}

export interface ArchivoInforme {
  readonly formato: typeof FORMATO_INFORME
  readonly version: typeof VERSION_FORMATO
  readonly generadoEn: string
  readonly origen: OrigenInforme
  readonly catalogoReglas: readonly EntradaCatalogo[]
  readonly informe: InformeEjecucion
}

/** Tamaño máximo aceptado: un informe de Conchos pesa cientos de KB; un archivo enorme no es un informe. */
export const MAX_BYTES_INFORME = 20 * 1024 * 1024

export type ResultadoLectura =
  | { readonly ok: true; readonly archivo: ArchivoInforme }
  | { readonly ok: false; readonly error: string }

export function leerInforme(textoJson: string): ResultadoLectura {
  if (textoJson.length > MAX_BYTES_INFORME) return { ok: false, error: 'El archivo es demasiado grande para ser un informe de SICA Conservación.' }
  let crudo: unknown
  try { crudo = JSON.parse(textoJson) } catch { return { ok: false, error: 'El archivo no es un JSON válido.' } }
  if (typeof crudo === 'object' && crudo !== null && (crudo as { formato?: unknown }).formato !== FORMATO_INFORME) {
    return { ok: false, error: 'No es un informe de SICA Conservación (falta el campo "formato"). Genere uno con el comando conservacion:analizar.' }
  }
  const r = esquemaArchivoInforme.safeParse(crudo)
  if (!r.success) {
    const i = r.error.issues[0]
    return { ok: false, error: `El informe no tiene la forma esperada: ${i ? `${i.path.join('.') || 'raíz'}: ${i.message}` : 'estructura inválida'}.` }
  }
  return { ok: true, archivo: r.data as unknown as ArchivoInforme }
}
