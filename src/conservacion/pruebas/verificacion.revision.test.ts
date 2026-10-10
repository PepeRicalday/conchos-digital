/**
 * Centro de revisión: atípicos agrupados por tramo. Casos reales de la SRL (solo lectura) y pruebas puras de orden y filtros.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizarDataJson, VistaLibro } from '../nucleo'
import { extraerLibro } from '../derivacion/extraer'
import type { LibroDerivado } from '../derivacion/tipos'
import { comprobarTramo } from '../verificacion/comprobacion'
import { verificarLibroCacheado } from '../verificacion/verificar'
import { atipicosDelLibro, conciliacionesSinTramo, contarRazones, destinoDeConcepto, destinoDeFila, destinoDeResultado, estadoConRazon, filtrarAtipicos, opcionesDeFiltro, ordenarAtipicos, resolverReferencia, type AtipicoTramo, type RazonTramo } from '../verificacion/revision'

const carpetaSrl = process.env.CONCHOS_EVIDENCIAS ?? path.resolve(process.cwd(), '../Conservacion/Skill/ejemplo_Conchos/evidencias/lector_xls')
const cargar = (dir: string): LibroDerivado => extraerLibro(new VistaLibro(normalizarDataJson(JSON.parse(readFileSync(path.join(dir, 'data.json'), 'utf8')) as unknown, { sha256: 'r', extractor: 'x' })))

const razon = (r: Partial<RazonTramo>): RazonTramo => ({
  razon: 'criterio', indiceConcepto: 1, rotuloConcepto: 'DESAZOLVE', concepto: 'Desazolve', titulo: 't', enLibro: '1', referencia: '2', etiquetas: ['a', 'b'], unidad: 'm³', relativa: 0.1, absoluta: 1, id: 'x', ...r,
})
const tramo = (fila: number, razones: RazonTramo[], ambito = 'SRL'): AtipicoTramo => ({
  clave: `${ambito}|distribucion|${fila}`, ambito, red: 'distribucion', fila, inventario: 'x', obra: 'o', pkInicial: 'K-0+000', pkFinal: 'K-1+000', razones,
  destino: { ambito, red: 'distribucion', indiceConcepto: 1, fila },
  relativaMax: Math.max(-1, ...razones.map((r) => r.relativa ?? -1)), absolutaMax: Math.max(-1, ...razones.map((r) => r.absoluta ?? -1)),
})

describe('orden, filtros y conteos (puros)', () => {
  const a = tramo(10, [razon({ relativa: 0.2 })])
  const b = tramo(11, [razon({ relativa: 0.9, absoluta: 5 })])
  const c = tramo(12, [razon({ relativa: 0.05 }), razon({ razon: 'control_adicional', concepto: 'Terracerías (descopete)', indiceConcepto: 2, relativa: 0.01 })])
  const d = tramo(13, [razon({ relativa: 0.9, absoluta: 50 })])
  it('más razones primero; luego diferencia relativa; luego absoluta; estable por fila', () => {
    expect(ordenarAtipicos([a, b, c, d]).map((t) => t.fila)).toEqual([12, 13, 11, 10])
  })
  it('filtra por razón conservando solo las razones que cumplen y sin duplicar el tramo', () => {
    const r = filtrarAtipicos([a, b, c, d], { razon: 'control_adicional' })
    expect(r.map((t) => t.fila)).toEqual([12])
    expect(r[0]?.razones).toHaveLength(1)
    expect(r[0]?.destino?.indiceConcepto).toBe(2)
  })
  it('filtra por concepto canónico, PacOT y red', () => {
    expect(filtrarAtipicos([a, b, c, d], { concepto: 'Desazolve' }).map((t) => t.fila)).toEqual([13, 11, 10, 12])
    expect(filtrarAtipicos([a, tramo(1, [razon({})], 'M5')], { ambito: 'M5' })).toHaveLength(1)
    expect(filtrarAtipicos([a], { red: 'caminos' })).toHaveLength(0)
  })
  it('cuenta razones y ofrece las opciones de filtro', () => {
    expect(contarRazones([a, c])).toBe(3)
    const o = opcionesDeFiltro([a, c])
    expect(o.razones.sort()).toEqual(['control_adicional', 'criterio'])
    expect(o.conceptos).toEqual(['Desazolve', 'Terracerías (descopete)'])
  })
})

describe.skipIf(!existsSync(path.join(carpetaSrl, 'data.json')))('SRL Unidad Conchos · centro de revisión', () => {
  const l = cargar(carpetaSrl)
  const lista = atipicosDelLibro(l, 'SRL')
  it('el tramo de la fila 55 aparece UNA vez con dos razones: desazolve por criterio y descopete por control adicional', () => {
    const t = lista.filter((x) => x.fila === 55)
    expect(t).toHaveLength(1)
    const rs = t[0]!.razones
    expect(rs.map((r) => r.razon).sort()).toEqual(['control_adicional', 'criterio'])
    const crit = rs.find((r) => r.razon === 'criterio')!
    const ctrl = rs.find((r) => r.razon === 'control_adicional')!
    expect(crit.concepto).toBe('Desazolve')
    expect(crit).toMatchObject({ enLibro: '1558.4', referencia: '2124.8' })
    expect(ctrl.concepto).toBe('Terracerías (descopete)')
    expect(ctrl).toMatchObject({ enLibro: '5760', referencia: '1558.4' })
    expect(t[0]!.razones[0]!.razon).toBe('criterio')
    expect(t[0]!.destino).toMatchObject({ ambito: 'SRL', red: 'distribucion', fila: 55 })
  })
  it('21 controles de descopete + 9 de criterio (13 antes de T-01: 4 eran los falsos atípicos de los caminos de la SRL), repartidos en menos tramos que razones (los traslapes se agrupan)', () => {
    expect(lista.flatMap((t) => t.razones).filter((r) => r.razon === 'control_adicional')).toHaveLength(21)
    expect(lista.flatMap((t) => t.razones).filter((r) => r.razon === 'criterio')).toHaveLength(9)
    expect(lista.length).toBeLessThan(contarRazones(lista))
    expect(new Set(lista.map((t) => t.clave)).size).toBe(lista.length)
  })
  it('los tramos con dos razones van primero y el orden no depende de la entrada', () => {
    const n2 = lista.filter((t) => t.razones.length >= 2).length
    expect(n2).toBeGreaterThan(0)
    expect(lista.slice(0, n2).every((t) => t.razones.length >= 2)).toBe(true)
    expect(ordenarAtipicos([...lista].reverse()).map((t) => t.clave)).toEqual(lista.map((t) => t.clave))
  })
  it('estadoConRazon separa criterio y control: fila 55 descopete sigue el criterio pero un control lo marca; desazolve se aparta del criterio', () => {
    const v = verificarLibroCacheado(l)
    const idx = (re: RegExp) => v.criterios.find((c) => c.red === 'distribucion' && re.test(c.concepto))!.indiceConcepto
    const desc = estadoConRazon(comprobarTramo(l, v.criterios, v.uniones, 55, idx(/DESCOPETE/))!)
    expect(desc).toMatchObject({ criterio: 'cuadra', controles: 'atipico', texto: 'atípico por control adicional' })
    expect(desc.lineaControl).toContain('5760 m³ contra 1558.4 m³')
    const des = estadoConRazon(comprobarTramo(l, v.criterios, v.uniones, 55, idx(/DESAZOLVE/))!)
    expect(des).toMatchObject({ criterio: 'atipico', controles: 'ninguno', texto: 'atípico por criterio', lineaControl: null })
    const ok = estadoConRazon(comprobarTramo(l, v.criterios, v.uniones, 17, idx(/DESCOPETE/))!)
    expect(ok).toMatchObject({ criterio: 'cuadra', controles: 'coherente', texto: 'coherente con el criterio del libro' })
  })
  it('destinoDeResultado y destinoDeConcepto llevan al tramo y concepto correctos; las conciliaciones por tipo no tienen tramo', () => {
    const v = verificarLibroCacheado(l)
    const r = v.resultados.find((x) => x.id.startsWith('CRI-02:') && x.tramoFila === 76)!
    const d = destinoDeResultado(l, 'SRL', r)!
    expect(d).toMatchObject({ ambito: 'SRL', red: 'distribucion', fila: 76 })
    expect(v.criterios.find((c) => c.indiceConcepto === d.indiceConcepto && c.red === 'distribucion')?.concepto).toBe('DESAZOLVE')
    const dc = destinoDeConcepto(l, 'SRL', 'distribucion', d.indiceConcepto)!
    expect(dc.indiceConcepto).toBe(d.indiceConcepto)
    expect(lista.find((t) => t.fila === dc.fila)?.razones.some((x) => x.indiceConcepto === d.indiceConcepto)).toBe(true)
    expect(destinoDeConcepto(l, 'SRL', 'distribucion', 999)).toBeNull()
    expect(conciliacionesSinTramo(l)).toBe(35)
  })
  it('resolverReferencia: DIAG-01 y la ficha de IO1 abren un tramo; 3DN abre el concepto; lo demás, nada', () => {
    expect(resolverReferencia(l, 'SRL', 'DIAG-01', 55)).toMatchObject({ tipo: 'tramo', destino: { fila: 55, ambito: 'SRL' } })
    const ficha = l.fichas.canales[0]!
    const io1 = resolverReferencia(l, 'SRL', 'IO1', ficha.fila)
    expect(io1?.tipo).toBe('tramo')
    if (io1?.tipo === 'tramo') {
      const u = verificarLibroCacheado(l).uniones.uniones.find((x) => x.tramo.fila === io1.destino.fila)
      expect(u?.ficha?.fila).toBe(ficha.fila)
    }
    const n = l.necesidades[0]!
    expect(resolverReferencia(l, 'SRL', '3DN', n.fila)).toEqual({ tipo: 'concepto', bloque: n.bloque, concepto: n.concepto })
    expect(resolverReferencia(l, 'SRL', 'IO1', 999999)).toBeNull()
    expect(resolverReferencia(l, 'SRL', '3DN', 999999)).toBeNull()
    expect(resolverReferencia(l, 'SRL', 'IO9', 1)).toBeNull()
  })
  it('destinoDeFila lleva al concepto en el que el tramo es atípico y devuelve null para una fila inexistente', () => {
    expect(destinoDeFila(l, 'SRL', 76)).toMatchObject({ fila: 76, red: 'distribucion' })
    expect(destinoDeFila(l, 'SRL', 999999)).toBeNull()
  })
})

const carpetaM5 = process.env.CONCHOS_M05_EVIDENCIAS
describe.skipIf(!carpetaM5 || !existsSync(path.join(carpetaM5, 'data.json')))('Módulo 5 · centro de revisión', () => {
  it('cada atípico tiene tramo en el libro y claves únicas', () => {
    const l = cargar(carpetaM5!)
    const lista = atipicosDelLibro(l, 'M5')
    expect(new Set(lista.map((t) => t.clave)).size).toBe(lista.length)
    for (const t of lista) expect(l.tramos.some((x) => x.fila === t.fila)).toBe(true)
  })
})
