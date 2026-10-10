import { describe, expect, it } from 'vitest'
import { construirArchivo, leerArchivoDerivacion, resumirCiclo } from '../derivacion/archivo'
import { registrar } from '../derivacion/registro'
import type { Registro } from '../derivacion/registro'
import type { FichaPacot } from '../derivacion/admision'
import type { Cifra, LibroDerivado } from '../derivacion/tipos'

const cif = (valor: string | null, ref = 'x'): Cifra => ({ valor, ref, formula: valor ? '1+1' : null, origen: valor ? 'formula' : 'vacio' })
const libro = (sha: string): LibroDerivado => ({
  sha256: sha, moduloNombre: 'M', ciclo: '2026 - 2027', baseValores: 'cache', conceptosDiagnostico: ['DESAZOLVE'],
  tramos: [{ fila: 17, red: 'distribucion', inventario: '1', obra: 'CANAL', pkInicial: '0+000', pkFinal: '2+000', km: cif('2'),
    conceptos: [{ concepto: 'DESAZOLVE', parametrica: cif('2'), trabajo: cif('11400') }] }],
  totalesDiagnostico: [], filasTotales: [], sumasBloque: [], totalGeneral3dn: cif('10'), programa: [],
  necesidades: [{ fila: 32, bloque: 'RED DE DISTRIBUCION', concepto: 'Desazolve', unidadParametrica: 'Km', unidadTrabajo: 'M3',
    cantidadParametrica: cif('1'), cantidadTrabajo: cif('100'), frecuencia: cif('0.25'), etiquetaFrecuencia: 'Ev./Mes',
    necesidadAnual: cif('25'), pu: cif('2'), importe: cif('50'), enlaceDiagnostico: { columna: 'I', fila: 15 } }],
  inventarioKm: { distribucion: cif('1'), drenaje: cif('0'), caminos: cif('1') }, avisos: [], fichas: { canales: [], drenes: [], caminos: [] }, extractorVersion: 2,
})
const ficha = (n: number | null): FichaPacot => ({
  tipo: n === null ? 'SRL' : 'MODULO', numeroModulo: n, moduloTexto: 't', srl: 'Unidad Conchos', rfcSrl: '', distrito: '005', ciclo: '2026 - 2027',
})

describe('archivo de derivación', () => {
  const reg: Registro = registrar(registrar(new Map(), { ficha: ficha(null), libro: libro('s'), archivoNombre: 'srl.xls' }, 't').registro,
    { ficha: ficha(5), libro: libro('m'), archivoNombre: 'm5.xlsx' }, 't').registro

  it('se escribe y se lee sin perder cifras, fórmulas ni avisos de admisión', () => {
    const a = construirArchivo(reg, new Map([['2026 - 2027|M05', ['RFC pendiente de comprobar']]]), '2026 - 2027', 't')
    const l = leerArchivoDerivacion(JSON.parse(JSON.stringify(a)))
    expect(l.registro.size).toBe(2)
    expect(l.registro.get('2026 - 2027|M05')?.libro.necesidades[0]?.cantidadTrabajo.formula).toBe('1+1')
    expect(l.avisos.get('2026 - 2027|M05')).toEqual(['RFC pendiente de comprobar'])
    expect(l.modulosEsperados).toEqual([1, 2, 3, 4, 5, 12])
  })

  it('el resumen declara los módulos pendientes de cargar y que el ciclo no está completo', () => {
    const { resumen } = resumirCiclo(reg, '2026 - 2027')
    expect(resumen.srlRegistrada).toBe(true)
    expect(resumen.modulosRegistrados).toEqual([5])
    expect(resumen.modulosPendientes).toEqual([1, 2, 3, 4, 12])
    expect(resumen.completo).toBe(false)
  })

  it('un archivo con forma distinta o con clave que no corresponde a su ficha se rechaza', () => {
    expect(() => leerArchivoDerivacion({ formato: 'otro' })).toThrow()
    const a = JSON.parse(JSON.stringify(construirArchivo(reg, new Map(), '2026 - 2027', 't')))
    a.pacots[0].clave = '2026 - 2027|M99'
    expect(() => leerArchivoDerivacion(a)).toThrow(/no corresponde/)
  })
})
