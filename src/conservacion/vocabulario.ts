/**
 * Vocabulario único de SICA Conservación (puro, sin React). Un mismo hecho se dice con las mismas palabras en toda la UI:
 *  - estados canónicos (los 4 vocabularios existentes se MAPEAN aquí; ninguno se reemplaza en su módulo de origen);
 *  - nombres canónicos de concepto, red, módulo/documento y PK;
 *  - ids internos legibles y textos estándar de honestidad.
 * Regla dura: ninguna etiqueta dice «correcto», «aprobado», «conforme» ni «válido». Coherencia con el propio libro
 * o candidato a revisión; nunca aprobación ni rechazo. El rótulo original del libro SIEMPRE se conserva (la UI lo pone en `title`).
 */
import { parsearPK } from './nucleo/num/pk'
import type { Severidad } from './nucleo/tipos/regla'
import type { TipoRed } from './derivacion/tipos'
import type { EstadoVerif } from './verificacion/tipos'
import type { EstadoComp } from './verificacion/comprobacion'
import type { EstadoConciliacion } from './derivacion/registro'
import type { EstadoPrueba } from './nucleo/tipos/regla'
import { familia as familiaDeRotulo, type Familia } from './verificacion/criterio'

/* ───────────────────────────── Estados ───────────────────────────── */

export type EstadoCanonico = 'coherente' | 'atipico' | 'no_evaluable' | 'informativo' | 'parcial' | 'discrepa'

/** «no_evaluable» exige MOTIVO (qué falta o por qué no aplica); los demás estados no lo llevan. */
export type EstadoConMotivo =
  | { readonly estado: 'no_evaluable'; readonly motivo: string }
  | { readonly estado: Exclude<EstadoCanonico, 'no_evaluable'>; readonly motivo?: undefined }

export type TonoEstado = 'ok' | 'aviso' | 'neutro' | 'info' | 'alerta'

export interface DescripcionEstado {
  readonly estado: EstadoCanonico
  /** Para chips y celdas: una o dos palabras. */
  readonly corta: string
  /** Para encabezados y tarjetas. */
  readonly larga: string
  /** Nombre de ícono de lucide-react (solo el nombre; este módulo no importa React). */
  readonly icono: 'CircleCheck' | 'CircleAlert' | 'CircleHelp' | 'Info' | 'CircleDashed' | 'CircleX'
  /** Intención de color: «alerta» solo para contradicciones aritméticas del propio libro. */
  readonly tono: TonoEstado
  /** Solo en no_evaluable: por qué. */
  readonly motivo: string | null
}

const BASE_ESTADO: Readonly<Record<EstadoCanonico, Omit<DescripcionEstado, 'motivo'>>> = {
  coherente: { estado: 'coherente', corta: 'Coherente', larga: 'Coherente con el propio libro', icono: 'CircleCheck', tono: 'ok' },
  atipico: { estado: 'atipico', corta: 'Atípico', larga: 'Atípico: candidato a revisión', icono: 'CircleAlert', tono: 'aviso' },
  no_evaluable: { estado: 'no_evaluable', corta: 'No evaluable', larga: 'No evaluable', icono: 'CircleHelp', tono: 'neutro' },
  informativo: { estado: 'informativo', corta: 'Informativo', larga: 'Informativo', icono: 'Info', tono: 'info' },
  parcial: { estado: 'parcial', corta: 'Parcial', larga: 'Parcial: faltan datos para cerrar la cuenta', icono: 'CircleDashed', tono: 'neutro' },
  discrepa: { estado: 'discrepa', corta: 'No cuadra', larga: 'No cuadra con su propia cuenta', icono: 'CircleX', tono: 'alerta' },
}

export function describirEstado(e: EstadoConMotivo): DescripcionEstado {
  return { ...BASE_ESTADO[e.estado], motivo: e.estado === 'no_evaluable' ? e.motivo : null }
}

/** Etiquetas fijas de cada estado canónico (sin motivo). Útil para leyendas. */
export const ETIQUETAS_ESTADO: Readonly<Record<EstadoCanonico, { readonly corta: string; readonly larga: string }>> = {
  coherente: BASE_ESTADO.coherente, atipico: BASE_ESTADO.atipico, no_evaluable: BASE_ESTADO.no_evaluable,
  informativo: BASE_ESTADO.informativo, parcial: BASE_ESTADO.parcial, discrepa: BASE_ESTADO.discrepa,
}

/** Verificación (DIAG-01, EstadoVerif). `cuadra`→coherente · `no_cuadra`→discrepa. El motivo de no_evaluable lo da el llamante. */
export function desdeVerif(e: EstadoVerif, motivo = 'Faltan datos en el libro para evaluarlo'): EstadoConMotivo {
  switch (e) {
    case 'cuadra': return { estado: 'coherente' }
    case 'atipico': return { estado: 'atipico' }
    case 'no_cuadra': return { estado: 'discrepa' }
    case 'informativo': return { estado: 'informativo' }
    case 'no_evaluable': return { estado: 'no_evaluable', motivo }
  }
}

/** Comprobación por tramo (EstadoComp). */
export function desdeComp(e: EstadoComp, motivo = 'El tramo no trae los datos para recalcularlo'): EstadoConMotivo {
  switch (e) {
    case 'cuadra': return { estado: 'coherente' }
    case 'atipico': return { estado: 'atipico' }
    case 'no_evaluable': return { estado: 'no_evaluable', motivo }
  }
}

/** Concentrado (EstadoConciliacion). `difiere`→discrepa · `incompleto`→parcial; los demás son «no evaluable» con su motivo propio. */
export function desdeConciliacion(e: EstadoConciliacion): EstadoConMotivo {
  switch (e) {
    case 'coincide': return { estado: 'coherente' }
    case 'difiere': return { estado: 'discrepa' }
    case 'incompleto': return { estado: 'parcial' }
    case 'sin_srl': return { estado: 'no_evaluable', motivo: 'La SRL no trae este concepto' }
    case 'sin_modulos': return { estado: 'no_evaluable', motivo: 'Ningún módulo registrado trae este concepto' }
    case 'no_aplica_srl': return { estado: 'no_evaluable', motivo: 'No aplica a la SRL (no tiene red de drenaje)' }
  }
}

/** Estado de una regla del comprobador (nucleo) o de su vista (informe/vistas.ts EstadoReglaVista). */
export type EstadoReglaEntrada = EstadoPrueba | 'sin_datos' | 'no_ejecutada' | 'no_implementada'
export function desdeRegla(e: EstadoReglaEntrada): EstadoConMotivo {
  switch (e) {
    case 'superada': return { estado: 'coherente' }
    case 'hallazgo': return { estado: 'atipico' }
    case 'no_evaluable': return { estado: 'no_evaluable', motivo: 'El libro no trae los datos que la regla necesita' }
    case 'sin_datos': return { estado: 'no_evaluable', motivo: 'Sin datos en el libro para esta regla' }
    case 'no_aplica': return { estado: 'no_evaluable', motivo: 'La regla no aplica a este libro' }
    case 'no_ejecutada': return { estado: 'no_evaluable', motivo: 'La regla no se ejecutó' }
    case 'no_implementada': return { estado: 'no_evaluable', motivo: 'La regla aún no está implementada' }
    case 'error_interno': return { estado: 'no_evaluable', motivo: 'La regla falló al ejecutarse' }
  }
}

/** La severidad es un atributo APARTE del estado (nunca se mezcla con él). */
export const ETIQUETA_SEVERIDAD: Readonly<Record<Severidad, string>> = { alta: 'Alta', media: 'Media', informativa: 'Informativa' }
export const ORDEN_SEVERIDAD: Readonly<Record<Severidad, number>> = { alta: 0, media: 1, informativa: 2 }

/* ─────────────────────────── Razón del atípico ─────────────────────────── */

/**
 * Por qué un tramo es atípico:
 *  - criterio: compara contra el grupo del propio libro (CRI-02);
 *  - control_adicional: comparación del comprobador (p. ej. descopete > desazolve, FIS-xx);
 *  - conciliacion: contra otra hoja del libro (IO4↔IO1, INT-15);
 *  - regla: hallazgo de una regla normativa del comprobador.
 */
export type RazonAtipico = 'criterio' | 'control_adicional' | 'conciliacion' | 'regla'

export const TEXTO_RAZON_ATIPICO: Readonly<Record<RazonAtipico, { readonly corta: string; readonly larga: string }>> = {
  criterio: { corta: 'Por criterio', larga: 'Se aparta del criterio que el libro aplica a la mayoría de sus tramos' },
  control_adicional: { corta: 'Control adicional', larga: 'Falla una comparación adicional del comprobador, ajena al criterio del libro' },
  conciliacion: { corta: 'Por conciliación', larga: 'No coincide con otra hoja del mismo libro (p. ej. IO4 contra IO1)' },
  regla: { corta: 'Por regla', larga: 'Una regla normativa del comprobador lo marca para revisión' },
}

/** Razón de un atípico a partir del id de ResultadoVerif (CRI-02 → criterio; INT-xx → conciliación; el resto → control adicional). */
export function razonAtipicoDeId(id: string): RazonAtipico {
  const regla = id.split(':')[0] ?? ''
  if (regla === 'CRI-02') return 'criterio'
  if (regla.startsWith('INT-')) return 'conciliacion'
  return 'control_adicional'
}

/* ─────────────────────────── Textos de honestidad ─────────────────────────── */

export const AVISO_HONESTIDAD_COHERENCIA =
  'Esto marca coherencia con el propio libro o un candidato a revisión; no es aprobación ni rechazo.'
export const TEXTO_SIN_DATOS_AMBOS = 'Sin datos en ambos'
export const TEXTO_SIN_DATO = 'S/D'

/* ───────────────────────────── Conceptos ───────────────────────────── */

export interface NombreConcepto {
  /** Nombre canónico para mostrar. */
  readonly canonico: string
  /** Rótulo tal como viene del libro (la UI lo pone en `title`). Nunca se altera. */
  readonly rotuloLibro: string
  readonly familia: Familia
  /** false: el rótulo no está en la tabla de alias; solo se normalizó (mayúsculas→oración), sin inventar tildes ni alias. */
  readonly conocido: boolean
}

export interface ContextoConcepto {
  readonly red?: TipoRed | null
  /** Bloque de 3DN, p. ej. «RED DE DISTRIBUCION». */
  readonly bloque?: string | null
}

/** Minúsculas sin tildes, espacios colapsados, sin puntuación final. */
export const claveSinTildes = (t: string): string =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').replace(/[.:;,\s]+$/, '').trim()

/** Quita sufijos que el comprobador añade al rótulo: « (col. DESAZOLVE)», « (columna sin uso en caminos)». */
export function quitarSufijoColumna(r: string): string {
  return r.replace(/\s*\((?:col\.|columna)[^)]*\)\s*$/i, '').replace(/\s+/g, ' ').trim()
}

const TERRACERIAS_DESCOPETE = 'Terracerías (descopete)'

/** clave sin tildes → [nombre canónico, familia]. Solo alias que aparecen en los libros reales. */
const ALIAS: Readonly<Record<string, readonly [string, Familia]>> = {
  'desazolve': ['Desazolve', 'desazolve'],
  'descopete bordos': [TERRACERIAS_DESCOPETE, 'descopete'],
  'descopete de bordos': [TERRACERIAS_DESCOPETE, 'descopete'],
  'extrac. plantas acuaticas': ['Extracción de plantas acuáticas', 'acuaticas'],
  'extraccion de plantas acuaticas': ['Extracción de plantas acuáticas', 'acuaticas'],
  'limpia y deshierbe': ['Limpia y deshierbe', 'limpia'],
  'extraccion de plantas terrestres': ['Limpia y deshierbe', 'limpia'],
  'reparacion de revestimiento': ['Reparación de revestimiento', 'revestimiento'],
  'reparacion revestimiento': ['Reparación de revestimiento', 'revestimiento'],
  'reposicion de revestimiento': ['Reposición de revestimiento', 'revestimiento'],
  'reposicion revestimiento': ['Reposición de revestimiento', 'revestimiento'],
  'conformacion': ['Conformación', 'otro'],
  'rastreo': ['Rastreo', 'otro'],
  'reparacion obra civil': ['Reparación de obra civil', 'otro'],
  'reparacion compuertas y mecanismos': ['Reparación de compuertas y mecanismos', 'otro'],
  'reparacion mantenimiento': ['Reparación y mantenimiento', 'otro'],
}

const esRedCanales = (c: ContextoConcepto): boolean => {
  if (c.red === 'distribucion' || c.red === 'tuberia') return true
  if (c.red) return false
  return c.bloque ? /distribuci/.test(claveSinTildes(c.bloque)) : false
}

/** Mayúsculas sostenidas → oración. Si ya trae minúsculas se deja como viene. Nunca añade tildes. */
function aOracion(t: string): string {
  if (t === t.toUpperCase() && t !== t.toLowerCase()) {
    const m = t.toLowerCase()
    return m.charAt(0).toUpperCase() + m.slice(1)
  }
  return t
}

export function nombreConcepto(rotuloLibro: string, contexto: ContextoConcepto = {}): NombreConcepto {
  const limpio = quitarSufijoColumna(rotuloLibro)
  const clave = claveSinTildes(limpio)
  // «Terracerías» a secas es ambiguo: en canales es el descopete de bordos; en caminos y drenes es terracería.
  if (clave === 'terracerias') {
    return esRedCanales(contexto)
      ? { canonico: TERRACERIAS_DESCOPETE, rotuloLibro, familia: 'descopete', conocido: true }
      : { canonico: 'Terracerías', rotuloLibro, familia: 'terracerias', conocido: true }
  }
  const alias = ALIAS[clave]
  if (alias) return { canonico: alias[0], rotuloLibro, familia: alias[1], conocido: true }
  const canonico = aOracion(limpio)
  return { canonico, rotuloLibro, familia: familiaDeRotulo(limpio), conocido: false }
}

/* ───────────────────────────── Redes, módulos, documento ───────────────────────────── */

export const NOMBRE_RED_CANONICO: Readonly<Record<TipoRed, string>> = {
  distribucion: 'Red de distribución',
  tuberia: 'Red de distribución en tubería',
  drenaje: 'Red de drenaje',
  caminos: 'Red de caminos',
  otro: 'Otras redes',
}

export function nombreRed(red: TipoRed): string {
  return NOMBRE_RED_CANONICO[red]
}

/** «RED DE DISTRIBUCION», «Red de distribución (canales)», «Red de drenaje (drenes)»… → tipo de red; null si no es una red. */
export function redDeRotulo(rotulo: string): TipoRed | null {
  const t = claveSinTildes(rotulo)
  if (/^red de distribucion.*tuberia/.test(t)) return 'tuberia'
  if (/^red de distribucion/.test(t)) return 'distribucion'
  if (/^red de drenaje/.test(t)) return 'drenaje'
  if (/^red de caminos/.test(t)) return 'caminos'
  return null
}

export interface FichaMinima { readonly tipo: 'SRL' | 'MODULO'; readonly numeroModulo: number | null }

export const NOMBRE_SRL = 'SRL Unidad Conchos'

/** «Módulo 5» o «SRL Unidad Conchos». */
export function nombreModulo(f: FichaMinima): string {
  return f.tipo === 'SRL' ? NOMBRE_SRL : `Módulo ${f.numeroModulo ?? 'S/D'}`
}

/** Identificador corto: «SRL» o «M5». */
export function siglaAmbito(f: FichaMinima): string {
  return f.tipo === 'SRL' ? 'SRL' : `M${f.numeroModulo ?? 'S/D'}`
}

/** «PacOT» nombra solo al DOCUMENTO: «PacOT del Módulo 5», «PacOT de la SRL Unidad Conchos». */
export function rotuloDocumento(f: FichaMinima): string {
  return f.tipo === 'SRL' ? `PacOT de la ${NOMBRE_SRL}` : `PacOT del ${nombreModulo(f)}`
}

/* ───────────────────────────── PK ───────────────────────────── */

/**
 * Cadenamiento siempre «K-68+720». Acepta «68+720», «K-68+720», « K- 48+000», «K68+720» y metros (68720).
 * Lo que no se puede leer devuelve «S/D» (nunca se inventa).
 */
export function formatoPK(pk: string | number | null | undefined): string {
  let metros: number | null = null
  if (typeof pk === 'number') metros = Number.isFinite(pk) && pk >= 0 ? pk : null
  else if (typeof pk === 'string') {
    const r = parsearPK(pk)
    if (r.ok) metros = Number(r.metros.toFixed())
    else if (/^\s*\d+(?:\.\d+)?\s*$/.test(pk)) metros = Number(pk)
  }
  if (metros === null) return TEXTO_SIN_DATO
  const m = Math.round(metros)
  return `K-${Math.floor(m / 1000)}+${String(m % 1000).padStart(3, '0')}`
}

/* ───────────────────────────── IDs internos ───────────────────────────── */

export interface IdLegible {
  /** Frase que explica qué se revisó. */
  readonly titulo: string
  /** El id interno exacto, para copiar y citar. */
  readonly idCopiable: string
  /** Código de la regla («INT-15»), o el id completo si no se reconoce. */
  readonly regla: string
}

const REGLAS: Readonly<Record<string, string>> = {
  'INT-01': 'Tramo del diagnóstico sin ficha en el inventario',
  'INT-02': 'Ficha del inventario que no aparece en el diagnóstico',
  'INT-03': 'Cadenamiento del diagnóstico distinto del inventario',
  'INT-04': 'Cantidad paramétrica contra la longitud del tramo',
  'INT-05': 'Longitud efectiva contra la diferencia de cadenamientos',
  'INT-06': 'Longitud del diagnóstico contra la del inventario',
  'INT-07': 'Suma de tramos de la red contra el total del inventario',
  'INT-08': 'Total de DIAG-01 contra la suma de sus tramos',
  'INT-09': 'Texto en una celda numérica',
  'INT-10': 'Valor de 3DN contra el total de DIAG-01',
  'INT-11': 'Base paramétrica de 3DN contra la de DIAG-01',
  'INT-12': 'Enlace de 3DN con DIAG-01',
  'INT-13': 'Tubería listada en dos bloques',
  'INT-14': 'Revestimiento del inventario contra el del diagnóstico',
  'INT-15': 'Estructuras: IO4 contra IO1',
  'CRI-01': 'Criterio que el libro aplica a un concepto',
  'CRI-02': 'Tramo que se aparta del criterio del libro',
  'FIS-01': 'Sección y gasto de la ficha coherentes entre sí',
  'FIS-02': 'Coeficiente de rugosidad implícito (referencia técnica)',
  'FIS-03': 'Azolve implícito contra la sección del canal',
  'FIS-04': 'Plantas acuáticas contra el espejo de agua',
  'descopete-vs-desazolve': 'Descopete contra desazolve del mismo tramo',
  'revestimiento-equivalencia': 'Equivalencia aproximada en losa',
  'unidad-supuesta': 'Unidad supuesta del concepto',
}

const ES_NUM = /^\d+$/

/**
 * Explica un id interno. Ejemplos:
 *  «INT-15:tramo:18»     → «Estructuras: IO4 contra IO1 · tramo de la fila 18»
 *  «CRI-02:55:DESAZOLVE» → «Tramo que se aparta del criterio del libro · fila 55 · Desazolve»
 */
export function idLegible(idInterno: string, contexto: ContextoConcepto = {}): IdLegible {
  const partes = idInterno.split(':')
  const regla = partes[0] ?? idInterno
  const base = REGLAS[regla]
  if (base === undefined) return { titulo: `Resultado ${idInterno}`, idCopiable: idInterno, regla: idInterno }
  const extra: string[] = []
  const resto = partes.slice(1)
  for (let i = 0; i < resto.length; i++) {
    const p = resto[i] ?? ''
    if (p === 'resumen') extra.push('resumen')
    else if (p === 'tramo') { const n = resto[i + 1]; if (n !== undefined && ES_NUM.test(n)) { extra.push(`tramo de la fila ${n}`); i++ } }
    else if (p === 'tipo') { const n = resto[i + 1]; if (n !== undefined) { extra.push(`tipo de estructura ${n}`); i++ } }
    else if (p === 'sin-clasificar') extra.push('nombres sin clasificar')
    else if (ES_NUM.test(p)) extra.push(`fila ${p}`)
    else if (p === 'distribucion' || p === 'tuberia' || p === 'drenaje' || p === 'caminos' || p === 'otro') extra.push(nombreRed(p))
    else if (regla === 'CRI-01' || regla === 'CRI-02' || regla.startsWith('FIS-') || regla === 'INT-04') extra.push(nombreConcepto(p, contexto).canonico)
    else extra.push(p)
  }
  return { titulo: extra.length > 0 ? `${base} · ${extra.join(' · ')}` : base, idCopiable: idInterno, regla }
}
