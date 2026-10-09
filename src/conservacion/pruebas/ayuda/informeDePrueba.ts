import { FORMATO_INFORME, VERSION_FORMATO } from '../../informe/esquemaInforme'

/** Informe sintético de tres reglas: una con hallazgos, una superada, una sin datos; una cuarta de la matriz no tiene resultado. */
export function informeDePrueba(): string {
  const hallazgo = (id: string, reglaId: string, severidad: string, titulo: string) => ({
    id, reglaId, titulo, detalle: `Detalle de ${titulo}`, origen: 'pacot', severidad, dimensiones: { aritmetica: 'abierta' },
    fuentes: [{ documento: 'Manual de Conservación 2026', seccion: '6.3' }], referencias: ['IO1!A1', 'IO1!B2'], esperado: '10', observado: '9', diferencia: '-1',
    estadoEvidencia: 'verificada_en_archivo', baseValores: 'cache', parametrosUsados: [], limites: ['No acredita la condición física.'],
  })
  const cob = { revisados: 3, identificados: 4, unidad: 'filas' }
  return JSON.stringify({
    formato: FORMATO_INFORME, version: VERSION_FORMATO, generadoEn: '2026-10-09T08:36:00.000Z',
    origen: { archivoNombre: 'PacOT.xls', archivoSha256: 'a'.repeat(64), moduloId: 'MOD-001', moduloNombre: 'SRL UNIDAD CONCHOS', ciclo: '2026 - 2027', lector: 'lector_xls 1.0.0' },
    catalogoReglas: [
      { id: 'INV-001', clase: 'INVENTARIO', regla: 'T_I conciliada', severidad: 'Alta' },
      { id: 'MAQ-003', clase: 'UTILIZACIÓN DE MAQUINARIA', regla: 'Horas efectivas', severidad: 'Alta' },
      { id: 'DYP-014', clase: 'DIAGNÓSTICOS Y PROGRAMA', regla: 'Cadena del precio unitario', severidad: 'Alta' },
      { id: 'MAQ-009', clase: 'UTILIZACIÓN DE MAQUINARIA', regla: 'Identidad de máquina', severidad: 'Alta' },
    ],
    informe: {
      versionMotor: '0.6.0-corte5', matrizSha256: 'b'.repeat(64), libroSha256: 'a'.repeat(64), baseValores: 'cache', fechaReferencia: '2026-10-09',
      declaracionParametros: [{ id: 'PAR-01', nombre: 'Ht', valor: '1400', fuente: { documento: 'Manual', seccion: '6' }, origen: 'defecto_manual_2026', alternos: ['1,200 h'] }],
      resultados: [
        { reglaId: 'INV-001', estado: 'hallazgo', hallazgos: [hallazgo('INV-001:a', 'INV-001', 'media', 'Concreto <b>no</b> concilia'), hallazgo('INV-001:b', 'INV-001', 'alta', 'Diferencia de estructuras')], cobertura: cob, pendientes: ['Falta equivalencia de tipos'] },
        { reglaId: 'MAQ-003', estado: 'superada', hallazgos: [], cobertura: cob, pendientes: [] },
        { reglaId: 'DYP-014', estado: 'no_evaluable', hallazgos: [], cobertura: { revisados: 0, identificados: 0, unidad: 'n/a' }, pendientes: [], motivo: 'Sin APU' },
      ],
      reglasNoEjecutadas: [], reglasSinDatos: ['DYP-014'],
      coberturaReglas: { implementadas: 3, totales: 4, ejecutadas: 3 },
      resumen: { hallazgos: 2, alta: 1, media: 1, informativa: 0 },
    },
  })
}
