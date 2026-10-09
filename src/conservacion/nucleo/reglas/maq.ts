import { aCadena, dec, dentroDeTolerancia, type Dec } from '../num/decimal'
import { redondear, reglaQueReproduce, type ReglaRedondeo } from '../num/redondeo'
import type { DondeEo } from '../parametros/catalogo'
import type { ContextoEvaluacion, FuenteNorma, Hallazgo, Regla, Resultado } from '../tipos/regla'
import { crearHallazgo, crearResultado, noEvaluable } from './util'

const MANUAL = 'Manual de Conservación 2026'
const F_HE: FuenteNorma = { documento: MANUAL, seccion: '6.3 y 6.3.2', pagina: 75 }
const F_NM: FuenteNorma = { documento: MANUAL, seccion: '6.3.2', pagina: 75 }
const F_A4: FuenteNorma = { documento: 'Anexo 4', seccion: '3', pagina: 7 }
const F_A5: FuenteNorma = { documento: 'Anexo 5', seccion: '3.1 y 3.2' }

// ---------------------------------------------------------------------------------------------
// Cálculo puro (sin libro)
// ---------------------------------------------------------------------------------------------

export interface PartidaHoras {
  readonly id: string
  readonly cantidad: Dec
  readonly rendimiento: Dec
  readonly capturada?: Dec | null
}

export interface FilaHoras {
  readonly id: string
  /** null si el rendimiento es cero o negativo (no evaluable). */
  readonly exacta: Dec | null
  readonly segunRegla: Dec | null
  readonly capturada: Dec | null
  readonly diferencia: Dec | null
  readonly reproducidaPor: 'truncado' | 'redondeo' | null
}

/** He = Vo / Rm. Se divide, no se multiplica (el Anexo 5, paso 4, dice multiplicar: el Manual y los ejemplos dividen). */
export function calcularHorasEfectivas(partidas: readonly PartidaHoras[], regla: ReglaRedondeo): { filas: FilaHoras[]; totalExacto: Dec } {
  let total = dec(0)
  const filas = partidas.map((p): FilaHoras => {
    const capturada = p.capturada ?? null
    if (!p.rendimiento.greaterThan(0)) {
      return { id: p.id, exacta: null, segunRegla: null, capturada, diferencia: null, reproducidaPor: null }
    }
    const exacta = p.cantidad.dividedBy(p.rendimiento)
    total = total.plus(exacta)
    const segunRegla = redondear(exacta, regla)
    const diferencia = capturada === null ? null : capturada.minus(exacta)
    const reproducidaPor = capturada === null ? null : reglaQueReproduce(exacta, capturada, 0)
    return { id: p.id, exacta, segunRegla, capturada, diferencia, reproducidaPor }
  })
  return { filas, totalExacto: total }
}

export interface ResultadoNm {
  /** Nm sin redondear. */
  readonly nm: Dec
  /** Nm con los decimales del parámetro (la fracción es capacidad, no una máquina física). */
  readonly nmRedondeado: Dec
  readonly eoAplicada: boolean
}

/** Nm = He / (Ht · Eo). Eo se aplica una sola vez; si no está declarada, se calcula sin ella y se dice. */
export function calcularNm(he: Dec, ht: Dec, eo: Dec | null, donde: DondeEo, decimales: number): ResultadoNm {
  const factor = eo ?? dec(1)
  const nm = donde === 'denominador_capacidad' ? he.dividedBy(ht.times(factor)) : he.dividedBy(factor).dividedBy(ht)
  return { nm, nmRedondeado: redondear(nm, { tipo: 'mitad_arriba', decimales }), eoAplicada: eo !== null }
}

/** Decisión de adquisición: se justifica una máquina adicional si la fracción supera el umbral (1.56→2; 1.46→1). */
export function maquinasPorUmbral(nm: Dec, umbral: Dec): number {
  const entero = nm.floor()
  return entero.plus(nm.minus(entero).greaterThan(umbral) ? 1 : 0).toNumber()
}

// ---------------------------------------------------------------------------------------------
// Lectura del balance de maquinaria (usa el perfil de formato)
// ---------------------------------------------------------------------------------------------

interface FilaBalance {
  readonly fila: number
  readonly anual: Dec
  readonly rendimiento: Dec
  readonly capturada: Dec | null
  readonly disponibles: Dec | null
  readonly maquinas: Dec | null
}

function leerBalance(ctx: ContextoEvaluacion): { filas: FilaBalance[]; identificadas: number; omitidas: string[] } | null {
  if (!ctx.libro || !ctx.perfil) return null
  const b = ctx.perfil.balanceMaquinaria
  const filas: FilaBalance[] = []
  const omitidas: string[] = []
  let identificadas = 0
  for (let r = b.filas.desde; r <= b.filas.hasta; r++) {
    const f = ctx.libro.numero(b.hoja, `${b.colAnual}${r}`)
    const h = ctx.libro.numero(b.hoja, `${b.colRendimiento}${r}`)
    const i = ctx.libro.numero(b.hoja, `${b.colHorasNecesarias}${r}`)
    if (!f.ok && !h.ok && !i.ok) continue
    identificadas++
    if (!f.ok || !h.ok || !h.valor.greaterThan(0)) {
      omitidas.push(`${b.hoja}!${b.colAnual}${r}: falta cantidad anual o rendimiento > 0; no se evalúa ni se completa con cero`)
      continue
    }
    const j = ctx.libro.numero(b.hoja, `${b.colHorasDisponibles}${r}`)
    const k = ctx.libro.numero(b.hoja, `${b.colMaquinas}${r}`)
    filas.push({
      fila: r, anual: f.valor, rendimiento: h.valor, capturada: i.ok ? i.valor : null,
      disponibles: j.ok ? j.valor : null, maquinas: k.ok ? k.valor : null,
    })
  }
  return { filas, identificadas, omitidas }
}

// ---------------------------------------------------------------------------------------------
// MAQ-003  Horas efectivas: se divide, no se multiplica
// ---------------------------------------------------------------------------------------------

export const reglaMaq003: Regla = {
  meta: {
    id: 'MAQ-003', clase: 'UTILIZACIÓN DE MAQUINARIA', titulo: 'Horas efectivas: He = cantidad / rendimiento',
    severidadBase: 'alta', fuentes: [F_HE, F_A4, F_A5], requiereLibro: true, casosOro: ['TC-01', 'TC-02'],
  },
  evaluar(ctx): Resultado[] {
    const lectura = leerBalance(ctx)
    if (!lectura || !ctx.perfil) return [noEvaluable('MAQ-003', 'Requiere el libro y un perfil de formato')]
    const b = ctx.perfil.balanceMaquinaria
    const { filas, totalExacto } = calcularHorasEfectivas(
      lectura.filas.map((x) => ({ id: `${b.hoja}!${b.colHorasNecesarias}${x.fila}`, cantidad: x.anual, rendimiento: x.rendimiento, capturada: x.capturada })),
      ctx.parametros.redondeoHoras.valor,
    )
    const tol = ctx.parametros.tolerancia.valor
    const hallazgos: Hallazgo[] = []
    for (const f of filas) {
      if (f.exacta === null || f.capturada === null) continue
      if (dentroDeTolerancia(f.capturada, f.exacta, tol)) continue
      const como = f.reproducidaPor === 'truncado' ? 'truncando a entero' : f.reproducidaPor === 'redondeo' ? 'redondeando a entero' : 'sin una regla de redondeo identificable'
      hallazgos.push(crearHallazgo(ctx, {
        id: `MAQ-003:${f.id}:${f.reproducidaPor ?? 'distinto'}`, reglaId: 'MAQ-003',
        titulo: 'Horas capturadas distintas de la división exacta',
        detalle: `La cifra capturada se obtiene ${como}. Declarar la regla de redondeo de horas (PAR-17); no se corrige el libro.`,
        origen: 'pacot', severidad: 'media', referencias: [f.id], fuentes: [F_HE],
        esperado: aCadena(f.exacta), observado: aCadena(f.capturada), diferencia: aCadena(f.capturada.minus(f.exacta)),
        parametros: ['PAR-17', 'PAR-15'],
      }))
    }
    // Total capturado vs suma exacta (informativo: efecto del redondeo por fila)
    const totalCap = ctx.libro?.numero(b.hoja, `${b.colHorasNecesarias}${b.filaTotal}`)
    const sumaCapturadas = filas.reduce((a, f) => (f.capturada ? a.plus(f.capturada) : a), dec(0))
    if (totalCap?.ok && !dentroDeTolerancia(sumaCapturadas, totalExacto, tol)) {
      hallazgos.push(crearHallazgo(ctx, {
        id: `MAQ-003:${b.hoja}!${b.colHorasNecesarias}${b.filaTotal}:suma_exacta`, reglaId: 'MAQ-003',
        titulo: 'La suma de horas capturadas difiere de la suma exacta',
        detalle: 'Efecto acumulado de las horas capturadas con redondeo o truncado por fila.',
        origen: 'pacot', severidad: 'informativa', referencias: [`${b.hoja}!${b.colHorasNecesarias}${b.filaTotal}`], fuentes: [F_HE],
        esperado: aCadena(totalExacto), observado: aCadena(totalCap.valor), diferencia: aCadena(totalCap.valor.minus(totalExacto)),
        parametros: ['PAR-17'],
      }))
    }
    return [crearResultado({
      reglaId: 'MAQ-003', hallazgos, revisados: filas.filter((f) => f.exacta !== null).length, identificados: lectura.identificadas,
      unidad: 'filas del balance', pendientes: lectura.omitidas,
      calculos: [{ descripcion: 'Σ He exacta', entradas: { filas: String(filas.length) }, salida: aCadena(totalExacto) }],
    })]
  },
}

// ---------------------------------------------------------------------------------------------
// MAQ-004  Nm = He / (Ht · Eo), con Eo aplicada una sola vez
// ---------------------------------------------------------------------------------------------

export const reglaMaq004: Regla = {
  meta: {
    id: 'MAQ-004', clase: 'UTILIZACIÓN DE MAQUINARIA', titulo: 'Número de máquinas y aplicación de la eficiencia operativa',
    severidadBase: 'alta', fuentes: [F_NM, F_A4, F_A5], requiereLibro: true, casosOro: ['TC-01', 'TC-02'],
  },
  evaluar(ctx): Resultado[] {
    const lectura = leerBalance(ctx)
    if (!lectura || !ctx.perfil) return [noEvaluable('MAQ-004', 'Requiere el libro y un perfil de formato')]
    const b = ctx.perfil.balanceMaquinaria
    const p = ctx.parametros
    const tol = p.tolerancia.valor
    const hallazgos: Hallazgo[] = []
    let revisados = 0
    for (const f of lectura.filas) {
      if (f.capturada === null || f.disponibles === null || f.maquinas === null || !f.disponibles.greaterThan(0)) continue
      revisados++
      const esperado = calcularNm(f.capturada, f.disponibles, p.eo.valor, p.dondeEo.valor, 40).nm
      if (dentroDeTolerancia(f.maquinas, esperado, tol)) continue
      hallazgos.push(crearHallazgo(ctx, {
        id: `MAQ-004:${b.hoja}!${b.colMaquinas}${f.fila}:nm`, reglaId: 'MAQ-004',
        titulo: 'Equivalente de máquinas distinto de He/(Ht·Eo)',
        detalle: 'Comprobar si Eo se aplicó dos veces o si la base de horas es otra.',
        origen: 'pacot', severidad: 'alta', referencias: [`${b.hoja}!${b.colMaquinas}${f.fila}`], fuentes: [F_NM],
        esperado: aCadena(esperado), observado: aCadena(f.maquinas), diferencia: aCadena(f.maquinas.minus(esperado)),
        parametros: ['PAR-01', 'PAR-02', 'PAR-03', 'PAR-15'],
      }))
    }
    if (revisados > 0 && p.eo.valor === null) {
      hallazgos.push(crearHallazgo(ctx, {
        id: 'MAQ-004:eo_no_declarada', reglaId: 'MAQ-004',
        titulo: 'Eficiencia operativa no declarada: la capacidad se calculó sin Eo',
        detalle: 'El Manual §6.3 divide entre las horas disponibles (1,400) y §6.3.2 incluye Eo en el denominador; el Anexo 4 la lista y no la aplica. La norma no fija un valor de Eo (0.85 solo aparece en ejemplos).',
        origen: 'norma', severidad: 'informativa', referencias: [`${b.hoja}!${b.colMaquinas}${b.filas.desde}:${b.colMaquinas}${b.filas.hasta}`],
        fuentes: [F_NM, F_A4], parametros: ['PAR-02', 'PAR-03'],
        limites: ['Declarar Eo con sustento local o aceptar que la capacidad se mide sin ella.'],
      }))
    }
    return [crearResultado({
      reglaId: 'MAQ-004', hallazgos, revisados, identificados: lectura.identificadas, unidad: 'filas del balance', pendientes: lectura.omitidas,
    })]
  },
}

// ---------------------------------------------------------------------------------------------
// MAQ-005  Horas disponibles (Ht): parámetro declarado frente a lo usado en el libro
// ---------------------------------------------------------------------------------------------

/** Bandas por estado mecánico (Anexo 5 §3.2 col.5). Se solapan en 1,800 y 1,400: sin frontera declarada no se asigna banda. */
export const BANDAS_DISPONIBILIDAD = {
  nueva: { min: 1800, max: 2000 },
  buena: { min: 1400, max: 1800 },
  regular: { min: 1000, max: 1400 },
  mala: { min: 0, max: 1000 },
} as const

export function bandasQueContienen(horas: Dec): Array<keyof typeof BANDAS_DISPONIBILIDAD> {
  return (Object.keys(BANDAS_DISPONIBILIDAD) as Array<keyof typeof BANDAS_DISPONIBILIDAD>).filter((k) => {
    const x = BANDAS_DISPONIBILIDAD[k]
    return horas.greaterThanOrEqualTo(x.min) && horas.lessThanOrEqualTo(x.max)
  })
}

const HT_ALTERNOS = [1200]

export const reglaMaq005: Regla = {
  meta: {
    id: 'MAQ-005', clase: 'UTILIZACIÓN DE MAQUINARIA', titulo: 'Horas disponibles por máquina (Ht): parámetro declarado',
    severidadBase: 'alta', fuentes: [{ documento: MANUAL, seccion: '6.1 y 6.3' }, F_A5, { documento: 'Anexo 3', seccion: '4.2' }],
    requiereLibro: true, casosOro: ['TC-11'],
  },
  evaluar(ctx): Resultado[] {
    const lectura = leerBalance(ctx)
    if (!lectura || !ctx.perfil) return [noEvaluable('MAQ-005', 'Requiere el libro y un perfil de formato')]
    const b = ctx.perfil.balanceMaquinaria
    const htDeclarado = ctx.parametros.ht.valor
    const hallazgos: Hallazgo[] = []
    const distintos = new Map<string, string[]>()
    let revisados = 0
    for (const f of lectura.filas) {
      if (f.disponibles === null) continue
      revisados++
      if (f.disponibles.equals(htDeclarado)) continue
      const k = aCadena(f.disponibles)
      distintos.set(k, [...(distintos.get(k) ?? []), `${b.hoja}!${b.colHorasDisponibles}${f.fila}`])
    }
    for (const [valor, refs] of distintos) {
      const alterno = HT_ALTERNOS.includes(Number(valor))
      hallazgos.push(crearHallazgo(ctx, {
        id: `MAQ-005:ht:${valor}`, reglaId: 'MAQ-005',
        titulo: alterno ? 'Ht distinto del declarado: coincide con el alterno de los Anexos' : 'Ht sin respaldo en el Manual ni en los Anexos',
        detalle: alterno ? 'El Anexo 5 usa 1,200 h. Declarar el Ht de la organización (NOR-001); no es un error del PacOT.' : 'Acreditar las horas efectivas por equipo y estado (bitácora, estado mecánico).',
        origen: alterno ? 'norma' : 'pacot', severidad: alterno ? 'informativa' : 'media', referencias: refs, fuentes: [F_A5],
        esperado: aCadena(htDeclarado), observado: valor, parametros: ['PAR-01'], estadoEvidencia: 'pendiente_de_evidencia',
        dimensiones: { viabilidad: 'abierta', condicion_fisica: 'pendiente' },
      }))
    }
    // Total de horas disponibles capturado como constante
    const refTotal = `${b.colHorasDisponibles}${b.filaTotal}`
    const total = ctx.libro?.numero(b.hoja, refTotal)
    if (total?.ok && !ctx.libro?.formula(b.hoja, refTotal)) {
      const suma = lectura.filas.reduce((a, f) => (f.disponibles ? a.plus(f.disponibles) : a), dec(0))
      hallazgos.push(crearHallazgo(ctx, {
        id: `MAQ-005:${b.hoja}!${refTotal}:constante`, reglaId: 'MAQ-005',
        titulo: 'Total de horas disponibles capturado como constante',
        detalle: 'No es una fórmula ni coincide con la suma de las filas; su base no se puede rastrear.',
        origen: 'pacot', severidad: 'informativa', referencias: [`${b.hoja}!${refTotal}`], fuentes: [F_A5],
        esperado: aCadena(suma), observado: aCadena(total.valor), diferencia: aCadena(total.valor.minus(suma)), parametros: ['PAR-01'],
        estadoEvidencia: 'pendiente_de_evidencia',
      }))
    }
    return [crearResultado({
      reglaId: 'MAQ-005', hallazgos, revisados, identificados: lectura.identificadas, unidad: 'filas del balance',
      pendientes: ['Bandas por estado mecánico no evaluadas: requieren IM-01 por máquina y una frontera declarada (las bandas se solapan en 1,800 y 1,400).'],
    })]
  },
}
