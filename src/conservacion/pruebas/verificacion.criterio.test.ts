/**
 * Nivel 2 · criterio del libro. Cuentas hechas a mano; el PacOT real de la SRL (solo lectura) y, si se indica
 * CONCHOS_M05_EVIDENCIAS, el del Módulo 5. Un "atípico" es un candidato a revisión, nunca un error confirmado.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizarDataJson, VistaLibro } from '../nucleo'
import { extraerLibro } from '../derivacion/extraer'
import type { Cifra, FichaCanal, LibroDerivado, TramoDiagnostico } from '../derivacion/tipos'
import { inferirCriterios } from '../verificacion/criterio'
import { unirTramosConFichas } from '../verificacion/uniones'
import { verificarLibro } from '../verificacion/verificar'

const cif = (valor: string | null, ref = 'x'): Cifra => ({ valor, ref, formula: null, origen: valor === null ? 'vacio' : 'capturado' })
const ficha = (fila: number, km: string, b = '3'): FichaCanal => ({
  fila, inventario: String(fila), nombre: 'CANAL', categoria: 'Principales', pkInicial: `${fila}+000`, pkFinal: `${fila + 1}+000`, km: cif(km, `IO1!J${fila}`),
  gasto: cif('1'), velocidad: cif('1'), pendiente: cif('0.0001'), area: cif('10'), plantilla: cif(b), tirante: cif('1'), libreBordo: cif('0.5'),
  talud: cif('1.5'), corona: cif('4'), revestimiento: 'Concreto', seccion: 'Trapezoidal',
})
const tramo = (fila: number, km: string, trabajo: string): TramoDiagnostico => ({
  fila, red: 'distribucion', inventario: String(fila), obra: 'CANAL', pkInicial: `${fila}+000`, pkFinal: `${fila + 1}+000`, km: cif(km, `DIAG-01!E${fila}`),
  conceptos: [{ concepto: 'DESCOPETE BORDOS', parametrica: cif(km), trabajo: cif(trabajo, `DIAG-01!K${fila}`) }],
})
const libro = (km: string[], trabajos: string[]): LibroDerivado => ({
  sha256: 's', moduloNombre: null, ciclo: null, baseValores: 'cache', conceptosDiagnostico: ['DESCOPETE BORDOS'],
  tramos: km.map((k, i) => tramo(17 + i, k, trabajos[i]!)), totalesDiagnostico: [], filasTotales: [], necesidades: [], sumasBloque: [], totalGeneral3dn: null, programa: [],
  inventarioKm: { distribucion: cif('0'), drenaje: cif('0'), caminos: cif('0') },
  fichas: { canales: km.map((k, i) => ficha(17 + i, k)), drenes: [], caminos: [] }, extractorVersion: 3, avisos: [],
})
const criterio = (l: LibroDerivado) => inferirCriterios(l, unirTramosConFichas(l))

describe('inferencia de criterio (sintética)', () => {
  it('recupera "10 × L" cuando 6 de 7 tramos lo cumplen y marca el séptimo como atípico con su recálculo', () => {
    const km = ['2', '1.5', '3', '0.5', '4', '2.5', '1']
    const l = libro(km, ['20', '15', '30', '5', '40', '25', '25'])   // el último debería ser 10
    const { criterios, resultados } = criterio(l)
    expect(criterios).toHaveLength(1)
    expect(criterios[0]?.grupos[0]?.formula).toBe('10 × L')
    expect(criterios[0]?.siguen).toBe(6)
    const a = resultados.filter((r) => r.estado === 'atipico')
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ tramoFila: 23, esperado: '10', observado: '25', diferencia: '15', base: 'criterio_libro', nivel: 2 })
    expect(a[0]?.recalculo.some((p) => p.etiqueta.startsWith('Cantidad según'))).toBe(true)
  })
  it('si todos los tramos son distintos no hay criterio recuperable y no se marca ningún atípico', () => {
    const l = libro(['2', '1.5', '3', '0.5', '4'], ['21', '17', '33', '5', '47'])
    const { resultados } = criterio(l)
    expect(resultados.filter((r) => r.estado === 'atipico')).toHaveLength(0)
    expect(resultados.some((r) => r.estado === 'no_evaluable')).toBe(true)
  })
  it('con menos de tres tramos no se infiere nada', () => {
    expect(criterio(libro(['2', '1.5'], ['20', '15'])).criterios).toHaveLength(0)
  })
  it('la verificación de un libro incluye los criterios y cuenta los atípicos', () => {
    const l = libro(['2', '1.5', '3', '0.5', '4', '2.5', '1'], ['20', '15', '30', '5', '40', '25', '25'])
    const v = verificarLibro(l)
    expect(v.criterios).toHaveLength(1)
    expect(v.resultados.filter((r) => r.nivel === 2 && r.estado === 'atipico')).toHaveLength(1)
  })
})

const carpetaSrl = process.env.CONCHOS_EVIDENCIAS ?? path.resolve(process.cwd(), '../Conservacion/Skill/ejemplo_Conchos/evidencias/lector_xls')
const carpetaM05 = process.env.CONCHOS_M05_EVIDENCIAS ?? ''
const cargar = (dir: string): LibroDerivado => extraerLibro(new VistaLibro(normalizarDataJson(JSON.parse(readFileSync(path.join(dir, 'data.json'), 'utf8')) as unknown, { sha256: 'r', extractor: 'x' })))
const grupo = (v: ReturnType<typeof verificarLibro>, red: string, patron: RegExp) => v.criterios.find((c) => c.red === red && patron.test(c.concepto))

describe.skipIf(!existsSync(path.join(carpetaSrl, 'data.json')))('SRL Unidad Conchos · criterio recuperado del PacOT real', () => {
  const l = cargar(carpetaSrl)
  const v = verificarLibro(l)

  it('recupera los criterios del libro en los 60 tramos de canales', () => {
    expect(grupo(v, 'distribucion', /LIMPIA/)?.grupos[0]?.formula).toBe('1.52 × L')
    expect(grupo(v, 'distribucion', /DESCOPETE/)?.grupos[0]?.formula).toBe('4500 × L')
    expect(grupo(v, 'distribucion', /ACUATICAS/)?.grupos[0]?.formula).toBe('0.1 × b × L')
    expect(grupo(v, 'distribucion', /REVESTIMIENTO/)?.grupos[0]?.formula).toBe('5 × L')
    for (const re of [/LIMPIA/, /DESCOPETE/, /ACUATICAS/, /REVESTIMIENTO/]) expect(grupo(v, 'distribucion', re)?.siguen).toBe(60)
  })
  it('desazolve: h = 0.4 m con c = 0.1 en 51 de 60 tramos; los otros 9 son las filas 55-57, 70, 71, 73, 74, 75 y 76', () => {
    const c = grupo(v, 'distribucion', /DESAZOLVE/)
    expect(c?.grupos[0]?.formula).toBe('1000 × L × (0.4 × (b + z × 0.4) + 0.1)')
    expect(c?.siguen).toBe(51)
    const filas = v.resultados.filter((r) => r.estado === 'atipico' && r.concepto === 'DESAZOLVE' && r.red === 'distribucion').map((r) => r.tramoFila).sort((a, b) => Number(a) - Number(b))
    expect(filas).toEqual([55, 56, 57, 70, 71, 73, 74, 75, 76])
  })
  it('caso de oro a mano: fila 17 (L 2.0, b 13.3, z 1.75) = 1000×2×(0.4×(13.3+0.7)+0.1) = 11 400 sigue el criterio', () => {
    expect(v.resultados.find((r) => r.id === 'CRI-02:17:DESAZOLVE')).toBeUndefined()
  })
  it('caso de oro a mano: fila 76 (L 0.91, b 3, z 1.75) correspondería 1 437.8 y el libro tiene 609.7', () => {
    const r = v.resultados.find((x) => x.id === 'CRI-02:76:DESAZOLVE')
    expect(r).toMatchObject({ estado: 'atipico', esperado: '1437.8', observado: '609.7', diferencia: '-828.1' })
  })
  it('en caminos, DIAG-01 reutiliza rótulos de canales: se nombra el concepto real según 3DN', () => {
    const nombres = v.criterios.filter((c) => c.red === 'caminos').map((c) => c.concepto)
    expect(nombres.some((n) => /Conformaci/.test(n))).toBe(true)
    expect(nombres.some((n) => /Reposici/.test(n))).toBe(true)
  })
})

describe.skipIf(!carpetaM05 || !existsSync(path.join(carpetaM05, 'data.json')))('Módulo 5 · criterio recuperado del PacOT real', () => {
  const l = carpetaM05 ? cargar(carpetaM05) : ({} as LibroDerivado)
  const v = carpetaM05 ? verificarLibro(l) : ({ criterios: [], resultados: [], resumen: { total: 0, porEstado: {} } } as unknown as ReturnType<typeof verificarLibro>)

  it('limpia de canales: 0.06 × L en revestidos y L × (0.06 + 0.2 × (d+lb) × √(1+z²)) en los 24 que DIAG-01 trata como sin revestir', () => {
    const c = grupo(v, 'distribucion', /LIMPIA/)
    expect(c?.agrupacion).toBe('revestimiento_diag')
    expect(c?.grupos.find((g) => /sin revestir/.test(g.clave))).toMatchObject({ n: 24, siguen: 24, modelo: 'limpia·sección' })
    expect(c?.grupos.find((g) => /^revestido/.test(g.clave))?.formula).toBe('0.06 × L')
  })
  it('desazolve de canales: espesor h por categoría (laterales 0.6, sublaterales 0.5, ramales 0.3)', () => {
    const g = grupo(v, 'distribucion', /DESAZOLVE/)?.grupos ?? []
    expect(g.find((x) => /laterales/.test(x.clave) && !/sub/.test(x.clave))?.coeficientes.h).toBe('0.6')
    expect(g.find((x) => /sublaterales/.test(x.clave))?.coeficientes.h).toBe('0.5')
    expect(g.find((x) => /ramales/.test(x.clave))?.coeficientes.h).toBe('0.3')
  })
  it('revestimiento: 5×L laterales, 4×L sublaterales, 3×L ramales; las filas 100, 101 (laterales con ×3) y 57 (ramal con ×4) son atípicas', () => {
    const c = grupo(v, 'distribucion', /REPARACI/)
    expect(c?.grupos.map((g) => g.formula)).toEqual(expect.arrayContaining(['5 × L', '4 × L', '3 × L']))
    const filas = v.resultados.filter((r) => r.estado === 'atipico' && /REPARACI/.test(r.concepto ?? '') && r.red === 'distribucion').map((r) => r.tramoFila)
    expect(filas).toEqual(expect.arrayContaining([100, 101, 57]))
  })
  it('terracerías 3 303.334719 × L en 179/179 canales y 2 000 × L en 91/91 drenes; plantas acuáticas 0.1 × b × L', () => {
    expect(grupo(v, 'distribucion', /TERRACER/)?.grupos[0]?.formula).toBe('3303.334719 × L')
    expect(grupo(v, 'drenaje', /TERRACER/)?.grupos[0]).toMatchObject({ formula: '2000 × L', siguen: 91 })
    expect(grupo(v, 'drenaje', /ACUATICA/)?.grupos[0]?.formula).toBe('0.1 × b × L')
  })
  it('el inventario dice "Concreto" en los 179 canales y DIAG-01 trata a 24 como sin revestir: contradicción señalada', () => {
    expect(v.resultados.filter((r) => r.id.startsWith('INT-14:') && r.estado === 'no_cuadra').length).toBeGreaterThanOrEqual(24)
  })
  it('caminos: reposición de revestimiento = 150 × ancho × L', () => {
    expect(v.criterios.find((c) => c.red === 'caminos' && /Reposici/.test(c.concepto))?.grupos[0]?.formula).toBe('150 × ancho × L')
  })
})
