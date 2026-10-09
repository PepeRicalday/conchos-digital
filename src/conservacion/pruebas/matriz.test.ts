/**
 * Trazabilidad: el núcleo no puede divergir de la especificación. Cada regla implementada existe en
 * la matriz con la misma clase y cada caso de oro citado está definido allí.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REGLAS_PRIMER_CORTE, TOTAL_REGLAS_MATRIZ } from '../nucleo'
import { PARAMETROS_POR_DEFECTO } from '../nucleo/parametros/catalogo'

interface Matriz {
  reglas: Array<{ id: string; clase: string; severidad: string }>
  parametros: Array<{ id: string }>
  casos_prueba: Array<{ id: string }>
}

const copia = path.resolve(__dirname, '../nucleo/especificacion/matriz.json')
const original = path.resolve(process.cwd(), '../Conservacion/Skill/diseno/Matriz_Norma_Regla_Prueba.json')
const matriz = JSON.parse(readFileSync(copia, 'utf8')) as Matriz
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex')

describe('matriz norma → regla → prueba', () => {
  it(`declara ${TOTAL_REGLAS_MATRIZ} reglas`, () => {
    expect(matriz.reglas).toHaveLength(TOTAL_REGLAS_MATRIZ)
  })

  it('cada regla implementada existe en la matriz con la misma clase y severidad base', () => {
    const sev = { alta: 'Alta', media: 'Media', informativa: 'Informativa' } as const
    for (const r of REGLAS_PRIMER_CORTE) {
      const m = matriz.reglas.find((x) => x.id === r.meta.id)
      expect(m, `${r.meta.id} no está en la matriz`).toBeDefined()
      expect(m?.clase).toBe(r.meta.clase)
      expect(m?.severidad, `${r.meta.id}: severidad base`).toBe(sev[r.meta.severidadBase])
    }
  })

  it('los ids de reglas implementadas no se repiten', () => {
    const ids = REGLAS_PRIMER_CORTE.map((r) => r.meta.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('cada caso de oro citado por una regla está definido en la matriz', () => {
    const definidos = new Set(matriz.casos_prueba.map((c) => c.id))
    for (const r of REGLAS_PRIMER_CORTE) for (const tc of r.meta.casosOro) expect(definidos.has(tc), `${r.meta.id} cita ${tc}`).toBe(true)
  })

  it('cada parámetro tipado del catálogo existe en la matriz', () => {
    const ids = new Set(matriz.parametros.map((p) => p.id))
    for (const v of Object.values(PARAMETROS_POR_DEFECTO)) expect(ids.has(v.id), `${v.id} no está en la matriz`).toBe(true)
  })

  it.skipIf(!existsSync(original))('la copia del núcleo es idéntica a la especificación original', () => {
    expect(sha(copia)).toBe(sha(original))
  })
})
