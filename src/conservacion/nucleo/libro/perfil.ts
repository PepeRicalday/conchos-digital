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
}

export const PERFIL_PACOT_2026_27: PerfilFormato = {
  nombre: 'PacOT 2026-27 (formato CNA DR, SRL Unidad Conchos)',
  balanceMaquinaria: {
    hoja: 'B Maq', filas: { desde: 13, hasta: 43 }, colAnual: 'F', colRendimiento: 'H',
    colHorasNecesarias: 'I', colHorasDisponibles: 'J', colMaquinas: 'K', filaTotal: 44,
  },
  necesidadMedia: {
    hoja: '3DN', filas: { desde: 11, hasta: 70 }, colConcepto: 'A', colCantidadTotal: 'E',
    colFrecuencia: 'F', colEtiqueta: 'G', colNecesidadAnual: 'H',
  },
  inventarioCanales: { hoja: 'IO1', filas: { desde: 16, hasta: 75 }, colPkInicial: 'D', colPkFinal: 'G', colLongitud: 'J' },
  inventarioCaminos: { hoja: 'IO3', filas: [16, 18, 20, 22], colPkInicial: 'C', colPkFinal: 'F', colLongitud: 'I' },
  inventarioEstructuras: { hoja: 'IO4', filas: { desde: 14, hasta: 398 }, colId: 'A', colTipo: 'C', colPk: 'D' },
  hojasPrograma: ['PO-2', 'PO-2C', '2PA', '2PAC', '2PAAB', 'UM1', 'PUM1'],
}
