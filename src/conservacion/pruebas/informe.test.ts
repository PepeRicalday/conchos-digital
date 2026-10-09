import { describe, expect, it } from 'vitest'
import { leerInforme } from '../informe/esquemaInforme'
import { informeDePrueba } from './ayuda/informeDePrueba'
import {
  filasReglas, filtrarHallazgos, hallazgosPlanos, nombreSeguroArchivo, partirReferencia, resumenReglas, SIN_FILTROS, totalPendientes,
} from '../informe/vistas'

describe('leerInforme', () => {
  it('acepta un informe válido', () => {
    const r = leerInforme(informeDePrueba())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.archivo.origen.moduloId).toBe('MOD-001')
  })

  it('rechaza JSON roto, archivos de otro formato y estructuras incompletas con un mensaje claro', () => {
    expect(leerInforme('{no es json')).toEqual({ ok: false, error: 'El archivo no es un JSON válido.' })
    const otro = leerInforme(JSON.stringify({ hola: 1 }))
    expect(otro.ok).toBe(false)
    if (!otro.ok) expect(otro.error).toContain('conservacion:analizar')
    const roto = JSON.parse(informeDePrueba()) as { informe: { resultados: unknown } }
    roto.informe.resultados = 'no es una lista'
    const r = leerInforme(JSON.stringify(roto))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('informe.resultados')
  })

  it('rechaza una severidad inventada: la interfaz no pinta valores que el motor no emite', () => {
    const x = JSON.parse(informeDePrueba()) as { informe: { resultados: Array<{ hallazgos: Array<{ severidad: string }> }> } }
    const h = x.informe.resultados[0]?.hallazgos[0]
    if (h) h.severidad = 'critica'
    expect(leerInforme(JSON.stringify(x)).ok).toBe(false)
  })

  it('rechaza un archivo desproporcionado sin intentar interpretarlo', () => {
    expect(leerInforme(' '.repeat(21 * 1024 * 1024)).ok).toBe(false)
  })
})

describe('vistas del informe', () => {
  const lectura = leerInforme(informeDePrueba())
  if (!lectura.ok) throw new Error(lectura.error)
  const a = lectura.archivo

  it('ordena los hallazgos por severidad y les asigna la clase de su regla', () => {
    const hs = hallazgosPlanos(a)
    expect(hs.map((h) => h.severidad)).toEqual(['alta', 'media'])
    expect(hs[0]?.clase).toBe('INVENTARIO')
  })

  it('filtra por severidad, origen y texto sin distinguir acentos ni mayúsculas', () => {
    const hs = hallazgosPlanos(a)
    expect(filtrarHallazgos(hs, { ...SIN_FILTROS, severidades: new Set(['media']) })).toHaveLength(1)
    expect(filtrarHallazgos(hs, { ...SIN_FILTROS, texto: 'DIFERENCIA' })).toHaveLength(1)
    expect(filtrarHallazgos(hs, { ...SIN_FILTROS, origen: 'norma' })).toHaveLength(0)
    expect(filtrarHallazgos(hs, { ...SIN_FILTROS, texto: 'io1!b2' })).toHaveLength(2)
  })

  it('una regla de la matriz sin resultado es "no implementada", nunca "superada"', () => {
    const filas = filasReglas(a)
    const estado = (id: string) => filas.find((f) => f.id === id)?.estado
    expect(estado('INV-001')).toBe('hallazgo')
    expect(estado('MAQ-003')).toBe('superada')
    expect(estado('DYP-014')).toBe('sin_datos')
    expect(estado('MAQ-009')).toBe('no_implementada')
    expect(filas.find((f) => f.id === 'MAQ-009')?.cobertura).toBeNull()
  })

  it('resume la cobertura con las reglas no implementadas a la vista', () => {
    expect(resumenReglas(filasReglas(a))).toEqual({ total: 4, implementadas: 3, conHallazgos: 1, sinHallazgos: 1, sinDatos: 1, noImplementadas: 1 })
    expect(totalPendientes(a)).toBe(1)
  })

  it('parte referencias hoja!celda aunque la hoja lleve guion o signo de exclamación en el nombre', () => {
    expect(partirReferencia('PO-2!E43')).toEqual({ hoja: 'PO-2', celda: 'E43' })
    expect(partirReferencia('sin_separador')).toBeNull()
    expect(partirReferencia('!A1')).toBeNull()
  })

  it('el nombre de archivo de salida es seguro', () => {
    expect(nombreSeguroArchivo(a)).toBe('informe-conservacion-mod-001-2026-10-09')
  })
})
