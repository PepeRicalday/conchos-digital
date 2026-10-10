/**
 * Geometría del canal: eje de vértices reales de IO1, interpolación por cadenamiento, calidad geométrica y layout del perfil.
 */
import { describe, expect, it } from 'vitest'
import { calidadGeometrica, desviacionEstructuras } from '../geo/calidad'
import { construirEjes, distanciaKm, kmALatLng, metrosAPk, pkAMetros } from '../geo/kmALatLng'
import type { EjeCanal } from '../geo/kmALatLng'
import { calcularPerfil, etiquetaKm, niceTicks, ventanaCentrada } from '../geo/perfilSvg'
import { hayEvidencias, libroSrl } from './ayuda/libroSrl'

/** Distancia en metros de un punto a un segmento, en plano local (válida a escala de km). */
function distanciaASegmentoM(p: { lon: number; lat: number }, a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const kx = 111_195 * Math.cos((p.lat * Math.PI) / 180), ky = 111_195
  const ax = (a.lon - p.lon) * kx, ay = (a.lat - p.lat) * ky, bx = (b.lon - p.lon) * kx, by = (b.lat - p.lat) * ky
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
  return Math.hypot(ax + t * dx, ay + t * dy)
}

describe('pkAMetros / metrosAPk', () => {
  it('98+951 = 98 951 m y de vuelta', () => {
    expect(pkAMetros('98+951')).toBe(98951)
    expect(pkAMetros('0+000')).toBe(0)
    expect(metrosAPk(98951)).toBe('98+951')
    expect(metrosAPk(5)).toBe('0+005')
    expect(pkAMetros(null)).toBeNull()
    expect(pkAMetros('xx')).toBeNull()
  })
})

describe('kmALatLng · eje sintético hecho a mano', () => {
  // Dos vértices a 0 y 2000 m: (−105.0, 27.0) y (−104.98, 27.02). El punto a 500 m está a 1/4 del camino.
  const eje: EjeCanal = { ramal: 'principal', vertices: [
    { metros: 0, lon: -105.0, lat: 27.0, origen: 'declarado' },
    { metros: 2000, lon: -104.98, lat: 27.02, origen: 'declarado' },
  ] }
  it('exacto en un vértice (estimada: false)', () => {
    expect(kmALatLng(2000, eje)).toEqual({ lon: -104.98, lat: 27.02, estimada: false })
    expect(kmALatLng('0+000', eje)).toEqual({ lon: -105.0, lat: 27.0, estimada: false })
  })
  it('interpolación lineal: a 500 m (1/4) → lon −105 + 0.25 × 0.02 = −104.995, lat 27 + 0.25 × 0.02 = 27.005 (estimada)', () => {
    const p = kmALatLng(500, eje)
    expect(p?.lon).toBeCloseTo(-104.995, 9)
    expect(p?.lat).toBeCloseTo(27.005, 9)
    expect(p?.estimada).toBe(true)
  })
  it('fuera del rango de vértices no se extrapola: null', () => {
    expect(kmALatLng(-1, eje)).toBeNull()
    expect(kmALatLng(2001, eje)).toBeNull()
    expect(kmALatLng(100, { ramal: 'principal', vertices: [] })).toBeNull()
    expect(kmALatLng('basura', eje)).toBeNull()
  })
  it('un vértice «ancla» nunca es exacto', () => {
    const e: EjeCanal = { ramal: 'auxiliar', vertices: [{ metros: 0, lon: -105, lat: 27, origen: 'ancla' }, { metros: 1000, lon: -105, lat: 27.01, origen: 'declarado' }] }
    expect(kmALatLng(0, e)?.estimada).toBe(true)
    expect(kmALatLng(1000, e)?.estimada).toBe(false)
  })
})

describe.skipIf(!hayEvidencias)('SRL Unidad Conchos · eje del canal, anclaje del auxiliar y calidad', () => {
  const { libro: l } = hayEvidencias ? libroSrl() : ({} as ReturnType<typeof libroSrl>)
  const ejes = hayEvidencias ? construirEjes(l.fichas.canales, pkAMetros(l.fichas.anclaAuxiliar)) : (null as never)

  it('vértices reales: 56 del principal (59 PK distintos menos los 3 sin latitud) y 3 del auxiliar (2 declarados + el ancla)', () => {
    // 58 tramos → 59 extremos distintos (0+000 … 98+951); 3 de ellos (20+000, 60+000, 72+000) no traen latitud.
    expect(ejes.principal.vertices).toHaveLength(56)
    expect(ejes.principal.vertices[0]).toMatchObject({ metros: 0, origen: 'declarado' })
    expect(ejes.principal.vertices.at(-1)).toMatchObject({ metros: 98951 })
    expect(ejes.auxiliar?.vertices.map((v) => [v.metros, v.origen])).toEqual([[0, 'ancla'], [1370, 'declarado'], [2280, 'declarado']])
    expect(ejes.conflictos).toEqual([])
  })

  it('exacto en un vértice: K-2+000 devuelve las coordenadas de IO1 (105°12\'7.82"O, 27°41\'0.31"N) sin estimar', () => {
    const p = kmALatLng('2+000', ejes.principal)
    // −(105 + 12/60 + 7.82/3600) = −105.202172 ; 27 + 41/60 + 0.31/3600 = 27.683419
    expect(p?.lon).toBeCloseTo(-105.202172, 6)
    expect(p?.lat).toBeCloseTo(27.683419, 6)
    expect(p?.estimada).toBe(false)
  })

  it('a mitad de tramo (K-1+000, entre K-0+000 y K-2+000) el punto cae a menos de 1 m de la cuerda', () => {
    const a = kmALatLng(0, ejes.principal)!, b = kmALatLng(2000, ejes.principal)!
    const m = kmALatLng(1000, ejes.principal)!
    expect(m.estimada).toBe(true)
    expect(distanciaASegmentoM(m, a, b)).toBeLessThan(1)
    // y es el punto medio: lon/lat = promedio de los extremos
    expect(m.lon).toBeCloseTo((a.lon + b.lon) / 2, 9)
    expect(m.lat).toBeCloseTo((a.lat + b.lat) / 2, 9)
    // En la cuerda, la mitad del PK es la mitad de la distancia: |m−a| = |b−a| / 2
    expect(distanciaKm(m.lat, m.lon, a.lat, a.lon)).toBeCloseTo(distanciaKm(b.lat, b.lon, a.lat, a.lon) / 2, 3)
  })

  it('fuera del rango: antes de 0+000, después de 98+951 y el auxiliar más allá de 2+280 no tienen posición', () => {
    expect(kmALatLng(-10, ejes.principal)).toBeNull()
    expect(kmALatLng(98952, ejes.principal)).toBeNull()
    expect(kmALatLng(99740, ejes.principal)).toBeNull()
    expect(kmALatLng(2286, ejes.auxiliar as EjeCanal)).toBeNull()
    expect(kmALatLng('98+951', ejes.principal)?.estimada).toBe(false)
  })

  it('los 4 puntos de IO1 sin latitud (20+000, 60+000, 72+000 y el 0+000 del auxiliar) se ubican como estimada: true y nunca como exactos', () => {
    expect(ejes.sinCoordenadas.map((p) => `${p.ramal}:${p.pk}`)).toEqual(['principal:20+000', 'principal:60+000', 'principal:72+000', 'auxiliar:0+000'])
    for (const p of ejes.sinCoordenadas) {
      const eje = p.ramal === 'principal' ? ejes.principal : (ejes.auxiliar as EjeCanal)
      const pos = kmALatLng(p.metros, eje)
      expect(pos, p.pk).not.toBeNull()
      expect(pos?.estimada, p.pk).toBe(true)
    }
  })

  it('K-20+000 queda entre sus vecinos reales K-18+000 y K-22+000, sobre su cuerda (sin latitud inventada)', () => {
    const a = kmALatLng(18000, ejes.principal)!, b = kmALatLng(22000, ejes.principal)!, m = kmALatLng(20000, ejes.principal)!
    expect(a.estimada).toBe(false)
    expect(b.estimada).toBe(false)
    expect(distanciaASegmentoM(m, a, b)).toBeLessThan(1)
    expect(m.lat).toBeGreaterThan(a.lat)
    expect(m.lat).toBeLessThan(b.lat)
  })

  it('el auxiliar nace en K-68+582 del principal: su ancla es exactamente la posición del principal en ese PK', () => {
    expect(ejes.anclaMetros).toBe(68582)
    const principal = kmALatLng(68582, ejes.principal)!
    expect(ejes.auxiliar?.vertices[0]).toMatchObject({ metros: 0, origen: 'ancla', lon: principal.lon, lat: principal.lat })
    // Y los PK del auxiliar no se mezclan con los del principal: 1+370 del auxiliar es otro punto que 1+370 del principal.
    const auxPos = kmALatLng(1370, ejes.auxiliar as EjeCanal)!
    const prinPos = kmALatLng(1370, ejes.principal)!
    expect(distanciaKm(auxPos.lat, auxPos.lon, prinPos.lat, prinPos.lon)).toBeGreaterThan(20)
    // El tramo ancla → 1+370 mide ~1.4 km en línea recta: coherente con 1.37 km de cadenamiento.
    expect(distanciaKm(principal.lat, principal.lon, auxPos.lat, auxPos.lon)).toBeGreaterThan(1.2)
    expect(distanciaKm(principal.lat, principal.lon, auxPos.lat, auxPos.lon)).toBeLessThan(1.5)
  })

  it('calidad: Δ geodésica contra Δ cadenamiento. Tramo fila 16: 0.7499 km este-oeste y 1.7273 km norte-sur → 1.883 km contra 2.000 (razón 0.941)', () => {
    const q = calidadGeometrica(l.fichas.canales)
    const t16 = q.tramos.find((t) => t.fila === 16)
    // Δlon = 0.00762° × 111.195 km × cos(27.676°) = 0.7500 ; Δlat = 0.015533° × 111.195 = 1.7272 ; √(0.7500² + 1.7272²) = 1.8830
    expect(t16?.kmCadenamiento).toBe(2)
    expect(t16?.kmGeodesico).toBeCloseTo(1.883, 2)
    expect(t16?.razon).toBeCloseTo(0.9415, 2)
    expect(t16?.motivo).toBeNull()
  })

  it('calidad: 53 tramos comparables (7 omitidos por tener un extremo sin latitud), error máx. ≈ 809 m, mediana ≈ 83 m', () => {
    const q = calidadGeometrica(l.fichas.canales)
    expect(q.tramos).toHaveLength(53)
    expect(q.omitidos.map((o) => o.fila)).toEqual([26, 27, 49, 50, 58, 59, 74])
    expect(q.maxAbsM).toBeGreaterThan(800)
    expect(q.maxAbsM).toBeLessThan(820)
    expect(q.medianaAbsM).toBeGreaterThan(80)
    expect(q.medianaAbsM).toBeLessThan(86)
    expect(q.medianaRazon).toBeGreaterThan(0.95)
    expect(q.medianaRazon).toBeLessThan(0.96)
    expect(q.minRazon).toBeGreaterThan(0.59)
  })

  it('calidad: 2 tramos con razón > 1 (imposible para una cuerda): K-46+000→46+500 (1.43) y el último del auxiliar (1.01)', () => {
    const q = calidadGeometrica(l.fichas.canales)
    expect(q.atipicos.map((t) => [t.fila, t.motivo])).toEqual([[41, 'razon_mayor_que_1'], [75, 'razon_mayor_que_1']])
    expect(q.maxRazon).toBeGreaterThan(1.4)
    expect(q.maxRazon).toBeLessThan(1.45)
  })

  it('estructuras con coordenadas y PK válidos caen cerca del eje: mediana ~220 m, máximo ~1 km (la cuerda no sigue las curvas)', () => {
    const d = desviacionEstructuras(l.fichas.estructuras ?? [], ejes)
    expect(d.filas.length).toBeGreaterThan(340)
    expect(d.medianaM).toBeGreaterThan(150)
    expect(d.medianaM).toBeLessThan(300)
    expect(d.maxM).toBeLessThan(1100)
  })
})

describe('perfilSvg · layout puro', () => {
  it('niceTicks: valores 1-2-5 × 10ⁿ dentro del rango', () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10])
    expect(niceTicks(0, 98.951, 6)).toEqual([0, 20, 40, 60, 80])
    expect(niceTicks(12.3, 13.1, 4)).toEqual([12.4, 12.6, 12.8, 13])
    expect(niceTicks(5, 5, 4)).toEqual([])
    expect(niceTicks(0, 10, 0)).toEqual([])
  })
  it('etiquetaKm: 12.5 → K-12+500 ; 0.005 → K-0+005', () => {
    expect(etiquetaKm(12.5)).toBe('K-12+500')
    expect(etiquetaKm(0.005)).toBe('K-0+005')
    expect(etiquetaKm(98.951)).toBe('K-98+951')
  })
  it('calcularPerfil: ancho 1000 px y ventana 10-20 km → 100 px/km ; la banda 9-12 se recorta a la izquierda y la estructura en 15 km cae en x = 500', () => {
    const p = calcularPerfil({
      ancho: 1000, ventana: [10, 20],
      tramos: [{ id: 'a', kmIni: 9, kmFin: 12 }, { id: 'b', kmIni: 12, kmFin: 25 }, { id: 'c', kmIni: 30, kmFin: 31 }],
      estructuras: [{ id: 's1', km: 15, familia: 'cruce' }, { id: 's2', km: 9.9, familia: 'control' }, { id: 's3', km: 20, familia: null }],
    })
    expect(p.valido).toBe(true)
    expect(p.pxPorKm).toBe(100)
    expect(p.tramos.map((t) => [t.id, t.x0, t.x1, t.recortadoIzq, t.recortadoDer])).toEqual([['a', 0, 200, true, false], ['b', 200, 1000, false, true]])
    expect(p.tramosFuera).toBe(1)
    expect(p.estructuras.map((s) => [s.id, s.x, s.carril])).toEqual([['s1', 500, 2], ['s3', 1000, -1]])
    expect(p.estructurasFuera).toBe(1)
    expect(p.ticks.map((t) => [t.km, t.x, t.etiqueta])).toEqual([[10, 0, 'K-10+000'], [12, 200, 'K-12+000'], [14, 400, 'K-14+000'], [16, 600, 'K-16+000'], [18, 800, 'K-18+000'], [20, 1000, 'K-20+000']])
    expect(p.xDeKm(12.5)).toBe(250)
    expect(p.kmDeX(250)).toBe(12.5)
  })
  it('los márgenes reducen la zona de dibujo', () => {
    const p = calcularPerfil({ ancho: 1000, ventana: [0, 10], margenIzq: 50, margenDer: 50, tramos: [], estructuras: [] })
    expect(p.x0).toBe(50)
    expect(p.x1).toBe(950)
    expect(p.pxPorKm).toBe(90)
    expect(p.xDeKm(5)).toBe(500)
  })
  it('ventana o ancho inválidos → perfil no válido, sin geometrías y con todo «fuera»', () => {
    const p = calcularPerfil({ ancho: 1000, ventana: [10, 10], tramos: [{ id: 'a', kmIni: 0, kmFin: 1 }], estructuras: [{ id: 's', km: 1, familia: null }] })
    expect(p.valido).toBe(false)
    expect(p.tramos).toEqual([])
    expect(p.tramosFuera).toBe(1)
    expect(p.estructurasFuera).toBe(1)
    expect(calcularPerfil({ ancho: 0, ventana: [0, 10], tramos: [], estructuras: [] }).valido).toBe(false)
  })
  it('ventanaCentrada no se sale del canal', () => {
    expect(ventanaCentrada(1, 10, 98.951)).toEqual([0, 10])
    expect(ventanaCentrada(98, 10, 98.951)[1]).toBeCloseTo(98.951, 9)
    expect(ventanaCentrada(50, 10, 98.951)).toEqual([45, 55])
    expect(ventanaCentrada(5, 200, 98.951)).toEqual([0, 98.951])
  })
})
