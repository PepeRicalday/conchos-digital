/**
 * Catálogo de estructuras del inventario (IO4/IO1/IO7). Datos puros: la interfaz dibuja los símbolos con `simboloSvg`.
 *
 * Seis familias, cada una con una FORMA distinta (no solo color, para que se distingan en blanco y negro):
 *   toma/entrega → triángulo hacia abajo · control/regulación → rombo · cruce → cuadrado ·
 *   protección y conducción → círculo · medición → hexágono · edificación → cuadrado con base.
 * La paleta de los símbolos NO usa rojo ni ámbar (reservados a alertas / «atípico») ni los colores de módulo de la SRL.
 */

export const TIPOS_ESTRUCTURA = [
  'estacion_aforo', 'represa', 'toma', 'toma_granja', 'caja_repartidora', 'caida', 'rapida', 'desfogue', 'entrada_agua',
  'paso_superior', 'paso_inferior', 'muro_retencion', 'sifon', 'alcantarilla', 'puente_canal', 'puente_vehiculos', 'puente_peatones',
  'edificio', 'otro',
] as const
export type TipoEstructura = (typeof TIPOS_ESTRUCTURA)[number]

/** Tipos que IO1 cuenta por columna (W..AM), en el orden de la hoja. */
export const TIPOS_IO1 = TIPOS_ESTRUCTURA.filter((t): t is Exclude<TipoEstructura, 'edificio' | 'otro'> => t !== 'edificio' && t !== 'otro')
export type TipoIO1 = (typeof TIPOS_IO1)[number]

export type FamiliaId = 'toma_entrega' | 'control' | 'cruce' | 'proteccion' | 'medicion' | 'edificacion'
export type FormaSimbolo = 'triangulo_abajo' | 'rombo' | 'cuadrado' | 'circulo' | 'hexagono' | 'cuadrado_base'

export interface FamiliaInfo {
  readonly id: FamiliaId
  readonly nombre: string
  readonly forma: FormaSimbolo
  readonly descripcion: string
  /** Orden de la leyenda y del carril en el perfil (0 = arriba). */
  readonly orden: number
  /** Color de contorno del símbolo: sin rojo ni ámbar. */
  readonly color: string
}

export const FAMILIAS: readonly FamiliaInfo[] = [
  { id: 'toma_entrega', nombre: 'Toma y entrega', forma: 'triangulo_abajo', orden: 0, color: '#0e7490',
    descripcion: 'Derivan agua del canal hacia lateral, parcela o granja: tomas directas y laterales, tomas de granja, cajas repartidoras.' },
  { id: 'control', nombre: 'Control y regulación', forma: 'rombo', orden: 1, color: '#7c3aed',
    descripcion: 'Mantienen el nivel y reparten el gasto: represas.' },
  { id: 'cruce', nombre: 'Cruce', forma: 'cuadrado', orden: 2, color: '#475569',
    descripcion: 'Permiten que el canal o un camino crucen un obstáculo: sifones, alcantarillas, pasos superiores e inferiores, puentes.' },
  { id: 'proteccion', nombre: 'Protección y conducción', forma: 'circulo', orden: 3, color: '#0f766e',
    descripcion: 'Protegen el canal o manejan avenidas y excedencias: entradas de agua, desfogues, caídas, rápidas, muros de retención.' },
  { id: 'medicion', nombre: 'Medición', forma: 'hexagono', orden: 4, color: '#a21caf',
    descripcion: 'Miden el gasto: estaciones, casetas y puentes de aforo, canastillas aforadoras.' },
  { id: 'edificacion', nombre: 'Edificación', forma: 'cuadrado_base', orden: 5, color: '#52525b',
    descripcion: 'Edificios, casetas y obras dispersas del inventario IO7: oficinas, central de maquinaria, casetas de jefe de zona.' },
] as const

export const FAMILIA_POR_ID: Readonly<Record<FamiliaId, FamiliaInfo>> = Object.fromEntries(FAMILIAS.map((f) => [f.id, f])) as Record<FamiliaId, FamiliaInfo>

export interface InfoTipo {
  readonly nombre: string
  /** null = «sin clasificar». */
  readonly familia: FamiliaId | null
  /** Columna de IO1 que lo cuenta, o null si IO1 no lo cuenta. */
  readonly columnaIO1: string | null
}

export const INFO_TIPO: Readonly<Record<TipoEstructura, InfoTipo>> = {
  estacion_aforo: { nombre: 'Estación de aforo', familia: 'medicion', columnaIO1: 'W' },
  represa: { nombre: 'Represa', familia: 'control', columnaIO1: 'X' },
  toma: { nombre: 'Toma', familia: 'toma_entrega', columnaIO1: 'Y' },
  toma_granja: { nombre: 'Toma de granja', familia: 'toma_entrega', columnaIO1: 'Z' },
  caja_repartidora: { nombre: 'Caja repartidora', familia: 'toma_entrega', columnaIO1: 'AA' },
  caida: { nombre: 'Caída', familia: 'proteccion', columnaIO1: 'AB' },
  rapida: { nombre: 'Rápida', familia: 'proteccion', columnaIO1: 'AC' },
  desfogue: { nombre: 'Desfogue', familia: 'proteccion', columnaIO1: 'AD' },
  entrada_agua: { nombre: 'Entrada de agua', familia: 'proteccion', columnaIO1: 'AE' },
  paso_superior: { nombre: 'Paso superior', familia: 'cruce', columnaIO1: 'AF' },
  paso_inferior: { nombre: 'Paso inferior', familia: 'cruce', columnaIO1: 'AG' },
  muro_retencion: { nombre: 'Muro de retención', familia: 'proteccion', columnaIO1: 'AH' },
  sifon: { nombre: 'Sifón', familia: 'cruce', columnaIO1: 'AI' },
  alcantarilla: { nombre: 'Alcantarilla', familia: 'cruce', columnaIO1: 'AJ' },
  puente_canal: { nombre: 'Puente canal', familia: 'cruce', columnaIO1: 'AK' },
  puente_vehiculos: { nombre: 'Puente de vehículos', familia: 'cruce', columnaIO1: 'AL' },
  puente_peatones: { nombre: 'Puente de peatones', familia: 'cruce', columnaIO1: 'AM' },
  edificio: { nombre: 'Edificio / caseta', familia: 'edificacion', columnaIO1: null },
  otro: { nombre: 'Sin clasificar', familia: null, columnaIO1: null },
}

/** Columna de IO1 (W..AM) → tipo de estructura que cuenta. */
export const COLUMNA_IO1: Readonly<Record<string, TipoIO1>> = Object.fromEntries(
  TIPOS_IO1.map((t) => [INFO_TIPO[t].columnaIO1 as string, t]),
)
export const COLUMNAS_IO1: readonly string[] = TIPOS_IO1.map((t) => INFO_TIPO[t].columnaIO1 as string)

/**
 * TABLA IO4 → IO1 (equivalencia declarada para conciliar). IO4 lista cada estructura por nombre; IO1 la cuenta por columna.
 * Es uno a uno salvo en las tomas: IO1 separa «tomas» (Y) de «tomas granja» (Z) con un criterio que IO4 no registra
 * (IO4 solo nombra 4 «TOMA GRANJA» y IO1 cuenta 90), así que se concilian como un solo grupo. Lo que no se puede clasificar
 * (tipo `otro`) no tiene columna: se informa aparte, no se reparte.
 */
export interface GrupoConciliacion {
  readonly id: string
  readonly rotulo: string
  /** Columnas de IO1 que se suman. */
  readonly columnasIO1: readonly string[]
  /** Tipos de IO4 que se suman. */
  readonly tiposIO4: readonly TipoEstructura[]
}

export const TABLA_IO4_IO1: readonly GrupoConciliacion[] = [
  ...TIPOS_IO1.filter((t) => t !== 'toma' && t !== 'toma_granja').map((t) => (
    { id: t, rotulo: INFO_TIPO[t].nombre, columnasIO1: [INFO_TIPO[t].columnaIO1 as string], tiposIO4: [t] as readonly TipoEstructura[] }
  )),
  { id: 'toma_y_granja', rotulo: 'Tomas (incluye tomas de granja)', columnasIO1: ['Y', 'Z'], tiposIO4: ['toma', 'toma_granja'] },
]

/* ───────────────────────── clasificación por nombre ───────────────────────── */

export interface Clasificacion {
  readonly tipo: TipoEstructura
  readonly familia: FamiliaId | null
  /** Resto del nombre crudo (VADO, TUBOS, DIRECTA, TIPO SIFON…), normalizado; null si no hay. */
  readonly subtipo: string | null
  /** true = el nombre no basta para estar seguro del tipo; se conserva el subtipo crudo y no se reclasifica. */
  readonly ambiguo: boolean
  /** Regla que decidió (para trazabilidad y pruebas). */
  readonly regla: string
}

/** Mayúsculas, sin acentos, espacios colapsados y sin el paréntesis final (referencias a laterales/módulos). */
export function normalizarNombre(nombre: string): string {
  return nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/\(.*$/, '').replace(/\s+/g, ' ').trim()
}

interface Regla {
  readonly id: string
  readonly re: RegExp
  readonly tipo: TipoEstructura
  /** Grupo de captura con el subtipo (opcional). */
  readonly subtipo?: (m: RegExpExecArray, texto: string) => string | null
  readonly ambiguo?: (subtipo: string | null) => boolean
}

const resto = (m: RegExpExecArray): string | null => { const s = (m[1] ?? '').replace(/^[\s\-–]+/, '').trim(); return s === '' ? null : s }

/**
 * ORDEN = PRECEDENCIA. Las reglas más específicas van antes: «DESFOGUE TIPO SIFON» es desfogue y no sifón; «PUENTE DE AFOROS»
 * y «CASETA DE AFORO» son medición y no puente ni edificio; «ENTRADA DE AGUA PUENTE» es entrada de agua y no puente.
 */
const REGLAS: readonly Regla[] = [
  { id: 'entrada_agua', re: /^ENTRADA DE AGUA\b(.*)$/, tipo: 'entrada_agua', subtipo: resto,
    // Vado solo (o vado en margen) es la entrada de agua común; tubos / compuerta / puente / sin dato pueden ser otra obra: ambiguo.
    ambiguo: (s) => s === null || !/^VADO( M\.? ?[DI]\.?)?$/.test(s) },
  { id: 'desfogue', re: /^DESFOGUE\b(.*)$/, tipo: 'desfogue', subtipo: resto },
  { id: 'estacion_aforo', re: /AFORO|AFORADORA/, tipo: 'estacion_aforo', subtipo: (_m, t) => t,
    // «PIE DE AFORO» no es un nombre de obra reconocido (probable «PUENTE DE AFORO»): se clasifica por la raíz AFORO pero se marca.
    ambiguo: (s) => s !== null && /^PIE DE AFORO/.test(s) },
  { id: 'toma_granja', re: /^TOMA GRANJAS?\b(.*)$/, tipo: 'toma_granja', subtipo: resto },
  { id: 'toma', re: /^(?:OBRA DE )?TOMA\b(.*)$/, tipo: 'toma', subtipo: (m, t) => (/^OBRA DE/.test(t) ? 'OBRA DE TOMA' : resto(m)) },
  { id: 'caja_repartidora', re: /^CAJA(?:S)? REPARTIDORA(?:S)?\b(.*)$/, tipo: 'caja_repartidora', subtipo: resto },
  { id: 'represa', re: /^REPRESA\b(.*)$/, tipo: 'represa', subtipo: resto },
  { id: 'puente_vehiculos', re: /^PUENTE(?: DE)? VEHICUL\w*\b(.*)$/, tipo: 'puente_vehiculos', subtipo: resto },
  { id: 'puente_peatones', re: /^(?:PUENTE(?: DE)? PEATON\w*|PASARELA)\b(.*)$/, tipo: 'puente_peatones', subtipo: resto },
  { id: 'puente_canal', re: /^(?:PUENTE CANAL|ACUEDUCTO)\b(.*)$/, tipo: 'puente_canal', subtipo: resto },
  { id: 'paso_superior', re: /^PASO SUPERIOR\b(.*)$/, tipo: 'paso_superior', subtipo: resto },
  { id: 'paso_inferior', re: /^PASO INFERIOR\b(.*)$/, tipo: 'paso_inferior', subtipo: resto },
  // «SIFON K» (una sola obra): la «K» sin más dato no permite saber si es un nombre o un cadenamiento mal capturado.
  { id: 'sifon', re: /^SIFON\b(.*)$/, tipo: 'sifon', subtipo: resto, ambiguo: (s) => s !== null },
  { id: 'alcantarilla', re: /^ALCANTARILLA\b(.*)$/, tipo: 'alcantarilla', subtipo: resto },
  { id: 'caida', re: /^CAIDA\b(.*)$/, tipo: 'caida', subtipo: resto },
  { id: 'rapida', re: /^RAPIDA\b(.*)$/, tipo: 'rapida', subtipo: resto },
  { id: 'muro_retencion', re: /^MURO\b(.*)$/, tipo: 'muro_retencion', subtipo: resto },
  { id: 'edificio', re: /^(?:CASETA|OFICINA|CENTRAL DE MAQUINARIA|ALMACEN|TALLER|BODEGA)S?\b(.*)$/, tipo: 'edificio', subtipo: (_m, t) => t },
]

/** Nombre de IO4/IO7 → tipo, familia y subtipo. Lo que ninguna regla reconoce es `otro` («sin clasificar»): nunca se adivina. */
export function clasificar(nombre: string | null | undefined): Clasificacion {
  const t = normalizarNombre(nombre ?? '')
  for (const r of REGLAS) {
    const m = r.re.exec(t)
    if (!m) continue
    const subtipo = r.subtipo ? r.subtipo(m, t) : null
    return { tipo: r.tipo, familia: INFO_TIPO[r.tipo].familia, subtipo, ambiguo: r.ambiguo ? r.ambiguo(subtipo) : false, regla: r.id }
  }
  return { tipo: 'otro', familia: null, subtipo: t === '' ? null : t, ambiguo: false, regla: 'sin_clasificar' }
}

export const IDS_REGLAS_CLASIFICACION: readonly string[] = REGLAS.map((r) => r.id)

/* ───────────────────────── símbolos ───────────────────────── */

export interface OpcionesSimbolo {
  /** Lado en px (el viewBox es siempre 24 × 24). */
  readonly tamano?: number
  /** Color del contorno; por defecto el de la familia. */
  readonly contorno?: string
  /** Relleno; por defecto el blanco del fondo (`#ffffff`). */
  readonly relleno?: string
  readonly grosor?: number
  /** Contorno punteado = «ubicación estimada» (no declarada en el inventario). */
  readonly punteado?: boolean
  /** Texto accesible; sin él el símbolo es decorativo (aria-hidden). */
  readonly titulo?: string
}

const COLOR_SEGURO = /^(?:#[0-9a-fA-F]{3,8}|currentColor|none|transparent|(?:rgb|hsl)a?\([0-9.,%\s]+\)|[a-zA-Z]{3,20})$/
const color = (c: string | undefined, defecto: string): string => (c !== undefined && COLOR_SEGURO.test(c) ? c : defecto)
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function figura(forma: FormaSimbolo): string {
  switch (forma) {
    case 'triangulo_abajo': return '<polygon points="12,21 3,5 21,5"/>'
    case 'rombo': return '<polygon points="12,2 22,12 12,22 2,12"/>'
    case 'cuadrado': return '<rect x="4" y="4" width="16" height="16"/>'
    case 'circulo': return '<circle cx="12" cy="12" r="9"/>'
    case 'hexagono': return '<polygon points="12,2.5 20.2,7.25 20.2,16.75 12,21.5 3.8,16.75 3.8,7.25"/>'
    case 'cuadrado_base': return '<rect x="5" y="3" width="14" height="14"/><rect x="3" y="19" width="18" height="2"/>'
  }
}

/** Símbolo de una familia como cadena SVG (24 × 24, sin scripts ni estilos externos), para la pantalla y la infografía. */
export function simboloSvg(familia: FamiliaId, o: OpcionesSimbolo = {}): string {
  const f = FAMILIA_POR_ID[familia]
  const lado = o.tamano !== undefined && o.tamano > 0 && o.tamano < 512 ? o.tamano : 24
  const contorno = color(o.contorno, f.color)
  const relleno = color(o.relleno, '#ffffff')
  const grosor = o.grosor !== undefined && o.grosor > 0 && o.grosor < 8 ? o.grosor : 1.6
  const trazo = o.punteado === true ? ' stroke-dasharray="2.6 2"' : ''
  const titulo = o.titulo !== undefined ? `<title>${esc(o.titulo)}</title>` : ''
  const acc = o.titulo !== undefined ? 'role="img"' : 'aria-hidden="true"'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}" viewBox="0 0 24 24" ${acc} focusable="false">${titulo}`
    + `<g fill="${relleno}" stroke="${contorno}" stroke-width="${grosor}" stroke-linejoin="round"${trazo}>${figura(f.forma)}</g></svg>`
}
