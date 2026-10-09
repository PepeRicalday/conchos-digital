/**
 * Casos de oro del corte 1b: precios unitarios (TC-05, TC-06, TC-07), balance (TC-09) y seguimiento (TC-10).
 * Las entradas se transcriben a mano del Manual de Conservación 2026 §7.7 y §9.4.
 */
import { describe, expect, it } from 'vitest'
import { ejecutar, PARAMETROS_POR_DEFECTO } from '../../nucleo'
import { aCadena, dec } from '../../nucleo/num/decimal'
import { balanceTipo } from '../../nucleo/reglas/balance'
import { cadenaPU, jornalCuadrilla, reglaDyp014, reglaDyp015, type ApuDeclarado } from '../../nucleo/reglas/precios'
import { avancePorcentual, clasificarIndice, indiceSobreDnmacn, reglaDyp018, type FilaAvance } from '../../nucleo/reglas/seguimiento'

const d = (x: string | number) => dec(x)
const base = { libro: null, parametros: PARAMETROS_POR_DEFECTO, perfil: null, fechaReferencia: '2026-10-09' }

const CARGOS_EJEMPLO = { indirecto: d('0.23'), financiamiento: d('0.0295'), utilidad: d('0.06'), adicionales: d('0.005') }

/** Manual §7.7 ejemplo 1: quema de maleza, tractor con equipo ligero. */
const apu1: ApuDeclarado = {
  id: 'ej1', concepto: 'Quema de maleza (Manual ej.1)', origen: 'norma', referencia: 'Manual 2026 §7.7 ej.1', precision: 2,
  otrosCargos: d(280),
  manoDeObra: {
    cuadrilla: [
      { cantidad: d(2), salarioBase: d(315), fsr: d('1.78478'), factorEspecialidad: d('1.0') },
      { cantidad: d('0.2'), salarioBase: d(315), fsr: d('1.723446'), factorEspecialidad: d('1.539') },
    ],
    jornalDeclarado: d('1291.51'), rendimientoDeclarado: d('1.2'), cargoDeclarado: d('1076.26'),
  },
  equipo: [{ chd: d(900), rendimiento: d('0.15'), cargoDeclarado: d(6000) }],
  costoDirectoDeclarado: d('7356.26'), cargos: { indirecto: d('0.23') }, puDeclarado: d('9048.20'),
}

/** Manual §7.7 ejemplo 3: demolición de losas. El cargo se calcula con 2.310 y el rendimiento declarado es 2.300. */
const apu3: ApuDeclarado = {
  id: 'ej3', concepto: 'Demolición de losas (Manual ej.3)', origen: 'norma', referencia: 'Manual 2026 §7.7 ej.3', precision: 2,
  manoDeObra: {
    cuadrilla: [
      { cantidad: d(1), salarioBase: d('54.47'), fsr: d('1.87733'), factorEspecialidad: d('1.0') },
      { cantidad: d('0.1'), salarioBase: d('54.47'), fsr: d('1.788425'), factorEspecialidad: d('1.539') },
    ],
    jornalDeclarado: d('117.25'), rendimientoDeclarado: d('2.300'), rendimientoUsado: d('2.310'), cargoDeclarado: d('50.76'),
  },
  herramienta: { fraccion: d('0.03'), cargoDeclarado: d('1.52') },
  costoDirectoDeclarado: d('52.28'), cargos: CARGOS_EJEMPLO, puDeclarado: d('70.52'),
}

/** Manual §7.7 ejemplo 4: draga de arrastre ¾ yd³. */
const apu4: ApuDeclarado = {
  id: 'ej4', concepto: 'Desazolve con draga (Manual ej.4)', origen: 'norma', referencia: 'Manual 2026 §7.7 ej.4', precision: 2,
  equipo: [{ chd: d('455.60'), rendimiento: d(50), cargoDeclarado: d('9.11') }],
  costoDirectoDeclarado: d('9.11'), cargos: CARGOS_EJEMPLO, puDeclarado: d('12.29'),
}

describe('TC-05 · Manual §7.7 ejemplo 1', () => {
  it('jornal = Σ cant × SM × FSR × F.esp.; cargos 1,076.26 + 6,000 + 280 = CD 7,356.26', () => {
    expect(jornalCuadrilla(apu1.manoDeObra?.cuadrilla ?? []).toDecimalPlaces(2).toFixed()).toBe('1291.51')
    const mo = jornalCuadrilla(apu1.manoDeObra?.cuadrilla ?? []).dividedBy('1.2').toDecimalPlaces(2)
    expect(aCadena(mo)).toBe('1076.26')
    expect(aCadena(mo.plus(6000).plus(280))).toBe('7356.26')
  })
  it('PU = 7,356.26 × 1.23 = 9,048.20 (indirecto 1,691.94)', () => {
    const c = cadenaPU(d('7356.26'), { indirecto: d('0.23') }, 'por_paso')
    expect(aCadena(c.indirecto)).toBe('1691.94')
    expect(aCadena(c.pu)).toBe('9048.2')
  })
  it('las reglas DYP-014 y DYP-015 no encuentran diferencias', () => {
    const inf = ejecutar({ ...base, apus: [apu1] }, [reglaDyp014, reglaDyp015])
    expect(inf.resumen.hallazgos).toBe(0)
    expect(inf.resultados.map((r) => [r.reglaId, r.estado])).toEqual([['DYP-014', 'superada'], ['DYP-015', 'superada']])
  })
})

describe('TC-06 · Manual §7.7 ejemplo 3', () => {
  it('cadena por paso: 52.28 → 12.02 → 64.30 → 1.90 → 66.20 → 3.97 → 70.17 → 0.35 → PU 70.52', () => {
    const c = cadenaPU(d('52.28'), CARGOS_EJEMPLO, 'por_paso')
    expect([c.indirecto, c.subtotalIndirecto, c.financiamiento, c.subtotalFinanciamiento, c.utilidad, c.subtotalUtilidad, c.adicionales, c.pu].map(aCadena))
      .toEqual(['12.02', '64.3', '1.9', '66.2', '3.97', '70.17', '0.35', '70.52'])
  })
  it('sin redondeo por paso también da 70.52', () => {
    expect(aCadena(cadenaPU(d('52.28'), CARGOS_EJEMPLO, 'exacto').pu.toDecimalPlaces(2))).toBe('70.52')
  })
  it('DYP-015 detecta 2.300 frente a 2.310 y lo atribuye a la norma, no al PacOT; la cadena concilia', () => {
    const inf = ejecutar({ ...base, apus: [apu3] }, [reglaDyp014, reglaDyp015])
    const h = inf.resultados.flatMap((r) => r.hallazgos)
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ id: 'DYP-015:ej3:rendimiento', origen: 'norma', severidad: 'media' })
    expect(h[0]?.detalle).toContain('rendimiento usado (2.31)')
    expect(h[0]?.observado).toBe('50.76')
    expect(h[0]?.esperado?.startsWith('50.97')).toBe(true) // 117.25 / 2.30 con el rendimiento declarado
    expect(inf.resultados.find((r) => r.reglaId === 'DYP-014')?.estado).toBe('superada')
  })
})

describe('TC-07 · Manual §7.7 ejemplo 4', () => {
  it('9.112 → 9.11; 2.10; 11.21; 0.33; 11.54; 0.69; 12.23; 0.06; PU 12.29', () => {
    const c = cadenaPU(d('9.11'), CARGOS_EJEMPLO, 'por_paso')
    expect([c.indirecto, c.subtotalIndirecto, c.financiamiento, c.subtotalFinanciamiento, c.utilidad, c.subtotalUtilidad, c.adicionales, c.pu].map(aCadena))
      .toEqual(['2.1', '11.21', '0.33', '11.54', '0.69', '12.23', '0.06', '12.29'])
    expect(aCadena(d('455.60').dividedBy(50))).toBe('9.112')
  })
  it('las reglas no encuentran diferencias', () => {
    expect(ejecutar({ ...base, apus: [apu4] }, [reglaDyp014, reglaDyp015]).resumen.hallazgos).toBe(0)
  })
})

describe('DYP-014/015 · un APU alterado sí se detecta', () => {
  it('un PU que no sigue la cadena', () => {
    const inf = ejecutar({ ...base, apus: [{ ...apu4, puDeclarado: d('12.90') }] }, [reglaDyp014])
    expect(inf.resultados[0]?.hallazgos[0]).toMatchObject({ id: 'DYP-014:ej4:cadena', esperado: '12.2891', observado: '12.9' })
    expect(inf.resultados[0]?.hallazgos[0]?.limites[0]).toContain('sustento de los porcentajes')
  })
  it('un jornal mal sumado', () => {
    const mal: ApuDeclarado = { ...apu1, manoDeObra: { ...(apu1.manoDeObra as NonNullable<ApuDeclarado['manoDeObra']>), jornalDeclarado: d('1300') } }
    expect(ejecutar({ ...base, apus: [mal] }, [reglaDyp015]).resultados[0]?.hallazgos.map((h) => h.id)).toContain('DYP-015:ej1:jornal')
  })
  it('sin APU no se concluye: queda pendiente de evidencia, no superada', () => {
    const inf = ejecutar(base, [reglaDyp014, reglaDyp015, reglaDyp018])
    expect(inf.resultados.every((r) => r.estado === 'no_evaluable' && r.motivo)).toBe(true)
    expect(inf.reglasSinDatos).toEqual(['DYP-014', 'DYP-015', 'DYP-018'])
  })
})

describe('TC-09 · balance por tipo (Manual §6.3)', () => {
  const u = d('0.5')
  it('1.56 requiere 2; 1.46 requiere 1', () => {
    expect(balanceTipo({ nm: d('1.56'), existentes: 0, buenoRegular: 0, malo: 0, baja: 0, umbral: u }).requeridas).toBe(2)
    expect(balanceTipo({ nm: d('1.46'), existentes: 0, buenoRegular: 0, malo: 0, baja: 0, umbral: u }).requeridas).toBe(1)
  })
  it('excavadoras de Conchos: 2.406 con 3 existentes (1 buena, 1 mala, 1 baja) → requiere 2, sobrante 1 por conteo', () => {
    const b = balanceTipo({ nm: d('2.406474974376417'), existentes: 3, buenoRegular: 1, malo: 1, baja: 1, umbral: u })
    expect(b).toEqual({ requeridas: 2, faltante: 0, sobrante: 1, sumaCondicion: 3 })
  })
  it('tractor agrícola con 0.48 y ninguna existente: el umbral no justifica adquirir', () => {
    expect(balanceTipo({ nm: d('0.48084687'), existentes: 0, buenoRegular: 0, malo: 0, baja: 0, umbral: u })).toMatchObject({ requeridas: 0, faltante: 0 })
  })
})

describe('TC-10 · índices de eficiencia (Manual §9.4, p. 126)', () => {
  it('canales 180/200 = 0.90 buena; 210/200 = 1.05 óptima', () => {
    expect(clasificarIndice(indiceSobreDnmacn(d(180), d(200)) ?? d(0))).toBe('buena')
    expect(clasificarIndice(indiceSobreDnmacn(d(210), d(200)) ?? d(0))).toBe('optima')
  })
  it('estructuras 85/110 = 0.77 y 80/110 = 0.73 son regulares', () => {
    const a = indiceSobreDnmacn(d(85), d(110)) ?? d(0)
    const b = indiceSobreDnmacn(d(80), d(110)) ?? d(0)
    expect([a, b].map((x) => aCadena(x.toDecimalPlaces(2)))).toEqual(['0.77', '0.73'])
    expect([clasificarIndice(a), clasificarIndice(b)]).toEqual(['regular', 'regular'])
  })
  it('los huecos de la tabla (0.995, 0.795, 0.595) no reciben banda inventada', () => {
    for (const v of ['0.995', '0.795', '0.595']) expect(clasificarIndice(d(v))).toBeNull()
    for (const [v, c] of [['1', 'optima'], ['0.99', 'buena'], ['0.80', 'buena'], ['0.79', 'regular'], ['0.60', 'regular'], ['0.59', 'baja'], ['0', 'baja']] as const) expect(clasificarIndice(d(v))).toBe(c)
  })
  it('con DNMACN en cero no se calcula un índice engañoso', () => {
    expect(indiceSobreDnmacn(d(5), d(0))).toBeNull()
    expect(avancePorcentual(d(5), d(0))).toBeNull()
  })
})

describe('DYP-018 · regla de seguimiento', () => {
  const fila = (o: Partial<FilaAvance>): FilaAvance => ({
    id: 'f1', concepto: 'Desazolve', referencia: 'SEG-3!F10', programada: d(50), dnmacn: d(200), realizada: d(100), ejecutadoMes: d(10), avanceDeclaradoPct: d(20), ...o,
  })
  it('un avance declarado correcto no genera hallazgo; uno distinto sí', () => {
    expect(ejecutar({ ...base, seguimiento: [fila({})] }, [reglaDyp018]).resumen.hallazgos).toBe(0)
    const h = ejecutar({ ...base, seguimiento: [fila({ avanceDeclaradoPct: d(25) })] }, [reglaDyp018]).resultados[0]?.hallazgos[0]
    expect(h).toMatchObject({ id: 'DYP-018:f1:avance', esperado: '20', observado: '25' })
    expect(h?.dimensiones.ejecucion).toBe('abierta')
  })
  it('un blanco de ejecución no es avance cero', () => {
    const r = ejecutar({ ...base, seguimiento: [fila({ ejecutadoMes: null, avanceDeclaradoPct: null })] }, [reglaDyp018]).resultados[0]
    expect(r?.pendientes.join(' ')).toContain('no se interpreta como avance cero')
  })
  it('un índice en un hueco de bandas se informa como discrepancia de la norma', () => {
    const r = ejecutar({ ...base, seguimiento: [fila({ programada: d(199), realizada: null, ejecutadoMes: null, avanceDeclaradoPct: null })] }, [reglaDyp018]).resultados[0]
    expect(r?.hallazgos.map((h) => [h.id, h.origen, h.severidad])).toEqual([['DYP-018:f1:banda-programación', 'norma', 'informativa']])
  })
})
