import { colAIndice, indiceACol } from '../nucleo/num/a1'
import type { VistaLibro } from '../nucleo/libro/vista'
import type {
  Cifra, ConceptoTramo, FichaCamino, FilaTotalesDiagnostico, FichaCanal, FichasInventario, LibroDerivado, NecesidadMedia, PuntoCanal, Ramal, RenglonPrograma, SumaBloque, TipoRed, TramoDiagnostico,
} from './tipos'
import { limpiarPK } from '../nucleo/num/pk'
import { construirEjes, pkAMetros } from '../geo/kmALatLng'
import { estimarEdificios, estimarUbicaciones } from '../geo/estimar'
import { leerConteosIO1, leerEdificiosIO7, leerEstructurasIO4, leerTotalesIO1, UMBRAL_REINICIO_M } from './estructuras'
import { describirDefecto, repararLonLat } from './ubicacion'

/**
 * Lee DIAG-01, 3DN y SEG-3 localizando los datos por rótulos, no por filas fijas: el libro de un módulo
 * y el de la SRL tienen el mismo formato pero distinto tamaño y distinto orden de columnas de concepto.
 */

/** Sube cuando el extractor produce algo nuevo: los libros ya registrados se vuelven a leer (ver derivacion-carpeta.ts). */
export const EXTRACTOR_VERSION = 6

const H_DIAG = 'DIAG-01'
const H_3DN = '3DN'
const H_SEG = 'SEG-3'

/** El lector BIFF imprime los literales como flotantes ("2000.0"); se muestran como en la hoja ("2000"). */
export const limpiarFormula = (t: string): string => t.replace(/(?<![A-Za-z$!\d.])(\d+)\.0(?![\d.])/g, '$1')

export function cifra(libro: VistaLibro, hoja: string, celda: string): Cifra {
  const ref = `${hoja}!${celda}`
  const f = libro.formula(hoja, celda)
  const formula = f && f.kind !== 'desconocida' ? limpiarFormula(f.texto) : null
  const n = libro.numero(hoja, celda)
  if (!n.ok) {
    const texto = n.motivo === 'texto' ? libro.texto(hoja, celda) : null
    return { valor: null, ref, formula, origen: 'vacio', ...(texto !== null && texto.trim() !== '' ? { texto: texto.trim() } : {}) }
  }
  return { valor: n.valor.toFixed(), ref, formula, origen: formula ? 'formula' : 'capturado' }
}

const num = (libro: VistaLibro, h: string, c: string): number | null => {
  const r = libro.numero(h, c)
  return r.ok ? r.valor.toNumber() : null
}

/** Texto de una celda aunque el libro la tenga como número (p. ej. PK `0`). */
function textoOnumero(libro: VistaLibro, h: string, c: string): string {
  const t = libro.texto(h, c)
  if (t !== null) return t.trim()
  const n = num(libro, h, c)
  return n === null ? '' : String(n)
}

function tipoRed(rotulo: string): TipoRed | null {
  const t = rotulo.toUpperCase()
  if (/^RED DE DISTRIBU/.test(t)) return 'distribucion'
  if (/^RED DE DRENAJE/.test(t)) return 'drenaje'
  if (/^RED DE CAMINOS/.test(t)) return 'caminos'
  return null
}

const FILAS_MAX = 5000

function filasDe(libro: VistaLibro, hoja: string): number {
  return Math.min(libro.hoja(hoja)?.nfilas ?? 0, FILAS_MAX)
}

interface ColumnaConcepto { readonly concepto: string; readonly param: string; readonly trabajo: string }

/** Localiza la fila de rótulos ("No. DE INVENTARIO") y los pares paramétrica/de trabajo por concepto. */
function columnasConcepto(libro: VistaLibro): { filaRotulos: number; columnas: ColumnaConcepto[] } | null {
  const n = filasDe(libro, H_DIAG)
  for (let r = 1; r <= Math.min(n, 40); r++) {
    const a = libro.texto(H_DIAG, `A${r}`)
    if (a === null || !/INVENTARIO/i.test(a)) continue
    const columnas: ColumnaConcepto[] = []
    // Los conceptos empiezan después de "LONGITUD EFECTIVA" (columna E): cada rótulo ocupa un par de columnas.
    for (let c = colAIndice('F'); c <= colAIndice('Z'); c++) {
      const col = indiceACol(c)
      const t = libro.texto(H_DIAG, `${col}${r}`)
      if (t !== null && t.trim() !== '') columnas.push({ concepto: t.replace(/\s+/g, ' ').trim(), param: col, trabajo: indiceACol(c + 1) })
    }
    return { filaRotulos: r, columnas }
  }
  return null
}

/** Normaliza "K-0+000", "0+000", "3+520" y el número 0 a "N+NNN". */
export function normalizarPK(t: string): string | null {
  const m = /(\d+)\s*\+\s*(\d{1,3})/.exec(t)
  if (m && m[1] !== undefined && m[2] !== undefined) return `${Number(m[1])}+${m[2].padStart(3, '0')}`
  if (/^\d+(\.0+)?$/.test(t.trim())) return `${Number(t)}+000`
  return null
}

/** Dos PK de un texto como "K-0+000 AL K-3+520". */
export function parPK(t: string): [string, string] | null {
  const ms = [...t.matchAll(/(\d+)\s*\+\s*(\d{1,3})/g)]
  const a = ms[0]
  const b = ms[1]
  if (!a || !b || a[1] === undefined || a[2] === undefined || b[1] === undefined || b[2] === undefined) return null
  return [`${Number(a[1])}+${a[2].padStart(3, '0')}`, `${Number(b[1])}+${b[2].padStart(3, '0')}`]
}

function leerDiagnostico(libro: VistaLibro, avisos: string[], km: LibroDerivado['inventarioKm']): {
  tramos: TramoDiagnostico[]; totales: ConceptoTramo[]; filasTotales: FilaTotalesDiagnostico[]; conceptos: string[]
} {
  const cab = columnasConcepto(libro)
  if (!cab) {
    avisos.push('DIAG-01: no se encontró la fila de rótulos "No. DE INVENTARIO"; no se extrajeron tramos.')
    return { tramos: [], totales: [], filasTotales: [], conceptos: [] }
  }
  const { filaRotulos, columnas } = cab
  const tramos: TramoDiagnostico[] = []
  let totales: ConceptoTramo[] = []
  const filasTotales: FilaTotalesDiagnostico[] = []
  let red: TipoRed = 'otro'
  const redesVistas = new Set<TipoRed>()
  const n = filasDe(libro, H_DIAG)
  const conceptoDe = (fila: number): ConceptoTramo[] => columnas.map((k) => ({
    concepto: k.concepto,
    parametrica: cifra(libro, H_DIAG, `${k.param}${fila}`),
    trabajo: cifra(libro, H_DIAG, `${k.trabajo}${fila}`),
  }))
  for (let r = filaRotulos + 1; r <= n; r++) {
    const aTxt = libro.texto(H_DIAG, `A${r}`)
    const t = aTxt !== null ? tipoRed(aTxt) : null
    if (t) { red = t; redesVistas.add(t); continue }
    // El bloque de tubería no lleva rótulo "RED DE …" en la columna A: lo anuncia el encabezado "SECCIÓN CIRCULAR".
    if (aTxt === null && ['C', 'D', 'E'].some((c) => /SECCI.N\s+CIRCULAR/i.test(libro.texto(H_DIAG, `${c}${r}`) ?? ''))) { red = 'tuberia'; redesVistas.add('tuberia'); continue }
    // El número de inventario puede ser número (171) o texto ("172-A", "1.-1"): ambos son tramos.
    const inv = aTxt !== null ? aTxt.trim() : (num(libro, H_DIAG, `A${r}`) === null ? '' : String(num(libro, H_DIAG, `A${r}`)))
    const km = cifra(libro, H_DIAG, `E${r}`)
    const obra = libro.texto(H_DIAG, `B${r}`)
    if (inv === '' && obra === null) {
      // Fila de totales: sin inventario ni nombre pero con longitud total (la primera después de los rótulos).
      if (km.valor !== null) {
        filasTotales.push({ fila: r, km, conceptos: conceptoDe(r) })
        if (totales.length === 0 && r <= filaRotulos + 4) totales = conceptoDe(r)
      }
      continue
    }
    // Un renglón de encabezado repetido ("NOMBRE DE LA OBRA", km en texto) no es un tramo: su longitud no es número.
    if (inv === '' || obra === null || km.valor === null) continue
    tramos.push({
      fila: r, red, inventario: inv, obra: obra.trim(),
      pkInicial: pkDeCelda(libro, H_DIAG, `C${r}`) ?? textoOnumero(libro, H_DIAG, `C${r}`),
      pkFinal: pkDeCelda(libro, H_DIAG, `D${r}`) ?? textoOnumero(libro, H_DIAG, `D${r}`),
      km, conceptos: conceptoDe(r),
    })
  }
  if (tramos.length === 0) avisos.push('DIAG-01: se encontraron rótulos pero ningún tramo con inventario y nombre.')
  // Un bloque sin tramos solo es anomalía si el inventario del propio libro declara esa red (km > 0).
  const kmRed: Record<TipoRed, Cifra | null> = { distribucion: km.distribucion, tuberia: null, drenaje: km.drenaje, caminos: km.caminos, otro: null }
  for (const rd of redesVistas) {
    const k = kmRed[rd]
    if (!tramos.some((t) => t.red === rd) && k?.valor !== null && k !== null && Number(k.valor) > 0) {
      avisos.push(`DIAG-01: el inventario declara ${k.valor} km de ${rd} pero el diagnóstico no trae ningún tramo.`)
    }
  }
  return { tramos, totales, filasTotales, conceptos: columnas.map((k) => k.concepto) }
}

/** `DIAG-01!$I$15` → { columna: 'I', fila: 15 }. */
function enlaceADiagnostico(formula: string | null): { columna: string; fila: number } | null {
  if (!formula) return null
  const m = /DIAG-01'?!\$?([A-Z]{1,2})\$?(\d+)/i.exec(formula)
  if (!m || m[1] === undefined || m[2] === undefined) return null
  return { columna: m[1].toUpperCase(), fila: Number(m[2]) }
}

function leerNecesidades(libro: VistaLibro, avisos: string[]): {
  necesidades: NecesidadMedia[]; sumas: SumaBloque[]; total: Cifra | null
} {
  const n = filasDe(libro, H_3DN)
  let total: Cifra | null = null
  const necesidades: NecesidadMedia[] = []
  const sumas: SumaBloque[] = []
  let bloque = ''
  let arranque = false
  for (let r = 1; r <= n; r++) {
    const a = libro.texto(H_3DN, `A${r}`)
    if (a === null) continue
    const rot = a.replace(/\s+/g, ' ').trim()
    if (/^DESCRIPCI/i.test(rot.replace(/\s/g, ''))) { arranque = true; continue }
    if (!arranque) continue
    if (/^SUMA\s+TOTAL|^TOTAL/i.test(rot)) {
      total = cifra(libro, H_3DN, `J${r}`)
      continue
    }
    if (/^SUMA/i.test(rot)) {
      sumas.push({ fila: r, bloque, importe: cifra(libro, H_3DN, `J${r}`) })
      continue
    }
    // Encabezado de bloque ("RED DE DISTRIBUCION", "POZOS"…): rótulo todo en mayúsculas. Los conceptos van en
    // mayúscula y minúscula; un concepto sin datos se conserva (vacío), no se confunde con un bloque.
    if (rot === rot.toUpperCase()) { bloque = rot; continue }
    if (bloque === '') continue
    const fE = libro.formula(H_3DN, `E${r}`)
    necesidades.push({
      fila: r, bloque, concepto: rot,
      unidadParametrica: libro.texto(H_3DN, `B${r}`)?.trim() ?? null,
      unidadTrabajo: libro.texto(H_3DN, `C${r}`)?.trim() ?? null,
      cantidadParametrica: cifra(libro, H_3DN, `D${r}`),
      cantidadTrabajo: cifra(libro, H_3DN, `E${r}`),
      frecuencia: cifra(libro, H_3DN, `F${r}`),
      etiquetaFrecuencia: libro.texto(H_3DN, `G${r}`)?.trim() ?? null,
      necesidadAnual: cifra(libro, H_3DN, `H${r}`),
      pu: cifra(libro, H_3DN, `I${r}`),
      importe: cifra(libro, H_3DN, `J${r}`),
      enlaceDiagnostico: enlaceADiagnostico(fE?.texto ?? null),
    })
  }
  if (necesidades.length === 0) avisos.push('3DN: no se encontraron filas de concepto con cantidad y frecuencia.')
  return { necesidades, sumas, total }
}

function leerPrograma(libro: VistaLibro, avisos: string[]): RenglonPrograma[] {
  const n = filasDe(libro, H_SEG)
  const out: RenglonPrograma[] = []
  let red: TipoRed = 'otro'
  let titulos: string[] = []
  let maquinas: string | null = null
  let tras = false
  for (let r = 1; r <= n; r++) {
    const inv = num(libro, H_SEG, `A${r}`)
    const clave = libro.texto(H_SEG, `B${r}`)
    const c = libro.texto(H_SEG, `C${r}`)
    if (inv !== null && clave !== null && /^\d+-\d/.test(clave.trim())) {
      out.push({
        fila: r, inventario: String(inv), clave: clave.trim(), red,
        encabezado: titulos.join(' / '), maquinas,
        obra: (c ?? '').trim(), localizacion: (libro.texto(H_SEG, `D${r}`) ?? '').trim(),
        km: cifra(libro, H_SEG, `E${r}`), cantidad: cifra(libro, H_SEG, `F${r}`),
        unidad: libro.texto(H_SEG, `G${r}`)?.trim() ?? null,
        pu: cifra(libro, H_SEG, `H${r}`), importe: cifra(libro, H_SEG, `I${r}`),
      })
      tras = true
      continue
    }
    if (c === null || inv !== null) continue
    const t = c.replace(/\s+/g, ' ').trim()
    if (t === '') continue
    const rd = tipoRed(t)
    if (rd) { red = rd; titulos = []; maquinas = null; continue }
    // Tras un renglón empieza una sección nueva; las líneas contiguas antes del siguiente renglón se acumulan.
    if (tras) { titulos = []; maquinas = null; tras = false }
    if (t.startsWith('(')) maquinas = t
    else titulos.push(t)
  }
  if (out.length === 0) avisos.push('SEG-3: no se encontraron renglones con número de inventario y clave de catálogo.')
  return out
}

/** PK de una celda: texto ("K-2+000", "3+520") o número en metros (3520 → "3+520", como en el IO1 del módulo). */
function pkDeCelda(libro: VistaLibro, hoja: string, celda: string): string | null {
  const t = libro.texto(hoja, celda)
  if (t !== null) return normalizarPK(t)
  const n = num(libro, hoja, celda)
  if (n === null) return null
  const m = Math.round(n)
  return `${Math.floor(m / 1000)}+${String(m % 1000).padStart(3, '0')}`
}

const FILA_FICHAS_DESDE = 16

/**
 * IO1 (canales) e IO2 (drenes) tienen el mismo formato (Anexo 1, formatos IO-1 e IO-2): inventario A, nombre B, categoría C,
 * PK D/G, longitud J, gasto L, velocidad M, pendiente N, área O, plantilla P, tirante Q, libre bordo R, talud S, corona T,
 * revestimiento U, sección V. Una fila es ficha si tiene nombre y longitud numérica (así se salta "Suma" y las filas en blanco).
 */
function puntoCanal(libro: VistaLibro, hoja: string, r: number, colPK: string, colLon: string, colLat: string): PuntoCanal {
  const c = repararLonLat(libro.texto(hoja, `${colLon}${r}`), libro.texto(hoja, `${colLat}${r}`))
  return { pk: pkDeCelda(libro, hoja, `${colPK}${r}`), ...c, refPK: `${hoja}!${colPK}${r}`, refLon: `${hoja}!${colLon}${r}`, refLat: `${hoja}!${colLat}${r}` }
}

const metrosDePK = (pk: string | null): number | null => pkAMetros(pk)

/**
 * `geo` = IO1: además lee los extremos del tramo (D-F inicial, G-I final: cadenamiento, longitud y latitud en DMS), los conteos
 * de estructuras (W..AN) y el ramal. El ramal auxiliar empieza donde el cadenamiento reinicia (cae más de `UMBRAL_REINICIO_M`).
 */
function leerFichasCanal(libro: VistaLibro, hoja: string, geo = false): FichaCanal[] {
  const out: FichaCanal[] = []
  const n = filasDe(libro, hoja)
  let ramal: Ramal = 'principal'
  let finPrevio: number | null = null
  for (let r = FILA_FICHAS_DESDE; r <= n; r++) {
    const nombre = libro.texto(hoja, `B${r}`)
    const km = cifra(libro, hoja, `J${r}`)
    if (nombre === null || km.valor === null) continue
    let extra: Pick<FichaCanal, 'ini' | 'fin' | 'conteos' | 'ramal'> = {}
    if (geo) {
      const ini = puntoCanal(libro, hoja, r, 'D', 'E', 'F')
      const fin = puntoCanal(libro, hoja, r, 'G', 'H', 'I')
      const mi = metrosDePK(ini.pk), mf = metrosDePK(fin.pk)
      if (ramal === 'principal' && mi !== null && finPrevio !== null && finPrevio - mi > UMBRAL_REINICIO_M) ramal = 'auxiliar'
      if (mf !== null) finPrevio = mf
      extra = { ini, fin, conteos: leerConteosIO1(libro, r), ramal }
    }
    out.push({
      ...extra,
      fila: r, inventario: textoOnumero(libro, hoja, `A${r}`), nombre: nombre.trim(),
      categoria: libro.texto(hoja, `C${r}`)?.trim() ?? null,
      pkInicial: pkDeCelda(libro, hoja, `D${r}`), pkFinal: pkDeCelda(libro, hoja, `G${r}`), km,
      gasto: cifra(libro, hoja, `L${r}`), velocidad: cifra(libro, hoja, `M${r}`), pendiente: cifra(libro, hoja, `N${r}`),
      area: cifra(libro, hoja, `O${r}`), plantilla: cifra(libro, hoja, `P${r}`), tirante: cifra(libro, hoja, `Q${r}`),
      libreBordo: cifra(libro, hoja, `R${r}`), talud: cifra(libro, hoja, `S${r}`), corona: cifra(libro, hoja, `T${r}`),
      revestimiento: libro.texto(hoja, `U${r}`)?.trim() ?? null, seccion: libro.texto(hoja, `V${r}`)?.trim() ?? null,
    })
  }
  return out
}

/** IO3 (caminos): inventario A, nombre B, PK C/F, longitud I, servicio K, ancho de carpeta L, revestimiento M. */
function leerFichasCamino(libro: VistaLibro): FichaCamino[] {
  const out: FichaCamino[] = []
  const n = filasDe(libro, 'IO3')
  for (let r = FILA_FICHAS_DESDE; r <= n; r++) {
    const nombre = libro.texto('IO3', `B${r}`)
    const km = cifra(libro, 'IO3', `I${r}`)
    if (nombre === null || km.valor === null) continue
    out.push({
      fila: r, inventario: textoOnumero(libro, 'IO3', `A${r}`), nombre: nombre.trim(),
      pkInicial: pkDeCelda(libro, 'IO3', `C${r}`), pkFinal: pkDeCelda(libro, 'IO3', `F${r}`), km,
      servicio: libro.texto('IO3', `K${r}`)?.trim() ?? null, ancho: cifra(libro, 'IO3', `L${r}`),
      revestimiento: libro.texto('IO3', `M${r}`)?.trim() ?? null,
    })
  }
  return out
}

function leerFichas(libro: VistaLibro): FichasInventario {
  const canales = leerFichasCanal(libro, 'IO1', true)
  // El auxiliar nace en el PK del principal que da nombre a su ficha («CANAL AUXILIAR K-68+582»).
  const fichaAux = canales.find((f) => f.ramal === 'auxiliar')
  const anclaAuxiliar = fichaAux === undefined ? null : limpiarPK(fichaAux.nombre).pk
  const ejes = construirEjes(canales, pkAMetros(anclaAuxiliar))
  const io4 = leerEstructurasIO4(libro)
  const io7 = leerEdificiosIO7(libro)
  const avisosGeo: string[] = []
  for (const f of canales) {
    for (const [p, etq] of [[f.ini, 'inicial'], [f.fin, 'final']] as const) {
      const d = p === undefined ? null : describirDefecto(p)
      if (p !== undefined && d !== null) avisosGeo.push(`IO1 fila ${f.fila}, punto ${etq} (${p.refLon}/${p.refLat}): ${d}.`)
    }
  }
  for (const p of ejes.sinCoordenadas) avisosGeo.push(`Punto K-${p.pk}${p.ramal === 'auxiliar' ? ' del ramal auxiliar' : ''} sin coordenadas completas en IO1 (${p.motivo}): su posición solo puede estimarse.`)
  avisosGeo.push(...ejes.conflictos, ...io4.avisos, ...io7.avisos)
  return {
    canales, drenes: leerFichasCanal(libro, 'IO2'), caminos: leerFichasCamino(libro),
    estructuras: estimarUbicaciones(io4.estructuras, ejes), edificios: estimarEdificios(io7.edificios, ejes),
    totalesIO1: leerTotalesIO1(libro), anclaAuxiliar, avisosGeo,
  }
}

export function extraerLibro(libro: VistaLibro): LibroDerivado {
  const avisos: string[] = []
  const inventarioKm = {
    distribucion: cifra(libro, 'IO1', 'J15'), drenaje: cifra(libro, 'IO2', 'J15'), caminos: cifra(libro, 'IO3', 'I15'),
  }
  const d = leerDiagnostico(libro, avisos, inventarioKm)
  const nm = leerNecesidades(libro, avisos)
  const programa = leerPrograma(libro, avisos)
  return {
    sha256: libro.libro.sha256,
    moduloNombre: libro.texto('Resumen', 'B6')?.trim() ?? null,
    ciclo: libro.texto('Resumen', 'B10')?.trim() ?? null,
    baseValores: libro.libro.baseValores,
    conceptosDiagnostico: d.conceptos,
    tramos: d.tramos,
    totalesDiagnostico: d.totales,
    filasTotales: d.filasTotales,
    necesidades: nm.necesidades,
    sumasBloque: nm.sumas,
    totalGeneral3dn: nm.total,
    programa,
    inventarioKm,
    fichas: leerFichas(libro),
    extractorVersion: EXTRACTOR_VERSION,
    avisos,
  }
}
