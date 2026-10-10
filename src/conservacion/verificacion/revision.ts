/**
 * Centro de revisión (puro, sin React): junta los atípicos de TODOS los PacOT cargados, AGRUPADOS POR TRAMO.
 * Un tramo puede ser atípico por más de una razón (p. ej. desazolve se aparta del criterio del libro Y el descopete excede
 * al desazolve del mismo tramo): aparece UNA vez con todas sus razones. Nada se recalcula aquí: las razones salen de
 * `comprobarTramo` (criterio y controles adicionales) y de la verificación (conciliaciones atadas a un tramo). «Atípico» es
 * candidato a revisión, nunca error confirmado.
 */
import type { LibroDerivado, TipoRed } from '../derivacion/tipos'
import { nombreConcepto, razonAtipicoDeId, type RazonAtipico } from '../vocabulario'
import { comprobarTramo, type Comprobacion, type ControlComp } from './comprobacion'
import { comprobarObrasPuntuales } from './porPieza'
import type { ResultadoVerif, VerificacionLibro } from './tipos'
import { verificarLibroCacheado } from './verificar'

/** Lo mínimo para abrir la comprobación por tramo ya posicionada. */
export interface DestinoTramo {
  /** «SRL» o «M5». */
  readonly ambito: string
  readonly red: TipoRed
  readonly indiceConcepto: number
  readonly fila: number
}

export interface RazonTramo {
  readonly razon: RazonAtipico
  /** null solo en conciliaciones, que no hablan de un concepto. */
  readonly indiceConcepto: number | null
  /** Rótulo del libro del concepto (va en `title`). */
  readonly rotuloConcepto: string | null
  readonly concepto: string | null
  readonly titulo: string
  /** Cifra en el libro / cifra de referencia, ya redactadas. */
  readonly enLibro: string | null
  readonly referencia: string | null
  /** Qué es cada cifra: [la que trae el libro, la de referencia]. */
  readonly etiquetas: readonly [string, string]
  readonly unidad: string
  readonly relativa: number | null
  readonly absoluta: number | null
  /** Id interno del control o resultado que la origina. */
  readonly id: string
}

export interface AtipicoTramo {
  readonly clave: string
  readonly ambito: string
  readonly red: TipoRed
  readonly fila: number
  readonly inventario: string
  readonly obra: string
  readonly pkInicial: string
  readonly pkFinal: string
  /** Primero la razón más fuerte. */
  readonly razones: readonly RazonTramo[]
  /** Destino de «Abrir tramo»: el concepto de la primera razón con concepto; null si el tramo no tiene cálculo comprobable. */
  readonly destino: DestinoTramo | null
  readonly relativaMax: number
  readonly absolutaMax: number
}

export interface FiltroRevision {
  readonly ambito?: string
  readonly red?: TipoRed | ''
  /** Nombre canónico del concepto. */
  readonly concepto?: string
  readonly razon?: RazonAtipico | ''
}

const num = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Rango de las razones: criterio (la cuenta del libro se aparta de su propia regla) pesa más que un control de referencia. */
const PESO_RAZON: Readonly<Record<RazonAtipico, number>> = { criterio: 0, conciliacion: 1, regla: 2, control_adicional: 3 }

const comparaRazon = (a: RazonTramo, b: RazonTramo): number =>
  PESO_RAZON[a.razon] - PESO_RAZON[b.razon] || (b.relativa ?? -1) - (a.relativa ?? -1)

const etiquetasDeControl = (k: ControlComp): readonly [string, string] =>
  k.id === 'descopete-vs-desazolve' ? ['Descopete', 'Desazolve del tramo'] : ['Observado', 'Referencia']

const CACHE = new WeakMap<LibroDerivado, Map<string, AtipicoTramo[]>>()

/** Atípicos de un PacOT, agrupados por tramo y ya ordenados. `ambito` es la sigla («SRL», «M5»). El libro es inmutable: se calcula una vez. */
export function atipicosDelLibro(libro: LibroDerivado, ambito: string, verificacion?: VerificacionLibro): AtipicoTramo[] {
  const porAmbito = CACHE.get(libro) ?? new Map<string, AtipicoTramo[]>()
  const previa = porAmbito.get(ambito)
  if (previa) return previa
  const calculada = calcularAtipicos(libro, ambito, verificacion ?? verificarLibroCacheado(libro))
  porAmbito.set(ambito, calculada)
  CACHE.set(libro, porAmbito)
  return calculada
}

function calcularAtipicos(libro: LibroDerivado, ambito: string, verificacion: VerificacionLibro): AtipicoTramo[] {
  const { criterios, uniones, resultados } = verificacion
  const porTramo = new Map<string, { red: TipoRed; fila: number; razones: RazonTramo[] }>()
  const meter = (red: TipoRed, fila: number, r: RazonTramo) => {
    const k = `${ambito}|${red}|${fila}`
    const e = porTramo.get(k) ?? { red, fila, razones: [] }
    e.razones.push(r)
    porTramo.set(k, e)
  }

  for (const crit of criterios) {
    const canon = nombreConcepto(crit.concepto, { red: crit.red }).canonico
    for (const filaTxt of Object.keys(crit.porTramo)) {
      const fila = Number(filaTxt)
      const c = comprobarTramo(libro, criterios, uniones, fila, crit.indiceConcepto)
      if (!c || c.estado !== 'atipico') continue
      const base = { indiceConcepto: crit.indiceConcepto, rotuloConcepto: crit.concepto, concepto: canon, unidad: c.unidad }
      if (c.estadoCriterio === 'atipico') {
        const dif = num(c.diferencia), ref = num(c.recalculado)
        meter(crit.red, fila, {
          ...base, razon: 'criterio', titulo: 'Se aparta del criterio que el libro aplica a sus demás tramos',
          enLibro: c.enLibro, referencia: c.recalculado, etiquetas: ['En el libro', 'Según el criterio'], relativa: dif !== null && ref !== null && ref !== 0 ? Math.abs(dif / ref) : null,
          absoluta: dif === null ? null : Math.abs(dif), id: `CRI-02:${fila}:${crit.concepto}`,
        })
      }
      for (const k of c.controles) {
        if (k.estado !== 'atipico') continue
        const obs = num(k.cifras?.observado), ref = num(k.cifras?.referencia)
        meter(crit.red, fila, {
          ...base, razon: razonAtipicoDeId(k.id), titulo: k.titulo,
          enLibro: k.cifras?.observado ?? null, referencia: k.cifras?.referencia ?? null, etiquetas: etiquetasDeControl(k), unidad: k.cifras?.unidad ?? c.unidad,
          relativa: obs !== null && ref !== null && ref !== 0 ? Math.abs((obs - ref) / ref) : null,
          absoluta: obs !== null && ref !== null ? Math.abs(obs - ref) : null, id: `${k.id}:${fila}:${crit.concepto}`,
        })
      }
    }
  }

  // Conciliaciones que sí hablan de un tramo (las de tipo de estructura son de todo el PacOT y no tienen tramo).
  for (const r of resultados) {
    if (r.estado !== 'atipico' || r.tramoFila === null || razonAtipicoDeId(r.id) !== 'conciliacion') continue
    const u = uniones.uniones.find((x) => x.tramo.fila === r.tramoFila)
    if (!u) continue
    const obs = num(r.observado), esp = num(r.esperado)
    meter(u.tramo.red, r.tramoFila, {
      razon: 'conciliacion', indiceConcepto: null, rotuloConcepto: null, concepto: null, titulo: r.titulo,
      enLibro: r.observado, referencia: r.esperado, etiquetas: ['Contado', 'Declarado'], unidad: '',
      relativa: obs !== null && esp !== null && esp !== 0 ? Math.abs((obs - esp) / esp) : null,
      absoluta: obs !== null && esp !== null ? Math.abs(obs - esp) : null, id: r.id,
    })
  }

  const salida: AtipicoTramo[] = []
  for (const [clave, e] of porTramo) {
    const u = uniones.uniones.find((x) => x.tramo.fila === e.fila)
    if (!u) continue
    const razones = [...e.razones].sort(comparaRazon)
    const conConcepto = razones.find((r) => r.indiceConcepto !== null)
    const indice = conConcepto?.indiceConcepto ?? primerConceptoComprobable(verificacion, e.red, e.fila)
    salida.push({
      clave, ambito, red: e.red, fila: e.fila, inventario: u.tramo.inventario, obra: u.tramo.obra, pkInicial: u.tramo.pkInicial, pkFinal: u.tramo.pkFinal,
      razones, destino: indice === null ? null : { ambito, red: e.red, indiceConcepto: indice, fila: e.fila },
      relativaMax: Math.max(-1, ...razones.map((r) => r.relativa ?? -1)), absolutaMax: Math.max(-1, ...razones.map((r) => r.absoluta ?? -1)),
    })
  }
  return ordenarAtipicos(salida)
}

/** Primer concepto de esa red que tiene cálculo para ese tramo (para tramos solo con conciliación). */
export function primerConceptoComprobable(v: VerificacionLibro, red: TipoRed, fila: number): number | null {
  const c = v.criterios.find((x) => x.red === red && x.porTramo[fila] !== undefined)
  return c?.indiceConcepto ?? null
}

/**
 * Orden: más razones primero (dos razones distintas se corroboran entre sí), luego la mayor diferencia relativa, luego
 * la mayor diferencia absoluta y, a igualdad, PacOT, red y fila (estable y legible).
 */
export function ordenarAtipicos(lista: readonly AtipicoTramo[]): AtipicoTramo[] {
  return [...lista].sort((a, b) =>
    b.razones.length - a.razones.length || b.relativaMax - a.relativaMax || b.absolutaMax - a.absolutaMax
    || a.ambito.localeCompare(b.ambito, 'es') || a.red.localeCompare(b.red) || a.fila - b.fila)
}

/** Aplica los filtros a las razones; un tramo sin ninguna razón que cumpla desaparece. Conserva el orden. */
export function filtrarAtipicos(lista: readonly AtipicoTramo[], f: FiltroRevision): AtipicoTramo[] {
  const out: AtipicoTramo[] = []
  for (const t of lista) {
    if (f.ambito && t.ambito !== f.ambito) continue
    if (f.red && t.red !== f.red) continue
    const razones = t.razones.filter((r) => (!f.razon || r.razon === f.razon) && (!f.concepto || r.concepto === f.concepto))
    if (razones.length === 0) continue
    if (razones.length === t.razones.length) { out.push(t); continue }
    const conConcepto = razones.find((r) => r.indiceConcepto !== null)
    out.push({
      ...t, razones,
      destino: conConcepto?.indiceConcepto != null ? { ambito: t.ambito, red: t.red, indiceConcepto: conConcepto.indiceConcepto, fila: t.fila } : t.destino,
      relativaMax: Math.max(-1, ...razones.map((r) => r.relativa ?? -1)), absolutaMax: Math.max(-1, ...razones.map((r) => r.absoluta ?? -1)),
    })
  }
  return ordenarAtipicos(out)
}

export function contarRazones(lista: readonly AtipicoTramo[]): number {
  return lista.reduce((n, t) => n + t.razones.length, 0)
}

/** Valores únicos para los filtros, con el contador de tramos de cada uno. */
export function opcionesDeFiltro(lista: readonly AtipicoTramo[]): {
  ambitos: string[]; redes: TipoRed[]; conceptos: string[]; razones: RazonAtipico[]
} {
  const u = <T,>(xs: Iterable<T>): T[] => [...new Set(xs)]
  const todas = lista.flatMap((t) => t.razones)
  return {
    ambitos: u(lista.map((t) => t.ambito)),
    redes: u(lista.map((t) => t.red)),
    conceptos: u(todas.map((r) => r.concepto).filter((c): c is string => c !== null)),
    razones: u(todas.map((r) => r.razon)),
  }
}

/**
 * Qué se debe abrir para un tramo conocido solo por su fila (enlace desde un hallazgo): el concepto en el que el tramo es
 * atípico si lo hay; si no, el primero con cálculo. null si el tramo no existe o no tiene cálculo por tramo.
 */
export function destinoDeFila(libro: LibroDerivado, ambito: string, fila: number): DestinoTramo | null {
  const v = verificarLibroCacheado(libro)
  const u = v.uniones.uniones.find((x) => x.tramo.fila === fila)
  if (!u) return null
  const atip = atipicosDelLibro(libro, ambito, v).find((t) => t.fila === fila)
  if (atip?.destino) return atip.destino
  const indice = primerConceptoComprobable(v, u.tramo.red, fila)
  return indice === null ? null : { ambito, red: u.tramo.red, indiceConcepto: indice, fila }
}

/** Diferencias de conteo IO4/IO1 que son de todo el PacOT y no de un tramo (no tienen «Abrir tramo»). */
export function conciliacionesSinTramo(libro: LibroDerivado): number {
  return verificarLibroCacheado(libro).resultados.filter((r) => r.estado === 'atipico' && r.tramoFila === null && razonAtipicoDeId(r.id) === 'conciliacion').length
}

/** Destino para abrir el tramo de un resultado de la verificación: su propio concepto si lo tiene; si no, el primero con cálculo. */
export function destinoDeResultado(libro: LibroDerivado, ambito: string, r: ResultadoVerif): DestinoTramo | null {
  const fila = r.tramoFila
  if (fila === null) return null
  const v = verificarLibroCacheado(libro)
  const u = v.uniones.uniones.find((x) => x.tramo.fila === fila)
  if (!u) return null
  const red = u.tramo.red
  const propio = r.concepto === null ? undefined : v.criterios.find((c) => c.red === red && c.concepto === r.concepto && c.porTramo[fila] !== undefined)
  const indice = propio?.indiceConcepto ?? primerConceptoComprobable(v, red, fila)
  return indice === null ? null : { ambito, red, indiceConcepto: indice, fila }
}

/** Primer tramo que conviene abrir de un concepto: un atípico si lo hay; si no, el primero con cálculo. null si el concepto no tiene tramos evaluados. */
export function destinoDeConcepto(libro: LibroDerivado, ambito: string, red: TipoRed, indiceConcepto: number): DestinoTramo | null {
  const v = verificarLibroCacheado(libro)
  const crit = v.criterios.find((c) => c.red === red && c.indiceConcepto === indiceConcepto)
  if (!crit) return null
  const atip = atipicosDelLibro(libro, ambito, v).filter((t) => t.red === red && t.razones.some((r) => r.indiceConcepto === indiceConcepto)).sort((a, b) => a.fila - b.fila)[0]
  const fila = atip?.fila ?? Object.keys(crit.porTramo).map(Number).sort((a, b) => a - b)[0]
  return fila === undefined ? null : { ambito, red, indiceConcepto, fila }
}

/**
 * El estado de una comprobación CON SU RAZÓN: el criterio del libro y los controles adicionales se dicen por separado, de modo que
 * «coherente con el criterio» y «atípico por un control» no aparezcan juntos sin explicación.
 */
export interface EstadoConRazon {
  readonly criterio: Comprobacion['estadoCriterio']
  /** Controles adicionales que marcan el tramo como atípico. */
  readonly controlesAtipicos: readonly ControlComp[]
  /** 'ninguno': el concepto no trae controles; 'informativo': solo notas; 'coherente' / 'atipico'. */
  readonly controles: 'ninguno' | 'informativo' | 'coherente' | 'atipico'
  /** Frase corta para la barra de contexto. */
  readonly texto: string
  /** Una línea que dice cuál control marca el tramo y por qué (solo si hay un control atípico). */
  readonly lineaControl: string | null
}

export function estadoConRazon(c: Comprobacion): EstadoConRazon {
  const atipicos = c.controles.filter((k) => k.estado === 'atipico')
  const controles: EstadoConRazon['controles'] = c.controles.length === 0 ? 'ninguno'
    : atipicos.length > 0 ? 'atipico' : c.controles.some((k) => k.estado === 'cuadra') ? 'coherente' : 'informativo'
  const porCriterio = c.estadoCriterio === 'atipico'
  const texto = c.estado === 'no_evaluable' ? 'no evaluable'
    : porCriterio && atipicos.length > 0 ? 'atípico por criterio y por control adicional'
      : porCriterio ? 'atípico por criterio'
        : atipicos.length > 0 ? 'atípico por control adicional' : 'coherente con el criterio del libro'
  const k = atipicos[0]
  const lineaControl = k === undefined ? null
    : k.cifras ? `${k.titulo}: ${k.cifras.observado} ${k.cifras.unidad} contra ${k.cifras.referencia} ${k.cifras.unidad}.` : `${k.titulo}.`
  return { criterio: c.estadoCriterio, controlesAtipicos: atipicos, controles, texto, lineaControl }
}

export type EnlaceHallazgo =
  | { readonly tipo: 'tramo'; readonly destino: DestinoTramo }
  | { readonly tipo: 'concepto'; readonly bloque: string; readonly concepto: string }

/**
 * Qué abre un hallazgo cuya celda es `hoja!fila`: un tramo de DIAG-01 (la propia fila, o el tramo que usa esa ficha de IO1, IO2 o IO3)
 * o el concepto de 3DN en la cadena de cálculo. null si esa fila no corresponde a nada con cálculo en este libro.
 */
export function resolverReferencia(libro: LibroDerivado, ambito: string, hoja: string, fila: number): EnlaceHallazgo | null {
  if (hoja === 'DIAG-01') { const d = destinoDeFila(libro, ambito, fila); return d ? { tipo: 'tramo', destino: d } : null }
  if (hoja === '3DN') {
    const n = libro.necesidades.find((x) => x.fila === fila)
    return n ? { tipo: 'concepto', bloque: n.bloque, concepto: n.concepto } : null
  }
  const fichas = hoja === 'IO1' ? libro.fichas.canales : hoja === 'IO2' ? libro.fichas.drenes : hoja === 'IO3' ? libro.fichas.caminos : null
  const ficha = fichas?.find((f) => f.fila === fila)
  if (!ficha) return null
  const v = verificarLibroCacheado(libro)
  const filas = v.uniones.uniones.filter((u) => u.ficha === ficha || (u.ficha !== null && u.ficha.fila === ficha.fila && u.ficha.inventario === ficha.inventario)).map((u) => u.tramo.fila).sort((a, b) => a - b)
  const atip = atipicosDelLibro(libro, ambito, v).find((t) => filas.includes(t.fila) && t.destino !== null)
  if (atip?.destino) return { tipo: 'tramo', destino: atip.destino }
  for (const f of filas) { const d = destinoDeFila(libro, ambito, f); if (d) return { tipo: 'tramo', destino: d } }
  return null
}

/* ───────────────────────── Obras puntuales (modelo por-pieza) ───────────────────────── */

/** Lo mínimo para abrir la comprobación de obras puntuales ya posicionada en un concepto. */
export interface DestinoPieza {
  readonly ambito: string
  /** Id del concepto de pieza (`pieza:<fila de 3DN>`). */
  readonly conceptoId: string
}

export interface RazonPieza {
  readonly id: string
  readonly razon: RazonAtipico
  readonly titulo: string
  readonly enLibro: string | null
  readonly referencia: string | null
  readonly etiquetas: readonly [string, string]
  readonly unidad: string
  readonly relativa: number | null
}

export interface AtipicoPieza {
  readonly clave: string
  readonly ambito: string
  readonly conceptoId: string
  readonly fila: number
  readonly nombre: string
  readonly rotuloConcepto: string
  readonly razones: readonly RazonPieza[]
  readonly destino: DestinoPieza
  readonly relativaMax: number
}

/**
 * Conceptos de obras puntuales atípicos de un PacOT: solo los que de verdad difieren (la cantidad contra el inventario o una cuenta
 * aritmética propia del libro). Un concepto que coincide o que no es evaluable NO aparece: no hay falsos positivos.
 */
export function atipicosPorPieza(libro: LibroDerivado, ambito: string): AtipicoPieza[] {
  const out: AtipicoPieza[] = []
  for (const c of comprobarObrasPuntuales(libro)) {
    if (c.estado !== 'atipico') continue
    const razones: RazonPieza[] = c.controles.filter((k) => k.estado === 'atipico').map((k) => {
      const obs = num(k.cifras?.observado), ref = num(k.cifras?.referencia)
      return {
        id: `${k.id}:${c.fila}`, razon: k.id === 'pieza-cantidad-inventario' ? 'conciliacion' as const : 'control_adicional' as const, titulo: k.titulo,
        enLibro: k.cifras?.observado ?? null, referencia: k.cifras?.referencia ?? null,
        etiquetas: (k.id === 'pieza-cantidad-inventario' ? ['En el libro', 'En el inventario'] : ['En el libro', 'Recalculado']) as readonly [string, string],
        unidad: k.cifras?.unidad ?? c.unidad, relativa: obs !== null && ref !== null && ref !== 0 ? Math.abs((obs - ref) / ref) : null,
      }
    })
    if (razones.length === 0) continue
    out.push({
      clave: `${ambito}|${c.id}`, ambito, conceptoId: c.id, fila: c.fila, nombre: c.nombre, rotuloConcepto: c.concepto, razones,
      destino: { ambito, conceptoId: c.id }, relativaMax: Math.max(-1, ...razones.map((r) => r.relativa ?? -1)),
    })
  }
  return out.sort((a, b) => b.razones.length - a.razones.length || b.relativaMax - a.relativaMax || a.fila - b.fila)
}
