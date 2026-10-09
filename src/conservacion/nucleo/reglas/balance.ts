import { aCadena, dec, type Dec } from '../num/decimal'
import type { FuenteNorma, Hallazgo, Regla, Resultado } from '../tipos/regla'
import { maquinasPorUmbral } from './maq'
import { crearHallazgo, crearResultado, noEvaluable, textoDeCelda } from './util'

const F_BAL: FuenteNorma = { documento: 'Manual de Conservación 2026', seccion: '6.3 (balance de maquinaria)' }
const F_A5: FuenteNorma = { documento: 'Anexo 5', seccion: '3.1 pasos 5 a 10' }

export interface EntradaBalanceTipo {
  /** Número de máquinas necesarias, con fracción (capacidad, no unidades físicas). */
  readonly nm: Dec
  /** Total existente del tipo, sin importar la modalidad de adquisición (Manual §6.3). */
  readonly existentes: number
  readonly buenoRegular: number
  readonly malo: number
  readonly baja: number
  readonly umbral: Dec
}

export interface BalanceTipo {
  /** Unidades requeridas con el umbral de adquisición (1.56 → 2; 1.46 → 1). */
  readonly requeridas: number
  /** requeridas − existentes, si es positiva. */
  readonly faltante: number
  /** existentes − requeridas, si es positiva. */
  readonly sobrante: number
  /** bueno/regular + malo + baja: debe sumar las existentes. */
  readonly sumaCondicion: number
}

/**
 * Núcleo puro de MAQ-006. La fracción de Nm es capacidad y no una máquina física: la decisión de
 * adquisición usa el umbral (> 0.5), pero eso no acredita suficiencia de horas.
 */
export function balanceTipo(e: EntradaBalanceTipo): BalanceTipo {
  const requeridas = maquinasPorUmbral(e.nm, e.umbral)
  return {
    requeridas,
    faltante: Math.max(0, requeridas - e.existentes),
    sobrante: Math.max(0, e.existentes - requeridas),
    sumaCondicion: e.buenoRegular + e.malo + e.baja,
  }
}

export const reglaMaq006: Regla = {
  meta: {
    id: 'MAQ-006', clase: 'UTILIZACIÓN DE MAQUINARIA', titulo: 'Redondeo y decisión de adquisición',
    severidadBase: 'media', fuentes: [F_BAL, F_A5], requiereLibro: true, casosOro: ['TC-09'],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.libro || !ctx.perfil) return [noEvaluable('MAQ-006', 'Requiere el libro y un perfil de formato')]
    const t = ctx.perfil.tablaMaquinaria
    const libro = ctx.libro
    const umbral = ctx.parametros.umbralAdquisicion.valor
    const hallazgos: Hallazgo[] = []
    const pendientes: string[] = []
    let identificadas = 0
    let revisadas = 0
    const ref = (col: string, fila: number): string => `${t.hoja}!${col}${fila}`
    const leer = (col: string, fila: number): Dec | null => {
      const n = libro.numero(t.hoja, `${col}${fila}`)
      return n.ok ? n.valor : null
    }
    const sumas = new Map<string, Dec>()
    const acumular = (col: string, v: Dec | null): void => { if (v !== null) sumas.set(col, (sumas.get(col) ?? dec(0)).plus(v)) }

    for (let r = t.filas.desde; r <= t.filas.hasta; r++) {
      const nm = leer(t.colNm, r)
      const tipo = textoDeCelda(libro.texto(t.hoja, `${t.colTipo}${r}`))
      const decl = {
        existentes: leer(t.colExistentes, r), faltante: leer(t.colFaltante, r), sobrante: leer(t.colSobrante, r),
        buenoRegular: leer(t.colBuenoRegular, r), malo: leer(t.colMalo, r), baja: leer(t.colBaja, r),
        porFaltante: leer(t.colPorFaltante, r), porSustituir: leer(t.colPorSustituir, r), suma: leer(t.colSuma, r),
      }
      for (const [col, v] of [[t.colNm, nm], [t.colExistentes, decl.existentes], [t.colFaltante, decl.faltante], [t.colSobrante, decl.sobrante],
        [t.colBuenoRegular, decl.buenoRegular], [t.colMalo, decl.malo], [t.colBaja, decl.baja], [t.colPorFaltante, decl.porFaltante],
        [t.colPorSustituir, decl.porSustituir], [t.colSuma, decl.suma]] as const) acumular(col, v)

      if (nm === null) {
        if (Object.values(decl).some((v) => v !== null)) pendientes.push(`${t.hoja}!fila ${r} (${tipo}): hay datos pero falta el número de máquinas necesarias`)
        continue
      }
      identificadas++
      revisadas++
      // Una celda de existentes en blanco se interpreta como ninguna unidad inventariada solo para derivar el balance.
      const existentes = (decl.existentes ?? dec(0)).toNumber()
      const b = balanceTipo({
        nm, existentes, buenoRegular: (decl.buenoRegular ?? dec(0)).toNumber(), malo: (decl.malo ?? dec(0)).toNumber(),
        baja: (decl.baja ?? dec(0)).toNumber(), umbral,
      })
      const comunes = { reglaId: 'MAQ-006', fuentes: [F_BAL, F_A5], parametros: ['PAR-04'] as const }

      // Faltante: el PacOT declara una adquisición que el umbral no justifica (o no la declara)
      const faltDecl = (decl.faltante ?? dec(0)).toNumber()
      if (faltDecl !== b.faltante) {
        const sinJustificar = faltDecl > b.faltante
        hallazgos.push(crearHallazgo(ctx, {
          ...comunes, id: `MAQ-006:${ref(t.colFaltante, r)}:faltante`,
          titulo: sinJustificar ? `Faltante declarado que el umbral de adquisición no justifica (${tipo})` : `Faltante calculado no capturado (${tipo})`,
          detalle: sinJustificar
            ? `Necesidad ${aCadena(nm.toDecimalPlaces(3))} máquinas: con el umbral de ${aCadena(umbral)} se requieren ${b.requeridas}; existentes ${existentes}. La fracción es capacidad y no acredita suficiencia de horas, pero el Manual §6.3 solo justifica adquirir cuando la fracción supera el umbral. Acreditar la causa (horas faltantes, sustitución) o corregir el criterio.`
            : `Con el umbral se requieren ${b.requeridas} y hay ${existentes}: faltan ${b.faltante}.`,
          origen: 'pacot', severidad: 'media', referencias: [ref(t.colNm, r), ref(t.colFaltante, r)], esperado: String(b.faltante), observado: aCadena(decl.faltante ?? dec(0)),
          estadoEvidencia: 'pendiente_de_evidencia', dimensiones: { viabilidad: 'abierta', aritmetica: 'verificada', condicion_fisica: 'pendiente' },
        }))
      }
      // Sobrante calculado y no capturado
      const sobDecl = (decl.sobrante ?? dec(0)).toNumber()
      if (sobDecl !== b.sobrante) {
        hallazgos.push(crearHallazgo(ctx, {
          ...comunes, id: `MAQ-006:${ref(t.colSobrante, r)}:sobrante`, titulo: `Sobrante calculado distinto del capturado (${tipo})`,
          detalle: `Con el umbral se requieren ${b.requeridas} y existen ${existentes}. El Manual cuenta las existentes sin importar su condición; aquí buena/regular ${aCadena(decl.buenoRegular ?? dec(0))}, mala ${aCadena(decl.malo ?? dec(0))}, baja ${aCadena(decl.baja ?? dec(0))}. Un sobrante en mal estado no es capacidad disponible: aclarar el criterio antes de transferirlo o darlo de baja.`,
          origen: 'norma', severidad: 'informativa', referencias: [ref(t.colExistentes, r), ref(t.colSobrante, r)], esperado: String(b.sobrante), observado: aCadena(decl.sobrante ?? dec(0)),
          dimensiones: { viabilidad: 'pendiente' }, estadoEvidencia: 'aclarada_por_usuario',
        }))
      }
      // La condición debe sumar las existentes
      if (decl.existentes !== null && b.sumaCondicion !== existentes) {
        hallazgos.push(crearHallazgo(ctx, {
          ...comunes, id: `MAQ-006:${ref(t.colExistentes, r)}:condicion`, titulo: `Estado del parque no suma las existentes (${tipo})`,
          detalle: 'Bueno/regular + malo + baja debe igualar las unidades existentes.', origen: 'pacot', severidad: 'media',
          referencias: [ref(t.colExistentes, r), ref(t.colBuenoRegular, r)], esperado: String(existentes), observado: String(b.sumaCondicion),
        }))
      }
      // Adquisición total = por faltante + por sustituir
      if (decl.suma !== null || decl.porFaltante !== null || decl.porSustituir !== null) {
        const esperado = (decl.porFaltante ?? dec(0)).plus(decl.porSustituir ?? dec(0))
        if (!esperado.equals(decl.suma ?? dec(0))) {
          hallazgos.push(crearHallazgo(ctx, {
            ...comunes, id: `MAQ-006:${ref(t.colSuma, r)}:suma_adquisicion`, titulo: `La suma de adquisición no iguala faltante + sustitución (${tipo})`,
            detalle: 'No se suman dos veces faltante, sustitución y rehabilitación como equipo adicional.', origen: 'pacot', severidad: 'media',
            referencias: [ref(t.colPorFaltante, r), ref(t.colPorSustituir, r), ref(t.colSuma, r)], esperado: aCadena(esperado), observado: aCadena(decl.suma ?? dec(0)),
          }))
        }
      }
    }

    // Fila de totales: valor capturado frente a la suma de las filas
    for (const col of [t.colNm, t.colExistentes, t.colFaltante, t.colSobrante, t.colBuenoRegular, t.colMalo, t.colBaja, t.colPorFaltante, t.colPorSustituir, t.colSuma]) {
      const total = leer(col, t.filaTotal)
      if (total === null) continue
      const suma = sumas.get(col) ?? dec(0)
      if (total.minus(suma).abs().lessThanOrEqualTo(ctx.parametros.tolerancia.valor.absoluta)) continue
      const esConstante = !libro.formula(t.hoja, `${col}${t.filaTotal}`)
      hallazgos.push(crearHallazgo(ctx, {
        reglaId: 'MAQ-006', fuentes: [F_BAL, F_A5], parametros: ['PAR-15'], id: `MAQ-006:${ref(col, t.filaTotal)}:total`,
        titulo: `Total de la columna ${col} distinto de la suma de sus filas`,
        detalle: esConstante ? 'El total está capturado como constante, sin fórmula: no se actualiza al cambiar las filas.' : 'El rango de la fórmula no coincide con las filas del cuadro.',
        origen: 'pacot', severidad: 'media', referencias: [ref(col, t.filaTotal)], esperado: aCadena(suma), observado: aCadena(total), diferencia: aCadena(total.minus(suma)),
      }))
    }
    return [crearResultado({ reglaId: 'MAQ-006', hallazgos, revisados: revisadas, identificados: identificadas, unidad: 'tipos de máquina con necesidad', pendientes })]
  },
}
