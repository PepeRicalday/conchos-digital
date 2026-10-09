import { z } from 'zod'
import { dec, TOLERANCIA_EXACTA, type Dec, type Tolerancia } from '../num/decimal'
import { REDONDEO_EXACTO, type ReglaRedondeo } from '../num/redondeo'
import type { FuenteNorma } from '../tipos/regla'

/**
 * Parámetros normativos con fuente (NOR-001). Los valores en conflicto entre documentos no son
 * constantes: son parámetros. Criterio del usuario (2026-10-09): el Manual de Conservación 2026
 * prevalece sobre los Anexos, que se informan como alternos.
 */
export type ParId = 'PAR-01' | 'PAR-02' | 'PAR-03' | 'PAR-04' | 'PAR-05' | 'PAR-15' | 'PAR-17'
export type OrigenParametro = 'defecto_manual_2026' | 'organizacion' | 'distrito' | 'sesion'

export interface ValorParametro<T> {
  readonly id: ParId
  readonly nombre: string
  readonly valor: T
  readonly fuente: FuenteNorma
  readonly origen: OrigenParametro
  readonly alternos: ReadonlyArray<{ readonly descripcion: string; readonly fuente: FuenteNorma }>
  /** Obligatorio cuando el origen no es el defecto del Manual. */
  readonly sustento?: string
}

export type DondeEo = 'denominador_capacidad' | 'divide_horas'

export interface Parametros {
  /** PAR-01 horas efectivas disponibles por máquina al año. */
  readonly ht: ValorParametro<Dec>
  /** PAR-02 eficiencia operativa. La norma NO fija valor (los ejemplos usan 0.85): null = no declarada. */
  readonly eo: ValorParametro<Dec | null>
  /** PAR-03 dónde se aplica Eo; solo una vez. */
  readonly dondeEo: ValorParametro<DondeEo>
  /** PAR-04 umbral de adquisición: se justifica si la necesidad supera este valor de máquina. */
  readonly umbralAdquisicion: ValorParametro<Dec>
  /** PAR-05 decimales de la capacidad Nm. */
  readonly decimalesCapacidad: ValorParametro<number>
  /** PAR-17 (propuesto) regla de redondeo de las horas efectivas. Por defecto, exactas. */
  readonly redondeoHoras: ValorParametro<ReglaRedondeo>
  /** PAR-15 tolerancia, declarada antes de comparar. */
  readonly tolerancia: ValorParametro<Tolerancia>
}

const MANUAL = 'Manual de Conservación 2026'
const A5 = 'Anexo 5'
const A4 = 'Anexo 4'

export const PARAMETROS_POR_DEFECTO: Parametros = {
  ht: {
    id: 'PAR-01', nombre: 'Horas efectivas disponibles por máquina (Ht)', valor: dec(1400),
    fuente: { documento: MANUAL, seccion: 'cap. 6, 6.3' }, origen: 'defecto_manual_2026',
    alternos: [
      { descripcion: '1,200 h/año', fuente: { documento: A5, seccion: '3.1 nota; Manual ej. 6.3.2' } },
      { descripcion: 'Bandas por estado mecánico: Nueva 2,000–1,800; Buena 1,800–1,400; Regular 1,400–1,000; Mala <1,000', fuente: { documento: A5, seccion: '3.2 col.5' } },
    ],
  },
  eo: {
    id: 'PAR-02', nombre: 'Eficiencia operativa (Eo)', valor: null,
    fuente: { documento: MANUAL, seccion: '6.3.2' }, origen: 'defecto_manual_2026',
    alternos: [{ descripcion: '0.85 solo aparece en los ejemplos', fuente: { documento: A4, seccion: '3 p.7' } }],
  },
  dondeEo: {
    id: 'PAR-03', nombre: 'Dónde se aplica Eo', valor: 'denominador_capacidad',
    fuente: { documento: MANUAL, seccion: '6.3.2' }, origen: 'defecto_manual_2026',
    alternos: [{ descripcion: 'horas = cantidad/(R·Eo) (UM-1 col.6)', fuente: { documento: A5, seccion: '3.2 col.6' } }],
  },
  umbralAdquisicion: {
    id: 'PAR-04', nombre: 'Umbral de adquisición', valor: dec('0.5'),
    fuente: { documento: MANUAL, seccion: '6.3' }, origen: 'defecto_manual_2026', alternos: [],
  },
  decimalesCapacidad: {
    id: 'PAR-05', nombre: 'Decimales de capacidad Nm', valor: 2,
    fuente: { documento: MANUAL, seccion: '6.3' }, origen: 'defecto_manual_2026', alternos: [],
  },
  redondeoHoras: {
    id: 'PAR-17', nombre: 'Redondeo de horas efectivas (propuesto)', valor: REDONDEO_EXACTO,
    fuente: { documento: 'Matriz norma-regla-prueba', seccion: 'PAR-17 (decisión 2026-10-09)' }, origen: 'defecto_manual_2026',
    alternos: [{ descripcion: 'truncar a entero (observado en B Maq fila 13)', fuente: { documento: A4, seccion: '3 p.7' } }],
  },
  tolerancia: {
    id: 'PAR-15', nombre: 'Tolerancia numérica', valor: TOLERANCIA_EXACTA,
    fuente: { documento: 'references/validaciones.md', seccion: 'Presupuesto' }, origen: 'defecto_manual_2026', alternos: [],
  },
}

// --- Overrides por organización (validados con Zod; un override exige sustento) -----------------

const sustento = z.string().min(5)
const origenOverride = z.enum(['organizacion', 'distrito', 'sesion'])
const num = z.union([z.number().finite(), z.string().regex(/^-?\d+(\.\d+)?$/)])
const ov = <T extends z.ZodTypeAny>(valor: T) => z.object({ valor, sustento, origen: origenOverride }).strict()

const esquemaRedondeo = z.union([
  z.object({ tipo: z.literal('exacto') }).strict(),
  z.object({ tipo: z.literal('mitad_arriba'), decimales: z.number().int().min(0).max(10) }).strict(),
  z.object({ tipo: z.literal('truncar'), decimales: z.number().int().min(0).max(10) }).strict(),
])

export const esquemaOverrides = z.object({
  ht: ov(num).optional(),
  eo: ov(z.union([num, z.null()])).optional(),
  dondeEo: ov(z.enum(['denominador_capacidad', 'divide_horas'])).optional(),
  umbralAdquisicion: ov(num).optional(),
  decimalesCapacidad: ov(z.number().int().min(0).max(6)).optional(),
  redondeoHoras: ov(esquemaRedondeo).optional(),
}).strict()

export type OverridesParametros = z.input<typeof esquemaOverrides>

export interface ResolucionParametros {
  readonly parametros: Parametros
  readonly avisos: readonly string[]
}

export function resolverParametros(overrides?: unknown): ResolucionParametros {
  if (overrides === undefined) return { parametros: PARAMETROS_POR_DEFECTO, avisos: [] }
  const o = esquemaOverrides.parse(overrides)
  const avisos: string[] = []
  const p = PARAMETROS_POR_DEFECTO

  const ajustar = <T>(base: ValorParametro<T>, x: { valor: unknown; sustento: string; origen: OrigenParametro } | undefined, convertir: (v: unknown) => T): ValorParametro<T> => {
    if (!x) return base
    avisos.push(`${base.id} ${base.nombre}: valor de ${x.origen} (${x.sustento}) en lugar del defecto del Manual`)
    return { ...base, valor: convertir(x.valor), origen: x.origen, sustento: x.sustento }
  }

  const parametros: Parametros = {
    ...p,
    ht: ajustar(p.ht, o.ht, (v) => dec(v as number | string)),
    eo: ajustar(p.eo, o.eo, (v) => (v === null ? null : dec(v as number | string))),
    dondeEo: ajustar(p.dondeEo, o.dondeEo, (v) => v as DondeEo),
    umbralAdquisicion: ajustar(p.umbralAdquisicion, o.umbralAdquisicion, (v) => dec(v as number | string)),
    decimalesCapacidad: ajustar(p.decimalesCapacidad, o.decimalesCapacidad, (v) => v as number),
    redondeoHoras: ajustar(p.redondeoHoras, o.redondeoHoras, (v) => v as ReglaRedondeo),
  }
  return { parametros, avisos }
}

export interface DeclaracionParametro {
  readonly id: ParId
  readonly nombre: string
  readonly valor: string
  readonly fuente: FuenteNorma
  readonly origen: OrigenParametro
  readonly alternos: readonly string[]
  readonly sustento?: string
}

const texto = (v: unknown): string => {
  if (v === null) return 'no declarada'
  if (typeof v === 'object' && v !== null && 'tipo' in v) return JSON.stringify(v)
  if (typeof v === 'object' && v !== null && 'absoluta' in v) return 'tolerancia declarada'
  return String(v)
}

/** NOR-001: lista de parámetros con valor usado, fuente y alternos. */
export function declararParametros(p: Parametros): DeclaracionParametro[] {
  const lista: ValorParametro<unknown>[] = [p.ht, p.eo, p.dondeEo, p.umbralAdquisicion, p.decimalesCapacidad, p.tolerancia, p.redondeoHoras]
  return lista.map((x) => ({
    id: x.id, nombre: x.nombre,
    valor: x.id === 'PAR-15' ? `abs ${(x.valor as Tolerancia).absoluta.toFixed()}, rel ${(x.valor as Tolerancia).relativa.toFixed()}` : texto(x.valor),
    fuente: x.fuente, origen: x.origen, alternos: x.alternos.map((a) => a.descripcion),
    ...(x.sustento ? { sustento: x.sustento } : {}),
  }))
}
