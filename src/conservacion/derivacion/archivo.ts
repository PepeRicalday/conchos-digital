import { z } from 'zod'
import { claveDe, concentrar, estadoDelCiclo, MODULOS_ESPERADOS } from './registro'
import type { FilaConcentrado, PacotRegistrado, Registro } from './registro'
import { FAMILIAS, TIPOS_ESTRUCTURA, TIPOS_IO1 } from '../estructuras/catalogo'
import type { FamiliaId, TipoIO1 } from '../estructuras/catalogo'

/**
 * Archivo de derivación de un ciclo: lo escribe el comando local y lo abre la plataforma.
 * Contiene los PacOT registrados (cifras con celda y fórmula), no los libros .xls. Se valida con Zod al leer.
 */

export const FORMATO_DERIVACION = 'sica-conservacion-derivacion'
export const VERSION_DERIVACION = 1

const cifra = z.object({
  valor: z.string().nullable(),
  ref: z.string(),
  formula: z.string().nullable(),
  origen: z.enum(['formula', 'capturado', 'vacio']),
  texto: z.string().optional(),
})
const red = z.enum(['distribucion', 'tuberia', 'drenaje', 'caminos', 'otro'])
const conceptoTramo = z.object({ concepto: z.string(), parametrica: cifra, trabajo: cifra })

const defectoCoord = z.enum(['vacia', 'ilegible', 'duplicada', 'eje_incorrecto']).nullable()
const coordenadas = {
  lon: z.number().nullable(), lat: z.number().nullable(), lonTexto: z.string().nullable(), latTexto: z.string().nullable(),
  defectoLon: defectoCoord, defectoLat: defectoCoord,
}
const ramal = z.enum(['principal', 'auxiliar'])
const puntoCanal = z.object({ pk: z.string().nullable(), ...coordenadas, refPK: z.string(), refLon: z.string(), refLat: z.string() })
const conteos = z.object({
  porTipo: z.object(Object.fromEntries(TIPOS_IO1.map((t) => [t, z.number().nullable()])) as Record<TipoIO1, z.ZodNullable<z.ZodNumber>>),
  total: z.number().nullable(),
})
const ubicacion = z.object({ estado: z.enum(['valida', 'estimada', 'sin_ubicar']), lon: z.number().nullable(), lat: z.number().nullable(), motivo: z.string().nullable() })

// Los campos de ubicación (extractor v4) son opcionales: un archivo anterior no los trae y se vuelve a leer al actualizar.
const fichaCanal = z.object({
  fila: z.number(), inventario: z.string(), nombre: z.string(), categoria: z.string().nullable(),
  pkInicial: z.string().nullable(), pkFinal: z.string().nullable(), km: cifra, gasto: cifra, velocidad: cifra, pendiente: cifra,
  area: cifra, plantilla: cifra, tirante: cifra, libreBordo: cifra, talud: cifra, corona: cifra,
  revestimiento: z.string().nullable(), seccion: z.string().nullable(),
  ini: puntoCanal.optional(), fin: puntoCanal.optional(), conteos: conteos.optional(), ramal: ramal.optional(),
})
const estructura = z.object({
  fila: z.number(), inventario: z.string(), tipoCrudo: z.string(), cadenamientoTexto: z.string(),
  pk: z.string().nullable(), pkMetros: z.number().nullable(), pkParcialKm: z.number().nullable(), motivoPK: z.string().nullable(),
  margen: z.enum(['I', 'D']).nullable(), notaPK: z.string().nullable(), ramal,
  categoria: z.enum(['operacion', 'proteccion', 'cruce']).nullable(), correspondencia: z.string().nullable(), material: z.string().nullable(),
  tipo: z.enum(TIPOS_ESTRUCTURA), familia: z.enum(FAMILIAS.map((f) => f.id) as [FamiliaId, ...FamiliaId[]]).nullable(),
  subtipo: z.string().nullable(), ambiguo: z.boolean(),
  ...coordenadas, ubicacion, ref: z.string(),
  // Libros de varios canales (extractor v6): sin estos campos el esquema los descartaba y todas las estructuras caían en cada canal.
  canal: z.string().optional(), canalHeredado: z.boolean().optional(), pkEnMetros: z.boolean().optional(),
})
const edificio = z.object({
  fila: z.number(), inventario: z.string(), nombre: z.string(), ubicacionTexto: z.string(), pk: z.string().nullable(),
  caracteristicas: z.string().nullable(), uso: z.string().nullable(), areaM2: z.number().nullable(),
  ...coordenadas, ubicacion, ref: z.string(),
})
const fichaCamino = z.object({
  fila: z.number(), inventario: z.string(), nombre: z.string(), pkInicial: z.string().nullable(), pkFinal: z.string().nullable(),
  km: cifra, servicio: z.string().nullable(), ancho: cifra, revestimiento: z.string().nullable(),
})

const libro = z.object({
  sha256: z.string(),
  moduloNombre: z.string().nullable(),
  ciclo: z.string().nullable(),
  baseValores: z.enum(['cache', 'recalculo-nativo']),
  conceptosDiagnostico: z.array(z.string()),
  tramos: z.array(z.object({
    fila: z.number(), red, inventario: z.string(), obra: z.string(), pkInicial: z.string(), pkFinal: z.string(),
    km: cifra, conceptos: z.array(conceptoTramo),
  })),
  totalesDiagnostico: z.array(conceptoTramo),
  filasTotales: z.array(z.object({ fila: z.number(), km: cifra, conceptos: z.array(conceptoTramo) })).default([]),
  necesidades: z.array(z.object({
    fila: z.number(), bloque: z.string(), concepto: z.string(),
    unidadParametrica: z.string().nullable(), unidadTrabajo: z.string().nullable(),
    cantidadParametrica: cifra, cantidadTrabajo: cifra, frecuencia: cifra, etiquetaFrecuencia: z.string().nullable(),
    necesidadAnual: cifra, pu: cifra, importe: cifra,
    enlaceDiagnostico: z.object({ columna: z.string(), fila: z.number() }).nullable(),
  })),
  sumasBloque: z.array(z.object({ fila: z.number(), bloque: z.string(), importe: cifra })),
  totalGeneral3dn: cifra.nullable(),
  programa: z.array(z.object({
    fila: z.number(), inventario: z.string(), clave: z.string(), red, encabezado: z.string(), maquinas: z.string().nullable(),
    obra: z.string(), localizacion: z.string(), km: cifra, cantidad: cifra, unidad: z.string().nullable(), pu: cifra, importe: cifra,
  })),
  inventarioKm: z.object({ distribucion: cifra, drenaje: cifra, caminos: cifra }),
  // Archivos generados con una versión anterior no traen fichas: se leen como vacías y el libro se vuelve a leer al actualizar.
  fichas: z.object({
    canales: z.array(fichaCanal), drenes: z.array(fichaCanal), caminos: z.array(fichaCamino),
    estructuras: z.array(estructura).optional(), edificios: z.array(edificio).optional(), totalesIO1: conteos.optional(),
    anclaAuxiliar: z.string().nullable().optional(), avisosGeo: z.array(z.string()).optional(),
  }).default({ canales: [], drenes: [], caminos: [] }),
  extractorVersion: z.number().int().default(1),
  avisos: z.array(z.string()),
})

const ficha = z.object({
  tipo: z.enum(['SRL', 'MODULO']),
  numeroModulo: z.number().int().nullable(),
  moduloTexto: z.string(), srl: z.string(), rfcSrl: z.string(), distrito: z.string(), ciclo: z.string(),
})

const pacot = z.object({
  clave: z.string(), ficha, libro, archivoNombre: z.string(),
  version: z.number().int().positive(), registradoEn: z.string(),
  /** Avisos de la admisión (p. ej. RFC pendiente de comprobar). */
  avisosAdmision: z.array(z.string()),
})

export const esquemaArchivoDerivacion = z.object({
  formato: z.literal(FORMATO_DERIVACION),
  version: z.literal(VERSION_DERIVACION),
  generadoEn: z.string(),
  ciclo: z.string(),
  modulosEsperados: z.array(z.number().int()),
  pacots: z.array(pacot),
})

export type ArchivoDerivacion = z.infer<typeof esquemaArchivoDerivacion> & {
  /** Calculado al escribir para quien solo lea el archivo; la plataforma lo recalcula desde `pacots`. */
  readonly resumen: ResumenCiclo
}

export interface ResumenCiclo {
  readonly srlRegistrada: boolean
  readonly modulosRegistrados: readonly number[]
  readonly modulosPendientes: readonly number[]
  readonly completo: boolean
  readonly filasConcentrado: number
  readonly porEstado: Readonly<Record<string, number>>
}

export type PacotConAvisos = PacotRegistrado & { readonly avisosAdmision: readonly string[] }

export function resumirCiclo(reg: Registro, ciclo: string, esperados: readonly number[] = MODULOS_ESPERADOS): { resumen: ResumenCiclo; filas: FilaConcentrado[] } {
  const st = estadoDelCiclo(reg, ciclo, esperados)
  const filas = concentrar(st)
  const porEstado: Record<string, number> = {}
  for (const f of filas) porEstado[f.estado] = (porEstado[f.estado] ?? 0) + 1
  return {
    filas,
    resumen: {
      srlRegistrada: st.srl !== null,
      modulosRegistrados: st.modulos.map((p) => p.ficha.numeroModulo ?? 0),
      modulosPendientes: st.modulosFaltantes,
      completo: st.completo,
      filasConcentrado: filas.length,
      porEstado,
    },
  }
}

export function construirArchivo(
  reg: Registro, avisos: ReadonlyMap<string, readonly string[]>, ciclo: string, ahora: string,
  esperados: readonly number[] = MODULOS_ESPERADOS,
): ArchivoDerivacion {
  const pacots = [...reg.values()].filter((p) => p.ficha.ciclo === ciclo)
    .sort((a, b) => a.clave.localeCompare(b.clave))
    .map((p) => ({ ...p, avisosAdmision: [...(avisos.get(p.clave) ?? [])] }))
  const { resumen } = resumirCiclo(reg, ciclo, esperados)
  return {
    formato: FORMATO_DERIVACION, version: VERSION_DERIVACION, generadoEn: ahora, ciclo,
    modulosEsperados: [...esperados], pacots: pacots as ArchivoDerivacion['pacots'], resumen,
  }
}

/** Lee y valida un archivo; devuelve el registro y los avisos de admisión por clave. Lanza ZodError si no cuadra. */
export function leerArchivoDerivacion(crudo: unknown): { registro: Registro; avisos: Map<string, readonly string[]>; ciclo: string; modulosEsperados: readonly number[] } {
  const a = esquemaArchivoDerivacion.parse(crudo)
  const registro = new Map<string, PacotRegistrado>()
  const avisos = new Map<string, readonly string[]>()
  for (const p of a.pacots) {
    if (p.clave !== claveDe(p.ficha)) throw new Error(`La clave "${p.clave}" no corresponde a su ficha (${claveDe(p.ficha)}).`)
    registro.set(p.clave, { clave: p.clave, ficha: p.ficha, libro: p.libro, archivoNombre: p.archivoNombre, version: p.version, registradoEn: p.registradoEn })
    avisos.set(p.clave, p.avisosAdmision)
  }
  return { registro, avisos, ciclo: a.ciclo, modulosEsperados: a.modulosEsperados }
}
