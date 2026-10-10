import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizarDataJson, VistaLibro } from '../nucleo'
import { admitirPacot } from '../derivacion/admision'
import { extraerLibro } from '../derivacion/extraer'
import { claveDe, concentrar, estadoDelCiclo, registrar } from '../derivacion/registro'
import type { Registro } from '../derivacion/registro'
import type { FichaPacot } from '../derivacion/admision'
import type { Cifra, LibroDerivado, NecesidadMedia } from '../derivacion/tipos'

type Portada = Partial<Record<'B4' | 'B6' | 'B8' | 'B9' | 'B10', string>>
const libroConPortada = (p: Portada): VistaLibro => {
  const cells: Record<string, { value: string; type: number }> = {}
  for (const [k, v] of Object.entries(p)) cells[k] = { value: v, type: 1 }
  return new VistaLibro(normalizarDataJson({ Resumen: { cells, formulas: {}, nrows: 12, ncols: 2 } }, { sha256: 'x', extractor: 't' }))
}
const BASE: Portada = { B4: '005. DELICIAS, CHIH.', B6: '05. 5 DELICIAS', B8: 'Unidad Conchos', B9: 'AUU 920313 8I8', B10: '2026 - 2027' }

describe('admisión: solo PacOT de la SRL Unidad Conchos', () => {
  it('admite un módulo y lo identifica por su número', () => {
    const r = admitirPacot(libroConPortada(BASE))
    expect(r.admitido).toBe(true)
    expect(r.ficha).toMatchObject({ tipo: 'MODULO', numeroModulo: 5, ciclo: '2026 - 2027' })
  })
  it('admite el libro de la SRL', () => {
    const r = admitirPacot(libroConPortada({ ...BASE, B6: 'SRL UNIDAD CONCHOS' }))
    expect(r.ficha).toMatchObject({ tipo: 'SRL', numeroModulo: null })
  })
  it('rechaza otra SRL, otro distrito y ciclo malformado', () => {
    expect(admitirPacot(libroConPortada({ ...BASE, B8: 'Otra SRL' })).admitido).toBe(false)
    expect(admitirPacot(libroConPortada({ ...BASE, B4: '010. CULIACAN' })).admitido).toBe(false)
    expect(admitirPacot(libroConPortada({ ...BASE, B10: '2026' })).admitido).toBe(false)
  })
  it('el RFC con I/1 confundidos se admite con aviso; un RFC distinto se rechaza', () => {
    const a = admitirPacot(libroConPortada({ ...BASE, B9: 'AUU 920313 818' }))
    expect(a.admitido).toBe(true)
    expect(a.avisos.join(' ')).toMatch(/PENDIENTE DE COMPROBAR/)
    expect(admitirPacot(libroConPortada({ ...BASE, B9: 'XXX 000000 000' })).admitido).toBe(false)
  })
  it('un libro sin hoja Resumen se rechaza', () => {
    const v = new VistaLibro(normalizarDataJson({ Otra: { cells: {}, formulas: {}, nrows: 1, ncols: 1 } }, { sha256: 'x', extractor: 't' }))
    expect(admitirPacot(v).admitido).toBe(false)
  })
})

const cif = (valor: string | null, ref: string): Cifra => ({ valor, ref, formula: null, origen: valor === null ? 'vacio' : 'capturado' })
const nec = (bloque: string, concepto: string, trabajo: string | null, importe: string | null): NecesidadMedia => ({
  fila: 1, bloque, concepto, unidadParametrica: null, unidadTrabajo: null, cantidadParametrica: cif(null, 'x'),
  cantidadTrabajo: cif(trabajo, '3DN!E1'), frecuencia: cif('1', 'x'), etiquetaFrecuencia: null,
  necesidadAnual: cif(trabajo, '3DN!H1'), pu: cif('10', 'x'), importe: cif(importe, '3DN!J1'), enlaceDiagnostico: null,
})
const libro = (sha: string, necesidades: NecesidadMedia[]): LibroDerivado => ({
  sha256: sha, moduloNombre: null, ciclo: '2026 - 2027', baseValores: 'cache', conceptosDiagnostico: [], tramos: [],
  totalesDiagnostico: [], filasTotales: [], necesidades, sumasBloque: [], totalGeneral3dn: null, programa: [], avisos: [], inventarioKm: { distribucion: cif('0', 'x'), drenaje: cif('0', 'x'), caminos: cif('0', 'x') }, fichas: { canales: [], drenes: [], caminos: [] }, extractorVersion: 2,
})
const ficha = (n: number | null): FichaPacot => ({
  tipo: n === null ? 'SRL' : 'MODULO', numeroModulo: n, moduloTexto: '', srl: 'Unidad Conchos', rfcSrl: '', distrito: '', ciclo: '2026 - 2027',
})

describe('registro y concentrado', () => {
  it('reimportar el mismo libro no duplica; uno distinto crea versión nueva', () => {
    const e = { ficha: ficha(5), libro: libro('a', []), archivoNombre: 'm5.xlsx' }
    const r1 = registrar(new Map(), e, 't1')
    expect(r1.estado).toBe('nuevo')
    const r2 = registrar(r1.registro, e, 't2')
    expect(r2.estado).toBe('sin_cambio')
    expect(r2.registro).toBe(r1.registro)
    const r3 = registrar(r2.registro, { ...e, libro: libro('b', []) }, 't3')
    expect(r3.estado).toBe('nueva_version')
    expect(r3.pacot.version).toBe(2)
    expect(claveDe(ficha(null))).toBe('2026 - 2027|SRL')
  })

  it('el mismo libro leído con un extractor más nuevo se reprocesa sin subir la versión del PacOT', () => {
    const e = { ficha: ficha(5), libro: libro('a', []), archivoNombre: 'm5.xlsx' }
    const r1 = registrar(new Map(), e, 't1')
    const r2 = registrar(r1.registro, { ...e, libro: { ...libro('a', []), extractorVersion: 3 } }, 't2')
    expect(r2.estado).toBe('reprocesado')
    expect(r2.pacot.version).toBe(1)
    expect(r2.pacot.libro.extractorVersion).toBe(3)
    expect(r2.registro.get('2026 - 2027|M05')?.libro.extractorVersion).toBe(3)
  })

  it('declara los módulos que faltan y no marca completo sin ellos', () => {
    let reg: Registro = new Map()
    for (const n of [1, 5]) reg = registrar(reg, { ficha: ficha(n), libro: libro('h' + n, []), archivoNombre: 'f' }, 't').registro
    const st = estadoDelCiclo(reg, '2026 - 2027')
    expect(st.modulosFaltantes).toEqual([2, 3, 4, 12])
    expect(st.completo).toBe(false)
  })

  it('concilia Σ módulos contra la SRL con Decimal y señala diferencias', () => {
    let reg: Registro = new Map()
    const puesta = (n: number | null, sha: string, t: string, i: string) => {
      reg = registrar(reg, { ficha: ficha(n), libro: libro(sha, [nec('RED DE DISTRIBUCION', 'Desazolve', t, i)]), archivoNombre: 'f' }, 't').registro
    }
    puesta(1, 'a', '100.1', '1000.10')
    puesta(5, 'b', '200.2', '2000.20')
    puesta(null, 'c', '300.3', '3000.40')
    const filas = concentrar(estadoDelCiclo(reg, '2026 - 2027'))
    const trabajo = filas.find((f) => f.magnitud === 'cantidadTrabajo')
    const importe = filas.find((f) => f.magnitud === 'importe')
    expect(trabajo?.sumaModulos).toBe('300.3')
    expect(trabajo?.estado).toBe('coincide')
    expect(importe?.sumaModulos).toBe('3000.3')
    expect(importe?.diferencia).toBe('-0.1')
    expect(importe?.estado).toBe('difiere')
  })

  it('un módulo sin el dato deja el acumulado incompleto, no en cero', () => {
    let reg: Registro = new Map()
    reg = registrar(reg, { ficha: ficha(1), libro: libro('a', [nec('B', 'Desazolve', '5', '50')]), archivoNombre: 'f' }, 't').registro
    reg = registrar(reg, { ficha: ficha(2), libro: libro('b', [nec('B', 'Desazolve', null, null)]), archivoNombre: 'f' }, 't').registro
    reg = registrar(reg, { ficha: ficha(null), libro: libro('c', [nec('B', 'Desazolve', '5', '50')]), archivoNombre: 'f' }, 't').registro
    const f = concentrar(estadoDelCiclo(reg, '2026 - 2027')).find((x) => x.magnitud === 'importe')
    expect(f?.sumaModulos).toBeNull()
    expect(f?.estado).toBe('incompleto')
  })

  it('la SRL sin drenes en su inventario no se concilia contra los drenes de los módulos', () => {
    let reg: Registro = new Map()
    const L = (sha: string, kmDren: string, t: string): LibroDerivado => ({ ...libro(sha, [nec('RED DE DRENAJE', 'Desazolve', t, t)]), inventarioKm: { distribucion: cif('1', 'x'), drenaje: cif(kmDren, 'IO2!J15'), caminos: cif('1', 'x') } })
    reg = registrar(reg, { ficha: ficha(5), libro: L('a', '117.2', '900'), archivoNombre: 'f' }, 't').registro
    reg = registrar(reg, { ficha: ficha(null), libro: L('b', '0', '0'), archivoNombre: 'f' }, 't').registro
    const f = concentrar(estadoDelCiclo(reg, '2026 - 2027'))
    expect(f.every((x) => x.estado === 'no_aplica_srl')).toBe(true)
  })

  it('sin libro SRL el estado es sin_srl', () => {
    const reg = registrar(new Map(), { ficha: ficha(1), libro: libro('a', [nec('B', 'X', '1', '1')]), archivoNombre: 'f' }, 't').registro
    expect(concentrar(estadoDelCiclo(reg, '2026 - 2027'))[0]?.estado).toBe('sin_srl')
  })
})

const carpeta = process.env.CONCHOS_EVIDENCIAS ?? path.resolve(process.cwd(), '../Conservacion/Skill/ejemplo_Conchos/evidencias/lector_xls')
describe.skipIf(!existsSync(path.join(carpeta, 'data.json')))('admisión del PacOT real de la SRL', () => {
  it('el libro de ejemplo es admitido como SRL, con aviso por el RFC y ciclo 2026 - 2027', () => {
    const crudo: unknown = JSON.parse(readFileSync(path.join(carpeta, 'data.json'), 'utf8'))
    const v = new VistaLibro(normalizarDataJson(crudo, { sha256: 'real', extractor: 'lector_xls' }))
    const r = admitirPacot(v)
    expect(r.admitido).toBe(true)
    expect(r.ficha).toMatchObject({ tipo: 'SRL', ciclo: '2026 - 2027' })
    expect(extraerLibro(v).necesidades.length).toBeGreaterThan(10)
  })
})
