/**
 * Obras puntuales (T-02/T-03, modelo `por-pieza`). Cuentas hechas a mano sobre el PacOT real de la SRL (solo lectura) y, si se indica
 * CONCHOS_M05_EVIDENCIAS, sobre el del Módulo 5. Una pieza no tiene veredicto de criterio: se reconstruye desde el inventario, se compara
 * contra 3DN y se comprueba la aritmética propia del libro. Las compuertas NUNCA se reparten entre las estructuras.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizarDataJson, VistaLibro } from '../nucleo'
import { extraerLibro } from '../derivacion/extraer'
import type { LibroDerivado } from '../derivacion/tipos'
import { CONCEPTOS, CONCEPTOS_PIEZA, conceptoPiezaDe } from '../derivacion/conceptos'
import { confiabilidadEstructuras } from '../derivacion/estructuras'
import { bloquesNoAplica, comprobarObrasPuntuales, opcionesDeGrupo, vistaDeGrupo, type ComprobacionPieza } from '../verificacion/porPieza'
import { comprobarTramo } from '../verificacion/comprobacion'
import { atipicosDelLibro, atipicosPorPieza } from '../verificacion/revision'
import { verificarLibro } from '../verificacion/verificar'
import { htmlInfografiaPiezaConcepto, htmlInfografiaPiezaGrupo } from '../../utils/infografiaPieza'
import { construirDatosConcepto } from '../../utils/infografiaComprobacion'
import { htmlInfografiaConcepto } from '../../utils/infografiaComprobacionHtml'
import { hayEvidencias, libroSrl } from './ayuda/libroSrl'

const PROHIBIDAS = ['NaN', 'undefined', 'null', 'correcto', 'aprobado', 'conforme', 'válido', 'Infinity', '[object Object]']
const textoVisible = (html: string): string => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
const ctx = { fecha: '2026-10-10', logo: '', ambito: 'SRL', red: 'Obras puntuales (estructuras y edificios)', canal: null }
const cargar = (dir: string): LibroDerivado => extraerLibro(new VistaLibro(normalizarDataJson(JSON.parse(readFileSync(path.join(dir, 'data.json'), 'utf8')) as unknown, { sha256: 'r', extractor: 'x' })))
const por = (l: LibroDerivado, fila: number): ComprobacionPieza => comprobarObrasPuntuales(l).find((c) => c.fila === fila)!
const grupo = (c: ComprobacionPieza, id: string) => c.grupos.find((g) => g.id === id)!

describe('registro de conceptos de pieza', () => {
  it('es aditivo: no entra en CONCEPTOS (la resolución por red/familia no cambia) y reconoce los bloques de 3DN', () => {
    expect(CONCEPTOS.some((c) => c.modelos.includes('por-pieza'))).toBe(false)
    expect(new Set(CONCEPTOS_PIEZA.map((c) => c.id)).size).toBe(CONCEPTOS_PIEZA.length)
    expect(conceptoPiezaDe('ESTRUCTURAS', 'Reparación Obra Civil')?.kind).toBe('obra-civil')
    expect(conceptoPiezaDe('ESTRUCTURAS', 'Reparación compuertas y mecanismos')?.kind).toBe('compuertas')
    expect(conceptoPiezaDe('EDIFICIOS', 'Reparación mantenimiento')).toMatchObject({ kind: 'edificios', dibujo: 'ficha-edificio' })
    expect(conceptoPiezaDe('ESTRUCTURAS', 'Reparación Obra Civil')).toMatchObject({ dibujo: 'ficha-estructura', modelos: ['por-pieza'], obras: ['estructura'] })
    expect(conceptoPiezaDe('RED DE DISTRIBUCION', 'Desazolve')).toBeUndefined()
    expect(conceptoPiezaDe('POZOS', 'Reparación Obra Civil')?.kind).toBe('otras-obras')
  })
})

describe.skipIf(!hayEvidencias)('SRL · obras puntuales (cuentas a mano)', () => {
  const l = hayEvidencias ? libroSrl().libro : ({} as LibroDerivado)
  const todas = hayEvidencias ? comprobarObrasPuntuales(l) : []

  it('solo los conceptos con cantidad: obra civil (54), compuertas (55), edificios (58) y comunicaciones (61); presas, pozos y plantas son «no aplica»', () => {
    expect(todas.map((c) => c.fila)).toEqual([54, 55, 58, 61])
    expect(bloquesNoAplica(l).sort()).toEqual(['Plantas de bombeo', 'Pozos', 'Presas almacenamiento', 'Presas derivadoras'])
  })

  it('obra civil: 385 reconstruido desde IO4 = 385 del libro → coherente, diferencia 0, fuente IO4', () => {
    const c = por(l, 54)
    expect(c).toMatchObject({ reconstruida: '385', trabajo: '385', diferencia: '0', estadoCantidad: 'cuadra', estado: 'cuadra', modelo: 'por-pieza', dibujo: 'ficha-estructura', unidad: 'pza' })
    expect(c.fuenteReconstruccion).toContain('IO4')
    expect(c.vinculoExterno).toBe('<<external>>!E79:E79')
    expect(c.controles.find((k) => k.id === 'pieza-vinculo-externo')?.estado).toBe('informativo')
  })

  it('aritmética del libro, fila 54: 385 × 0.05 = 19.25 (385 ÷ 20) y 19.25 × 8500 = 163 625 (19 × 8500 + 0.25 × 8500); P.U. = 163 625 ÷ 19.25 = 8500', () => {
    const c = por(l, 54)
    expect(385 * 0.05).toBeCloseTo(19.25, 9)
    expect(19.25 * 8500).toBeCloseTo(161500 + 2125, 6)
    expect(163625 / 19.25).toBeCloseTo(8500, 9)
    expect(c.cuentas.find((x) => x.id === 'necesidad')).toMatchObject({ resultado: '19.25', enLibro: '19.25', estado: 'cuadra' })
    expect(c.cuentas.find((x) => x.id === 'importe')).toMatchObject({ resultado: '163625', enLibro: '163625', estado: 'cuadra' })
    expect(c.pu).toBe('8500')
    expect(c.controles.filter((k) => k.base === 'integridad' && k.estado === 'atipico')).toHaveLength(0)
  })

  it('compuertas, fila 55: 0.70 × 385 = 269.5 coherente aritmético, pero no_evaluable por estructura (proporción declarada)', () => {
    const c = por(l, 55)
    expect(0.7 * 385).toBeCloseTo(269.5, 9)
    expect(c.proporcion).toMatchObject({ valor: '0.7', porcentaje: '70', redonda: true, base: '385', producto: '269.5', enLibro: '269.5' })
    expect(c.controles.find((k) => k.id === 'pieza-proporcion')?.estado).toBe('cuadra')
    expect(c).toMatchObject({ reconstruida: null, estadoCantidad: 'no_evaluable', estado: 'no_evaluable' })
    expect(c.motivo).toContain('no reconstruible por estructura')
    expect(c.motivo).toContain('IO4 no dice cuáles estructuras tienen compuerta')
    // E × F = 269.5 × 0.05 = 13.475 y × 20 500 = 276 237.5 (13 × 20 500 + 0.475 × 20 500).
    expect(269.5 * 0.05).toBeCloseTo(13.475, 9)
    expect(13.475 * 20500).toBeCloseTo(266500 + 9737.5, 6)
    expect(c.cuentas.find((x) => x.id === 'necesidad')).toMatchObject({ resultado: '13.475', estado: 'cuadra' })
    expect(c.cuentas.find((x) => x.id === 'importe')).toMatchObject({ resultado: '276237.5', estado: 'cuadra' })
  })

  it('compuertas: nunca se reparten por estructura ni por familia (sin grupos seleccionables, sin parte proporcional)', () => {
    const c = por(l, 55)
    expect(c.gruposSeleccionables).toBe(false)
    expect(opcionesDeGrupo(c).map((o) => o.id)).toEqual(['todo'])
    for (const g of c.grupos) expect(Object.keys(g).some((k) => /compuerta/i.test(k))).toBe(false)
    const html = textoVisible(htmlInfografiaPiezaConcepto(c, ctx))
    expect(html).toContain('no reconstruible por estructura')
    expect(html).toContain('no se reparten')
  })

  it('edificios, fila 58: 6 de IO7 = 6 del libro → coherente; 6 × 0.25 = 1.5 y 1.5 × 50 000 = 75 000; 6 fichas (1 oficina, 1 taller, 4 casetas)', () => {
    const c = por(l, 58)
    expect(c).toMatchObject({ reconstruida: '6', trabajo: '6', estadoCantidad: 'cuadra', estado: 'cuadra', dibujo: 'ficha-edificio' })
    expect(c.cuentas.find((x) => x.id === 'necesidad')).toMatchObject({ resultado: '1.5', estado: 'cuadra' })
    expect(c.cuentas.find((x) => x.id === 'importe')).toMatchObject({ resultado: '75000', estado: 'cuadra' })
    expect(c.grupos).toHaveLength(1)
    expect(c.grupos[0]!.n).toBe(6)
    expect(Object.fromEntries(c.grupos[0]!.porTipo.map((t) => [t.nombre, t.n]))).toEqual({ Caseta: 4, Oficinas: 1, Taller: 1 })
    expect(c.grupos[0]!.piezas.map((p) => p.inventario)).toEqual(['O1-SRL', 'CM1-SRL', 'C1-SRL', 'C2-SRL', 'C3-SRL', 'C4-SRL'])
    expect(c.grupos[0]!.piezas[0]).toMatchObject({ areaPredioM2: 2500, lat: 28.197586111 })
  })

  it('comunicaciones, fila 61: sin hoja de inventario → no_evaluable con motivo; 7 × 1 = 7 y 7 × 1500 = 10 500', () => {
    const c = por(l, 61)
    expect(c).toMatchObject({ reconstruida: null, estado: 'no_evaluable', dibujo: 'ninguno' })
    expect(c.motivo).toContain('no es reconstruible')
    expect(c.cuentas.find((x) => x.id === 'importe')).toMatchObject({ resultado: '10500', estado: 'cuadra' })
  })

  it('desagregación de la obra civil: 149 toma/entrega · 14 control · 42 cruce · 163 protección · 16 medición · 1 sin clasificar = 385; 21 ambiguas marcadas', () => {
    const c = por(l, 54)
    expect(c.grupos.map((g) => [g.id, g.n])).toEqual([['toma_entrega', 149], ['control', 14], ['cruce', 42], ['proteccion', 163], ['medicion', 16], ['ninguna', 1]])
    expect(c.grupos.reduce((s, g) => s + g.n, 0)).toBe(385)
    expect(c.totalPiezas).toBe(385)
    expect(c.grupos.reduce((s, g) => s + g.ambiguas, 0)).toBe(21)
    expect([grupo(c, 'proteccion').ambiguas, grupo(c, 'cruce').ambiguas, grupo(c, 'medicion').ambiguas]).toEqual([19, 1, 1])
    // 145 tomas + 4 tomas de granja = 149; el sin clasificar conserva su nombre crudo.
    expect(Object.fromEntries(grupo(c, 'toma_entrega').porTipo.map((t) => [t.nombre, t.n]))).toEqual({ Toma: 145, 'Toma de granja': 4 })
    expect(grupo(c, 'ninguna').piezas[0]!.nombre).toBe('K-6+550 (AUTOPISTA)')
    expect(c.controles.find((k) => k.id === 'pieza-ambiguas')?.detalle).toContain('21 con nombre ambiguo')
    expect(c.controles.find((k) => k.id === 'pieza-material')?.detalle).toContain('Concreto × 385')
  })

  it('unidad de análisis: una familia da su parte proporcional rotulada como reparto (149 ÷ 385 de 19.25 y de 163 625), nunca como cifra del libro', () => {
    const c = por(l, 54)
    const v = vistaDeGrupo(c, 'fam:toma_entrega')
    expect(v.n).toBe(149)
    expect(v.fraccion).toBeCloseTo(149 / 385, 12)
    expect(Number(v.necesidadProporcional)).toBeCloseTo((19.25 * 149) / 385, 6) // = 7.45
    expect(Number(v.importeProporcional)).toBeCloseTo((163625 * 149) / 385, 4) // = 63 325
    expect(vistaDeGrupo(c, 'tipo:Toma').n).toBe(145)
    expect(vistaDeGrupo(c, 'todo').n).toBe(385)
    const html = textoVisible(htmlInfografiaPiezaGrupo(c, 'fam:toma_entrega', ctx))
    expect(html).toContain('reparto proporcional')
  })

  it('la SRL no tiene red de drenaje: sin drenes en el inventario y sin criterios de drenaje; el bloque no suma nada', () => {
    const v = verificarLibro(l)
    expect(l.fichas.drenes).toHaveLength(0)
    expect(v.criterios.some((c) => c.red === 'drenaje')).toBe(false)
    expect(Number(l.sumasBloque.find((b) => /DRENAJE/i.test(b.bloque))?.importe.valor)).toBe(0)
  })

  it('Centro de revisión: la SRL no genera ningún atípico de obras puntuales (nada coincide por azar con una diferencia)', () => {
    expect(atipicosPorPieza(l, 'SRL')).toEqual([])
  })

  it('una diferencia real SÍ aparece: libro sintético con 400 en la cantidad de obra civil (385 en IO4) → atípico por conciliación; 15 de más', () => {
    const toca = { ...l, necesidades: l.necesidades.map((n) => (n.fila === 54 ? { ...n, cantidadTrabajo: { ...n.cantidadTrabajo, valor: '400' } } : n)) }
    const c = por(toca, 54)
    expect(c).toMatchObject({ reconstruida: '385', trabajo: '400', diferencia: '15', estadoCantidad: 'atipico', estado: 'atipico' })
    const a = atipicosPorPieza(toca, 'SRL')
    expect(a.map((x) => x.fila)).toContain(54)
    expect(a.find((x) => x.fila === 54)!.razones.some((r) => r.razon === 'conciliacion' && r.enLibro === '400' && r.referencia === '385')).toBe(true)
    // La aritmética E × F = H también salta: 400 × 0.05 = 20, no 19.25.
    expect(c.cuentas.find((x) => x.id === 'necesidad')).toMatchObject({ resultado: '20', enLibro: '19.25', estado: 'atipico' })
  })

  it('una cuenta del libro que no cuadra (H = 2 en vez de 1.5) marca el concepto aunque la cantidad coincida', () => {
    const toca = { ...l, necesidades: l.necesidades.map((n) => (n.fila === 58 ? { ...n, necesidadAnual: { ...n.necesidadAnual, valor: '2' } } : n)) }
    const c = por(toca, 58)
    expect(c.estadoCantidad).toBe('cuadra')
    expect(c.estado).toBe('atipico')
    expect(c.controles.find((k) => k.id === 'pieza-necesidad-anual')).toMatchObject({ estado: 'atipico', cifras: { observado: '2', referencia: '1.5' } })
  })

  it('sin cordura de cifras no se reconstruye: con IO4 recortada a 10 filas el concepto es no_evaluable (S/D), no una diferencia inventada', () => {
    const corto = { ...l, fichas: { ...l.fichas, estructuras: l.fichas.estructuras!.slice(0, 10) } }
    const c = por(corto, 54)
    expect(c.reconstruida).toBeNull()
    expect(c.estado).toBe('no_evaluable')
    expect(c.motivo).toContain('Cifra no verificada')
    expect(c.grupos).toHaveLength(0)
  })

  it('infografías: ninguna palabra prohibida y todas las cifras clave presentes (obra civil, compuertas, edificios, familia)', () => {
    const vistas = [54, 55, 58, 61].map((f) => htmlInfografiaPiezaConcepto(por(l, f), ctx))
    vistas.push(htmlInfografiaPiezaGrupo(por(l, 54), 'fam:proteccion', ctx), htmlInfografiaPiezaGrupo(por(l, 58), 'todo', ctx))
    for (const h of vistas) {
      const t = textoVisible(h)
      for (const p of PROHIBIDAS) expect(t, p).not.toContain(p)
      expect(h).not.toMatch(/<script|@import|url\(http/i)
    }
    const obra = textoVisible(vistas[0]!)
    for (const x of ['385', '19.25', '163,625', '149', 'Toma y entrega', '21 con nombre ambiguo', '19 de tipo ambiguo', 'Coherente con el inventario']) expect(obra, x).toContain(x)
    const edif = textoVisible(vistas[2]!)
    for (const x of ['O1-SRL', 'CM1-SRL', 'C4-SRL', 'OFICINAS', 'CENTRAL DE MAQUINARIA', '2,500', '28°11\'51.31"N']) expect(edif, x).toContain(x)
  })
})

const carpetaM5 = process.env.CONCHOS_M05_EVIDENCIAS
describe.skipIf(!carpetaM5 || !existsSync(path.join(carpetaM5, 'data.json')))('Módulo 5 · obras puntuales y drenes', () => {
  const l = carpetaM5 ? cargar(carpetaM5) : ({} as LibroDerivado)

  it('confiabilidad de las estructuras: confiable (1 715), así que NO se muestra como cifra dudosa', () => {
    expect(confiabilidadEstructuras(l)).toMatchObject({ confiable: true, estructuras: 1715, edificios: 6 })
    const obra = por(l, 54)
    expect(obra.reconstruida).toBe('1715')
    expect(obra.motivo ?? '').not.toContain('no verificada')
  })

  it('edificios: 6 de IO7 = 6 del libro → coherente', () => {
    expect(por(l, 58)).toMatchObject({ reconstruida: '6', trabajo: '6', estadoCantidad: 'cuadra', estado: 'cuadra' })
  })

  it('obra civil: el libro trae 2 002 y IO4 lista 1 715 → atípico (candidato a revisión) con 287 de más; aritmética 2 002 × 0.05 = 100.1 y × 2 500 = 250 250', () => {
    const c = por(l, 54)
    expect(c).toMatchObject({ reconstruida: '1715', trabajo: '2002', diferencia: '287', estadoCantidad: 'atipico', estado: 'atipico' })
    expect(c.cuentas.find((x) => x.id === 'necesidad')).toMatchObject({ resultado: '100.1', estado: 'cuadra' })
    expect(c.cuentas.find((x) => x.id === 'importe')).toMatchObject({ resultado: '250250', estado: 'cuadra' })
    expect(c.grupos.reduce((s, g) => s + g.n, 0)).toBe(1715)
    expect(grupo(c, 'ninguna').n).toBe(429)
  })

  it('compuertas: 800.8 = 0.4 × 2 002; proporción declarada, no reconstruible por estructura (M5 usa 40 %, no el 70 % de la SRL)', () => {
    expect(0.4 * 2002).toBeCloseTo(800.8, 9)
    const c = por(l, 55)
    expect(c.proporcion).toMatchObject({ porcentaje: '40', producto: '800.8' })
    expect(c.estado).toBe('no_evaluable')
  })

  it('pozos: 3DN trae 5 en la cantidad y 14 en la necesidad anual (5 × 1 ≠ 14) → atípico por la aritmética propia del libro', () => {
    const c = por(l, 22)
    expect(c.cuentas.find((x) => x.id === 'necesidad')).toMatchObject({ resultado: '5', enLibro: '14', estado: 'atipico' })
    expect(c.estado).toBe('atipico')
    expect(c.estadoCantidad).toBe('no_evaluable')
  })

  it('Centro de revisión: aparecen la obra civil (conciliación) y los pozos (aritmética); no las compuertas ni los edificios', () => {
    const filas = atipicosPorPieza(l, 'M5').map((a) => a.fila).sort((a, b) => a - b)
    expect(filas).toContain(54)
    expect(filas).toContain(22)
    expect(filas).not.toContain(55)
    expect(filas).not.toContain(58)
  })

  it('drenes: fila 208 (L 13.6 km, b 5 m, z 1.5): terracerías 2000 × 13.6 = 27 200 m³ y acuáticas 0.1 × 5 × 13.6 = 6.8 ha, ahora con su dibujo de sección', () => {
    expect(2000 * 13.6).toBeCloseTo(27200, 6)
    expect(0.1 * 5 * 13.6).toBeCloseTo(6.8, 9)
    const v = verificarLibro(l)
    const idx = (re: RegExp) => v.criterios.find((c) => c.red === 'drenaje' && re.test(c.concepto))!.indiceConcepto
    const ter = comprobarTramo(l, v.criterios, v.uniones, 208, idx(/TERRACER/))!
    expect(ter).toMatchObject({ recalculado: '27200', enLibro: '27200', estado: 'cuadra', unidad: 'm³' })
    expect(ter.diagrama).toMatchObject({ modo: 'terracerias', b: 5, z: 1.5 })
    const acu = comprobarTramo(l, v.criterios, v.uniones, 208, idx(/ACUATICA/))!
    expect(acu).toMatchObject({ recalculado: '6.8', enLibro: '6.8', estado: 'cuadra' })
    expect(acu.diagrama?.modo).toBe('acuaticas')
    const des = comprobarTramo(l, v.criterios, v.uniones, 208, idx(/DESAZOLVE/))!
    expect(des.diagrama?.modo).toBe('desazolve')
    const lim = comprobarTramo(l, v.criterios, v.uniones, 208, idx(/LIMPIA/))!
    expect(lim.diagrama).toMatchObject({ modo: 'limpia', rotulo: 'equivalente' })
    expect(lim.diagrama!.anchoFranja).toBeGreaterThan(0)
  })

  it('infografía de concepto de un dren: dice «Recorrido del dren», sin «canal» ni palabras prohibidas', () => {
    const v = verificarLibro(l)
    const crit = v.criterios.find((c) => c.red === 'drenaje' && /TERRACER/.test(c.concepto))!
    const filas = Object.keys(crit.porTramo).map(Number).map((f) => comprobarTramo(l, v.criterios, v.uniones, f, crit.indiceConcepto)).filter((c): c is NonNullable<typeof c> => c !== null)
    const html = htmlInfografiaConcepto(construirDatosConcepto(filas, crit, { ambito: 'M5', red: 'Red de drenaje (drenes)', canal: null }), { ...ctx, ambito: 'M5', red: 'Red de drenaje (drenes)' })
    const t = textoVisible(html)
    expect(t).toContain('Recorrido del dren')
    expect(t).not.toContain('Recorrido del canal')
    for (const p of PROHIBIDAS) expect(t, p).not.toContain(p)
  })

  it('los atípicos por tramo de M5 siguen siendo los mismos de antes (los de pieza van aparte)', () => {
    const lista = atipicosDelLibro(l, 'M5')
    expect(lista.every((t) => t.destino === null || typeof t.destino.fila === 'number')).toBe(true)
  })
})
