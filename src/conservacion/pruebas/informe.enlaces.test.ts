import { describe, expect, it } from 'vitest'
import { referenciaEnlazable } from '../informe/enlaces'

describe('enlace de un hallazgo hacia la derivación', () => {
  it('toma la hoja y la fila de la primera celda enlazable', () => {
    expect(referenciaEnlazable(['3DN!F30', 'DIAG-01!I55'])).toEqual({ hoja: '3DN', fila: 30 })
    expect(referenciaEnlazable(['PO-2!A4', 'DIAG-01!$J$17'])).toEqual({ hoja: 'DIAG-01', fila: 17 })
    expect(referenciaEnlazable(['IO1!A15:A20'])).toEqual({ hoja: 'IO1', fila: 15 })
  })
  it('sin celdas de hojas enlazables no hay enlace', () => {
    expect(referenciaEnlazable(['PO-2!F30', 'IO1a!X15', 'IO4!A3'])).toBeNull()
    expect(referenciaEnlazable([])).toBeNull()
    expect(referenciaEnlazable(['DIAG-01!A0'])).toBeNull()
  })
})
