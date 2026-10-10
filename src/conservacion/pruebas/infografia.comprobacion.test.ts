/**
 * Infografías de «Comprobación por tramo»: el HTML nunca imprime NaN/undefined/null, no dice «correcto»/«aprobado»,
 * escapa el texto libre y muestra S/D cuando falta un dato. Datos de ejemplo + (si existe) el PacOT real de la SRL.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizarDataJson, VistaLibro } from '../nucleo'
import { extraerLibro } from '../derivacion/extraer'
import { comprobarTramo, type Comprobacion } from '../verificacion/comprobacion'
import type { CriterioInferido } from '../verificacion/criterio'
import { verificarLibro } from '../verificacion/verificar'
import { construirDatosConcepto, nombreArchivoConcepto, nombreArchivoTramo, slug } from '../../utils/infografiaComprobacion'
import { htmlInfografiaConcepto, htmlInfografiaTramo } from '../../utils/infografiaComprobacionHtml'
import { seccionCanalSvg, PALETA_INFOGRAFIA } from '../../components/conservacion/derivacion/seccionCanalSvg'

const PROHIBIDAS = ['NaN', 'undefined', 'null', 'correcto', 'aprobado', 'conforme', 'válido', 'Infinity', '[object Object]']
const ctx = { fecha: '2026-10-09', logo: '', ambito: 'SRL', red: 'Red de distribución (canales)' }
const textoVisible = (html: string): string => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')

const base: Comprobacion = {
  fila: 55, red: 'distribucion', inventario: 'INV-001', obra: 'Canal <Principal> & ramal', pkInicial: 'K-1+000', pkFinal: 'K-2+500', longitudKm: 1.5,
  concepto: 'DESAZOLVE', familia: 'desazolve', unidad: 'm³', modelo: 'x' as never, grupo: 'todos', criterio: 'A × L < 5 & B',
  entradas: [
    { etiqueta: 'Plantilla <b>', valor: '13.3', unidad: 'm', origen: 'inventario', ref: 'IO1!F12' },
    { etiqueta: 'Espesor', valor: '0.4', unidad: 'm', origen: 'parametro_libre', ref: null },
    { etiqueta: 'Longitud', valor: '1500', unidad: 'm', origen: 'diagnostico', ref: 'DIAG-01!H55' },
  ],
  pasos: [],
  ecuacion: [
    { origen: 'diagnostico', valor: '1500', unidad: 'm', etiqueta: 'longitud' }, { origen: 'operador', simbolo: '×' },
    { origen: 'parametro_libre', valor: '0.4', unidad: 'm', etiqueta: 'espesor' }, { origen: 'operador', simbolo: '×' },
    { origen: 'constante', valor: '2', etiqueta: 'taludes' },
  ],
  recalculado: '11400', enLibro: '12000', diferencia: '600', estadoCriterio: 'atipico', estado: 'atipico',
  parametroLibre: { nombre: 'Espesor de azolve', valor: '0.4', unidad: 'm', implicito: '0.42' },
  diagrama: { modo: 'desazolve', b: 13.3, z: 1.75, d: 3.2, lb: 0.6, revestido: false, anchoFranja: null, h: 0.42, rotulo: null },
  controles: [{ id: 'c1', estado: 'atipico', base: 'criterio_libro', titulo: 'Control <1> & más', detalle: 'Detalle largo & con <etiquetas>.' }],
  refs: [],
}

describe('infografía de un tramo', () => {
  it('escapa < y & del texto libre y no deja HTML inyectado', () => {
    const h = htmlInfografiaTramo(base, ctx)
    expect(h).toContain('Canal &lt;Principal&gt; &amp; ramal')
    expect(h).toContain('Control &lt;1&gt; &amp; más')
    expect(h).not.toContain('<Principal>')
    expect(h).not.toContain('<b>Plantilla')
    expect(h).toContain('A × L &lt; 5 &amp; B')
  })
  it('no contiene palabras ni valores prohibidos', () => {
    const t = textoVisible(htmlInfografiaTramo(base, ctx))
    for (const p of PROHIBIDAS) expect(t, p).not.toContain(p)
  })
  it('un tramo atípico con valor implícito lo dice y pide confirmar con quien armó el PacOT', () => {
    const t = textoVisible(htmlInfografiaTramo(base, ctx))
    expect(t).toContain('El libro implica espesor de azolve de')
    expect(t).toContain('Conviene confirmarlo con quien armó el PacOT')
    expect(t).toContain('Esto no es una verificación normativa')
  })
  it('sin valor implícito no lo inventa: S/D', () => {
    const c: Comprobacion = { ...base, parametroLibre: { nombre: 'Espesor de azolve', valor: '0.4', unidad: 'm', implicito: null } }
    const t = textoVisible(htmlInfografiaTramo(c, ctx))
    expect(t).toContain('valor implícito de espesor de azolve es S/D')
  })
  it('faltan cifras y datos: S/D, nunca 0 ni NaN', () => {
    const c: Comprobacion = { ...base, recalculado: null, enLibro: null, diferencia: null, ecuacion: [], diagrama: null, estado: 'no_evaluable', estadoCriterio: 'no_evaluable' }
    const t = textoVisible(htmlInfografiaTramo(c, ctx))
    expect(t).toContain('S/D')
    for (const p of PROHIBIDAS) expect(t, p).not.toContain(p)
    expect(t).not.toMatch(/Cifra en DIAG-01\s+0\b/)
  })
  it('sin dibujo de sección lo declara, y con datos incompletos del inventario también', () => {
    expect(textoVisible(htmlInfografiaTramo({ ...base, diagrama: null }, ctx))).toContain('no hay dibujo de sección')
    const falta = { ...base, diagrama: { ...base.diagrama!, b: null } }
    expect(textoVisible(htmlInfografiaTramo(falta, ctx))).toContain('no se puede dibujar')
  })
  it('un tramo que cuadra no lleva la frase de confirmación ni el aviso de atípico', () => {
    const c: Comprobacion = { ...base, estado: 'cuadra', estadoCriterio: 'cuadra', enLibro: '11400', diferencia: '0', controles: [] }
    const t = textoVisible(htmlInfografiaTramo(c, ctx))
    expect(t).not.toContain('Conviene confirmarlo')
    expect(t).toContain('Sigue el criterio del libro')
  })
  it('el SVG con paleta de la infografía no usa variables CSS', () => {
    const svg = seccionCanalSvg(base.diagrama!, PALETA_INFOGRAFIA)
    expect(svg).not.toBeNull()
    expect(svg).not.toContain('var(')
    expect(seccionCanalSvg({ ...base.diagrama!, d: null }, PALETA_INFOGRAFIA)).toBeNull()
  })
  it('nombres de archivo', () => {
    expect(nombreArchivoTramo(55, '2026-10-09')).toBe('comprobacion-tramo-fila55-2026-10-09.png')
    expect(nombreArchivoConcepto('Limpia y deshierbe (col. 8)', '2026-10-09')).toBe('comprobacion-concepto-limpia-y-deshierbe-col-8-2026-10-09.png')
    expect(slug('###')).toBe('concepto')
  })
})

describe('infografía de un concepto', () => {
  const crit = {
    red: 'distribucion', concepto: 'DESAZOLVE (col. 9)', nombre: 'DESAZOLVE', agrupacion: 'ninguna', total: 10, siguen: 7, sinDatos: 2, indiceConcepto: 1, porTramo: {},
    grupos: [{ clave: 'todos', n: 10, modelo: 'x', formula: 'L × 2 < 3 & 4 (m³)', coeficientes: {}, siguen: 7 }],
  } as unknown as CriterioInferido
  const mk = (n: number): Comprobacion => ({ ...base, fila: n, estado: 'atipico', estadoCriterio: 'atipico', obra: `Obra ${n} & <x>` })

  it('tope de 8 atípicos y «+K más en la app»', () => {
    const filas = Array.from({ length: 11 }, (_, i) => mk(i + 1))
    const d = construirDatosConcepto(filas, crit, ctx)
    expect(d.atipicos).toHaveLength(8)
    expect(d.masAtipicos).toBe(3)
    const h = htmlInfografiaConcepto(d, ctx)
    expect(textoVisible(h)).toContain('+3 más en la app')
    expect(textoVisible(h)).toMatch(/7 +de 10 tramos siguen el criterio del libro/)
    expect(h).toContain('Obra 1 &amp; &lt;x&gt;')
    expect(h).toContain('L × 2 &lt; 3 &amp; 4 (m³)')
  })
  it('sin atípicos, sin lista; sin tramos, S/D', () => {
    const d = construirDatosConcepto([], { ...crit, total: 0, siguen: 0, sinDatos: 0 }, ctx)
    const t = textoVisible(htmlInfografiaConcepto(d, ctx))
    expect(t).toContain('S/D')
    expect(t).not.toContain('Tramos atípicos')
    for (const p of PROHIBIDAS) expect(t, p).not.toContain(p)
  })
  it('implícito null en la lista de atípicos: S/D, no inventa', () => {
    const c = { ...mk(3), parametroLibre: { nombre: 'Espesor', valor: '0.4', unidad: 'm', implicito: null } }
    const t = textoVisible(htmlInfografiaConcepto(construirDatosConcepto([c], crit, ctx), ctx))
    expect(t).toMatch(/valor implícito\s+S\/D/)
    for (const p of PROHIBIDAS) expect(t, p).not.toContain(p)
  })
})

const carpetaSrl = process.env.CONCHOS_EVIDENCIAS ?? path.resolve(process.cwd(), '../Conservacion/Skill/ejemplo_Conchos/evidencias/lector_xls')
describe.skipIf(!existsSync(path.join(carpetaSrl, 'data.json')))('PacOT real de la SRL: todas las infografías salen limpias', () => {
  const l = extraerLibro(new VistaLibro(normalizarDataJson(JSON.parse(readFileSync(path.join(carpetaSrl, 'data.json'), 'utf8')) as unknown, { sha256: 'r', extractor: 'x' })))
  const v = verificarLibro(l)
  it('cada tramo de cada concepto y cada resumen de concepto', () => {
    let n = 0
    for (const crit of v.criterios) {
      const filas = Object.keys(crit.porTramo).map(Number).sort((a, b) => a - b)
        .map((f) => comprobarTramo(l, v.criterios, v.uniones, f, crit.indiceConcepto)).filter((c): c is Comprobacion => c !== null)
      for (const c of filas) {
        const t = textoVisible(htmlInfografiaTramo(c, ctx))
        for (const p of PROHIBIDAS) expect(t, `${crit.concepto} fila ${c.fila}: ${p}`).not.toContain(p)
        n++
      }
      const tc = textoVisible(htmlInfografiaConcepto(construirDatosConcepto(filas, crit, ctx), ctx))
      for (const p of PROHIBIDAS) expect(tc, `${crit.concepto}: ${p}`).not.toContain(p)
    }
    expect(n).toBeGreaterThan(50)
  })
})
