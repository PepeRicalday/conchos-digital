import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { colAIndice, indiceACol, parseA1 } from '../nucleo/num/a1'
import { dec } from '../nucleo/num/decimal'
import { diagnosticarFrecuencia } from '../nucleo/num/frecuencia'
import { estaInvertido, longitudKm, parsearPK } from '../nucleo/num/pk'
import { sumar, UnidadesIncompatibles } from '../nucleo/num/unidades'
import { calcularHorasEfectivas, calcularNm, maquinasPorUmbral } from '../nucleo/reglas/maq'
import { REDONDEO_EXACTO } from '../nucleo/num/redondeo'
import { esAutorreferencia } from '../nucleo/reglas/trv'

const tres = (n: number) => String(n).padStart(3, '0')

describe('PK = distancia', () => {
  it('K{km}+{m} equivale a km·1000 + m, con o sin "K-" y con texto sobrante', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 999 }), fc.integer({ min: 0, max: 999 }), (km, m) => {
      const esperado = km * 1000 + m
      for (const t of [`${km}+${tres(m)}`, `K${km}+${tres(m)}`, ` K-${km}+${tres(m)} (texto)`]) {
        const r = parsearPK(t)
        expect(r.ok && r.metros.toNumber()).toBe(esperado)
      }
    }))
  })
  it('la longitud es simétrica y el tramo está invertido si y solo si fin < inicio', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 99999 }), fc.integer({ min: 0, max: 99999 }), (a, b) => {
      expect(longitudKm(dec(a), dec(b)).equals(longitudKm(dec(b), dec(a)))).toBe(true)
      expect(estaInvertido(dec(a), dec(b))).toBe(b < a)
    }))
  })
  it('rechaza formatos que no son un PK y metros fuera de rango', () => {
    expect(parsearPK('sin pk')).toEqual({ ok: false, error: 'formato' })
    expect(parsearPK('12+1500')).toEqual({ ok: false, error: 'metros_fuera_de_rango' })
    expect(parsearPK('')).toEqual({ ok: false, error: 'formato' })
  })
})

describe('referencias A1', () => {
  it('columna ↔ índice es una biyección hasta ZZ', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 701 }), (i) => {
      expect(colAIndice(indiceACol(i))).toBe(i)
    }))
  })
  it('parseA1 ignora $ y rechaza filas cero o texto', () => {
    expect(parseA1('$B$7')).toEqual({ col: 'B', fila: 7 })
    expect(parseA1('A0')).toBeNull()
    expect(parseA1('hoja!A1')).toBeNull()
  })
  it('autorreferencia: una celda dentro de su propio rango se detecta; otra hoja no cuenta', () => {
    expect(esAutorreferencia('Z16', 'SUM(Z16)')).toBe(true)
    expect(esAutorreferencia('Z16', 'SUM(Z10:Z20)')).toBe(true)
    expect(esAutorreferencia('Z16', 'SUM(Z17)')).toBe(false)
    expect(esAutorreferencia('Z16', "SUM('IO1'!Z16)")).toBe(false)
  })
})

describe('frecuencia exacta = 1/T', () => {
  it('con F = 1/n la fila es consistente; con n en la columna se detecta la periodicidad', () => {
    fc.assert(fc.property(fc.integer({ min: 2, max: 50 }), fc.integer({ min: 1, max: 100000 }), (n, total) => {
      const tol = { absoluta: dec('1e-9'), relativa: dec('1e-9'), descripcion: 'prueba' }
      const anual = dec(total).dividedBy(n)
      expect(diagnosticarFrecuencia({ cantidadTotal: dec(total), cantidadAnual: anual, fImpresa: dec(1).dividedBy(n), tolerancia: tol }).tipo).toBe('consistente')
      expect(diagnosticarFrecuencia({ cantidadTotal: dec(total), cantidadAnual: anual, fImpresa: dec(n), tolerancia: tol }).tipo).toBe('periodicidad_en_columna_de_frecuencia')
    }))
  })
})

describe('unidades', () => {
  it('sumar unidades distintas siempre falla (35 km no es 35 m³)', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 1000 }), (v) => {
      expect(() => sumar({ valor: dec(v), unidad: 'km' }, { valor: dec(v), unidad: 'm3' })).toThrow(UnidadesIncompatibles)
      expect(sumar({ valor: dec(v), unidad: 'km' }, { valor: dec(1), unidad: 'km' }).valor.toNumber()).toBe(v + 1)
    }))
  })
})

describe('horas y capacidad', () => {
  const rend = fc.constantFrom('1', '2', '4', '5', '8', '10', '20')
  it('la suma de He no depende del orden y He · R recupera la cantidad', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 100000 }), rend), { minLength: 1, maxLength: 12 }), (xs) => {
      const partidas = xs.map(([c, r], i) => ({ id: String(i), cantidad: dec(c), rendimiento: dec(r) }))
      const a = calcularHorasEfectivas(partidas, REDONDEO_EXACTO)
      const b = calcularHorasEfectivas([...partidas].reverse(), REDONDEO_EXACTO)
      expect(a.totalExacto.equals(b.totalExacto)).toBe(true)
      a.filas.forEach((f, i) => expect(f.exacta?.times(partidas[i]?.rendimiento ?? 1).equals(partidas[i]?.cantidad ?? -1)).toBe(true))
    }))
  })
  it('Nm decrece al subir Ht o Eo', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 100000 }), fc.integer({ min: 800, max: 1500 }), fc.integer({ min: 1, max: 400 }), (he, ht, delta) => {
      const base = calcularNm(dec(he), dec(ht), dec('0.8'), 'denominador_capacidad', 40).nm
      expect(calcularNm(dec(he), dec(ht + delta), dec('0.8'), 'denominador_capacidad', 40).nm.lessThanOrEqualTo(base)).toBe(true)
      expect(calcularNm(dec(he), dec(ht), dec('0.9'), 'denominador_capacidad', 40).nm.lessThanOrEqualTo(base)).toBe(true)
    }))
  })
  it('el umbral exacto 0.5 no justifica otra máquina; cualquier fracción mayor sí', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 20 }), (n) => {
      expect(maquinasPorUmbral(dec(n).plus('0.5'), dec('0.5'))).toBe(n)
      expect(maquinasPorUmbral(dec(n).plus('0.51'), dec('0.5'))).toBe(n + 1)
    }))
  })
})
