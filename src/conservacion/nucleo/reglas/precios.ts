import { aCadena, dec, type Dec } from '../num/decimal'
import type { FuenteNorma, Hallazgo, OrigenHallazgo, Regla, Resultado } from '../tipos/regla'
import { crearHallazgo, crearResultado, noEvaluable } from './util'

const MANUAL = 'Manual de Conservación 2026'
const F_PU: FuenteNorma = { documento: MANUAL, seccion: '7.7 (precio unitario), ejemplos 1, 3 y 4' }
const F_APU: FuenteNorma = { documento: MANUAL, seccion: '7.5.6, 7.7 y 7.8; Anexo 5 Apéndice C' }

// ---------------------------------------------------------------------------------------------
// Tipos: un APU tal como lo declara un documento (el núcleo no sabe de dónde viene)
// ---------------------------------------------------------------------------------------------

export interface ComponenteManoDeObra {
  readonly cantidad: Dec
  readonly salarioBase: Dec
  readonly fsr: Dec
  readonly factorEspecialidad: Dec
}

export interface ApuDeclarado {
  readonly id: string
  readonly concepto: string
  /** Quién elaboró el APU: un error en un APU del Manual es de la norma, no del PacOT. */
  readonly origen: OrigenHallazgo
  readonly referencia: string
  /** Decimales con que se capturaron los importes (define cuánta diferencia es solo redondeo). */
  readonly precision: number
  /** Otros cargos directos por unidad (materiales, combustible). */
  readonly otrosCargos?: Dec
  readonly manoDeObra?: {
    readonly cuadrilla: readonly ComponenteManoDeObra[]
    readonly jornalDeclarado?: Dec
    readonly rendimientoDeclarado: Dec
    /** Rendimiento con que realmente se calculó el cargo, si difiere del declarado. */
    readonly rendimientoUsado?: Dec
    readonly cargoDeclarado?: Dec
  }
  readonly herramienta?: { readonly fraccion: Dec; readonly cargoDeclarado?: Dec }
  readonly equipo?: ReadonlyArray<{ readonly chd: Dec; readonly rendimiento: Dec; readonly cargoDeclarado?: Dec }>
  readonly costoDirectoDeclarado?: Dec
  /** Fracciones (0.23 = 23 %). Los valores del Manual (23 %, 2.95 %, 6 %, 0.5 %) son de ejemplo, no norma. */
  readonly cargos: {
    readonly indirecto: Dec
    readonly financiamiento?: Dec
    readonly utilidad?: Dec
    readonly adicionales?: Dec
  }
  readonly puDeclarado?: Dec
}

// ---------------------------------------------------------------------------------------------
// Cálculo puro
// ---------------------------------------------------------------------------------------------

/** Jornal de la cuadrilla = Σ cantidad × SM × FSR × factor de especialidad. */
export function jornalCuadrilla(c: readonly ComponenteManoDeObra[]): Dec {
  return c.reduce((a, x) => a.plus(x.cantidad.times(x.salarioBase).times(x.fsr).times(x.factorEspecialidad)), dec(0))
}

export const cargoPorRendimiento = (importe: Dec, rendimiento: Dec): Dec | null =>
  rendimiento.greaterThan(0) ? importe.dividedBy(rendimiento) : null

export type ModoRedondeoPU = 'exacto' | 'por_paso'

export interface PasosPU {
  readonly costoDirecto: Dec
  readonly indirecto: Dec
  readonly subtotalIndirecto: Dec
  readonly financiamiento: Dec
  readonly subtotalFinanciamiento: Dec
  readonly utilidad: Dec
  readonly subtotalUtilidad: Dec
  readonly adicionales: Dec
  readonly pu: Dec
}

/**
 * PU = CD · (1 + %ind) · (1 + %fin) · (1 + %util) · (1 + %adic), con cada porcentaje sobre el subtotal
 * anterior. 'por_paso' redondea cada importe a los decimales del documento (así se presentan los ejemplos).
 */
export function cadenaPU(cd: Dec, c: ApuDeclarado['cargos'], modo: ModoRedondeoPU, decimales = 2): PasosPU {
  const r = (x: Dec): Dec => (modo === 'por_paso' ? x.toDecimalPlaces(decimales) : x)
  const costoDirecto = r(cd)
  const indirecto = r(costoDirecto.times(c.indirecto))
  const subtotalIndirecto = costoDirecto.plus(indirecto)
  const financiamiento = r(subtotalIndirecto.times(c.financiamiento ?? 0))
  const subtotalFinanciamiento = subtotalIndirecto.plus(financiamiento)
  const utilidad = r(subtotalFinanciamiento.times(c.utilidad ?? 0))
  const subtotalUtilidad = subtotalFinanciamiento.plus(utilidad)
  const adicionales = r(subtotalUtilidad.times(c.adicionales ?? 0))
  return { costoDirecto, indirecto, subtotalIndirecto, financiamiento, subtotalFinanciamiento, utilidad, subtotalUtilidad, adicionales, pu: subtotalUtilidad.plus(adicionales) }
}

/** Diferencia máxima atribuible a que el documento imprime sus importes con `precision` decimales. */
export const mediaUnidad = (precision: number): Dec => dec(5).times(dec(10).pow(-(precision + 1)))

// ---------------------------------------------------------------------------------------------
// DYP-015  APU: componentes, rendimientos y unidades
// ---------------------------------------------------------------------------------------------

export const reglaDyp015: Regla = {
  meta: {
    id: 'DYP-015', clase: 'DIAGNÓSTICOS Y PROGRAMA', titulo: 'APU: componentes, rendimientos y unidades',
    severidadBase: 'media', fuentes: [F_APU], requiereLibro: false, casosOro: ['TC-05', 'TC-06'],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.apus || ctx.apus.length === 0) {
      return [noEvaluable('DYP-015', 'No se recibió ningún APU: el libro no lo trae (Dt_Maq vacío en Conchos) o no se cargó. Se informa como pendiente de evidencia, no como correcto.')]
    }
    const hallazgos: Hallazgo[] = []
    for (const a of ctx.apus) {
      const tol = mediaUnidad(a.precision)
      const base = { reglaId: 'DYP-015', fuentes: [F_APU], origen: a.origen, parametros: ['PAR-15'] as const, referencias: [a.referencia] }
      const dif = (obs: Dec, esp: Dec): boolean => obs.minus(esp).abs().greaterThan(tol)
      let cargoMO: Dec | null = null

      const mo = a.manoDeObra
      if (mo) {
        const jornal = jornalCuadrilla(mo.cuadrilla)
        if (mo.jornalDeclarado && dif(mo.jornalDeclarado, jornal)) {
          hallazgos.push(crearHallazgo(ctx, {
            ...base, id: `DYP-015:${a.id}:jornal`, titulo: `Jornal de la cuadrilla distinto de Σ cant × SM × FSR × F.esp. (${a.concepto})`,
            detalle: 'Recalcular cada renglón de la cuadrilla con su salario, factor de salario real y factor de especialidad.', severidad: 'media',
            esperado: aCadena(jornal.toDecimalPlaces(4)), observado: aCadena(mo.jornalDeclarado),
          }))
        }
        cargoMO = cargoPorRendimiento(jornal, mo.rendimientoDeclarado)
        if (cargoMO !== null && mo.cargoDeclarado && dif(mo.cargoDeclarado, cargoMO)) {
          const implicito = cargoPorRendimiento(jornal, mo.cargoDeclarado)
          const coincideUsado = mo.rendimientoUsado && implicito && implicito.minus(mo.rendimientoUsado).abs().lessThan('0.001')
          hallazgos.push(crearHallazgo(ctx, {
            ...base, id: `DYP-015:${a.id}:rendimiento`, titulo: `El cargo de mano de obra no corresponde al rendimiento declarado (${a.concepto})`,
            detalle: `Con el rendimiento declarado (${aCadena(mo.rendimientoDeclarado)}) el cargo sería ${aCadena(cargoMO.toDecimalPlaces(2))}; el cargo capturado implica un rendimiento de ${aCadena((implicito ?? dec(0)).toDecimalPlaces(3))}${coincideUsado ? `, que es el rendimiento usado (${aCadena(mo.rendimientoUsado ?? dec(0))})` : ''}. La unidad o el valor del rendimiento no son los mismos en todo el cálculo.`,
            severidad: 'media', esperado: aCadena(cargoMO.toDecimalPlaces(4)), observado: aCadena(mo.cargoDeclarado), diferencia: aCadena(mo.cargoDeclarado.minus(cargoMO).toDecimalPlaces(4)),
          }))
        }
      }
      for (const [i, e] of (a.equipo ?? []).entries()) {
        const cargo = cargoPorRendimiento(e.chd, e.rendimiento)
        if (cargo !== null && e.cargoDeclarado && dif(e.cargoDeclarado, cargo)) {
          hallazgos.push(crearHallazgo(ctx, {
            ...base, id: `DYP-015:${a.id}:equipo-${i + 1}`, titulo: `Cargo de equipo distinto de CHD / rendimiento (${a.concepto})`,
            detalle: 'Costo horario directo entre rendimiento en la misma base horaria (he).', severidad: 'media',
            esperado: aCadena(cargo.toDecimalPlaces(4)), observado: aCadena(e.cargoDeclarado),
          }))
        }
      }
      if (a.herramienta && cargoMO !== null) {
        const mod = a.manoDeObra?.cargoDeclarado ?? cargoMO
        const esp = mod.times(a.herramienta.fraccion)
        if (a.herramienta.cargoDeclarado && dif(a.herramienta.cargoDeclarado, esp)) {
          hallazgos.push(crearHallazgo(ctx, {
            ...base, id: `DYP-015:${a.id}:herramienta`, titulo: `Herramienta distinta del porcentaje de la mano de obra (${a.concepto})`,
            detalle: 'La herramienta se calcula sobre el cargo de mano de obra.', severidad: 'media',
            esperado: aCadena(esp.toDecimalPlaces(4)), observado: aCadena(a.herramienta.cargoDeclarado),
          }))
        }
      }
      // Costo directo = suma de los cargos (los declarados si existen; si no, los calculados)
      if (a.costoDirectoDeclarado) {
        const partes = [
          a.otrosCargos ?? dec(0),
          a.manoDeObra?.cargoDeclarado ?? cargoMO ?? dec(0),
          ...(a.equipo ?? []).map((e) => e.cargoDeclarado ?? cargoPorRendimiento(e.chd, e.rendimiento) ?? dec(0)),
          a.herramienta?.cargoDeclarado ?? (cargoMO && a.herramienta ? cargoMO.times(a.herramienta.fraccion) : dec(0)),
        ]
        const cd = partes.reduce((s, x) => s.plus(x), dec(0))
        if (dif(a.costoDirectoDeclarado, cd)) {
          hallazgos.push(crearHallazgo(ctx, {
            ...base, id: `DYP-015:${a.id}:costo_directo`, titulo: `Costo directo distinto de la suma de sus cargos (${a.concepto})`,
            detalle: 'Sin doble conteo de componentes ya incluidos.', severidad: 'media',
            esperado: aCadena(cd.toDecimalPlaces(4)), observado: aCadena(a.costoDirectoDeclarado),
          }))
        }
      }
    }
    return [crearResultado({ reglaId: 'DYP-015', hallazgos, revisados: ctx.apus.length, identificados: ctx.apus.length, unidad: 'APU' })]
  },
}

// ---------------------------------------------------------------------------------------------
// DYP-014  Cadena de precio unitario
// ---------------------------------------------------------------------------------------------

export const reglaDyp014: Regla = {
  meta: {
    id: 'DYP-014', clase: 'DIAGNÓSTICOS Y PROGRAMA', titulo: 'Cadena de precio unitario',
    severidadBase: 'media', fuentes: [F_PU], requiereLibro: false, casosOro: ['TC-05', 'TC-06', 'TC-07'],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.apus || ctx.apus.length === 0) {
      return [noEvaluable('DYP-014', 'No se recibió ningún APU con precio unitario: sin soporte no se concluye sobre los porcentajes. Pendiente de evidencia.')]
    }
    const hallazgos: Hallazgo[] = []
    let revisados = 0
    for (const a of ctx.apus) {
      if (!a.puDeclarado || !a.costoDirectoDeclarado) continue
      revisados++
      const tol = mediaUnidad(a.precision)
      const exacto = cadenaPU(a.costoDirectoDeclarado, a.cargos, 'exacto')
      const porPaso = cadenaPU(a.costoDirectoDeclarado, a.cargos, 'por_paso', a.precision)
      // Se acepta si coincide con cualquiera de las dos formas de presentación (con o sin redondeo por paso)
      const ok = a.puDeclarado.minus(exacto.pu).abs().lessThanOrEqualTo(tol) || a.puDeclarado.minus(porPaso.pu).abs().lessThanOrEqualTo(tol)
      if (ok) continue
      hallazgos.push(crearHallazgo(ctx, {
        reglaId: 'DYP-014', fuentes: [F_PU], origen: a.origen, parametros: ['PAR-15'], referencias: [a.referencia],
        id: `DYP-014:${a.id}:cadena`, titulo: `Precio unitario distinto de la cadena CD·(1+ind)·(1+fin)·(1+util)·(1+adic) (${a.concepto})`,
        detalle: 'Cada porcentaje se aplica sobre el subtotal anterior. Los porcentajes deben ser los del propio APU; los del Manual (23 %, 2.95 %, 6 %, 0.5 %) son de ejemplo. Comprobar también el sustento de los porcentajes.',
        severidad: 'media', esperado: aCadena(exacto.pu.toDecimalPlaces(4)), observado: aCadena(a.puDeclarado), diferencia: aCadena(a.puDeclarado.minus(exacto.pu).toDecimalPlaces(4)),
        limites: ['La cadena concilia aritméticamente; el sustento de los porcentajes y la vigencia del precio siguen pendientes.'],
      }))
    }
    return [crearResultado({ reglaId: 'DYP-014', hallazgos, revisados, identificados: ctx.apus.length, unidad: 'APU con precio unitario' })]
  },
}
