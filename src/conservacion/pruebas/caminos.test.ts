/**
 * Caminos (T-01) y registro de conceptos (T-02). Cuentas hechas a mano sobre el PacOT real de la SRL (solo lectura) y, si se
 * indica CONCHOS_M05_EVIDENCIAS, sobre el del Módulo 5. Un camino NO se marca atípico por comparar un grupo de un tramo:
 * o hay un modelo declarado en el registro respaldado por ≥2 tramos, o el grupo es «no evaluable» con su motivo.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizarDataJson, VistaLibro } from '../nucleo'
import { extraerLibro } from '../derivacion/extraer'
import type { LibroDerivado } from '../derivacion/tipos'
import { CONCEPTOS, conceptoDeCamino, familia, modelosDe, superficieDe, unidadDefectoDe } from '../derivacion/conceptos'
import { comprobarTramo, type Comprobacion, type DiagramaComp } from '../verificacion/comprobacion'
import { atipicosDelLibro } from '../verificacion/revision'
import { verificarLibro } from '../verificacion/verificar'
import { PALETA_INFOGRAFIA } from '../../components/conservacion/derivacion/seccionCanalSvg'
import { seccionCaminoSvg, vistaCaminoSvg } from '../../components/conservacion/derivacion/seccionCaminoSvg'
import { leyendaSeccion } from '../../components/conservacion/derivacion/seccionLeyenda'
import { construirDatosConcepto } from '../../utils/infografiaComprobacion'
import { htmlInfografiaConcepto, htmlInfografiaTramo } from '../../utils/infografiaComprobacionHtml'
import { carpetaEvidencias, hayEvidencias } from './ayuda/libroSrl'

const PROHIBIDAS = ['NaN', 'undefined', 'null', 'correcto', 'aprobado', 'conforme', 'válido', 'Infinity', '[object Object]']
const textoVisible = (html: string): string => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
const ctx = { fecha: '2026-10-10', logo: '', ambito: 'SRL', red: 'Red de caminos' }
const cargar = (dir: string): LibroDerivado => extraerLibro(new VistaLibro(normalizarDataJson(JSON.parse(readFileSync(path.join(dir, 'data.json'), 'utf8')) as unknown, { sha256: 'r', extractor: 'x' })))

describe('registro de conceptos (puro)', () => {
  it('familia() conserva su comportamiento y el registro no tiene ids repetidos', () => {
    expect(familia('DESAZOLVE')).toBe('desazolve')
    expect(familia('Extracción de plantas acuáticas')).toBe('acuaticas')
    expect(familia('LIMPIA Y DESHIERBE')).toBe('limpia')
    expect(familia('Reposición revestimiento')).toBe('revestimiento')
    expect(familia('DESCOPETE BORDOS')).toBe('descopete')
    expect(familia('Terracerias')).toBe('terracerias')
    expect(familia('Conformación')).toBe('otro')
    expect(new Set(CONCEPTOS.map((c) => c.id)).size).toBe(CONCEPTOS.length)
  })
  it('modelos admisibles: los mismos que el MODELOS_DE de antes', () => {
    expect(modelosDe('limpia', 'distribucion')).toEqual(['k·L', 'limpia·sección'])
    expect(modelosDe('limpia', 'caminos', 'Extracción de plantas terrestres')).toEqual(['k·L'])
    expect(modelosDe('desazolve', 'drenaje')).toEqual(['azolve', 'k·L'])
    expect(modelosDe('revestimiento', 'distribucion')).toEqual(['k·L'])
    expect(modelosDe('revestimiento', 'caminos', 'Reposición revestimiento')).toEqual(['k·ancho·L', 'k·L'])
    expect(modelosDe('acuaticas', 'drenaje')).toEqual(['k·b·L', 'k·L'])
    expect(modelosDe('otro', 'distribucion')).toEqual(['k·L'])
  })
  it('unidades por defecto del Anexo 3 y superficie de IO3', () => {
    expect(unidadDefectoDe('limpia', 'distribucion')).toBe('ha')
    expect(unidadDefectoDe('descopete', 'distribucion')).toBe('m³')
    expect(unidadDefectoDe('otro', 'caminos', 'Conformación')).toBe('km')
    expect(superficieDe('Terracería')).toBe('terraceria')
    expect(superficieDe('Revestido')).toBe('revestido')
    expect(superficieDe(null)).toBe('s/d')
  })
  it('la excepción de agrupación por superficie vive en el registro de caminos, no en los canales', () => {
    expect(conceptoDeCamino('Conformación')?.agrupacion).toMatchObject({ tipo: 'superficie', minTramos: 1 })
    expect(conceptoDeCamino('Terracerias')?.declarado?.unidadSospechosa).toBeUndefined()
    expect(conceptoDeCamino('Terracerias')?.declarado?.candidatos.map((c) => [c.k, c.inferencia])).toEqual([[1, false], [2, false]])
    expect(conceptoDeCamino('Terracerias')?.unidadDefecto).toBe('km')
    expect(conceptoDeCamino('Reposición revestimiento')?.declarado?.candidatos.map((c) => [c.k, c.inferencia])).toEqual([[150, true], [0, false]])
    for (const c of CONCEPTOS.filter((x) => !x.redes.includes('caminos'))) expect(c.agrupacion.tipo).toBe('inferida')
  })
})

describe('cunetas: sección y vista a lo largo del camino (puro)', () => {
  const dc: DiagramaComp = { familia: 'camino', modo: 'camino-cunetas', b: null, z: null, d: null, lb: null, revestido: false, anchoFranja: null, h: null, rotulo: '2 × L', ancho: 4, superficie: 'Terracería', espesor: null, cunetas: 2, longitudKm: 98.951 }
  it('dos cunetas: las dos se dibujan con el color del PacOT y el rótulo dice «2 cunetas (ambos lados)»', () => {
    const svg = seccionCaminoSvg(dc, PALETA_INFOGRAFIA)!
    expect(svg).toContain('2 cunetas (ambos lados)')
    expect(svg.match(new RegExp(`stroke="${PALETA_INFOGRAFIA.pac}" stroke-width="3.5"`, 'g'))).toHaveLength(2)
    expect(svg).not.toContain('sin cuneta')
    expect(svg).not.toContain('var(')
  })
  it('una cuneta: se dibuja un solo lado y el otro dice «sin cuneta»', () => {
    const svg = seccionCaminoSvg({ ...dc, cunetas: 1, rotulo: '1 × L' }, PALETA_INFOGRAFIA)!
    expect(svg).toContain('1 cuneta (un lado)')
    expect(svg.match(new RegExp(`stroke="${PALETA_INFOGRAFIA.pac}" stroke-width="3.5"`, 'g'))).toHaveLength(1)
    expect(svg).toContain('sin cuneta')
  })
  it('vista a lo largo: la longitud de DIAG-01 y una franja por cuneta; sin longitud: null (S/D)', () => {
    const v2 = vistaCaminoSvg(dc, PALETA_INFOGRAFIA)!
    expect(v2).toContain('longitud 98.951 km')
    expect(v2).toContain('cuneta × 2 lados')
    expect(v2).toContain(PALETA_INFOGRAFIA.diag)
    expect(vistaCaminoSvg({ ...dc, cunetas: 1 }, PALETA_INFOGRAFIA)).toContain('cuneta × 1 lado')
    expect(vistaCaminoSvg({ ...dc, longitudKm: null }, PALETA_INFOGRAFIA)).toBeNull()
  })
  it('la leyenda de cunetas dice cuántas y que el libro no rotula el factor', () => {
    const t = leyendaSeccion(dc).map((i) => i.texto).join(' | ')
    expect(t).toContain('dos, una en cada lado del camino (el libro asigna 2 × L)')
    expect(t).toContain('el libro no lo rotula')
  })
})

describe('sección de calzada (puro)', () => {
  const d: DiagramaComp = { familia: 'camino', modo: 'camino-revestimiento', b: null, z: null, d: null, lb: null, revestido: true, anchoFranja: null, h: null, rotulo: '150 m³/(m·km)', ancho: 6, superficie: 'Revestido', espesor: 0.15 }
  it('dibuja el ancho de IO3, el espesor rotulado como inferencia y lo ilustrativo; sin variables CSS en la paleta de la infografía', () => {
    const svg = seccionCaminoSvg(d, PALETA_INFOGRAFIA)!
    expect(svg).toContain('ancho 6.00 m')
    expect(svg).toContain('espesor 0.15 m (inferencia)')
    expect(svg).toContain('ilustrativo')
    expect(svg).not.toContain('var(')
    expect(svg).toContain(PALETA_INFOGRAFIA.inv)
    expect(svg).toContain(PALETA_INFOGRAFIA.pac)
  })
  it('sin reposición no hay carpeta ni espesor; sin ancho: null (S/D)', () => {
    const sin = seccionCaminoSvg({ ...d, espesor: null, superficie: 'Terracería', revestido: false }, PALETA_INFOGRAFIA)!
    expect(sin).not.toContain('inferencia')
    expect(sin).toContain('sin reposición')
    expect(seccionCaminoSvg({ ...d, ancho: null }, PALETA_INFOGRAFIA)).toBeNull()
  })
  it('la leyenda dice que el libro no trae bermas ni cunetas, y el 150 como inferencia', () => {
    const t = leyendaSeccion(d).map((i) => i.texto).join(' | ')
    expect(t).toContain('ilustrativas')
    expect(t).toContain('inferencia')
    const terr = leyendaSeccion({ ...d, espesor: null, superficie: 'Terracería' }).map((i) => i.texto).join(' | ')
    expect(terr).toContain('terracería: no lleva revestimiento')
  })
})

describe.skipIf(!hayEvidencias)('SRL Unidad Conchos · caminos', () => {
  const l = cargar(carpetaEvidencias)
  const v = verificarLibro(l)
  const idx = (re: RegExp) => v.criterios.find((c) => c.red === 'caminos' && re.test(c.concepto))!.indiceConcepto
  const comp = (fila: number, re: RegExp): Comprobacion => comprobarTramo(l, v.criterios, v.uniones, fila, idx(re))!

  it('fila 98 (camino principal, revestido 6 m, 98.951 km): 150 × 6 × 98.951 = 89 055.9 m³; el 150 se rotula inferencia', () => {
    const c = comp(98, /Reposici/)
    expect(c).toMatchObject({ recalculado: '89055.9', enLibro: '89055.9', diferencia: '0', estado: 'cuadra', grupo: 'Revestido', criterio: '150 × ancho × L', declarado: true, inferencia: true, unidad: 'm³' })
    expect(c.ecuacion.filter((t) => t.origen !== 'operador').map((t) => [t.origen, t.valor])).toEqual([['parametro_libre', '150'], ['inventario', '6'], ['diagnostico', '98.951']])
    expect(c.controles.map((k) => k.id)).toContain('camino-constante-inferida')
    expect(c.controles.find((k) => k.id === 'camino-constante-inferida')?.estado).toBe('informativo')
    expect(c.diagrama).toMatchObject({ familia: 'camino', modo: 'camino-revestimiento', ancho: 6, superficie: 'Revestido', espesor: 0.15 })
  })
  it('fila 102 (camino del auxiliar K-68+582, 5.5 m, 2.28 km): 150 × 5.5 × 2.28 = 1 881 m³', () => {
    expect(comp(102, /Reposici/)).toMatchObject({ recalculado: '1881', enLibro: '1881', estado: 'cuadra', grupo: 'Revestido' })
  })
  it('fila 100 (terracería, 4 m): 0 × 4 × 98.951 = 0, coherente, con la nota «terracería: no lleva revestimiento»', () => {
    const c = comp(100, /Reposici/)
    expect(c).toMatchObject({ recalculado: '0', enLibro: '0', estado: 'cuadra', grupo: 'Terracería', criterio: '0 × ancho × L' })
    expect(c.controles.map((k) => k.titulo)).toContain('terracería: no lleva revestimiento')
    expect(c.diagrama).toMatchObject({ ancho: 4, superficie: 'Terracería', espesor: null })
    expect(c.inferencia).toBeUndefined()
  })
  it('conformación y rastreo: 1 × L en los dos tramos revestidos (98.951 y 2.28 km); la terracería (un tramo, cifra 0) es no evaluable por muestra insuficiente', () => {
    for (const re of [/Conformaci/, /Rastreo/]) {
      expect(comp(98, re)).toMatchObject({ recalculado: '98.951', enLibro: '98.951', estado: 'cuadra', unidad: 'km', criterio: '1 × L' })
      expect(comp(102, re)).toMatchObject({ recalculado: '2.28', enLibro: '2.28', estado: 'cuadra' })
      const t = comp(100, re)
      expect(t).toMatchObject({ estado: 'no_evaluable', estadoCriterio: 'no_evaluable', recalculado: null, enLibro: '0', grupo: 'Terracería' })
      expect(t.motivo).toMatch(/^Muestra insuficiente: un solo tramo/)
    }
  })
  it('conservación de cunetas (la «Terracerías» de 3DN en caminos): 1 × 98.951 = 98.951 km, 2 × 98.951 = 197.902 km, 1 × 2.28 = 2.28 km; en km, no en m³', () => {
    expect(1 * 98.951).toBeCloseTo(98.951, 9)
    expect(2 * 98.951).toBeCloseTo(197.902, 9)
    const c98 = comp(98, /Terracer/), c100 = comp(100, /Terracer/), c102 = comp(102, /Terracer/)
    expect(c98).toMatchObject({ recalculado: '98.951', enLibro: '98.951', diferencia: '0', estado: 'cuadra', unidad: 'km', grupo: 'Revestido', criterio: '1 × L', descripcion: 'Revestido · 6 m' })
    expect(c100).toMatchObject({ recalculado: '197.902', enLibro: '197.902', diferencia: '0', estado: 'cuadra', unidad: 'km', grupo: 'Terracería', criterio: '2 × L', descripcion: 'Terracería · 4 m' })
    expect(c102).toMatchObject({ recalculado: '2.28', enLibro: '2.28', estado: 'cuadra', unidad: 'km', grupo: 'Revestido', descripcion: 'Revestido · 5.5 m' })
    expect(c98.diagrama).toMatchObject({ modo: 'camino-cunetas', cunetas: 1, longitudKm: 98.951 })
    expect(c100.diagrama).toMatchObject({ modo: 'camino-cunetas', cunetas: 2, ancho: 4 })
    expect(c100.parametroLibre).toMatchObject({ nombre: 'Cunetas por camino', valor: '2', unidad: 'cunetas' })
    expect(c100.ecuacion.filter((t) => t.origen !== 'operador').map((t) => t.valor)).toEqual(['2', '98.951'])
    expect(c100.lectura).toEqual(['El camino mide 98.951 km y lleva dos cunetas (una en cada lado del camino).', '2 × 98.951 km = 197.902 km de cuneta.'])
    expect(c98.lectura?.[0]).toBe('El camino mide 98.951 km y lleva una cuneta (un solo lado del camino).')
    const u = c100.controles.find((k) => k.id === 'cunetas-unidad-3dn')!
    expect(u.estado).toBe('informativo')
    expect(u.detalle).toContain('«M3»')
    expect(u.detalle).toContain('2056.72')
  })
  it('un camino con el mismo nombre y cadenamiento se distingue por superficie y ancho (filas 98 y 100)', () => {
    const d98 = comp(98, /Conformaci/).descripcion, d100 = comp(100, /Conformaci/).descripcion
    expect(d98).toBe('Revestido · 6 m')
    expect(d100).toBe('Terracería · 4 m')
    expect(comp(98, /Terracer/).pkInicial).toBe(comp(100, /Terracer/).pkInicial)
  })
  it('reposición de revestimiento, fila 98, dicha en palabras: 6 × 98.951 × 1000 = 593 706 m² y 0.15 × 593 706 = 89 055.9 m³', () => {
    expect(6 * 98.951 * 1000).toBeCloseTo(593706, 6)
    expect(0.15 * 593706).toBeCloseTo(89055.9, 6)
    const l98 = comp(98, /Reposici/).lectura!
    expect(l98[0]).toContain('6 × 98.951 × 1000 = 593,706 m²')
    expect(l98[1]).toContain('0.15 m de espesor (inferencia')
    expect(l98[2]).toBe('0.15 m × 593,706 m² = 89,055.9 m³.')
    expect(comp(100, /Reposici/).lectura).toEqual(['El libro no asigna reposición de revestimiento a este tramo (Terracería).'])
  })
  it('ningún atípico de caminos en la verificación ni en el Centro de revisión; los grupos sin modelo quedan no evaluables', () => {
    expect(v.resultados.filter((r) => r.estado === 'atipico' && r.red === 'caminos')).toHaveLength(0)
    const lista = atipicosDelLibro(l, 'SRL', v)
    expect(lista.filter((t) => t.red === 'caminos')).toHaveLength(0)
    expect(v.resultados.filter((r) => r.red === 'caminos' && r.estado === 'no_evaluable').length).toBeGreaterThan(0)
  })
  it('lo demás NO cambia: 9 atípicos de desazolve (filas 55-57, 70, 71, 73-76), fila 76 con 1 437.8 esperado y 609.7 observado, 21 descopetes que exceden', () => {
    const lista = atipicosDelLibro(l, 'SRL', v)
    const crit = lista.flatMap((t) => t.razones.map((r) => ({ ...r, fila: t.fila }))).filter((r) => r.razon === 'criterio')
    expect(crit.map((r) => r.fila).sort((a, b) => a - b)).toEqual([55, 56, 57, 70, 71, 73, 74, 75, 76])
    expect(crit.every((r) => r.concepto === 'Desazolve')).toBe(true)
    expect(v.resultados.find((r) => r.id === 'CRI-02:76:DESAZOLVE')).toMatchObject({ esperado: '1437.8', observado: '609.7' })
    expect(lista.flatMap((t) => t.razones).filter((r) => r.razon === 'control_adicional')).toHaveLength(21)
    expect(lista).toHaveLength(21)
  })
  it('los 60 tramos de canales siguen igual: limpia 60/60, descopete 4500×L, desazolve 51/60', () => {
    expect(v.criterios.find((c) => c.red === 'distribucion' && /DESCOPETE/.test(c.concepto))?.grupos[0]?.formula).toBe('4500 × L')
    expect(v.criterios.find((c) => c.red === 'distribucion' && /DESAZOLVE/.test(c.concepto))?.siguen).toBe(51)
    expect(v.criterios.find((c) => c.red === 'distribucion' && /LIMPIA/.test(c.concepto))?.siguen).toBe(60)
  })
  it('infografía del tramo: dibujo de calzada, ecuación, nota del 150, sin ubicación ni palabras prohibidas', () => {
    const h = htmlInfografiaTramo(comp(98, /Reposici/), ctx)
    const t = textoVisible(h)
    for (const p of PROHIBIDAS) expect(t, p).not.toContain(p)
    expect(h).toContain('<svg')
    expect(h).not.toContain('<script')
    expect(t).toContain('El 150 es una inferencia; el libro no declara el espesor')
    expect(t).toContain('Dimensiones del camino')
    expect(t).toContain('ancho 6.00 m')
    expect(t).toContain('El libro no trae medidas de bermas ni cunetas')
    expect(t).not.toContain('Dónde está el tramo')
  })
  it('infografía de tramos no evaluables: dice el motivo, sin cifras inventadas', () => {
    for (const re of [/Conformaci/]) {
      const t = textoVisible(htmlInfografiaTramo(comp(100, re), ctx))
      for (const p of PROHIBIDAS) expect(t, p).not.toContain(p)
      expect(t).toMatch(/Muestra insuficiente/)
      expect(t).toContain('S/D')
    }
  })
  it('infografía de cunetas: nombre, cuenta en palabras, vista a lo largo del camino y la unidad en km', () => {
    const c100 = comp(100, /Terracer/)
    const html = htmlInfografiaTramo(c100, ctx)
    const t = textoVisible(html)
    for (const p of PROHIBIDAS) expect(t, p).not.toContain(p)
    expect(t).toContain('Conservación de cunetas')
    expect(t).toContain('Terracería · 4 m')
    expect(t).toContain('En palabras')
    expect(t).toContain('2 × 98.951 km = 197.902 km de cuneta.')
    expect(t).toContain('2 cunetas (ambos lados)')
    expect(t).toContain('longitud 98.951 km')
    expect(t).toContain('197.902')
    expect(t).not.toContain('unidad sospechosa')
    expect(t).not.toMatch(/m³ según el criterio/)
  })
  it('infografía del concepto: «Recorrido del camino», grupos por superficie, la inferencia y el motivo', () => {
    const crit = v.criterios.find((c) => c.red === 'caminos' && /Reposici/.test(c.concepto))!
    const filas = Object.keys(crit.porTramo).map(Number).sort((a, b) => a - b).map((f) => comprobarTramo(l, v.criterios, v.uniones, f, crit.indiceConcepto)!)
    const t = textoVisible(htmlInfografiaConcepto(construirDatosConcepto(filas, crit, ctx), ctx))
    for (const p of PROHIBIDAS) expect(t, p).not.toContain(p)
    expect(t).toContain('Recorrido del camino')
    expect(t).toContain('Revestido')
    expect(t).toContain('Terracería')
    expect(t).toContain('El 150 es una inferencia')
    const critT = v.criterios.find((c) => c.red === 'caminos' && /Terracer/.test(c.concepto))!
    const filasT = Object.keys(critT.porTramo).map(Number).map((f) => comprobarTramo(l, v.criterios, v.uniones, f, critT.indiceConcepto)!)
    const tc = textoVisible(htmlInfografiaConcepto(construirDatosConcepto(filasT, critT, ctx), ctx))
    expect(tc).toContain('Conservación de cunetas')
    expect(tc).toContain('1 × L')
    expect(tc).toContain('2 × L')
  })
  it('todos los tramos de caminos: ninguna infografía imprime palabras prohibidas', () => {
    for (const crit of v.criterios.filter((c) => c.red === 'caminos')) {
      for (const f of Object.keys(crit.porTramo).map(Number)) {
        const t = textoVisible(htmlInfografiaTramo(comprobarTramo(l, v.criterios, v.uniones, f, crit.indiceConcepto)!, ctx))
        for (const p of PROHIBIDAS) expect(t, `${crit.concepto} ${f}: ${p}`).not.toContain(p)
      }
    }
  })
})

const carpetaM5 = process.env.CONCHOS_M05_EVIDENCIAS
describe.skipIf(!carpetaM5 || !existsSync(path.join(carpetaM5, 'data.json')))('Módulo 5 · caminos y drenes', () => {
  const l = carpetaM5 ? cargar(carpetaM5) : ({} as LibroDerivado)
  const v = carpetaM5 ? verificarLibro(l) : ({} as ReturnType<typeof verificarLibro>)
  const idx = (red: 'caminos' | 'drenaje', re: RegExp) => v.criterios.find((c) => c.red === red && re.test(c.concepto))!.indiceConcepto
  const comp = (fila: number, red: 'caminos' | 'drenaje', re: RegExp): Comprobacion => comprobarTramo(l, v.criterios, v.uniones, fila, idx(red, re))!

  it('caminos: reposición 150 × ancho × L en los 27 tramos con datos (21 terracería y 6 revestido); 308: 150 × 5 × 1.2 = 900', () => {
    const c = v.criterios.find((x) => x.red === 'caminos' && /Reposici/.test(x.concepto))!
    expect(c.total).toBe(27)
    expect(c.siguen).toBe(27)
    expect(c.grupos.map((g) => [g.clave, g.n, g.siguen, g.formula]).sort()).toEqual([['Revestido', 6, 6, '150 × ancho × L'], ['Terracería', 21, 21, '150 × ancho × L']])
    expect(comp(308, 'caminos', /Reposici/)).toMatchObject({ recalculado: '900', enLibro: '900', estado: 'cuadra', grupo: 'Terracería', inferencia: true })
  })
  it('caminos: conformación y rastreo 1 × L en 27/27; 310: 1 × 2.5 = 2.5 km; conservación de cunetas 1 × L = 2.5 km (una cuneta)', () => {
    expect(comp(310, 'caminos', /Conformaci/)).toMatchObject({ recalculado: '2.5', enLibro: '2.5', estado: 'cuadra' })
    expect(comp(310, 'caminos', /Rastreo/)).toMatchObject({ recalculado: '2.5', estado: 'cuadra' })
    expect(comp(310, 'caminos', /Terracer/)).toMatchObject({ recalculado: '2.5', enLibro: '2.5', estado: 'cuadra', unidad: 'km', criterio: '1 × L' })
    expect(comp(310, 'caminos', /Terracer/).diagrama).toMatchObject({ modo: 'camino-cunetas', cunetas: 1 })
  })
  it('M5 no tiene el «terracería: no lleva revestimiento» de la SRL: allí la terracería lleva 150 × ancho × L', () => {
    expect(comp(308, 'caminos', /Reposici/).controles.map((k) => k.titulo)).not.toContain('terracería: no lleva revestimiento')
  })
  it('caminos: los únicos atípicos son los 4 de limpia (filas 336-339: 0 en el libro contra 0.4 × L); ninguno falso de conformación, rastreo, terracerías o reposición', () => {
    const lista = atipicosDelLibro(l, 'M5', v).filter((t) => t.red === 'caminos')
    expect(lista.map((t) => t.fila).sort()).toEqual([336, 337, 338, 339])
    expect(lista.every((t) => t.razones.every((r) => r.concepto === 'Limpia y deshierbe'))).toBe(true)
  })
  it('drenes (primeras pruebas): fila 208 (L 13.6 km, b 5 m, z 1.5): terracerías 2000 × 13.6 = 27 200 m³; acuáticas 0.1 × 5 × 13.6 = 6.8 ha; desazolve 1000 × 13.6 × 0.7 × (5 + 1.5 × 0.7) = 57 596 m³', () => {
    expect(comp(208, 'drenaje', /TERRACER/)).toMatchObject({ recalculado: '27200', enLibro: '27200', estado: 'cuadra', unidad: 'm³', criterio: '2000 × L' })
    expect(comp(208, 'drenaje', /ACUATICA/)).toMatchObject({ recalculado: '6.8', enLibro: '6.8', estado: 'cuadra', unidad: 'ha' })
    expect(comp(208, 'drenaje', /DESAZOLVE/)).toMatchObject({ recalculado: '57596', enLibro: '57596', estado: 'cuadra' })
  })
  it('drenes: terracerías 2000 × L en los 91 tramos y ninguno atípico por ese concepto', () => {
    const c = v.criterios.find((x) => x.red === 'drenaje' && /TERRACER/.test(x.concepto))!
    expect(c.grupos[0]).toMatchObject({ formula: '2000 × L', n: 91, siguen: 91 })
    const filas = Object.keys(c.porTramo).map(Number)
    expect(filas.filter((f) => comprobarTramo(l, v.criterios, v.uniones, f, c.indiceConcepto)?.estado === 'atipico')).toHaveLength(0)
  })
})
