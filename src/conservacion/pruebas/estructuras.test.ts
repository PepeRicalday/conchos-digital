/**
 * Lectura de IO4 (estructuras), IO1 (extremos y conteos) e IO7 (edificios) del PacOT real de la SRL (solo lectura).
 * Las cifras esperadas salen de contar las filas del libro a mano; los casos defectuosos se listan por fila.
 */
import { describe, expect, it } from 'vitest'
import { EXTRACTOR_VERSION } from '../derivacion/extraer'
import { construirArchivo, leerArchivoDerivacion } from '../derivacion/archivo'
import { registrar } from '../derivacion/registro'
import type { FichaPacot } from '../derivacion/admision'
import type { LibroDerivado } from '../derivacion/tipos'
import { parseDMS } from '../nucleo/num/dms'
import { repararLonLat } from '../derivacion/ubicacion'
import { hayEvidencias, libroSrl } from './ayuda/libroSrl'

describe('repararLonLat · no inventa coordenadas', () => {
  it('la latitud que repite la longitud queda null y «duplicada»; la longitud se conserva', () => {
    const r = repararLonLat('105°11\'47.22"O', '105°11\'47.22"O')
    expect(r.lon).toBeCloseTo(-(105 + 11 / 60 + 47.22 / 3600), 9)
    expect(r.lat).toBeNull()
    expect(r.defectoLat).toBe('duplicada')
    expect(r.defectoLon).toBeNull()
  })
  it('la longitud con letra N (misma cadena en las dos columnas) queda null y «duplicada»; la latitud se conserva', () => {
    const r = repararLonLat(' 28° 5\'16.97"N', ' 28° 5\'16.97"N')
    expect(r.lon).toBeNull()
    expect(r.defectoLon).toBe('duplicada')
    expect(r.lat).toBeCloseTo(28 + 5 / 60 + 16.97 / 3600, 9)
  })
  it('letra de otro eje con valor distinto → «eje_incorrecto»; vacío → «vacia»; texto raro → «ilegible»', () => {
    expect(repararLonLat(' 27°42\'59.47"N', ' 27°43\'14.26"N')).toMatchObject({ lon: null, defectoLon: 'eje_incorrecto' })
    expect(repararLonLat(null, undefined)).toMatchObject({ lon: null, lat: null, defectoLon: 'vacia', defectoLat: 'vacia' })
    expect(repararLonLat('xx', '105°1\'1"O')).toMatchObject({ lon: null, defectoLon: 'ilegible', lat: null, defectoLat: 'eje_incorrecto' })
  })
})

describe.skipIf(!hayEvidencias)('SRL Unidad Conchos · estructuras, ubicación y ramal auxiliar', () => {
  const { libro: l, vista } = hayEvidencias ? libroSrl() : ({} as ReturnType<typeof libroSrl>)
  const E = l?.fichas.estructuras ?? []

  it('el extractor es v4 y el libro lo declara', () => {
    expect(EXTRACTOR_VERSION).toBe(6)
    expect(l.extractorVersion).toBe(6)
  })

  it('IO4: 385 estructuras leídas (filas 14 a 398, una por obra)', () => {
    expect(E).toHaveLength(385)
    expect(E[0]?.fila).toBe(14)
    expect(E[384]?.fila).toBe(398)
  })

  it('364 con coordenadas válidas y 21 defectuosas (385 − 21 = 364)', () => {
    const validas = E.filter((e) => e.lon !== null && e.lat !== null)
    const defectuosas = E.filter((e) => e.lon === null || e.lat === null)
    expect(validas).toHaveLength(364)
    expect(defectuosas).toHaveLength(21)
    expect(defectuosas.map((e) => e.fila)).toEqual([35, 78, 80, 92, 93, 98, 118, 137, 179, 230, 235, 244, 245, 256, 259, 262, 264, 301, 315, 337, 384])
  })

  it('las 21 por causa: 4 vacías (137, 245, 264, 337), 12 duplicadas y 5 con la coordenada del otro eje (35, 78, 244, 259, 315)', () => {
    const def = E.filter((e) => e.lon === null || e.lat === null)
    const vacias = def.filter((e) => e.defectoLon === 'vacia' || e.defectoLat === 'vacia')
    const dup = def.filter((e) => e.defectoLon === 'duplicada' || e.defectoLat === 'duplicada')
    const eje = def.filter((e) => e.defectoLon === 'eje_incorrecto' || e.defectoLat === 'eje_incorrecto')
    expect(vacias.map((e) => e.fila)).toEqual([137, 245, 264, 337])
    expect(dup).toHaveLength(12)
    expect(eje.map((e) => e.fila)).toEqual([35, 78, 244, 259, 315])
    expect(vacias.length + dup.length + eje.length).toBe(21)
  })

  it('0 valores inventados: lo defectuoso queda null (no 0 ni copia) y lo válido es exactamente el DMS de la celda', () => {
    for (const e of E) {
      if (e.lon === null) expect(e.defectoLon, `fila ${e.fila}`).not.toBeNull()
      if (e.lat === null) expect(e.defectoLat, `fila ${e.fila}`).not.toBeNull()
      if (e.lon !== null) { expect(e.lon).toBe(parseDMS(e.lonTexto)); expect(e.lon).not.toBe(0); expect(e.lon).toBeLessThan(0) }
      if (e.lat !== null) { expect(e.lat).toBe(parseDMS(e.latTexto)); expect(e.lat).not.toBe(0); expect(e.lat).toBeGreaterThan(0) }
    }
    // Fila 80: la latitud repite la longitud → la longitud sigue válida, la latitud NO se copia de ningún lado.
    const f80 = E.find((e) => e.fila === 80)
    expect(f80).toMatchObject({ lat: null, defectoLat: 'duplicada', defectoLon: null })
    expect(f80?.lon).toBeCloseTo(-(105 + 11 / 60 + 49.44 / 3600), 9)
  })

  it('la ubicación de las 21 es «estimada» (interpolada con su PK) y deja intactas las coordenadas declaradas', () => {
    const def = E.filter((e) => e.lon === null || e.lat === null)
    for (const e of def) {
      expect(e.ubicacion.estado, `fila ${e.fila}`).toBe('estimada')
      expect(e.ubicacion.motivo).toBeTruthy()
      expect(e.pk, `fila ${e.fila} necesita PK para estimarse`).not.toBeNull()
      expect(e.ubicacion.lon).toBeLessThan(-105)
      expect(e.ubicacion.lat).toBeGreaterThan(27)
    }
    expect(E.filter((e) => e.ubicacion.estado === 'valida')).toHaveLength(364)
    expect(E.filter((e) => e.ubicacion.estado === 'sin_ubicar')).toHaveLength(0)
  })

  it('2 sin PK recuperable: filas 156 («K-44+ (AUTOPISTA)», km 44 parcial) y 300 («K-79-025»)', () => {
    const sin = E.filter((e) => e.pk === null)
    expect(sin.map((e) => e.fila)).toEqual([156, 300])
    expect(sin[0]).toMatchObject({ pkParcialKm: 44, pkMetros: null })
    expect(sin[1]).toMatchObject({ pkParcialKm: null, pkMetros: null })
    // Tienen coordenadas válidas: se ubican, solo que no entran a la comparación por tramo.
    expect(sin.every((e) => e.ubicacion.estado === 'valida')).toBe(true)
  })

  it('PK sucios reales de IO4 quedan limpios: 143 «TK-39+940-I (CANO) BOMBEO» (fila 143), 1+370 con paréntesis (fila 396)', () => {
    expect(E.find((e) => e.fila === 143)).toMatchObject({ pk: '39+940', margen: 'I' })
    expect(E.find((e) => e.fila === 396)).toMatchObject({ pk: '1+370', ramal: 'auxiliar' })
    expect(E.find((e) => e.fila === 14)).toMatchObject({ pk: '0+000', pkMetros: 0 })
  })

  it('la primera estructura coincide con el primer vértice de IO1: 105°12\'35.25"O y 27°40\'4.39"N', () => {
    expect(E[0]?.lon).toBeCloseTo(-105.209792, 6)
    expect(E[0]?.lat).toBeCloseTo(27.667886, 6)
  })

  it('el cadenamiento reinicia en la fila 391: 8 estructuras del auxiliar (inventario 376-383) y 377 del principal', () => {
    const aux = E.filter((e) => e.ramal === 'auxiliar')
    expect(aux).toHaveLength(8)
    expect(aux.map((e) => e.fila)).toEqual([391, 392, 393, 394, 395, 396, 397, 398])
    expect(aux.map((e) => e.inventario)).toEqual(['376', '377', '378', '379', '380', '381', '382', '383'])
    expect(aux[0]?.pk).toBe('0+110')
    expect(E.filter((e) => e.ramal === 'principal')).toHaveLength(377)
    expect(l.fichas.avisosGeo?.some((a) => a.includes('IO4!D391') && a.includes('reinicia'))).toBe(true)
  })

  it('IO1: 60 tramos (58 del principal K-0+000→K-98+951 y 2 del auxiliar), auxiliar anclado en K-68+582', () => {
    const c = l.fichas.canales
    expect(c).toHaveLength(60)
    expect(c.filter((f) => f.ramal === 'principal')).toHaveLength(58)
    expect(c.filter((f) => f.ramal === 'auxiliar').map((f) => f.fila)).toEqual([74, 75])
    expect(c[0]).toMatchObject({ fila: 16, pkInicial: '0+000', pkFinal: '2+000' })
    expect(c[57]).toMatchObject({ fila: 73, pkFinal: '98+951' })
    expect(c[58]).toMatchObject({ fila: 74, pkInicial: '0+000', pkFinal: '1+370', ramal: 'auxiliar' })
    expect(l.fichas.anclaAuxiliar).toBe('68+582')
  })

  it('IO1 fila 16: extremos con PK y coordenadas en grados decimales (DMS a mano) y conteos W..AN', () => {
    const f = l.fichas.canales[0]
    // 105°12'7.82"O = −(105 + 12/60 + 7.82/3600) = −105.202172 ; 27°41'0.31"N = 27 + 41/60 + 0.31/3600 = 27.683419
    expect(f?.ini).toMatchObject({ pk: '0+000', refPK: 'IO1!D16', refLon: 'IO1!E16', refLat: 'IO1!F16', defectoLon: null, defectoLat: null })
    expect(f?.fin?.lon).toBeCloseTo(-105.202172, 6)
    expect(f?.fin?.lat).toBeCloseTo(27.683419, 6)
    expect(f?.fin?.lonTexto).toBe('105°12\'7.82"O')
    expect(f?.conteos?.porTipo.estacion_aforo).toBe(4)
    expect(f?.conteos?.porTipo.represa).toBeNull() // celda vacía = S/D, no 0
    expect(f?.conteos?.total).toBe(6)
  })

  it('IO1: 7 celdas de latitud con la longitud copiada → 4 puntos distintos sin latitud, ninguno inventado', () => {
    const celdas = l.fichas.canales.flatMap((f) => [f.ini, f.fin]).filter((p) => p !== undefined && p.defectoLat !== null).map((p) => p?.refLat)
    expect(celdas.sort()).toEqual(['IO1!F27', 'IO1!F50', 'IO1!F59', 'IO1!F74', 'IO1!I26', 'IO1!I49', 'IO1!I58'].sort())
    const puntos = new Set(l.fichas.canales.flatMap((f) => [f.ini, f.fin]).filter((p) => p !== undefined && p.lat === null).map((p) => `${p?.pk}`))
    // 20+000 (I26 = F27), 60+000 (I49 = F50), 72+000 (I58 = F59) y el 0+000 del auxiliar (F74) — ambas celdas de cada punto compartido están mal.
    expect([...puntos].sort()).toEqual(['0+000', '20+000', '60+000', '72+000'])
    expect(l.fichas.avisosGeo?.filter((a) => a.startsWith('Punto K-'))).toHaveLength(4)
    for (const p of l.fichas.canales.flatMap((f) => [f.ini, f.fin])) if (p?.lat === null) expect(p.defectoLat).toBe('duplicada')
  })

  it('IO1 fila 15: totales declarados por columna y AN15 = 385', () => {
    const t = l.fichas.totalesIO1
    expect(t?.total).toBe(385)
    expect(t?.porTipo).toEqual({
      estacion_aforo: 16, represa: 13, toma: 58, toma_granja: 90, caja_repartidora: 0, caida: 0, rapida: 0, desfogue: 13, entrada_agua: 152,
      paso_superior: 11, paso_inferior: 6, muro_retencion: 0, sifon: 6, alcantarilla: 0, puente_canal: 1, puente_vehiculos: 19, puente_peatones: 0,
    })
    // 16 + 13 + 58 + 90 + 0 + 0 + 0 + 13 + 152 + 11 + 6 + 0 + 6 + 0 + 1 + 19 + 0 = 385
    expect(Object.values(t?.porTipo ?? {}).reduce((a: number, b) => a + (b ?? 0), 0)).toBe(385)
  })

  it('IO7: 6 edificios (oficinas, central de maquinaria y 4 casetas) con coordenadas válidas y PK cuando el texto lo trae', () => {
    const b = l.fichas.edificios ?? []
    expect(b).toHaveLength(6)
    expect(b.map((x) => x.inventario)).toEqual(['O1-SRL', 'CM1-SRL', 'C1-SRL', 'C2-SRL', 'C3-SRL', 'C4-SRL'])
    expect(b.every((x) => x.ubicacion.estado === 'valida')).toBe(true)
    // C1: 105°11'41.39"O = −(105 + 11/60 + 41.39/3600) = −105.194831 ; 27°43'15.53"N = 27 + 43/60 + 15.53/3600 = 27.720981
    expect(b[2]).toMatchObject({ nombre: 'CASETA', pk: '6+000', areaM2: 250 })
    expect(b[2]?.lon).toBeCloseTo(-105.194831, 6)
    expect(b[2]?.lat).toBeCloseTo(27.720981, 6)
    expect(b[0]?.pk).toBeNull() // «Cd, Delicias, Chih.» no es un cadenamiento
  })

  it('las hojas vacías del libro no producen nada y el PacOT original no cambia (la vista solo lee)', () => {
    expect(vista.libro.sha256).toBe('srl-prueba')
    expect(l.fichas.drenes).toEqual([])
  })
})

describe.skipIf(!hayEvidencias)('reproceso por versión y archivo de derivación', () => {
  const { libro: l } = hayEvidencias ? libroSrl() : ({} as ReturnType<typeof libroSrl>)
  const ficha: FichaPacot = { tipo: 'SRL', numeroModulo: null, moduloTexto: 'SRL', srl: 'Unidad Conchos', rfcSrl: '', distrito: '005', ciclo: '2026 - 2027' }

  it('un registro guardado con el extractor v3 se reprocesa con el v4 sin subir la versión del PacOT', () => {
    const v3: LibroDerivado = { ...l, extractorVersion: 3, fichas: { canales: [], drenes: [], caminos: [] } }
    const r1 = registrar(new Map(), { ficha, libro: v3, archivoNombre: 'a.xls' }, 't1')
    expect(r1.estado).toBe('nuevo')
    const r2 = registrar(r1.registro, { ficha, libro: l, archivoNombre: 'a.xls' }, 't2')
    expect(r2.estado).toBe('reprocesado')
    expect(r2.pacot.version).toBe(1)
    expect(r2.pacot.libro.fichas.estructuras).toHaveLength(385)
    // Con la misma versión ya no hay nada que hacer.
    expect(registrar(r2.registro, { ficha, libro: l, archivoNombre: 'a.xls' }, 't3').estado).toBe('sin_cambio')
  })

  it('el archivo de derivación conserva estructuras, edificios, extremos y conteos (el esquema Zod no los recorta)', () => {
    const r = registrar(new Map(), { ficha, libro: l, archivoNombre: 'a.xls' }, 't1').registro
    const arch = construirArchivo(r, new Map(), '2026 - 2027', 't')
    const leido = leerArchivoDerivacion(JSON.parse(JSON.stringify(arch)) as unknown)
    const f = leido.registro.get('2026 - 2027|SRL')?.libro.fichas
    expect(f?.estructuras).toHaveLength(385)
    expect(f?.estructuras?.find((e) => e.fila === 35)?.ubicacion.estado).toBe('estimada')
    expect(f?.edificios).toHaveLength(6)
    expect(f?.canales[0]?.ini?.lat).toBeCloseTo(27.667886, 6)
    expect(f?.canales[58]?.ramal).toBe('auxiliar')
    expect(f?.totalesIO1?.total).toBe(385)
    expect(f?.anclaAuxiliar).toBe('68+582')
  })

  it('un archivo de la versión anterior (sin campos de ubicación) se sigue leyendo', () => {
    const viejo: LibroDerivado = {
      ...l, extractorVersion: 3,
      // Sin los campos nuevos: se reconstruye cada ficha solo con lo que tenía el extractor v3.
      fichas: {
        canales: l.fichas.canales.map((f) => { const v3: Record<string, unknown> = { ...f }; for (const k of ['ini', 'fin', 'conteos', 'ramal']) delete v3[k]; return v3 as unknown as typeof f }),
        drenes: [], caminos: [],
      },
    }
    const r = registrar(new Map(), { ficha, libro: viejo, archivoNombre: 'a.xls' }, 't1').registro
    const leido = leerArchivoDerivacion(JSON.parse(JSON.stringify(construirArchivo(r, new Map(), '2026 - 2027', 't'))) as unknown)
    const f = leido.registro.get('2026 - 2027|SRL')?.libro.fichas
    expect(f?.canales).toHaveLength(60)
    expect(f?.estructuras).toBeUndefined()
  })
})
