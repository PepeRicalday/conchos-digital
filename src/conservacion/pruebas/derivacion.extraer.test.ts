/**
 * Extractor de derivación contra el PacOT 2026-27 de SRL Unidad Conchos (solo lectura, no se copia al repo).
 * Cifras de oro tomadas de las celdas del libro: 3DN!E32, H32, J32 y J63; DIAG-01 fila 15 (totales).
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { normalizarDataJson, VistaLibro } from '../nucleo'
import { extraerLibro, normalizarPK, parPK } from '../derivacion/extraer'
import type { LibroDerivado } from '../derivacion/tipos'

const carpeta = process.env.CONCHOS_EVIDENCIAS ?? path.resolve(process.cwd(), '../Conservacion/Skill/ejemplo_Conchos/evidencias/lector_xls')
const hay = existsSync(path.join(carpeta, 'data.json')) && existsSync(path.join(carpeta, 'manifest.json'))

describe('normalización de PK', () => {
  it('unifica formatos de cadenamiento', () => {
    expect(normalizarPK('K-0+000')).toBe('0+000')
    expect(normalizarPK('3+520')).toBe('3+520')
    expect(normalizarPK('0')).toBe('0+000')
    expect(normalizarPK('sin pk')).toBeNull()
  })
  it('separa los dos PK de una localización', () => {
    expect(parPK('K-0+000 AL K-3+520')).toEqual(['0+000', '3+520'])
    expect(parPK('K-3+520')).toBeNull()
  })
})

describe.skipIf(!hay)('Conchos · derivación extraída de las hojas reales', () => {
  let d: LibroDerivado

  beforeAll(() => {
    const crudo: unknown = JSON.parse(readFileSync(path.join(carpeta, 'data.json'), 'utf8'))
    const manifest = JSON.parse(readFileSync(path.join(carpeta, 'manifest.json'), 'utf8')) as { sha256: string }
    d = extraerLibro(new VistaLibro(normalizarDataJson(crudo, { sha256: manifest.sha256, extractor: 'lector_xls' })))
  })

  it('identifica módulo, ciclo y los conceptos de DIAG-01 por sus rótulos', () => {
    expect(d.moduloNombre).toBe('SRL UNIDAD CONCHOS')
    expect(d.ciclo).toBe('2026 - 2027')
    expect(d.conceptosDiagnostico.length).toBe(5)
    expect(d.conceptosDiagnostico.some((c) => /DESAZOLVE/i.test(c))).toBe(true)
  })

  it('lee los tramos por red con su cadenamiento y deja la fila de totales aparte', () => {
    const redes = new Set(d.tramos.map((t) => t.red))
    // La SRL no tiene drenes en su inventario (IO2!J15 = 0): sin tramos de drenaje y SIN aviso, es lo correcto.
    expect(redes).toEqual(new Set(['distribucion', 'caminos']))
    expect(d.inventarioKm.drenaje.valor).toBe('0')
    expect(d.avisos).toEqual([])
    const primero = d.tramos[0]
    expect(primero?.obra).toBe('CANAL PRINCIPAL CONCHOS')
    expect(primero?.pkInicial).toBe('0+000')
    expect(primero?.pkFinal).toBe('2+000')
    expect(primero?.km.valor).toBe('2')
    const desazolve = d.totalesDiagnostico.find((c) => /DESAZOLVE/i.test(c.concepto))
    expect(Number(desazolve?.trabajo.valor)).toBeCloseTo(468505.36, 2)
    expect(desazolve?.trabajo.origen).toBe('formula')
  })

  it('un número de inventario en texto ("1.-1") es un tramo, no se descarta; un encabezado repetido sí', () => {
    const f = d.tramos.filter((t) => t.inventario === '1.-1')
    expect(f.map((t) => t.fila)).toEqual([75, 76, 102])
    expect(d.tramos.every((t) => t.km.valor !== null)).toBe(true)
    expect(d.tramos.some((t) => /NOMBRE\s+DE\s+LA\s+OBRA/i.test(t.obra))).toBe(false)
  })

  it('fichas de inventario: canales de IO1 con su sección y PK normalizado; la SRL no tiene drenes', () => {
    expect(d.extractorVersion).toBeGreaterThanOrEqual(2)
    expect(d.fichas.canales).toHaveLength(60)
    expect(d.fichas.drenes).toHaveLength(0)
    const f = d.fichas.canales[0]
    expect(f).toMatchObject({ fila: 16, inventario: '1', categoria: 'Principales', pkInicial: '0+000', pkFinal: '2+000', seccion: expect.stringMatching(/trap/i) })
    expect(f?.km.valor).toBe('2')
    expect(f?.plantilla.valor).toBe('13.3')
    expect(f?.tirante.valor).toBe('3.2')
    expect(f?.talud.valor).toBe('1.75')
    expect(f?.area.valor).toBe('60.480000000000004')
    expect(f?.pendiente.ref).toBe('IO1!N16')
  })

  it('fichas de caminos de IO3: longitud, ancho de carpeta y revestimiento', () => {
    const c = d.fichas.caminos[0]
    expect(c?.km.valor).toBe('98.951')
    expect(c?.ancho.valor).toBe('6')
    expect(c?.revestimiento).toMatch(/revest/i)
    expect(c?.pkInicial).toBe('0+000')
    expect(c?.pkFinal).toBe('98+850')
    const suma = d.fichas.caminos.reduce((a, x) => a + Number(x.km.valor), 0)
    expect(suma).toBeCloseTo(202.462, 3)
  })

  it('la suma de longitudes de las fichas coincide con el inventario del propio libro (IO1!J15)', () => {
    const suma = d.fichas.canales.reduce((a, x) => a + Number(x.km.valor), 0)
    expect(suma).toBeCloseTo(Number(d.inventarioKm.distribucion.valor), 3)
  })

  it('la cantidad de trabajo del tramo conserva su fórmula con constantes (no se pierde el cómo)', () => {
    const limpia = d.tramos[0]?.conceptos[0]
    expect(limpia?.trabajo.valor).not.toBeNull()
    expect(limpia?.trabajo.formula ?? limpia?.trabajo.origen).toBeTruthy()
  })

  it('3DN: necesidad anual = cantidad × frecuencia e importe = PU × necesidad, con enlace a DIAG-01', () => {
    const des = d.necesidades.find((n) => n.concepto === 'Desazolve' && n.bloque.startsWith('RED DE DISTRIBU'))
    expect(des).toBeDefined()
    expect(des?.cantidadTrabajo.formula).toMatch(/DIAG-01/)
    expect(des?.enlaceDiagnostico).toEqual({ columna: 'I', fila: 15 })
    expect(Number(des?.cantidadTrabajo.valor)).toBeCloseTo(468505.36, 2)
    expect(des?.necesidadAnual.formula).toBe('E32*F32')
    expect(Number(des?.necesidadAnual.valor)).toBeCloseTo(117126.34, 2)
    expect(Number(des?.importe.valor)).toBeCloseTo(5825864.1516, 3)
    // la etiqueta del libro dice "Ev./Mes" pero la cifra es anual: se conserva tal cual, el motor (DYP-006) la juzga
    expect(des?.etiquetaFrecuencia).toBe('Ev./Mes')
  })

  it('las sumas de bloque de 3DN incluyen el total del libro (J63 = 17,026,794.74)', () => {
    expect(d.totalGeneral3dn?.ref).toBe('3DN!J63')
    expect(Number(d.totalGeneral3dn?.valor)).toBeCloseTo(17026794.74, 1)
    const suma = d.sumasBloque.reduce((a, s) => a + Number(s.importe.valor ?? 0), 0)
    expect(suma).toBeCloseTo(Number(d.totalGeneral3dn?.valor), 1)
  })

  it('SEG-3: renglones con clave de catálogo, localización y cantidad con su fórmula', () => {
    expect(d.programa.length).toBeGreaterThan(80)
    const r = d.programa.find((x) => x.fila === 25)
    expect(r?.clave).toBe('7-2.03.1.01')
    expect(r?.localizacion).toBe('K-0+000 AL K-2+000')
    expect(Number(r?.cantidad.valor)).toBeCloseTo(0.48, 6)
    expect(r?.cantidad.formula).toBe('1.2*2000/10000*2')
    expect(r?.red).toBe('distribucion')
    expect(r?.encabezado).toMatch(/LIMPIA Y DESHIERBE/)
  })

  it('una celda vacía nunca se vuelve cero', () => {
    const vacios = d.necesidades.filter((n) => n.pu.valor === null)
    for (const n of vacios) expect(n.pu.origen).toBe('vacio')
  })
})
