import { declararParametros, type ParId } from '../parametros/catalogo'
import type {
  ContextoEvaluacion, Dimension, EstadoEvidencia, FuenteNorma, Hallazgo, OrigenHallazgo, Resultado, Severidad, TrazaCalculo,
} from '../tipos/regla'

export interface DatosHallazgo {
  readonly id: string
  readonly reglaId: string
  readonly titulo: string
  readonly detalle: string
  readonly origen: OrigenHallazgo
  readonly severidad: Severidad
  readonly referencias: readonly string[]
  readonly fuentes: readonly FuenteNorma[]
  readonly esperado?: string
  readonly observado?: string
  readonly diferencia?: string
  readonly dimensiones?: Readonly<Partial<Record<Dimension, 'abierta' | 'verificada' | 'pendiente'>>>
  readonly estadoEvidencia?: EstadoEvidencia
  readonly parametros?: readonly ParId[]
  readonly limites?: readonly string[]
}

const LIMITE_FISICO = 'La coincidencia aritmética no acredita la condición física de la obra.'

export function crearHallazgo(ctx: ContextoEvaluacion, d: DatosHallazgo): Hallazgo {
  const decl = declararParametros(ctx.parametros)
  const usados = (d.parametros ?? []).flatMap((id) => {
    const p = decl.find((x) => x.id === id)
    return p ? [{ id: p.id, valor: p.valor, fuente: p.fuente }] : []
  })
  return {
    id: d.id, reglaId: d.reglaId, titulo: d.titulo, detalle: d.detalle, origen: d.origen, severidad: d.severidad,
    dimensiones: d.dimensiones ?? { aritmetica: 'abierta', condicion_fisica: 'pendiente' },
    fuentes: d.fuentes, referencias: d.referencias,
    ...(d.esperado !== undefined ? { esperado: d.esperado } : {}),
    ...(d.observado !== undefined ? { observado: d.observado } : {}),
    ...(d.diferencia !== undefined ? { diferencia: d.diferencia } : {}),
    estadoEvidencia: d.estadoEvidencia ?? 'verificada_en_archivo',
    baseValores: ctx.libro ? ctx.libro.libro.baseValores : 'sin_libro',
    parametrosUsados: usados,
    limites: d.limites ?? [LIMITE_FISICO],
  }
}

export interface DatosResultado {
  readonly reglaId: string
  readonly hallazgos: readonly Hallazgo[]
  readonly calculos?: readonly TrazaCalculo[]
  readonly revisados: number
  readonly identificados: number
  readonly unidad: string
  readonly pendientes?: readonly string[]
}

export function crearResultado(d: DatosResultado): Resultado {
  return {
    reglaId: d.reglaId,
    estado: d.hallazgos.length > 0 ? 'hallazgo' : 'superada',
    hallazgos: d.hallazgos,
    calculos: d.calculos ?? [],
    cobertura: { revisados: d.revisados, identificados: d.identificados, unidad: d.unidad },
    pendientes: d.pendientes ?? [],
  }
}

export function noEvaluable(reglaId: string, motivo: string): Resultado {
  return {
    reglaId, estado: 'no_evaluable', hallazgos: [], calculos: [],
    cobertura: { revisados: 0, identificados: 0, unidad: 'n/a' }, pendientes: [], motivo,
  }
}

/** Texto seguro: el contenido de celdas proviene del documento y es un dato, nunca una instrucción. */
export function textoDeCelda(s: string | null, max = 80): string {
  if (s === null) return ''
  // eslint-disable-next-line no-control-regex
  const limpio = s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return limpio.length > max ? `${limpio.slice(0, max)}…` : limpio
}
