/**
 * Catálogo de estructuras: una prueba por regla de clasificación, precedencias, familias y símbolos.
 */
import { describe, expect, it } from 'vitest'
import {
  clasificar, COLUMNA_IO1, COLUMNAS_IO1, FAMILIAS, IDS_REGLAS_CLASIFICACION, INFO_TIPO, normalizarNombre, simboloSvg, TABLA_IO4_IO1, TIPOS_ESTRUCTURA, TIPOS_IO1,
} from '../estructuras/catalogo'
import type { FamiliaId, TipoEstructura } from '../estructuras/catalogo'
import { hayEvidencias, libroSrl } from './ayuda/libroSrl'

/** regla → [nombre de IO4/IO7, tipo, familia, subtipo, ambiguo]. Debe haber una fila por cada regla del catálogo. */
const POR_REGLA: Record<string, [string, TipoEstructura, FamiliaId, string | null, boolean]> = {
  entrada_agua: ['ENTRADA DE AGUA VADO ', 'entrada_agua', 'proteccion', 'VADO', false],
  desfogue: ['DESFOGUE', 'desfogue', 'proteccion', null, false],
  estacion_aforo: ['PUENTE DE AFOROS ', 'estacion_aforo', 'medicion', 'PUENTE DE AFOROS', false],
  toma_granja: ['TOMA GRANJA', 'toma_granja', 'toma_entrega', null, false],
  toma: ['TOMA DIRECTA ', 'toma', 'toma_entrega', 'DIRECTA', false],
  caja_repartidora: ['CAJA REPARTIDORA', 'caja_repartidora', 'toma_entrega', null, false],
  represa: ['REPRESA         ', 'represa', 'control', null, false],
  puente_vehiculos: ['PUENTE VEHÍCULOS ', 'puente_vehiculos', 'cruce', null, false],
  puente_peatones: ['PUENTE PEATONES', 'puente_peatones', 'cruce', null, false],
  puente_canal: ['PUENTE CANAL', 'puente_canal', 'cruce', null, false],
  paso_superior: ['PASO SUPERIOR', 'paso_superior', 'cruce', null, false],
  paso_inferior: ['PASO INFERIOR', 'paso_inferior', 'cruce', null, false],
  sifon: ['SIFÓN', 'sifon', 'cruce', null, false],
  alcantarilla: ['ALCANTARILLA', 'alcantarilla', 'cruce', null, false],
  caida: ['CAÍDA', 'caida', 'proteccion', null, false],
  rapida: ['RÁPIDA', 'rapida', 'proteccion', null, false],
  muro_retencion: ['MURO DE RETENCIÓN', 'muro_retencion', 'proteccion', 'DE RETENCION', false],
  edificio: ['CASETA ', 'edificio', 'edificacion', 'CASETA', false],
}

describe('clasificar · una prueba por regla', () => {
  it('cada regla del catálogo tiene su caso (y no sobra ninguno)', () => {
    expect([...IDS_REGLAS_CLASIFICACION].sort()).toEqual(Object.keys(POR_REGLA).sort())
  })
  for (const [regla, [nombre, tipo, familia, subtipo, ambiguo]] of Object.entries(POR_REGLA)) {
    it(`${regla}: «${nombre.trim()}» → ${tipo} / ${familia}`, () => {
      expect(clasificar(nombre)).toEqual({ tipo, familia, subtipo, ambiguo, regla })
    })
  }
})

describe('clasificar · precedencia y variantes', () => {
  it('«DESFOGUE TIPO SIFÓN» es desfogue (no sifón) y conserva el subtipo; «DESFOGUE AUTOMÁTICO» también', () => {
    expect(clasificar('DESFOGUE TIPO SIFÓN')).toMatchObject({ tipo: 'desfogue', subtipo: 'TIPO SIFON', ambiguo: false })
    expect(clasificar('DESFOGUE AUTOMÁTICO')).toMatchObject({ tipo: 'desfogue', subtipo: 'AUTOMATICO' })
  })
  it('«PUENTE DE AFOROS», «PUENTE AFORO» y «CASETA DE AFORO» son medición: gana AFORO sobre puente y sobre caseta', () => {
    expect(clasificar('PUENTE DE AFOROS')).toMatchObject({ tipo: 'estacion_aforo', familia: 'medicion' })
    expect(clasificar('PUENTE AFORO ')).toMatchObject({ tipo: 'estacion_aforo' })
    expect(clasificar('CASETA DE AFORO')).toMatchObject({ tipo: 'estacion_aforo', familia: 'medicion' })
    expect(clasificar('CANASTILLA AFORADORA ')).toMatchObject({ tipo: 'estacion_aforo' })
    expect(clasificar('CASETA')).toMatchObject({ tipo: 'edificio' })
  })
  it('«PIE DE AFORO» (probable errata de «PUENTE DE AFORO») se clasifica por AFORO pero queda ambiguo', () => {
    expect(clasificar('PIE DE AFORO')).toMatchObject({ tipo: 'estacion_aforo', ambiguo: true })
  })
  it('«ENTRADA DE AGUA PUENTE» es entrada de agua (no puente) y queda ambiguo con el subtipo crudo', () => {
    expect(clasificar('ENTRADA DE AGUA PUENTE')).toMatchObject({ tipo: 'entrada_agua', familia: 'proteccion', subtipo: 'PUENTE', ambiguo: true })
  })
  it('«ENTRADA DE AGUA»: vado solo (o vado en margen) no es ambiguo; tubos, comp., tubos comp., puente y sin dato sí', () => {
    expect(clasificar('ENTRADA DE AGUA VADO').ambiguo).toBe(false)
    expect(clasificar('ENTRADA DE AGUA VADO M.D.').ambiguo).toBe(false)
    for (const s of ['TUBOS', 'TUBO', 'COMP.', 'TUBOS COMP.', 'PUENTE']) {
      expect(clasificar(`ENTRADA DE AGUA ${s}`), s).toMatchObject({ tipo: 'entrada_agua', subtipo: s, ambiguo: true })
    }
    expect(clasificar('ENTRADA DE AGUA')).toMatchObject({ tipo: 'entrada_agua', subtipo: null, ambiguo: true })
  })
  it('toma: directa, lateral (con la referencia entre paréntesis ignorada), «OBRA DE TOMA», «TOMA CANAL AUXILIAR», «TOMA DIRECTA-BOMBEO»', () => {
    expect(clasificar('TOMA LATERAL (LK-72+600, M-3)')).toMatchObject({ tipo: 'toma', subtipo: 'LATERAL' })
    expect(clasificar('OBRA DE TOMA')).toMatchObject({ tipo: 'toma', subtipo: 'OBRA DE TOMA' })
    expect(clasificar('TOMA CANAL AUXILIAR')).toMatchObject({ tipo: 'toma', subtipo: 'CANAL AUXILIAR' })
    expect(clasificar('TOMA DIRECTA-BOMBEO ')).toMatchObject({ tipo: 'toma', subtipo: 'DIRECTA-BOMBEO' })
    expect(clasificar('TOMA GRANJA')).toMatchObject({ tipo: 'toma_granja' })
  })
  it('«SIFÓN K» queda ambiguo (la «K» sin más dato); «SIFÓN» solo no', () => {
    expect(clasificar('SIFÓN K')).toMatchObject({ tipo: 'sifon', subtipo: 'K', ambiguo: true })
    expect(clasificar('SIFON')).toMatchObject({ tipo: 'sifon', ambiguo: false })
  })
  it('un nombre que es un cadenamiento («K-6+550 (AUTOPISTA)») o algo desconocido es «sin clasificar», nunca adivinado', () => {
    for (const n of ['K-6+550 (AUTOPISTA)', 'VERTEDOR', 'ESTRUCTURA RARA', '']) {
      const r = clasificar(n)
      expect(r, n).toMatchObject({ tipo: 'otro', familia: null, ambiguo: false, regla: 'sin_clasificar' })
    }
    expect(clasificar(null).tipo).toBe('otro')
    expect(clasificar(undefined).tipo).toBe('otro')
  })
  it('normalizarNombre: sin acentos, mayúsculas, espacios colapsados y sin el paréntesis final', () => {
    expect(normalizarNombre('  Puente   Vehículos  (km 5) ')).toBe('PUENTE VEHICULOS')
  })
})

describe.skipIf(!hayEvidencias)('SRL Unidad Conchos · las 385 estructuras de IO4', () => {
  const { libro: l } = hayEvidencias ? libroSrl() : ({} as ReturnType<typeof libroSrl>)
  const E = l?.fichas.estructuras ?? []

  it('100 % con familia o «sin clasificar», y los «sin clasificar» son ≤ 3 (hoy 1: la fila 36)', () => {
    const sin = E.filter((e) => e.tipo === 'otro')
    expect(sin.length).toBeLessThanOrEqual(3)
    expect(sin.map((e) => e.fila)).toEqual([36])
    expect(E.every((e) => e.familia !== null || e.tipo === 'otro')).toBe(true)
    expect(E.filter((e) => e.familia !== null)).toHaveLength(384)
  })
  it('conteo por familia: toma 149 · control 14 · cruce 42 · protección 163 · medición 16', () => {
    const n = (f: FamiliaId) => E.filter((e) => e.familia === f).length
    // toma_entrega = 149 tomas ; control = 14 represas ; cruce = 11 + 6 + 6 + 19 = 42 ;
    // protección = 150 entradas de agua + 13 desfogues = 163 ; medición = 16 aforos ; 149 + 14 + 42 + 163 + 16 = 384
    expect([n('toma_entrega'), n('control'), n('cruce'), n('proteccion'), n('medicion'), n('edificacion')]).toEqual([149, 14, 42, 163, 16, 0])
  })
  it('21 ambiguas: 19 entradas de agua (tubos, comp., puente, sin dato), «SIFÓN K» y «PIE DE AFORO»', () => {
    const amb = E.filter((e) => e.ambiguo)
    expect(amb).toHaveLength(21)
    expect(amb.filter((e) => e.tipo === 'entrada_agua')).toHaveLength(19)
    expect(amb.map((e) => e.tipo).sort()).toContain('sifon')
    expect(amb.map((e) => e.tipo).sort()).toContain('estacion_aforo')
  })
  it('el tipo crudo se conserva tal cual para que nada se reclasifique en silencio', () => {
    expect(E.filter((e) => e.tipoCrudo.startsWith('ENTRADA DE AGUA')).map((e) => e.tipoCrudo).includes('ENTRADA DE AGUA TUBOS COMP.')).toBe(true)
    expect(new Set(E.map((e) => e.tipoCrudo)).size).toBeGreaterThan(25)
  })
  it('los 6 edificios de IO7 se clasifican como edificación', () => {
    const b = l.fichas.edificios ?? []
    expect(b.map((x) => clasificar(x.nombre).tipo)).toEqual(['edificio', 'edificio', 'edificio', 'edificio', 'edificio', 'edificio'])
  })
})

describe('familias, columnas de IO1 y tabla IO4→IO1', () => {
  it('seis familias con seis formas distintas, orden 0..5 y colores distintos', () => {
    expect(FAMILIAS).toHaveLength(6)
    expect(new Set(FAMILIAS.map((f) => f.forma)).size).toBe(6)
    expect(FAMILIAS.map((f) => f.orden)).toEqual([0, 1, 2, 3, 4, 5])
    expect(new Set(FAMILIAS.map((f) => f.color)).size).toBe(6)
    expect(FAMILIAS.map((f) => f.forma)).toEqual(['triangulo_abajo', 'rombo', 'cuadrado', 'circulo', 'hexagono', 'cuadrado_base'])
    for (const f of FAMILIAS) { expect(f.nombre.length).toBeGreaterThan(3); expect(f.descripcion.length).toBeGreaterThan(20) }
  })
  it('sin rojo ni ámbar: el matiz (HSL) de cada color no cae en 0-50° ni en 340-360° (salvo neutros de saturación < 15 %)', () => {
    for (const f of FAMILIAS) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(f.color.slice(i, i + 2), 16) / 255) as [number, number, number]
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
      const sat = d === 0 ? 0 : d / (1 - Math.abs(max + min - 1))
      if (sat < 0.15) continue
      let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
      h = (h * 60 + 360) % 360
      expect(h > 50 && h < 340, `${f.id} ${f.color} matiz ${h.toFixed(0)}°`).toBe(true)
    }
  })
  it('COLUMNA_IO1: W..AM (17 columnas contiguas) ↔ 17 tipos, y cada tipo de IO1 sabe su columna', () => {
    expect(COLUMNAS_IO1).toEqual(['W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK', 'AL', 'AM'])
    expect(COLUMNA_IO1.W).toBe('estacion_aforo')
    expect(COLUMNA_IO1.Z).toBe('toma_granja')
    expect(COLUMNA_IO1.AE).toBe('entrada_agua')
    expect(COLUMNA_IO1.AM).toBe('puente_peatones')
    for (const t of TIPOS_IO1) expect(COLUMNA_IO1[INFO_TIPO[t].columnaIO1 as string]).toBe(t)
    expect(TIPOS_ESTRUCTURA).toHaveLength(19)
  })
  it('todo tipo con familia aparece en FAMILIAS; «otro» no tiene', () => {
    for (const t of TIPOS_ESTRUCTURA) {
      const f = INFO_TIPO[t].familia
      expect(f === null ? t === 'otro' : FAMILIAS.some((x) => x.id === f), t).toBe(true)
    }
  })
  it('TABLA_IO4_IO1: 17 columnas de IO1 en 16 grupos (las tomas Y+Z juntas)', () => {
    expect(TABLA_IO4_IO1).toHaveLength(16)
    expect(TABLA_IO4_IO1.find((g) => g.id === 'toma_y_granja')).toMatchObject({ columnasIO1: ['Y', 'Z'], tiposIO4: ['toma', 'toma_granja'] })
  })
})

describe('simboloSvg · cadena SVG 24 × 24', () => {
  it('una forma distinta por familia, viewBox 24 y color de la familia por defecto', () => {
    const formas = new Set<string>()
    for (const f of FAMILIAS) {
      const s = simboloSvg(f.id)
      expect(s).toMatch(/^<svg [^>]*viewBox="0 0 24 24"/)
      expect(s).toContain(`stroke="${f.color}"`)
      expect(s).toContain('aria-hidden="true"')
      expect(s).not.toMatch(/<script|onload|javascript:/i)
      formas.add(s.replace(/stroke="[^"]*"/, ''))
    }
    expect(formas.size).toBe(6)
  })
  it('triángulo hacia abajo (toma), rombo (control), hexágono (medición) y cuadrado con base (edificación) se distinguen por su geometría', () => {
    expect(simboloSvg('toma_entrega')).toContain('<polygon points="12,21 3,5 21,5"/>')
    expect(simboloSvg('control')).toContain('<polygon points="12,2 22,12 12,22 2,12"/>')
    expect(simboloSvg('cruce')).toContain('<rect x="4" y="4" width="16" height="16"/>')
    expect(simboloSvg('proteccion')).toContain('<circle cx="12" cy="12" r="9"/>')
    expect(simboloSvg('medicion').match(/,/g)).toHaveLength(6)
    expect(simboloSvg('edificacion').match(/<rect/g)).toHaveLength(2)
  })
  it('colores y tamaño inyectados; contorno punteado = ubicación estimada; título accesible', () => {
    const s = simboloSvg('cruce', { tamano: 32, contorno: 'currentColor', relleno: '#eeeeee', punteado: true, titulo: 'Puente <1> & "2"', grosor: 2 })
    expect(s).toContain('width="32"')
    expect(s).toContain('stroke="currentColor"')
    expect(s).toContain('fill="#eeeeee"')
    expect(s).toContain('stroke-dasharray')
    expect(s).toContain('stroke-width="2"')
    expect(s).toContain('<title>Puente &lt;1&gt; &amp; &quot;2&quot;</title>')
    expect(s).toContain('role="img"')
    expect(s).not.toContain('aria-hidden')
  })
  it('un color con código inyectado se descarta y se usa el de la familia; un tamaño absurdo vuelve a 24', () => {
    const s = simboloSvg('control', { contorno: '"><script>alert(1)</script>', relleno: 'url(javascript:x)', tamano: -5 })
    expect(s).not.toContain('<script')
    expect(s).not.toContain('javascript')
    expect(s).toContain('width="24"')
    expect(s).toContain('stroke="#7c3aed"')
  })
})
