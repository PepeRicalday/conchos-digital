/**
 * Contorno real del canal: trazo (geo/trazo.ts), anclas y subtrazo por PK (geo/kmALatLng.ts), estimación de estructuras (geo/estimar.ts)
 * y resumen de calidad del contorno (geo/calidad.ts). Casos de oro con la cuenta escrita a mano sobre un trazo en L sintético y
 * con el trazo y el inventario reales de la SRL Unidad Conchos.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { contradiccionFinCamino, resumenContornoEje, resumenContornoTramo } from '../geo/calidad'
import { DESFASE_PK_MEDIANA_M, calidadDeUbicacion, estimarUbicaciones } from '../geo/estimar'
import { arcoDePK, construirEjes, cuerdaPorPK, kmALatLng, pkAMetros, posicionPK, subtrazoPorPK } from '../geo/kmALatLng'
import type { EjeCanal } from '../geo/kmALatLng'
import { distanciaAlTrazo, parsearTrazoGeoJSON, proyectarAlTrazo, puntoEnArco, simplificarDP, subtrazo, trazoDesdePuntos } from '../geo/trazo'
import type { LonLat, Trazo } from '../geo/trazo'
import { hayEvidencias, libroSrl } from './ayuda/libroSrl'

/** Metros por grado de arco de círculo máximo con R = 6 371 000 m (la R del módulo). */
const M_GRADO = (6_371_000 * Math.PI) / 180 // 111 194.9266

/** Trazo en L: A(0,0) → B(0.01,0) → C(0.01,0.01). Cada pata mide 0.01° = 1 111.949 m. */
const L = trazoDesdePuntos([[0, 0], [0.01, 0], [0.01, 0.01]]) as Trazo
const PATA = 0.01 * M_GRADO

const trazoReal = parsearTrazoGeoJSON(JSON.parse(readFileSync(path.resolve(process.cwd(), 'public/geo/canal_conchos.geojson'), 'utf8')) as unknown) as Trazo

describe('trazo en L sintético · cuenta a mano', () => {
  it('longitud = 2 patas de 0.01° = 2 × 1 111.949 m', () => {
    expect(L.longitudM).toBeCloseTo(2 * PATA, 1)
    expect(L.arco[1]).toBeCloseTo(PATA, 1)
  })
  it('proyección exacta sobre un segmento: (0.005, 0.0005) → arco 0.005° = 555.97 m, distancia 0.0005° = 55.60 m, segmento 0', () => {
    const p = proyectarAlTrazo([0.005, 0.0005], L)
    expect(p?.segmento).toBe(0)
    expect(p?.arco).toBeCloseTo(0.005 * M_GRADO, 1)
    expect(p?.distancia).toBeCloseTo(0.0005 * M_GRADO, 1)
    expect(p?.punto[0]).toBeCloseTo(0.005, 9)
    expect(p?.punto[1]).toBeCloseTo(0, 9)
  })
  it('más allá del segmento se acota al extremo: (0.012, 0.004) → sobre BC, arco PATA + 0.004° y distancia 0.002°', () => {
    const p = proyectarAlTrazo([0.012, 0.004], L)
    expect(p?.segmento).toBe(1)
    expect(p?.arco).toBeCloseTo(PATA + 0.004 * M_GRADO, 1)
    expect(p?.distancia).toBeCloseTo(0.002 * M_GRADO, 1)
    expect(distanciaAlTrazo([0.012, 0.004], L)).toBeCloseTo(0.002 * M_GRADO, 1)
  })
  it('subtrazo con extremos exactos: arcos 0.5 y 1.5 patas → [(0.005,0), B, (0.01,0.005)]', () => {
    const s = subtrazo(L, 0.5 * PATA, 1.5 * PATA)
    expect(s).toHaveLength(3)
    expect(s[0]?.[0]).toBeCloseTo(0.005, 9); expect(s[0]?.[1]).toBeCloseTo(0, 9)
    expect(s[1]).toEqual([0.01, 0])
    expect(s[2]?.[0]).toBeCloseTo(0.01, 9); expect(s[2]?.[1]).toBeCloseTo(0.005, 9)
  })
  it('subtrazo dentro de un solo segmento: solo los dos extremos; invertido da lo mismo; fuera de rango se acota', () => {
    expect(subtrazo(L, 0.2 * PATA, 0.4 * PATA)).toHaveLength(2)
    expect(subtrazo(L, 0.4 * PATA, 0.2 * PATA)).toEqual(subtrazo(L, 0.2 * PATA, 0.4 * PATA))
    const todo = subtrazo(L, -50, 5 * PATA)
    expect(todo).toHaveLength(3)
    expect(todo[0]).toEqual([0, 0])
    expect(todo[1]).toEqual([0.01, 0])
    expect(todo[2]?.[0]).toBeCloseTo(0.01, 9); expect(todo[2]?.[1]).toBeCloseTo(0.01, 9)
  })
  it('puntoEnArco: fuera de [0, longitud] → null (no extrapola)', () => {
    expect(puntoEnArco(L, -1)).toBeNull()
    expect(puntoEnArco(L, L.longitudM + 1)).toBeNull()
    expect(puntoEnArco(L, PATA)?.[0]).toBeCloseTo(0.01, 9)
  })
  it('anclas sobre la L: PK 0 y 2 000 → arcos 0 y 2 patas; PK 1 000 se interpola por arco (en B), no por cuerda', () => {
    const eje: EjeCanal = {
      ramal: 'principal', trazo: L,
      vertices: [{ metros: 0, lon: 0, lat: 0, origen: 'declarado' }, { metros: 2000, lon: 0.01, lat: 0.01, origen: 'declarado' }],
      anclas: [{ pk: 0, arco: 0, d: 0, lon: 0, lat: 0 }, { pk: 2000, arco: 2 * PATA, d: 0, lon: 0.01, lat: 0.01 }],
    }
    // PK 1 000 = mitad del arco = justo en B (0.01, 0); la cuerda daría (0.005, 0.005).
    const p = posicionPK(1000, eje)
    expect(p?.calidad).toBe('interpolada')
    expect(p?.lon).toBeCloseTo(0.01, 9)
    expect(p?.lat).toBeCloseTo(0, 9)
    expect(posicionPK(0, eje)?.calidad).toBe('ancla')
    expect(posicionPK(2001, eje)).toBeNull()
    expect(posicionPK(-1, eje)).toBeNull()
    expect(arcoDePK(500, eje)).toBeCloseTo(0.5 * PATA, 6) // 500/2000 × 2 patas = 0.5 pata
    const sub = subtrazoPorPK(eje, 0, 2000)
    expect(sub.calidad).toBe('ancla')
    expect(sub.puntos).toHaveLength(3)
  })
})

describe('simplificarDP y parseo', () => {
  it('no hay nada que quitar en una recta; una L conserva su esquina', () => {
    expect(simplificarDP([[0, 0], [0.005, 0], [0.01, 0]], 1)).toEqual([[0, 0], [0.01, 0]])
    expect(simplificarDP([[0, 0], [0.01, 0], [0.01, 0.01]], 1)).toHaveLength(3)
  })
  it('GeoJSON mal formado → null', () => {
    expect(parsearTrazoGeoJSON(null)).toBeNull()
    expect(parsearTrazoGeoJSON({ type: 'FeatureCollection', features: [] })).toBeNull()
    expect(parsearTrazoGeoJSON({ type: 'LineString', coordinates: [[0, 0]] })).toBeNull()
    expect(parsearTrazoGeoJSON({ type: 'LineString', coordinates: [[0, 'x'], [1, 1]] })).toBeNull()
  })
})

describe('trazo real del canal (public/geo/canal_conchos.geojson)', () => {
  it('1 233 puntos; longitud haversine ≈ 99 495 m (no los 99 125 m de las propiedades)', () => {
    expect(trazoReal.puntos).toHaveLength(1233)
    expect(trazoReal.longitudM).toBeGreaterThan(99_493)
    expect(trazoReal.longitudM).toBeLessThan(99_497)
  })
  it('Douglas-Peucker: 10 m deja ≤ 330 puntos y 50 m ≤ 160; ambas conservan inicio y fin', () => {
    const a = simplificarDP(trazoReal.puntos, 10), b = simplificarDP(trazoReal.puntos, 50)
    console.log(`DP 10 m = ${a.length} puntos; DP 50 m = ${b.length} puntos`)
    expect(a.length).toBeLessThanOrEqual(330)
    expect(b.length).toBeLessThanOrEqual(160)
    expect(b.length).toBeLessThan(a.length)
    for (const s of [a, b]) {
      expect(s[0]).toEqual(trazoReal.puntos[0])
      expect(s[s.length - 1]).toEqual(trazoReal.puntos[trazoReal.puntos.length - 1])
    }
    // La simplificación no se aparta del original más que la tolerancia (+ holgura de la métrica local).
    const tb = trazoDesdePuntos(b) as Trazo
    for (const p of trazoReal.puntos as LonLat[]) expect(distanciaAlTrazo(p, tb) as number).toBeLessThanOrEqual(50.5)
  })
})

describe.skipIf(!hayEvidencias)('SRL Unidad Conchos · anclas, subtrazo y calidad con el trazo real', () => {
  const { libro } = libroSrl()
  const f = libro.fichas
  const ejes = construirEjes(f.canales, pkAMetros(f.anclaAuxiliar), trazoReal)
  const P = ejes.principal
  const anclas = P.anclas ?? []

  it('los 56 vértices válidos son anclas (≤ 50 m, mediana ≈ 3.4 m, máx ≈ 16.4 m en K-48+000) y su arco es estrictamente monótono con el PK', () => {
    expect(anclas).toHaveLength(56)
    expect(P.anclasDescartadas).toEqual([])
    for (let i = 1; i < anclas.length; i++) {
      expect(anclas[i]?.pk as number).toBeGreaterThan(anclas[i - 1]?.pk as number)
      expect(anclas[i]?.arco as number).toBeGreaterThan(anclas[i - 1]?.arco as number)
    }
    const d = anclas.map((a) => a.d).sort((x, y) => x - y)
    const max = anclas.reduce((m, a) => (a.d > m.d ? a : m))
    expect(max.pk).toBe(48000)
    expect(max.d).toBeGreaterThan(16); expect(max.d).toBeLessThan(17)
    const mediana = ((d[27] as number) + (d[28] as number)) / 2
    expect(mediana).toBeGreaterThan(2.5); expect(mediana).toBeLessThan(4.5)
    const r = resumenContornoEje(P)
    expect(r.nAnclas).toBe(56)
    expect(r.rangoPk).toEqual([0, 98951])
  })

  it('K-0+000 cae a ≈13.4 m del inicio y K-98+951 → arco 99 494.6 ± 1 m (a ≈3 m del final)', () => {
    expect(anclas[0]?.arco).toBeCloseTo(0, 0)
    expect(anclas[0]?.d).toBeGreaterThan(13); expect(anclas[0]?.d).toBeLessThan(14)
    const a = arcoDePK('98+951', P) as number
    expect(Math.abs(a - 99_494.6)).toBeLessThanOrEqual(1)
    expect(Math.abs(trazoReal.longitudM - a)).toBeLessThan(2)
  })

  it('K-46+500 → arco 46 829.8 ± 1 m', () => {
    expect(Math.abs((arcoDePK('46+500', P) as number) - 46_829.8)).toBeLessThanOrEqual(1)
  })

  it('saltos de cadenamiento: K-46+000→46+500 (razón ≈ 1.47) y K-96+000→98+951 (≈ 1.05), solo esos dos', () => {
    expect(P.saltos).toHaveLength(2)
    const [s1, s2] = P.saltos ?? []
    expect([s1?.pkIni, s1?.pkFin]).toEqual([46000, 46500])
    expect(s1?.deltaArcoM).toBeCloseTo(734.8, 0)
    expect(s1?.razon).toBeCloseTo(1.47, 2)
    expect([s2?.pkIni, s2?.pkFin]).toEqual([96000, 98951])
    expect(s2?.deltaArcoM).toBeCloseTo(3104.2, 0)
    expect(s2?.razon).toBeCloseTo(1.052, 2)
    expect(ejes.avisosTrazo?.filter((x) => x.startsWith('Salto'))).toHaveLength(2)
  })

  it('K-20+000 (sin latitud válida) → arco 20 049.6 ± 5 m, calidad «interpolada», y el punto cae sobre el trazo', () => {
    expect(Math.abs((arcoDePK(20000, P) as number) - 20_049.6)).toBeLessThanOrEqual(5)
    const p = posicionPK(20000, P)
    expect(p?.calidad).toBe('interpolada')
    expect(p?.estimada).toBe(true)
    expect(distanciaAlTrazo([p?.lon as number, p?.lat as number], trazoReal) as number).toBeLessThan(0.5)
    expect(Math.abs((arcoDePK(60000, P) as number) - 60_367.1)).toBeLessThanOrEqual(5)
    expect(Math.abs((arcoDePK(72000, P) as number) - 72_381.5)).toBeLessThanOrEqual(5)
  })

  it('un vértice válido es «ancla» y devuelve sus coordenadas declaradas; kmALatLng añade calidad', () => {
    const v = P.vertices.find((x) => x.metros === 98951)
    expect(kmALatLng(98951, P)).toEqual({ lon: v?.lon, lat: v?.lat, estimada: false, calidad: 'ancla' })
  })

  it('PK fuera del rango de anclas → null (no se extrapola)', () => {
    expect(kmALatLng(-1, P)).toBeNull()
    expect(kmALatLng(98952, P)).toBeNull()
    expect(kmALatLng(120_000, P)).toBeNull()
    expect(arcoDePK(98952, P)).toBeNull()
  })

  it('subtrazo K-10+000→K-12+000: todos los puntos entre los arcos de sus extremos y extremos exactos', () => {
    const s = subtrazoPorPK(P, '10+000', '12+000')
    const a0 = s.arcoIni as number, a1 = s.arcoFin as number
    expect(s.calidad).toBe('ancla')
    expect(s.puntos.length).toBeGreaterThan(10)
    for (const p of s.puntos) {
      const pr = proyectarAlTrazo(p, trazoReal)
      expect(pr?.distancia as number).toBeLessThan(0.5)
      expect(pr?.arco as number).toBeGreaterThanOrEqual(a0 - 0.5)
      expect(pr?.arco as number).toBeLessThanOrEqual(a1 + 0.5)
    }
    const ini = proyectarAlTrazo(s.puntos[0] as LonLat, trazoReal), fin = proyectarAlTrazo(s.puntos[s.puntos.length - 1] as LonLat, trazoReal)
    expect(ini?.arco).toBeCloseTo(a0, 1)
    expect(fin?.arco).toBeCloseTo(a1, 1)
    expect(a0).toBeCloseTo(10_012.6, 0)
    expect(a1).toBeCloseTo(12_018.5, 0)
    // Un extremo entre anclas (K-11+000) → «interpolada».
    expect(subtrazoPorPK(P, '10+000', '11+000').calidad).toBe('interpolada')
  })

  it('regresión K-56→K-58: el subtrazo queda a ≤ 30 m del trazo y la cuerda original se apartaba > 600 m', () => {
    const s = subtrazoPorPK(P, '56+000', '58+000')
    for (const p of s.puntos) expect(distanciaAlTrazo(p, trazoReal) as number).toBeLessThanOrEqual(30)
    const cuerda = cuerdaPorPK(P, '56+000', '58+000')
    expect(cuerda).toHaveLength(2)
    const tc = trazoDesdePuntos(cuerda) as Trazo
    const enTramo = (trazoReal.puntos as LonLat[]).filter((_p, i) => (trazoReal.arco[i] as number) >= (s.arcoIni as number) && (trazoReal.arco[i] as number) <= (s.arcoFin as number))
    expect(Math.max(...enTramo.map((p) => distanciaAlTrazo(p, tc) as number))).toBeGreaterThan(600)
    const r = resumenContornoTramo(P, '56+000', '58+000')
    console.log(`K-56→58: desviación cuerda-trazo ${r.desviacionCuerdaMaxM?.toFixed(1)} m; contorno ${r.longitudContornoM?.toFixed(0)} m vs cuerda ${r.longitudCuerdaM?.toFixed(0)} m`)
    expect(r.desviacionCuerdaMaxM).toBeGreaterThan(600)
    expect(r.calidad).toBe('ancla')
    expect(r.nAnclasEnTramo).toBe(2)
    expect(r.respaldoAncla).toBe(1)
    expect(r.saltosEnTramo).toEqual([])
  })

  it('resumen de un tramo con salto: K-46+000→K-46+500 lo reporta y el contorno es más largo que lo declarado', () => {
    const r = resumenContornoTramo(P, '46+000', '46+500')
    expect(r.saltosEnTramo).toHaveLength(1)
    expect(r.longitudContornoM as number).toBeGreaterThan(700)
  })

  it('el auxiliar K-68+582 nunca recibe trazo: su eje no tiene anclas y su subtrazo es cuerda', () => {
    expect(ejes.auxiliar).not.toBeNull()
    const A = ejes.auxiliar as EjeCanal
    expect(A.trazo).toBeUndefined()
    expect(A.anclas).toBeUndefined()
    const ult = A.vertices[A.vertices.length - 1]?.metros as number
    const s = subtrazoPorPK(A, 0, ult)
    expect(s.calidad).toBe('cuerda')
    expect(s.puntos.length).toBeGreaterThanOrEqual(2)
    for (const p of A.vertices) expect(posicionPK(p.metros, A)?.calidad).not.toBe('ancla')
    expect(resumenContornoTramo(A, 0, ult).calidad).toBe('cuerda')
  })

  it('sin trazo todo sigue igual: sin anclas, kmALatLng sin «calidad», subtrazo = cuerda', () => {
    const e0 = construirEjes(f.canales, pkAMetros(f.anclaAuxiliar))
    expect(e0.principal.anclas).toBeUndefined()
    expect(e0.avisosTrazo).toEqual([])
    expect(Object.keys(kmALatLng(2000, e0.principal) ?? {}).sort()).toEqual(['estimada', 'lat', 'lon'])
    expect(posicionPK(2000, e0.principal)?.calidad).toBe('declarada')
    expect(subtrazoPorPK(e0.principal, '56+000', '58+000').calidad).toBe('cuerda')
    expect(resumenContornoEje(e0.principal).conTrazo).toBe(false)
  })

  it('estructuras IO4: las coordenadas válidas se conservan idénticas (bit a bit); las inválidas se estiman sobre el trazo', () => {
    const est = f.estructuras ?? []
    const con = estimarUbicaciones(est, ejes)
    let validas = 0, estimadas = 0, sinUbicar = 0
    est.forEach((e, i) => {
      const u = (con[i] as (typeof est)[number]).ubicacion
      if (e.ubicacion.estado === 'valida') {
        validas++
        expect(u).toBe(e.ubicacion)
        expect(Object.is(u.lon, e.ubicacion.lon) && Object.is(u.lat, e.ubicacion.lat)).toBe(true)
        expect(calidadDeUbicacion(u)).toBe('declarada')
      } else if (u.estado === 'estimada') {
        estimadas++
        expect(calidadDeUbicacion(u)).toBe('estimada')
        if (e.ramal === 'principal') { expect(distanciaAlTrazo([u.lon as number, u.lat as number], trazoReal) as number).toBeLessThan(60); expect(u.motivo).toContain('trazo') }
      } else sinUbicar++
    })
    console.log(`IO4: ${est.length} estructuras; válidas ${validas}; estimadas ${estimadas}; sin ubicar ${sinUbicar}`)
    expect(validas).toBeGreaterThan(0)
    expect(estimadas + sinUbicar).toBe(est.length - validas)
    expect(DESFASE_PK_MEDIANA_M).toBe(137)
  })

  it('contradicción del PacOT: IO3 termina el camino en 98+850 y IO1 el canal en 98+951 (101 m)', () => {
    expect(contradiccionFinCamino(f)).toMatchObject({ pkCanal: '98+951', pkCamino: '98+850', diferenciaM: 101 })
    expect(contradiccionFinCamino({ canales: f.canales, caminos: [] })).toBeNull()
  })
})
