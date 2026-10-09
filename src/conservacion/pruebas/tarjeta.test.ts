import { describe, expect, it } from 'vitest'
import { dec } from '../nucleo/num/decimal'
import { categoriaDeCanal, conciliar, esMitadFija, revestimientoDeCanal, tipoDeCamino } from '../nucleo/reglas/tarjeta'

const parte = (valor: number, clasificada = true, etiqueta = 'x') => ({ etiqueta, valor: dec(valor), clasificada })

describe('conciliar (INV-001)', () => {
  it('concilia cuando la tarjeta es la suma exacta del detalle', () => {
    expect(conciliar(dec('101.231'), [parte(98.951), parte(2.28)]).tipo).toBe('concilia')
  })

  it('la media unidad del último decimal no es diferencia', () => {
    expect(conciliar(dec('10.0004'), [parte(10)]).tipo).toBe('concilia')
    expect(conciliar(dec('10.001'), [parte(10)]).tipo).toBe('diferencia')
  })

  it('un valor fuera de enumeración no se absorbe: concilia solo contándolo y se avisa', () => {
    const c = conciliar(dec('98.951'), [parte(96.991), parte(1.96, false, 'CANCRETO')])
    expect(c.tipo).toBe('concilia_con_no_clasificados')
    if (c.tipo === 'concilia_con_no_clasificados') {
      expect(c.noClasificadas).toEqual(['CANCRETO'])
      expect(c.diferencia.toFixed()).toBe('1.96')
    }
  })

  it('una diferencia real se reporta con su signo (detalle menos tarjeta)', () => {
    const c = conciliar(dec(100), [parte(90), parte(5)])
    expect(c.tipo).toBe('diferencia')
    if (c.tipo === 'diferencia') expect(c.diferencia.toFixed()).toBe('5')
  })

  it('un detalle vacío no concilia con un total distinto de cero', () => {
    expect(conciliar(dec(3), []).tipo).toBe('diferencia')
    expect(conciliar(dec(0), []).tipo).toBe('concilia')
  })
})

describe('clasificación de texto de inventario', () => {
  it('reconoce categorías, revestimientos y caminos sin depender de mayúsculas ni acentos', () => {
    expect(categoriaDeCanal('Principales ')).toBe('principales')
    expect(categoriaDeCanal('Secundarios (laterales)')).toBe('secundarios')
    expect(revestimientoDeCanal('CONCRETO')).toBe('concreto')
    expect(revestimientoDeCanal('Mampostería')).toBe('mamposteria')
    expect(revestimientoDeCanal('CANCRETO')).toBeNull()
    expect(tipoDeCamino('Terracería')).toBe('terraceria')
  })

  it('detecta el reparto fijo en mitades', () => {
    expect(esMitadFija('C52/2.0')).toBe(true)
    expect(esMitadFija('$C$52/2')).toBe(true)
    expect(esMitadFija('+C52/2')).toBe(true)
    expect(esMitadFija('SUM(IO3!I16:I20)')).toBe(false)
    expect(esMitadFija('C52/3')).toBe(false)
  })
})
