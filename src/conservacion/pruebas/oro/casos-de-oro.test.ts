/**
 * Casos de oro de la matriz (Conservacion/Skill/diseno/Matriz_Norma_Regla_Prueba.md, sección 5).
 * Las entradas se transcriben a mano de las fuentes; cada caso cita su origen.
 */
import { describe, expect, it } from 'vitest'
import { aCadena, dec, type Tolerancia } from '../../nucleo/num/decimal'
import { diagnosticarFrecuencia } from '../../nucleo/num/frecuencia'
import { calcularHorasEfectivas, calcularNm, maquinasPorUmbral } from '../../nucleo/reglas/maq'
import { REDONDEO_EXACTO } from '../../nucleo/num/redondeo'

const p = (id: string, cantidad: string, rendimiento: string) => ({ id, cantidad: dec(cantidad), rendimiento: dec(rendimiento) })

describe('TC-01 · Manual 2026 §6.3.2 (pp. 76-77): dragas', () => {
  const partidas = [
    p('desazolve canales', '21890', '55'),
    p('desazolve drenes', '22660', '55'),
    p('tule canales', '4.8', '0.04'),
    p('tule drenes', '8.6', '0.04'),
  ]
  const { filas, totalExacto } = calcularHorasEfectivas(partidas, REDONDEO_EXACTO)

  it('He = cantidad / rendimiento (398; 412; 120; 215)', () => {
    expect(filas.map((f) => aCadena(f.exacta ?? dec(0)))).toEqual(['398', '412', '120', '215'])
    expect(aCadena(totalExacto)).toBe('1145')
  })

  it('Nm = 1,145 / (1,200 × 0.85) = 1.12 dragas', () => {
    const r = calcularNm(totalExacto, dec(1200), dec('0.85'), 'denominador_capacidad', 2)
    expect(aCadena(r.nmRedondeado)).toBe('1.12')
    expect(r.eoAplicada).toBe(true)
  })

  it('Eo se aplica una sola vez: las dos formas dan el mismo Nm', () => {
    const a = calcularNm(totalExacto, dec(1200), dec('0.85'), 'denominador_capacidad', 40).nm
    const b = calcularNm(totalExacto, dec(1200), dec('0.85'), 'divide_horas', 40).nm
    expect(a.equals(b)).toBe(true)
  })
})

describe('TC-02 · Anexo 4 §3 (p. 7): excavadora, mismos volúmenes', () => {
  const partidas = [
    p('desazolve canales', '21890', '35'),
    p('desazolve drenes', '22660', '35'),
    p('tule canales', '4.8', '0.03'),
    p('tule drenes', '8.6', '0.03'),
  ]
  const exactas = calcularHorasEfectivas(partidas, REDONDEO_EXACTO)
  const truncadas = calcularHorasEfectivas(partidas, { tipo: 'truncar', decimales: 0 })

  it('las horas exactas suman 1,719.52; el Anexo trunca cada fila y reporta 1,718', () => {
    expect(exactas.totalExacto.toDecimalPlaces(2).toFixed()).toBe('1719.52')
    expect(truncadas.filas.map((f) => aCadena(f.segunRegla ?? dec(0)))).toEqual(['625', '647', '160', '286'])
    const sumaTruncada = truncadas.filas.reduce((a, f) => a.plus(f.segunRegla ?? 0), dec(0))
    expect(aCadena(sumaTruncada)).toBe('1718')
  })

  it('el Anexo divide entre 1,400 sin aplicar Eo (1.23); con Eo = 0.85 serían 1.44', () => {
    const sinEo = calcularNm(dec(1718), dec(1400), null, 'denominador_capacidad', 2)
    expect(aCadena(sinEo.nmRedondeado)).toBe('1.23')
    expect(sinEo.eoAplicada).toBe(false)
    const conEo = calcularNm(dec(1718), dec(1400), dec('0.85'), 'denominador_capacidad', 2)
    expect(aCadena(conEo.nmRedondeado)).toBe('1.44')
  })

  it('en ambos casos la decisión de adquisición es 1 máquina, pero queda horas por cubrir', () => {
    expect(maquinasPorUmbral(dec('1.2271'), dec('0.5'))).toBe(1)
    expect(maquinasPorUmbral(dec('1.4437'), dec('0.5'))).toBe(1)
    // horas residuales con una sola máquina: sin Eo 318 h; con Eo (1,190 h) 528 h
    expect(aCadena(dec(1718).minus(1400))).toBe('318')
    expect(aCadena(dec(1718).minus(dec(1400).times('0.85')))).toBe('528')
  })
})

describe('TC-09 · umbral de adquisición (Manual §6.3; Anexo 5 §3.1)', () => {
  it('1.56 → 2 máquinas; 1.46 → 1; 1.50 exacto → 1', () => {
    const u = dec('0.5')
    expect(maquinasPorUmbral(dec('1.56'), u)).toBe(2)
    expect(maquinasPorUmbral(dec('1.46'), u)).toBe(1)
    expect(maquinasPorUmbral(dec('1.5'), u)).toBe(1)
    expect(maquinasPorUmbral(dec('1.5000001'), u)).toBe(2)
  })
})

describe('TC-03 y TC-04 · frecuencia (Manual §5.6; pp. 65-66)', () => {
  /** El ejemplo del Manual imprime las cantidades con un decimal. */
  const tolPresentacion: Tolerancia = { absoluta: dec('0.001'), relativa: dec('0.001'), descripcion: 'Cifras impresas a un decimal' }

  it('TC-03: la columna imprime 10 y multiplica por 0.1 → es la periodicidad, no F', () => {
    const d = diagnosticarFrecuencia({ cantidadTotal: dec('12407'), cantidadAnual: dec('1240.7'), fImpresa: dec(10), tolerancia: tolPresentacion })
    expect(d.tipo).toBe('periodicidad_en_columna_de_frecuencia')
    if (d.tipo === 'periodicidad_en_columna_de_frecuencia') {
      expect(aCadena(d.fDespejada)).toBe('0.1')
      expect(aCadena(d.periodoAnios)).toBe('10')
    }
  })

  it('TC-04: F = 1/T exacta; "0.3" es solo la presentación de 1/3 (115.6 → 38.5, no 34.68)', () => {
    const d = diagnosticarFrecuencia({ cantidadTotal: dec('115.6'), cantidadAnual: dec('38.5'), fImpresa: dec('0.3'), tolerancia: tolPresentacion })
    expect(d.tipo).toBe('redondeo_de_presentacion')
    expect(aCadena(dec('115.6').times('0.3'))).toBe('34.68')
    expect(aCadena(dec('115.6').dividedBy(3).toDecimalPlaces(2))).toBe('38.53')
    if (d.tipo === 'redondeo_de_presentacion') expect(aCadena(d.periodoAnios)).toBe('3')
  })

  it('TC-04: filas consistentes del Manual p. 66', () => {
    const filas: Array<[string, string, string]> = [
      ['76980', '0.05', '3849'], // terracerías, cada 20 años
      ['51335.2', '0.02', '1026.7'], // revestimiento, cada 50 años
      ['119.9', '4', '479.6'], // rastreo, 4 veces al año
    ]
    for (const [total, f, anual] of filas) {
      const d = diagnosticarFrecuencia({ cantidadTotal: dec(total), cantidadAnual: dec(anual), fImpresa: dec(f), tolerancia: tolPresentacion })
      expect(d.tipo).toBe('consistente')
    }
    // 83,419.7 / 15 = 5,561.3: con 0.067 saldría 5,589; la fila usa la fracción exacta.
    const fila = { cantidadTotal: dec('83419.7'), cantidadAnual: dec('5561.3'), fImpresa: dec('0.067') }
    // Con la tolerancia amplia de "cifras a un decimal" el valor mostrado se acepta...
    expect(diagnosticarFrecuencia({ ...fila, tolerancia: tolPresentacion }).tipo).toBe('consistente')
    // ...y con una tolerancia estricta se detecta que 0.067 es solo la presentación de 1/15.
    const estricta: Tolerancia = { absoluta: dec('1e-9'), relativa: dec('1e-6'), descripcion: 'estricta' }
    const d = diagnosticarFrecuencia({ ...fila, tolerancia: estricta })
    expect(d.tipo).toBe('redondeo_de_presentacion')
    if (d.tipo === 'redondeo_de_presentacion') expect(aCadena(d.periodoAnios)).toBe('15')
  })

  it('con cantidad total cero no se despeja nada', () => {
    const d = diagnosticarFrecuencia({ cantidadTotal: dec(0), cantidadAnual: dec(5), fImpresa: dec(1), tolerancia: tolPresentacion })
    expect(d.tipo).toBe('no_evaluable')
  })
})
