import { describe, expect, it } from 'vitest'
import {
  ejecutar, normalizarDataJson, PARAMETROS_POR_DEFECTO, PERFIL_PACOT_2026_27, REGLAS_PRIMER_CORTE, resolverParametros, VistaLibro,
  declararParametros,
} from '../nucleo'
import type { Regla } from '../nucleo'
import { dec } from '../nucleo/num/decimal'

/** Libro mínimo sintético con la forma de data.json. */
const crudo = {
  'B Maq': {
    nrows: 20, ncols: 12, formulas: {},
    cells: {
      F13: { value: 100, type: 2 }, H13: { value: 4, type: 2 }, I13: { value: 25, type: 2 }, J13: { value: 1400, type: 2 }, K13: { value: 25 / 1400, type: 2 },
      F14: { value: 'texto', type: 1 }, H14: { value: 2, type: 2 }, I14: { value: 10, type: 2 },
    },
  },
}

const libro = () => new VistaLibro(normalizarDataJson(crudo, { sha256: 'abc', extractor: 'prueba' }))

describe('lectura del libro: nada se convierte en cero', () => {
  const v = libro()
  it('un texto, una celda vacía y una hoja ausente no son números', () => {
    expect(v.numero('B Maq', 'F14')).toMatchObject({ ok: false, motivo: 'texto' })
    expect(v.numero('B Maq', 'Z99')).toMatchObject({ ok: false, motivo: 'vacia' })
    expect(v.numero('Otra', 'A1')).toMatchObject({ ok: false, motivo: 'sin_hoja' })
  })
  it('un error BIFF conserva su etiqueta y no es una cantidad', () => {
    const l = normalizarDataJson({ H: { nrows: 1, ncols: 1, formulas: {}, cells: { A1: { value: 15, type: 5 } } } }, { sha256: 'x', extractor: 'p' })
    const c = l.hojas.get('H')?.celdas.get('A1')
    expect(c).toEqual({ tipo: 'error', codigo: 15, etiqueta: '#VALUE!' })
    expect(new VistaLibro(l).numero('H', 'A1')).toMatchObject({ ok: false, motivo: 'error' })
  })
  it('rechaza una extracción con otra forma en lugar de aceptarla', () => {
    expect(() => normalizarDataJson({ H: { cells: 3 } }, { sha256: 'x', extractor: 'p' })).toThrow()
  })
})

describe('parámetros', () => {
  it('por defecto: Ht 1,400 h; Eo no declarada; horas exactas; sin override no hay avisos', () => {
    const { parametros, avisos } = resolverParametros()
    expect(parametros.ht.valor.toNumber()).toBe(1400)
    expect(parametros.eo.valor).toBeNull()
    expect(parametros.redondeoHoras.valor).toEqual({ tipo: 'exacto' })
    expect(avisos).toHaveLength(0)
  })
  it('un override exige sustento y queda declarado como tal', () => {
    expect(() => resolverParametros({ ht: { valor: 1200, origen: 'organizacion' } })).toThrow()
    const { parametros, avisos } = resolverParametros({ ht: { valor: 1200, sustento: 'Criterio del Distrito 005', origen: 'distrito' } })
    expect(parametros.ht.valor.toNumber()).toBe(1200)
    expect(parametros.ht.origen).toBe('distrito')
    expect(avisos[0]).toContain('PAR-01')
    expect(declararParametros(parametros).find((x) => x.id === 'PAR-01')?.sustento).toBe('Criterio del Distrito 005')
  })
  it('rechaza claves desconocidas', () => {
    expect(() => resolverParametros({ inventado: { valor: 1, sustento: 'sin sentido', origen: 'sesion' } })).toThrow()
  })
  it('NOR-001: la declaración lista el valor usado, la fuente y los alternos', () => {
    const d = declararParametros(PARAMETROS_POR_DEFECTO)
    const ht = d.find((x) => x.id === 'PAR-01')
    expect(ht?.valor).toBe('1400')
    expect(ht?.fuente.documento).toContain('Manual')
    expect(ht?.alternos.join(' ')).toContain('1,200')
  })
})

describe('motor', () => {
  const entrada = { libro: libro(), parametros: PARAMETROS_POR_DEFECTO, perfil: PERFIL_PACOT_2026_27, fechaReferencia: '2026-10-09' }

  it('es determinista: dos ejecuciones dan el mismo JSON', () => {
    expect(JSON.stringify(ejecutar(entrada))).toBe(JSON.stringify(ejecutar(entrada)))
  })

  it('la salida es JSON puro: ningún Decimal sin serializar', () => {
    const json = JSON.stringify(ejecutar(entrada))
    expect(json).not.toMatch(/"d":\[/)
    expect(() => JSON.parse(json) as unknown).not.toThrow()
  })

  it('sin libro, las reglas que lo requieren se informan como no ejecutadas, no como aprobadas', () => {
    const inf = ejecutar({ ...entrada, libro: null })
    expect(inf.resultados).toHaveLength(0)
    expect(inf.reglasNoEjecutadas.map((r) => r.id)).toContain('MAQ-003')
    expect(inf.baseValores).toBe('sin_libro')
  })

  it('la cobertura de reglas deja explícito que 8 de 52 no certifican un programa', () => {
    const inf = ejecutar(entrada)
    expect(inf.coberturaReglas).toMatchObject({ implementadas: REGLAS_PRIMER_CORTE.length, totales: 52 })
  })

  it('un fallo interno de una regla no se convierte en aprobación', () => {
    const rota: Regla = {
      meta: { id: 'MAQ-003', clase: 'UTILIZACIÓN DE MAQUINARIA', titulo: 'rota', severidadBase: 'alta', fuentes: [], requiereLibro: false, casosOro: [] },
      evaluar() { throw new Error('falla simulada') },
    }
    const inf = ejecutar(entrada, [rota])
    expect(inf.resultados[0]).toMatchObject({ estado: 'error_interno' })
    expect(inf.resultados[0]?.motivo).toContain('falla simulada')
    expect(inf.coberturaReglas.ejecutadas).toBe(0)
  })

  it('no inventa datos: una fila con cantidad de texto no se completa con cero', () => {
    const inf = ejecutar(entrada)
    const maq003 = inf.resultados.find((r) => r.reglaId === 'MAQ-003')
    expect(maq003?.pendientes.join(' ')).toContain('B Maq!F14')
  })

  it('un hallazgo aritmético deja la condición física pendiente (no existe un "aprobado" global)', () => {
    const l = new VistaLibro(normalizarDataJson({ 'B Maq': { nrows: 20, ncols: 12, formulas: {}, cells: { F13: { value: 1, type: 2 }, H13: { value: 0.0012, type: 2 }, I13: { value: 833, type: 2 } } } }, { sha256: 'x', extractor: 'p' }))
    const inf = ejecutar({ ...entrada, libro: l })
    const h = inf.resultados.flatMap((r) => r.hallazgos).find((x) => x.reglaId === 'MAQ-003')
    expect(h?.dimensiones.condicion_fisica).toBe('pendiente')
    expect(h?.observado).toBe('833')
    expect(dec(h?.esperado ?? '0').toDecimalPlaces(4).toFixed()).toBe('833.3333')
    expect(h?.baseValores).toBe('cache')
  })
})
