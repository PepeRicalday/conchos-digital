/**
 * Nivel 3 · razonabilidad física. Cuentas hechas a mano (secciones simples) y los PacOT reales.
 * Hidráulica y Manning son referencia técnica (no norma); el 15 % de pérdida de capacidad es del Anexo Técnico General §2.2.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizarDataJson, VistaLibro } from '../nucleo'
import { extraerLibro } from '../derivacion/extraer'
import type { Cifra, FichaCanal, LibroDerivado, TramoDiagnostico } from '../derivacion/tipos'
import { verificarLibro } from '../verificacion/verificar'

const cif = (valor: string | null, ref = 'x'): Cifra => ({ valor, ref, formula: null, origen: valor === null ? 'vacio' : 'capturado' })
interface Seccion { b: string; z: string; d: string; lb: string; A: string; Q: string; S: string; V?: string; rev?: string }
const ficha = (s: Seccion): FichaCanal => ({
  fila: 17, inventario: '1', nombre: 'CANAL', categoria: 'Principales', pkInicial: '0+000', pkFinal: '1+000', km: cif('1', 'IO1!J17'),
  gasto: cif(s.Q, 'IO1!L17'), velocidad: cif(s.V ?? null), pendiente: cif(s.S, 'IO1!N17'), area: cif(s.A, 'IO1!O17'), plantilla: cif(s.b, 'IO1!P17'),
  tirante: cif(s.d, 'IO1!Q17'), libreBordo: cif(s.lb), talud: cif(s.z, 'IO1!S17'), corona: cif('4'), revestimiento: s.rev ?? 'Concreto', seccion: s.z === '0' ? 'Rectangular' : 'Trapezoidal',
})
const libro = (s: Seccion, desazolve: string, acuaticas: string): LibroDerivado => {
  const t: TramoDiagnostico = {
    fila: 17, red: 'distribucion', inventario: '1', obra: 'CANAL', pkInicial: '0+000', pkFinal: '1+000', km: cif('1', 'DIAG-01!E17'),
    conceptos: [
      { concepto: 'DESAZOLVE', parametrica: cif('1'), trabajo: cif(desazolve, 'DIAG-01!I17') },
      { concepto: 'EXTRAC. PLANTAS ACUATICAS', parametrica: cif('1'), trabajo: cif(acuaticas, 'DIAG-01!M17') },
    ],
  }
  return {
    sha256: 's', moduloNombre: null, ciclo: null, baseValores: 'cache', conceptosDiagnostico: ['DESAZOLVE', 'EXTRAC. PLANTAS ACUATICAS'], tramos: [t],
    totalesDiagnostico: [], filasTotales: [], necesidades: [], sumasBloque: [], totalGeneral3dn: null, programa: [],
    inventarioKm: { distribucion: cif('1'), drenaje: cif('0'), caminos: cif('0') }, fichas: { canales: [ficha(s)], drenes: [], caminos: [] }, extractorVersion: 3, avisos: [],
  }
}
const ids = (l: LibroDerivado, p: string) => verificarLibro(l).resultados.filter((r) => r.id.startsWith(p))

// Sección rectangular b = 2, d = 1, lb = 0.5: A = 2, P = 4, R = 0.5, S = 0.0004 → Q = A·R^(2/3)·√S ÷ n = 2 × 0.62996 × 0.02 ÷ n
const RECT: Seccion = { b: '2', z: '0', d: '1', lb: '0.5', A: '2', Q: '1.68', S: '0.0004', V: '0.84' }

describe('hidráulica de la ficha y Manning (cuentas a mano)', () => {
  it('Q = 1.68 m³/s da n = 0.015 (concreto 0.010–0.025): no se marca nada y A y Q cuadran', () => {
    const l = libro(RECT, '0', '0')
    expect(ids(l, 'FIS-02:').filter((r) => r.estado === 'atipico')).toHaveLength(0)
    expect(ids(l, 'FIS-01:resumen')[0]?.estado).toBe('cuadra')
  })
  it('con Q = 0.5 m³/s n sale 0.0504: fuera de la banda de concreto, atípico, con el recálculo paso a paso', () => {
    const l = libro({ ...RECT, Q: '0.5', V: '0.25' }, '0', '0')
    const r = ids(l, 'FIS-02:17')[0]
    expect(r?.estado).toBe('atipico')
    expect(r?.base).toBe('referencia_tecnica')
    expect(Number(r?.observado)).toBeCloseTo(0.0504, 4)
    expect(r?.recalculo.map((p) => p.etiqueta)).toEqual(['Perímetro mojado (m)', 'Radio hidráulico (m)', 'n implícito'])
    expect(r?.recalculo[0]?.valor).toBe('4')
  })
  it('un área que no es y·(b + z·y) se marca: A = 3 con b = 2, d = 1, talud 0 (debería ser 2)', () => {
    const r = ids(libro({ ...RECT, A: '3' }, '0', '0'), 'FIS-01:17')[0]
    expect(r?.estado).toBe('no_cuadra')
    expect(r?.esperado).toBe('2')
  })
})

describe('lo programado contra lo que la sección permite', () => {
  // L = 1 km. Área de diseño A = 2 m²; sección completa hasta el bordo = 2 × 1.5 = 3 m².
  it('desazolve de 40 m³/km·1000 = 0.04 m² (2 %): sin fila; 700 → 0.7 m² (35 %): solo cuenta en el resumen', () => {
    expect(ids(libro(RECT, '40', '0'), 'FIS-03:17')).toHaveLength(0)
    const l = libro(RECT, '700', '0')
    expect(ids(l, 'FIS-03:17')).toHaveLength(0)
    expect(ids(l, 'FIS-03:resumen')[0]?.detalle).toMatch(/1 superan el 15 %/)
  })
  it('azolve de 2.4 m² (120 % del área de diseño, pero cabe en la sección completa de 3 m²): informativo', () => {
    const r = ids(libro(RECT, '2400', '0'), 'FIS-03:17')[0]
    expect(r?.estado).toBe('informativo')
    expect(r?.base).toBe('norma')
    expect(r?.observado).toBe('120 %')
  })
  it('azolve de 4 m² (más que los 3 m² de la sección completa): no cuadra', () => {
    const r = ids(libro(RECT, '4000', '0'), 'FIS-03:17')[0]
    expect(r?.estado).toBe('no_cuadra')
    expect(r?.base).toBe('referencia_tecnica')
  })
  it('plantas acuáticas: espejo 0.1 × (b + 2·z·d) × L = 0.2 ha; 0.5 ha no cabe, 0.2 ha sí', () => {
    expect(ids(libro(RECT, '0', '0.5'), 'FIS-04:17')[0]?.estado).toBe('no_cuadra')
    expect(ids(libro(RECT, '0', '0.2'), 'FIS-04:17')).toHaveLength(0)
  })
})

const carpetaSrl = process.env.CONCHOS_EVIDENCIAS ?? path.resolve(process.cwd(), '../Conservacion/Skill/ejemplo_Conchos/evidencias/lector_xls')
const carpetaM05 = process.env.CONCHOS_M05_EVIDENCIAS ?? ''
const cargar = (dir: string): LibroDerivado => extraerLibro(new VistaLibro(normalizarDataJson(JSON.parse(readFileSync(path.join(dir, 'data.json'), 'utf8')) as unknown, { sha256: 'r', extractor: 'x' })))

describe.skipIf(!existsSync(path.join(carpetaSrl, 'data.json')))('SRL Unidad Conchos · física con el PacOT real', () => {
  const l = cargar(carpetaSrl)
  it('60 tramos con sección y gasto coherentes, Manning usual en 59, azolve por debajo del 15 % y acuáticas dentro del espejo', () => {
    expect(ids(l, 'FIS-01:resumen')[0]).toMatchObject({ estado: 'cuadra', detalle: expect.stringMatching(/^60 tramos revisados · 0/) })
    expect(ids(l, 'FIS-02:resumen')[0]).toMatchObject({ estado: 'cuadra', detalle: expect.stringMatching(/^59 tramos revisados · 0/) })
    expect(ids(l, 'FIS-03:resumen')[0]?.detalle).toMatch(/^60 tramos revisados\. Pérdida de capacidad implícita: 0 superan el 15 %/)
    expect(ids(l, 'FIS-04:resumen')[0]?.estado).toBe('cuadra')
  })
})

describe.skipIf(!carpetaM05 || !existsSync(path.join(carpetaM05, 'data.json')))('Módulo 5 · física con el PacOT real', () => {
  const l = carpetaM05 ? cargar(carpetaM05) : ({} as LibroDerivado)
  it('el azolve que programa el libro supera el 15 % del Anexo en los 270 tramos con ficha de canal o dren', () => {
    expect(ids(l, 'FIS-03:resumen')[0]?.detalle).toMatch(/^270 tramos revisados\. Pérdida de capacidad implícita: 270 superan el 15 %/)
  })
  it('sección y gasto de la ficha coherentes en los 270 tramos', () => {
    expect(ids(l, 'FIS-01:resumen')[0]?.detalle).toMatch(/^270 tramos revisados · 0/)
  })
})
