import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ejecutar, normalizarDataJson, PARAMETROS_POR_DEFECTO, VistaLibro } from '../nucleo'
import type { PerfilFormato } from '../nucleo'
import { PERFIL_PACOT_2026_27 } from '../nucleo/libro/perfil'
import { normalizarUnidad } from '../nucleo/num/unidades'
import { esSumaOResta, referenciasDeFormula, reglaDyp007, resolverUnidad } from '../nucleo/reglas/unidades'

const HOJAS = ['PO-2', 'SEG-3', '3DN', '3DND', 'Resumen']

describe('referencias de una fórmula', () => {
  it('lee referencias locales y calificadas, con o sin $', () => {
    const { refs } = referenciasDeFormula('L43+N43+$P$43+SEG-3!F25', HOJAS)
    expect(refs.map((r) => `${r.hoja ?? '·'}!${r.col}${r.fila}`)).toEqual(['SEG-3!F25', '·!L43', '·!N43', '·!P43'])
  })

  it('un nombre de hoja con guion no se confunde con el operador menos (3DN!H30:H30-SEG-3!F146:F146)', () => {
    const { refs } = referenciasDeFormula('3DN!H30:H30-SEG-3!F146:F146-SEG-3!F210:F210', HOJAS)
    expect(refs.map((r) => `${r.hoja}!${r.col}${r.fila}`)).toEqual(['3DN!H30', 'SEG-3!F146', 'SEG-3!F210'])
    expect(refs.some((r) => r.esRango)).toBe(false) // F146:F146 es una sola celda
  })

  it('una referencia local pegada a una hoja con guion se conserva (A1-SEG-3!B2 = A1 menos SEG-3!B2)', () => {
    const { refs } = referenciasDeFormula('A1-SEG-3!B2', HOJAS)
    expect(refs.map((r) => `${r.hoja ?? '·'}!${r.col}${r.fila}`).sort()).toEqual(['SEG-3!B2', '·!A1'])
  })

  it('un libro externo se cuenta y no se confunde con una celda local', () => {
    const r = referenciasDeFormula('<<external>>!E37:E37', HOJAS)
    expect(r.externas).toBe(1)
    expect(r.refs).toHaveLength(0)
  })

  it('un rango de varias celdas se marca como rango', () => {
    expect(referenciasDeFormula('SUM(A1:A9)', HOJAS).refs[0]?.esRango).toBe(true)
  })

  it('con cualquier hoja del libro, la referencia se asigna a esa hoja', () => {
    fc.assert(fc.property(fc.constantFrom(...HOJAS), fc.integer({ min: 1, max: 9999 }), fc.constantFrom('A', 'F', 'Z', 'AB'), (hoja, fila, col) => {
      const { refs } = referenciasDeFormula(`X1+${hoja}!${col}${fila}`, HOJAS)
      expect(refs.some((r) => r.hoja === hoja && r.col === col && r.fila === fila)).toBe(true)
    }))
  })
})

describe('solo sumas y restas exigen unidades iguales', () => {
  it('productos y cocientes se combinan por diseño', () => {
    expect(esSumaOResta('F32*G32')).toBe(false)
    expect(esSumaOResta('H30/F30')).toBe(false)
    expect(esSumaOResta('3DN!H30:H30-SEG-3!F146:F146')).toBe(true)
    expect(esSumaOResta('L43+N43+P43')).toBe(true)
  })
})

describe('unidades normalizadas', () => {
  it('las variantes de los formatos se reconocen y lo desconocido no se adivina', () => {
    for (const [t, u] of [['Km', 'km'], ['KM', 'km'], ['HA', 'ha'], ['Ha ', 'ha'], ['M3', 'm3'], ['m³', 'm3'], ['$', 'MXN'], ['Número', 'num'], ['pza', 'pza']] as const) expect(normalizarUnidad(t)).toBe(u)
    expect(normalizarUnidad('quintales')).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// Regla DYP-007 sobre un libro sintético
// ---------------------------------------------------------------------------------------------

const perfil: PerfilFormato = {
  ...PERFIL_PACOT_2026_27,
  unidades: {
    hojasAEvaluar: ['P'],
    hojas: [
      { hoja: 'P', columnas: { A: 'omitir', B: 'omitir' }, porDefecto: { deColumna: 'B' } },
      { hoja: 'S', columnas: { F: { deColumna: 'G' }, I: { fija: '$' } }, porDefecto: 'omitir' },
    ],
  },
}

function evaluar(celdas: Record<string, number | string>, formulas: Record<string, string>, hojaS: Record<string, number | string> = {}) {
  const cel = (o: Record<string, number | string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? { value: v, type: 2 } : { value: v, type: 1 }]))
  const fx = Object.fromEntries(Object.entries(formulas).map(([k, v]) => [k, { formula: v, kind: 'ordinary', error: null }]))
  const crudo = { P: { nrows: 20, ncols: 10, cells: cel(celdas), formulas: fx }, S: { nrows: 20, ncols: 10, cells: cel(hojaS), formulas: {} } }
  const libro = new VistaLibro(normalizarDataJson(crudo, { sha256: 'x', extractor: 'prueba' }))
  return ejecutar({ libro, parametros: PARAMETROS_POR_DEFECTO, perfil, fechaReferencia: '2026-10-09' }, [reglaDyp007]).resultados[0]
}

describe('DYP-007', () => {
  it('km sumado en una celda de m³ con valor distinto de cero: impacto vigente (alta)', () => {
    const r = evaluar({ B2: 'm3', B3: 'km', C3: 1.25, C2: 10 }, { C2: 'C3' })
    expect(r?.hallazgos).toHaveLength(1)
    expect(r?.hallazgos[0]).toMatchObject({ id: 'DYP-007:P!C2:P!C3', severidad: 'alta', esperado: 'm3', observado: 'km', diferencia: '1.25' })
    expect(r?.hallazgos[0]?.detalle).toContain('impacto vigente')
  })

  it('el mismo cruce con la celda en blanco es una fragilidad latente (media), no un efecto vigente', () => {
    const r = evaluar({ B2: 'm3', B3: 'km' }, { C2: 'C3' })
    expect(r?.hallazgos[0]).toMatchObject({ severidad: 'media' })
    expect(r?.hallazgos[0]?.detalle).toContain('latente')
  })

  it('unidades iguales, aunque con distinta escritura (KM / Km), no generan hallazgo', () => {
    expect(evaluar({ B2: 'KM', B3: 'Km', C3: 4 }, { C2: 'C3' })?.hallazgos).toHaveLength(0)
  })

  it('una referencia a otra hoja usa la unidad de su fila (SEG-3 F con su unidad en G)', () => {
    const bien = evaluar({ B2: 'ha' }, { C2: 'S!F5' }, { F5: 0.48, G5: 'HA' })
    expect(bien?.hallazgos).toHaveLength(0)
    const mal = evaluar({ B2: 'm3' }, { C2: 'S!F5' }, { F5: 35, G5: 'KM' })
    expect(mal?.hallazgos[0]).toMatchObject({ id: 'DYP-007:P!C2:S!F5', severidad: 'alta', esperado: 'm3', observado: 'km' })
  })

  it('pesos en una celda de km se detectan; el importe $ de la otra hoja se reconoce por su columna', () => {
    const r = evaluar({ B2: 'km' }, { C2: 'S!I5' }, { I5: 100 })
    expect(r?.hallazgos[0]).toMatchObject({ esperado: 'km', observado: 'MXN' })
  })

  it('un producto o cociente no se compara: se informa como pendiente, no como superado', () => {
    const r = evaluar({ B2: 'm3', B3: 'km', C3: 2 }, { C2: 'C3*C3' })
    expect(r?.hallazgos).toHaveLength(0)
    expect(r?.pendientes.join(' ')).toContain('producto o cociente')
  })

  it('una etiqueta de unidad desconocida no se adivina: queda pendiente', () => {
    const r = evaluar({ B2: 'm3', B3: 'quintales', C3: 2 }, { C2: 'C3' })
    expect(r?.hallazgos).toHaveLength(0)
    expect(r?.pendientes.join(' ')).toContain('sin unidad resoluble')
  })

  it('resolverUnidad distingue columnas omitidas de etiquetas ausentes', () => {
    const l = new VistaLibro(normalizarDataJson({ P: { nrows: 3, ncols: 3, formulas: {}, cells: { B2: { value: 'ha', type: 1 } } } }, { sha256: 'x', extractor: 'p' }))
    expect(resolverUnidad(l, perfil.unidades.hojas, 'P', 'C', 2)).toEqual({ ok: true, unidad: 'ha' })
    expect(resolverUnidad(l, perfil.unidades.hojas, 'P', 'A', 2)).toMatchObject({ ok: false, motivo: 'omitida' })
    expect(resolverUnidad(l, perfil.unidades.hojas, 'P', 'C', 3)).toMatchObject({ ok: false, motivo: 'sin_etiqueta' })
    expect(resolverUnidad(l, perfil.unidades.hojas, 'X', 'C', 2)).toMatchObject({ ok: false, motivo: 'hoja_sin_perfil' })
  })
})
