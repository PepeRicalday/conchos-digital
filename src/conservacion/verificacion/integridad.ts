import { dec } from '../nucleo/num/decimal'
import type { Dec } from '../nucleo/num/decimal'
import type { Cifra, Estructura, FichaCanal, FilaTotalesDiagnostico, LibroDerivado, Ramal, TipoRed, TramoDiagnostico } from '../derivacion/tipos'
import { COLUMNA_IO1, TABLA_IO4_IO1, TIPOS_IO1 } from '../estructuras/catalogo'
import { claveCanal } from '../derivacion/estructuras'
import type { TipoIO1 } from '../estructuras/catalogo'
import { pkAMetros } from '../geo/kmALatLng'
import { ROTULO_RED, ligarDiagnostico, quitaAcentos } from '../derivacion/vistas'
import { familia } from './criterio'
import { PARAMETROS_VERIF } from './parametros'
import type { EstadoVerif, PasoRecalculo, ResultadoVerif } from './tipos'
import type { Uniones } from './uniones'

/**
 * Nivel 1 · Integridad: aritmética y enlaces entre hojas del libro. No depende de ningún criterio de cantidades:
 * si algo aquí "no cuadra", contradice una cuenta del propio PacOT.
 */

const D = (c: Cifra): Dec | null => (c.valor === null ? null : dec(c.valor))
const fmt = (x: Dec | null): string | null => (x === null ? null : x.toFixed())
const esCero = (x: Dec | null): boolean => x === null || x.isZero()

function res(p: { id: string; estado: EstadoVerif; titulo: string; detalle: string } & Partial<ResultadoVerif>): ResultadoVerif {
  return {
    nivel: 1, base: 'integridad', red: null, concepto: null, tramoFila: null, refs: [], esperado: null, observado: null,
    diferencia: null, recalculo: [], ...p,
  }
}

/** "k+mmm" → metros. */
function pkMetros(pk: string | null): number | null {
  const m = pk === null ? null : /^(\d+)\+(\d{3})$/.exec(pk)
  return m?.[1] !== undefined && m[2] !== undefined ? Number(m[1]) * 1000 + Number(m[2]) : null
}

const etiquetaTramo = (t: TramoDiagnostico): string => `${t.inventario} · ${t.obra} (${t.pkInicial} → ${t.pkFinal})`
const refsTramo = (t: TramoDiagnostico): string[] => [t.km.ref]

export function verificarIntegridad(libro: LibroDerivado, u: Uniones): ResultadoVerif[] {
  const out: ResultadoVerif[] = []
  const tol = PARAMETROS_VERIF.tolKm.valor
  const tolS = PARAMETROS_VERIF.tolSuma.valor
  const redes: TipoRed[] = ['distribucion', 'tuberia', 'drenaje', 'caminos']
  const tramosDe = (red: TipoRed): TramoDiagnostico[] => libro.tramos.filter((t) => t.red === red)

  /* INT-01..03 · cada tramo con su ficha y cada ficha con su tramo */
  for (const red of redes) {
    const trs = u.uniones.filter((x) => x.tramo.red === red)
    if (trs.length === 0) continue
    if (red === 'tuberia') {
      out.push(res({ id: `INT-01:resumen:${red}`, estado: 'informativo', red, titulo: 'Bloque de tubería sin ficha de inventario extraída',
        detalle: `${trs.length} tramos de la red en tubería (sección circular). Su inventario está en IO1.a, que aún no se lee: no se emparejan con ficha.`, refs: [] }))
      continue
    }
    let anomalias = 0
    for (const x of trs) {
      const t = x.tramo
      if (x.ficha === null) {
        anomalias++
        const sinCantidad = t.conceptos.every((c) => esCero(D(c.parametrica)))
        out.push(res({
          id: `INT-01:${t.fila}`, red, tramoFila: t.fila, refs: refsTramo(t),
          estado: red === 'distribucion' && sinCantidad ? 'informativo' : 'no_cuadra',
          titulo: red === 'distribucion' && sinCantidad ? 'Tramo sin ficha en IO1 y sin cantidad paramétrica (posible tubería)' : 'Tramo del diagnóstico sin ficha en el inventario',
          detalle: `${etiquetaTramo(t)}, ${t.km.valor ?? 's/d'} km, no se encuentra en ${red === 'caminos' ? 'IO3' : red === 'drenaje' ? 'IO2' : 'IO1'}.`,
        }))
      } else if (x.por === 'inventario_km') {
        const f = x.ficha
        // Solo se compara si ambos lados traen cadenamiento legible (las filas agregadas de caminos de canales y drenes no lo traen).
        const legible = pkMetros(f.pkInicial) !== null && pkMetros(f.pkFinal) !== null && pkMetros(t.pkInicial) !== null && pkMetros(t.pkFinal) !== null
        const distinto = f.pkInicial !== t.pkInicial || f.pkFinal !== t.pkFinal
        if (legible && distinto) {
          anomalias++
          out.push(res({
            id: `INT-03:${t.fila}`, red, tramoFila: t.fila, refs: [t.km.ref, f.km.ref], estado: 'no_cuadra',
            titulo: 'El cadenamiento del diagnóstico no coincide con el del inventario',
            detalle: `${etiquetaTramo(t)}: la longitud coincide (${t.km.valor} km) pero el PK no.`,
            esperado: `${f.pkInicial ?? 's/d'} → ${f.pkFinal ?? 's/d'}`, observado: `${t.pkInicial} → ${t.pkFinal}`,
          }))
        }
      }
    }
    out.push(res({ id: `INT-01:resumen:${red}`, estado: anomalias === 0 ? 'cuadra' : 'informativo', red,
      titulo: 'Tramos del diagnóstico emparejados con su ficha de inventario',
      detalle: `${trs.length} tramos revisados · ${anomalias} con diferencias (se listan aparte).` }))
  }
  for (const { red, ficha } of u.fichasSinTramo) {
    out.push(res({
      id: `INT-02:${red}:${ficha.fila}`, red, estado: 'no_cuadra', refs: [ficha.km.ref],
      titulo: 'Ficha del inventario que no aparece en el diagnóstico',
      detalle: `${ficha.inventario} · ${ficha.nombre} (${ficha.pkInicial ?? 's/d'} → ${ficha.pkFinal ?? 's/d'}, ${ficha.km.valor} km) está en el inventario pero ningún tramo de DIAG-01 la usa.`,
      observado: ficha.km.valor,
    }))
  }

  /* INT-04 · cantidad paramétrica contra la longitud efectiva del tramo */
  for (const t of libro.tramos) {
    const km = D(t.km)
    if (km === null) continue
    for (const c of t.conceptos) {
      const p = D(c.parametrica), w = D(c.trabajo)
      if (p !== null && p.greaterThan(km.plus(tol))) {
        out.push(res({ id: `INT-04:${t.fila}:${c.concepto}`, red: t.red, concepto: c.concepto, tramoFila: t.fila, refs: [c.parametrica.ref, t.km.ref], estado: 'no_cuadra',
          titulo: 'Cantidad paramétrica mayor que la longitud del tramo', detalle: `${etiquetaTramo(t)} · ${c.concepto}`, esperado: `≤ ${km.toFixed()}`, observado: p.toFixed(), diferencia: p.minus(km).toFixed() }))
      } else if (esCero(p) && w !== null && w.greaterThan(0)) {
        out.push(res({ id: `INT-04:${t.fila}:${c.concepto}`, red: t.red, concepto: c.concepto, tramoFila: t.fila, refs: [c.parametrica.ref, c.trabajo.ref], estado: 'no_cuadra',
          titulo: 'Cantidad de trabajo con paramétrica en cero', detalle: `${etiquetaTramo(t)} · ${c.concepto}: hay trabajo programado pero la longitud paramétrica es ${p === null ? 'vacía' : '0'}.`,
          esperado: 'paramétrica > 0', observado: p === null ? 'vacía' : '0', diferencia: w.toFixed() }))
      }
    }
  }

  /* INT-05 · longitud efectiva = diferencia de cadenamientos */
  let pkIlegibles = 0
  for (const t of libro.tramos) {
    const a = pkMetros(t.pkInicial), b = pkMetros(t.pkFinal), km = D(t.km)
    if (a === null || b === null || km === null) { pkIlegibles++; continue }
    const delta = dec(b - a).div(1000)
    if (delta.minus(km).abs().greaterThan(tol)) {
      out.push(res({ id: `INT-05:${t.fila}`, red: t.red, tramoFila: t.fila, refs: [t.km.ref], estado: 'no_cuadra',
        titulo: 'La longitud efectiva no es la diferencia de cadenamientos', detalle: `${etiquetaTramo(t)}: la longitud efectiva no cuadra con su cadenamiento.`,
        esperado: delta.toFixed(), observado: km.toFixed(), diferencia: km.minus(delta).toFixed(),
        recalculo: [{ etiqueta: 'Longitud por cadenamiento', expresion: `(${b} − ${a}) m ÷ 1000`, valor: delta.toFixed() }] }))
    }
  }
  if (pkIlegibles > 0) out.push(res({ id: 'INT-05:resumen', estado: 'no_evaluable', titulo: 'Tramos con cadenamiento ilegible', detalle: `${pkIlegibles} tramos no tienen un PK en formato k+mmm: no se comparó su longitud contra el cadenamiento.` }))

  /* INT-06 · longitud del tramo contra la de su ficha */
  for (const x of u.uniones) {
    if (!x.ficha) continue
    const a = D(x.tramo.km), b = D(x.ficha.km)
    if (a !== null && b !== null && a.minus(b).abs().greaterThan(tol)) {
      out.push(res({ id: `INT-06:${x.tramo.fila}`, red: x.tramo.red, tramoFila: x.tramo.fila, refs: [x.tramo.km.ref, x.ficha.km.ref], estado: 'no_cuadra',
        titulo: 'Longitud del diagnóstico distinta de la del inventario', detalle: etiquetaTramo(x.tramo), esperado: b.toFixed(), observado: a.toFixed(), diferencia: a.minus(b).toFixed() }))
    }
  }

  /* INT-07 · suma de tramos por red contra el inventario del libro */
  const inv: Array<[TipoRed, Cifra]> = [['distribucion', libro.inventarioKm.distribucion], ['drenaje', libro.inventarioKm.drenaje], ['caminos', libro.inventarioKm.caminos]]
  for (const [red, total] of inv) {
    const trs = tramosDe(red)
    const esperado = D(total)
    if (esperado === null || (trs.length === 0 && esperado.isZero())) continue
    const suma = trs.reduce<Dec>((a, t) => a.plus(D(t.km) ?? 0), dec(0))
    const dif = suma.minus(esperado)
    const sinFicha = u.uniones.filter((x) => x.tramo.red === red && !x.ficha).reduce<Dec>((a, x) => a.plus(D(x.tramo.km) ?? 0), dec(0))
    const sinTramo = u.fichasSinTramo.filter((x) => x.red === red).reduce<Dec>((a, x) => a.plus(D(x.ficha.km) ?? 0), dec(0))
    const ok = dif.abs().lessThanOrEqualTo(tol)
    out.push(res({
      id: `INT-07:${red}`, red, refs: [total.ref], estado: ok ? 'cuadra' : 'no_cuadra',
      titulo: `Suma de tramos de ${ROTULO_RED[red]} contra el inventario`,
      detalle: ok ? `Σ longitud efectiva de DIAG-01 = inventario (${total.ref}).`
        : `Σ DIAG-01 = ${suma.toFixed()} km, inventario = ${esperado.toFixed()} km. Tramos sin ficha: ${sinFicha.toFixed()} km; fichas sin tramo: ${sinTramo.toFixed()} km.`,
      esperado: esperado.toFixed(), observado: suma.toFixed(), diferencia: dif.toFixed(),
      recalculo: [{ etiqueta: 'Σ longitud efectiva', expresion: `Σ ${trs.length} tramos`, valor: suma.toFixed() }],
    }))
  }

  /* INT-08 · filas de totales: la fórmula, su rango y su valor */
  out.push(...verificarTotales(libro, tolS))

  /* INT-14 · el inventario dice que el canal está revestido y el diagnóstico lo trata como sin revestir */
  const idxRev = libro.conceptosDiagnostico.findIndex((c) => familia(c) === 'revestimiento')
  if (idxRev >= 0) {
    for (const x of u.uniones) {
      const f = x.ficha
      if (!f || x.tramo.red === 'caminos' || !('plantilla' in f)) continue
      const rev = (f.revestimiento ?? '').toLowerCase()
      const p = D(x.tramo.conceptos[idxRev]?.parametrica ?? { valor: null, ref: '', formula: null, origen: 'vacio' })
      if (rev !== '' && !/sin\s*revest|^n\/?a$/.test(rev) && p !== null && p.isZero()) {
        out.push(res({ id: `INT-14:${x.tramo.fila}`, red: x.tramo.red, tramoFila: x.tramo.fila, refs: [x.tramo.conceptos[idxRev]!.parametrica.ref, f.km.ref], estado: 'no_cuadra',
          titulo: 'El inventario dice revestido y el diagnóstico lo trata como sin revestir',
          detalle: `${etiquetaTramo(x.tramo)}: la ficha de inventario dice «${f.revestimiento}», pero DIAG-01 no programa reparación de revestimiento (paramétrica 0) y calcula la limpia como canal de tierra.`,
          esperado: 'revestimiento > 0', observado: '0' }))
      }
    }
  }

  /* INT-09 · texto donde debía haber un número */
  for (const t of libro.tramos) {
    const celdas: Cifra[] = [t.km, ...t.conceptos.flatMap((c) => [c.parametrica, c.trabajo])]
    for (const c of celdas) {
      if (c.texto !== undefined) {
        out.push(res({ id: `INT-09:${c.ref}`, red: t.red, tramoFila: t.fila, refs: [c.ref], estado: 'no_cuadra', titulo: 'Texto en una celda numérica',
          detalle: `${etiquetaTramo(t)}: la celda ${c.ref} contiene «${c.texto}» y no suma en los totales.`, observado: c.texto }))
      }
    }
  }

  /* INT-10..12 · enlace de 3DN con DIAG-01 */
  out.push(...verificar3dn(libro, tolS))
  out.push(...verificarTuberia(libro, u))
  out.push(...verificarConciliacionIO4(libro))
  return out
}

/* ───────── INT-15 · conciliación IO4 ↔ IO1 (estructuras) ───────── */

export interface FilaConciliacionGrupo {
  readonly grupo: string
  readonly rotulo: string
  readonly columnasIO1: readonly string[]
  /** Estructuras de IO4 de los tipos del grupo. */
  readonly io4: number
  /** Fila 15 de IO1 (total declarado) sumada sobre las columnas del grupo. */
  readonly io1: number
  readonly diferencia: number
  /** De las de IO4, las que el catálogo marca ambiguas (tipo conservado, sin reclasificar). */
  readonly ambiguasIO4: number
}

export interface FilaConciliacionTramo {
  readonly fila: number
  readonly ramal: Ramal
  readonly pkIni: string
  readonly pkFin: string
  readonly io4: number
  readonly io1: number
  readonly diferencia: number
  /** Libros de varios canales: nombre del canal de IO1 al que pertenece el tramo (cada canal tiene su cadenamiento desde 0). */
  readonly canal?: string
}

export interface ConciliacionIO4IO1 {
  /** IO4 trae varios canales: los tramos se concilian por canal (inventario), no por ramal. */
  readonly multicanal?: boolean
  /** Canales de IO4 (clave de inventario) que IO1 no declara: sus estructuras no entran en ningún tramo. */
  readonly canalesSinFicha?: readonly string[]
  readonly totalIO4: number
  /** IO1!AN15 tal como está en la hoja. */
  readonly totalIO1Declarado: number | null
  /** Σ de los conteos W..AM de todas las filas de tramos (calculado). */
  readonly totalIO1Calculado: number
  readonly porGrupo: readonly FilaConciliacionGrupo[]
  /** Estructuras de IO4 de tipo no reconocido («sin clasificar»): IO1 no tiene columna para ellas. */
  readonly sinClasificar: number
  readonly porTramo: readonly FilaConciliacionTramo[]
  /** Estructuras de IO4 sin cadenamiento completo: no se pueden asignar a un tramo. */
  readonly sinPK: readonly Estructura[]
  /** Estructuras con PK fuera de todos los tramos de su ramal (p. ej. pasan del final declarado en IO1). */
  readonly fueraDeTramos: readonly Estructura[]
}

/**
 * Cuenta las estructuras de IO4 contra los conteos de IO1, por tipo (tabla IO4→IO1 del catálogo) y por tramo (las de IO4 cuyo PK cae en
 * [PK inicial, PK final) del tramo; el último tramo de cada ramal incluye su PK final). null si el libro no trae IO4 o IO1 con conteos.
 */
export function conciliacionIO4IO1(libro: LibroDerivado): ConciliacionIO4IO1 | null {
  const est = libro.fichas.estructuras
  const canales = libro.fichas.canales.filter((f) => f.conteos !== undefined && f.ini !== undefined && f.fin !== undefined)
  if (est === undefined || est.length === 0 || canales.length === 0) return null
  const sumaTramo = (f: FichaCanal): number => (f.conteos === undefined ? 0 : TIPOS_IO1.reduce((s, t) => s + (f.conteos?.porTipo[t] ?? 0), 0))
  const declarado = libro.fichas.totalesIO1
  const totalIO1Calculado = canales.reduce((s, f) => s + sumaTramo(f), 0)
  // Total por columna: el declarado en la fila 15; si falta, la suma de los tramos.
  const colIO1 = (t: TipoIO1): number => declarado?.porTipo[t] ?? canales.reduce((s, f) => s + (f.conteos?.porTipo[t] ?? 0), 0)
  const porGrupo: FilaConciliacionGrupo[] = TABLA_IO4_IO1.map((g) => {
    const io1 = g.columnasIO1.reduce((s, c) => { const t = COLUMNA_IO1[c]; return s + (t === undefined ? 0 : colIO1(t)) }, 0)
    const delGrupo = est.filter((e) => g.tiposIO4.includes(e.tipo))
    return { grupo: g.id, rotulo: g.rotulo, columnasIO1: g.columnasIO1, io4: delGrupo.length, io1, diferencia: delGrupo.length - io1, ambiguasIO4: delGrupo.filter((e) => e.ambiguo).length }
  })
  const sinPK = est.filter((e) => e.pkMetros === null)
  const porTramo: FilaConciliacionTramo[] = []
  const contadas = new Set<number>()
  const multicanal = est.some((e) => e.canal !== undefined)
  const canalesSinFicha: string[] = []
  if (multicanal) {
    // Cada canal (inventario de IO1) con su propio eje: las estructuras se cuentan solo contra los tramos de SU canal.
    const grupos = new Map<string, FichaCanal[]>()
    for (const f of canales) { const k = claveCanal(f.inventario); const l = grupos.get(k) ?? []; l.push(f); grupos.set(k, l) }
    for (const [k, fichas] of grupos) {
      const delCanal = k === '' ? [] : est.filter((e) => e.canal === k)
      fichas.forEach((f, i) => {
        const a = pkAMetros(f.ini?.pk), b = pkAMetros(f.fin?.pk)
        if (a === null || b === null) return
        const ultimo = i === fichas.length - 1
        const dentro = delCanal.filter((e) => e.pkMetros !== null && e.pkMetros >= a && (ultimo ? e.pkMetros <= b : e.pkMetros < b))
        for (const e of dentro) contadas.add(e.fila)
        porTramo.push({ fila: f.fila, ramal: f.ramal ?? 'principal', pkIni: f.ini?.pk ?? '', pkFin: f.fin?.pk ?? '', io4: dentro.length, io1: sumaTramo(f), diferencia: dentro.length - sumaTramo(f), canal: f.nombre })
      })
    }
    for (const k of new Set(est.map((e) => e.canal ?? ''))) if (k !== '' && !grupos.has(k)) canalesSinFicha.push(k)
  } else for (const ramal of ['principal', 'auxiliar'] as const) {
    const delRamal = canales.filter((f) => (f.ramal ?? 'principal') === ramal)
    delRamal.forEach((f, i) => {
      const a = pkAMetros(f.ini?.pk), b = pkAMetros(f.fin?.pk)
      if (a === null || b === null) return
      const ultimo = i === delRamal.length - 1
      const dentro = est.filter((e) => e.ramal === ramal && e.pkMetros !== null && e.pkMetros >= a && (ultimo ? e.pkMetros <= b : e.pkMetros < b))
      for (const e of dentro) contadas.add(e.fila)
      porTramo.push({ fila: f.fila, ramal, pkIni: f.ini?.pk ?? '', pkFin: f.fin?.pk ?? '', io4: dentro.length, io1: sumaTramo(f), diferencia: dentro.length - sumaTramo(f) })
    })
  }
  return {
    totalIO4: est.length, totalIO1Declarado: declarado?.total ?? null, totalIO1Calculado, porGrupo,
    sinClasificar: est.filter((e) => e.tipo === 'otro').length, porTramo, sinPK,
    ...(multicanal ? { multicanal, canalesSinFicha } : {}),
    fueraDeTramos: est.filter((e) => e.pkMetros !== null && !contadas.has(e.fila)),
  }
}

function verificarConciliacionIO4(libro: LibroDerivado): ResultadoVerif[] {
  const c = conciliacionIO4IO1(libro)
  if (c === null) return []
  const out: ResultadoVerif[] = []
  const refsIO1 = ['IO1!AN15']
  /* total */
  const coincide = c.totalIO1Declarado !== null && c.totalIO4 === c.totalIO1Declarado && c.totalIO1Declarado === c.totalIO1Calculado
  out.push(res({
    id: 'INT-15:total', estado: coincide ? 'cuadra' : 'atipico', refs: [...refsIO1, 'IO4!C14'],
    titulo: 'Total de estructuras: IO4 contra IO1',
    detalle: coincide ? `IO4 lista ${c.totalIO4} estructuras y IO1 declara ${c.totalIO1Declarado}, igual a la suma de sus tramos (${c.totalIO1Calculado}).`
      : `IO4 lista ${c.totalIO4} estructuras; IO1!AN15 declara ${c.totalIO1Declarado ?? 'S/D'} y la suma de los tramos de IO1 es ${c.totalIO1Calculado}.`,
    esperado: c.totalIO1Declarado === null ? null : String(c.totalIO1Declarado), observado: String(c.totalIO4),
    diferencia: c.totalIO1Declarado === null ? null : String(c.totalIO4 - c.totalIO1Declarado),
    recalculo: [
      { etiqueta: 'Estructuras en IO4', expresion: 'filas con nombre de obra', valor: String(c.totalIO4) },
      { etiqueta: 'Σ conteos de los tramos de IO1', expresion: `Σ W..AM de ${libro.fichas.canales.filter((f) => f.conteos !== undefined).length} tramos`, valor: String(c.totalIO1Calculado) },
    ],
  }))
  /* por tipo */
  for (const g of c.porGrupo) {
    if (g.io4 === 0 && g.io1 === 0) continue
    const igual = g.diferencia === 0
    out.push(res({
      id: `INT-15:tipo:${g.grupo}`, estado: igual ? 'cuadra' : 'atipico', refs: g.columnasIO1.map((x) => `IO1!${x}15`),
      titulo: `${g.rotulo}: IO4 contra IO1`,
      detalle: igual ? `IO4 lista ${g.io4} y IO1 (${g.columnasIO1.join('+')}) declara ${g.io1}.`
        : `IO4 lista ${g.io4} y IO1 (${g.columnasIO1.join('+')}) declara ${g.io1}: diferencia de ${g.diferencia > 0 ? '+' : ''}${g.diferencia}. Los nombres de IO4 son texto libre; el tipo se asigna por el catálogo${g.ambiguasIO4 > 0 ? ` (${g.ambiguasIO4} de IO4 con nombre ambiguo, sin reclasificar)` : ''}.`,
      esperado: String(g.io1), observado: String(g.io4), diferencia: String(g.diferencia),
    }))
  }
  if (c.sinClasificar > 0) {
    out.push(res({
      id: 'INT-15:sin-clasificar', estado: 'informativo', refs: ['IO4!C14'], titulo: 'Estructuras de IO4 con nombre que el catálogo no reconoce',
      detalle: `${c.sinClasificar} estructuras de IO4 quedan «sin clasificar»; IO1 no tiene columna para ellas, así que no se reparten entre los tipos.`,
      observado: String(c.sinClasificar),
    }))
  }
  /* por tramo */
  const atipicos = c.porTramo.filter((t) => t.diferencia !== 0)
  for (const t of atipicos) {
    out.push(res({
      id: `INT-15:tramo:${t.fila}`, estado: 'atipico', refs: [`IO1!AN${t.fila}`], tramoFila: null,
      titulo: `Estructuras del tramo ${t.canal === undefined ? '' : `${t.canal.trim()} · `}K-${t.pkIni} → K-${t.pkFin}${t.ramal === 'auxiliar' ? ' (auxiliar)' : ''}: IO4 contra IO1`,
      detalle: `IO4 tiene ${t.io4} estructuras con cadenamiento dentro del tramo (fila ${t.fila} de IO1) y IO1 declara ${t.io1}: diferencia de ${t.diferencia > 0 ? '+' : ''}${t.diferencia}.`,
      esperado: String(t.io1), observado: String(t.io4), diferencia: String(t.diferencia),
    }))
  }
  out.push(res({
    id: 'INT-15:tramos:resumen', estado: atipicos.length === 0 ? 'cuadra' : 'informativo', refs: ['IO1!W16:AN204', 'IO4!D14'],
    titulo: 'Estructuras por tramo: IO4 contra IO1',
    detalle: `${c.porTramo.length - atipicos.length} de ${c.porTramo.length} tramos coinciden · ${atipicos.length} con diferencias (se listan aparte).`,
    recalculo: c.porTramo.map((t) => ({ etiqueta: `${t.canal === undefined ? '' : `${t.canal.trim()} · `}K-${t.pkIni} → K-${t.pkFin}${t.ramal === 'auxiliar' ? ' (aux.)' : ''}`, expresion: `IO4 ${t.io4} · IO1 ${t.io1}`, valor: String(t.diferencia) })),
  }))
  if (c.sinPK.length > 0 || c.fueraDeTramos.length > 0) {
    out.push(res({
      id: 'INT-15:sin-asignar', estado: 'informativo', refs: [...c.sinPK, ...c.fueraDeTramos].map((e) => e.ref),
      titulo: 'Estructuras de IO4 que no se pueden asignar a un tramo',
      detalle: `${c.sinPK.length} sin cadenamiento utilizable (${c.sinPK.map((e) => `fila ${e.fila}: «${e.cadenamientoTexto}»`).join('; ') || 'ninguna'}) y ${c.fueraDeTramos.length} con cadenamiento fuera de los tramos de IO1 (${c.fueraDeTramos.map((e) => `fila ${e.fila}: K-${e.pk}`).join('; ') || 'ninguna'}). No entran en la comparación por tramo.`,
      observado: String(c.sinPK.length + c.fueraDeTramos.length),
    }))
  }
  return out
}

interface ObjetivoTotal { readonly etiqueta: string; readonly total: Cifra; readonly delTramo: (t: TramoDiagnostico) => Cifra | undefined }

function objetivosDe(ft: FilaTotalesDiagnostico): ObjetivoTotal[] {
  const o: ObjetivoTotal[] = [{ etiqueta: 'Longitud efectiva (km)', total: ft.km, delTramo: (t) => t.km }]
  ft.conceptos.forEach((c, i) => {
    o.push({ etiqueta: `${c.concepto} · paramétrica`, total: c.parametrica, delTramo: (t) => t.conceptos[i]?.parametrica })
    o.push({ etiqueta: `${c.concepto} · de trabajo`, total: c.trabajo, delTramo: (t) => t.conceptos[i]?.trabajo })
  })
  return o
}

function verificarTotales(libro: LibroDerivado, tolS: Dec): ResultadoVerif[] {
  const out: ResultadoVerif[] = []
  for (const ft of libro.filasTotales) {
    let revisados = 0, anomalias = 0
    for (const obj of objetivosDe(ft)) {
      const total = obj.total
      if (total.valor === null && total.texto === undefined && total.formula === null) continue
      revisados++
      const m = total.formula === null ? null : /^SUM\(\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)\)$/i.exec(total.formula.replace(/\s/g, ''))
      if (total.formula === null) {
        anomalias++
        out.push(res({ id: `INT-08:${total.ref}`, refs: [total.ref], estado: 'informativo', titulo: 'Total capturado, sin fórmula', detalle: `${obj.etiqueta}: ${total.ref} es un valor tecleado, no una suma de los tramos.`, observado: total.valor }))
        continue
      }
      if (!m || m[1] === undefined || m[2] === undefined || m[4] === undefined) {
        anomalias++
        out.push(res({ id: `INT-08:${total.ref}`, refs: [total.ref], estado: 'no_cuadra', titulo: 'El total no es una suma de los tramos',
          detalle: `${obj.etiqueta}: ${total.ref} es «=${total.formula}», no una suma de la columna de tramos.`, observado: total.valor }))
        continue
      }
      const a = Number(m[2]), b = Number(m[4])
      const enRango = libro.tramos.filter((t) => t.fila >= a && t.fila <= b)
      const redes = new Set(enRango.map((t) => t.red))
      const suma = enRango.reduce<Dec>((s, t) => s.plus((obj.delTramo(t) && D(obj.delTramo(t) as Cifra)) || 0), dec(0))
      const valor = D(total)
      if (valor !== null && suma.minus(valor).abs().greaterThan(tolS)) {
        anomalias++
        out.push(res({ id: `INT-08:${total.ref}:suma`, refs: [total.ref], estado: 'no_cuadra', titulo: 'El total no es la suma de los tramos del rango',
          detalle: `${obj.etiqueta}: Σ filas ${a}–${b} = ${suma.toFixed()}, el total dice ${valor.toFixed()}.`, esperado: suma.toFixed(), observado: valor.toFixed(), diferencia: valor.minus(suma).toFixed() }))
      }
      // Tramos de la misma red que el rango deja fuera.
      const fuera = libro.tramos.filter((t) => redes.has(t.red) && (t.fila < a || t.fila > b))
      if (fuera.length > 0) {
        const conValor = fuera.filter((t) => { const c = obj.delTramo(t); return c && !esCero(D(c)) })
        const sumaFuera = conValor.reduce<Dec>((s, t) => s.plus(D(obj.delTramo(t) as Cifra) ?? 0), dec(0))
        anomalias++
        out.push(res({
          id: `INT-08:${total.ref}:rango`, refs: [total.ref], estado: conValor.length > 0 ? 'no_cuadra' : 'informativo',
          titulo: 'El rango del total deja fuera filas del bloque',
          detalle: `${obj.etiqueta}: ${total.ref} suma las filas ${a}–${b} pero el bloque tiene también las filas ${fuera.map((t) => t.fila).join(', ')}. `
            + (conValor.length > 0 ? `Esas filas aportan ${sumaFuera.toFixed()} que el total no incluye.` : 'Hoy esas filas no tienen valor en esta columna, así que el total no cambia, pero la fórmula está incompleta.'),
          ...(conValor.length > 0 ? { diferencia: sumaFuera.toFixed() } : {}),
        }))
      }
    }
    out.push(res({ id: `INT-08:resumen:${ft.fila}`, estado: anomalias === 0 ? 'cuadra' : 'informativo', refs: [ft.km.ref],
      titulo: `Fila de totales ${ft.fila} de DIAG-01`, detalle: `${revisados} totales revisados · ${anomalias} con diferencias (se listan aparte).` }))
  }
  return out
}

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'en', 'para', 'extraccion', 'extrac'])
const SINONIMOS: Readonly<Record<string, readonly string[]>> = { terrestres: ['limpia', 'deshierbe', 'desmonte'] }
const palabras = (t: string): string[] => quitaAcentos(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !PARTICULAS.has(w))
const raiz = (w: string): string => w.slice(0, 5)

/** ¿Comparten el rótulo de 3DN y el de la columna de DIAG-01 alguna palabra significativa (o un sinónimo del Manual)? */
function rotulosAfines(a: string, b: string): boolean {
  const pa = palabras(a), pb = palabras(b)
  const base = pa.some((w) => pb.some((v) => raiz(w) === raiz(v)))
  return base || pa.some((w) => (SINONIMOS[w] ?? []).some((s) => pb.some((v) => raiz(v) === raiz(s))))
}

function verificar3dn(libro: LibroDerivado, tolS: Dec): ResultadoVerif[] {
  const out: ResultadoVerif[] = []
  const todosTotales = libro.filasTotales.flatMap((ft) => ft.conceptos.map((c) => c.trabajo))
  let capturados = 0
  for (const n of libro.necesidades) {
    // Solo los conceptos de redes salen de DIAG-01; pozos, bombeo, estructuras y edificios tienen su propio diagnóstico.
    if (!/^RED DE (DISTRIBU|DRENAJE|CAMINOS)/i.test(n.bloque)) continue
    const e = D(n.cantidadTrabajo)
    if (e === null) continue
    const lig = ligarDiagnostico(libro, n)
    if (n.enlaceDiagnostico && lig.concepto && lig.por === 'formula') {
      if (!rotulosAfines(n.concepto, lig.concepto.concepto)) {
        out.push(res({ id: `INT-10:${n.fila}`, concepto: n.concepto, refs: [n.cantidadTrabajo.ref, lig.concepto.trabajo.ref], estado: 'informativo',
          titulo: 'El rótulo de 3DN no coincide con la columna de DIAG-01 a la que enlaza',
          detalle: `3DN «${n.concepto}» (${n.cantidadTrabajo.ref}) toma su cantidad de DIAG-01 «${lig.concepto.concepto}». Confirmar que es el mismo concepto.` }))
      }
      const p = D(n.cantidadParametrica), pd = D(lig.concepto.parametrica)
      if (p !== null && pd !== null && p.minus(pd).abs().greaterThan(tolS)) {
        out.push(res({ id: `INT-11:${n.fila}`, concepto: n.concepto, refs: [n.cantidadParametrica.ref, lig.concepto.parametrica.ref], estado: 'no_cuadra',
          titulo: 'Base paramétrica de 3DN distinta de la de DIAG-01', detalle: `3DN «${n.concepto}»: la longitud paramétrica no es la del concepto enlazado.`,
          esperado: pd.toFixed(), observado: p.toFixed(), diferencia: p.minus(pd).toFixed() }))
      }
    } else if (n.cantidadTrabajo.origen === 'capturado') {
      capturados++
      const hay = todosTotales.some((c) => { const v = D(c); return v !== null && v.minus(e).abs().lessThanOrEqualTo(tolS) })
      if (!hay) {
        out.push(res({ id: `INT-12:${n.fila}`, concepto: n.concepto, refs: [n.cantidadTrabajo.ref], estado: 'no_cuadra',
          titulo: 'Valor de 3DN que no coincide con ningún total de DIAG-01',
          detalle: `3DN «${n.concepto}» (${n.cantidadTrabajo.ref}) es un valor tecleado y no es igual a ninguna fila de totales de DIAG-01.`, observado: e.toFixed() }))
      }
    }
  }
  if (capturados > 0) {
    out.push(res({ id: 'INT-12:resumen', estado: 'informativo', titulo: '3DN no enlaza por fórmula a DIAG-01',
      detalle: `${capturados} conceptos de 3DN traen la cantidad tecleada. Se comprobó que cada valor coincida con un total de DIAG-01, pero un cambio en DIAG-01 no se reflejaría solo en 3DN.` }))
  }
  return out
}

/** La tubería aparece en el bloque de canales (con paramétrica 0) y otra vez en su propio bloque: ¿se cuenta dos veces? */
function verificarTuberia(libro: LibroDerivado, u: Uniones): ResultadoVerif[] {
  const enTuberia = new Set(libro.tramos.filter((t) => t.red === 'tuberia').map((t) => t.inventario.trim().toUpperCase()))
  if (enTuberia.size === 0) return []
  const repetidos = u.uniones.filter((x) => x.tramo.red === 'distribucion' && !x.ficha && enTuberia.has(x.tramo.inventario.trim().toUpperCase()))
  if (repetidos.length === 0) return []
  const km = repetidos.reduce<Dec>((a, x) => a.plus(D(x.tramo.km) ?? 0), dec(0))
  return [res({
    id: 'INT-13', red: 'tuberia', estado: 'informativo', refs: repetidos.map((x) => x.tramo.km.ref),
    titulo: 'Tubería listada en el bloque de canales y en el de tubería',
    detalle: `${repetidos.length} inventarios (${fmt(km)} km) aparecen en el bloque de canales de DIAG-01 con longitud paramétrica 0 y otra vez en el bloque de tubería. Verificar que su cantidad de trabajo no se cuente dos veces.`,
    observado: fmt(km),
  })]
}

export type { PasoRecalculo }
