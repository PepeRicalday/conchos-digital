/**
 * Conciliación IO4 ↔ IO1 (INT-15): IO4 lista cada estructura; IO1 las cuenta por tipo y por tramo. Cuentas hechas a mano sobre el
 * PacOT real de la SRL (solo lectura). Es una comprobación de integridad entre dos hojas del propio libro: nunca dice «correcto».
 */
import { describe, expect, it } from 'vitest'
import type { LibroDerivado, Estructura, FichaCanal, PuntoCanal } from '../derivacion/tipos'
import { conciliacionIO4IO1, verificarIntegridad } from '../verificacion/integridad'
import { verificarLibro } from '../verificacion/verificar'
import { TABLA_IO4_IO1, TIPOS_IO1 } from '../estructuras/catalogo'
import { hayEvidencias, libroSrl } from './ayuda/libroSrl'

describe.skipIf(!hayEvidencias)('SRL Unidad Conchos · conciliación IO4 ↔ IO1', () => {
  const { libro: l } = hayEvidencias ? libroSrl() : ({} as ReturnType<typeof libroSrl>)
  const c = hayEvidencias ? conciliacionIO4IO1(l)! : (null as never)
  const grupo = (id: string) => c.porGrupo.find((g) => g.grupo === id)

  it('total: IO4 = 385 filas = IO1!AN15 = Σ de los 60 tramos (calculado, no codificado)', () => {
    expect(c.totalIO4).toBe(385)
    expect(c.totalIO1Declarado).toBe(385)
    expect(c.totalIO1Calculado).toBe(385)
    const v = verificarLibro(l).resultados.find((r) => r.id === 'INT-15:total')
    expect(v).toMatchObject({ base: 'integridad', nivel: 1, estado: 'cuadra', esperado: '385', observado: '385', diferencia: '0' })
  })

  it('por tipo, los que coinciden: aforo 16 (1 canastilla + 8 puentes de aforos + 2 puentes aforo + 4 casetas + 1 pie), desfogue 13 (11 + 1 + 1), sifón 6 (5 + «SIFÓN K»), puente vehículos 19 (18 + 1)', () => {
    expect(grupo('estacion_aforo')).toMatchObject({ io4: 16, io1: 16, diferencia: 0 })
    expect(grupo('desfogue')).toMatchObject({ io4: 13, io1: 13, diferencia: 0 })
    expect(grupo('sifon')).toMatchObject({ io4: 6, io1: 6, diferencia: 0 })
    expect(grupo('puente_vehiculos')).toMatchObject({ io4: 19, io1: 19, diferencia: 0 })
    expect(grupo('paso_superior')).toMatchObject({ io4: 11, io1: 11, diferencia: 0 })
    expect(grupo('paso_inferior')).toMatchObject({ io4: 6, io1: 6, diferencia: 0 })
  })

  it('por tipo, los que difieren: represa +1 (14 contra 13), entrada de agua −2 (150 contra 152), puente canal −1 (0 contra 1), tomas +1 (149 contra 58 + 90 = 148)', () => {
    expect(grupo('represa')).toMatchObject({ io4: 14, io1: 13, diferencia: 1 })
    expect(grupo('entrada_agua')).toMatchObject({ io4: 150, io1: 152, diferencia: -2 })
    expect(grupo('puente_canal')).toMatchObject({ io4: 0, io1: 1, diferencia: -1 })
    // 93 directas + 47 + 2 laterales + 1 obra de toma + 1 toma canal auxiliar + 1 directa-bombeo + 4 granjas = 149
    expect(grupo('toma_y_granja')).toMatchObject({ io4: 149, io1: 148, diferencia: 1 })
  })

  it('el desvío neto cuadra con el «sin clasificar»: +1 −2 −1 +1 = −1 y 1 estructura (el nombre «K-6+550 (AUTOPISTA)») no tiene tipo', () => {
    expect(c.sinClasificar).toBe(1)
    const neto = c.porGrupo.reduce((s, g) => s + g.diferencia, 0)
    expect(neto + c.sinClasificar).toBe(0)
  })

  it('«entrada de agua» conserva su subtipo crudo: 19 de las 150 son ambiguas (tubos, comp., puente o sin dato); las 131 de vado no', () => {
    expect(grupo('entrada_agua')?.ambiguasIO4).toBe(19)
  })

  it('la tabla IO4→IO1 reparte las 17 columnas de IO1 sin repetir ninguna, y solo las tomas se juntan', () => {
    const cols = TABLA_IO4_IO1.flatMap((g) => g.columnasIO1)
    expect(cols).toHaveLength(17)
    expect(new Set(cols).size).toBe(17)
    expect(TABLA_IO4_IO1.flatMap((g) => g.tiposIO4).sort()).toEqual([...TIPOS_IO1].sort())
    expect(TABLA_IO4_IO1.filter((g) => g.columnasIO1.length > 1).map((g) => g.id)).toEqual(['toma_y_granja'])
  })

  it('por tramo: 60 tramos, 29 coherentes y 31 con diferencia; el primero (K-0+000 → K-2+000) trae 6 en IO4 y 6 en IO1', () => {
    expect(c.porTramo).toHaveLength(60)
    expect(c.porTramo.filter((t) => t.diferencia === 0)).toHaveLength(29)
    expect(c.porTramo.filter((t) => t.diferencia !== 0)).toHaveLength(31)
    expect(c.porTramo[0]).toMatchObject({ fila: 16, ramal: 'principal', pkIni: '0+000', pkFin: '2+000', io4: 6, io1: 6, diferencia: 0 })
  })

  it('tramos atípicos con su diferencia: K-9+000→10+000 (+2), K-70+420→70+840 (+3), K-70+000→70+100 (−2: IO4 no tiene ninguna) y el primero del auxiliar (−8)', () => {
    const t = (fila: number) => c.porTramo.find((x) => x.fila === fila)
    expect(t(21)).toMatchObject({ pkIni: '9+000', pkFin: '10+000', io4: 3, io1: 1, diferencia: 2 })
    expect(t(57)).toMatchObject({ pkIni: '70+420', pkFin: '70+840', io4: 6, io1: 3, diferencia: 3 })
    expect(t(55)).toMatchObject({ io4: 0, io1: 2, diferencia: -2 })
    expect(t(74)).toMatchObject({ ramal: 'auxiliar', io4: 5, io1: 13, diferencia: -8 })
  })

  it('cada estructura con PK cae en un solo tramo o queda aparte: 376 en tramos + 2 sin PK + 7 fuera = 385', () => {
    const enTramos = c.porTramo.reduce((s, t) => s + t.io4, 0)
    expect(enTramos).toBe(376)
    expect(c.sinPK.map((e) => e.fila)).toEqual([156, 300])
    // Pasan del final declarado: 6 del principal con PK > 98+951 (99+180 … 99+782) y 398 (2+286) pasa de 2+280 del auxiliar.
    expect(c.fueraDeTramos.map((e) => e.fila)).toEqual([385, 386, 387, 388, 389, 390, 398])
    expect(enTramos + c.sinPK.length + c.fueraDeTramos.length).toBe(c.totalIO4)
    // Las 385 de IO1 repartidas por tramo suman lo mismo que su total.
    expect(c.porTramo.reduce((s, t) => s + t.io1, 0)).toBe(385)
  })

  it('el IO1 del auxiliar declara 15 (13 + 2) y IO4 solo 8: la diferencia se ve por ramal, no se mezcla con el principal', () => {
    const aux = c.porTramo.filter((t) => t.ramal === 'auxiliar')
    expect(aux.map((t) => t.io1)).toEqual([13, 2])
    expect(l.fichas.estructuras?.filter((e) => e.ramal === 'auxiliar')).toHaveLength(8)
  })

  it('los resultados de verificación llevan base «integridad», id estable, y nunca el estado «correcto»', () => {
    const r = verificarLibro(l).resultados.filter((x) => x.id.startsWith('INT-15'))
    expect(r.every((x) => x.base === 'integridad' && x.nivel === 1)).toBe(true)
    expect(r.every((x) => ['cuadra', 'atipico', 'informativo'].includes(x.estado))).toBe(true)
    expect(r.some((x) => /correcto/i.test(`${x.titulo} ${x.detalle}`))).toBe(false)
    expect(r.find((x) => x.id === 'INT-15:tipo:represa')).toMatchObject({ estado: 'atipico', esperado: '13', observado: '14', diferencia: '1' })
    expect(r.find((x) => x.id === 'INT-15:tipo:estacion_aforo')).toMatchObject({ estado: 'cuadra', diferencia: '0' })
    expect(r.filter((x) => x.id.startsWith('INT-15:tramo:'))).toHaveLength(31)
    expect(r.find((x) => x.id === 'INT-15:tramos:resumen')?.recalculo).toHaveLength(60)
    expect(r.find((x) => x.id === 'INT-15:sin-clasificar')?.estado).toBe('informativo')
    expect(r.find((x) => x.id === 'INT-15:sin-asignar')?.estado).toBe('informativo')
    // Ids únicos y estables entre corridas.
    expect(new Set(r.map((x) => x.id)).size).toBe(r.length)
    expect(verificarLibro(l).resultados.filter((x) => x.id.startsWith('INT-15')).map((x) => x.id)).toEqual(r.map((x) => x.id))
  })
})

/* ───────────── caso sintético (no depende del archivo del disco) ───────────── */

const punto = (pk: string): PuntoCanal => ({ pk, lon: -105, lat: 27, lonTexto: null, latTexto: null, defectoLon: null, defectoLat: null, refPK: 'IO1!D1', refLon: 'IO1!E1', refLat: 'IO1!F1' })
const cifraVacia = { valor: null, ref: 'x', formula: null, origen: 'vacio' as const }
const ficha = (fila: number, a: string, b: string, aforo: number, tomas: number): FichaCanal => ({
  fila, inventario: '1', nombre: 'CANAL', categoria: null, pkInicial: a, pkFinal: b, km: cifraVacia, gasto: cifraVacia, velocidad: cifraVacia, pendiente: cifraVacia,
  area: cifraVacia, plantilla: cifraVacia, tirante: cifraVacia, libreBordo: cifraVacia, talud: cifraVacia, corona: cifraVacia, revestimiento: null, seccion: null,
  ini: punto(a), fin: punto(b), ramal: 'principal',
  conteos: { porTipo: Object.fromEntries(TIPOS_IO1.map((t) => [t, t === 'estacion_aforo' ? aforo : t === 'toma' ? tomas : null])) as never, total: aforo + tomas },
})
const est = (fila: number, tipo: Estructura['tipo'], pkMetros: number | null): Estructura => ({
  fila, inventario: String(fila), tipoCrudo: tipo, cadenamientoTexto: '', pk: pkMetros === null ? null : `${Math.floor(pkMetros / 1000)}+${String(pkMetros % 1000).padStart(3, '0')}`, pkMetros,
  pkParcialKm: null, motivoPK: null, margen: null, notaPK: null, ramal: 'principal', categoria: null, correspondencia: null, material: null,
  tipo, familia: null, subtipo: null, ambiguo: false, lon: -105, lat: 27, lonTexto: null, latTexto: null, defectoLon: null, defectoLat: null,
  ubicacion: { estado: 'valida', lon: -105, lat: 27, motivo: null }, ref: `IO4!C${fila}`,
})
const libroMini = (estructuras: Estructura[], canales: FichaCanal[], total: number): LibroDerivado => ({
  sha256: 's', moduloNombre: null, ciclo: null, baseValores: 'cache', conceptosDiagnostico: [], tramos: [], totalesDiagnostico: [], filasTotales: [], necesidades: [],
  sumasBloque: [], totalGeneral3dn: null, programa: [], inventarioKm: { distribucion: cifraVacia, drenaje: cifraVacia, caminos: cifraVacia },
  fichas: {
    canales, drenes: [], caminos: [], estructuras,
    totalesIO1: { porTipo: Object.fromEntries(TIPOS_IO1.map((t) => [t, null])) as never, total },
  },
  extractorVersion: 4, avisos: [],
})

describe('conciliación IO4 ↔ IO1 · caso mínimo hecho a mano', () => {
  // Tramo A [0+000, 2+000): 1 aforo + 1 toma declarados · Tramo B [2+000, 3+000]: 1 aforo declarado.
  const canales = [ficha(16, '0+000', '2+000', 1, 1), ficha(17, '2+000', '3+000', 1, 0)]
  it('límite semiabierto: una estructura justo en 2+000 pertenece al tramo B, y el último tramo incluye su PK final', () => {
    const e = [est(14, 'estacion_aforo', 500), est(15, 'toma', 1999), est(16, 'estacion_aforo', 2000), est(17, 'otro', 3000), est(18, 'toma', 3001), est(19, 'toma', null)]
    const c = conciliacionIO4IO1(libroMini(e, canales, 3))!
    expect(c.porTramo.map((t) => [t.io4, t.io1, t.diferencia])).toEqual([[2, 2, 0], [2, 1, 1]])
    expect(c.fueraDeTramos.map((x) => x.fila)).toEqual([18])
    expect(c.sinPK.map((x) => x.fila)).toEqual([19])
    expect(c.sinClasificar).toBe(1)
    expect(c.totalIO4).toBe(6)
    expect(c.totalIO1Calculado).toBe(3)
  })
  it('sin IO4 o sin conteos no hay conciliación ni resultados (libros de módulo, registros v3)', () => {
    expect(conciliacionIO4IO1(libroMini([], canales, 3))).toBeNull()
    const sinConteos = canales.map((f) => { const g: Record<string, unknown> = { ...f }; delete g.conteos; return g as unknown as FichaCanal })
    expect(conciliacionIO4IO1(libroMini([est(1, 'toma', 1)], sinConteos, 3))).toBeNull()
    const u = { uniones: [], fichasSinTramo: [] } as never
    expect(verificarIntegridad(libroMini([], canales, 3), u).filter((r) => r.id.startsWith('INT-15'))).toEqual([])
  })
  it('un total que no coincide da «atípico» con la diferencia, no «no cuadra» ni «correcto»', () => {
    const c = libroMini([est(1, 'estacion_aforo', 100)], canales, 3)
    const u = { uniones: [], fichasSinTramo: [] } as never
    const r = verificarIntegridad(c, u).find((x) => x.id === 'INT-15:total')
    expect(r).toMatchObject({ estado: 'atipico', esperado: '3', observado: '1', diferencia: '-2', base: 'integridad' })
  })
})
