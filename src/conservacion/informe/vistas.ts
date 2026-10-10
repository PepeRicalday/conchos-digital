import type { Hallazgo, Severidad } from '../nucleo'
import type { ArchivoInforme } from './esquemaInforme'
import { describirEstado, desdeRegla, ETIQUETA_SEVERIDAD, ORDEN_SEVERIDAD as ORDEN_SEV } from '../vocabulario'

/** Funciones puras que derivan lo que la interfaz muestra a partir del archivo de informe. */

export const ORDEN_SEVERIDAD: Readonly<Record<Severidad, number>> = ORDEN_SEV

/** La severidad es un atributo aparte del estado (vocabulario único). */
export const TEXTO_SEVERIDAD: Readonly<Record<Severidad, string>> = ETIQUETA_SEVERIDAD

export const TEXTO_ORIGEN: Readonly<Record<string, string>> = {
  pacot: 'Error del PacOT',
  formato: 'Ambigüedad del formato',
  norma: 'Discrepancia de la norma',
}

export const TEXTO_EVIDENCIA: Readonly<Record<string, string>> = {
  verificada_en_archivo: 'Verificada en el archivo',
  aclarada_por_usuario: 'Aclarada por el usuario',
  sustentada_documentalmente: 'Sustentada documentalmente',
  pendiente_de_evidencia: 'Pendiente de evidencia',
}

export type EstadoReglaVista =
  | 'superada' | 'hallazgo' | 'no_evaluable' | 'sin_datos' | 'error_interno' | 'no_aplica' | 'no_ejecutada' | 'no_implementada'

const ESTADOS_REGLA: readonly EstadoReglaVista[] = ['superada', 'hallazgo', 'no_evaluable', 'sin_datos', 'error_interno', 'no_aplica', 'no_ejecutada', 'no_implementada']

/** Estado canónico de la regla (Coherente · Atípico · No evaluable); el matiz de «no evaluable» va en MOTIVO_ESTADO_REGLA. */
export const TEXTO_ESTADO_REGLA: Readonly<Record<EstadoReglaVista, string>> =
  Object.fromEntries(ESTADOS_REGLA.map((e) => [e, describirEstado(desdeRegla(e)).corta])) as Record<EstadoReglaVista, string>

/** Por qué una regla es «No evaluable» (null si el estado no lo es): la información que antes decían «No implementada», «Sin datos»… */
export const MOTIVO_ESTADO_REGLA: Readonly<Record<EstadoReglaVista, string | null>> =
  Object.fromEntries(ESTADOS_REGLA.map((e) => [e, describirEstado(desdeRegla(e)).motivo])) as Record<EstadoReglaVista, string | null>

/** Motivo breve para listas y selectores: «aún no implementada», «sin datos en el libro»… */
export const MOTIVO_CORTO_REGLA: Readonly<Record<EstadoReglaVista, string | null>> = {
  superada: null, hallazgo: null, no_evaluable: 'faltan datos del libro', sin_datos: 'sin datos en el libro', error_interno: 'falló al ejecutarse',
  no_aplica: 'no aplica a este libro', no_ejecutada: 'no se ejecutó', no_implementada: 'aún no implementada',
}

/** «Coherente», «Atípico» o «No evaluable · aún no implementada». */
export function etiquetaEstadoRegla(e: EstadoReglaVista): string {
  const m = MOTIVO_CORTO_REGLA[e]
  return m === null ? TEXTO_ESTADO_REGLA[e] : `${TEXTO_ESTADO_REGLA[e]} · ${m}`
}

export interface HallazgoVista extends Hallazgo {
  /** Clase de la regla según la matriz norma → regla → prueba (INVENTARIO, MARCO NORMATIVO…). */
  readonly clase: string
}

export function hallazgosPlanos(a: ArchivoInforme): HallazgoVista[] {
  const clasePorRegla = new Map(a.catalogoReglas.map((r) => [r.id, r.clase]))
  const todos = a.informe.resultados.flatMap((r) => r.hallazgos)
  return todos
    .map((h): HallazgoVista => ({ ...h, clase: clasePorRegla.get(h.reglaId) ?? 'SIN CLASE' }))
    .sort((x, y) => ORDEN_SEVERIDAD[x.severidad] - ORDEN_SEVERIDAD[y.severidad] || x.reglaId.localeCompare(y.reglaId) || x.id.localeCompare(y.id))
}

export interface FiltrosHallazgos {
  readonly severidades: ReadonlySet<Severidad>
  readonly clase: string
  readonly origen: string
  readonly regla: string
  readonly texto: string
}

export const SIN_FILTROS: FiltrosHallazgos = { severidades: new Set<Severidad>(), clase: '', origen: '', regla: '', texto: '' }

const normaliza = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function filtrarHallazgos(lista: readonly HallazgoVista[], f: FiltrosHallazgos): HallazgoVista[] {
  const q = normaliza(f.texto.trim())
  return lista.filter((h) => {
    if (f.severidades.size > 0 && !f.severidades.has(h.severidad)) return false
    if (f.clase && h.clase !== f.clase) return false
    if (f.origen && h.origen !== f.origen) return false
    if (f.regla && h.reglaId !== f.regla) return false
    if (q === '') return true
    return normaliza(`${h.id} ${h.reglaId} ${h.titulo} ${h.detalle} ${h.referencias.join(' ')}`).includes(q)
  })
}

export function contarPor(lista: readonly HallazgoVista[], clave: (h: HallazgoVista) => string): Array<[string, number]> {
  const m = new Map<string, number>()
  for (const h of lista) m.set(clave(h), (m.get(clave(h)) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export interface FilaRegla {
  readonly id: string
  readonly clase: string
  readonly regla: string
  readonly severidadBase: string
  readonly estado: EstadoReglaVista
  readonly cobertura: { readonly revisados: number; readonly identificados: number; readonly unidad: string } | null
  readonly nHallazgos: number
  readonly pendientes: readonly string[]
  readonly motivo: string | null
}

/** Las 52 reglas de la matriz con lo que el motor hizo con cada una. Una regla sin resultado es "no implementada": nunca "superada". */
export function filasReglas(a: ArchivoInforme): FilaRegla[] {
  const { resultados, reglasSinDatos, reglasNoEjecutadas } = a.informe
  const sinDatos = new Set(reglasSinDatos)
  const noEjecutadas = new Set(reglasNoEjecutadas.map((r) => r.id))
  const porRegla = new Map<string, typeof resultados>()
  for (const r of resultados) porRegla.set(r.reglaId, [...(porRegla.get(r.reglaId) ?? []), r])
  return a.catalogoReglas.map((c): FilaRegla => {
    const rs = porRegla.get(c.id) ?? []
    const primero = rs[0]
    let estado: EstadoReglaVista
    if (sinDatos.has(c.id)) estado = 'sin_datos'
    else if (noEjecutadas.has(c.id)) estado = 'no_ejecutada'
    else if (!primero) estado = 'no_implementada'
    else if (rs.some((r) => r.estado === 'error_interno')) estado = 'error_interno'
    else if (rs.some((r) => r.estado === 'hallazgo')) estado = 'hallazgo'
    else estado = primero.estado
    return {
      id: c.id, clase: c.clase, regla: c.regla, severidadBase: c.severidad, estado,
      cobertura: primero ? { revisados: rs.reduce((s, r) => s + r.cobertura.revisados, 0), identificados: rs.reduce((s, r) => s + r.cobertura.identificados, 0), unidad: primero.cobertura.unidad } : null,
      nHallazgos: rs.reduce((s, r) => s + r.hallazgos.length, 0),
      pendientes: rs.flatMap((r) => r.pendientes),
      motivo: primero?.motivo ?? null,
    }
  })
}

export interface ResumenReglas {
  readonly total: number
  readonly implementadas: number
  readonly conHallazgos: number
  readonly sinHallazgos: number
  readonly sinDatos: number
  readonly noImplementadas: number
}

export function resumenReglas(filas: readonly FilaRegla[]): ResumenReglas {
  const cuenta = (e: EstadoReglaVista): number => filas.filter((f) => f.estado === e).length
  const noImplementadas = cuenta('no_implementada')
  return {
    total: filas.length,
    implementadas: filas.length - noImplementadas,
    conHallazgos: cuenta('hallazgo'),
    sinHallazgos: cuenta('superada'),
    sinDatos: cuenta('sin_datos') + cuenta('no_evaluable') + cuenta('no_ejecutada'),
    noImplementadas,
  }
}

export function partirReferencia(ref: string): { hoja: string; celda: string } | null {
  const i = ref.lastIndexOf('!')
  if (i <= 0 || i === ref.length - 1) return null
  return { hoja: ref.slice(0, i), celda: ref.slice(i + 1) }
}

/** Cuántos pendientes declarados hay en total (cada uno es algo que el motor NO pudo comprobar). */
export function totalPendientes(a: ArchivoInforme): number {
  return a.informe.resultados.reduce((s, r) => s + r.pendientes.length, 0)
}

export function nombreSeguroArchivo(a: ArchivoInforme): string {
  const base = (a.origen.moduloId ?? a.origen.moduloNombre ?? 'modulo').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'modulo'
  return `informe-conservacion-${base}-${a.generadoEn.slice(0, 10)}`
}
