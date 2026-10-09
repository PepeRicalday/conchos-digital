import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ejecutar, normalizarDataJson, PARAMETROS_POR_DEFECTO, VistaLibro } from '../nucleo'
import type { PerfilFormato } from '../nucleo'
import { PERFIL_PACOT_2026_27 } from '../nucleo/libro/perfil'
import { clasificarFormulaTotal, compararConjuntos, reglaDyp013, terminosDeFormula } from '../nucleo/reglas/presupuesto'

describe('términos de una fórmula', () => {
  it('separa por + y − de nivel superior', () => {
    expect(terminosDeFormula('+C102+C103+C104').terminos).toEqual(['C102', 'C103', 'C104'])
    expect(terminosDeFormula('A1-B1').terminos).toEqual(['A1', '-B1'])
  })
  it('un cociente de nivel superior se marca y un paréntesis es un solo término', () => {
    const t = terminosDeFormula('+C102+C103+C104+C105/C102*100.0')
    expect(t.terminos).toEqual(['C102', 'C103', 'C104', 'C105/C102*100.0'])
    expect(t.hayProductoOCociente).toBe(true)
    expect(terminosDeFormula('(+D102+D103)/C106').terminos).toEqual(['(+D102+D103)/C106'])
  })
})

describe('forma de la fórmula de un total', () => {
  it('suma vertical: todas las celdas de la misma columna', () => {
    expect(clasificarFormulaTotal('+C105+C106+C104')).toEqual({ tipo: 'suma_vertical', columna: 'C', filas: [105, 106, 104] })
  })
  it('suma horizontal (meses): distintas columnas, no es suma vertical', () => {
    expect(clasificarFormulaTotal('G18+I18+K18').tipo).toBe('otra')
  })
  it('participación: (suma)/total', () => {
    expect(clasificarFormulaTotal('(+H102+H103+H104+H105)/C106').tipo).toBe('participacion')
  })
  it('un término no aditivo dentro de una suma', () => {
    expect(clasificarFormulaTotal('+C102+C103+C104+C105/C102*100.0')).toMatchObject({ tipo: 'termino_no_aditivo', terminos: ['C105/C102*100.0'] })
  })
})

describe('comparación de conjuntos de filas', () => {
  it('omitidas y ajenas; el orden no importa', () => {
    expect(compararConjuntos([103, 100, 97], [97, 100, 103, 20])).toEqual({ omitidas: [20], sobrantes: [] })
    expect(compararConjuntos([20, 99], [20, 22])).toEqual({ omitidas: [22], sobrantes: [99] })
  })
  it('propiedad: lo omitido nunca está referido y lo sobrante nunca es elegible', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 60 })), fc.uniqueArray(fc.integer({ min: 1, max: 60 })), (r, e) => {
      const c = compararConjuntos(r, e)
      expect(c.omitidas.every((x) => !r.includes(x) && e.includes(x))).toBe(true)
      expect(c.sobrantes.every((x) => r.includes(x) && !e.includes(x))).toBe(true)
      expect(c.omitidas.length + e.filter((x) => r.includes(x)).length).toBe(e.length)
    }))
  })
})

// ---------------------------------------------------------------------------------------------
// Regla sobre un cuadro sintético: filas de importe 3, 5 y 7; suma de obra 9; complementos 10-11; total 12
// ---------------------------------------------------------------------------------------------

const perfil: PerfilFormato = {
  ...PERFIL_PACOT_2026_27,
  presupuestos: [{ hoja: 'P', colUnidad: 'B', primeraFila: 2, filaObra: 9, filasComplementos: [10, 11], filaTotal: 12 }],
}

function evaluar(celdas: Record<string, number | string>, formulas: Record<string, string>) {
  const cel = Object.fromEntries(Object.entries(celdas).map(([k, v]) => [k, typeof v === 'number' ? { value: v, type: 2 } : { value: v, type: 1 }]))
  const fx = Object.fromEntries(Object.entries(formulas).map(([k, v]) => [k, { formula: v, kind: 'ordinary', error: null }]))
  const libro = new VistaLibro(normalizarDataJson({ P: { nrows: 20, ncols: 6, cells: cel, formulas: fx } }, { sha256: 'x', extractor: 'prueba' }))
  return ejecutar({ libro, parametros: PARAMETROS_POR_DEFECTO, perfil, fechaReferencia: '2026-10-09' }, [reglaDyp013]).resultados[0]
}

const base = { B3: '$', B5: '$', B7: '$', A3: 'Desazolve', A5: 'Bordos', A7: 'Concreto', B9: '$', B10: '$', B11: '$', B12: '$' }

describe('DYP-013', () => {
  it('una suma de obra que incluye todas las filas de importe no genera hallazgo', () => {
    const r = evaluar({ ...base, C3: 1, C5: 2, C7: 3 }, { C9: 'C3+C5+C7', C12: 'C9+C10+C11' })
    expect(r?.hallazgos).toHaveLength(0)
    expect(r?.estado).toBe('superada')
  })

  it('una fila omitida con importe es impacto vigente (alta)', () => {
    const r = evaluar({ ...base, C3: 1, C5: 2, C7: 3 }, { C9: 'C3+C5', C12: 'C9+C10+C11' })
    expect(r?.hallazgos[0]).toMatchObject({ id: 'DYP-013:P!fila9:obra:omite-7', severidad: 'alta' })
    expect(r?.hallazgos[0]?.detalle).toContain('7 (Concreto)')
    expect(r?.hallazgos[0]?.detalle).toContain('impacto vigente')
  })

  it('la misma omisión con la celda en blanco es una fragilidad latente (media)', () => {
    const r = evaluar({ ...base, C3: 1, C5: 2 }, { C9: 'C3+C5', C12: 'C9+C10+C11' })
    expect(r?.hallazgos[0]).toMatchObject({ severidad: 'media' })
    expect(r?.hallazgos[0]?.detalle).toContain('fragilidad latente')
  })

  it('varias columnas con la misma omisión se agrupan en un solo hallazgo', () => {
    const r = evaluar({ ...base }, { C9: 'C3+C5', D9: 'D3+D5', E9: 'E3+E5', C12: 'C9+C10+C11' })
    expect(r?.hallazgos).toHaveLength(1)
    expect(r?.hallazgos[0]?.referencias).toEqual(['P!C9', 'P!D9', 'P!E9'])
  })

  it('un total que omite la rehabilitación de maquinaria (fila 11) se detecta', () => {
    const r = evaluar({ ...base }, { C9: 'C3+C5+C7', C12: '+C9+C10' })
    expect(r?.hallazgos.map((h) => h.id)).toEqual(['DYP-013:P!fila12:total:omite-11'])
  })

  it('un total que incluye una fila que no es de importe se marca como ajena', () => {
    const r = evaluar({ ...base, A8: 'Otra', B8: 'ha' }, { C9: 'C3+C5+C7+C8', C12: 'C9+C10+C11' })
    expect(r?.hallazgos[0]?.titulo).toContain('filas ajenas')
  })

  it('un cociente sumado en el total es impacto latente si el numerador está vacío y vigente si no', () => {
    const latente = evaluar({ ...base, C9: 100 }, { C9: 'C3+C5+C7', C12: '+C9+C10+C11/C9*100' })
    expect(latente?.hallazgos.find((h) => h.id.endsWith('termino_no_aditivo'))).toMatchObject({ severidad: 'media' })
    const vigente = evaluar({ ...base, C11: 5 }, { C9: 'C3+C5+C7', C12: '+C9+C10+C11/C9*100' })
    expect(vigente?.hallazgos.find((h) => h.id.endsWith('termino_no_aditivo'))).toMatchObject({ severidad: 'alta' })
  })

  it('una fracción en una fila rotulada en pesos se informa como participación, sin alterar el rótulo', () => {
    const r = evaluar({ ...base }, { C9: 'C3+C5+C7', C12: 'C9+C10+C11', D12: '(+D9+D10+D11)/C12', E12: '(+E9+E10+E11)/C12' })
    const h = r?.hallazgos.find((x) => x.id.endsWith('participacion'))
    expect(h).toMatchObject({ severidad: 'informativa', origen: 'formato' })
    expect(h?.referencias).toEqual(['P!D12', 'P!E12'])
  })

  it('los términos repetidos no se reportan aquí: los revisa TRV-004', () => {
    expect(evaluar({ ...base }, { C9: 'C3+C3+C5+C7', C12: 'C9+C10+C11' })?.hallazgos).toHaveLength(0)
  })
})
