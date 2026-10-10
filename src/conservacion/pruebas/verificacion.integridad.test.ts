/**
 * Nivel 1 · integridad del diagnóstico. Casos sintéticos con cuentas hechas a mano, el PacOT real de la SRL
 * (solo lectura) y, si se indica CONCHOS_M05_EVIDENCIAS, el del Módulo 5 (no está en el repositorio).
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizarDataJson, VistaLibro } from '../nucleo'
import { extraerLibro } from '../derivacion/extraer'
import type { Cifra, FichaCanal, LibroDerivado, TramoDiagnostico } from '../derivacion/tipos'
import { unirTramosConFichas } from '../verificacion/uniones'
import { verificarLibro } from '../verificacion/verificar'

const cif = (valor: string | null, ref = 'x', formula: string | null = null, texto?: string): Cifra => ({
  valor, ref, formula, origen: valor === null ? 'vacio' : formula ? 'formula' : 'capturado', ...(texto !== undefined ? { texto } : {}),
})
const ficha = (fila: number, inv: string, pi: string, pf: string, km: string): FichaCanal => ({
  fila, inventario: inv, nombre: 'CANAL', categoria: 'Principales', pkInicial: pi, pkFinal: pf, km: cif(km, `IO1!J${fila}`),
  gasto: cif('1'), velocidad: cif('1'), pendiente: cif('0.0001'), area: cif('10'), plantilla: cif('3'), tirante: cif('1'), libreBordo: cif('0.5'),
  talud: cif('1.5'), corona: cif('4'), revestimiento: 'Concreto', seccion: 'Trapezoidal',
})
const tramo = (fila: number, inv: string, pi: string, pf: string, km: string, trabajo: string | null, param = km): TramoDiagnostico => ({
  fila, red: 'distribucion', inventario: inv, obra: 'CANAL', pkInicial: pi, pkFinal: pf, km: cif(km, `DIAG-01!E${fila}`),
  conceptos: [{ concepto: 'DESAZOLVE', parametrica: cif(param, `DIAG-01!H${fila}`), trabajo: cif(trabajo, `DIAG-01!I${fila}`) }],
})
const libro = (p: Partial<LibroDerivado>): LibroDerivado => ({
  sha256: 's', moduloNombre: null, ciclo: null, baseValores: 'cache', conceptosDiagnostico: ['DESAZOLVE'], tramos: [], totalesDiagnostico: [],
  filasTotales: [], necesidades: [], sumasBloque: [], totalGeneral3dn: null, programa: [],
  inventarioKm: { distribucion: cif('0'), drenaje: cif('0'), caminos: cif('0') }, fichas: { canales: [], drenes: [], caminos: [] },
  extractorVersion: 3, avisos: [], ...p,
})
const ids = (l: LibroDerivado, prefijo: string, estado?: string) => verificarLibro(l).resultados.filter((r) => r.id.startsWith(prefijo) && (!estado || r.estado === estado))

describe('uniones tramo ↔ ficha', () => {
  it('empareja por inventario y PK; un canal partido en tramos usa una ficha distinta por tramo', () => {
    const l = libro({
      tramos: [tramo(17, '1', '0+000', '2+000', '2', '100'), tramo(18, '1', '2+000', '4+000', '2', '100')],
      fichas: { canales: [ficha(16, '1', '2+000', '4+000', '2'), ficha(15, '1', '0+000', '2+000', '2')], drenes: [], caminos: [] },
    })
    const u = unirTramosConFichas(l)
    expect(u.uniones.map((x) => x.ficha?.fila)).toEqual([15, 16])
    expect(u.fichasSinTramo).toHaveLength(0)
  })
  it('mismo inventario y longitud con PK distinto: se empareja por longitud y se reporta la diferencia de PK', () => {
    const l = libro({ tramos: [tramo(17, '232', '0+000', '10+085', '4', '1')], fichas: { canales: [ficha(29, '232', '6+085', '10+085', '4')], drenes: [], caminos: [] } })
    expect(unirTramosConFichas(l).uniones[0]?.por).toBe('inventario_km')
    const r = ids(l, 'INT-03:')[0]
    expect(r?.estado).toBe('no_cuadra')
    expect(r?.esperado).toBe('6+085 → 10+085')
    expect(r?.observado).toBe('0+000 → 10+085')
  })
})

describe('integridad aritmética', () => {
  it('longitud efectiva = diferencia de cadenamientos: 0+000→10+085 con 4 km no cuadra (esperado 10.085)', () => {
    const l = libro({ tramos: [tramo(17, '232', '0+000', '10+085', '4', '1')] })
    const r = ids(l, 'INT-05:17')[0]
    expect(r?.estado).toBe('no_cuadra')
    expect(r?.esperado).toBe('10.085')
    expect(r?.diferencia).toBe('-6.085')
  })
  it('trabajo con paramétrica en cero y paramétrica mayor que la longitud se marcan; una paramétrica parcial no', () => {
    const l = libro({
      tramos: [tramo(17, '1', '0+000', '2+000', '2', '50', '0'), tramo(18, '2', '0+000', '2+000', '2', '50', '3'), tramo(19, '3', '0+000', '2+000', '2', '50', '0.5')],
    })
    expect(ids(l, 'INT-04:17', 'no_cuadra')).toHaveLength(1)
    expect(ids(l, 'INT-04:18', 'no_cuadra')).toHaveLength(1)
    expect(ids(l, 'INT-04:19')).toHaveLength(0)
  })
  it('un texto en una celda numérica se señala', () => {
    const t = tramo(17, '1', '0+000', '2+000', '2', null)
    const l = libro({ tramos: [{ ...t, conceptos: [{ concepto: 'DESAZOLVE', parametrica: cif('2'), trabajo: cif(null, 'DIAG-01!I17', null, '|') }] }] })
    const r = ids(l, 'INT-09:')[0]
    expect(r?.estado).toBe('no_cuadra')
    expect(r?.observado).toBe('|')
  })
})

describe('filas de totales', () => {
  const trs = [tramo(17, '1', '0+000', '2+000', '2', '100'), tramo(18, '2', '0+000', '3+000', '3', '200'), tramo(19, '3', '0+000', '1+000', '1', '50')]
  const totales = (fTrabajo: string | null, valor: string) => ({
    fila: 15, km: cif('6', 'DIAG-01!E15', 'SUM(E17:E19)'),
    conceptos: [{ concepto: 'DESAZOLVE', parametrica: cif('6', 'DIAG-01!H15', 'SUM(H17:H19)'), trabajo: cif(valor, 'DIAG-01!I15', fTrabajo) }],
  })
  it('SUM completa con la cifra correcta (100+200+50=350): sin diferencias', () => {
    const l = libro({ tramos: trs, filasTotales: [totales('SUM(I17:I19)', '350')] })
    expect(ids(l, 'INT-08:', 'no_cuadra')).toHaveLength(0)
    expect(ids(l, 'INT-08:resumen:15')[0]?.estado).toBe('cuadra')
  })
  it('el rango deja fuera una fila con valor: no cuadra y aporta su cantidad (la fila 19 tiene 50)', () => {
    const l = libro({ tramos: trs, filasTotales: [totales('SUM(I17:I18)', '300')] })
    const r = ids(l, 'INT-08:DIAG-01!I15:rango')[0]
    expect(r?.estado).toBe('no_cuadra')
    expect(r?.diferencia).toBe('50')
  })
  it('el rango deja fuera una fila SIN valor en esa columna: solo informativo (la fórmula está incompleta, el total no cambia)', () => {
    const vacio = [...trs.slice(0, 2), tramo(19, '3', '0+000', '1+000', '1', null)]
    const l = libro({ tramos: vacio, filasTotales: [totales('SUM(I17:I18)', '300')] })
    expect(ids(l, 'INT-08:DIAG-01!I15:rango')[0]?.estado).toBe('informativo')
  })
  it('un total que es el enlace a otra celda (=N299) no es una suma', () => {
    const l = libro({ tramos: trs, filasTotales: [totales('N299', '350')] })
    const r = ids(l, 'INT-08:DIAG-01!I15', 'no_cuadra')[0]
    expect(r?.detalle).toMatch(/=N299/)
  })
  it('la suma no coincide con el valor guardado: señala la diferencia', () => {
    const l = libro({ tramos: trs, filasTotales: [totales('SUM(I17:I19)', '340')] })
    const r = ids(l, 'INT-08:DIAG-01!I15:suma')[0]
    expect(r?.estado).toBe('no_cuadra')
    expect(r?.esperado).toBe('350')
    expect(r?.diferencia).toBe('-10')
  })
})

const carpetaSrl = process.env.CONCHOS_EVIDENCIAS ?? path.resolve(process.cwd(), '../Conservacion/Skill/ejemplo_Conchos/evidencias/lector_xls')
const carpetaM05 = process.env.CONCHOS_M05_EVIDENCIAS ?? ''
const cargar = (dir: string): LibroDerivado => {
  const crudo: unknown = JSON.parse(readFileSync(path.join(dir, 'data.json'), 'utf8'))
  return extraerLibro(new VistaLibro(normalizarDataJson(crudo, { sha256: 'r', extractor: 'x' })))
}

describe.skipIf(!existsSync(path.join(carpetaSrl, 'data.json')))('SRL Unidad Conchos · integridad con el PacOT real', () => {
  const l = cargar(carpetaSrl)
  const v = verificarLibro(l)

  it('los 60 tramos de canales se emparejan con IO1 y no hay drenes', () => {
    expect(ids(l, 'INT-01:resumen:distribucion')[0]?.estado).toBe('cuadra')
    expect(l.fichas.drenes).toHaveLength(0)
    expect(v.resultados.some((r) => r.red === 'drenaje')).toBe(false)
  })
  it('el diagnóstico omite el camino auxiliar de 2.28 km: caminos 200.182 contra 202.462 del inventario', () => {
    const r = ids(l, 'INT-07:caminos')[0]
    expect(r?.estado).toBe('no_cuadra')
    expect(r?.observado).toBe('200.182')
    expect(r?.esperado).toBe('202.462')
    expect(ids(l, 'INT-02:caminos')[0]?.observado).toBe('2.28')
  })
  it('canales: Σ longitud efectiva = inventario (101.231) y las filas de totales cuadran', () => {
    expect(ids(l, 'INT-07:distribucion')[0]?.estado).toBe('cuadra')
    expect(ids(l, 'INT-08:resumen:15')[0]?.estado).toBe('cuadra')
  })
  it('3DN toma "Terracerias" de la columna DESCOPETE BORDOS de DIAG-01: se pide confirmar el rótulo', () => {
    const r = ids(l, 'INT-10:')[0]
    expect(r?.estado).toBe('informativo')
    expect(r?.detalle).toMatch(/DESCOPETE BORDOS/)
  })
  it('ningún tramo con inventario en texto (1.-1) queda sin ficha', () => {
    expect(ids(l, 'INT-01:', 'no_cuadra')).toHaveLength(0)
  })
})

describe.skipIf(!carpetaM05 || !existsSync(path.join(carpetaM05, 'data.json')))('Módulo 5 · integridad con el PacOT real', () => {
  const l = carpetaM05 ? cargar(carpetaM05) : libro({})

  it('179 canales y 91 drenes emparejados; 7 filas de tubería sin ficha; bloque de tubería propio', () => {
    expect(l.fichas.canales).toHaveLength(179)
    expect(l.fichas.drenes).toHaveLength(91)
    expect(l.tramos.filter((t) => t.red === 'tuberia')).toHaveLength(7)
    expect(unirTramosConFichas(l).uniones.filter((x) => !x.ficha && x.tramo.red === 'distribucion')).toHaveLength(7)
  })
  it('detecta H299 (=N299), el texto "|" en O341 y los 13.455 km de tubería repetidos', () => {
    expect(ids(l, 'INT-08:DIAG-01!H299', 'no_cuadra')[0]?.detalle).toMatch(/=N299/)
    expect(ids(l, 'INT-09:DIAG-01!O341')[0]?.observado).toBe('|')
    expect(ids(l, 'INT-13')[0]?.observado).toBe('13.455')
  })
  it('F343 deja fuera las filas 303-307 pero hoy no cambia el total (informativo)', () => {
    const r = ids(l, 'INT-08:DIAG-01!F343:rango')[0]
    expect(r?.estado).toBe('informativo')
    expect(r?.detalle).toMatch(/303, 304, 305, 306, 307/)
  })
  it('los drenes 232 y 269 traen PK inicial 0+000 en DIAG-01 y K-6+085 / K-6+700 en IO2', () => {
    const r = ids(l, 'INT-03:').map((x) => x.esperado)
    expect(r).toContain('6+085 → 10+085')
    expect(r).toContain('6+700 → 15+662')
    expect(ids(l, 'INT-05:', 'no_cuadra').map((x) => x.diferencia)).toContain('-6.085')
  })
  it('Σ canales de DIAG-01 = 242.989 contra 229.534 del inventario: la diferencia es la tubería (13.455 km)', () => {
    const r = ids(l, 'INT-07:distribucion')[0]
    expect(r?.estado).toBe('no_cuadra')
    expect(r?.diferencia).toBe('13.455')
    expect(r?.detalle).toMatch(/Tramos sin ficha: 13\.455/)
  })
})
