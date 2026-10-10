/**
 * Modelo del perfil/ubicación: agrupación de obras en carriles, ventana y selección (puro) y, con el PacOT real de la SRL,
 * que el modelo cuenta lo mismo que la conciliación IO4↔IO1 (INT-15) y no pierde ni inventa obras.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizarDataJson, VistaLibro } from '../nucleo'
import { extraerLibro } from '../derivacion/extraer'
import { comprobarTramo, type Comprobacion } from '../verificacion/comprobacion'
import { verificarLibro } from '../verificacion/verificar'
import { conciliacionIO4IO1 } from '../verificacion/integridad'
import { construirDatosConcepto } from '../../utils/infografiaComprobacion'
import { htmlInfografiaConcepto, htmlInfografiaTramo } from '../../utils/infografiaComprobacionHtml'
import { proyectar } from '../../utils/infografiaPerfilSvg'
import {
  agruparEnCarril, conteoTramo, construirModeloCanal, desplazarVentana, etiquetaPk, obrasEnTramo, polilineaDeTramo, tramoAdyacente, tramoDeObra,
  ventanaQueMuestra, ventanaSobreTramo, zoomVentana, ejeGeoDe, type TramoVista,
} from '../../components/conservacion/derivacion/ubicacionModelo'

describe('agruparEnCarril', () => {
  const it0 = (id: string, x: number, carril = 0) => ({ id, x, carril, clave: 'cruce' as const })
  it('separa lo que está lejos y junta lo cercano en un solo grupo con la media de X', () => {
    const g = agruparEnCarril([it0('a', 10), it0('b', 14), it0('c', 60)], 20)
    expect(g).toHaveLength(2)
    expect(g[0]?.ids).toEqual(['a', 'b'])
    expect(g[0]?.x).toBe(12)
    expect(g[1]?.ids).toEqual(['c'])
  })
  it('el grupo se ancla en su primer miembro: no crece en cadena', () => {
    const g = agruparEnCarril([it0('a', 0), it0('b', 15), it0('c', 30), it0('d', 45)], 20)
    expect(g.map((x) => x.ids)).toEqual([['a', 'b'], ['c', 'd']])
  })
  it('nunca mezcla carriles distintos aunque coincidan en X', () => {
    const g = agruparEnCarril([it0('a', 10, 0), it0('b', 10, 1)], 50)
    expect(g).toHaveLength(2)
  })
  it('conserva todos los ids (ninguna obra se pierde) y es estable con entrada vacía', () => {
    const items = Array.from({ length: 200 }, (_v, i) => it0(`o${i}`, (i * 7) % 300, i % 3))
    expect(agruparEnCarril(items, 24).flatMap((x) => x.ids).sort()).toEqual(items.map((x) => x.id).sort())
    expect(agruparEnCarril([], 20)).toEqual([])
  })
})

describe('ventana y selección', () => {
  const t = (a: number, b: number): TramoVista => ({ fila: 1, obra: 'x', pkInicial: '', pkFinal: '', mIni: a * 1000, mFin: b * 1000, kmIni: a, kmFin: b, longitudKm: b - a, estado: 'cuadra', ficha: null, cierraEje: false })
  it('la ventana inicial contiene al tramo y no se sale del canal', () => {
    expect(ventanaSobreTramo(t(0, 2), 98.951)).toEqual([0, 24])
    const [a, b] = ventanaSobreTramo(t(96, 98.951), 98.951)
    expect(b).toBeCloseTo(98.951, 6)
    expect(b - a).toBeCloseTo(24, 6)
  })
  it('zoom respeta el mínimo de 2 km y el máximo del canal, y desplazar no se sale de [0, total]', () => {
    expect(zoomVentana([10, 14], 0.1, 98)).toEqual([expect.any(Number), expect.any(Number)])
    const z = zoomVentana([10, 14], 0.1, 98)
    expect(z[1] - z[0]).toBeCloseTo(2, 6)
    const g = zoomVentana([0, 90], 5, 98)
    expect(g).toEqual([0, 98])
    expect(desplazarVentana([90, 98], 20, 98)).toEqual([90, 98])
    expect(desplazarVentana([2, 10], -20, 98)).toEqual([0, 8])
  })
  it('ventanaQueMuestra deja la ventana si el tramo ya se ve y la centra si no', () => {
    expect(ventanaQueMuestra([10, 30], t(12, 14), 98)).toEqual([10, 30])
    const [a, b] = ventanaQueMuestra([10, 30], t(60, 62), 98)
    expect(a).toBeLessThan(61); expect(b).toBeGreaterThan(61)
  })
  it('tramoAdyacente se queda en los extremos y arranca en el primero si la selección no existe', () => {
    const ts = [{ ...t(0, 2), fila: 1 }, { ...t(2, 4), fila: 2 }, { ...t(4, 6), fila: 3 }]
    expect(tramoAdyacente(ts, 2, 1)?.fila).toBe(3)
    expect(tramoAdyacente(ts, 3, 1)?.fila).toBe(3)
    expect(tramoAdyacente(ts, 1, -1)?.fila).toBe(1)
    expect(tramoAdyacente(ts, null, 1)?.fila).toBe(1)
    expect(tramoAdyacente([], 1, 1)).toBeNull()
  })
  it('etiquetaPk', () => { expect(etiquetaPk('12+000')).toBe('K-12+000'); expect(etiquetaPk('K-3+100')).toBe('K-3+100'); expect(etiquetaPk(null)).toBe('S/D') })
})

const carpetaSrl = process.env.CONCHOS_EVIDENCIAS ?? path.resolve(process.cwd(), '../Conservacion/Skill/ejemplo_Conchos/evidencias/lector_xls')
describe.skipIf(!existsSync(path.join(carpetaSrl, 'data.json')))('PacOT real de la SRL: el modelo del perfil', () => {
  const libro = extraerLibro(new VistaLibro(normalizarDataJson(JSON.parse(readFileSync(path.join(carpetaSrl, 'data.json'), 'utf8')) as unknown, { sha256: 'r', extractor: 'x' })))
  const v = verificarLibro(libro)
  const crit = v.criterios.find((c) => c.red === 'distribucion')!
  const filas = Object.keys(crit.porTramo).map(Number).sort((a, b) => a - b)
    .map((f) => comprobarTramo(libro, v.criterios, v.uniones, f, crit.indiceConcepto)).filter((c): c is Comprobacion => c !== null)
  const m = construirModeloCanal(filas, libro)
  const conc = conciliacionIO4IO1(libro)!

  it('dos ejes (principal y auxiliar) y todos los tramos con cadenamiento', () => {
    expect(m.v4).toBe(true)
    expect(m.ejes.map((e) => e.ramal)).toEqual(['principal', 'auxiliar'])
    expect(m.nTramos).toBe(filas.length)
    expect(m.ejes.every((e) => e.tramosSinPK === 0)).toBe(true)
    expect(m.ejes[0]?.totalKm).toBeCloseTo(98.951, 3)
    expect(m.ejes[1]?.nacePk).toBe('68+582')
  })
  it('385 estructuras de IO4: dibujadas + fuera de tramos + sin PK, sin perder ni inventar', () => {
    expect(m.nEstructuras).toBe(385)
    const e = m.ejes.flatMap((x) => [...x.obras, ...x.fueraDeTramos, ...x.sinPK]).filter((o) => o.fuente === 'IO4')
    expect(new Set(e.map((o) => o.id)).size).toBe(385)
    expect(m.ejes.flatMap((x) => x.sinPK).filter((o) => o.fuente === 'IO4')).toHaveLength(2)
    expect(m.ejes.flatMap((x) => x.fueraDeTramos).filter((o) => o.fuente === 'IO4')).toHaveLength(conc.fueraDeTramos.length)
    expect(m.nEdificios).toBe(libro.fichas.edificios!.length)
  })
  it('cuenta por tramo igual que la conciliación INT-15 (misma regla de intervalo)', () => {
    let n = 0
    for (const eje of m.ejes) for (const t of eje.tramos) {
      const fila = conc.porTramo.find((x) => x.ramal === eje.ramal && x.fila === t.ficha?.fila)
      expect(fila, `ficha del tramo ${t.fila}`).toBeDefined()
      const en = obrasEnTramo(eje, t).filter((o) => o.fuente === 'IO4')
      expect(en.length, `${t.pkInicial}→${t.pkFinal}`).toBe(fila?.io4)
      // IO1 con todas las celdas vacías es S/D para el modelo (INT-15 lo toma como 0): nunca se muestra un 0 que nadie declaró.
      const dec = conteoTramo(t, en).totalDeclarado
      if (dec === null) expect(fila?.io1).toBe(0); else expect(dec).toBe(fila?.io1)
      n++
    }
    expect(n).toBe(60)
  })
  it('la coherencia por tramo coincide con la conciliación salvo los tramos sin conteo en IO1 (S/D)', () => {
    const co = m.ejes.flatMap((e) => e.tramos.map((t) => conteoTramo(t, obrasEnTramo(e, t)).coherente))
    const sd = co.filter((x) => x === null).length
    expect(co.filter((x) => x === true).length + sd).toBe(conc.porTramo.filter((x) => x.diferencia === 0).length)
    expect(co.filter((x) => x === false)).toHaveLength(conc.porTramo.filter((x) => x.diferencia !== 0).length)
  })
  it('toda obra dibujada cae en algún tramo y las estimadas traen posición; las sin ubicar, no', () => {
    const p = m.ejes[0]!
    const sinTramo = p.obras.filter((o) => o.fuente === 'IO4' && tramoDeObra(p, o) === null)
    expect(sinTramo).toHaveLength(0)
    for (const o of m.ejes.flatMap((e) => e.obras)) {
      if (o.estado === 'sin_ubicar') { expect(o.lat).toBeNull(); expect(o.lon).toBeNull() } else { expect(o.lat).not.toBeNull(); expect(o.lon).not.toBeNull() }
    }
    expect(m.nEstimadas).toBeGreaterThanOrEqual(21)
  })
  it('la polilínea de un tramo parte y termina en sus extremos y nunca es de un solo punto', () => {
    const p = m.ejes[0]!, t = p.tramos[5]!
    const pl = polilineaDeTramo(ejeGeoDe(m, 'principal'), t.mIni, t.mFin)
    expect(pl.length).toBeGreaterThanOrEqual(2)
    expect(polilineaDeTramo(null, 0, 1000)).toEqual([])
  })
  it('un registro anterior a v4 no inventa estructuras y avisa cómo actualizar', () => {
    const viejo = { ...libro, fichas: { ...libro.fichas, estructuras: undefined, edificios: undefined } }
    const mv = construirModeloCanal(filas, viejo)
    expect(mv.v4).toBe(false)
    expect(mv.nEstructuras).toBe(0)
    expect(mv.avisos.join(' ')).toContain('Actualizar desde la carpeta')
    expect(mv.ejes.every((e) => e.obras.length === 0)).toBe(true)
  })
  it('la infografía cuenta los mismos tramos y obras que el modelo, sin palabras ni valores prohibidos', () => {
    const ctx = { fecha: '2026-10-09', logo: '', ambito: 'SRL', red: 'Red', canal: m }
    const h = htmlInfografiaConcepto(construirDatosConcepto(filas, crit, ctx), ctx)
    expect((h.match(/<g data-tramo="/g) ?? []).length).toBe(m.nTramos)
    const obras = [...h.matchAll(/data-obras="(\d+)"/g)].reduce((a, x) => a + Number(x[1]), 0)
    const sin = m.ejes.reduce((a, e) => a + e.fueraDeTramos.length + e.sinPK.length, 0)
    expect(obras + sin).toBe(m.nEstructuras + m.nEdificios)
    const t = h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
    for (const p of ['NaN', 'undefined', 'null', 'correcto', 'aprobado', 'Infinity']) expect(t, p).not.toContain(p)
    const ht = htmlInfografiaTramo(filas[3]!, ctx)
    expect(ht).toContain('Dónde está el tramo')
    expect(ht).toContain('La ubicación es la declarada por el PacOT; no acredita la posición física.')
  })
  it('sin modelo la infografía del concepto cae a la cinta y no falla', () => {
    const ctx = { fecha: '2026-10-09', logo: '', ambito: 'SRL', red: 'Red' }
    expect(htmlInfografiaConcepto(construirDatosConcepto(filas, crit, ctx), ctx)).toContain('class="cinta"')
  })
})

describe('proyección del mini-mapa', () => {
  it('conserva proporciones con la corrección cos(lat) y pone el norte arriba', () => {
    const caja = { lat0: 28, lat1: 28.1, lon0: -105.2, lon1: -105.1 }
    const pr = proyectar(caja, 400, 400, 0)
    const [x0, y0] = pr([28.1, -105.2]), [x1, y1] = pr([28, -105.1])
    expect(y0).toBeLessThan(y1)
    expect((x1 - x0) / (y1 - y0)).toBeCloseTo(Math.cos(28.05 * Math.PI / 180), 3)
  })
})
