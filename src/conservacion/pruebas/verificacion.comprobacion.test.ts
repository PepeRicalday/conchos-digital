/**
 * Comprobación tramo por tramo (DIAG-01). Casos de oro con cuentas hechas a mano sobre el PacOT real de la SRL (solo lectura).
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizarDataJson, VistaLibro } from '../nucleo'
import { extraerLibro } from '../derivacion/extraer'
import type { LibroDerivado } from '../derivacion/tipos'
import { comprobarTramo } from '../verificacion/comprobacion'
import { verificarLibro } from '../verificacion/verificar'

const carpetaSrl = process.env.CONCHOS_EVIDENCIAS ?? path.resolve(process.cwd(), '../Conservacion/Skill/ejemplo_Conchos/evidencias/lector_xls')
const cargar = (dir: string): LibroDerivado => extraerLibro(new VistaLibro(normalizarDataJson(JSON.parse(readFileSync(path.join(dir, 'data.json'), 'utf8')) as unknown, { sha256: 'r', extractor: 'x' })))

describe.skipIf(!existsSync(path.join(carpetaSrl, 'data.json')))('SRL Unidad Conchos · comprobación por tramo', () => {
  const l = cargar(carpetaSrl)
  const v = verificarLibro(l)
  const idx = (re: RegExp) => l.conceptosDiagnostico.findIndex((c) => re.test(c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()))
  const comp = (fila: number, re: RegExp) => comprobarTramo(l, v.criterios, v.uniones, fila, idx(re))

  it('limpia fila 17 (K-0+000 a K-2+000): 2 km × 2 márgenes × 7.6 m / 10 000 = 3.04 ha; el ancho por margen es el parámetro libre', () => {
    const c = comp(17, /LIMPIA/)
    expect(c).toMatchObject({ unidad: 'ha', recalculado: '3.04', enLibro: '3.04', diferencia: '0', estado: 'cuadra' })
    expect(c?.parametroLibre).toMatchObject({ nombre: 'Ancho tratado por margen', valor: '7.6', unidad: 'm', implicito: '7.6' })
    expect(c?.diagrama).toMatchObject({ modo: 'limpia', b: 13.3, z: 1.75, d: 3.2, lb: 0.6, anchoFranja: 7.6 })
  })
  it('desazolve fila 17: 1000 × 2 × (0.4 × (13.3 + 1.75 × 0.4) + 0.1) = 11 400 m³', () => {
    const c = comp(17, /DESAZOLVE/)
    expect(c).toMatchObject({ unidad: 'm³', recalculado: '11400', enLibro: '11400', estado: 'cuadra' })
    expect(c?.parametroLibre).toMatchObject({ nombre: 'Espesor de azolve h', valor: '0.4' })
  })
  it('desazolve fila 76 no sigue el criterio: correspondería 1 437.8 y el libro tiene 609.7', () => {
    expect(comp(76, /DESAZOLVE/)).toMatchObject({ recalculado: '1437.8', enLibro: '609.7', diferencia: '-828.1', estadoCriterio: 'atipico', estado: 'atipico' })
  })
  it('plantas acuáticas fila 17: 2 km × 13.3 m × 1.0 / 10 000 × 1000 = 2.66 ha (la dimensión es la plantilla)', () => {
    const c = comp(17, /ACUATICA/)
    expect(c).toMatchObject({ recalculado: '2.66', enLibro: '2.66', estado: 'cuadra' })
    expect(c?.parametroLibre).toMatchObject({ valor: '1' })
  })
  it('descopete fila 17: 4 500 m³/km × 2 km = 9 000; el control contra el desazolve del tramo cuadra (9 000 ≤ 11 400)', () => {
    const c = comp(17, /DESCOPETE/)
    expect(c).toMatchObject({ recalculado: '9000', enLibro: '9000', estadoCriterio: 'cuadra', estado: 'cuadra' })
    expect(c?.controles[0]).toMatchObject({ id: 'descopete-vs-desazolve', estado: 'cuadra' })
  })
  it('descopete fila 55: sigue el 4 500 × L pero excede al desazolve del tramo (5 760 contra 1 558.4): queda atípico por el control', () => {
    const c = comp(55, /DESCOPETE/)
    expect(c).toMatchObject({ estadoCriterio: 'cuadra', estado: 'atipico' })
    expect(c?.controles[0]).toMatchObject({ estado: 'atipico', base: 'referencia_tecnica' })
  })
  it('descopete: exactamente 21 tramos exceden al desazolve del mismo tramo', () => {
    const filas = l.tramos.filter((t) => t.red === 'distribucion').map((t) => t.fila)
    const n = filas.filter((f) => comp(f, /DESCOPETE/)?.controles.some((x) => x.estado === 'atipico')).length
    expect(n).toBe(21)
  })
  it('reparación de revestimiento fila 17: 5 m³/km × 2 km = 10 m³ y se dice que es una reserva, no una medición', () => {
    const c = comp(17, /REVESTIMIENTO/)
    expect(c).toMatchObject({ recalculado: '10', enLibro: '10', estado: 'cuadra' })
    expect(c?.controles[0]).toMatchObject({ id: 'revestimiento-equivalencia', estado: 'informativo', base: 'referencia_tecnica' })
    expect(c?.diagrama?.modo).toBe('revestimiento')
  })
  it('cada celda de origen que se cita existe en el libro (DIAG-01 o IO1)', () => {
    const c = comp(17, /LIMPIA/)
    expect(c?.refs.some((r) => r.startsWith('IO1!'))).toBe(true)
    expect(c?.refs.some((r) => r.startsWith('DIAG-01!'))).toBe(true)
  })
})
