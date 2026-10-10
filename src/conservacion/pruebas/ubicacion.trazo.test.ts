/**
 * Modelo de ubicación con contorno real y por canal (ubicacionModelo.ts): libro sintético de varios canales (ninguna estructura en dos
 * ejes, suma = total, edificios sin multiplicar), PacOT real de la SRL (cifras idénticas con y sin trazo; el subtrazo de K-56→58 sigue
 * el canal) y Módulo 5 real (CONCHOS_M05_EVIDENCIAS: ~1 715 estructuras repartidas por canal, nunca 34 300).
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizarDataJson, VistaLibro } from '../nucleo'
import { extraerLibro } from '../derivacion/extraer'
import { comprobarTramo, type Comprobacion } from '../verificacion/comprobacion'
import { verificarLibro } from '../verificacion/verificar'
import { distanciaAPolilineaM, parsearTrazoGeoJSON, simplificarDP } from '../geo/trazo'
import type { LonLat, Trazo } from '../geo/trazo'
import { miniMapaCanalSvg, miniMapaTramoSvg } from '../../utils/infografiaPerfilSvg'
import { construirDatosConcepto } from '../../utils/infografiaComprobacion'
import { htmlInfografiaConcepto, htmlInfografiaTramo } from '../../utils/infografiaComprobacionHtml'
import { construirArchivo, leerArchivoDerivacion } from '../derivacion/archivo'
import { registrar } from '../derivacion/registro'
import { construirModeloCanal, conTrazo, contornoDeTramo, cuerdaDeTramo, ejeGeoDe, ejeGeoDeVista, polilineaDeTramo } from '../../components/conservacion/derivacion/ubicacionModelo'

const trazoReal = parsearTrazoGeoJSON(JSON.parse(readFileSync(path.resolve(process.cwd(), 'public/geo/canal_conchos.geojson'), 'utf8')) as unknown) as Trazo

/* ───────────── libro sintético de varios canales ───────────── */
type Celdas = Record<string, { value: unknown; type: number }>
const put = (h: Celdas, a: string, v: unknown): void => { h[a] = { value: v, type: typeof v === 'number' ? 2 : 1 } }
const hoja = (c: Celdas, n: number) => ({ cells: c, formulas: {}, nrows: n, ncols: 40, visibility: 0, merged_cells: [], records: {} })

function libroMulticanal() {
  const io1: Array<[number, string, number, number, number]> = [[171, 'LATERAL A', 0, 6000, 2], [171, 'LATERAL A', 6000, 12000, 1], [172, 'LATERAL B', 0, 3000, 2]]
  const io4: Array<[number | null, string, number]> = [[171, 'Represa', 0], [null, 'Represa', 7000], [171, 'Represa', 11990], [172, 'Represa', 100], [null, 'Represa', 2900]]
  const c1: Celdas = {}, c4: Celdas = {}, c7: Celdas = {}
  put(c1, 'AN15', 5)
  io1.forEach(([inv, nombre, ini, fin, n], i) => { const r = 16 + i; put(c1, `A${r}`, inv); put(c1, `B${r}`, nombre); put(c1, `D${r}`, ini); put(c1, `G${r}`, fin); put(c1, `J${r}`, (fin - ini) / 1000); put(c1, `X${r}`, n); put(c1, `AN${r}`, n) })
  io4.forEach(([inv, nombre, cad], i) => { const r = 14 + i; if (inv !== null) put(c4, `A${r}`, inv); put(c4, `C${r}`, nombre); put(c4, `D${r}`, cad) })
  put(c7, 'A14', 1); put(c7, 'B14', 'Oficina'); put(c7, 'A15', 2); put(c7, 'B15', 'Bodega')
  const libro = extraerLibro(new VistaLibro(normalizarDataJson({ IO1: hoja(c1, 40), IO4: hoja(c4, 20), IO7: hoja(c7, 20) } as unknown, { sha256: 's', extractor: 'x' })))
  const filas = libro.fichas.canales.map((f, i) => ({
    fila: i + 1, obra: f.nombre, pkInicial: f.pkInicial ?? '', pkFinal: f.pkFinal ?? '', longitudKm: null, estado: 'cuadra', red: 'distribucion',
  }) as unknown as Comprobacion)
  return { libro, filas }
}

describe('libro sintético de varios canales', () => {
  const { libro, filas } = libroMulticanal()
  const m = construirModeloCanal(filas, libro)
  it('lo reconoce multicanal, un eje por canal, sin ramal auxiliar ni geometría común', () => {
    expect(m.multicanal).toBe(true)
    expect(m.geo).toBeNull()
    expect(m.ejes.map((e) => e.titulo.toLowerCase())).toEqual(['lateral a', 'lateral b'])
    expect(m.ejes.map((e) => e.inventario)).toEqual(['171', '172'])
  })
  it('ninguna estructura está en dos ejes y la suma de los ejes es el total de IO4', () => {
    const ids = m.ejes.flatMap((e) => [...e.obras, ...e.fueraDeTramos, ...e.sinPK]).filter((o) => o.fuente === 'IO4').map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(libro.fichas.estructuras!.length)
    expect(m.nEstructuras).toBe(5)
    expect(m.ejes.map((e) => [...e.obras, ...e.fueraDeTramos, ...e.sinPK].length)).toEqual([3, 2])
  })
  it('los edificios del sitio no se reparten por eje: se listan aparte, una sola vez', () => {
    expect(m.ejes.every((e) => e.obras.every((o) => o.fuente === 'IO4'))).toBe(true)
    expect(m.edificiosAparte).toHaveLength(2)
    expect(m.nEdificios).toBe(2)
  })
  it('las cifras son confiables y conTrazo no cambia un libro multicanal', () => {
    expect(m.cifrasConfiables).toBe(true)
    expect(conTrazo(m, trazoReal)).toBe(m)
  })
  it('el archivo de derivación conserva canal, canalHeredado y pkEnMetros (si no, todas las estructuras caían en cada canal)', () => {
    const ficha = { tipo: 'MODULO', numeroModulo: 5, moduloTexto: 't', srl: 'Unidad Conchos', rfcSrl: '', distrito: '005', ciclo: '2026 - 2027' } as const
    const reg = registrar(new Map(), { ficha, libro: { ...libro, ciclo: '2026 - 2027' }, archivoNombre: 'm5.xlsx' }, 't').registro
    const l = leerArchivoDerivacion(JSON.parse(JSON.stringify(construirArchivo(reg, new Map(), '2026 - 2027', 't'))))
    const est = [...l.registro.values()][0]!.libro.fichas.estructuras!
    expect(est.map((e) => e.canal)).toEqual(['171', '171', '171', '172', '172'])
    expect(est.filter((e) => e.canalHeredado === true)).toHaveLength(2)
    expect(est.every((e) => e.pkEnMetros === true)).toBe(true)
    const m2 = construirModeloCanal(filas, [...l.registro.values()][0]!.libro)
    expect(m2.multicanal).toBe(true)
    expect(m2.nEstructuras).toBe(5)
  })
  it('si el inventario no es ubicable (cifra no verificada) no se dibuja ninguna estructura', () => {
    const roto = { ...libro, fichas: { ...libro.fichas, estructuras: libro.fichas.estructuras!.map((e) => ({ ...e, pkMetros: null })) } }
    const mr = construirModeloCanal(filas, roto)
    expect(mr.cifrasConfiables).toBe(false)
    expect(mr.motivoCifras).toMatch(/sin cadenamiento/)
    expect(mr.nEstructuras).toBe(0)
  })
})

/* ───────────── SRL real ───────────── */
const carpetaSrl = process.env.CONCHOS_EVIDENCIAS ?? path.resolve(process.cwd(), '../Conservacion/Skill/ejemplo_Conchos/evidencias/lector_xls')
describe.skipIf(!existsSync(path.join(carpetaSrl, 'data.json')))('PacOT real de la SRL: contorno real en el modelo', () => {
  const libro = extraerLibro(new VistaLibro(normalizarDataJson(JSON.parse(readFileSync(path.join(carpetaSrl, 'data.json'), 'utf8')) as unknown, { sha256: 'r', extractor: 'x' })))
  const v = verificarLibro(libro)
  const crit = v.criterios.find((c) => c.red === 'distribucion')!
  const filas = Object.keys(crit.porTramo).map(Number).sort((a, b) => a - b)
    .map((f) => comprobarTramo(libro, v.criterios, v.uniones, f, crit.indiceConcepto)).filter((c): c is Comprobacion => c !== null)
  const sin = construirModeloCanal(filas, libro)
  const con = conTrazo(sin, trazoReal)

  it('las cifras de estructuras y edificios son idénticas con y sin trazo (385 y los de IO7)', () => {
    expect(sin.multicanal).toBe(false)
    expect(sin.cifrasConfiables).toBe(true)
    for (const m of [sin, con]) {
      expect(m.nEstructuras).toBe(385)
      expect(m.nEdificios).toBe(libro.fichas.edificios!.length)
      expect(m.nTramos).toBe(60)
    }
    expect(con.trazo).toBe(trazoReal)
    expect(con.origen.filas).toBe(sin.origen.filas)
    // las estructuras con coordenadas válidas no se tocan
    const validas = (m: typeof sin) => m.ejes.flatMap((e) => e.obras).filter((o) => o.estado === 'valida').map((o) => `${o.id}:${o.lat}:${o.lon}`)
    expect(validas(con)).toEqual(validas(sin))
  })
  it('el subtrazo de K-56+000 a K-58+000 sigue el trazo (≤ 30 m) y la cuerda se aparta cientos de metros', () => {
    const eje = ejeGeoDe(con, 'principal')!
    const c = contornoDeTramo(eje, 56000, 58000)
    expect(['ancla', 'interpolada']).toContain(c.calidad)
    expect(c.linea.length).toBeGreaterThan(5)
    const traz = trazoReal.puntos
    for (const [lat, lon] of c.linea) expect(distanciaAPolilineaM([lon, lat] as LonLat, traz) ?? 1e9).toBeLessThanOrEqual(30)
    // polilineaDeTramo devuelve ese mismo contorno (no la cuerda)
    expect(polilineaDeTramo(eje, 56000, 58000)).toEqual(c.linea)
    expect(cuerdaDeTramo(eje, 56000, 58000).length).toBeGreaterThanOrEqual(2)
    expect(c.resumen?.desviacionCuerdaMaxM).toBeGreaterThan(300)
  })
  it('sin trazo, la polilínea del tramo es la cuerda entre vértices con calidad «cuerda»', () => {
    const eje = ejeGeoDe(sin, 'principal')!
    const c = contornoDeTramo(eje, 56000, 58000)
    expect(c.calidad).toBe('cuerda')
    expect(c.linea).toEqual(cuerdaDeTramo(eje, 56000, 58000))
  })
  it('el auxiliar nunca recibe trazo: cuerda; el principal sí', () => {
    const aux = con.ejes.find((e) => e.ramal === 'auxiliar')!
    const g = ejeGeoDeVista(con, aux)!
    expect(g.trazo).toBeUndefined()
    const t = aux.tramos[0]!
    expect(contornoDeTramo(g, t.mIni, t.mFin).calidad).toBe('cuerda')
    expect(ejeGeoDe(con, 'principal')!.trazo).toBe(trazoReal)
  })
  it('los saltos de cadenamiento caen en K-46+000→46+500 y K-96→98+951, y la contradicción IO1/IO3 es de ~101 m', () => {
    const saltos = ejeGeoDe(con, 'principal')!.saltos!
    expect(saltos.map((s) => [s.pkIni, s.pkFin])).toEqual(expect.arrayContaining([[46000, 46500]]))
    expect(con.contradiccionFin?.diferenciaM).toBeCloseTo(101, 0)
  })
  it('infografía: mini-mapas con el trazo incrustado, ≤ 10 KB, sin JS ni fuentes web, y paridad con la pantalla', () => {
    const kb = (x: string): number => Buffer.byteLength(x, 'utf8')
    const mc = miniMapaCanalSvg(con, { ancho: 340, alto: 330 })
    expect(mc).toContain('<path d="M')
    expect(kb(mc)).toBeLessThanOrEqual(10_240)
    const principal = con.ejes[0]!
    let max = 0, nReal = 0
    for (const eje of con.ejes) for (const t of eje.tramos) {
      const r = miniMapaTramoSvg(con, eje, t, { ancho: 560, alto: 360 })
      expect(r, `tramo ${t.fila}`).not.toBeNull()
      max = Math.max(max, kb(r!.svg))
      if (r!.contorno === 'real') nReal++
      expect(r!.nObras).toBe(eje.obras.filter((o) => o.metros !== null && o.metros >= t.mIni && (t.cierraEje ? o.metros <= t.mFin : o.metros < t.mFin)).length)
    }
    expect(max).toBeLessThanOrEqual(10_240)
    expect(nReal).toBeGreaterThan(40)
    // el auxiliar nunca va como contorno real
    const aux = con.ejes.find((e) => e.ramal === 'auxiliar')!
    const ra = miniMapaTramoSvg(con, aux, aux.tramos[0]!, { ancho: 560, alto: 360 })!
    expect(ra.contorno).toBe('cuerda')
    expect(ra.insignia.texto).toContain('sin contorno real (solicitar el trazo a la SRL)')
    expect(ra.svg).toContain('stroke-dasharray')
    // el tramo de meandro K-56→58 se dibuja con contorno real
    const t56 = principal.tramos.find((t) => t.mIni >= 56000 && t.mFin <= 58000)!
    expect(miniMapaTramoSvg(con, principal, t56, { ancho: 560, alto: 360 })!.contorno).toBe('real')
    const ctx = { fecha: '2026-10-10', logo: '', ambito: 'SRL', red: 'Red', canal: con }
    const h = htmlInfografiaConcepto(construirDatosConcepto(filas, crit, ctx), ctx) + htmlInfografiaTramo(filas.find((f) => f.fila === t56.fila)!, ctx)
    expect(h).not.toMatch(/<script|<use|@import|fonts\.googleapis|url\(http/i)
    expect(h).toContain('Contorno real')
    const obras = [...h.matchAll(/data-obras="(\d+)"/g)].reduce((a, x) => a + Number(x[1]), 0)
    expect(obras).toBeGreaterThan(0)
  })
  it('el trazo simplificado a 50 m cabe en un SVG pequeño (~145 puntos)', () => {
    const dp = simplificarDP(trazoReal.puntos, 50)
    expect(dp.length).toBeGreaterThan(100)
    expect(dp.length).toBeLessThan(200)
  })
})

/* ───────────── Módulo 5 real ───────────── */
const carpetaM05 = process.env.CONCHOS_M05_EVIDENCIAS ?? ''
const hayM05 = carpetaM05 !== '' && existsSync(path.join(carpetaM05, 'data.json'))
describe.skipIf(!hayM05)('Módulo 5 real: estructuras repartidas por canal', () => {
  const m = (() => {
    if (!hayM05) return null as never
    const libro = extraerLibro(new VistaLibro(normalizarDataJson(JSON.parse(readFileSync(path.join(carpetaM05, 'data.json'), 'utf8')) as unknown, { sha256: 'm5', extractor: 'x' })))
    const v = verificarLibro(libro)
    const crit = v.criterios.find((c) => c.red === 'distribucion' && Object.keys(c.porTramo).length > 0)!
    const filas = Object.keys(crit.porTramo).map(Number).sort((a, b) => a - b)
      .map((f) => comprobarTramo(libro, v.criterios, v.uniones, f, crit.indiceConcepto)).filter((c): c is Comprobacion => c !== null)
    return construirModeloCanal(filas, libro)
  })()
  it('multicanal: nunca 34 300; las estructuras de los ejes no se repiten y no superan 1 715', () => {
    expect(m.multicanal).toBe(true)
    const ids = m.ejes.flatMap((e) => [...e.obras, ...e.fueraDeTramos, ...e.sinPK]).filter((o) => o.fuente === 'IO4').map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(m.nEstructuras).toBe(ids.length)
    expect(m.nEstructuras).toBeLessThanOrEqual(1715)
    expect(m.nEstructuras).toBeGreaterThan(0)
    expect(m.nEstructuras).not.toBe(34300)
    expect(m.nEdificios).toBeLessThanOrEqual(6)
    expect(m.ejes.length).toBeGreaterThan(5)
    expect(m.cifrasConfiables).toBe(true)
  })
})
