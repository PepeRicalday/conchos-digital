import { dec } from '../nucleo/num/decimal'
import type { Dec } from '../nucleo/num/decimal'
import type { Cifra, FichaCanal, FilaTotalesDiagnostico, LibroDerivado, TipoRed } from '../derivacion/tipos'
import { ROTULO_RED, quitaAcentos } from '../derivacion/vistas'
import { conceptoDeCamino, familia, modelosDe, rotuloSuperficie, superficieDe } from '../derivacion/conceptos'
import type { CandidatoDeclarado, ConceptoDef, Familia, ModeloId } from '../derivacion/conceptos'
import { PARAMETROS_VERIF } from './parametros'
import type { PasoRecalculo, ResultadoVerif } from './tipos'
import type { FichaRed, UnionTramo, Uniones } from './uniones'

/**
 * Nivel 2 · Criterio del libro (base `criterio_libro`). La norma no da fórmula para la cantidad por tramo: cada libro
 * aplica la suya. Aquí se RECUPERA ese criterio (el que explica a la mayoría de los tramos) y se marcan los tramos que no
 * lo siguen. Un "atípico" es un candidato a revisión, no un error confirmado: puede ser un caso particular legítimo.
 * La estadística usa coma flotante; las cifras que se muestran se recalculan con Decimal.
 */

export { familia }
export type { Familia, ModeloId }
export type Agrupacion = 'ninguna' | 'superficie' | 'gasto' | 'categoria+gasto' | 'revestimiento' | 'revestimiento_diag' | 'categoria' | 'categoria+revestimiento' | 'categoria+revestimiento_diag'

export interface GrupoCriterio {
  readonly clave: string
  readonly n: number
  /** null: ningún modelo explica a la cobertura mínima de tramos del grupo. */
  readonly modelo: ModeloId | null
  /** El criterio con sus coeficientes, legible: "4 500 × L (m³)". */
  readonly formula: string
  readonly coeficientes: Readonly<Record<string, string>>
  readonly siguen: number
  /** Solo si `modelo` es null: por qué el grupo no se evalúa (muestra insuficiente, unidad sospechosa…). */
  readonly motivo?: string
  /** El modelo lo declara el registro de conceptos (no se infirió por comparación). */
  readonly declarado?: boolean
  /** Constante del modelo que es una inferencia (el libro no la declara), p. ej. el 150 de la reposición de revestimiento. */
  readonly inferencia?: boolean
  /** Nota de honestidad del modelo declarado, ya redactada para el grupo. */
  readonly nota?: string
}

export interface CriterioInferido {
  readonly red: TipoRed
  readonly concepto: string
  readonly agrupacion: Agrupacion
  readonly grupos: readonly GrupoCriterio[]
  readonly siguen: number
  /** Tramos con ficha y datos para recalcular. */
  readonly total: number
  /** Tramos del concepto que no se pudieron recalcular (sin ficha o sin datos). */
  readonly sinDatos: number
  /** Para cada fila de DIAG-01 evaluada: el grupo de criterio que le toca y si lo sigue. Permite comprobar tramo por tramo. */
  readonly porTramo: Readonly<Record<number, { readonly grupo: string; readonly sigue: boolean }>>
  /** Rótulo de columna de DIAG-01 de este concepto (en caminos `concepto` trae el nombre real tomado de 3DN). */
  readonly indiceConcepto: number
  /** Nombre real del concepto, sin el sufijo "(col. …)". */
  readonly nombre: string
}

interface Obs {
  readonly u: UnionTramo
  readonly conceptoIdx: number
  readonly L: number
  readonly X: number
  readonly b: number | null
  readonly z: number | null
  readonly d: number | null
  readonly lb: number | null
  readonly ancho: number | null
  readonly gasto: number | null
  readonly categoria: string
  /** Tipo de revestimiento que dice la ficha de inventario. */
  readonly revestimiento: string
  /** Superficie del camino según IO3 ('revestido', 'terraceria', …); 's/d' en canales y drenes. */
  readonly superficie: string
  /** Si el propio DIAG-01 trata el tramo como revestido (paramétrica de reparación de revestimiento > 0). Puede contradecir al inventario. */
  readonly revDiag: string
}

const num = (c: Cifra): number | null => (c.valor === null ? null : Number(c.valor))
const esCanal = (f: FichaRed): f is FichaCanal => 'plantilla' in f

function construirObs(u: UnionTramo, idx: number, idxRev: number): Obs | null {
  const f = u.ficha
  if (!f) return null
  const L = num(u.tramo.km)
  const X = num(u.tramo.conceptos[idx]?.trabajo ?? { valor: null, ref: '', formula: null, origen: 'vacio' })
  if (L === null || L <= 0 || X === null) return null
  const canal = esCanal(f)
  return {
    u, conceptoIdx: idx, L, X,
    b: canal ? num(f.plantilla) : null, z: canal ? num(f.talud) : null, d: canal ? num(f.tirante) : null, lb: canal ? num(f.libreBordo) : null,
    ancho: canal ? null : num(f.ancho),
    gasto: canal ? num(f.gasto) : null,
    categoria: canal ? (f.categoria ?? 's/d') : 'camino',
    revestimiento: quitaAcentos(f.revestimiento ?? 's/d'),
    superficie: canal ? 's/d' : superficieDe(f.revestimiento),
    revDiag: idxRev < 0 ? 's/d' : (() => { const p = num(u.tramo.conceptos[idxRev]?.parametrica ?? { valor: null, ref: '', formula: null, origen: 'vacio' }); return p === null ? 's/d' : p > 0 ? 'revestido' : 'sin revestir' })(),
  }
}

/* ---------- modelos: cada uno entrega, para un conjunto de observaciones, su mejor explicación ---------- */

interface Ajuste {
  readonly modelo: ModeloId
  /** Predice la cantidad de una observación; null si faltan datos. */
  readonly predecir: (o: Obs) => number | null
  readonly coeficientes: Readonly<Record<string, string>>
  readonly formula: string
}

const redondear = (x: number): string => String(Number(x.toPrecision(10)))

/** Agrupa valores casi iguales (tolerancia relativa) y devuelve el centro del grupo más numeroso. */
function modal(valores: readonly number[], tolRel: number): { centro: number; cuenta: number } | null {
  let mejor: { centro: number; cuenta: number } | null = null
  for (const v of valores) {
    const cuenta = valores.filter((w) => Math.abs(w - v) <= tolRel * Math.max(Math.abs(v), 1e-9) + 1e-12).length
    if (!mejor || cuenta > mejor.cuenta || (cuenta === mejor.cuenta && Math.abs(v) < Math.abs(mejor.centro))) mejor = { centro: v, cuenta }
  }
  return mejor
}

const TOL = PARAMETROS_VERIF.tolCriterioRel

function ajustar(modelo: ModeloId, obs: readonly Obs[], concepto: string): Ajuste | null {
  if (modelo === 'k·L' || modelo === 'k·b·L' || modelo === 'k·ancho·L') {
    const base = (o: Obs): number | null =>
      modelo === 'k·L' ? o.L : modelo === 'k·b·L' ? (o.b !== null && o.b > 0 ? o.b * o.L : null) : o.ancho !== null && o.ancho > 0 ? o.ancho * o.L : null
    const razones = obs.map((o) => { const bs = base(o); return bs === null ? null : o.X / bs }).filter((r): r is number => r !== null)
    if (razones.length === 0) return null
    const m = modal(razones, TOL)
    if (!m) return null
    const k = m.centro
    const un = modelo === 'k·L' ? 'L' : modelo === 'k·b·L' ? 'b × L' : 'ancho × L'
    return { modelo, coeficientes: { k: redondear(k) }, formula: `${redondear(k)} × ${un}`, predecir: (o) => { const bs = base(o); return bs === null ? null : k * bs } }
  }
  if (modelo === 'azolve') {
    // X = 1000·L·(h·(b+z·h)+c): se despeja h por tramo (para c = 0 y c = 0.1) y se toma el h y el c que más tramos comparten.
    let mejor: { c: number; h: number; cuenta: number } | null = null
    for (const c of [0, 0.1]) {
      const hs = obs.map((o) => {
        if (o.b === null || o.z === null || o.b <= 0) return null
        const q = o.X / (1000 * o.L) - c
        if (q < 0) return null
        return o.z === 0 ? q / o.b : (-o.b + Math.sqrt(o.b * o.b + 4 * o.z * q)) / (2 * o.z)
      }).filter((h): h is number => h !== null)
      const m = modal(hs, 1e-4)
      if (m && (!mejor || m.cuenta > mejor.cuenta)) mejor = { c, h: m.centro, cuenta: m.cuenta }
    }
    if (!mejor) return null
    const { c, h } = mejor
    return {
      modelo, coeficientes: { h: redondear(h), c: String(c) },
      formula: `1000 × L × (${redondear(h)} × (b + z × ${redondear(h)})${c === 0 ? '' : ` + ${c}`})`,
      predecir: (o) => (o.b === null || o.z === null ? null : 1000 * o.L * (h * (o.b + o.z * h) + c)),
    }
  }
  // limpia·sección: X/L = k0 + k1·s con s = (d + lb)·√(1+z²), ajuste de mínimos cuadrados con una pasada de depuración.
  const pts = obs.map((o) => (o.d === null || o.lb === null || o.z === null ? null : { s: (o.d + o.lb) * Math.sqrt(1 + o.z * o.z), y: o.X / o.L }))
    .filter((p): p is { s: number; y: number } => p !== null)
  if (pts.length < 3) return null
  const mco = (ps: ReadonlyArray<{ s: number; y: number }>): { k0: number; k1: number } | null => {
    const n = ps.length
    const sx = ps.reduce((a, p) => a + p.s, 0), sy = ps.reduce((a, p) => a + p.y, 0)
    const sxx = ps.reduce((a, p) => a + p.s * p.s, 0), sxy = ps.reduce((a, p) => a + p.s * p.y, 0)
    const den = n * sxx - sx * sx
    if (Math.abs(den) < 1e-12) return null
    const k1 = (n * sxy - sx * sy) / den
    return { k0: (sy - k1 * sx) / n, k1 }
  }
  let ajuste = mco(pts)
  if (!ajuste) return null
  const res = pts.map((p) => Math.abs(p.y - (ajuste!.k0 + ajuste!.k1 * p.s)))
  const corte = Math.max(3 * [...res].sort((a, b) => a - b)[Math.floor(res.length / 2)]!, 1e-9)
  const dentro = pts.filter((_, i) => res[i]! <= corte)
  if (dentro.length >= 3) ajuste = mco(dentro) ?? ajuste
  const { k0, k1 } = ajuste
  void concepto
  return {
    modelo, coeficientes: { k0: redondear(k0), k1: redondear(k1) },
    formula: `L × (${redondear(k0)} + ${redondear(k1)} × (d + lb) × √(1+z²))`,
    predecir: (o) => (o.d === null || o.lb === null || o.z === null ? null : o.L * (k0 + k1 * (o.d + o.lb) * Math.sqrt(1 + o.z * o.z))),
  }
}

const sigue = (o: Obs, a: Ajuste): boolean => {
  const p = a.predecir(o)
  return p !== null && Math.abs(o.X - p) <= TOL * Math.max(Math.abs(p), Math.abs(o.X)) + 1e-9
}

interface ResultadoGrupo { readonly ajuste: Ajuste | null; readonly siguen: readonly Obs[] }

function mejorAjuste(obs: readonly Obs[], modelos: readonly ModeloId[], concepto: string): ResultadoGrupo {
  let mejor: ResultadoGrupo = { ajuste: null, siguen: [] }
  for (const m of modelos) {
    const a = ajustar(m, obs, concepto)
    if (!a) continue
    const s = obs.filter((o) => sigue(o, a))
    if (s.length > mejor.siguen.length) mejor = { ajuste: a, siguen: s }
  }
  return mejor
}

const CLAVE_GRUPO: Readonly<Record<Agrupacion, (o: Obs) => string>> = {
  ninguna: () => 'todos',
  superficie: (o) => rotuloSuperficie(o.superficie),
  gasto: () => 'todos',
  'categoria+gasto': () => 'todos', // estas dos se arman con el umbral que se elija (mejorCorteGasto)
  revestimiento: (o) => o.revestimiento,
  revestimiento_diag: (o) => `${o.revDiag} (DIAG-01)`,
  categoria: (o) => o.categoria,
  'categoria+revestimiento': (o) => `${o.categoria} · ${o.revestimiento}`,
  'categoria+revestimiento_diag': (o) => `${o.categoria} · ${o.revDiag} (DIAG-01)`,
}

interface InfoDeclarado { readonly motivo?: string; readonly candidato?: CandidatoDeclarado; readonly nota?: string }
type GrupoEvaluado = { clave: string; obs: Obs[]; r: ResultadoGrupo; declarado?: InfoDeclarado }

function evaluarAgrupacion(obs: readonly Obs[], clave: (o: Obs) => string, modelos: readonly ModeloId[], concepto: string): { grupos: GrupoEvaluado[]; siguen: number } {
  const mapa = new Map<string, Obs[]>()
  for (const o of obs) mapa.set(clave(o), [...(mapa.get(clave(o)) ?? []), o])
  const grupos = [...mapa].map(([k, os]): GrupoEvaluado => ({
    clave: k, obs: os, r: os.length >= PARAMETROS_VERIF.minTramosGrupo ? mejorAjuste(os, modelos, concepto) : { ajuste: null, siguen: [] },
  }))
  return { grupos, siguen: grupos.reduce((a, g) => a + g.r.siguen.length, 0) }
}

/* ---------- modelos DECLARADOS por el registro de conceptos (caminos): no se infieren por comparación ---------- */

const predecirCandidato = (c: CandidatoDeclarado, o: Obs): number | null =>
  c.modelo === 'k·L' ? c.k * o.L : o.ancho !== null && o.ancho > 0 ? c.k * o.ancho * o.L : null

function ajusteDeCandidato(c: CandidatoDeclarado): Ajuste {
  return { modelo: c.modelo, coeficientes: { k: redondear(c.k) }, formula: c.modelo === 'k·L' ? `${redondear(c.k)} × L` : `${redondear(c.k)} × ancho × L`, predecir: (o) => predecirCandidato(c, o) }
}

/** «1·L y 2·L»: a cuántas veces la longitud equivale cada valor del concepto (para decir qué unidad parece tener). */
function razonesConL(obs: readonly Obs[]): string {
  const rs = [...new Set(obs.map((o) => redondear(o.X / o.L)))].map(Number).sort((a, b) => a - b)
  if (rs.length === 0 || rs.length > 4) return 'valores sin una relación simple con la longitud'
  return `${rs.map((r) => `${redondear(r)}·L`).join(' y ')} expresados en km`
}

/**
 * Evalúa un concepto de camino con el modelo que declara el registro, agrupando por superficie de IO3 aunque el grupo tenga
 * un solo tramo. Un candidato distinto de cero se da por respaldado solo si lo cumplen al menos `evidenciaMin` tramos del
 * concepto; un grupo que ningún candidato respaldado explica queda «no evaluable» con su motivo, nunca atípico.
 */
function evaluarDeclarado(obs: readonly Obs[], def: ConceptoDef): { grupos: GrupoEvaluado[]; siguen: number } {
  const decl = def.declarado!
  const mapa = new Map<string, Obs[]>()
  for (const o of obs) mapa.set(o.superficie, [...(mapa.get(o.superficie) ?? []), o])
  if (decl.unidadSospechosa !== undefined) {
    const motivo = `${decl.unidadSospechosa}: el valor equivale a ${razonesConL(obs)}; confirmar con la SRL si la unidad es km o m³. No se convierte ni se recalcula.`
    const grupos = [...mapa].map(([k, os]): GrupoEvaluado => ({ clave: rotuloSuperficie(k), obs: os, r: { ajuste: null, siguen: [] }, declarado: { motivo } }))
    return { grupos, siguen: 0 }
  }
  const respaldado = (c: CandidatoDeclarado): boolean => c.cero === true || obs.filter((o) => sigue(o, ajusteDeCandidato(c))).length >= decl.evidenciaMin
  const usables = decl.candidatos.filter(respaldado)
  const sinRespaldo = decl.candidatos.filter((c) => !respaldado(c))
  const grupos = [...mapa].map(([k, os]): GrupoEvaluado => {
    let mejor: { c: CandidatoDeclarado; siguen: Obs[] } | null = null
    for (const c of usables) {
      const a = ajusteDeCandidato(c)
      const s = os.filter((o) => sigue(o, a))
      if (!mejor || s.length > mejor.siguen.length) mejor = { c, siguen: s }
    }
    const minimo = Math.max(1, Math.ceil(PARAMETROS_VERIF.coberturaMinima * os.length))
    const rot = rotuloSuperficie(k)
    if (mejor && mejor.siguen.length >= minimo) {
      return { clave: rot, obs: os, r: { ajuste: ajusteDeCandidato(mejor.c), siguen: mejor.siguen }, declarado: { candidato: mejor.c, nota: mejor.c.notaPorSuperficie?.[k] ?? mejor.c.nota } }
    }
    const modelosTxt = decl.candidatos.map((c) => ajusteDeCandidato(c).formula).join(' o ')
    const respaldo = sinRespaldo.length > 0 ? ` El coeficiente declarado (${sinRespaldo.map((c) => ajusteDeCandidato(c).formula).join(', ')}) no está respaldado por ${decl.evidenciaMin} tramos del libro.` : ''
    const motivo = os.length === 1
      ? `Muestra insuficiente: un solo tramo de superficie «${rot}» y su cifra (${redondear(os[0]!.X)}) no coincide con ningún modelo declarado (${modelosTxt}); no hay con qué compararlo y no se infiere un criterio.${respaldo}`
      : `Ningún modelo declarado (${modelosTxt}) explica al ${Math.round(PARAMETROS_VERIF.coberturaMinima * 100)} % de los ${os.length} tramos de superficie «${rot}».${respaldo}`
    return { clave: rot, obs: os, r: { ajuste: null, siguen: [] }, declarado: { motivo } }
  })
  return { grupos, siguen: grupos.reduce((a, g) => a + g.r.siguen.length, 0) }
}

/** Busca el umbral de gasto que parte las obras en dos grupos con criterios más claros (un corte, no una regresión). */
function mejorCorteGasto(obs: readonly Obs[], base: (o: Obs) => string, modelos: readonly ModeloId[], concepto: string): { grupos: GrupoEvaluado[]; siguen: number } | null {
  const gastos = [...new Set(obs.map((o) => o.gasto).filter((g): g is number => g !== null))].sort((a, b) => a - b)
  if (gastos.length < 2) return null
  const cortes = gastos.slice(1).map((g, i) => (g + gastos[i]!) / 2)
  const paso = Math.max(1, Math.floor(cortes.length / 40))
  let mejor: { grupos: GrupoEvaluado[]; siguen: number } | null = null
  for (let i = 0; i < cortes.length; i += paso) {
    const t = cortes[i]!
    const sufijo = `gasto ${'<'} ${t.toFixed(3)}`
    const c = evaluarAgrupacion(obs, (o) => `${base(o) === 'todos' ? '' : `${base(o)} · `}${o.gasto !== null && o.gasto >= t ? `gasto ≥ ${t.toFixed(3)}` : sufijo}`, modelos, concepto)
    if (!mejor || c.siguen > mejor.siguen) mejor = c
  }
  return mejor
}

const NOMBRE_RED: Readonly<Record<TipoRed, string>> = ROTULO_RED

function dibujarFormula(a: Ajuste | null): string {
  return a ? a.formula : 'sin criterio recuperable'
}

/** La fila de totales de DIAG-01 que corresponde a una red: la que suma los tramos de esa red. */
export function totalesDeRed(libro: LibroDerivado, red: TipoRed): FilaTotalesDiagnostico | null {
  const filas = new Set(libro.tramos.filter((t) => t.red === red).map((t) => t.fila))
  for (const ft of libro.filasTotales) {
    for (const c of [ft.km, ...ft.conceptos.flatMap((x) => [x.parametrica, x.trabajo])]) {
      const m = c.formula === null ? null : /^SUM\(\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)\)$/i.exec(c.formula.replace(/\s/g, ''))
      if (m?.[1] !== undefined && m[2] !== undefined && [...filas].some((f) => f >= Number(m[1]) && f <= Number(m[2]))) return ft
    }
  }
  return null
}

/**
 * En el bloque de caminos DIAG-01 reutiliza los rótulos de las columnas de canales ("DESAZOLVE" para un camino). El nombre real
 * del concepto lo dice 3DN: se busca el concepto de 3DN de caminos cuya cantidad es el total de esa columna.
 */
export function nombreReal(libro: LibroDerivado, red: TipoRed, idx: number): { rotulo: string; nombre: string } {
  const diag = libro.conceptosDiagnostico[idx] ?? ''
  if (red !== 'caminos') return { rotulo: diag, nombre: diag }
  const ft = totalesDeRed(libro, red)
  const total = ft?.conceptos[idx]?.trabajo.valor
  if (total === undefined || total === null || Number(total) === 0) return { rotulo: `${diag} (columna sin uso en caminos)`, nombre: diag }
  const tol = Number(PARAMETROS_VERIF.tolSuma.valor)
  const delBloque = libro.necesidades.filter((x) => /^RED DE CAMINOS/i.test(x.bloque))
  // 3DN lista los conceptos de caminos en el mismo orden que las columnas de DIAG-01; la posición solo vale si el total coincide.
  const porPosicion = delBloque.length === libro.conceptosDiagnostico.length ? delBloque[idx] : undefined
  const coincide = (n: typeof delBloque[number] | undefined): n is typeof delBloque[number] =>
    n !== undefined && n.cantidadTrabajo.valor !== null && Math.abs(Number(n.cantidadTrabajo.valor) - Number(total)) <= tol
  const unico = delBloque.filter(coincide)
  const n = coincide(porPosicion) ? porPosicion : unico.length === 1 ? unico[0] : undefined
  return n ? { rotulo: `${n.concepto} (col. ${diag})`, nombre: n.concepto } : { rotulo: diag, nombre: diag }
}

export function inferirCriterios(libro: LibroDerivado, uniones: Uniones): { criterios: CriterioInferido[]; resultados: ResultadoVerif[] } {
  const criterios: CriterioInferido[] = []
  const resultados: ResultadoVerif[] = []
  const redes: TipoRed[] = ['distribucion', 'drenaje', 'caminos']

  for (const red of redes) {
    const uRed = uniones.uniones.filter((x) => x.tramo.red === red)
    if (uRed.length === 0) continue
    const idxRev = libro.conceptosDiagnostico.findIndex((c) => familia(c) === 'revestimiento')
    libro.conceptosDiagnostico.forEach((_conceptoDiag, idx) => {
      const { rotulo: concepto, nombre } = nombreReal(libro, red, idx)
      const obs = uRed.map((u) => construirObs(u, idx, idxRev)).filter((o): o is Obs => o !== null)
      const sinDatos = uRed.length - obs.length
      const fam = familia(nombre)
      const defCamino = red === 'caminos' ? conceptoDeCamino(nombre) : undefined
      const declarado = defCamino?.declarado !== undefined ? defCamino : undefined
      // Excepción DECLARADA en el registro (no en el criterio general): los conceptos de camino con modelo propio admiten grupos de 1 tramo.
      if (obs.length < (declarado ? 1 : PARAMETROS_VERIF.minTramosGrupo)) return
      const modelos = modelosDe(fam, red, nombre)

      type Candidata = { agr: Agrupacion; grupos: GrupoEvaluado[]; siguen: number }
      let mejor: Candidata | null = null
      if (declarado) {
        mejor = { agr: 'superficie', ...evaluarDeclarado(obs, declarado) }
      } else {
        // Se prueba cada agrupación; gana la que explica a más tramos y, en empate (±1 punto), la más simple.
        const orden: Agrupacion[] = ['ninguna', 'revestimiento', 'revestimiento_diag', 'categoria', 'categoria+revestimiento', 'categoria+revestimiento_diag']
        for (const agr of orden) {
          const c = evaluarAgrupacion(obs, CLAVE_GRUPO[agr], modelos, concepto)
          if (!mejor || c.siguen > mejor.siguen + Math.ceil(0.01 * obs.length)) mejor = { agr, ...c }
        }
        // El espesor de azolve suele depender del caudal que conduce la obra: se prueba también un corte por gasto.
        if (fam === 'desazolve' && mejor) {
          for (const [agr, base] of [['gasto', CLAVE_GRUPO.ninguna], ['categoria+gasto', CLAVE_GRUPO.categoria]] as const) {
            const c = mejorCorteGasto(obs, base, modelos, concepto)
            if (c && c.siguen > mejor.siguen + Math.ceil(0.05 * obs.length)) mejor = { agr, grupos: c.grupos, siguen: c.siguen }
          }
        }
      }
      if (!mejor) return

      const gruposOut: GrupoCriterio[] = mejor.grupos.map((g) => {
        const recuperable = g.declarado !== undefined ? g.r.ajuste !== null : g.r.ajuste !== null && g.r.siguen.length >= PARAMETROS_VERIF.coberturaMinima * g.obs.length
        return {
          clave: g.clave, n: g.obs.length, modelo: recuperable ? g.r.ajuste!.modelo : null, formula: recuperable ? dibujarFormula(g.r.ajuste) : 'sin criterio recuperable',
          coeficientes: recuperable ? g.r.ajuste!.coeficientes : {}, siguen: g.r.siguen.length,
          ...(g.declarado === undefined ? {} : {
            declarado: true,
            ...(!recuperable && g.declarado.motivo !== undefined ? { motivo: g.declarado.motivo } : {}),
            ...(recuperable && g.declarado.candidato?.inferencia ? { inferencia: true } : {}),
            ...(recuperable && g.declarado.nota !== undefined ? { nota: g.declarado.nota } : {}),
          }),
        }
      })
      const porTramo: Record<number, { grupo: string; sigue: boolean }> = {}
      for (const g of mejor.grupos) for (const o of g.obs) porTramo[o.u.tramo.fila] = { grupo: g.clave, sigue: g.r.siguen.includes(o) }
      criterios.push({ red, concepto, agrupacion: mejor.agr, grupos: gruposOut, siguen: mejor.siguen, total: obs.length, sinDatos, porTramo, indiceConcepto: idx, nombre })

      for (const g of mejor.grupos) {
        const go = gruposOut.find((x) => x.clave === g.clave)!
        const etiqueta = mejor.agr === 'ninguna' ? '' : ` (${g.clave})`
        const base = { nivel: 2 as const, base: 'criterio_libro' as const, red, concepto }
        if (go.modelo === null && go.motivo !== undefined) {
          resultados.push({ ...base, id: `CRI-01:${red}:${concepto}:${g.clave}`, estado: 'no_evaluable', tramoFila: null, refs: [], esperado: null, observado: null, diferencia: null, recalculo: [],
            titulo: `No evaluable${etiqueta}`,
            detalle: `${NOMBRE_RED[red]} · ${concepto}${etiqueta}: ${go.motivo} No se marcan atípicos.` })
          continue
        }
        if (go.modelo === null) {
          resultados.push({ ...base, id: `CRI-01:${red}:${concepto}:${g.clave}`, estado: 'no_evaluable', tramoFila: null, refs: [], esperado: null, observado: null, diferencia: null, recalculo: [],
            titulo: `Sin criterio recuperable${etiqueta}`,
            detalle: `${NOMBRE_RED[red]} · ${concepto}: ${g.obs.length} tramos y ningún modelo (proporcional a la longitud, a la plantilla, al ancho, sección de azolve o limpia con talud) explica al ${Math.round(PARAMETROS_VERIF.coberturaMinima * 100)} % de ellos. No se marcan atípicos.` })
          continue
        }
        resultados.push({ ...base, id: `CRI-01:${red}:${concepto}:${g.clave}`, estado: 'informativo', tramoFila: null, refs: [], esperado: null, observado: null, diferencia: null, recalculo: [],
          titulo: `Criterio inferido${etiqueta}: ${go.formula}`,
          detalle: `${NOMBRE_RED[red]} · ${concepto}: el libro aplica ${go.formula} en ${go.siguen} de ${go.n} tramos${go.n - go.siguen > 0 ? `; ${go.n - go.siguen} no lo siguen` : ''}. Es el criterio que hace el libro, no una exigencia de la norma.${go.nota !== undefined ? ` ${go.nota}` : ''}` })
        const a = g.r.ajuste!
        const atipicos = g.obs.filter((o) => !g.r.siguen.includes(o))
        for (const o of atipicos) {
          const p = a.predecir(o)
          if (p === null) continue
          const c = o.u.tramo.conceptos[o.conceptoIdx]!
          resultados.push({
            ...base, id: `CRI-02:${o.u.tramo.fila}:${concepto}`, estado: 'atipico', tramoFila: o.u.tramo.fila,
            refs: [c.trabajo.ref, ...(o.u.ficha ? [o.u.ficha.km.ref] : [])],
            titulo: `No sigue el criterio del libro${etiqueta}`,
            detalle: `${o.u.tramo.inventario} · ${o.u.tramo.obra} (${o.u.tramo.pkInicial} → ${o.u.tramo.pkFinal}): el libro tiene ${redondear(o.X)}; con su criterio (${go.formula}) correspondería ${redondear(p)}. Revisar si es un caso particular o una captura distinta.`,
            esperado: dec(p).toSignificantDigits(10).toFixed(), observado: dec(o.X).toSignificantDigits(10).toFixed(), diferencia: dec(o.X).minus(dec(p)).toSignificantDigits(10).toFixed(),
            recalculo: pasos(a, o, p),
          })
        }
      }
    })
  }
  return { criterios, resultados }
}

function pasos(a: Ajuste, o: Obs, p: number): PasoRecalculo[] {
  const f = (x: number | null): string => (x === null ? 's/d' : redondear(x))
  const s: PasoRecalculo[] = [{ etiqueta: 'Longitud efectiva (km)', expresion: `L = ${f(o.L)}`, valor: f(o.L) }]
  if (a.modelo === 'azolve') {
    const h = Number(a.coeficientes.h), c = Number(a.coeficientes.c)
    s.push({ etiqueta: 'Sección del canal', expresion: `b = ${f(o.b)} m · talud z = ${f(o.z)}`, valor: null })
    s.push({ etiqueta: 'Espesor de azolve del grupo (m)', expresion: `h = ${a.coeficientes.h}`, valor: a.coeficientes.h ?? null })
    s.push({ etiqueta: 'Área de azolve (m²)', expresion: `h × (b + z × h)${c === 0 ? '' : ` + ${c}`}`, valor: f(o.b === null || o.z === null ? null : h * (o.b + o.z * h) + c) })
    const q = o.X / (1000 * o.L) - c
    s.push({ etiqueta: 'Área de azolve implícita en el libro (m²)', expresion: `${f(o.X)} ÷ (1000 × ${f(o.L)})${c === 0 ? '' : ` − ${c}`}`, valor: f(q) })
  } else if (a.modelo === 'limpia·sección') {
    s.push({ etiqueta: 'Altura de bordo × talud', expresion: `(d + lb) × √(1+z²) = (${f(o.d)} + ${f(o.lb)}) × √(1+${f(o.z)}²)`, valor: f(o.d === null || o.lb === null || o.z === null ? null : (o.d + o.lb) * Math.sqrt(1 + o.z * o.z)) })
  } else if (a.modelo === 'k·b·L') {
    s.push({ etiqueta: 'Ancho de plantilla (m)', expresion: `b = ${f(o.b)}`, valor: f(o.b) })
  } else if (a.modelo === 'k·ancho·L') {
    s.push({ etiqueta: 'Ancho de la carpeta (m)', expresion: `ancho = ${f(o.ancho)}`, valor: f(o.ancho) })
  }
  s.push({ etiqueta: 'Cantidad según el criterio del libro', expresion: a.formula, valor: f(p) })
  s.push({ etiqueta: 'Cantidad en DIAG-01', expresion: o.u.tramo.conceptos[o.conceptoIdx]?.trabajo.ref ?? '', valor: f(o.X) })
  return s
}

export type { Dec }
