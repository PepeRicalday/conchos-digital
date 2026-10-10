import { describe, expect, it } from 'vitest'
import { parseDMS, parseDMSConEje } from '../nucleo/num/dms'

describe('parseDMS · grados, minutos y segundos del PacOT', () => {
  it('105°12\'35.25"O = −(105 + 12/60 + 35.25/3600) = −(105 + 0.2 + 0.00979167) = −105.209792', () => {
    expect(parseDMS('105°12\'35.25"O')).toBeCloseTo(-105.209792, 6)
  })
  it(' 27°40\'4.39"N (con espacio inicial) = 27 + 40/60 + 4.39/3600 = 27 + 0.66666667 + 0.00121944 = 27.667886', () => {
    expect(parseDMS(' 27°40\'4.39"N')).toBeCloseTo(27.667886, 6)
  })
  it('acepta espacios entre grados y minutos (« 28° 8\'38.00"N» = 28 + 8/60 + 38/3600 = 28.143889)', () => {
    expect(parseDMS(' 28° 8\'38.00"N')).toBeCloseTo(28.143889, 6)
  })
  it('signo por hemisferio: S y O/W negativos; N y E positivos', () => {
    expect(parseDMS('10°30\'0"S')).toBe(-10.5)
    expect(parseDMS('100°0\'0"W')).toBe(-100)
    expect(parseDMS('100°0\'0"O')).toBe(-100)
    expect(parseDMS('10°30\'0"N')).toBe(10.5)
    expect(parseDMS('10°30\'0"E')).toBe(10.5)
    expect(parseDMS('10°30\'0"n')).toBe(10.5)
  })
  it('segundos = 60 se acarrea al minuto: 12°59\'60"N = 12 + 59/60 + 60/3600 = 13 exacto', () => {
    expect(parseDMS('12°59\'60"N')).toBe(13)
    expect(parseDMS('105°59\'60"O')).toBe(-106)
  })
  it('conserva el eje que declara la letra', () => {
    expect(parseDMSConEje('105°12\'35.25"O')).toEqual({ valor: expect.closeTo(-105.209792, 6), eje: 'lon' })
    expect(parseDMSConEje('27°40\'4.39"N')?.eje).toBe('lat')
  })
  it('basura → null, nunca 0', () => {
    for (const t of ['', '   ', 'abc', '105°12\'35.25"', '105 12 35 O', '0', '27.5', 'N/A', '105°60\'0"O', '105°12\'61"O', '91°0\'0"N', '181°0\'0"O', "105°12'35.25\"X"]) {
      expect(parseDMS(t), t).toBeNull()
    }
    expect(parseDMS(null)).toBeNull()
    expect(parseDMS(undefined)).toBeNull()
  })
  it('un valor real 0° sí es un dato (0°0\'0"N = 0) y no se confunde con la falta de dato', () => {
    expect(parseDMS('0°0\'0"N')).toBe(0)
  })
})
