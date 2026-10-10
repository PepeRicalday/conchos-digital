/**
 * Libros de VARIOS canales (módulos): cada canal con su cadenamiento desde 0, inventario de canal en la columna A de IO4.
 * Sintético (siempre) y Módulo 5 real (CONCHOS_M05_EVIDENCIAS). Causa de las cifras absurdas de M5 (34 300 = 1 715 × 20): la interfaz daba
 * TODAS las estructuras del ramal «principal» a cada canal; el núcleo ahora identifica el canal de cada estructura.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizarDataJson, VistaLibro } from '../nucleo'
import { extraerLibro } from '../derivacion/extraer'
import { claveCanal, confiabilidadEstructuras, estructurasDeCanal, leerEstructurasIO4 } from '../derivacion/estructuras'
import { conciliacionIO4IO1 } from '../verificacion/integridad'

type Fila = [inv: string | number | null, nombre: string, cad: string | number]
function sintetico(io1: Array<[string | number, string, number, number, number]>, io4: Fila[]): VistaLibro {
  const cells: Record<string, { value: unknown; type: number }> = {}
  const put = (h: Record<string, { value: unknown; type: number }>, a: string, v: unknown) => { h[a] = { value: v, type: typeof v === 'number' ? 2 : 1 } }
  const c1: typeof cells = {}, c4: typeof cells = {}
  put(c1, 'AN15', io4.length)
  io1.forEach(([inv, nombre, ini, fin, nEst], i) => {
    const r = 16 + i
    put(c1, `A${r}`, inv); put(c1, `B${r}`, nombre); put(c1, `D${r}`, ini); put(c1, `G${r}`, fin); put(c1, `J${r}`, (fin - ini) / 1000); put(c1, `X${r}`, nEst); put(c1, `AN${r}`, nEst)
  })
  io4.forEach(([inv, nombre, cad], i) => {
    const r = 14 + i
    if (inv !== null) put(c4, `A${r}`, inv)
    put(c4, `C${r}`, nombre); put(c4, `D${r}`, cad)
  })
  void cells
  const hoja = (c: typeof cells, n: number) => ({ cells: c, formulas: {}, nrows: n, ncols: 40, visibility: 0, merged_cells: [], records: {} })
  return new VistaLibro(normalizarDataJson({ IO1: hoja(c1, 40), IO4: hoja(c4, 14 + io4.length + 2) } as unknown, { sha256: 's', extractor: 'x' }))
}

// Dos canales de 12 km y 3 km; cada uno reinicia en 0 (el de 12 km termina MÁS de 10 km después del inicio del siguiente: antes era «auxiliar»).
const IO1: Array<[string | number, string, number, number, number]> = [[171, 'LATERAL A', 0, 6000, 2], [171, 'LATERAL A', 6000, 12000, 1], [172, 'LATERAL B', 0, 3000, 2]]
const IO4: Fila[] = [
  [171, 'Represa', 0], [null, 'Represa', 7000], [171, 'Represa', 11990], // PK 0 cae en el tramo 1; 7000 y 11990 en el tramo 2
  [172, 'Represa', 100], [null, 'Represa', 2900],
]

describe('libro sintético de varios canales', () => {
  const vista = sintetico(IO1, IO4)
  const lec = leerEstructurasIO4(vista)
  it('lo reconoce como multicanal: sin ramal auxiliar, canal por estructura, PK en metros', () => {
    expect(lec.multicanal).toBe(true)
    expect(lec.estructuras).toHaveLength(5)
    expect(lec.estructuras.every((e) => e.ramal === 'principal')).toBe(true)
    expect(lec.estructuras.map((e) => e.canal)).toEqual(['171', '171', '171', '172', '172'])
    expect(lec.estructuras[1]).toMatchObject({ canalHeredado: true, pk: '7+000', pkMetros: 7000, pkEnMetros: true })
    expect(estructurasDeCanal(lec.estructuras, '172.0')).toHaveLength(2)
  })
  it('claveCanal normaliza comillas, .0 y mayúsculas', () => {
    expect(claveCanal("'183-a'")).toBe('183-A')
    expect(claveCanal('171.0')).toBe('171')
    expect(claveCanal(171)).toBe('171')
    expect(claveCanal(null)).toBe('')
  })
  it('INT-15 concilia por canal: cada estructura solo cuenta en los tramos de su canal', () => {
    const l = extraerLibro(vista)
    const c = conciliacionIO4IO1(l)!
    expect(c.multicanal).toBe(true)
    expect(c.porTramo.map((t) => [t.canal, t.io4, t.io1])).toEqual([['LATERAL A', 1, 2], ['LATERAL A', 2, 1], ['LATERAL B', 2, 2]])
    expect(c.sinPK).toHaveLength(0)
  })
  it('confiabilidad: el inventario real es confiable; la cifra multiplicada por la interfaz (×20) no', () => {
    const l = extraerLibro(vista)
    expect(confiabilidadEstructuras(l).estructuras).toBe(5)
    const mal = confiabilidadEstructuras(l, { estructuras: 100 })
    expect(mal.confiable).toBe(false)
    expect(mal.motivo).toMatch(/×20 exacto/)
  })
})

describe('un solo eje (SRL) no cambia', () => {
  it('un libro sin inventarios repetidos de IO1 no es multicanal', () => {
    const l = leerEstructurasIO4(sintetico([[1, 'C', 0, 5000, 1]], [[1, 'Represa', 'K-0+100'], [2, 'Represa', 'K-1+000']]))
    expect(l.multicanal).toBe(false)
    expect(l.estructuras.every((e) => e.canal === undefined)).toBe(true)
  })
})

const carpetaM05 = process.env.CONCHOS_M05_EVIDENCIAS ?? ''
const hayM05 = carpetaM05 !== '' && existsSync(path.join(carpetaM05, 'data.json'))
describe.skipIf(!hayM05)('Módulo 5 real · 179 tramos de canales concatenados', () => {
  const l = hayM05 ? extraerLibro(new VistaLibro(normalizarDataJson(JSON.parse(readFileSync(path.join(carpetaM05, 'data.json'), 'utf8')) as unknown, { sha256: 'm5', extractor: 'x' }))) : (null as never)
  const E = l?.fichas.estructuras ?? []
  it('IO4 tiene 1 715 estructuras (no 34 300) con cadenamiento utilizable y canal', () => {
    expect(E).toHaveLength(1715)
    expect(E.filter((e) => e.pkMetros === null)).toHaveLength(0)
    expect(E.every((e) => e.ramal === 'principal' && (e.canal ?? '') !== '')).toBe(true)
    expect(l.fichas.edificios).toHaveLength(6)
  })
  it('INT-15 por canal: total IO4 = IO1 = 1 715 y las estructuras no se repiten entre canales', () => {
    const c = conciliacionIO4IO1(l)!
    expect(c.multicanal).toBe(true)
    expect(c.totalIO4).toBe(1715)
    expect(c.totalIO1Declarado).toBe(1715)
    const sumaTramos = c.porTramo.reduce((s, t) => s + t.io4, 0)
    expect(sumaTramos + c.sinPK.length + c.fueraDeTramos.length).toBe(1715)
  })
  it('es confiable con sus cifras reales y no con las ×20 que mostraba la interfaz', () => {
    expect(confiabilidadEstructuras(l, { estructuras: 1715, edificios: 6 })).toMatchObject({ confiable: true, ubicable: true })
    const mal = confiabilidadEstructuras(l, { estructuras: 34300, edificios: 120 })
    expect(mal.confiable).toBe(false)
    expect(mal.motivos).toHaveLength(2)
  })
})
