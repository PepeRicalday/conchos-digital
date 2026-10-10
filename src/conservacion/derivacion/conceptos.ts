/**
 * Registro de conceptos de conservación (puro, sin React). Un concepto se declara UNA vez: red/bloque de 3DN, familia de obra,
 * modelos admisibles, política de agrupación, tipo de dibujo y las notas de honestidad que lo acompañan.
 *
 * Lo consultan `familia()`, `MODELOS_DE` (criterio.ts) y `unidadDe`/`BLOQUE_RED` (comprobacion.ts): sus firmas no cambian.
 *
 * Regla de honestidad: una constante que el libro no declara (p. ej. el 150 de la reposición de revestimiento de caminos)
 * se rotula INFERENCIA; un grupo de un solo tramo nunca produce un criterio por comparación: o hay un modelo declarado aquí,
 * respaldado por al menos `evidenciaMin` tramos del libro, o el grupo es «no evaluable» con su motivo.
 */
import type { TipoRed } from './tipos'
import { quitaAcentos } from './vistas'

export type ModeloId = 'k·L' | 'k·b·L' | 'k·ancho·L' | 'azolve' | 'limpia·sección' | 'por-pieza'
export type Familia = 'limpia' | 'desazolve' | 'descopete' | 'terracerias' | 'revestimiento' | 'acuaticas' | 'otro'
/** Familia de OBRA a la que pertenece el concepto (no confundir con `Familia`, que es la del concepto de trabajo). */
export type FamiliaObra = 'canal' | 'dren' | 'camino' | 'estructura' | 'edificio'
export type TipoDibujo = 'seccion-canal' | 'seccion-camino' | 'ficha-estructura' | 'ficha-edificio' | 'ninguno'
/** Qué muestra el dibujo de un camino. */
export type ModoCamino = 'camino-conformacion' | 'camino-rastreo' | 'camino-terraceria' | 'camino-revestimiento'

/** Clasificador por nombre (sin cambios respecto a la versión previa de criterio.ts). */
export function familia(concepto: string): Familia {
  const t = quitaAcentos(concepto)
  if (/desazolve/.test(t)) return 'desazolve'
  if (/acuatic/.test(t)) return 'acuaticas'
  if (/limpia|deshierbe|terrestre/.test(t)) return 'limpia'
  if (/reposici.*revest|revest.*reposici/.test(t)) return 'revestimiento'
  if (/descopete/.test(t)) return 'descopete'
  if (/terracer/.test(t)) return 'terracerias'
  if (/revestim/.test(t)) return 'revestimiento'
  return 'otro'
}

/** Un modelo que el REGISTRO declara (no se infiere por comparación entre tramos). */
export interface CandidatoDeclarado {
  readonly id: string
  readonly modelo: Extract<ModeloId, 'k·L' | 'k·ancho·L'>
  readonly k: number
  /** true: la constante no la declara el libro; se rotula «inferencia». */
  readonly inferencia: boolean
  /** Texto para el usuario. */
  readonly nota: string
  /** Texto específico por superficie normalizada (p. ej. 'terraceria'); sustituye a `nota` en ese grupo. */
  readonly notaPorSuperficie?: Readonly<Record<string, string>>
  /** k = 0: «el libro no asigna cantidad a este grupo». No necesita evidencia de varios tramos. */
  readonly cero?: boolean
}

export interface ModeloDeclarado {
  readonly candidatos: readonly CandidatoDeclarado[]
  /** Tramos del libro (de todo el concepto) que deben seguir un candidato distinto de cero para darlo por respaldado. */
  readonly evidenciaMin: number
  /** Si existe: el concepto no se evalúa (la unidad del libro es dudosa) y este es el encabezado del motivo. */
  readonly unidadSospechosa?: string
}

export type PoliticaAgrupacion =
  | { readonly tipo: 'inferida' }
  | { readonly tipo: 'superficie'; readonly minTramos: number; readonly justificacion: string }

export interface ConceptoDef {
  readonly id: string
  /** Reconoce el nombre (ya sin acentos y en minúsculas). */
  readonly reconoce: RegExp
  readonly redes: readonly TipoRed[]
  /** Bloque de 3DN donde aparece el concepto. */
  readonly bloque3DN: RegExp
  readonly obras: readonly FamiliaObra[]
  readonly familia: Familia
  readonly modelos: readonly ModeloId[]
  readonly unidadDefecto: string
  readonly agrupacion: PoliticaAgrupacion
  readonly declarado?: ModeloDeclarado
  readonly dibujo: TipoDibujo
  readonly modoCamino?: ModoCamino
  readonly notas: readonly string[]
}

export const BLOQUE_RED: Readonly<Record<TipoRed, RegExp>> = {
  distribucion: /^RED DE DISTRIBUCI/i, drenaje: /^RED DE DRENAJE/i, caminos: /^RED DE CAMINOS/i, tuberia: /^RED DE DISTRIBUCI/i, otro: /^$/,
}

const REDES_CANAL: readonly TipoRed[] = ['distribucion', 'tuberia', 'otro']
const INFERIDA: PoliticaAgrupacion = { tipo: 'inferida' }
const SUPERFICIE_CAMINOS: PoliticaAgrupacion = {
  tipo: 'superficie', minTramos: 1,
  justificacion: 'En caminos el inventario (IO3) distingue revestido de terracería y el libro puede tratarlas distinto; con un solo tramo por superficie no se infiere nada por comparación: solo se aplica un modelo declarado aquí.',
}

const NOTA_150 = 'El 150 es una inferencia: equivale a 0.15 m × 1000 m/km, pero el libro no declara un espesor de carpeta. Pendiente de confirmar con la SRL.'
const NOTA_1_PASADA = 'Hipótesis declarada: 1 pasada por kilómetro (1 × L). Se respalda solo si al menos 2 tramos del libro la cumplen.'

/**
 * Orden = prioridad. Para cada (red, nombre) gana el primero que coincide. Los conceptos de canal y dren se resuelven por
 * familia (como antes); los de camino se resuelven por nombre.
 */
export const CONCEPTOS: readonly ConceptoDef[] = [
  // ───── Caminos (nombre real tomado de 3DN; DIAG-01 reutiliza los rótulos de las columnas de canales) ─────
  {
    id: 'camino.conformacion', reconoce: /conformaci/, redes: ['caminos'], bloque3DN: BLOQUE_RED.caminos, obras: ['camino'], familia: 'otro',
    modelos: ['k·L'], unidadDefecto: 'km', agrupacion: SUPERFICIE_CAMINOS, dibujo: 'seccion-camino', modoCamino: 'camino-conformacion',
    declarado: { evidenciaMin: 2, candidatos: [{ id: '1-pasada', modelo: 'k·L', k: 1, inferencia: false, nota: NOTA_1_PASADA }] },
    notas: ['La conformación se mide en km de camino. La superficie de IO3 (revestido o terracería) agrupa los tramos.'],
  },
  {
    id: 'camino.rastreo', reconoce: /rastreo/, redes: ['caminos'], bloque3DN: BLOQUE_RED.caminos, obras: ['camino'], familia: 'otro',
    modelos: ['k·L'], unidadDefecto: 'km', agrupacion: SUPERFICIE_CAMINOS, dibujo: 'seccion-camino', modoCamino: 'camino-rastreo',
    declarado: { evidenciaMin: 2, candidatos: [{ id: '1-pasada', modelo: 'k·L', k: 1, inferencia: false, nota: NOTA_1_PASADA }] },
    notas: ['El rastreo se mide en km de camino. La superficie de IO3 (revestido o terracería) agrupa los tramos.'],
  },
  {
    id: 'camino.terracerias', reconoce: /terracer/, redes: ['caminos'], bloque3DN: BLOQUE_RED.caminos, obras: ['camino'], familia: 'terracerias',
    modelos: ['k·L'], unidadDefecto: 'm³', agrupacion: SUPERFICIE_CAMINOS, dibujo: 'seccion-camino', modoCamino: 'camino-terraceria',
    declarado: { evidenciaMin: 2, candidatos: [], unidadSospechosa: 'unidad sospechosa' },
    notas: ['El vínculo de 3DN (E50) con esta cantidad es externo y no se puede resolver. No se convierte ni se recalcula.'],
  },
  {
    id: 'camino.reposicion-revestimiento', reconoce: /reposici|revest/, redes: ['caminos'], bloque3DN: BLOQUE_RED.caminos, obras: ['camino'], familia: 'revestimiento',
    modelos: ['k·ancho·L', 'k·L'], unidadDefecto: 'm³', agrupacion: SUPERFICIE_CAMINOS, dibujo: 'seccion-camino', modoCamino: 'camino-revestimiento',
    declarado: {
      evidenciaMin: 2,
      candidatos: [
        { id: '150-ancho-L', modelo: 'k·ancho·L', k: 150, inferencia: true, nota: NOTA_150 },
        { id: 'sin-reposicion', modelo: 'k·ancho·L', k: 0, inferencia: false, cero: true, nota: 'El libro no asigna reposición de revestimiento a este grupo.', notaPorSuperficie: { terraceria: 'terracería: no lleva revestimiento' } },
      ],
    },
    notas: [NOTA_150, 'Bermas y cunetas no tienen medidas en el libro (solo renglones de SEG-3 / PO-1): se dibujan como ilustrativas.'],
  },
  {
    id: 'camino.limpia', reconoce: /limpia|deshierbe|terrestre|desmonte/, redes: ['caminos'], bloque3DN: BLOQUE_RED.caminos, obras: ['camino'], familia: 'limpia',
    modelos: ['k·L'], unidadDefecto: 'ha', agrupacion: INFERIDA, dibujo: 'ninguno', notas: ['Sin dibujo: la cantidad depende de la longitud y del criterio del libro.'],
  },
  // ───── Canales, drenes y demás redes (por familia) ─────
  {
    id: 'canal.limpia', reconoce: /limpia|deshierbe|terrestre/, redes: [...REDES_CANAL, 'drenaje'], bloque3DN: BLOQUE_RED.distribucion, obras: ['canal', 'dren'], familia: 'limpia',
    modelos: ['k·L', 'limpia·sección'], unidadDefecto: 'ha', agrupacion: INFERIDA, dibujo: 'seccion-canal',
    notas: ['El ancho tratado por margen lo fija el PacOT; el Manual no lo prescribe.'],
  },
  {
    id: 'canal.desazolve', reconoce: /desazolve/, redes: [...REDES_CANAL, 'drenaje'], bloque3DN: BLOQUE_RED.distribucion, obras: ['canal', 'dren'], familia: 'desazolve',
    modelos: ['azolve', 'k·L'], unidadDefecto: 'm³', agrupacion: INFERIDA, dibujo: 'seccion-canal', notas: ['El espesor de azolve h lo fija el PacOT.'],
  },
  {
    id: 'canal.acuaticas', reconoce: /acuatic/, redes: [...REDES_CANAL, 'drenaje'], bloque3DN: BLOQUE_RED.distribucion, obras: ['canal', 'dren'], familia: 'acuaticas',
    modelos: ['k·b·L', 'k·L'], unidadDefecto: 'ha', agrupacion: INFERIDA, dibujo: 'seccion-canal', notas: ['La dimensión es la plantilla del inventario.'],
  },
  {
    id: 'canal.descopete', reconoce: /descopete/, redes: [...REDES_CANAL, 'drenaje'], bloque3DN: BLOQUE_RED.distribucion, obras: ['canal', 'dren'], familia: 'descopete',
    modelos: ['k·L'], unidadDefecto: 'm³', agrupacion: INFERIDA, dibujo: 'seccion-canal', notas: ['Referencia técnica: el descopete se compara con el desazolve del mismo tramo (Anexo 5).'],
  },
  {
    id: 'canal.revestimiento', reconoce: /revestim/, redes: [...REDES_CANAL, 'drenaje'], bloque3DN: BLOQUE_RED.distribucion, obras: ['canal', 'dren'], familia: 'revestimiento',
    modelos: ['k·L'], unidadDefecto: 'm³', agrupacion: INFERIDA, dibujo: 'seccion-canal', notas: ['Reserva por kilómetro, no una medición del daño.'],
  },
  {
    id: 'canal.terracerias', reconoce: /terracer/, redes: [...REDES_CANAL, 'drenaje'], bloque3DN: BLOQUE_RED.distribucion, obras: ['canal', 'dren'], familia: 'terracerias',
    modelos: ['k·L'], unidadDefecto: 'm³', agrupacion: INFERIDA, dibujo: 'ninguno', notas: ['En canales equivale al descopete de bordos; en drenes es terracería.'],
  },
]

/** Concepto de camino por su nombre real (3DN). undefined si no está registrado: entonces rige el criterio general. */
export function conceptoDeCamino(nombre: string): ConceptoDef | undefined {
  const t = quitaAcentos(nombre)
  return CONCEPTOS.find((c) => c.redes.includes('caminos') && c.reconoce.test(t))
}

/** Definición registrada para una familia en una red (canales, drenes). */
export function conceptoPorFamilia(f: Familia, red: TipoRed): ConceptoDef | undefined {
  return CONCEPTOS.find((c) => c.familia === f && c.redes.includes(red) && !c.redes.includes('caminos'))
}

/** Modelos admisibles (misma lógica que el antiguo MODELOS_DE de criterio.ts). */
export function modelosDe(f: Familia, red: TipoRed, nombre = ''): readonly ModeloId[] {
  if (red === 'caminos') {
    const d = conceptoDeCamino(nombre)
    if (d) return d.modelos
    // Columna de canales reutilizada en DIAG-01 sin concepto propio en caminos: se conserva el comportamiento previo por familia.
    return CONCEPTOS.find((c) => c.familia === f && !c.redes.includes('caminos'))?.modelos ?? ['k·L']
  }
  return conceptoPorFamilia(f, red)?.modelos ?? ['k·L']
}

/** Unidad de trabajo por defecto (Anexo 3) cuando 3DN no la declara. */
export function unidadDefectoDe(f: Familia, red: TipoRed, nombre = ''): string {
  if (red === 'caminos') {
    const d = conceptoDeCamino(nombre)
    if (d) return d.unidadDefecto
  }
  return (conceptoPorFamilia(f, red)?.unidadDefecto) ?? (f === 'otro' ? '' : ({ limpia: 'ha', acuaticas: 'ha', desazolve: 'm³', descopete: 'm³', terracerias: 'm³', revestimiento: 'm³' } as const)[f])
}

/* ───────────────────────────── Superficie de caminos ───────────────────────────── */

export type SuperficieCamino = 'revestido' | 'terraceria' | 'pavimentado' | 's/d'

/** Superficie que dice la ficha de IO3 (revestimiento), sin acentos. Lo que no se reconoce queda tal cual; vacío → 's/d'. */
export function superficieDe(revestimiento: string | null | undefined): string {
  const t = quitaAcentos(revestimiento ?? '').trim()
  if (t === '') return 's/d'
  if (/terracer/.test(t)) return 'terraceria'
  if (/pavim/.test(t)) return 'pavimentado'
  if (/revest/.test(t)) return 'revestido'
  return t
}

const ROTULO_SUPERFICIE: Readonly<Record<string, string>> = { revestido: 'Revestido', terraceria: 'Terracería', pavimentado: 'Pavimentado', 's/d': 'Superficie S/D' }
export const rotuloSuperficie = (s: string): string => ROTULO_SUPERFICIE[s] ?? s.charAt(0).toUpperCase() + s.slice(1)

/* ───────────────────────────── Obras puntuales (modelo `por-pieza`) ───────────────────────────── */

/**
 * Conceptos de PIEZA (estructuras, edificios, comunicaciones…): cantidad = número de piezas × frecuencia × P.U. No hay fórmula por tramo ni
 * veredicto «cuadra/atípico» de criterio: el comprobador reconstruye la cantidad desde el inventario cuando existe uno (IO4, IO7), la compara
 * contra el libro y comprueba la aritmética propia de 3DN. Se declaran aparte de `CONCEPTOS` para no tocar la resolución por red/familia.
 */
export type KindPieza = 'obra-civil' | 'compuertas' | 'edificios' | 'comunicaciones' | 'otras-obras'

export interface ConceptoPiezaDef extends ConceptoDef {
  readonly kind: KindPieza
  /** Nombre canónico para mostrar (el rótulo del libro va en `title`). */
  readonly nombre: string
  /** Hay un inventario de respaldo del que reconstruir la cantidad (IO4 para la obra civil, IO7 para los edificios). */
  readonly reconstruible: boolean
}

const BLOQUE_ESTRUCTURAS = /^ESTRUCTURAS$/i
const pieza = (d: Omit<ConceptoPiezaDef, 'redes' | 'obras' | 'familia' | 'modelos' | 'unidadDefecto' | 'agrupacion' | 'modoCamino' | 'declarado'> & { obras: readonly FamiliaObra[] }): ConceptoPiezaDef =>
  ({ redes: [], familia: 'otro', modelos: ['por-pieza'], unidadDefecto: 'pza', agrupacion: INFERIDA, ...d })

export const CONCEPTOS_PIEZA: readonly ConceptoPiezaDef[] = [
  pieza({
    id: 'pieza.obra-civil', kind: 'obra-civil', nombre: 'Reparación de obra civil', reconoce: /obra civil/, bloque3DN: BLOQUE_ESTRUCTURAS, obras: ['estructura'], dibujo: 'ficha-estructura', reconstruible: true,
    notas: ['La cantidad es el número de estructuras de IO4 (una fila por obra). Se muestra por familia del catálogo; lo ambiguo conserva su subtipo crudo y nada se reclasifica en silencio.'],
  }),
  pieza({
    id: 'pieza.compuertas', kind: 'compuertas', nombre: 'Reparación de compuertas y mecanismos', reconoce: /compuerta/, bloque3DN: BLOQUE_ESTRUCTURAS, obras: ['estructura'], dibujo: 'ficha-estructura', reconstruible: false,
    notas: ['IO4 no dice cuáles estructuras tienen compuerta. El libro declara una proporción de las estructuras: es una proporción declarada, no reconstruible por estructura. Nunca se reparten compuertas entre las estructuras.'],
  }),
  pieza({
    id: 'pieza.edificios', kind: 'edificios', nombre: 'Reparación y mantenimiento de edificios', reconoce: /./, bloque3DN: /^EDIFICIOS$/i, obras: ['edificio'], dibujo: 'ficha-edificio', reconstruible: true,
    notas: ['La cantidad es el número de edificios de IO7 (oficinas, central de maquinaria, casetas).'],
  }),
  pieza({
    id: 'pieza.comunicaciones', kind: 'comunicaciones', nombre: 'Reparación y mantenimiento de la red de comunicación', reconoce: /./, bloque3DN: /^RED DE COMUNICACI/i, obras: ['estructura'], dibujo: 'ninguno', reconstruible: false,
    notas: ['No se lee una hoja de inventario de comunicaciones: la cantidad del libro no es reconstruible aquí.'],
  }),
  pieza({
    id: 'pieza.otras-obras', kind: 'otras-obras', nombre: 'Presas, pozos y plantas de bombeo', reconoce: /./, bloque3DN: /^(PRESAS ALMACENAMIENTO|PRESAS DERIVADORAS|POZOS|PLANTAS DE BOMBEO)$/i, obras: ['estructura'], dibujo: 'ninguno', reconstruible: false,
    notas: ['No se lee un inventario de respaldo para estas obras: la cantidad del libro no es reconstruible aquí.'],
  }),
]

/** Concepto de pieza por el bloque de 3DN (sin acentos, mayúsculas) y el rótulo del concepto. undefined si el bloque no es de obras puntuales. */
export function conceptoPiezaDe(bloque: string, concepto: string): ConceptoPiezaDef | undefined {
  const b = quitaAcentos(bloque).trim()
  const c = quitaAcentos(concepto)
  return CONCEPTOS_PIEZA.find((d) => d.bloque3DN.test(b) && d.reconoce.test(c) && (d.kind !== 'obra-civil' || !/compuerta/.test(c)))
}
