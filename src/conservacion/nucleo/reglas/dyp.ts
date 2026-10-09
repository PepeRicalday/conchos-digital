import { aCadena, type Dec, type Tolerancia } from '../num/decimal'
import { clasificarEtiqueta, diagnosticarFrecuencia, type DiagnosticoFrecuencia, type SemanticaEtiqueta } from '../num/frecuencia'
import type { FuenteNorma, Hallazgo, Regla, Resultado } from '../tipos/regla'
import { crearHallazgo, crearResultado, noEvaluable, textoDeCelda } from './util'

const F_FREC: FuenteNorma = { documento: 'Manual de Conservación 2026', seccion: '5.6; ejemplos pp.57, 65, 66' }
const F_A3: FuenteNorma = { documento: 'Anexo 3', seccion: '3.2.4 (tabla de frecuencias)' }

export interface FilaFrecuencia {
  readonly cantidadTotal: Dec
  readonly cantidadAnual: Dec
  readonly fImpresa: Dec
  readonly etiqueta: string
}

export interface AnalisisFrecuencia {
  readonly diagnostico: DiagnosticoFrecuencia
  readonly etiqueta: SemanticaEtiqueta
}

/** Núcleo puro de DYP-006: despeja F de las cantidades y revisa el rótulo, sin interpretar la etiqueta. */
export function analizarFilaFrecuencia(f: FilaFrecuencia, tolerancia: Tolerancia): AnalisisFrecuencia {
  return {
    diagnostico: diagnosticarFrecuencia({ cantidadTotal: f.cantidadTotal, cantidadAnual: f.cantidadAnual, fImpresa: f.fImpresa, tolerancia }),
    etiqueta: clasificarEtiqueta(f.etiqueta),
  }
}

export const reglaDyp006: Regla = {
  meta: {
    id: 'DYP-006', clase: 'DIAGNÓSTICOS Y PROGRAMA', titulo: 'Frecuencia: semántica y precisión',
    severidadBase: 'alta', fuentes: [F_FREC, F_A3], requiereLibro: true, casosOro: ['TC-03', 'TC-04'],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.libro || !ctx.perfil) return [noEvaluable('DYP-006', 'Requiere el libro y un perfil de formato')]
    const n = ctx.perfil.necesidadMedia
    const hallazgos: Hallazgo[] = []
    const pendientes: string[] = []
    let identificados = 0
    let revisados = 0
    for (let r = n.filas.desde; r <= n.filas.hasta; r++) {
      const total = ctx.libro.numero(n.hoja, `${n.colCantidadTotal}${r}`)
      const f = ctx.libro.numero(n.hoja, `${n.colFrecuencia}${r}`)
      const anual = ctx.libro.numero(n.hoja, `${n.colNecesidadAnual}${r}`)
      if (!total.ok && !f.ok && !anual.ok) continue
      identificados++
      if (!total.ok || !f.ok || !anual.ok) {
        pendientes.push(`${n.hoja}!fila ${r}: faltan cantidad total, frecuencia o necesidad anual; no se completan con cero`)
        continue
      }
      revisados++
      const concepto = textoDeCelda(ctx.libro.texto(n.hoja, `${n.colConcepto}${r}`))
      const etiquetaTxt = textoDeCelda(ctx.libro.texto(n.hoja, `${n.colEtiqueta}${r}`))
      const a = analizarFilaFrecuencia({ cantidadTotal: total.valor, cantidadAnual: anual.valor, fImpresa: f.valor, etiqueta: etiquetaTxt }, ctx.parametros.tolerancia.valor)
      const ref = `${n.hoja}!${n.colFrecuencia}${r}`
      const base = { reglaId: 'DYP-006', referencias: [ref, `${n.hoja}!${n.colNecesidadAnual}${r}`], fuentes: [F_FREC, F_A3], parametros: ['PAR-15'] as const }
      const d = a.diagnostico

      if (d.tipo === 'incongruente') {
        hallazgos.push(crearHallazgo(ctx, {
          ...base, id: `DYP-006:${ref}:incongruente`, titulo: `Frecuencia incongruente (${concepto})`,
          detalle: 'La necesidad anual no corresponde a cantidad total × frecuencia ni a su inversa.',
          origen: 'pacot', severidad: 'alta', esperado: aCadena(d.fDespejada), observado: aCadena(f.valor),
          dimensiones: { frecuencia: 'abierta', aritmetica: 'abierta', condicion_fisica: 'pendiente' },
        }))
      } else if (d.tipo === 'periodicidad_en_columna_de_frecuencia') {
        hallazgos.push(crearHallazgo(ctx, {
          ...base, id: `DYP-006:${ref}:periodicidad`, titulo: `La columna de frecuencia contiene la periodicidad (${concepto})`,
          detalle: `La cantidad anual implica F = ${aCadena(d.fDespejada)} (cada ${aCadena(d.periodoAnios)} años); el valor impreso es el periodo, no F. No se invierte ni se corrige el libro.`,
          origen: 'formato', severidad: 'alta', esperado: aCadena(d.fDespejada), observado: aCadena(f.valor),
          dimensiones: { frecuencia: 'abierta', condicion_fisica: 'pendiente' },
        }))
      } else if (d.tipo === 'redondeo_de_presentacion') {
        hallazgos.push(crearHallazgo(ctx, {
          ...base, id: `DYP-006:${ref}:redondeo`, titulo: `Frecuencia mostrada redondeada (${concepto})`,
          detalle: `F exacta = 1/${aCadena(d.periodoAnios)}; el valor mostrado es solo presentación. Calcular con la fracción exacta.`,
          origen: 'formato', severidad: 'informativa', esperado: aCadena(d.fExacta), observado: aCadena(f.valor),
          dimensiones: { frecuencia: 'verificada' },
        }))
      } else if (d.tipo === 'consistente') {
        // La etiqueta no se interpreta: si habla de meses y la salida es anual, hay que aclararlo (no multiplicar por 12).
        if (a.etiqueta === 'mensual') {
          hallazgos.push(crearHallazgo(ctx, {
            ...base, id: `DYP-006:${ref}:etiqueta_mensual`, titulo: `Etiqueta de frecuencia mensual con salida anual (${concepto})`,
            detalle: `El rótulo "${etiquetaTxt}" no concuerda con una necesidad media anual calculada como cantidad × F, sin factor de conversión. Aclarar si F son eventos por año, por mes o un intervalo; no se multiplica por 12.`,
            origen: 'formato', severidad: 'alta', esperado: 'rótulo anual (veces/año) o factor de conversión explícito', observado: etiquetaTxt,
            dimensiones: { frecuencia: 'abierta', aritmetica: 'verificada', condicion_fisica: 'pendiente' },
            estadoEvidencia: 'aclarada_por_usuario',
          }))
        } else if (a.etiqueta === 'desconocida') {
          hallazgos.push(crearHallazgo(ctx, {
            ...base, id: `DYP-006:${ref}:etiqueta_desconocida`, titulo: `Etiqueta de frecuencia no interpretable (${concepto})`,
            detalle: 'La aritmética cuadra pero el rótulo no dice si F es anual.', origen: 'formato', severidad: 'informativa',
            observado: etiquetaTxt, dimensiones: { frecuencia: 'pendiente' },
          }))
        }
      }
    }
    return [crearResultado({ reglaId: 'DYP-006', hallazgos, revisados, identificados, unidad: 'conceptos de necesidad media', pendientes })]
  },
}
