/**
 * ubicacionModelo — modelo PURO (sin React ni DOM) de lo que muestran el perfil del canal, la ventana de ubicación y la infografía:
 * los tramos de un concepto puestos sobre su eje de cadenamiento, las obras del inventario (IO4 estructuras, IO7 edificios) con el
 * estado de su ubicación, los conteos declarados (IO1) contra los inventariados (IO4) y las operaciones de ventana/selección.
 *
 * Regla rectora: la pantalla y la infografía se alimentan de ESTE modelo, de modo que cuentan los mismos tramos y las mismas obras.
 * Nada se inventa: un dato ausente es null («S/D»), una posición interpolada es 'estimada', y lo que no se puede situar se lista.
 */
import type { Comprobacion, EstadoComp } from '../../../conservacion/verificacion/comprobacion'
import type { Edificio, Estructura, FichaCanal, LibroDerivado, Ramal, EstadoUbicacion, DefectoCoord } from '../../../conservacion/derivacion/tipos'
import { FAMILIAS, INFO_TIPO, TABLA_IO4_IO1, COLUMNA_IO1 } from '../../../conservacion/estructuras/catalogo'
import type { FamiliaId, TipoEstructura } from '../../../conservacion/estructuras/catalogo'
import { construirEjes, cuerdaPorPK, pkAMetros, subtrazoPorPK, usaTrazo } from '../../../conservacion/geo/kmALatLng'
import type { EjeCanal, EjesCanal, SaltoCadenamiento } from '../../../conservacion/geo/kmALatLng'
import type { Trazo } from '../../../conservacion/geo/trazo'
import { DESFASE_PK_MEDIANA_M, estimarEdificios, estimarUbicaciones } from '../../../conservacion/geo/estimar'
import { contradiccionFinCamino, resumenContornoEje, resumenContornoTramo } from '../../../conservacion/geo/calidad'
import type { ContradiccionFinCamino, ResumenContornoEje, ResumenContornoTramo } from '../../../conservacion/geo/calidad'
import { ubicacionDeclarada } from '../../../conservacion/derivacion/ubicacion'
import { claveCanal, confiabilidadEstructuras, estructurasDeCanal } from '../../../conservacion/derivacion/estructuras'
import type { ConfiabilidadEstructuras } from '../../../conservacion/derivacion/estructuras'
import { ventanaCentrada } from '../../../conservacion/geo/perfilSvg'

/** Rótulo de toda posición calculada por cadenamiento (nunca se presenta como medición). */
export const TEXTO_POSICION_ESTIMADA = `posición estimada (el PK declarado de las estructuras difiere ~${DESFASE_PK_MEDIANA_M} m de su coordenada)`
/** Rótulo del tramo dibujado como cuerda. */
export const TEXTO_SIN_CONTORNO = 'Cuerda entre vértices del inventario: sin contorno real'
export const TEXTO_AUXILIAR_SIN_CONTORNO = 'Auxiliar K-68+582 · sin contorno real (solicitar el trazo a la SRL)'

/** Texto fijo de toda vista de ubicación: la posición es la que declara el PacOT, no una medición. */
export const TEXTO_UBICACION_DECLARADA = 'La ubicación es la declarada por el PacOT; no acredita la posición física.'

/* ───────────────────────── tipos ───────────────────────── */

export type ClaveFamilia = FamiliaId | 'ninguna'
export const CLAVES_FAMILIA: readonly ClaveFamilia[] = [...FAMILIAS.map((f) => f.id), 'ninguna']
export const ROTULO_NINGUNA = 'Sin clasificar'
export const rotuloFamilia = (c: ClaveFamilia): string => (c === 'ninguna' ? ROTULO_NINGUNA : (FAMILIAS.find((f) => f.id === c)?.nombre ?? ROTULO_NINGUNA))

/** Una obra del inventario (estructura de IO4 o edificio de IO7) lista para dibujar o listar. */
export interface ObraVista {
  readonly id: string
  readonly fila: number
  readonly fuente: 'IO4' | 'IO7'
  readonly nombre: string
  readonly tipo: TipoEstructura
  readonly tipoNombre: string
  readonly familia: FamiliaId | null
  readonly clave: ClaveFamilia
  readonly subtipo: string | null
  readonly ambiguo: boolean
  readonly ramal: Ramal
  /** `k+mmm` del ramal, o null. */
  readonly pk: string | null
  readonly metros: number | null
  readonly km: number | null
  readonly estado: EstadoUbicacion
  readonly lon: number | null
  readonly lat: number | null
  readonly motivo: string | null
  readonly lonTexto: string | null
  readonly latTexto: string | null
  readonly margen: 'I' | 'D' | null
  readonly material: string | null
  readonly notaPK: string | null
  /** Cadenamiento tal como está escrito en el libro (IO4) o el texto de ubicación (IO7). */
  readonly pkTexto: string | null
  /** Por qué el cadenamiento no se pudo leer entero (null si se leyó). */
  readonly motivoPK: string | null
  readonly ref: string
}

export interface TramoVista {
  readonly fila: number
  readonly obra: string
  readonly pkInicial: string
  readonly pkFinal: string
  readonly mIni: number
  readonly mFin: number
  readonly kmIni: number
  readonly kmFin: number
  readonly longitudKm: number
  readonly estado: EstadoComp
  readonly ficha: FichaCanal | null
  /** Último tramo del ramal en IO1: incluye su PK final al contar las obras. */
  readonly cierraEje: boolean
}

export interface EjeVista {
  readonly clave: string
  readonly titulo: string
  readonly ramal: Ramal | null
  /** Hay inventario de estructuras para este eje (es un canal de IO1 y el registro es v4 o posterior). */
  readonly conEstructuras: boolean
  readonly tramos: readonly TramoVista[]
  /** Tramos del concepto cuyo cadenamiento no se pudo leer (no se dibujan). */
  readonly tramosSinPK: number
  readonly totalKm: number
  /** Obras con cadenamiento dentro del eje: se dibujan. */
  readonly obras: readonly ObraVista[]
  /** Obras con cadenamiento más allá del final declarado en IO1 (o antes de 0): no caen en ningún tramo. */
  readonly fueraDeTramos: readonly ObraVista[]
  /** Obras sin cadenamiento utilizable. */
  readonly sinPK: readonly ObraVista[]
  /** Cadenamiento (k+mmm) del principal donde nace este ramal; null si no aplica. */
  readonly nacePk: string | null
  /** Eje geométrico propio de este eje (libros de varios canales: uno por canal, sin trazo). null = se usa el del modelo por ramal. */
  readonly geoEje: EjeCanal | null
  /** Inventario de IO1 del canal (columna A) cuando el libro es multicanal; null si no. */
  readonly inventario: string | null
}

export interface ModeloCanal {
  /** false = registro anterior al extractor v4: sin estructuras ni coordenadas. */
  readonly v4: boolean
  readonly ejes: readonly EjeVista[]
  readonly geo: EjesCanal | null
  readonly anclaPk: string | null
  /** Obras del canal por familia, todas las de los ejes con inventario. */
  readonly conteoCanal: Readonly<Record<ClaveFamilia, number>>
  readonly nTramos: number
  /** Estructuras de IO4 en los ejes con inventario. */
  readonly nEstructuras: number
  readonly nEdificios: number
  readonly nEstimadas: number
  readonly nSinUbicar: number
  readonly avisos: readonly string[]
  /** El libro trae varios canales en IO4 (módulos): cada estructura va solo en el eje de su canal. */
  readonly multicanal: boolean
  /** Edificios de IO7 de un libro multicanal: son del sitio, no de un canal; se listan aparte y no se reparten por eje. */
  readonly edificiosAparte: readonly ObraVista[]
  /** Cordura de las cifras del libro (null = registro anterior a v4). */
  readonly confiabilidad: ConfiabilidadEstructuras | null
  /** Se pueden mostrar como cifra; si es false la interfaz dice «cifra no verificada» (S/D) en vez del conteo. */
  readonly cifrasConfiables: boolean
  readonly motivoCifras: string | null
  /** Trazo real con el que se construyó (null = cuerda entre vértices del inventario). */
  readonly trazo: Trazo | null
  /** Contradicción conocida entre IO1 e IO3 en el final del canal (null si no aplica). */
  readonly contradiccionFin: ContradiccionFinCamino | null
  /** Resumen de la calidad del contorno del eje principal (null sin geometría). */
  readonly contornoPrincipal: ResumenContornoEje | null
  /** Insumos para reconstruir el modelo cuando llega el trazo (`conTrazo`). */
  readonly origen: { readonly filas: readonly Comprobacion[]; readonly libro: LibroDerivado }
}

/* ───────────────────────── utilidades ───────────────────────── */

const normPk = (pk: string): string => pk.replace(/^\s*K\s*-?\s*/i, '').trim()
export const etiquetaPk = (pk: string | null): string => (pk === null || pk === 'S/D' ? 'S/D' : `K-${normPk(pk)}`)
export const etiquetaTramo = (t: { pkInicial: string; pkFinal: string }): string => `${etiquetaPk(t.pkInicial)} → ${etiquetaPk(t.pkFinal)}`
const kmDecimal = (m: number): number => m / 1000
/** Metros → `k+mmm`. */
export const pkDeMetros = (m: number): string => { const e = Math.round(m); return `${Math.floor(e / 1000)}+${String(e % 1000).padStart(3, '0')}` }
export const TEXTO_ESTADO: Readonly<Record<EstadoComp, string>> = { cuadra: 'cuadra', atipico: 'atípico', no_evaluable: 'no evaluable' }
/** Estado de la comprobación del CONCEPTO (criterio de la cuenta): palabra distinta de la del conteo de estructuras. */
export const TEXTO_ESTADO_CONCEPTO: Readonly<Record<EstadoComp, string>> = { cuadra: 'coherente', atipico: 'atípico, candidato a revisión', no_evaluable: 'no evaluable' }
export const TEXTO_UBICACION: Readonly<Record<EstadoUbicacion, string>> = { valida: 'ubicación declarada', estimada: 'ubicación estimada', sin_ubicar: 'sin ubicar' }

const MOTIVO_DEFECTO: Readonly<Record<DefectoCoord, string>> = {
  vacia: 'sin dato', ilegible: 'ilegible', duplicada: 'repite el valor de la otra coordenada', eje_incorrecto: 'hemisferio equivocado',
}
export const motivoDefecto = (d: DefectoCoord | null): string | null => (d === null ? null : MOTIVO_DEFECTO[d])

function titular(s: string): string {
  return s.toLowerCase().replace(/^\s*(\w)/, (_m, c: string) => c.toUpperCase()).replace(/\bk-/g, 'K-').replace(/\bconchos\b/g, 'Conchos')
    .replace(/\bm\.([di])\./g, (_m, x: string) => `M.${x.toUpperCase()}.`).replace(/\bpincipal\b/g, 'principal')
}

function obraDeEstructura(e: Estructura): ObraVista {
  return {
    id: `io4-${e.fila}`, fila: e.fila, fuente: 'IO4', nombre: e.tipoCrudo, tipo: e.tipo, tipoNombre: INFO_TIPO[e.tipo].nombre, familia: e.familia,
    clave: e.familia ?? 'ninguna', subtipo: e.subtipo, ambiguo: e.ambiguo, ramal: e.ramal, pk: e.pk, metros: e.pkMetros,
    km: e.pkMetros === null ? null : kmDecimal(e.pkMetros), estado: e.ubicacion.estado, lon: e.ubicacion.lon, lat: e.ubicacion.lat,
    motivo: e.ubicacion.motivo, lonTexto: e.lonTexto, latTexto: e.latTexto, margen: e.margen, material: e.material, notaPK: e.notaPK, pkTexto: e.cadenamientoTexto === '' ? null : e.cadenamientoTexto, motivoPK: e.motivoPK, ref: e.ref,
  }
}

function obraDeEdificio(b: Edificio): ObraVista {
  const metros = b.pk === null ? null : pkAMetros(b.pk)
  return {
    id: `io7-${b.fila}`, fila: b.fila, fuente: 'IO7', nombre: b.nombre, tipo: 'edificio', tipoNombre: INFO_TIPO.edificio.nombre, familia: 'edificacion',
    clave: 'edificacion', subtipo: b.uso, ambiguo: false, ramal: 'principal', pk: b.pk, metros, km: metros === null ? null : kmDecimal(metros),
    estado: b.ubicacion.estado, lon: b.ubicacion.lon, lat: b.ubicacion.lat, motivo: b.ubicacion.motivo, lonTexto: b.lonTexto, latTexto: b.latTexto,
    margen: null, material: null, notaPK: null, pkTexto: b.ubicacionTexto === '' ? null : b.ubicacionTexto, motivoPK: b.pk === null ? 'sin cadenamiento en el texto de ubicación' : null, ref: b.ref,
  }
}

const estadoDe = (c: Comprobacion): EstadoComp => c.estado

/** La ficha de IO1 que corresponde a un tramo de DIAG-01: misma obra y mismo cadenamiento inicial y final. */
function fichaDe(c: Comprobacion, canales: readonly FichaCanal[]): FichaCanal | null {
  const a = pkAMetros(normPk(c.pkInicial)), b = pkAMetros(normPk(c.pkFinal))
  if (a === null || b === null) return null
  return canales.find((f) => f.nombre === c.obra && pkAMetros(f.pkInicial) === a && pkAMetros(f.pkFinal) === b) ?? null
}

/* ───────────────────────── construcción ───────────────────────── */

const conteoVacio = (): Record<ClaveFamilia, number> => ({ toma_entrega: 0, control: 0, cruce: 0, proteccion: 0, medicion: 0, edificacion: 0, ninguna: 0 })
export function conteoPorClave(obras: readonly { clave: ClaveFamilia }[]): Record<ClaveFamilia, number> {
  const r = conteoVacio()
  for (const o of obras) r[o.clave]++
  return r
}

/** Estructura con su ubicación tal como está escrita en el libro (sin la estimación de la lectura): se vuelve a estimar con el eje correcto. */
const sinEstimar = (e: Estructura): Estructura => ({ ...e, ubicacion: ubicacionDeclarada(e) })
const edificioSinEstimar = (b: Edificio): Edificio => ({ ...b, ubicacion: ubicacionDeclarada(b) })

export function construirModeloCanal(filas: readonly Comprobacion[], libro: LibroDerivado, trazo?: Trazo | null): ModeloCanal {
  const f = libro.fichas
  const v4 = f.estructuras !== undefined
  const canales = f.canales
  const todasEst = f.estructuras ?? []
  const multicanal = v4 && todasEst.some((e) => e.canal !== undefined)
  const anclaPk = multicanal ? null : (f.anclaAuxiliar ?? null)
  const trazoUsado = !multicanal && trazo !== undefined && trazo !== null ? trazo : null
  const geo = v4 && !multicanal ? construirEjes(canales, pkAMetros(anclaPk), trazoUsado) : null
  const conf = v4 ? confiabilidadEstructuras(libro) : null
  const ubicable = conf?.ubicable ?? false

  // Libro de un solo eje: las estructuras se estiman sobre ese eje (con trazo, si lo hay). Con varios canales, canal por canal (más abajo).
  const estSimple = !v4 || multicanal ? [] : (trazoUsado === null ? todasEst : estimarUbicaciones(todasEst.map(sinEstimar), geo as EjesCanal))
  const edifSimple = !v4 || multicanal ? [] : (trazoUsado === null ? (f.edificios ?? []) : estimarEdificios((f.edificios ?? []).map(edificioSinEstimar), geo as EjesCanal))
  const estructuras = estSimple.map(obraDeEstructura)
  const edificios = edifSimple.map(obraDeEdificio)
  const edificiosAparte = multicanal ? (f.edificios ?? []).map(edificioSinEstimar).map(obraDeEdificio) : []

  const llave = (c: FichaCanal): string => (multicanal ? claveCanal(c.inventario) : (c.ramal ?? 'principal'))
  const ultimaFicha = new Map<string, FichaCanal>()
  for (const c of canales) { const k = llave(c); const previa = ultimaFicha.get(k); if (previa === undefined || (pkAMetros(c.pkFinal) ?? 0) >= (pkAMetros(previa.pkFinal) ?? 0)) ultimaFicha.set(k, c) }

  // Agrupar por obra, en orden de aparición; el principal primero.
  const porObra = new Map<string, Comprobacion[]>()
  for (const c of filas) { const l = porObra.get(c.obra) ?? []; l.push(c); porObra.set(c.obra, l) }

  const asignadas = new Set<number>()
  const ejes: EjeVista[] = []
  for (const [obra, cs] of porObra) {
    const fichaObra = canales.find((x) => x.nombre === obra) ?? null
    const ramal: Ramal | null = fichaObra === null ? null : (fichaObra.ramal ?? 'principal')
    const ult = fichaObra === null ? undefined : ultimaFicha.get(llave(fichaObra))
    const tramos: TramoVista[] = []
    let sinPK = 0
    for (const c of cs) {
      const a = pkAMetros(normPk(c.pkInicial)), b = pkAMetros(normPk(c.pkFinal))
      if (a === null || b === null || b <= a) { sinPK++; continue }
      const ficha = fichaDe(c, canales)
      tramos.push({
        fila: c.fila, obra, pkInicial: normPk(c.pkInicial), pkFinal: normPk(c.pkFinal), mIni: a, mFin: b, kmIni: kmDecimal(a), kmFin: kmDecimal(b),
        longitudKm: c.longitudKm ?? kmDecimal(b - a), estado: estadoDe(c), ficha, cierraEje: ficha !== null && ult !== undefined && ficha.fila === ult.fila,
      })
    }
    tramos.sort((x, y) => x.mIni - y.mIni)
    const conEstructuras = v4 && ramal !== null
    const finIO1 = ult === undefined ? null : pkAMetros(ult.pkFinal)
    const totalM = Math.max(finIO1 ?? 0, ...tramos.map((t) => t.mFin), 0)

    let delRamal: ObraVista[] = []
    let geoEje: EjeCanal | null = null
    let inventario: string | null = null
    if (conEstructuras && multicanal && fichaObra !== null) {
      // Cada canal con SUS estructuras (por el inventario de IO1/IO4) y su propio eje: nunca todas las estructuras en cada canal.
      inventario = claveCanal(fichaObra.inventario) || null
      const propias = ubicable ? estructurasDeCanal(todasEst, fichaObra.inventario).filter((e) => !asignadas.has(e.fila)) : []
      for (const e of propias) asignadas.add(e.fila)
      const ejesCanal = construirEjes(canales.filter((c) => claveCanal(c.inventario) === inventario), null)
      geoEje = ejesCanal.principal
      delRamal = estimarUbicaciones(propias.map(sinEstimar), ejesCanal).map(obraDeEstructura)
    } else if (conEstructuras && ubicable) {
      delRamal = [...estructuras.filter((o) => o.ramal === ramal), ...(ramal === 'principal' ? edificios : [])]
    }
    const dibujadas = delRamal.filter((o) => o.metros !== null && o.metros >= 0 && o.metros <= totalM)
    ejes.push({
      clave: obra, titulo: titular(obra), ramal, conEstructuras, tramos, tramosSinPK: sinPK, totalKm: kmDecimal(totalM),
      obras: dibujadas.sort((x, y) => (x.metros ?? 0) - (y.metros ?? 0) || x.fila - y.fila),
      fueraDeTramos: delRamal.filter((o) => o.metros !== null && (o.metros > totalM || o.metros < 0)),
      sinPK: delRamal.filter((o) => o.metros === null), nacePk: ramal === 'auxiliar' ? anclaPk : null, geoEje, inventario,
    })
  }
  ejes.sort((x, y) => (x.ramal === 'principal' ? 0 : 1) - (y.ramal === 'principal' ? 0 : 1))

  const conInv = ejes.filter((e) => e.conEstructuras)
  const todas = [...conInv.flatMap((e) => [...e.obras, ...e.fueraDeTramos, ...e.sinPK]), ...(ubicable ? edificiosAparte : [])]
  const nEst = todas.filter((o) => o.fuente === 'IO4').length, nEdif = todas.filter((o) => o.fuente === 'IO7').length
  // Una cifra mayor que la del libro es una cuenta de más (p. ej. las estructuras de un módulo repetidas en cada canal): no se muestra.
  const excesos: string[] = []
  if (conf !== null && conf.estructuras !== null && nEst > conf.estructuras) excesos.push(`Se contaron ${nEst} estructuras y el inventario trae ${conf.estructuras}.`)
  if (conf !== null && conf.edificios !== null && nEdif > conf.edificios) excesos.push(`Se contaron ${nEdif} edificios y el inventario trae ${conf.edificios}.`)
  const motivoCifras = !v4 ? null : (conf?.motivo ?? excesos[0] ?? (conf !== null && !conf.ubicable ? conf.motivoUbicacion : null))
  const cifrasConfiables = v4 && conf !== null && conf.confiable && conf.ubicable && excesos.length === 0

  const avisos: string[] = []
  if (!v4) avisos.push('Este registro es anterior a la versión 4 del lector: no trae estructuras ni coordenadas. Use «Actualizar desde la carpeta» para leerlo de nuevo.')
  else if (conInv.length === 0) avisos.push('Este concepto no corresponde a un canal del inventario IO1: no hay estructuras que situar.')
  return {
    v4, ejes, geo, anclaPk, conteoCanal: conteoPorClave(todas), nTramos: ejes.reduce((s, e) => s + e.tramos.length, 0),
    nEstructuras: nEst, nEdificios: nEdif,
    nEstimadas: todas.filter((o) => o.estado === 'estimada').length, nSinUbicar: todas.filter((o) => o.estado === 'sin_ubicar').length, avisos,
    multicanal, edificiosAparte: ubicable ? edificiosAparte : [], confiabilidad: conf, cifrasConfiables, motivoCifras, trazo: trazoUsado,
    contradiccionFin: v4 && !multicanal ? contradiccionFinCamino(f) : null,
    contornoPrincipal: geo === null ? null : resumenContornoEje(geo.principal),
    origen: { filas, libro },
  }
}

/** El mismo modelo con el trazo real del canal (o sin él). Si no cambia nada (libro multicanal, mismo trazo) devuelve el mismo objeto. */
export function conTrazo(m: ModeloCanal, trazo: Trazo | null): ModeloCanal {
  if (m.multicanal || m.trazo === trazo) return m
  return construirModeloCanal(m.origen.filas, m.origen.libro, trazo)
}

/* ───────────────────────── obras de un tramo y conteos ───────────────────────── */

/** Obras cuyo PK cae en [PK inicial, PK final) del tramo; el último tramo del ramal incluye su PK final. Misma regla que INT-15. */
export function obrasEnTramo(eje: EjeVista, t: TramoVista): ObraVista[] {
  return eje.obras.filter((o) => o.metros !== null && o.metros >= t.mIni && (t.cierraEje ? o.metros <= t.mFin : o.metros < t.mFin))
}

export function tramoDeObra(eje: EjeVista, o: ObraVista): TramoVista | null {
  return eje.tramos.find((t) => obrasEnTramo(eje, t).some((x) => x.id === o.id)) ?? null
}

export interface FilaConteo {
  readonly id: string
  readonly rotulo: string
  /** Suma de las columnas de IO1; null = celdas vacías (S/D). */
  readonly declarado: number | null
  readonly inventariado: number
  readonly diferencia: number | null
}
export interface ConteoTramo {
  readonly filas: readonly FilaConteo[]
  readonly totalDeclarado: number | null
  readonly totalInventariado: number
  readonly sinClasificar: number
  /** null = IO1 no declara conteos para el tramo (S/D). */
  readonly coherente: boolean | null
}

/** Declarado (IO1 W..AM del tramo) contra inventariado (IO4 en el tramo), por grupo de la tabla IO4→IO1. */
export function conteoTramo(t: TramoVista, enTramo: readonly ObraVista[]): ConteoTramo {
  const io4 = enTramo.filter((o) => o.fuente === 'IO4')
  const conteos = t.ficha?.conteos
  const filas: FilaConteo[] = TABLA_IO4_IO1.map((g) => {
    const vals = g.columnasIO1.map((c) => { const tipo = COLUMNA_IO1[c]; return tipo === undefined ? null : (conteos?.porTipo[tipo] ?? null) })
    const declarado = vals.every((x) => x === null) ? null : vals.reduce<number>((s, x) => s + (x ?? 0), 0)
    const inventariado = io4.filter((o) => g.tiposIO4.includes(o.tipo)).length
    return { id: g.id, rotulo: g.rotulo, declarado, inventariado, diferencia: declarado === null ? null : inventariado - declarado }
  })
  const hayConteos = conteos !== undefined && filas.some((x) => x.declarado !== null)
  const totalDeclarado = hayConteos ? filas.reduce((s, x) => s + (x.declarado ?? 0), 0) : null
  return {
    filas, totalDeclarado, totalInventariado: io4.length, sinClasificar: io4.filter((o) => o.tipo === 'otro').length,
    coherente: totalDeclarado === null ? null : totalDeclarado === io4.length,
  }
}

/* ───────────────────────── coordenadas del tramo ───────────────────────── */

export interface ExtremoTramo {
  readonly rotulo: 'Inicio' | 'Fin'
  readonly pk: string | null
  readonly lat: number | null
  readonly lon: number | null
  readonly latTexto: string | null
  readonly lonTexto: string | null
  /** Por qué falta una coordenada (nunca se rellena). */
  readonly defecto: string | null
}

export function extremosTramo(t: TramoVista): readonly ExtremoTramo[] {
  const f = t.ficha
  if (f === null || f.ini === undefined || f.fin === undefined) return []
  const mk = (rotulo: 'Inicio' | 'Fin', p: NonNullable<FichaCanal['ini']>): ExtremoTramo => {
    const d: string[] = []
    if (p.lat === null) d.push(`latitud ${motivoDefecto(p.defectoLat) ?? 'S/D'}`)
    if (p.lon === null) d.push(`longitud ${motivoDefecto(p.defectoLon) ?? 'S/D'}`)
    return { rotulo, pk: p.pk, lat: p.lat, lon: p.lon, latTexto: p.latTexto, lonTexto: p.lonTexto, defecto: d.length === 0 ? null : d.join('; ') }
  }
  return [mk('Inicio', f.ini), mk('Fin', f.fin)]
}

/** Contorno de un tramo: la polilínea [lat, lon] (contorno real si hay trazo; si no, la cuerda entre vértices) con su calidad. */
export interface ContornoTramo {
  readonly linea: Array<[number, number]>
  /** 'ancla'/'interpolada' = sigue el contorno real; 'cuerda' = recta entre vértices del inventario, sin contorno real. */
  readonly calidad: 'ancla' | 'interpolada' | 'cuerda'
  /** null si no hay eje o no se pudo situar el tramo. */
  readonly resumen: ResumenContornoTramo | null
}

const aLatLon = (pts: ReadonlyArray<readonly [number, number]>): Array<[number, number]> => pts.map((p) => [p[1], p[0]] as [number, number])

export function contornoDeTramo(eje: EjeCanal | null, mIni: number, mFin: number): ContornoTramo {
  if (eje === null) return { linea: [], calidad: 'cuerda', resumen: null }
  const sub = subtrazoPorPK(eje, mIni, mFin)
  if (sub.puntos.length < 2) return { linea: [], calidad: 'cuerda', resumen: null }
  return { linea: aLatLon(sub.puntos), calidad: sub.calidad, resumen: resumenContornoTramo(eje, mIni, mFin) }
}

/** Vértices [lat, lon] de un tramo entre dos cadenamientos: el contorno real (subtrazo) o, sin trazo, la cuerda entre vértices. Vacío si no hay eje. */
export function polilineaDeTramo(eje: EjeCanal | null, mIni: number, mFin: number): Array<[number, number]> {
  return contornoDeTramo(eje, mIni, mFin).linea
}

/** Cuerda [lat, lon] del tramo (recta entre vértices declarados): lo que se dibujaba antes del trazo y lo que se muestra sin contorno real. */
export function cuerdaDeTramo(eje: EjeCanal | null, mIni: number, mFin: number): Array<[number, number]> {
  return eje === null ? [] : aLatLon(cuerdaPorPK(eje, mIni, mFin))
}

export const polilineaEje = (eje: EjeCanal | null): Array<[number, number]> => (eje === null ? [] : eje.vertices.map((v) => [v.lat, v.lon] as [number, number]))

export function ejeGeoDe(m: ModeloCanal, ramal: Ramal | null): EjeCanal | null {
  if (m.geo === null || ramal === null) return null
  return ramal === 'auxiliar' ? m.geo.auxiliar : m.geo.principal
}

/** Eje geométrico de un eje del modelo: el propio (libros de varios canales) o el del ramal. */
export function ejeGeoDeVista(m: ModeloCanal, eje: Pick<EjeVista, 'ramal' | 'geoEje'>): EjeCanal | null {
  return eje.geoEje ?? ejeGeoDe(m, eje.ramal)
}

/** ¿El contorno de este eje es real? (trazo con anclas). Falso en el auxiliar y en los canales de un libro de varios canales. */
export const ejeConTrazo = (e: EjeCanal | null): boolean => e !== null && usaTrazo(e)

/** Salto de cadenamiento: cuántos metros más (o menos) de trazo que de PK declarado hay en ese par de anclas. */
export const desfaseSaltoM = (s: SaltoCadenamiento): number => Math.round(s.deltaArcoM - s.deltaPkM)

/* ───────────────────────── agrupación en el perfil ───────────────────────── */

export interface ItemCarril { readonly id: string; readonly x: number; readonly carril: number; readonly clave: ClaveFamilia }
export interface GrupoCarril { readonly carril: number; readonly clave: ClaveFamilia; readonly x: number; readonly ids: readonly string[] }

/**
 * Junta las obras de un mismo carril cuando a la escala actual quedarían a menos de `separacionPx` unas de otras: el grupo se
 * ancla en su primer miembro (no crece en cadena) y se dibuja en la media de sus X. Obras sueltas = grupo de un solo id.
 */
export function agruparEnCarril(items: readonly ItemCarril[], separacionPx: number): GrupoCarril[] {
  const ord = [...items].sort((a, b) => a.carril - b.carril || a.x - b.x || (a.id < b.id ? -1 : 1))
  const out: GrupoCarril[] = []
  let ids: string[] = [], xs: number[] = [], carril = Number.NaN, clave: ClaveFamilia = 'ninguna', ancla = 0
  const cierra = (): void => { if (ids.length > 0) out.push({ carril, clave, x: xs.reduce((s, v) => s + v, 0) / xs.length, ids }) }
  for (const it of ord) {
    if (it.carril !== carril || it.x - ancla >= separacionPx) { cierra(); ids = []; xs = []; carril = it.carril; clave = it.clave; ancla = it.x }
    ids.push(it.id); xs.push(it.x)
  }
  cierra()
  return out
}

/* ───────────────────────── ventana y selección ───────────────────────── */

export const VENTANA_MINIMA_KM = 2
export const VENTANA_INICIAL_KM = 24

/** Ventana [a, b] (km) que contiene al tramo `t` centrada en él, de ancho `largo`, sujeta a [0, total]. */
export function ventanaSobreTramo(t: Pick<TramoVista, 'kmIni' | 'kmFin'>, total: number, largo = VENTANA_INICIAL_KM): [number, number] {
  return ventanaCentrada((t.kmIni + t.kmFin) / 2, Math.max(largo, t.kmFin - t.kmIni), total)
}

/** Acerca (factor < 1) o aleja (> 1) la ventana alrededor de `centro` (por defecto, su centro). Nunca menor que el mínimo ni mayor que el canal. */
export function zoomVentana(v: readonly [number, number], factor: number, total: number, centro?: number): [number, number] {
  const largo = Math.min(Math.max((v[1] - v[0]) * factor, Math.min(VENTANA_MINIMA_KM, total)), total)
  const c = centro ?? (v[0] + v[1]) / 2
  const rel = v[1] === v[0] ? 0.5 : (c - v[0]) / (v[1] - v[0])
  const a = Math.min(Math.max(c - rel * largo, 0), total - largo)
  return [a, a + largo]
}

export function desplazarVentana(v: readonly [number, number], deltaKm: number, total: number): [number, number] {
  const largo = v[1] - v[0]
  const a = Math.min(Math.max(v[0] + deltaKm, 0), Math.max(total - largo, 0))
  return [a, a + largo]
}

/** Si el tramo ya se ve entero la ventana no se mueve; si no, se centra en él. */
export function ventanaQueMuestra(v: readonly [number, number], t: Pick<TramoVista, 'kmIni' | 'kmFin'>, total: number): [number, number] {
  if (t.kmIni >= v[0] - 1e-9 && t.kmFin <= v[1] + 1e-9) return [v[0], v[1]]
  return ventanaCentrada((t.kmIni + t.kmFin) / 2, Math.max(v[1] - v[0], t.kmFin - t.kmIni), total)
}

/** Tramo contiguo (d = -1 anterior, +1 siguiente) en el orden de cadenamiento; se queda en el extremo. */
export function tramoAdyacente(tramos: readonly TramoVista[], fila: number | null, d: number): TramoVista | null {
  if (tramos.length === 0) return null
  const i = tramos.findIndex((t) => t.fila === fila)
  if (i < 0) return tramos[0] ?? null
  return tramos[Math.min(Math.max(i + d, 0), tramos.length - 1)] ?? null
}

/* ───────────────────────── calidad del contorno (insignia y avisos) ───────────────────────── */

export interface InsigniaContorno {
  /** 'real' = sigue el trazo; 'cuerda' = sin contorno real. */
  readonly tipo: 'real' | 'cuerda'
  readonly texto: string
  /** Detalle para el atributo title y el lector de pantalla. */
  readonly detalle: string
}

/** Insignia de calidad de un tramo: «Contorno real · N anclas · respaldo X %» o el rótulo de cuerda sin contorno real. */
export function insigniaContorno(c: ContornoTramo, ramal: Ramal | null): InsigniaContorno {
  if (c.calidad === 'cuerda' || c.resumen === null) {
    return ramal === 'auxiliar'
      ? { tipo: 'cuerda', texto: TEXTO_AUXILIAR_SIN_CONTORNO, detalle: 'El ramal auxiliar no está en el trazo del canal: se dibuja la cuerda entre sus vértices.' }
      : { tipo: 'cuerda', texto: TEXTO_SIN_CONTORNO, detalle: 'No hay trazo cargado o el tramo queda fuera de las anclas: se dibuja la recta entre vértices del inventario.' }
  }
  const r = c.resumen
  const respaldo = r.respaldoAncla === null ? 'S/D' : `${Math.round(r.respaldoAncla * 100)} %`
  const n = r.nAnclasEnTramo
  return {
    tipo: 'real',
    texto: `Contorno real · ${n} ${n === 1 ? 'ancla' : 'anclas'} · respaldo ${respaldo}`,
    detalle: `Sigue el trazo del canal. Respaldo = parte del tramo a ≤ 1 km de un vértice declarado del inventario; ancla más lejana a ${r.maxDistanciaAnclaPkM === null ? 'S/D' : `${Math.round(r.maxDistanciaAnclaPkM)} m`} de cadenamiento.`,
  }
}

/** Avisos de un tramo: saltos de cadenamiento del PK declarado frente al trazo y la contradicción IO1/IO3 en el tramo final. */
export function avisosContornoTramo(c: ContornoTramo, t: Pick<TramoVista, 'cierraEje'>, eje: Pick<EjeVista, 'ramal'>, m: Pick<ModeloCanal, 'contradiccionFin'>): string[] {
  const out: string[] = []
  for (const s of c.resumen?.saltosEnTramo ?? []) {
    out.push(`El PK declarado tiene un salto de ~${Math.abs(desfaseSaltoM(s))} m respecto al trazo entre ${etiquetaPk(pkDeMetros(s.pkIni))} y ${etiquetaPk(pkDeMetros(s.pkFin))}.`)
  }
  const d = m.contradiccionFin
  if (d !== null && t.cierraEje && eje.ramal === 'principal') {
    out.push(`IO1 pone el final del canal en ${etiquetaPk(d.pkCanal)} e IO3 el final del camino en ${etiquetaPk(d.pkCamino)}: difieren ~${Math.abs(d.diferenciaM)} m en el mismo punto.`)
  }
  return out
}
