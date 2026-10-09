import { describe, expect, it } from 'vitest'
import { dec } from '../nucleo/num/decimal'
import { coherenciaHidraulica, distanciaMetros, formaDeSeccion, parsearDMS, validarCoordenada } from '../nucleo/reglas/ficha'

const ok = (t: string) => {
  const c = parsearDMS(t)
  if (!c.ok) throw new Error(`no parseó ${t}`)
  return c
}

describe('coordenadas (INV-005)', () => {
  it('lee g°m\'s.ss\'\' con espacios y hemisferio O o W', () => {
    expect(ok(`105°12'35.25"O`).decimal).toBeCloseTo(-105.209792, 5)
    expect(ok(` 28° 8'38.00"N`).decimal).toBeCloseTo(28.143889, 5)
    expect(ok(`105°12'35.25"W`).hemisferio).toBe('O')
  })

  it('un texto que no es DMS no se interpreta', () => {
    expect(parsearDMS('27.66 N').ok).toBe(false)
    expect(parsearDMS('').ok).toBe(false)
  })

  it('una longitud en la columna de latitud falla por hemisferio; la correcta no tiene problemas', () => {
    expect(validarCoordenada(ok(`105°11'47.22"O`), 'latitud')).toEqual(['hemisferio'])
    expect(validarCoordenada(ok(`27°40'4.39"N`), 'latitud')).toEqual([])
    expect(validarCoordenada(ok(`105°12'35.25"O`), 'longitud')).toEqual([])
  })

  it("60'' se informa para normalizar, sin cambiar la captura; 75'' y 61 minutos son error", () => {
    expect(validarCoordenada(ok(`27°54'60.00"N`), 'latitud')).toEqual(['segundos_60'])
    expect(validarCoordenada(ok(`27°54'75.00"N`), 'latitud')).toEqual(['segundos_fuera'])
    expect(validarCoordenada(ok(`27°61'10.00"N`), 'latitud')).toEqual(['minutos_fuera'])
  })

  it('fuera de México (p. ej. 5° N) se marca', () => {
    expect(validarCoordenada(ok(`5°10'0.00"N`), 'latitud')).toEqual(['fuera_de_mexico'])
  })

  it('un segundo de latitud mide unos 30 m; 0.01\'\' unos 0.3 m', () => {
    const lat = 27.7
    expect(distanciaMetros(lat, -105.2, lat + 1 / 3600, -105.2)).toBeCloseTo(30.9, 0)
    expect(distanciaMetros(lat, -105.2, lat, -105.2)).toBe(0)
  })
})

describe('coherencia hidráulica (INV-006)', () => {
  it('el tramo K-0+000 de Conchos concilia (b 13.3, z 1.75, d 3.2 → 60.48 m²)', () => {
    const c = coherenciaHidraulica({ b: dec(13.3), z: dec(1.75), y: dec(3.2), area: dec(60.48), velocidad: dec(1.1644), gasto: dec(70.4258) })
    expect(c.areaCalculada.toFixed()).toBe('60.48')
    expect([c.areaCoherente, c.gastoCoherente]).toEqual([true, true])
  })

  it('detecta un área capturada que no sale de las dimensiones', () => {
    const c = coherenciaHidraulica({ b: dec(13.3), z: dec(1.75), y: dec(3.2), area: dec(75), velocidad: null, gasto: null })
    expect(c.areaCoherente).toBe(false)
    expect(c.gastoCoherente).toBeNull()
  })

  it('detecta un gasto que no es A·V', () => {
    const c = coherenciaHidraulica({ b: dec(3), z: dec(1.75), y: dec(1.7), area: dec(10.1575), velocidad: dec(0.6803), gasto: dec(9.5) })
    expect(c.gastoCoherente).toBe(false)
  })

  it('reconoce las secciones del formato y rechaza la errata', () => {
    expect(formaDeSeccion('TRAPEZOIDAL')).toBe('trapezoidal')
    expect(formaDeSeccion(' Rectangular ')).toBe('rectangular')
    expect(formaDeSeccion('TRAPECIOIDAL')).toBeNull()
  })
})
