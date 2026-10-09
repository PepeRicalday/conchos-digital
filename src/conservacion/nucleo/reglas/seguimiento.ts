import { aCadena, type Dec } from '../num/decimal'
import type { FuenteNorma, Hallazgo, Regla, Resultado } from '../tipos/regla'
import { crearHallazgo, crearResultado, noEvaluable } from './util'

const MANUAL = 'Manual de Conservación 2026'
const F_9_4: FuenteNorma = { documento: MANUAL, seccion: '9.4 (evaluación)', pagina: 126 }
const F_A3: FuenteNorma = { documento: 'Anexo 3', seccion: 'Columna 10 (avance en porcentaje)' }

export type ClaseIndice = 'optima' | 'buena' | 'regular' | 'baja'

/** Fila de seguimiento: una celda en blanco es "sin dato", no avance cero. */
export interface FilaAvance {
  readonly id: string
  readonly concepto: string
  readonly referencia: string
  /** Cantidad programada en el año (programa autorizado). */
  readonly programada: Dec | null
  /** Cantidad necesaria en el año según el DNMACN. */
  readonly dnmacn: Dec | null
  /** Cantidad realizada en el año (avance ejecutado y aceptado). */
  readonly realizada: Dec | null
  readonly ejecutadoMes: Dec | null
  readonly avanceDeclaradoPct: Dec | null
}

/** % avance del mes = ejecutado en el mes / programado × 100 (SEG-3; Anexo 3 col.10). */
export function avancePorcentual(ejecutadoMes: Dec, programado: Dec): Dec | null {
  return programado.isZero() ? null : ejecutadoMes.dividedBy(programado).times(100)
}

/** Eficiencia de programación y de realización: cantidad / cantidad necesaria del DNMACN (Manual §9.4). */
export function indiceSobreDnmacn(cantidad: Dec, dnmacn: Dec): Dec | null {
  return dnmacn.isZero() ? null : cantidad.dividedBy(dnmacn)
}

/**
 * Bandas impresas en el Manual §9.4: 1.00 o más óptima; 0.80 a 0.99 buena; 0.60 a 0.79 regular; 0.59 o menos baja.
 * La tabla deja huecos entre decimales (0.995, 0.795, 0.595): sin una frontera declarada por la
 * organización no se inventa una banda y se devuelve null.
 */
export function clasificarIndice(i: Dec): ClaseIndice | null {
  if (i.greaterThanOrEqualTo('1.00')) return 'optima'
  if (i.greaterThanOrEqualTo('0.80') && i.lessThanOrEqualTo('0.99')) return 'buena'
  if (i.greaterThanOrEqualTo('0.60') && i.lessThanOrEqualTo('0.79')) return 'regular'
  if (i.lessThanOrEqualTo('0.59')) return 'baja'
  return null
}

export const reglaDyp018: Regla = {
  meta: {
    id: 'DYP-018', clase: 'DIAGNÓSTICOS Y PROGRAMA', titulo: 'Seguimiento: avance y los dos índices de eficiencia',
    severidadBase: 'media', fuentes: [F_9_4, F_A3], requiereLibro: false, casosOro: ['TC-10'],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.seguimiento || ctx.seguimiento.length === 0) {
      return [noEvaluable('DYP-018', 'No se recibieron filas de seguimiento con ejecución y DNMACN. Los blancos de seguimiento no prueban avance cero: pendiente de evidencia.')]
    }
    const hallazgos: Hallazgo[] = []
    const pendientes: string[] = []
    let revisados = 0
    for (const f of ctx.seguimiento) {
      const base = { reglaId: 'DYP-018', fuentes: [F_9_4, F_A3], referencias: [f.referencia], parametros: ['PAR-15'] as const }
      let evaluada = false

      if (f.ejecutadoMes !== null && f.programada !== null) {
        const calc = avancePorcentual(f.ejecutadoMes, f.programada)
        if (calc === null) {
          pendientes.push(`${f.referencia}: programado en cero; no se calcula un porcentaje engañoso`)
        } else {
          evaluada = true
          if (f.avanceDeclaradoPct !== null && f.avanceDeclaradoPct.minus(calc).abs().greaterThan('0.005')) {
            hallazgos.push(crearHallazgo(ctx, {
              ...base, id: `DYP-018:${f.id}:avance`, titulo: `Avance porcentual distinto de ejecutado/programado × 100 (${f.concepto})`,
              detalle: 'Se compara con el mismo corte temporal y la versión aprobada del programa.', origen: 'pacot', severidad: 'media',
              esperado: aCadena(calc.toDecimalPlaces(2)), observado: aCadena(f.avanceDeclaradoPct), dimensiones: { ejecucion: 'abierta', aritmetica: 'abierta' },
              estadoEvidencia: 'pendiente_de_evidencia',
            }))
          }
        }
      } else if (f.ejecutadoMes === null) {
        pendientes.push(`${f.referencia}: ejecutado del mes en blanco; no se interpreta como avance cero`)
      }

      for (const [nombre, valor] of [['programación', f.programada], ['realización', f.realizada]] as const) {
        if (valor === null || f.dnmacn === null) continue
        const i = indiceSobreDnmacn(valor, f.dnmacn)
        if (i === null) { pendientes.push(`${f.referencia}: DNMACN en cero; el índice de ${nombre} no se calcula`); continue }
        evaluada = true
        if (clasificarIndice(i) === null) {
          hallazgos.push(crearHallazgo(ctx, {
            ...base, id: `DYP-018:${f.id}:banda-${nombre}`, titulo: `Índice de ${nombre} fuera de las bandas impresas (${f.concepto})`,
            detalle: `El índice ${aCadena(i.toDecimalPlaces(4))} cae en un hueco entre bandas del Manual §9.4 (≥1.00; 0.80–0.99; 0.60–0.79; ≤0.59). Declarar la frontera; no se asigna una banda.`,
            origen: 'norma', severidad: 'informativa', observado: aCadena(i.toDecimalPlaces(4)), dimensiones: { ejecucion: 'pendiente' },
          }))
        }
      }
      if (evaluada) revisados++
    }
    return [crearResultado({ reglaId: 'DYP-018', hallazgos, revisados, identificados: ctx.seguimiento.length, unidad: 'filas de seguimiento', pendientes })]
  },
}

