import type { VistaLibro } from '../nucleo/libro/vista'
import { limpiarPK } from '../nucleo/num/pk'
import { clasificar, COLUMNA_IO1, COLUMNAS_IO1, TIPOS_IO1 } from '../estructuras/catalogo'
import type { TipoIO1 } from '../estructuras/catalogo'
import type { CategoriaEstructura, ConteosTramo, Edificio, Estructura, LibroDerivado, Ramal } from './tipos'
import { describirDefecto, repararLonLat, ubicacionDeclarada } from './ubicacion'

/**
 * Lectura de las hojas de inventario con ubicación: IO4 (una fila por estructura), IO1 (conteos por tipo por tramo, columnas
 * W..AN) e IO7 (edificios). Solo lectura; lo que falta es null (S/D), nunca 0.
 */

const FILA_DESDE = 14
const FILAS_MAX = 5000

/** Caída del cadenamiento que indica que empieza otro eje (el ramal auxiliar reinicia en 0+xxx). Los desórdenes menores (decenas de m) no cuentan. */
export const UMBRAL_REINICIO_M = 10_000

const nFilas = (libro: VistaLibro, hoja: string): number => Math.min(libro.hoja(hoja)?.nfilas ?? 0, FILAS_MAX)

/** Texto de una celda aunque el libro la tenga como número. */
function textoCelda(libro: VistaLibro, hoja: string, celda: string): string | null {
  const t = libro.texto(hoja, celda)
  if (t !== null) return t.trim() === '' ? null : t
  const n = libro.numero(hoja, celda)
  return n.ok ? n.valor.toString() : null
}

const numeroCelda = (libro: VistaLibro, hoja: string, celda: string): number | null => {
  const n = libro.numero(hoja, celda)
  return n.ok ? n.valor.toNumber() : null
}

function categoriaDe(t: string | null): CategoriaEstructura | null {
  const s = (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
  if (s.startsWith('operacion')) return 'operacion'
  if (s.startsWith('proteccion')) return 'proteccion'
  if (s.startsWith('cruce')) return 'cruce'
  return null
}

const limpioEspacios = (t: string | null): string | null => {
  if (t === null) return null
  const s = t.replace(/\s+/g, ' ').trim()
  return s === '' ? null : s
}

export interface LecturaIO4 {
  readonly estructuras: Estructura[]
  readonly avisos: string[]
  /** El libro trae VARIOS canales en IO4 (cada uno con su cadenamiento desde 0): cada estructura lleva `canal`. */
  readonly multicanal: boolean
}

/**
 * Clave normalizada de un canal a partir del número de inventario (columna A de IO1/IO4): sin comillas ni espacios, sin el «.0» de un
 * número leído como decimal («171.0» → «171»), en mayúsculas («172-a» → «172-A»). '' si no hay inventario.
 */
export function claveCanal(inventario: string | number | null | undefined): string {
  if (inventario === null || inventario === undefined) return ''
  return String(inventario).replace(/['"`´‘’“”]/g, '').replace(/\s+/g, '').replace(/^(\d+)\.0+$/, '$1').toUpperCase()
}

/** Claves de canal que declara IO1 (columna A de las filas con nombre de canal). */
function inventariosIO1(libro: VistaLibro): Set<string> {
  const out = new Set<string>()
  const n = nFilas(libro, 'IO1')
  for (let r = 16; r <= n; r++) {
    if (limpioEspacios(textoCelda(libro, 'IO1', `B${r}`)) === null) continue
    const k = claveCanal(textoCelda(libro, 'IO1', `A${r}`))
    if (k !== '') out.add(k)
  }
  return out
}

/** Cadenamiento escrito como número: metros desde el origen del canal (639 → «0+639»). Solo enteros no negativos razonables. */
function pkDeMetros(txt: string): { pk: string; metros: number } | null {
  if (!/^\d+(\.\d+)?$/.test(txt)) return null
  const m = Math.round(Number(txt))
  if (!Number.isFinite(m) || m > 1_000_000) return null
  return { pk: `${Math.floor(m / 1000)}+${String(m % 1000).padStart(3, '0')}`, metros: m }
}

/**
 * IO4: inventario A, nombre C, cadenamiento D, longitud E, latitud F, correspondencia G, categoría H, material I.
 *
 * Dos formas de libro:
 *  - UN eje (SRL): A es un consecutivo de obra, el cadenamiento es «K-km+mmm» y un reinicio fuerte marca el ramal auxiliar.
 *  - VARIOS canales (módulos): A es el inventario del canal en IO1 (varias filas por canal, blanco = el mismo canal de arriba) y D es un
 *    número en metros desde el origen de ESE canal; el cadenamiento reinicia en cada canal, lo cual NO es un ramal auxiliar. Se
 *    reconoce porque al menos dos inventarios distintos de IO4 existen en IO1.
 */
export function leerEstructurasIO4(libro: VistaLibro): LecturaIO4 {
  const estructuras: Estructura[] = []
  const avisos: string[] = []
  const n = nFilas(libro, 'IO4')
  // Pasada previa: ¿IO4 cuelga de varios canales de IO1?
  const enIO1 = inventariosIO1(libro)
  const clavesIO4 = new Set<string>()
  {
    let previa = ''
    for (let r = FILA_DESDE; r <= n; r++) {
      if (limpioEspacios(textoCelda(libro, 'IO4', `C${r}`)) === null) continue
      const k = claveCanal(textoCelda(libro, 'IO4', `A${r}`)) || previa
      if (k !== '') { previa = k; if (enIO1.has(k)) clavesIO4.add(k) }
    }
  }
  const multicanal = clavesIO4.size >= 2
  let ramal: Ramal = 'principal'
  let metrosPrevio: number | null = null
  let filaPrevia = 0
  let canalPrevio = ''
  const sinFicha = new Set<string>()
  for (let r = FILA_DESDE; r <= n; r++) {
    const nombre = limpioEspacios(textoCelda(libro, 'IO4', `C${r}`))
    if (nombre === null) continue
    const cadTxt = limpioEspacios(textoCelda(libro, 'IO4', `D${r}`)) ?? ''
    let pk = limpiarPK(cadTxt)
    let pkEnMetros = false
    let canal: string | undefined
    let canalHeredado = false
    if (multicanal) {
      const propia = claveCanal(textoCelda(libro, 'IO4', `A${r}`))
      canalHeredado = propia === ''
      canal = propia === '' ? canalPrevio : propia
      canalPrevio = canal
      if (canal !== '' && !enIO1.has(canal) && !sinFicha.has(canal)) {
        sinFicha.add(canal)
        avisos.push(`IO4 fila ${r}: el canal «${canal}» no existe en IO1; sus estructuras no se pueden comparar con ningún tramo.`)
      }
      if (pk.pk === null) {
        const m = pkDeMetros(cadTxt)
        if (m !== null) {
          pkEnMetros = true
          pk = { pk: m.pk, metros: m.metros, kmParcial: null, estado: 'completo', margen: null, nota: null, motivo: null }
        }
      }
    } else if (pk.metros !== null) {
      if (ramal === 'principal' && metrosPrevio !== null && metrosPrevio - pk.metros > UMBRAL_REINICIO_M) {
        ramal = 'auxiliar'
        avisos.push(`IO4!D${r}: el cadenamiento reinicia (de K-${Math.trunc(metrosPrevio / 1000)}+${String(metrosPrevio % 1000).padStart(3, '0')} en la fila ${filaPrevia} a ${pk.pk}): desde aquí las estructuras son del ramal auxiliar.`)
      }
      metrosPrevio = pk.metros
      filaPrevia = r
    }
    const c = repararLonLat(textoCelda(libro, 'IO4', `E${r}`), textoCelda(libro, 'IO4', `F${r}`))
    const cl = clasificar(nombre)
    const def = describirDefecto(c)
    if (def !== null) avisos.push(`IO4 fila ${r} (${nombre}): ${def}.`)
    if (pk.pk === null) avisos.push(`IO4!D${r} (${nombre}): cadenamiento «${cadTxt}» sin PK utilizable: ${pk.motivo ?? 'ilegible'}.`)
    estructuras.push({
      fila: r, inventario: textoCelda(libro, 'IO4', `A${r}`)?.trim() ?? '', tipoCrudo: nombre, cadenamientoTexto: cadTxt,
      pk: pk.pk, pkMetros: pk.metros, pkParcialKm: pk.kmParcial, motivoPK: pk.motivo, margen: pk.margen, notaPK: pk.nota, ramal,
      categoria: categoriaDe(textoCelda(libro, 'IO4', `H${r}`)),
      correspondencia: limpioEspacios(textoCelda(libro, 'IO4', `G${r}`)), material: limpioEspacios(textoCelda(libro, 'IO4', `I${r}`)),
      tipo: cl.tipo, familia: cl.familia, subtipo: cl.subtipo, ambiguo: cl.ambiguo,
      ...c, ubicacion: ubicacionDeclarada(c), ref: `IO4!C${r}`,
      ...(canal === undefined ? {} : { canal }), ...(canalHeredado ? { canalHeredado } : {}), ...(pkEnMetros ? { pkEnMetros } : {}),
    })
  }
  if (multicanal) avisos.unshift(`IO4 trae ${clavesIO4.size} canales de IO1 con su propio cadenamiento (en metros desde el origen de cada canal): no hay ramal auxiliar y cada estructura se asigna a su canal.`)
  return { estructuras, avisos, multicanal }
}

/** Las estructuras de un canal (libros de varios canales). Con un inventario que no existe devuelve []. */
export const estructurasDeCanal = (est: readonly Estructura[], inventario: string | number | null | undefined): Estructura[] => {
  const k = claveCanal(inventario)
  return k === '' ? [] : est.filter((e) => e.canal === k)
}

/** Conteos W..AN de una fila de IO1. Una celda vacía queda null (S/D). */
export function leerConteosIO1(libro: VistaLibro, fila: number): ConteosTramo {
  const porTipo = {} as Record<TipoIO1, number | null>
  for (const t of TIPOS_IO1) porTipo[t] = null
  for (const col of COLUMNAS_IO1) {
    const t = COLUMNA_IO1[col]
    if (t !== undefined) porTipo[t] = numeroCelda(libro, 'IO1', `${col}${fila}`)
  }
  return { porTipo, total: numeroCelda(libro, 'IO1', `AN${fila}`) }
}

/** Totales declarados de IO1 (fila 15 = suma de los tramos). */
export const leerTotalesIO1 = (libro: VistaLibro): ConteosTramo => leerConteosIO1(libro, 15)

/** Suma de los conteos de un tramo (las celdas null no suman). */
export function sumaConteos(c: ConteosTramo): number {
  let s = 0
  for (const t of TIPOS_IO1) s += c.porTipo[t] ?? 0
  return s
}

/**
 * IO7: inventario A, nombre B, ubicación C (texto libre, con el cadenamiento a veces), longitud D, latitud E, características F,
 * uso H, área del predio J. Cada obra ocupa una fila con inventario; la siguiente (sin inventario) continúa la ubicación.
 */
export function leerEdificiosIO7(libro: VistaLibro): { edificios: Edificio[]; avisos: string[] } {
  const edificios: Edificio[] = []
  const avisos: string[] = []
  const n = nFilas(libro, 'IO7')
  for (let r = FILA_DESDE; r <= n; r++) {
    const inv = limpioEspacios(textoCelda(libro, 'IO7', `A${r}`))
    const nombre = limpioEspacios(textoCelda(libro, 'IO7', `B${r}`))
    if (inv === null || nombre === null) continue
    const c = repararLonLat(textoCelda(libro, 'IO7', `D${r}`), textoCelda(libro, 'IO7', `E${r}`))
    const def = describirDefecto(c)
    if (def !== null) avisos.push(`IO7 fila ${r} (${nombre}): ${def}.`)
    const ubic = limpioEspacios(textoCelda(libro, 'IO7', `C${r}`)) ?? ''
    edificios.push({
      fila: r, inventario: inv, nombre, ubicacionTexto: ubic, pk: limpiarPK(ubic).pk,
      caracteristicas: limpioEspacios(textoCelda(libro, 'IO7', `F${r}`)), uso: limpioEspacios(textoCelda(libro, 'IO7', `H${r}`)),
      areaM2: numeroCelda(libro, 'IO7', `J${r}`), ...c, ubicacion: ubicacionDeclarada(c), ref: `IO7!B${r}`,
    })
  }
  return { edificios, avisos }
}

/* ───────── Cordura de las cifras de estructuras y edificios (S/D en la interfaz si falla) ───────── */

/** Más estructuras por km que esto (una cada 25 m de canal) no es verosímil en ningún libro visto (SRL 3.7, M5 12.5). */
export const MAX_ESTRUCTURAS_POR_KM = 40
/** Si más de esta fracción de las estructuras no tiene cadenamiento utilizable, el perfil no puede situarlas. */
export const MAX_FRACCION_SIN_PK = 0.5

export interface ConfiabilidadEstructuras {
  /** Las cifras de estructuras y edificios (conteos) superan las comprobaciones de cordura; si no, la interfaz muestra S/D. */
  readonly confiable: boolean
  /** Primer motivo por el que no son confiables; null si lo son. */
  readonly motivo: string | null
  readonly motivos: readonly string[]
  /** Las estructuras se pueden situar en el perfil (cadenamiento utilizable en la mayoría). Independiente de `confiable`. */
  readonly ubicable: boolean
  readonly motivoUbicacion: string | null
  readonly estructuras: number | null
  readonly edificios: number | null
  readonly sinPK: number
  readonly porKm: number | null
}

/**
 * Comprobaciones de cordura por libro. `mostrado` es lo que la interfaz está a punto de enseñar: si supera lo que el libro tiene (o es un
 * múltiplo exacto), se contó de más (p. ej. las estructuras de un módulo repetidas en cada canal) y no se debe mostrar.
 * Nunca corrige una cifra: solo dice si se puede mostrar.
 */
export function confiabilidadEstructuras(libro: LibroDerivado, mostrado?: { estructuras?: number; edificios?: number }): ConfiabilidadEstructuras {
  const f = libro.fichas
  const motivos: string[] = []
  const est = f.estructuras
  if (est === undefined) {
    return { confiable: false, motivo: 'El registro es anterior a la lectura v4: no trae estructuras.', motivos: ['El registro es anterior a la lectura v4: no trae estructuras.'], ubicable: false, motivoUbicacion: 'sin estructuras', estructuras: null, edificios: f.edificios?.length ?? null, sinPK: 0, porKm: null }
  }
  const nEst = est.length
  const nEdif = f.edificios?.length ?? 0
  const sinPK = est.filter((e) => e.pkMetros === null).length
  const declarado = f.totalesIO1?.total ?? null
  const conConteos = f.canales.filter((c) => c.conteos !== undefined)
  const calculado = conConteos.reduce((s, c) => s + sumaConteos(c.conteos as ConteosTramo), 0)
  if (declarado !== null && declarado !== nEst) motivos.push(`IO4 lista ${nEst} estructuras y IO1 declara ${declarado}.`)
  if (declarado !== null && conConteos.length > 0 && declarado !== calculado) motivos.push(`El total de IO1 (${declarado}) no es la suma de sus tramos (${calculado}).`)
  const km = f.canales.reduce((s, c) => s + (c.km.valor === null ? 0 : Number(c.km.valor)), 0)
  const porKm = km > 0 ? nEst / km : null
  if (porKm !== null && porKm > MAX_ESTRUCTURAS_POR_KM) motivos.push(`${porKm.toFixed(1)} estructuras por km supera lo verosímil (${MAX_ESTRUCTURAS_POR_KM}).`)
  if (mostrado?.estructuras !== undefined && mostrado.estructuras !== nEst && nEst > 0) {
    const mult = mostrado.estructuras / nEst
    motivos.push(`La cifra mostrada (${mostrado.estructuras}) no es la del inventario (${nEst})${Number.isInteger(mult) && mult > 1 ? `: es ×${mult} exacto, se contó de más` : ''}.`)
  }
  if (mostrado?.edificios !== undefined && mostrado.edificios !== nEdif && nEdif > 0) {
    const mult = mostrado.edificios / nEdif
    motivos.push(`La cifra de edificios mostrada (${mostrado.edificios}) no es la del inventario (${nEdif})${Number.isInteger(mult) && mult > 1 ? `: es ×${mult} exacto, se contó de más` : ''}.`)
  }
  const fraccion = nEst > 0 ? sinPK / nEst : 0
  const ubicable = nEst > 0 && fraccion <= MAX_FRACCION_SIN_PK
  const motivoUbicacion = ubicable ? null : nEst === 0 ? 'IO4 no trae estructuras.' : `${sinPK} de ${nEst} estructuras sin cadenamiento utilizable.`
  return { confiable: motivos.length === 0, motivo: motivos[0] ?? null, motivos, ubicable, motivoUbicacion, estructuras: nEst, edificios: nEdif, sinPK, porKm }
}
