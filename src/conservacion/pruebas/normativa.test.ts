import { describe, expect, it } from 'vitest'
import { normalizarDataJson, VistaLibro } from '../nucleo'
import { estadoDocumento, hojaConDatos, parsearCiclo } from '../nucleo/reglas/normativa'

const libro = new VistaLibro(normalizarDataJson({
  Con: { cells: { A1: { value: 5, type: 2 } }, formulas: {}, nrows: 1, ncols: 1 },
  Ceros: { cells: { A1: { value: 0, type: 2 }, B1: { value: 'texto', type: 1 } }, formulas: {}, nrows: 1, ncols: 2 },
}, { sha256: 'x', extractor: 'prueba' }))

describe('parsearCiclo (NOR-004)', () => {
  it('acepta dos años consecutivos y espacios', () => {
    expect(parsearCiclo('2026 - 2027')).toEqual({ inicio: 2026, fin: 2027 })
    expect(parsearCiclo(' 2026-2027 ')).toEqual({ inicio: 2026, fin: 2027 })
  })
  it('rechaza textos que no son un ciclo', () => {
    expect(parsearCiclo('2026')).toBeNull()
    expect(parsearCiclo('ciclo 2026 - 2027')).toBeNull()
  })
})

describe('estado de un documento del programa (NOR-002)', () => {
  it('una hoja solo con ceros y texto no acredita el documento', () => {
    expect(hojaConDatos(libro, 'Con')).toBe(true)
    expect(hojaConDatos(libro, 'Ceros')).toBe(false)
    expect(hojaConDatos(libro, 'NoExiste')).toBeNull()
  })
  it('distingue presente, sin datos, ausente y fuera del libro', () => {
    expect(estadoDocumento(libro, { nombre: 'a', hojas: ['Con', 'Ceros'] })).toBe('presente')
    expect(estadoDocumento(libro, { nombre: 'b', hojas: ['Ceros'] })).toBe('sin_datos')
    expect(estadoDocumento(libro, { nombre: 'c', hojas: ['NoExiste'] })).toBe('ausente_en_libro')
    expect(estadoDocumento(libro, { nombre: 'd', hojas: [] })).toBe('fuera_del_libro')
  })
})
