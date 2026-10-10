import type { FichaCanal, LibroDerivado, TipoRed, TramoDiagnostico } from '../derivacion/tipos'
import { quitaAcentos } from '../derivacion/vistas'
import { BLOQUE_RED, rotuloSuperficie, superficieDe, unidadDefectoDe } from '../derivacion/conceptos'
import { familia } from './criterio'
import type { CriterioInferido, Familia, GrupoCriterio } from './criterio'
import type { BaseJuicio, PasoRecalculo } from './tipos'
import type { FichaRed, UnionTramo, Uniones } from './uniones'

/**
 * Comprobación tramo por tramo: para UN concepto de UN tramo de DIAG-01 dice con qué datos se llega a la cifra del libro,
 * de dónde sale cada dato (celda), qué parte es una dimensión del canal y qué parte es el parámetro que fija la SRL, y si el
 * tramo sigue el criterio que el libro aplica en la mayoría de sus tramos. Nunca dice "correcto": un tramo que coincide solo
 * es coherente con el resto del libro. La norma no fija una fórmula para esta cantidad (Manual 2026 §5.8, pp. 63-64).
 */

export type EstadoComp = 'cuadra' | 'atipico' | 'no_evaluable'
/** 'inventario': dimensión de la ficha (IO1/IO2/IO3) · 'diagnostico': dato de DIAG-01 · 'parametro_libre': lo fija el PacOT · 'constante': conversión de unidades. */
export type OrigenEntrada = 'inventario' | 'diagnostico' | 'parametro_libre' | 'constante'
export type ModoDiagrama = 'limpia' | 'desazolve' | 'acuaticas' | 'descopete' | 'terracerias' | 'revestimiento'
  | 'camino-conformacion' | 'camino-rastreo' | 'camino-terraceria' | 'camino-revestimiento'

export interface EntradaComp {
  readonly etiqueta: string
  readonly valor: string
  readonly unidad: string
  readonly origen: OrigenEntrada
  /** `hoja!celda`; null en parámetros libres y constantes. */
  readonly ref: string | null
}

/** Pieza de la ecuación: un dato con su origen, o un operador. Permite dibujar la cuenta con cada dato coloreado según de dónde sale. */
export interface TokenEc {
  readonly origen: OrigenEntrada | 'operador'
  /** Decimal como cadena; ausente en operadores. */
  readonly valor?: string
  readonly unidad?: string
  /** Qué es el dato ("ancho por margen"); ausente en operadores. */
  readonly etiqueta?: string
  /** Solo operadores: "×", "÷", "(", ")", "+". */
  readonly simbolo?: string
}

export interface ControlComp {
  readonly id: string
  readonly estado: 'cuadra' | 'atipico' | 'informativo'
  readonly base: BaseJuicio
  readonly titulo: string
  readonly detalle: string
  /** Las dos cifras que el control compara (observada y de referencia), para ordenar y mostrar sin releer el texto. */
  readonly cifras?: { readonly observado: string; readonly referencia: string; readonly unidad: string }
}

export interface DiagramaComp {
  readonly modo: ModoDiagrama
  readonly b: number | null
  readonly z: number | null
  readonly d: number | null
  readonly lb: number | null
  /** true: el inventario dice que el canal está revestido; null: sin dato. */
  readonly revestido: boolean | null
  /** Limpia: ancho tratado por margen (m), desde el hombro hacia afuera. */
  readonly anchoFranja: number | null
  /** Desazolve: espesor de azolve (m). */
  readonly h: number | null
  /** Descopete / revestimiento: la constante del libro con su unidad, para rotular el dibujo. */
  readonly rotulo: string | null
  /** 'canal' (por omisión) o 'camino': la familia de obra decide qué dibujo se hace. Aditivo: el canal no cambia. */
  readonly familia?: 'canal' | 'camino'
  /** Camino: ancho de la carpeta de rodamiento (m) según IO3; null = S/D. */
  readonly ancho?: number | null
  /** Camino: superficie que dice IO3, ya redactada («Revestido», «Terracería»). */
  readonly superficie?: string | null
  /** Camino, solo reposición de revestimiento: espesor de la carpeta (m) que implica el coeficiente. Es una INFERENCIA. */
  readonly espesor?: number | null
}

export interface ParametroLibre {
  readonly nombre: string
  readonly valor: string
  readonly unidad: string
  /** Valor que ese parámetro tiene IMPLÍCITO en la cifra de este tramo (distinto del criterio si el tramo es atípico). */
  readonly implicito: string | null
}

export interface Comprobacion {
  readonly fila: number
  readonly red: TipoRed
  readonly inventario: string
  readonly obra: string
  readonly pkInicial: string
  readonly pkFinal: string
  /** Longitud efectiva del tramo (km); null si DIAG-01 no la trae. */
  readonly longitudKm: number | null
  readonly concepto: string
  readonly familia: Familia
  readonly unidad: string
  readonly modelo: GrupoCriterio['modelo']
  readonly grupo: string
  /** El criterio con sus coeficientes, tal como lo aplica el libro. */
  readonly criterio: string
  readonly entradas: readonly EntradaComp[]
  readonly pasos: readonly PasoRecalculo[]
  /** La cuenta completa con sus datos coloreados por origen (sin el resultado). */
  readonly ecuacion: readonly TokenEc[]
  readonly recalculado: string | null
  readonly enLibro: string | null
  readonly diferencia: string | null
  readonly estadoCriterio: EstadoComp
  /** El peor entre el criterio y los controles. */
  readonly estado: EstadoComp
  readonly parametroLibre: ParametroLibre | null
  readonly diagrama: DiagramaComp | null
  readonly controles: readonly ControlComp[]
  readonly refs: readonly string[]
  /** Solo en `no_evaluable`: por qué no se puede comprobar el tramo. */
  readonly motivo?: string
  /** El modelo lo declara el registro de conceptos (no se infirió comparando tramos). */
  readonly declarado?: boolean
  /** La constante del modelo es una inferencia (el libro no la declara). */
  readonly inferencia?: boolean
}

const redondear = (x: number): string => String(Number(x.toPrecision(10)))
const num = (v: string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v))
const esCanal = (f: FichaRed | null): f is FichaCanal => f !== null && 'plantilla' in f

/** Unidad de trabajo del concepto: la que declara 3DN para ese concepto y red; si no aparece, la del Anexo 3. */
function unidadDe(libro: LibroDerivado, red: TipoRed, nombre: string, fam: Familia): { unidad: string; verificada: boolean } {
  // 3DN no rotula igual que DIAG-01 ("Extracción de plantas terrestres" por "LIMPIA Y DESHIERBE", "Terracerias" por "DESCOPETE BORDOS"):
  // primero el mismo nombre y, si no, el mismo concepto por familia dentro del bloque de la red.
  const delBloque = libro.necesidades.filter((x) => BLOQUE_RED[red].test(x.bloque))
  const mismaFamilia = (x: { concepto: string }): boolean => { const f = familia(x.concepto); return f === fam || (fam === 'descopete' && f === 'terracerias') }
  const n = delBloque.find((x) => quitaAcentos(x.concepto) === quitaAcentos(nombre)) ?? delBloque.find(mismaFamilia)
  const u = n?.unidadTrabajo?.trim()
  const norm = u ? u.replace(/m3/i, 'm³').replace(/m2/i, 'm²').toLowerCase() : ''
  return norm !== '' ? { unidad: norm, verificada: true } : { unidad: unidadDefectoDe(fam, red, nombre), verificada: false }
}

const ZONA_VACIA: Pick<Comprobacion, 'entradas' | 'pasos' | 'ecuacion' | 'recalculado' | 'diferencia' | 'parametroLibre' | 'diagrama' | 'controles' | 'refs'> = {
  entradas: [], pasos: [], ecuacion: [], recalculado: null, diferencia: null, parametroLibre: null, diagrama: null, controles: [], refs: [],
}

interface Contexto {
  readonly libro: LibroDerivado
  readonly u: UnionTramo
  readonly tramo: TramoDiagnostico
  readonly idx: number
  readonly L: number
  readonly X: number
  readonly unidad: string
  /** false: 3DN no declara la unidad de este concepto y se supone la del Anexo 3. Las ramas que dependen de ha o m³ no se usan. */
  readonly unidadVerificada: boolean
  readonly fam: Familia
  readonly g: GrupoCriterio
  /** Nombre real del concepto (3DN en caminos), sin el sufijo «(col. …)». */
  readonly nombre: string
}

interface Cuerpo {
  entradas: EntradaComp[]
  pasos: PasoRecalculo[]
  ecuacion: TokenEc[]
  recalculado: number | null
  parametroLibre: ParametroLibre | null
  diagrama: DiagramaComp | null
  controles: ControlComp[]
}

const op = (simbolo: string): TokenEc => ({ origen: 'operador', simbolo })
const dato = (origen: OrigenEntrada, valor: number | string, etiqueta: string, unidad?: string): TokenEc => ({ origen, valor: typeof valor === 'number' ? redondear(valor) : valor, etiqueta, ...(unidad ? { unidad } : {}) })
const paso = (etiqueta: string, expresion: string, valor: number | null): PasoRecalculo => ({ etiqueta, expresion, valor: valor === null ? null : redondear(valor) })

function datosSeccion(f: FichaRed | null): { b: number | null; z: number | null; d: number | null; lb: number | null; revestido: boolean | null } {
  if (!esCanal(f)) return { b: null, z: null, d: null, lb: null, revestido: null }
  const rev = quitaAcentos(f.revestimiento ?? '')
  return { b: num(f.plantilla.valor), z: num(f.talud.valor), d: num(f.tirante.valor), lb: num(f.libreBordo.valor), revestido: rev === '' ? null : /sin|natural|tierra/.test(rev) ? false : true }
}

const entradaL = (c: Contexto): EntradaComp => ({ etiqueta: 'Longitud efectiva del tramo', valor: redondear(c.L), unidad: 'km', origen: 'diagnostico', ref: c.tramo.km.ref })

function entradasSeccion(c: Contexto, cuales: ReadonlyArray<'b' | 'z' | 'd' | 'lb'>): EntradaComp[] {
  const f = c.u.ficha
  if (!esCanal(f)) return []
  const mapa = {
    b: { etiqueta: 'Ancho de plantilla b', c: f.plantilla, unidad: 'm' },
    z: { etiqueta: 'Talud z (horizontal : vertical)', c: f.talud, unidad: '' },
    d: { etiqueta: 'Tirante normal d', c: f.tirante, unidad: 'm' },
    lb: { etiqueta: 'Libre bordo', c: f.libreBordo, unidad: 'm' },
  } as const
  return cuales.flatMap((k) => (mapa[k].c.valor === null ? [] : [{ etiqueta: mapa[k].etiqueta, valor: redondear(Number(mapa[k].c.valor)), unidad: mapa[k].unidad, origen: 'inventario' as const, ref: mapa[k].c.ref }]))
}

/** Limpia y deshierbe medida por franjas: L × 2 márgenes × ancho / 10 000. El ancho lo fija el PacOT, no la sección. */
function cuerpoLimpiaFranja(c: Contexto, k: number): Cuerpo {
  const w = 5 * k
  const wImp = (5 * c.X) / c.L
  const s = datosSeccion(c.u.ficha)
  const m2 = c.L * 1000 * 2 * w
  return {
    entradas: [
      entradaL(c),
      { etiqueta: 'Ancho tratado por margen, desde el hombro hacia afuera (equivale a 2 márgenes iguales)', valor: redondear(w), unidad: 'm', origen: 'parametro_libre', ref: null },
      { etiqueta: 'Márgenes', valor: '2', unidad: 'izquierda y derecha', origen: 'constante', ref: null },
      { etiqueta: 'Conversión', valor: '10000', unidad: 'm² por ha', origen: 'constante', ref: null },
      ...entradasSeccion(c, ['b', 'z', 'd', 'lb']),
    ],
    pasos: [
      paso('Superficie de una franja', `${redondear(c.L)} km × 1000 × ${redondear(w)} m`, c.L * 1000 * w),
      paso('Superficie de las dos márgenes (m²)', `2 × ${redondear(c.L * 1000 * w)}`, m2),
      paso('Hectáreas', `${redondear(m2)} ÷ 10000`, m2 / 10000),
    ],
    ecuacion: [dato('diagnostico', c.L, 'longitud', 'km'), op('×'), dato('constante', 1000, 'm por km'), op('×'), dato('constante', 2, 'márgenes'), op('×'), dato('parametro_libre', w, 'ancho por margen', 'm'), op('÷'), dato('constante', 10000, 'm² por ha')],
    recalculado: m2 / 10000,
    parametroLibre: { nombre: 'Ancho tratado por margen', valor: redondear(w), unidad: 'm', implicito: redondear(wImp) },
    diagrama: { modo: 'limpia', ...s, anchoFranja: wImp, h: null, rotulo: null },
    controles: [],
  }
}

/** Extracción de plantas acuáticas: L × (fracción de la plantilla) × b / 10 000. La dimensión es la plantilla del inventario. */
function cuerpoAcuaticas(c: Contexto, k: number): Cuerpo | null {
  const s = datosSeccion(c.u.ficha)
  if (s.b === null) return null
  const f = 10 * k
  const fImp = (10 * c.X) / (c.L * s.b)
  const m2 = c.L * 1000 * f * s.b
  return {
    entradas: [
      entradaL(c), ...entradasSeccion(c, ['b']),
      { etiqueta: 'Fracción de la plantilla cubierta', valor: redondear(f), unidad: '(1 = toda la plantilla)', origen: 'parametro_libre', ref: null },
      { etiqueta: 'Conversión', valor: '10000', unidad: 'm² por ha', origen: 'constante', ref: null },
    ],
    pasos: [
      paso('Ancho tratado (m)', `${redondear(f)} × ${redondear(s.b)}`, f * s.b),
      paso('Superficie (m²)', `${redondear(c.L)} km × 1000 × ${redondear(f * s.b)}`, m2),
      paso('Hectáreas', `${redondear(m2)} ÷ 10000`, m2 / 10000),
    ],
    ecuacion: [dato('diagnostico', c.L, 'longitud', 'km'), op('×'), dato('constante', 1000, 'm por km'), op('×'), dato('parametro_libre', f, 'fracción de la plantilla'), op('×'), dato('inventario', s.b, 'plantilla', 'm'), op('÷'), dato('constante', 10000, 'm² por ha')],
    recalculado: m2 / 10000,
    parametroLibre: { nombre: 'Fracción de la plantilla', valor: redondear(f), unidad: '', implicito: redondear(fImp) },
    diagrama: { modo: 'acuaticas', ...s, anchoFranja: null, h: null, rotulo: null },
    controles: [],
  }
}

/** Desazolve: V = 1000 · L · (h·(b + z·h) + c). b y z vienen de la ficha; h y c los fija el PacOT. */
function cuerpoDesazolve(c: Contexto, h: number, cc: number): Cuerpo | null {
  const s = datosSeccion(c.u.ficha)
  if (s.b === null || s.z === null || s.b <= 0 || s.z < 0) return null
  const area = h * (s.b + s.z * h) + cc
  const q = c.X / (1000 * c.L) - cc
  const hCruda = q < 0 ? null : s.z === 0 ? q / s.b : (-s.b + Math.sqrt(s.b * s.b + 4 * s.z * q)) / (2 * s.z)
  const hImp = hCruda !== null && Number.isFinite(hCruda) ? hCruda : null
  return {
    entradas: [
      entradaL(c), ...entradasSeccion(c, ['b', 'z']),
      { etiqueta: 'Espesor de azolve h', valor: redondear(h), unidad: 'm', origen: 'parametro_libre', ref: null },
      ...(cc === 0 ? [] : [{ etiqueta: 'Área adicional c', valor: redondear(cc), unidad: 'm²', origen: 'parametro_libre' as const, ref: null }]),
      { etiqueta: 'Conversión', valor: '1000', unidad: 'm por km', origen: 'constante', ref: null },
    ],
    pasos: [
      paso('Área de azolve en la sección (m²)', `${redondear(h)} × (${redondear(s.b)} + ${redondear(s.z)} × ${redondear(h)})${cc === 0 ? '' : ` + ${redondear(cc)}`}`, area),
      paso('Volumen (m³)', `1000 × ${redondear(c.L)} × ${redondear(area)}`, 1000 * c.L * area),
      paso('Área de azolve implícita en el libro (m²)', `${redondear(c.X)} ÷ (1000 × ${redondear(c.L)})`, c.X / (1000 * c.L)),
    ],
    ecuacion: [dato('constante', 1000, 'm por km'), op('×'), dato('diagnostico', c.L, 'longitud', 'km'), op('×'), op('('), dato('parametro_libre', h, 'espesor de azolve', 'm'), op('×'), op('('), dato('inventario', s.b, 'plantilla', 'm'), op('+'), dato('inventario', s.z, 'talud'), op('×'), dato('parametro_libre', h, 'espesor de azolve', 'm'), op(')'),
      ...(cc === 0 ? [] : [op('+'), dato('parametro_libre', cc, 'área adicional', 'm²')]), op(')')],
    recalculado: 1000 * c.L * area,
    parametroLibre: { nombre: 'Espesor de azolve h', valor: redondear(h), unidad: 'm', implicito: hImp === null ? null : redondear(hImp) },
    diagrama: { modo: 'desazolve', ...s, anchoFranja: null, h: hImp ?? h, rotulo: null },
    controles: [],
  }
}

/** Cantidad proporcional a la longitud (k × L): descopete, reparación de revestimiento y lo que el libro no relaciona con la sección. */
function cuerpoPorLongitud(c: Contexto, k: number): Cuerpo {
  const s = datosSeccion(c.u.ficha)
  const porMetro = k / 1000
  // Terracerías de un dren (2000 m³/km en M5) se dibujan como el material sobre el bordo, igual que el descopete de un canal.
  const modo: ModoDiagrama | null = c.fam === 'descopete' ? 'descopete' : c.fam === 'terracerias' && c.tramo.red === 'drenaje' && esCanal(c.u.ficha) ? 'terracerias' : c.fam === 'revestimiento' && esCanal(c.u.ficha) ? 'revestimiento' : null
  const controles: ControlComp[] = []
  if (c.fam === 'descopete') {
    const desaz = c.libro.conceptosDiagnostico.reduce<number | null>((acc, nombre, i) => {
      if (familia(nombre) !== 'desazolve') return acc
      const v = num(c.tramo.conceptos[i]?.trabajo.valor)
      return v === null ? acc : (acc ?? 0) + v
    }, null)
    if (desaz !== null) {
      const excede = c.X > desaz
      controles.push({
        id: 'descopete-vs-desazolve', base: 'referencia_tecnica', estado: excede ? 'atipico' : 'cuadra',
        cifras: { observado: redondear(c.X), referencia: redondear(desaz), unidad: c.unidad || 'm³' },
        titulo: excede ? 'El descopete excede al desazolve del mismo tramo' : 'El descopete no excede al desazolve del mismo tramo',
        detalle: `Comparación del comprobador, no una regla de la norma. El Anexo 3 (pp. 8-9) y el Manual describen el descopete en drenes como el tendido, sobre el bordo, del material del desazolve; el concepto de rendimiento «Descopete de bordos de canales y/o drenes del material producto de desazolve y excavaciones» (Anexo 5) lo extiende a canales. En este tramo el libro tiene ${redondear(c.X)} m³ de descopete contra ${redondear(desaz)} m³ de desazolve${excede ? `: sobran ${redondear(c.X - desaz)} m³ que tendrían que venir de otra excavación o de un perfil de bordo propio. Candidato a revisión, no error confirmado` : ' (sin descontar esponjamiento)'}.`,
      })
    }
  }
  if (c.fam === 'revestimiento' && esCanal(c.u.ficha) && s.b !== null && s.z !== null && s.d !== null && s.lb !== null && c.unidad === 'm³' && c.unidadVerificada) {
    const perimetro = s.b + 2 * (s.d + s.lb) * Math.sqrt(1 + s.z * s.z)
    const area = c.X / 0.07
    const pct = (100 * area) / (perimetro * c.L * 1000)
    controles.push({
      id: 'revestimiento-equivalencia', base: 'referencia_tecnica', estado: 'informativo',
      titulo: 'Equivalencia aproximada en losa',
      detalle: `Con el espesor de 7 cm del Ejemplo 3 del Manual (§7.7, precio unitario de demolición de losas: es el supuesto de rendimiento de un jornalero, no un dato de este canal ni acredita el daño), ${redondear(c.X)} m³ equivalen a ${redondear(Number(area.toFixed(1)))} m² de losa, cerca del ${redondear(Number(pct.toFixed(2)))} % del revestimiento del tramo (perímetro revestido ${redondear(Number(perimetro.toFixed(2)))} m). Es una reserva por kilómetro, no una medición del daño.`,
    })
  }
  return {
    entradas: [
      entradaL(c),
      { etiqueta: 'Cantidad por kilómetro fijada por el PacOT', valor: redondear(k), unidad: `${c.unidad || 'unidad'}/km`, origen: 'parametro_libre', ref: null },
    ],
    pasos: [
      paso(`Cantidad (${c.unidad || 'unidad'})`, `${redondear(k)} × ${redondear(c.L)}`, k * c.L),
      ...(c.unidad === 'm³' && c.fam === 'descopete' ? [paso('Equivale a (m³ por metro de longitud = m²)', `${redondear(k)} ÷ 1000`, porMetro)] : []),
    ],
    ecuacion: [dato('parametro_libre', k, 'cantidad por km', `${c.unidad || 'unidad'}/km`), op('×'), dato('diagnostico', c.L, 'longitud', 'km')],
    recalculado: k * c.L,
    parametroLibre: { nombre: `Cantidad por kilómetro`, valor: redondear(k), unidad: `${c.unidad || 'unidad'}/km`, implicito: redondear(c.X / c.L) },
    diagrama: modo === null ? null : { modo, ...s, anchoFranja: null, h: null, rotulo: `${redondear(k)} ${c.unidad || ''}/km` },
    controles,
  }
}

/** Superficie de un camino (IO3) como texto («Revestido», «Terracería»); null si la ficha no es de camino o no la dice. */
function superficieTexto(f: FichaRed | null): string | null {
  if (f === null || esCanal(f)) return null
  const s = superficieDe(f.revestimiento)
  return s === 's/d' ? null : rotuloSuperficie(s)
}

/** Dibujo de la sección de calzada: el ancho es la dimensión del inventario (IO3); lo demás es ilustrativo. */
function diagramaCamino(c: Contexto, modo: Extract<ModoDiagrama, `camino-${string}`>, rotulo: string | null, espesor: number | null): DiagramaComp {
  const f = c.u.ficha
  const sup = superficieDe(f !== null && !esCanal(f) ? f.revestimiento : null)
  return {
    familia: 'camino', modo, b: null, z: null, d: null, lb: null, revestido: sup === 'revestido' ? true : sup === 'terraceria' ? false : null,
    anchoFranja: null, h: null, rotulo, ancho: f !== null && !esCanal(f) ? num(f.ancho.valor) : null, superficie: superficieTexto(f), espesor,
  }
}

/** Conformación y rastreo de caminos: pasadas por kilómetro × longitud. La pasada por km es el modelo declarado por el registro (hipótesis), no un dato del libro. */
function cuerpoCaminoPorLongitud(c: Contexto, k: number): Cuerpo {
  const f = c.u.ficha
  const ancho = f !== null && !esCanal(f) ? num(f.ancho.valor) : null
  const modo = /rastreo/.test(quitaAcentos(c.nombre)) ? 'camino-rastreo' : 'camino-conformacion'
  return {
    entradas: [
      entradaL(c),
      { etiqueta: 'Pasadas por kilómetro (modelo declarado: hipótesis, el libro no la rotula)', valor: redondear(k), unidad: 'pasada/km', origen: 'parametro_libre', ref: null },
      ...(f !== null && !esCanal(f) && ancho !== null ? [{ etiqueta: 'Ancho de la calzada (solo para el dibujo)', valor: redondear(ancho), unidad: 'm', origen: 'inventario' as const, ref: f.ancho.ref }] : []),
    ],
    pasos: [paso(`Cantidad (${c.unidad || 'km'})`, `${redondear(k)} × ${redondear(c.L)}`, k * c.L)],
    ecuacion: [dato('parametro_libre', k, 'pasadas por km', 'pasada/km'), op('×'), dato('diagnostico', c.L, 'longitud', 'km')],
    recalculado: k * c.L,
    parametroLibre: { nombre: 'Pasadas por kilómetro', valor: redondear(k), unidad: 'pasada/km', implicito: redondear(c.X / c.L) },
    diagrama: diagramaCamino(c, modo, `${redondear(k)} pasada/km`, null),
    controles: [],
  }
}

/** Reposición de revestimiento de caminos: k × ancho × L, con k declarado por el registro (150 es una inferencia; 0 = sin reposición). */
function cuerpoPorAncho(c: Contexto, k: number): Cuerpo | null {
  const f = c.u.ficha
  const ancho = f !== null && !esCanal(f) ? num(f.ancho.valor) : null
  if (ancho === null || ancho <= 0 || f === null || esCanal(f)) return null
  const inf = c.g.inferencia === true
  return {
    entradas: [entradaL(c), { etiqueta: 'Ancho de la carpeta', valor: redondear(ancho), unidad: 'm', origen: 'inventario', ref: f.ancho.ref },
      { etiqueta: inf ? 'Coeficiente (inferencia: 0.15 m × 1000 m/km; el libro no declara el espesor)' : 'Coeficiente fijado por el PacOT', valor: redondear(k), unidad: `${c.unidad}/(m·km)`, origen: 'parametro_libre', ref: null }],
    pasos: [paso(`Cantidad (${c.unidad})`, `${redondear(k)} × ${redondear(ancho)} × ${redondear(c.L)}`, k * ancho * c.L)],
    ecuacion: [dato('parametro_libre', k, inf ? 'coeficiente (inferencia)' : 'coeficiente'), op('×'), dato('inventario', ancho, 'ancho de la carpeta', 'm'), op('×'), dato('diagnostico', c.L, 'longitud', 'km')],
    recalculado: k * ancho * c.L,
    parametroLibre: { nombre: 'Coeficiente por ancho y kilómetro', valor: redondear(k), unidad: `${c.unidad}/(m·km)`, implicito: redondear(c.X / (ancho * c.L)) },
    diagrama: c.tramo.red === 'caminos' ? diagramaCamino(c, 'camino-revestimiento', k === 0 ? 'sin reposición' : `${redondear(k)} ${c.unidad}/(m·km)`, k === 0 ? null : k / 1000) : null,
    controles: [],
  }
}

function cuerpoLimpiaSeccion(c: Contexto, k0: number, k1: number): Cuerpo | null {
  const s = datosSeccion(c.u.ficha)
  if (s.d === null || s.lb === null || s.z === null) return null
  const sec = (s.d + s.lb) * Math.sqrt(1 + s.z * s.z)
  const v = c.L * (k0 + k1 * sec)
  return {
    entradas: [entradaL(c), ...entradasSeccion(c, ['d', 'lb', 'z']),
      { etiqueta: 'Coeficiente fijo k0', valor: redondear(k0), unidad: `${c.unidad}/km`, origen: 'parametro_libre', ref: null },
      { etiqueta: 'Coeficiente k1 de la longitud inclinada', valor: redondear(k1), unidad: `${c.unidad}/(km·m)`, origen: 'parametro_libre', ref: null }],
    pasos: [paso('Longitud inclinada del talud (m)', `(${redondear(s.d)} + ${redondear(s.lb)}) × √(1 + ${redondear(s.z)}²)`, sec), paso(`Cantidad (${c.unidad})`, `${redondear(c.L)} × (${redondear(k0)} + ${redondear(k1)} × ${redondear(sec)})`, v)],
    ecuacion: [dato('diagnostico', c.L, 'longitud', 'km'), op('×'), op('('), dato('parametro_libre', k0, 'coeficiente fijo'), op('+'), dato('parametro_libre', k1, 'coeficiente por talud'), op('×'), dato('inventario', sec, 'longitud inclinada', 'm'), op(')')],
    recalculado: v, parametroLibre: null,
    // Ancho equivalente por margen: ha/km × 10 000 m²/ha ÷ 1000 m/km = ancho total (m); entre 2 márgenes. El libro no fija una franja.
    diagrama: c.unidad === 'ha' && c.unidadVerificada ? { modo: 'limpia', ...s, anchoFranja: 5 * (k0 + k1 * sec), h: null, rotulo: 'equivalente' } : null,
    controles: [],
  }
}

function construirCuerpo(c: Contexto): Cuerpo | null {
  const co = c.g.coeficientes
  const k = num(co.k), h = num(co.h), cc = num(co.c), k0 = num(co.k0), k1 = num(co.k1)
  if (c.g.modelo === 'azolve' && h !== null && cc !== null) return cuerpoDesazolve(c, h, cc)
  if (c.g.modelo === 'k·b·L' && k !== null) return c.unidad === 'ha' && c.unidadVerificada ? cuerpoAcuaticas(c, k) : null
  if (c.g.modelo === 'k·ancho·L' && k !== null) return cuerpoPorAncho(c, k)
  if (c.g.modelo === 'limpia·sección' && k0 !== null && k1 !== null) return cuerpoLimpiaSeccion(c, k0, k1)
  if (c.g.modelo === 'k·L' && k !== null && c.tramo.red === 'caminos' && c.g.declarado === true) return cuerpoCaminoPorLongitud(c, k)
  if (c.g.modelo === 'k·L' && k !== null) return c.fam === 'limpia' && c.unidad === 'ha' && c.unidadVerificada && (c.tramo.red === 'distribucion' || c.tramo.red === 'drenaje') && esCanal(c.u.ficha) ? cuerpoLimpiaFranja(c, k) : cuerpoPorLongitud(c, k)
  return null
}

/**
 * Comprobación de un concepto de un tramo. null si el tramo no existe o el concepto no tiene criterio evaluado para él
 * (sin ficha de inventario o sin datos).
 */
export function comprobarTramo(libro: LibroDerivado, criterios: readonly CriterioInferido[], uniones: Uniones, fila: number, indiceConcepto: number): Comprobacion | null {
  const u = uniones.uniones.find((x) => x.tramo.fila === fila)
  if (!u) return null
  const tramo = u.tramo
  const crit = criterios.find((c) => c.red === tramo.red && c.indiceConcepto === indiceConcepto)
  const pt = crit?.porTramo[fila]
  if (!crit || !pt) return null
  const g = crit.grupos.find((x) => x.clave === pt.grupo)
  if (!g) return null
  const base = {
    fila, red: tramo.red, inventario: tramo.inventario, obra: tramo.obra, pkInicial: tramo.pkInicial, pkFinal: tramo.pkFinal, longitudKm: num(tramo.km.valor), concepto: crit.concepto,
    modelo: g.modelo, grupo: pt.grupo, criterio: g.formula,
  }
  const fam = familia(crit.nombre)
  const { unidad, verificada: unidadVerificada } = unidadDe(libro, tramo.red, crit.nombre, fam)
  const L = num(tramo.km.valor)
  const celda = tramo.conceptos[indiceConcepto]?.trabajo
  const X = num(celda?.valor)
  const sinCalculo = (motivo: string): Comprobacion => ({
    ...base, ...ZONA_VACIA, familia: fam, unidad, enLibro: X === null ? null : redondear(X), estadoCriterio: 'no_evaluable', estado: 'no_evaluable', motivo,
    ...(g.declarado === true ? { declarado: true } : {}),
  })
  if (g.modelo === null) return sinCalculo(g.motivo ?? 'Ningún criterio explica a la mayoría de los tramos de este grupo.')
  if (L === null || L <= 0 || X === null) return sinCalculo('Faltan la longitud del tramo o la cifra de DIAG-01.')
  const cuerpo = construirCuerpo({ libro, u, tramo, idx: indiceConcepto, L, X, unidad, unidadVerificada, fam, g, nombre: crit.nombre })
  if (!cuerpo || cuerpo.recalculado === null) return sinCalculo(tramo.red === 'caminos' ? 'Faltan datos del inventario (p. ej. el ancho de la carpeta en IO3) para recalcular el tramo.' : 'Faltan datos del inventario o de DIAG-01 para recalcular el tramo.')
  if (g.declarado === true) {
    const sup = superficieTexto(u.ficha)
    if (g.inferencia === true) {
      cuerpo.controles.push({
        id: 'camino-constante-inferida', base: 'criterio_libro', estado: 'informativo', titulo: 'El 150 es una inferencia',
        detalle: `${g.nota ?? ''} El comprobador lo toma como modelo declarado porque al menos 2 tramos del libro lo cumplen; no lo ha confirmado la SRL.`.trim(),
      })
    } else if (g.nota !== undefined) {
      cuerpo.controles.push({
        id: 'camino-modelo-declarado', base: 'criterio_libro', estado: 'informativo', titulo: g.nota.startsWith('terracer') ? g.nota : 'Modelo declarado por el comprobador',
        detalle: `${g.nota.startsWith('terracer') ? `En este PacOT el libro asigna 0 a esta obra${sup ? ` (superficie ${sup} en IO3)` : ''}: no le reserva cantidad. Es lo que hace el libro, no una exigencia de la norma.` : g.nota}`,
      })
    }
  }

  const estadoCriterio: EstadoComp = pt.sigue ? 'cuadra' : 'atipico'
  if (!unidadVerificada) {
    cuerpo.controles.push({
      id: 'unidad-supuesta', base: 'integridad', estado: 'informativo', titulo: 'La unidad de este concepto es supuesta',
      detalle: `3DN no declara la unidad de trabajo de este concepto; se supone ${unidad || 'sin unidad'} (Anexo 3: km como unidad paramétrica y m³ o ha como unidad de trabajo). No se usan interpretaciones que dependen de la unidad.`,
    })
  }
  const peorControl = cuerpo.controles.some((x) => x.estado === 'atipico')
  const refs = [celda?.ref, tramo.km.ref, ...cuerpo.entradas.map((e) => e.ref)].filter((r): r is string => typeof r === 'string' && r !== '')
  return {
    ...base, familia: fam, unidad,
    entradas: cuerpo.entradas, ecuacion: cuerpo.ecuacion,
    pasos: [...cuerpo.pasos, { etiqueta: 'Cantidad en DIAG-01', expresion: celda?.ref ?? '', valor: redondear(X) }],
    recalculado: redondear(cuerpo.recalculado), enLibro: redondear(X), diferencia: redondear(Number((X - cuerpo.recalculado).toFixed(9))),
    estadoCriterio, estado: estadoCriterio === 'atipico' || peorControl ? 'atipico' : 'cuadra',
    parametroLibre: cuerpo.parametroLibre, diagrama: cuerpo.diagrama, controles: cuerpo.controles, refs: [...new Set(refs)],
    ...(g.declarado === true ? { declarado: true } : {}), ...(g.inferencia === true ? { inferencia: true } : {}),
  }
}

export { comprobarObrasPuntuales, bloquesNoAplica } from './porPieza'
export type { ComprobacionPieza } from './porPieza'
