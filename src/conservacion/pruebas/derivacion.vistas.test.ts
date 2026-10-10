import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizarDataJson, VistaLibro } from '../nucleo'
import { extraerLibro } from '../derivacion/extraer'
import { agruparPrograma, agruparTramos, cadenaDeConcepto, verificarTotalesDiagnostico } from '../derivacion/vistas'
import type { Cifra, LibroDerivado, NecesidadMedia } from '../derivacion/tipos'

const cif = (valor: string | null, ref = 'x', formula: string | null = null): Cifra => ({ valor, ref, formula, origen: valor === null ? 'vacio' : formula ? 'formula' : 'capturado' })
const nec = (p: Partial<NecesidadMedia>): NecesidadMedia => ({
  fila: 1, bloque: 'RED DE DISTRIBUCION', concepto: 'Desazolve', unidadParametrica: 'Km', unidadTrabajo: 'M3',
  cantidadParametrica: cif('10'), cantidadTrabajo: cif('100'), frecuencia: cif('0.25'), etiquetaFrecuencia: 'Ev./Mes',
  necesidadAnual: cif('25'), pu: cif('2'), importe: cif('50'), enlaceDiagnostico: null, ...p,
})
const libro = (extra: Partial<LibroDerivado> = {}): LibroDerivado => ({
  sha256: 's', moduloNombre: null, ciclo: null, baseValores: 'cache', conceptosDiagnostico: ['DESAZOLVE'], tramos: [],
  totalesDiagnostico: [{ concepto: 'DESAZOLVE', parametrica: cif('10'), trabajo: cif('100', 'DIAG-01!I15') }], necesidades: [], filasTotales: [], sumasBloque: [],
  totalGeneral3dn: null, programa: [], inventarioKm: { distribucion: cif('1'), drenaje: cif('0'), caminos: cif('1') }, fichas: { canales: [], drenes: [], caminos: [] }, extractorVersion: 2, avisos: [], ...extra,
})

describe('cadena de cálculo de un concepto', () => {
  it('verifica E×F y H×PU con Decimal y liga el total a DIAG-01 por nombre', () => {
    const c = cadenaDeConcepto(libro(), nec({}))
    expect(c.pasos.map((p) => p.etiqueta.split(' (')[0])).toContain('Necesidad media anual')
    expect(c.verificaciones.map((v) => v.estado)).toEqual(['coincide', 'coincide', 'coincide'])
    expect(c.ligadoPor).toBe('nombre')
  })
  it('liga por la fórmula cuando el libro enlaza a DIAG-01', () => {
    const c = cadenaDeConcepto(libro(), nec({ concepto: 'Otro nombre', enlaceDiagnostico: { columna: 'I', fila: 15 } }))
    expect(c.ligadoPor).toBe('formula')
  })
  it('señala la diferencia cuando el libro no cumple su propia operación', () => {
    const c = cadenaDeConcepto(libro(), nec({ necesidadAnual: cif('30') }))
    const v = c.verificaciones[0]
    expect(v?.estado).toBe('difiere')
    expect(v?.diferencia).toBe('5')
  })
  it('un dato vacío no se evalúa como cero', () => {
    const c = cadenaDeConcepto(libro(), nec({ pu: cif(null), importe: cif(null) }))
    expect(c.verificaciones[1]?.estado).toBe('no_evaluable')
  })
})

describe('tramos y programa', () => {
  const tramo = (fila: number, trabajo: string | null) => ({
    fila, red: 'distribucion' as const, inventario: '1', obra: 'CANAL', pkInicial: '0+000', pkFinal: '2+000', km: cif('2'),
    conceptos: [{ concepto: 'DESAZOLVE', parametrica: cif('2'), trabajo: cif(trabajo) }],
  })
  it('agrupa por red y obra y suma el trabajo; con un tramo vacío la suma queda sin dato', () => {
    const g = agruparTramos(libro({ tramos: [tramo(17, '40'), tramo(18, '60')] }))
    expect(g[0]?.obras[0]?.sumaTrabajo[0]?.suma).toBe('100')
    expect(g[0]?.obras[0]?.kmTotal).toBe('4')
    expect(agruparTramos(libro({ tramos: [tramo(17, '40'), tramo(18, null)] }))[0]?.obras[0]?.sumaTrabajo[0]?.suma).toBeNull()
  })
  it('compara Σ tramos con la fila de totales de DIAG-01', () => {
    expect(verificarTotalesDiagnostico(libro({ tramos: [tramo(17, '40'), tramo(18, '60')] }))[0]?.estado).toBe('coincide')
    expect(verificarTotalesDiagnostico(libro({ tramos: [tramo(17, '40')] }))[0]?.estado).toBe('difiere')
  })
  it('no suma cantidades de unidades distintas en un grupo de programa', () => {
    const r = (u: string, c: string) => ({ fila: 1, inventario: '1', clave: 'k', red: 'distribucion' as const, encabezado: 'LIMPIA', maquinas: null, obra: 'o', localizacion: 'l', km: cif('1'), cantidad: cif(c), unidad: u, pu: cif('1'), importe: cif(c) })
    const g = agruparPrograma(libro({ programa: [r('HA', '1'), r('M3', '2')] }))[0]
    expect(g?.cantidad).toBeNull()
    expect(g?.importe).toBe('3')
  })
})

const carpeta = process.env.CONCHOS_EVIDENCIAS ?? path.resolve(process.cwd(), '../Conservacion/Skill/ejemplo_Conchos/evidencias/lector_xls')
describe.skipIf(!existsSync(path.join(carpeta, 'data.json')))('Conchos · cadena real', () => {
  it('desazolve de la SRL: 468,505.36 × 0.25 × $49.74, con las tres verificaciones en verde', () => {
    const crudo: unknown = JSON.parse(readFileSync(path.join(carpeta, 'data.json'), 'utf8'))
    const l = extraerLibro(new VistaLibro(normalizarDataJson(crudo, { sha256: 'r', extractor: 'x' })))
    const n = l.necesidades.find((x) => x.concepto === 'Desazolve' && x.bloque.startsWith('RED DE DISTRIBU'))
    const c = cadenaDeConcepto(l, n as NecesidadMedia)
    expect(c.ligadoPor).toBe('formula')
    expect(c.verificaciones.every((v) => v.estado === 'coincide')).toBe(true)
    expect(c.pasos.find((p) => p.etiqueta === 'Necesidad media anual')?.cifra.formula).toBe('E32*F32')
    expect(verificarTotalesDiagnostico(l).every((v) => v.estado === 'coincide')).toBe(true)
  })
})
