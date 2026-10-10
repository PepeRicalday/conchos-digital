/**
 * Programa de obra (SEG-3) como lista plana: concepto canónico, tramo de DIAG-01 y concepto de 3DN ligados a cada renglón, filtro y paginación.
 * Cuentas sobre el PacOT real de la SRL (solo lectura): 96 renglones; la fila 25 es «K-0+000 AL K-2+000» del canal principal.
 */
import { describe, expect, it } from 'vitest'
import { extremosDeLocalizacion, filtrarPrograma, paginar, vistaPrograma } from '../derivacion/programaVista'
import { hayEvidencias, libroSrl } from './ayuda/libroSrl'

describe('programa · localización', () => {
  it('lee el rango con o sin la segunda K y con espacios', () => {
    expect(extremosDeLocalizacion('K-0+000 AL K-2+000')).toEqual(['0+000', '2+000'])
    expect(extremosDeLocalizacion('K-12+000 AL-14+000')).toEqual(['12+000', '14+000'])
    expect(extremosDeLocalizacion('k-6 + 000 al k-7+500')).toEqual(['6+000', '7+500'])
    expect(extremosDeLocalizacion('toda la obra')).toBeNull()
  })
})

describe('programa · paginación', () => {
  const xs = Array.from({ length: 96 }, (_, i) => i)
  it('96 renglones en páginas de 25: 4 páginas, la última con 21', () => {
    expect(paginar(xs, 1, 25)).toMatchObject({ paginas: 4, desde: 1, hasta: 25 })
    const ult = paginar(xs, 4, 25)
    expect(ult.items).toHaveLength(21)
    expect(ult).toMatchObject({ pagina: 4, desde: 76, hasta: 96 })
  })
  it('acota la página fuera de rango y maneja la lista vacía', () => {
    expect(paginar(xs, 99, 25).pagina).toBe(4)
    expect(paginar(xs, -3, 25).pagina).toBe(1)
    expect(paginar([], 1, 25)).toMatchObject({ paginas: 1, desde: 0, hasta: 0, items: [] })
  })
})

describe.skipIf(!hayEvidencias)('programa · PacOT de la SRL', () => {
  const { libro } = hayEvidencias ? libroSrl() : { libro: null as never }
  const vista = hayEvidencias ? vistaPrograma(libro) : []
  it('trae los 96 renglones, ninguno se pierde', () => { expect(vista).toHaveLength(96) })
  it('el título largo del programa se reduce al concepto canónico', () => {
    const f25 = vista.find((v) => v.r.fila === 25)!
    expect(f25.concepto).toBe('Limpia y deshierbe')
    expect(f25.familia).toBe('limpia')
    expect(f25.rotuloLibro).toMatch(/LIMPIA Y DESHIERBE/)
  })
  it('la fila 25 se liga al tramo K-0+000 → K-2+000 de DIAG-01 y a un concepto de 3DN', () => {
    const f25 = vista.find((v) => v.r.fila === 25)!
    const tramo = libro.tramos.find((t) => t.fila === f25.tramoFila)
    expect(tramo?.pkInicial).toBe('0+000')
    expect(tramo?.pkFinal).toBe('2+000')
    expect(f25.indiceConcepto).not.toBeNull()
    expect(f25.necesidad).not.toBeNull()
  })
  it('todos los renglones con tramo ligado apuntan a un tramo de la misma obra', () => {
    for (const v of vista) {
      if (v.tramoFila === null) continue
      const t = libro.tramos.find((x) => x.fila === v.tramoFila)
      expect(t?.obra.trim().toLowerCase()).toBe(v.r.obra.trim().toLowerCase())
    }
  })
  it('filtra por concepto, por obra y por texto sin acentos', () => {
    const conceptos = [...new Set(vista.map((v) => v.concepto))]
    const uno = filtrarPrograma(vista, { concepto: conceptos[0]!, obra: '', texto: '' })
    expect(uno.every((v) => v.concepto === conceptos[0])).toBe(true)
    expect(filtrarPrograma(vista, { concepto: '', obra: '', texto: 'K-2+000 AL K-4+000' }).length).toBeGreaterThanOrEqual(1)
    expect(filtrarPrograma(vista, { concepto: '', obra: '', texto: 'zzz-no-existe' })).toHaveLength(0)
    expect(filtrarPrograma(vista, { concepto: '', obra: '', texto: '' })).toHaveLength(96)
  })
})
