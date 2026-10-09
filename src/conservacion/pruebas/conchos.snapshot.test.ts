/**
 * Snapshot con el PacOT 2026-27 de SRL Unidad Conchos (solo lectura).
 * Los datos NO se copian al repositorio: se leen de la carpeta de la auditoría, que existe en el
 * equipo de trabajo (variable CONCHOS_EVIDENCIAS para cambiar la ruta). Si no existe, se omite.
 * Cada aserción reproduce un hallazgo ya documentado en los informes de la auditoría (matriz, sección 7).
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { ejecutar, normalizarDataJson, PARAMETROS_POR_DEFECTO, PERFIL_PACOT_2026_27, VistaLibro } from '../nucleo'
import type { Hallazgo, InformeEjecucion } from '../nucleo'

const carpeta = process.env.CONCHOS_EVIDENCIAS ?? path.resolve(process.cwd(), '../Conservacion/Skill/ejemplo_Conchos/evidencias')
const hay = existsSync(path.join(carpeta, 'data.json')) && existsSync(path.join(carpeta, 'manifest.json'))

describe.skipIf(!hay)('Conchos · reglas implementadas contra datos reales', () => {
  let inf: InformeEjecucion
  const hall = (regla: string): readonly Hallazgo[] => inf.resultados.filter((r) => r.reglaId === regla).flatMap((r) => r.hallazgos)
  const sufijo = (h: Hallazgo): string => h.id.split(':').slice(-1)[0] ?? ''
  const cuenta = (regla: string, suf: string): number => hall(regla).filter((h) => sufijo(h) === suf).length

  beforeAll(() => {
    const crudo: unknown = JSON.parse(readFileSync(path.join(carpeta, 'data.json'), 'utf8'))
    const manifest = JSON.parse(readFileSync(path.join(carpeta, 'manifest.json'), 'utf8')) as { sha256: string }
    const libro = normalizarDataJson(crudo, { sha256: manifest.sha256, extractor: 'data.json (auditoría Conchos)' })
    inf = ejecutar({ libro: new VistaLibro(libro), parametros: PARAMETROS_POR_DEFECTO, perfil: PERFIL_PACOT_2026_27, fechaReferencia: '2026-10-09' })
  })

  it('el libro es el auditado (SHA-256 del .xls) y los valores son caché, no recálculo nativo', () => {
    expect(inf.libroSha256).toBe('5cb52c5a612e6b7c9aba4a019b808e3f3c7fc65d34b927fc40f30cc4c6155097')
    expect(inf.baseValores).toBe('cache')
  })

  it('INV-002 · 385 registros de estructuras, números 242 y 376 compartidos por obras distintas (C-INV-001)', () => {
    const r = inf.resultados.find((x) => x.reglaId === 'INV-002')
    expect(r?.cobertura).toMatchObject({ revisados: 385, identificados: 385 })
    expect(r?.calculos[0]?.salida).toBe('383 distintos')
    expect(hall('INV-002').map((h) => h.id).sort()).toEqual(['INV-002:IO4:id-242', 'INV-002:IO4:id-376'])
    expect(hall('INV-002').every((h) => h.severidad === 'alta')).toBe(true)
  })

  it('INV-003 · 64 tramos revisados; solo IO3 difiere: +0.101 km en los dos márgenes principales (C-INV-002)', () => {
    expect(inf.resultados.find((x) => x.reglaId === 'INV-003')?.cobertura).toMatchObject({ revisados: 64, identificados: 64 })
    const h = hall('INV-003')
    expect(h.map((x) => x.referencias[2])).toEqual(['IO3!I16', 'IO3!I18'])
    for (const x of h) {
      expect(x.esperado).toBe('98.85')
      expect(x.observado).toBe('98.951')
      expect(x.diferencia).toBe('0.101')
    }
  })

  it('DYP-006 · 13 de 13 conceptos con rótulo "Ev./Mes" y salida anual (C-DIA-01)', () => {
    expect(inf.resultados.find((x) => x.reglaId === 'DYP-006')?.cobertura).toMatchObject({ revisados: 13, identificados: 13 })
    expect(cuenta('DYP-006', 'etiqueta_mensual')).toBe(13)
    expect(hall('DYP-006').every((x) => x.origen === 'formato' && x.severidad === 'alta')).toBe(true)
    expect(hall('DYP-006').every((x) => x.dimensiones.condicion_fisica === 'pendiente')).toBe(true)
  })

  it('MAQ-003 · fila 13: 833 capturado por truncado frente a 833.333…; suma exacta 11,419.38 (C-MAQ-15)', () => {
    expect(inf.resultados.find((x) => x.reglaId === 'MAQ-003')?.cobertura).toMatchObject({ revisados: 19, identificados: 19 })
    const f = hall('MAQ-003').find((x) => sufijo(x) === 'truncado')
    expect(f?.referencias).toEqual(['B Maq!I13'])
    expect(f?.observado).toBe('833')
    expect(f?.esperado?.startsWith('833.3333333')).toBe(true)
    const t = hall('MAQ-003').find((x) => sufijo(x) === 'suma_exacta')
    expect(t?.esperado?.startsWith('11419.3836')).toBe(true)
    expect(t?.severidad).toBe('informativa')
  })

  it('MAQ-004/005 · 19 filas con Ht = 1,400 sin Eo; el total J44 es una constante (C-MAQ-11)', () => {
    expect(hall('MAQ-004').map(sufijo)).toEqual(['eo_no_declarada']) // K = I/J exacto en todas las filas
    expect(hall('MAQ-004')[0]?.origen).toBe('norma')
    expect(hall('MAQ-005').map(sufijo)).toEqual(['constante'])
    const j44 = hall('MAQ-005')[0]
    expect(j44?.observado).toBe('11200')
    expect(j44?.esperado).toBe('26600')
    // Ht = 1,400 coincide con el valor por defecto del Manual: no hay hallazgo de base distinta
    expect(hall('MAQ-005').some((x) => x.id.startsWith('MAQ-005:ht:'))).toBe(false)
  })

  it('TRV-001 · 4 errores #VALUE! almacenados en 2PAC; 156 fórmulas sin tratamiento operativo declaradas (C-DYP-P03)', () => {
    expect(hall('TRV-001').map((x) => x.referencias[0]).sort()).toEqual(['2PAC!C102', '2PAC!C106', '2PAC!D102', '2PAC!D106'])
    const r = inf.resultados.find((x) => x.reglaId === 'TRV-001')
    expect(r?.cobertura).toMatchObject({ identificados: 3212, revisados: 3056 })
    expect(r?.pendientes.join(' ')).toMatch(/100 fórmulas ADDIN/)
    expect(r?.pendientes.join(' ')).toMatch(/52 fórmulas con referencia a libros externos/)
  })

  it('TRV-004 · 200 autorreferencias, 39 sumas de texto (36 + 2 + 1) y 36 términos repetidos (C-INV-003, C-DYP-P01/02/07)', () => {
    expect(cuenta('TRV-004', 'autorreferencia')).toBe(200)
    expect(hall('TRV-004').filter((x) => x.id.includes('autorreferencia')).every((x) => x.referencias[0]?.startsWith('IO1a!Z'))).toBe(true)
    const texto = hall('TRV-004').filter((x) => sufijo(x) === 'suma_de_texto')
    expect(texto).toHaveLength(39)
    const porHoja = (hoja: string) => texto.filter((x) => x.referencias[0]?.startsWith(`${hoja}!`)).length
    expect([porHoja('PO-2'), porHoja('PO-2C'), porHoja('2PAC')]).toEqual([36, 2, 1])
    expect(cuenta('TRV-004', 'termino_repetido')).toBe(36)
  })

  it('MAQ-006 · 8 tipos con necesidad: faltante de 1 tractor agrícola con 0.48 que el umbral no justifica; K68 constante (C-MAQ-10)', () => {
    expect(inf.resultados.find((x) => x.reglaId === 'MAQ-006')?.cobertura).toMatchObject({ revisados: 8, identificados: 8 })
    expect(hall('MAQ-006').map((h) => h.id).sort()).toEqual(['MAQ-006:B Maq!D55:faltante', 'MAQ-006:B Maq!E51:sobrante', 'MAQ-006:B Maq!K68:total'])
    const f = hall('MAQ-006').find((h) => sufijo(h) === 'faltante')
    expect([f?.esperado, f?.observado, f?.severidad, f?.origen]).toEqual(['0', '1', 'media', 'pacot'])
    const t = hall('MAQ-006').find((h) => sufijo(h) === 'total')
    expect([t?.esperado, t?.observado, t?.diferencia]).toEqual(['2', '1', '-1'])
    expect(t?.detalle).toContain('constante')
    // El sobrante por conteo (3 existentes frente a 2 requeridas) incluye unidades en mal estado y baja: es informativo y de la norma
    const so = hall('MAQ-006').find((h) => sufijo(h) === 'sobrante')
    expect([so?.severidad, so?.origen]).toEqual(['informativa', 'norma'])
  })

  it('DYP-014, DYP-015 y DYP-018 quedan "sin datos": Conchos no trae APU (Dt_Maq vacío) ni ejecución; no se dan por superadas', () => {
    expect(inf.reglasSinDatos).toEqual(['DYP-014', 'DYP-015', 'DYP-018'])
    expect(inf.resultados.filter((r) => r.estado === 'no_evaluable').every((r) => (r.motivo ?? '').length > 20)).toBe(true)
  })

  it('el informe no declara un "aprobado": resume hallazgos y la cobertura real de reglas (12 de 52)', () => {
    expect(inf.coberturaReglas).toMatchObject({ implementadas: 12, totales: 52, ejecutadas: 12 })
    expect(inf.resumen.hallazgos).toBe(303)
    expect(inf.resumen.alta + inf.resumen.media + inf.resumen.informativa).toBe(303)
  })

  it('es determinista sobre el libro real', () => {
    expect(JSON.stringify(inf).length).toBeGreaterThan(1000)
  })
})
