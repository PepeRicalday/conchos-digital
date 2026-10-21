import type { VistaLibro } from '../nucleo/libro/vista'
import { cifra } from './extraer'
import type { BloqueMaquinaria, Cifra, EstadoMecanico, FilaBalanceMaquinaria, MaquinariaLibro, RenglonMaquinaria, TotalMaquinaria, UnidadMaquinaria } from './tipos'
import { quitaAcentos } from './vistas'

/**
 * Lectura del balance de maquinaria (hoja B Maq, formato 4 DNMACN) y del inventario (hoja IM01, formato CNA-DR-IM-01). Solo lectura.
 * Los datos se localizan por rótulos, no por filas ni columnas fijas: el libro de un módulo y el de la SRL tienen el mismo formato pero
 * IM01 de la SRL trae una columna auxiliar a la izquierda y todo queda una columna a la derecha. Una celda vacía es S/D, nunca cero.
 */

const H_BAL = 'B Maq'
const H_INV = 'IM01'
const FILAS_MAX = 400

/**
 * Catálogo de tipos de máquina que los libros usan como filas de la tabla de balance (Anexo 4: col. 1 y caracteres 5-6 del número económico,
 * col. 2); el formato 4 impreso (Manual p. 74) trae solo 9 de ellas. Los nombres van limpios. Las equivalencias de escritura (ALIAS, p. ej.
 * tractocamión = tractor camión con cama baja) son una lectura del comprobador, no de la norma.
 */
export const TIPOS_MAQUINA = [
  'Draga', 'Excavadoras', 'Retroexcavadora/cargadora', 'Tractor sobre oruga', 'Motoconformadora', 'Tractor agrícola con equipo ligero',
  'Tractor agrícola con equipo de nivelación', 'Minicargador', 'Cargador frontal', 'Compactador', 'Camión volteo', 'Camión pipa',
  'Camión con grúa hidráulica', 'Camión de mantenimiento', 'Tractor camión 5a rueda con cama baja', 'Trituradora de piedra con tractor agrícola',
  'Zanjadora para drenaje subterráneo', 'Máquina perforadora',
] as const

const CANON: ReadonlyMap<string, string> = new Map(TIPOS_MAQUINA.map((t) => [quitaAcentos(t), t]))

/** Escrituras que los libros usan para un tipo del catálogo (ya sin acentos ni mayúsculas). */
const ALIAS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^excavadoras?\b/, 'Excavadoras'],
  [/^retroexcavadora\b/, 'Retroexcavadora/cargadora'],
  [/^((tractor )?(de )?(bulldozer|buldozer|bulldocer)|tractor (de |sobre )?orugas?)\b/, 'Tractor sobre oruga'],
  [/^moto ?(conformadora|niveladora)s?\b/, 'Motoconformadora'],
  [/^camion (de )?volteo\b/, 'Camión volteo'],
  [/^(tracto ?camion|tractor camion( 5a rueda)?)$/, 'Tractor camión 5a rueda con cama baja'],
  [/^cargador(a)? frontal\b/, 'Cargador frontal'],
  [/^camion (con )?grua( hidraulica)?$/, 'Camión con grúa hidráulica'],
  [/^camion pipa$/, 'Camión pipa'],
  // El catálogo de IM-01 (Anexo 4, col. 1) inventaría estos equipos como unidad básica cuando el tractor es del módulo.
  [/^equipo ligero( para mantenimiento.*)?$/, 'Tractor agrícola con equipo ligero'],
  [/^equipo de nivelacion( de tierras| completo)?$/, 'Tractor agrícola con equipo de nivelación'],
]

/**
 * Implementos de una unidad básica (Anexo 4, col. 11: desvaradora o desbrozadora, canastilla, barra taludadora, cuchilla, ripper,
 * malacate, escrepa) y otros que el comprobador trata igual (rastra, implemento). No son una máquina portadora: figuran en el
 * inventario pero no cuentan como existentes. Anclado al inicio: «Tractor con cuchilla» es un tractor.
 */
const ACCESORIO = /^(desvaradora|desbrozadora|canastilla|barra taludadora|cuchilla|ripper|malacate|escrepa|cucharon|equipo transmisor|rastra|implemento)/

export interface TipoNormalizado { readonly canonico: string | null; readonly accesorio: boolean }

export function normalizarTipo(texto: string | null): TipoNormalizado {
  if (texto === null) return { canonico: null, accesorio: false }
  const k = quitaAcentos(texto).replace(/[.,;:]+$/, '').trim()
  const exacto = CANON.get(k)
  if (exacto !== undefined) return { canonico: exacto, accesorio: false }
  for (const [re, nombre] of ALIAS) if (re.test(k)) return { canonico: nombre, accesorio: false }
  return { canonico: null, accesorio: ACCESORIO.test(k) && !CANON.has(k) }
}

/** Texto de la celda (un número se vuelve texto); null si está vacía. */
function txt(libro: VistaLibro, hoja: string, celda: string): string | null {
  const c = libro.celda(hoja, celda)
  if (c === undefined) return null
  const t = c.tipo === 'texto' ? c.valor : c.tipo === 'numero' ? String(c.valor) : ''
  const l = t.replace(/\s+/g, ' ').trim()
  return l === '' ? null : l
}

const esNumero = (libro: VistaLibro, hoja: string, celda: string): boolean => libro.numero(hoja, celda).ok

const colDe = (n: number): string => { let s = ''; for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s }

function filasDe(libro: VistaLibro, hoja: string): number {
  return Math.min(libro.hoja(hoja)?.nfilas ?? 0, FILAS_MAX)
}

/** Primera fila (entre 1 y `hasta`) cuya celda de la columna dice lo que pide `re` (sobre el texto sin acentos). */
function filaConRotulo(libro: VistaLibro, hoja: string, col: string, re: RegExp, desde = 1, hasta = filasDe(libro, hoja)): number | null {
  for (let r = desde; r <= hasta; r++) {
    const t = txt(libro, hoja, `${col}${r}`)
    if (t !== null && re.test(quitaAcentos(t))) return r
  }
  return null
}

/** Columna (A..AB) de la fila `fila` cuya celda dice lo que pide `re`. */
function colConRotulo(libro: VistaLibro, hoja: string, fila: number, re: RegExp): string | null {
  for (let c = 1; c <= 28; c++) {
    const t = txt(libro, hoja, `${colDe(c)}${fila}`)
    if (t !== null && re.test(quitaAcentos(t))) return colDe(c)
  }
  return null
}

/* ---------------------------- B Maq: renglones de necesidad ---------------------------- */

/** Encabezados de bloque del formato 4 (el libro los escribe con erratas: «bonbeo», «canminos»). */
const BLOQUES: ReadonlyArray<readonly [RegExp, BloqueMaquinaria]> = [
  [/^plantas? de bo/, 'bombeo'], [/^red de (canal|distribu)/, 'distribucion'], [/^red de drenaje/, 'drenaje'], [/^red de ca[mn]+ino/, 'caminos'], [/^mejoramiento parcelario/, 'parcelario'],
]

/** Texto con dígitos donde va un número («1,5», «2 »): un rótulo («Anual», «MAQ.») no lo es. */
const textoNumerico = (x: Cifra): boolean => x.valor === null && x.texto !== undefined && /\d/.test(x.texto)

function leerRenglones(libro: VistaLibro, filaIni: number, filaFin: number): { renglones: RenglonMaquinaria[]; total: TotalMaquinaria | null } {
  const renglones: RenglonMaquinaria[] = []
  // Fila sin tipo de máquina con horas y máquinas: candidata a «total». El total es la última; una anterior es un renglón al que le falta el tipo.
  const sinTipo: { r: number; a: string | null; bloque: BloqueMaquinaria | null; concepto: string | null; unidad: string | null }[] = []
  let concepto: string | null = null
  let unidad: string | null = null
  let bloque: BloqueMaquinaria | null = null
  const c = (col: string, r: number): Cifra => cifra(libro, H_BAL, `${col}${r}`)
  const bloqueDe = (a: string | null): BloqueMaquinaria | null => (a === null ? null : (BLOQUES.find(([re]) => re.test(quitaAcentos(a)))?.[1] ?? null))
  const renglon = (r: number, tipo: string, a: string | null, bq: BloqueMaquinaria | null): RenglonMaquinaria => {
    const heredado = a === null
    if (a !== null) { concepto = a; unidad = txt(libro, H_BAL, `B${r}`) } else if (txt(libro, H_BAL, `B${r}`) !== null) unidad = txt(libro, H_BAL, `B${r}`)
    return {
      fila: r, bloque: bq, concepto, conceptoHeredado: heredado, unidad,
      cantidad: c('C', r), frecuencia: c('D', r), anual: c('F', r), tipo, tipoCanonico: normalizarTipo(tipo).canonico,
      rendimiento: c('H', r), horas: c('I', r), horasDisponibles: c('J', r), maquinas: c('K', r),
    }
  }
  for (let r = filaIni; r <= filaFin; r++) {
    const tipo = txt(libro, H_BAL, `G${r}`)
    const a = txt(libro, H_BAL, `A${r}`)
    // Un bloque nuevo no hereda el concepto del anterior: su primer renglón sin concepto queda sin concepto, no con el de otra red.
    const nuevoBloque = bloqueDe(a)
    if (nuevoBloque !== null && nuevoBloque !== bloque) concepto = null
    bloque = nuevoBloque ?? bloque
    // Un renglón de necesidad trae al menos una cifra (anual, rendimiento, horas o máquinas); «MAQ.» del subtítulo y los encabezados no.
    const hayCifra = ['F', 'H', 'I', 'K'].some((col) => esNumero(libro, H_BAL, `${col}${r}`) || textoNumerico(c(col, r)))
    if (!hayCifra) continue
    if (tipo === null || esNumero(libro, H_BAL, `G${r}`)) {
      if (esNumero(libro, H_BAL, `I${r}`) && esNumero(libro, H_BAL, `K${r}`)) sinTipo.push({ r, a, bloque, concepto, unidad })
      else renglones.push(renglon(r, '', a, bloque))
      continue
    }
    renglones.push(renglon(r, tipo, a, bloque))
  }
  const filaTotal = sinTipo.pop()?.r
  // Las filas sin tipo anteriores a la de totales son renglones: se conservan con tipo vacío para que la vista las señale.
  for (const s of sinTipo) { concepto = s.concepto; unidad = s.unidad; renglones.push(renglon(s.r, '', s.a, s.bloque)) }
  renglones.sort((x, y) => x.fila - y.fila)
  const total: TotalMaquinaria | null = filaTotal === undefined ? null : { fila: filaTotal, horas: c('I', filaTotal), horasDisponibles: c('J', filaTotal), maquinas: c('K', filaTotal) }
  return { renglones, total }
}

/* ---------------------------- B Maq: tabla de balance por tipo ---------------------------- */

function filaBalance(libro: VistaLibro, r: number, tipo: string): FilaBalanceMaquinaria {
  const c = (col: string): Cifra => cifra(libro, H_BAL, `${col}${r}`)
  return {
    fila: r, tipo, tipoCanonico: normalizarTipo(tipo).canonico,
    necesarias: c('B'), existentes: c('C'), faltante: c('D'), sobrante: c('E'), buenoRegular: c('F'), malo: c('G'), baja: c('H'),
    rehabilitacion: c('I'), disposicion: c('J'), porFaltante: c('K'), porSustituir: c('L'), suma: c('M'),
  }
}

function leerBalance(libro: VistaLibro, filaIni: number): { filas: FilaBalanceMaquinaria[]; total: FilaBalanceMaquinaria | null } {
  const filas: FilaBalanceMaquinaria[] = []
  const n = filasDe(libro, H_BAL)
  for (let r = filaIni; r <= n; r++) {
    const a = txt(libro, H_BAL, `A${r}`)
    if (a === null) continue
    if (/^sumas?$/.test(quitaAcentos(a))) return { filas, total: filaBalance(libro, r, a) }
    filas.push(filaBalance(libro, r, a))
  }
  return { filas, total: null }
}

/* ---------------------------- IM01: inventario ---------------------------- */

const ESTADOS: ReadonlyArray<readonly [EstadoMecanico, RegExp]> = [['bueno', /^bueno$/], ['regular', /^regular$/], ['malo', /^malo$/], ['baja', /^baja$/]]

/** Lo que se escribe para marcar un estado mecánico; un «0», «-» o «N/A» no es una marca. */
const MARCA = /^(x|✓|✔|1|si)$/

const SIN_DATO = /^(s\/?d|n\/?d|n\/?a|nd|-+|—+|sin dato|sin horometro)$/

function unidadDeLectura(h: Cifra): UnidadMaquinaria['unidadLectura'] {
  if (h.valor !== null) return 'horas'
  if (h.texto === undefined) return null
  const t = quitaAcentos(h.texto)
  if (SIN_DATO.test(t)) return null
  if (/milla/.test(t)) return 'millas'
  if (/\bkm|\bkms|kilomet/.test(t)) return 'km'
  if (/\bhr?s?\b|horas?/.test(t)) return 'horas'
  return 'otra'
}

interface LecturaInventario { readonly unidades: UnidadMaquinaria[]; readonly leido: boolean; readonly numeroEconomico: boolean; readonly horas: boolean }

function leerInventario(libro: VistaLibro, avisos: string[]): LecturaInventario {
  const noLeido: LecturaInventario = { unidades: [], leido: false, numeroEconomico: false, horas: false }
  if (libro.hoja(H_INV) === undefined) { avisos.push('El libro no trae la hoja IM01 (inventario de maquinaria): no se compara con el balance.'); return noLeido }
  const filaTipo = filaConRotulo(libro, H_INV, 'A', /^tipo de maquina/, 1, 25) ?? filaConRotulo(libro, H_INV, 'B', /^tipo de maquina/, 1, 25)
  if (filaTipo === null) { avisos.push('IM01: no se encontró el rótulo «Tipo de máquina»; no se leyó el inventario ni se compara con el balance.'); return noLeido }
  const colTipo = colConRotulo(libro, H_INV, filaTipo, /^tipo de maquina/)
  const colNum = colConRotulo(libro, H_INV, filaTipo, /^(numero|num\.?|no\.?) ?economico/)
  // El estado mecánico va en una fila de rótulos Bueno / Regular / Malo / Baja, normalmente la siguiente a «Tipo de máquina».
  let filaEstado: number | null = null
  for (let r = filaTipo; r <= filaTipo + 3 && filaEstado === null; r++) if (ESTADOS.every(([, re]) => colConRotulo(libro, H_INV, r, re) !== null)) filaEstado = r
  if (colTipo === null || filaEstado === null) { avisos.push('IM01: no se encontraron las columnas de tipo o de estado mecánico; no se leyó el inventario ni se compara con el balance.'); return noLeido }
  const colEstado = new Map<EstadoMecanico, string>(ESTADOS.map(([e, re]) => [e, colConRotulo(libro, H_INV, filaEstado, re) ?? '']))
  const primera = (filas: readonly number[], re: RegExp): string | null => { for (const f of filas) { const c = colConRotulo(libro, H_INV, f, re); if (c !== null) return c } return null }
  const colHoras = primera([filaTipo - 1, filaTipo - 2, filaTipo], /^horas trabajadas/)
  const colObs = primera([filaTipo - 1, filaTipo - 2], /^observaciones/)
  const colMarca = colConRotulo(libro, H_INV, filaEstado, /^marca$/)
  const colModelo = colConRotulo(libro, H_INV, filaEstado, /^modelo$/)
  if (colNum === null) avisos.push('IM01: no se encontró la columna «Número económico»; no se señala su ausencia unidad por unidad.')
  if (colHoras === null) avisos.push('IM01: no se encontró la columna «Horas trabajadas»; no se señala su ausencia unidad por unidad.')
  const vacia = (r: number): Cifra => ({ valor: null, ref: `${H_INV}!${colTipo}${r}`, formula: null, origen: 'vacio' })
  const unidades: UnidadMaquinaria[] = []
  const n = filasDe(libro, H_INV)
  if ((libro.hoja(H_INV)?.nfilas ?? 0) > FILAS_MAX) avisos.push(`IM01: la hoja trae más de ${FILAS_MAX} filas; se leyeron solo las primeras.`)
  let omitidas = 0
  for (let r = filaEstado + 1; r <= n; r++) {
    const tipo = txt(libro, H_INV, `${colTipo}${r}`)
    if (tipo === null) continue
    const marcadas = ESTADOS.filter(([e]) => { const col = colEstado.get(e); const t = col === undefined || col === '' ? null : txt(libro, H_INV, `${col}${r}`); return t !== null && MARCA.test(quitaAcentos(t)) })
    const numeroEconomico = colNum === null ? null : txt(libro, H_INV, `${colNum}${r}`)
    const horas = colHoras === null ? vacia(r) : cifra(libro, H_INV, `${colHoras}${r}`)
    const norm = normalizarTipo(tipo)
    // Un texto suelto (una firma, un rótulo olvidado) no es una unidad: una unidad real trae número económico, estado u horas.
    if (numeroEconomico === null && marcadas.length === 0 && horas.valor === null && horas.texto === undefined) { omitidas++; continue }
    unidades.push({
      fila: r, tipo, tipoCanonico: norm.canonico, accesorio: norm.accesorio, numeroEconomico,
      marca: colMarca === null ? null : txt(libro, H_INV, `${colMarca}${r}`), modelo: colModelo === null ? null : txt(libro, H_INV, `${colModelo}${r}`),
      estado: marcadas.length === 1 ? marcadas[0]![0] : null, estadoConflicto: marcadas.length > 1,
      horas, unidadLectura: colHoras === null ? null : unidadDeLectura(horas),
      observaciones: colObs === null ? null : txt(libro, H_INV, `${colObs}${r}`), ref: `${H_INV}!${colTipo}${r}`,
    })
  }
  if (omitidas > 0) avisos.push(`IM01: ${omitidas} fila${omitidas === 1 ? '' : 's'} con un tipo de máquina pero sin número económico, estado ni horas no se tomó como unidad.`)
  return { unidades, leido: true, numeroEconomico: colNum !== null, horas: colHoras !== null }
}

/** Una celda que debía ser un número y trae texto («1,5», «2 »): no se interpreta, se avisa con su celda. */
function avisarTextoEnCifras(m: Pick<MaquinariaLibro, 'renglones' | 'balance' | 'totalBalance'>, avisos: string[]): void {
  const filas: Cifra[] = [
    ...m.renglones.flatMap((r) => [r.cantidad, r.frecuencia, r.anual, r.rendimiento, r.horas, r.horasDisponibles, r.maquinas]),
    ...[...m.balance, ...(m.totalBalance === null ? [] : [m.totalBalance])].flatMap((b) => [b.necesarias, b.existentes, b.faltante, b.sobrante, b.buenoRegular, b.malo, b.baja, b.rehabilitacion, b.disposicion, b.porFaltante, b.porSustituir, b.suma]),
  ]
  for (const x of filas) if (textoNumerico(x)) avisos.push(`${x.ref}: trae el texto «${x.texto}» donde debía ir un número; se toma como S/D y no se interpreta.`)
}

/** Balance e inventario de maquinaria del libro; undefined si el libro no trae la hoja B Maq. */
export function leerMaquinaria(libro: VistaLibro): MaquinariaLibro | undefined {
  if (libro.hoja(H_BAL) === undefined) return undefined
  const avisos: string[] = []
  if ((libro.hoja(H_BAL)?.nfilas ?? 0) > FILAS_MAX) avisos.push(`B Maq: la hoja trae más de ${FILAS_MAX} filas; se leyeron solo las primeras.`)
  const inv = leerInventario(libro, avisos)
  const meta = { inventarioLeido: inv.leido, columnasInventario: { numeroEconomico: inv.numeroEconomico, horas: inv.horas } }
  const filaConcepto = filaConRotulo(libro, H_BAL, 'A', /^concepto de trabajo/, 1, 30)
  const filaTabla = filaConRotulo(libro, H_BAL, 'A', /^tipo de maquinaria/, filaConcepto ?? 1)
  if (filaConcepto === null || filaTabla === null) {
    avisos.push('B Maq: no se encontraron los rótulos «Concepto de trabajo» o «Tipo de maquinaria»; no se leyó el balance.')
    return { renglones: [], totalRenglones: null, balance: [], totalBalance: null, inventario: inv.unidades, ...meta, avisos }
  }
  const rotulosEsperados: ReadonlyArray<readonly [string, RegExp]> = [['G', /^tipo de maquina/], ['H', /^rendimiento/], ['K', /^numero de maquinas/]]
  for (const [col, re] of rotulosEsperados) {
    const t = txt(libro, H_BAL, `${col}${filaConcepto}`)
    if (t === null || !re.test(quitaAcentos(t))) avisos.push(`B Maq!${col}${filaConcepto}: el rótulo de la columna no es el del formato 4; las columnas de datos podrían estar movidas.`)
  }
  const { renglones, total } = leerRenglones(libro, filaConcepto + 1, filaTabla - 1)
  const { filas, total: totalBalance } = leerBalance(libro, filaTabla + 1)
  if (totalBalance === null) avisos.push('B Maq: la tabla de balance no trae la fila SUMAS.')
  avisarTextoEnCifras({ renglones, balance: filas, totalBalance }, avisos)
  return { renglones, totalRenglones: total, balance: filas, totalBalance, inventario: inv.unidades, ...meta, avisos }
}
