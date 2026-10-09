import { describe, expect, it } from 'vitest'
import { dec, type Dec } from '../nucleo/num/decimal'
import { analizarReparto, verificarCapacidad } from '../nucleo/reglas/calendario'

const m = (...v: Array<number | null>): Array<Dec | null> => v.map((x) => (x === null ? null : dec(x)))

describe('analizarReparto (DYP-010)', () => {
  it('cuatro meses iguales y contiguos concilian con el total', () => {
    const d = analizarReparto(m(null, null, null, 2.5, 2.5, 2.5, 2.5, null), dec(10))
    expect(d.activos).toEqual([3, 4, 5, 6])
    expect(d.diferenciaTotal?.toFixed()).toBe('0')
    expect([d.uniforme, d.contiguo]).toEqual([true, true])
  })

  it('detecta el total que no es la suma de los meses (TC-11: 5.5 frente a 4 × 1.25)', () => {
    const d = analizarReparto(m(1.25, 1.25, 1.25, 1.25), dec(5.5))
    expect(d.diferenciaTotal?.toFixed()).toBe('0.5')
  })

  it('detecta reparto desigual y meses con huecos', () => {
    const d = analizarReparto(m(3, null, 1, 3), dec(7))
    expect(d.uniforme).toBe(false)
    expect(d.contiguo).toBe(false)
    expect([d.minimo?.toFixed(), d.maximo?.toFixed()]).toEqual(['1', '3'])
  })

  it('una celda vacía no es cero: sin meses no hay activos y el total queda sin cubrir', () => {
    const d = analizarReparto(m(null, null, null), dec(4))
    expect(d.activos).toEqual([])
    expect(d.diferenciaTotal?.toFixed()).toBe('4')
  })

  it('la media unidad del último decimal no es desigualdad', () => {
    expect(analizarReparto(m(1.251, 1.249), null).uniforme).toBe(true)
    expect(analizarReparto(m(1.26, 1.25), null).uniforme).toBe(false)
  })
})

describe('verificarCapacidad (MAQ-012)', () => {
  it('compara cada mes con máquinas elegibles × horas por mes', () => {
    const c = verificarCapacidad([dec(0), dec(300), dec(167)], dec(2), dec(167))
    expect(c.excesos).toHaveLength(0)
    expect(c.pico.toFixed()).toBe('300')
  })

  it('con una sola máquina elegible el mes de 305 h excede 167 h', () => {
    const c = verificarCapacidad([dec('305.2'), dec(100)], dec(1), dec(167))
    expect(c.excesos.map((e) => e.mes)).toEqual([0])
  })

  it('sin máquinas elegibles cualquier hora excede la capacidad cero', () => {
    expect(verificarCapacidad([dec(1)], dec(0), dec(167)).excesos).toHaveLength(1)
  })
})
