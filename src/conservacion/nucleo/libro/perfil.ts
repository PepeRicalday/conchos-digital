/**
 * Perfil de formato: dónde está cada dato en un libro concreto. Es DATO, no código: las reglas no
 * llevan coordenadas fijas. Hoy solo existe el perfil del PacOT 2026-27 (formato CNA DR);
 * la generalización a otros PacOT de otras organizaciones no está probada.
 */
export interface RangoFilas {
  readonly desde: number
  readonly hasta: number
}

export interface PerfilFormato {
  readonly nombre: string
  readonly balanceMaquinaria: {
    readonly hoja: string
    readonly filas: RangoFilas
    readonly colAnual: string
    readonly colRendimiento: string
    readonly colHorasNecesarias: string
    readonly colHorasDisponibles: string
    readonly colMaquinas: string
    readonly filaTotal: number
  }
  /** Tabla de necesidades de maquinaria por tipo (Formato 4, filas 36-45 del formato oficial). */
  readonly tablaMaquinaria: {
    readonly hoja: string
    readonly filas: RangoFilas
    readonly filaTotal: number
    readonly colTipo: string
    readonly colNm: string
    readonly colExistentes: string
    readonly colFaltante: string
    readonly colSobrante: string
    readonly colBuenoRegular: string
    readonly colMalo: string
    readonly colBaja: string
    readonly colPorFaltante: string
    readonly colPorSustituir: string
    readonly colSuma: string
  }
  readonly necesidadMedia: {
    readonly hoja: string
    readonly filas: RangoFilas
    readonly colConcepto: string
    readonly colCantidadTotal: string
    readonly colFrecuencia: string
    readonly colEtiqueta: string
    readonly colNecesidadAnual: string
  }
  readonly inventarioCanales: {
    readonly hoja: string
    readonly filas: RangoFilas
    readonly colPkInicial: string
    readonly colPkFinal: string
    readonly colLongitud: string
  }
  readonly inventarioCaminos: {
    readonly hoja: string
    readonly filas: readonly number[]
    readonly colPkInicial: string
    readonly colPkFinal: string
    readonly colLongitud: string
  }
  readonly inventarioEstructuras: {
    readonly hoja: string
    readonly filas: RangoFilas
    readonly colId: string
    readonly colTipo: string
    readonly colPk: string
  }
  /** Hojas donde se revisan sumas de programa y presupuesto. */
  readonly hojasPrograma: readonly string[]
  /** Cuadros de presupuesto: filas de importe, suma de obra, complementos y total (DYP-013). */
  readonly presupuestos: readonly CuadroPresupuesto[]
  /** De dónde sale la unidad de cada columna en cada hoja (DYP-007). */
  readonly unidades: {
    readonly hojas: readonly PerfilUnidadesHoja[]
    /** Hojas cuyas fórmulas se revisan. */
    readonly hojasAEvaluar: readonly string[]
  }
}

export interface CuadroPresupuesto {
  readonly hoja: string
  /** Columna donde cada fila dice su unidad; las filas de importe llevan "$". */
  readonly colUnidad: string
  readonly primeraFila: number
  /** Fila "Suma de obra": debe sumar todas las filas de importe del cuadro. */
  readonly filaObra: number
  /** Adquisiciones, indirectos y rehabilitación de maquinaria. */
  readonly filasComplementos: readonly number[]
  /** Fila "Suma de importes" o "Total presupuesto": obra + complementos. */
  readonly filaTotal: number
}

/** La unidad de una celda es fija, la dice otra columna de su misma fila, o no aplica (frecuencias, precios, etiquetas). */
export type FuenteUnidad = { readonly fija: string } | { readonly deColumna: string } | 'omitir'

export interface PerfilUnidadesHoja {
  readonly hoja: string
  readonly columnas: Readonly<Record<string, FuenteUnidad>>
  readonly porDefecto: FuenteUnidad
}

export const PERFIL_PACOT_2026_27: PerfilFormato = {
  nombre: 'PacOT 2026-27 (formato CNA DR, SRL Unidad Conchos)',
  balanceMaquinaria: {
    hoja: 'B Maq', filas: { desde: 13, hasta: 43 }, colAnual: 'F', colRendimiento: 'H',
    colHorasNecesarias: 'I', colHorasDisponibles: 'J', colMaquinas: 'K', filaTotal: 44,
  },
  tablaMaquinaria: {
    hoja: 'B Maq', filas: { desde: 51, hasta: 67 }, filaTotal: 68, colTipo: 'A', colNm: 'B', colExistentes: 'C', colFaltante: 'D',
    colSobrante: 'E', colBuenoRegular: 'F', colMalo: 'G', colBaja: 'H', colPorFaltante: 'K', colPorSustituir: 'L', colSuma: 'M',
  },
  necesidadMedia: {
    hoja: '3DN', filas: { desde: 11, hasta: 70 }, colConcepto: 'A', colCantidadTotal: 'E',
    colFrecuencia: 'F', colEtiqueta: 'G', colNecesidadAnual: 'H',
  },
  inventarioCanales: { hoja: 'IO1', filas: { desde: 16, hasta: 75 }, colPkInicial: 'D', colPkFinal: 'G', colLongitud: 'J' },
  inventarioCaminos: { hoja: 'IO3', filas: [16, 18, 20, 22], colPkInicial: 'C', colPkFinal: 'F', colLongitud: 'I' },
  inventarioEstructuras: { hoja: 'IO4', filas: { desde: 14, hasta: 398 }, colId: 'A', colTipo: 'C', colPk: 'D' },
  hojasPrograma: ['PO-2', 'PO-2C', '2PA', '2PAC', '2PAAB', 'UM1', 'PUM1'],
  presupuestos: [
    { hoja: 'PO-2', colUnidad: 'B', primeraFila: 14, filaObra: 104, filasComplementos: [105, 106, 107], filaTotal: 108 },
    { hoja: 'PO-2C', colUnidad: 'B', primeraFila: 14, filaObra: 104, filasComplementos: [105, 106, 107], filaTotal: 108 },
    { hoja: '2PA', colUnidad: 'B', primeraFila: 14, filaObra: 102, filasComplementos: [103, 104, 105], filaTotal: 106 },
    { hoja: '2PAC', colUnidad: 'B', primeraFila: 14, filaObra: 102, filasComplementos: [103, 104, 105], filaTotal: 106 },
    { hoja: '2PAAB', colUnidad: 'B', primeraFila: 14, filaObra: 102, filasComplementos: [103, 104, 105], filaTotal: 106 },
  ],
  unidades: {
    hojasAEvaluar: ['PO-2', 'PO-2C', '3DND'],
    hojas: [
      { hoja: 'PO-2', columnas: { A: 'omitir', B: 'omitir' }, porDefecto: { deColumna: 'B' } },
      { hoja: 'PO-2C', columnas: { A: 'omitir', B: 'omitir' }, porDefecto: { deColumna: 'B' } },
      // SEG-3: E longitud (km), F cantidad con su unidad en G, H precio unitario, I importe
      { hoja: 'SEG-3', columnas: { E: { fija: 'km' }, F: { deColumna: 'G' }, I: { fija: 'MXN' } }, porDefecto: 'omitir' },
      // 3DN: D cantidad paramétrica (unidad en B), E y H cantidades de trabajo (unidad en C), J importe
      { hoja: '3DN', columnas: { D: { deColumna: 'B' }, E: { deColumna: 'C' }, H: { deColumna: 'C' }, J: { fija: 'MXN' } }, porDefecto: 'omitir' },
      // 3DND: D paramétrica (B), E, F y J cantidades de trabajo (C), H y K importes
      { hoja: '3DND', columnas: { D: { deColumna: 'B' }, E: { deColumna: 'C' }, F: { deColumna: 'C' }, J: { deColumna: 'C' }, H: { fija: 'MXN' }, K: { fija: 'MXN' } }, porDefecto: 'omitir' },
    ],
  },
}
