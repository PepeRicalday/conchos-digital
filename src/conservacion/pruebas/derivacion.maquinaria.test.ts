/**
 * Balance de maquinaria (B Maq + IM01): lectura por rótulos, normalización de tipos y conciliación por tipo.
 * Cifras de oro del PacOT real de la SRL Unidad Conchos (solo lectura): B Maq!B68=8.156, C68=9, D68=2; IM01 con 10 renglones.
 * Los casos sintéticos parten del libro real con el campo `maquinaria` reemplazado, para probar cada regla aislada.
 */
import { describe, expect, it } from 'vitest'
import { normalizarDataJson, VistaLibro } from '../nucleo'
import { EXTRACTOR_VERSION } from '../derivacion/extraer'
import { leerMaquinaria, normalizarTipo, TIPOS_MAQUINA } from '../derivacion/maquinaria'
import { EXTRACTOR_CON_MAQUINARIA, vistaMaquinaria } from '../derivacion/maquinariaVista'
import type { FilaBalanceMaquinaria, LibroDerivado, MaquinariaLibro, UnidadMaquinaria } from '../derivacion/tipos'
import { hayEvidencias, libroSrl } from './ayuda/libroSrl'

const celda = (valor: number | null, ref = 'B Maq!A1') => ({ valor: valor === null ? null : String(valor), ref, formula: null, origen: valor === null ? ('vacio' as const) : ('capturado' as const) })
const vacio = celda(null)

const balance = (tipo: string, c: Partial<Record<keyof FilaBalanceMaquinaria, number>>): FilaBalanceMaquinaria => ({
  fila: 51, tipo, tipoCanonico: tipo,
  necesarias: celda(c.necesarias ?? null), existentes: celda(c.existentes ?? null), faltante: celda(c.faltante ?? null), sobrante: celda(c.sobrante ?? null),
  buenoRegular: celda(c.buenoRegular ?? null), malo: celda(c.malo ?? null), baja: celda(c.baja ?? null), rehabilitacion: vacio, disposicion: vacio,
  porFaltante: celda(c.porFaltante ?? null), porSustituir: celda(c.porSustituir ?? null), suma: celda(c.suma ?? null),
})

const unidad = (fila: number, tipo: string, estado: UnidadMaquinaria['estado'], extra: Partial<UnidadMaquinaria> = {}): UnidadMaquinaria => ({
  fila, tipo, tipoCanonico: tipo, accesorio: false, numeroEconomico: `005-X${fila}`, marca: null, modelo: null, estado, estadoConflicto: false,
  horas: celda(1000), unidadLectura: 'horas', observaciones: null, ref: `IM01!B${fila}`, ...extra,
})

const conMaquinaria = (m: Partial<MaquinariaLibro>): LibroDerivado => ({
  ...(hayEvidencias ? libroSrl().libro : ({ necesidades: [] } as unknown as LibroDerivado)),
  maquinaria: { renglones: [], totalRenglones: null, balance: [], totalBalance: null, inventario: [], inventarioLeido: true, columnasInventario: { numeroEconomico: true, horas: true }, avisos: [], ...m },
})

describe('normalizarTipo', () => {
  it('reconoce el catálogo con otra escritura', () => {
    expect(normalizarTipo('Camión volteo ').canonico).toBe('Camión volteo')
    expect(normalizarTipo('CAMION DE VOLTEO').canonico).toBe('Camión volteo')
    expect(normalizarTipo('EXCAVADORA L.A.').canonico).toBe('Excavadoras')
    expect(normalizarTipo('TRACTO CAMION').canonico).toBe('Tractor camión 5a rueda con cama baja')
    expect(normalizarTipo('Tractor agrícola con equipo de nivelación').canonico).toBe('Tractor agrícola con equipo de nivelación')
  })
  it('un implemento no es máquina y un tipo desconocido no se inventa', () => {
    expect(normalizarTipo('DESBROZADORA')).toEqual({ canonico: null, accesorio: true })
    expect(normalizarTipo('Cuchilla topadora')).toEqual({ canonico: null, accesorio: true })
    expect(normalizarTipo('Dirigible')).toEqual({ canonico: null, accesorio: false })
    expect(normalizarTipo(null)).toEqual({ canonico: null, accesorio: false })
  })
  it('el catálogo del formato 4 tiene 18 tipos', () => { expect(TIPOS_MAQUINA).toHaveLength(18) })
  it('reconoce la escritura con sufijos y los equipos del catálogo de IM-01', () => {
    expect(normalizarTipo('TRACTOR BULDOZER').canonico).toBe('Tractor sobre oruga')
    expect(normalizarTipo('Camión de volteo (Terr:)').canonico).toBe('Camión volteo')
    expect(normalizarTipo('MOTOCONFORMADORA JOHN DEERE 670G').canonico).toBe('Motoconformadora')
    expect(normalizarTipo('CARGADOR FRONTAL 950').canonico).toBe('Cargador frontal')
    expect(normalizarTipo('EQUIPO LIGERO').canonico).toBe('Tractor agrícola con equipo ligero')
  })
  it('un tractor con implemento sigue siendo tractor; solo el implemento solo no es máquina', () => {
    expect(normalizarTipo('Tractor sobre oruga con cuchilla').accesorio).toBe(false)
    expect(normalizarTipo('Cuchilla topadora').accesorio).toBe(true)
  })
  it('el extractor actual lee maquinaria', () => { expect(EXTRACTOR_VERSION).toBeGreaterThanOrEqual(EXTRACTOR_CON_MAQUINARIA) })
})

describe.skipIf(!hayEvidencias)('SRL Conchos · maquinaria leída del libro real', () => {
  it('lee el balance y el inventario con las cifras del libro', () => {
    const m = libroSrl().libro.maquinaria!
    expect(m.renglones.length).toBeGreaterThan(15)
    expect(m.totalBalance?.fila).toBe(68)
    expect(Number(m.totalBalance?.necesarias.valor)).toBeCloseTo(8.1565, 3)
    expect(Number(m.totalBalance?.existentes.valor)).toBe(9)
    expect(m.inventario).toHaveLength(10)
    expect(m.inventario.filter((u) => u.accesorio)).toHaveLength(1)
    // La única observación es la celda suelta B54 de IM01 (un tipo sin número, estado ni horas): se avisa, no se inventa una unidad.
    expect(m.avisos).toEqual([expect.stringMatching(/1 fila con un tipo de máquina pero sin número económico/)])
  })
  it('un renglón sin cantidad en B Maq!A hereda el concepto anterior', () => {
    const r = libroSrl().libro.maquinaria!.renglones.find((x) => x.fila === 16)!
    expect(r.conceptoHeredado).toBe(true)
    expect(r.concepto).toBe('Deshierbe y limpia')
    expect(r.bloque).toBe('distribucion')
  })
  it('una lectura en millas o km no se toma por horas', () => {
    const u = libroSrl().libro.maquinaria!.inventario.filter((x) => x.unidadLectura !== 'horas' && x.unidadLectura !== null)
    expect(u.map((x) => x.unidadLectura).sort()).toEqual(['km', 'millas'])
    expect(u.every((x) => x.horas.valor === null)).toBe(true)
  })
  it('la vista encuentra los hallazgos conocidos del libro y nunca dice «correcto»', () => {
    const v = vistaMaquinaria(libroSrl().libro)!
    const titulos = v.hallazgos.map((h) => h.titulo).join('\n')
    expect(titulos).toMatch(/Tractor agrícola con equipo ligero: faltante del libro distinto del que resulta con el umbral de 0.5/)
    expect(titulos).toMatch(/Desazolve de canales: la cantidad de B Maq no coincide con la necesidad de 3DN/)
    expect(titulos).toMatch(/Conformación de caminos/)
    expect(v.resumen.existentesInventario).toBe(9)
    expect(v.resumen.necesariasLibro).toBeCloseTo(8.1565, 3)
    const desazolve = v.conceptos.find((c) => c.concepto === 'Desazolve de canales')!
    expect(desazolve.modo).toBe('difiere')
    expect(desazolve.razon).toBeCloseTo(4 / 3, 2)
    expect(JSON.stringify(v)).not.toMatch(/correcto|aprobado|conforme/i)
  })
  it('es una sola cuenta por libro (caché)', () => {
    const l = libroSrl().libro
    expect(vistaMaquinaria(l)).toBe(vistaMaquinaria(l))
  })
})

describe('vistaMaquinaria · reglas aisladas', () => {
  it('sin el campo maquinaria no hay vista (libro leído con un extractor anterior)', () => {
    const base = hayEvidencias ? libroSrl().libro : ({ necesidades: [] } as unknown as LibroDerivado)
    expect(vistaMaquinaria({ ...base, maquinaria: undefined })).toBeNull()
  })
  it('umbral de adquisición: 1.46 → 1 máquina, 1.56 → 2', () => {
    const a = vistaMaquinaria(conMaquinaria({ balance: [balance('Excavadoras', { necesarias: 1.46, existentes: 1 })] }))!
    expect(a.tipos[0]!.requeridas).toBe(1)
    expect(a.tipos[0]!.faltanteCalculado).toBe(0)
    const b = vistaMaquinaria(conMaquinaria({ balance: [balance('Excavadoras', { necesarias: 1.56, existentes: 1 })] }))!
    expect(b.tipos[0]!.requeridas).toBe(2)
    expect(b.tipos[0]!.faltanteCalculado).toBe(1)
    expect(b.tipos[0]!.hallazgos.map((h) => h.codigo)).toContain('faltante_sobrante')
  })
  it('un faltante declarado con necesidad ≤ 0.5 es atípico, no un error', () => {
    const v = vistaMaquinaria(conMaquinaria({ balance: [balance('Camión volteo', { necesarias: 0.48, faltante: 1 })] }))!
    const h = v.hallazgos.find((x) => x.codigo === 'faltante_sobrante')!
    expect(h.estado).toBe('atipico')
    expect(h.enLibro).toBe('1')
    expect(h.referencia).toBe('0')
  })
  it('la condición del parque debe sumar las existentes (contradicción del propio libro)', () => {
    const v = vistaMaquinaria(conMaquinaria({ balance: [balance('Excavadoras', { necesarias: 2, existentes: 5, buenoRegular: 2, malo: 2 })] }))!
    expect(v.hallazgos.find((h) => h.codigo === 'condicion_no_suma')?.estado).toBe('discrepa')
  })
  it('existentes y estados del balance se comparan con el inventario; un implemento no cuenta', () => {
    const inv = [unidad(15, 'Excavadoras', 'bueno'), unidad(16, 'Excavadoras', 'baja'), unidad(17, 'Excavadoras', 'bueno', { accesorio: true, tipoCanonico: null })]
    const v = vistaMaquinaria(conMaquinaria({ balance: [balance('Excavadoras', { necesarias: 2, existentes: 3, buenoRegular: 2, baja: 1 })], inventario: inv }))!
    const fila = v.tipos[0]!
    expect(fila.existentesInventario).toBe(2)
    expect(fila.invBuenoRegular).toBe(1)
    expect(fila.invBaja).toBe(1)
    const codigos = fila.hallazgos.map((h) => h.codigo)
    expect(codigos).toContain('existentes_vs_inventario')
    expect(codigos).toContain('estados_vs_inventario')
  })
  it('máquinas necesarias del balance distintas de la suma de renglones es una discrepancia', () => {
    const renglon = (fila: number, k: number) => ({
      fila, bloque: 'distribucion' as const, concepto: 'Terracerías', conceptoHeredado: false, unidad: 'm3', cantidad: vacio, frecuencia: vacio, anual: vacio,
      tipo: 'Excavadoras', tipoCanonico: 'Excavadoras', rendimiento: vacio, horas: vacio, horasDisponibles: vacio, maquinas: celda(k),
    })
    const v = vistaMaquinaria(conMaquinaria({ renglones: [renglon(15, 1), renglon(16, 0.5)], balance: [balance('Excavadoras', { necesarias: 2 })] }))!
    const h = v.hallazgos.find((x) => x.codigo === 'nm_vs_renglones')!
    expect(h.estado).toBe('discrepa')
    expect(h.referencia).toBe('1.5')
  })
  it('si IM01 no se pudo leer no se inventa un inventario de cero unidades', () => {
    const v = vistaMaquinaria(conMaquinaria({ balance: [balance('Excavadoras', { necesarias: 2, existentes: 2, buenoRegular: 2 })], inventarioLeido: false }))!
    const f = v.tipos[0]!
    expect(f.existentesInventario).toBeNull()
    expect(f.cobertura).toBeNull()
    expect(f.hallazgos.map((h) => h.codigo)).not.toContain('existentes_vs_inventario')
    expect(f.hallazgos.map((h) => h.codigo)).not.toContain('estados_vs_inventario')
    expect(v.resumen.existentesInventario).toBeNull()
  })
  it('sin balance ni renglones leídos no hay «coherente»: balanceLeido es false y no hay filas', () => {
    const v = vistaMaquinaria(conMaquinaria({ inventario: [unidad(15, 'Excavadoras', 'bueno')], avisos: ['B Maq: no se leyó el balance'] }))!
    expect(v.balanceLeido).toBe(false)
    expect(v.tipos).toHaveLength(0)
  })
  it('una celda del balance con texto no se lee como 0 ni genera hallazgos aritméticos', () => {
    const b = balance('Excavadoras', { necesarias: 2, buenoRegular: 2 })
    const conTexto = { ...b, existentes: { valor: null, ref: 'B Maq!C51', formula: null, origen: 'vacio' as const, texto: '3 ' } }
    const v = vistaMaquinaria(conMaquinaria({ balance: [conTexto], inventario: [unidad(15, 'Excavadoras', 'bueno'), unidad(16, 'Excavadoras', 'bueno')] }))!
    const codigos = v.tipos[0]!.hallazgos.map((h) => h.codigo)
    expect(codigos).not.toContain('existentes_vs_inventario')
    expect(codigos).not.toContain('condicion_no_suma')
    expect(codigos).not.toContain('faltante_sobrante')
  })
  it('un tipo del inventario sin fila en el balance se señala', () => {
    const v = vistaMaquinaria(conMaquinaria({ balance: [balance('Excavadoras', { necesarias: 1, existentes: 1, buenoRegular: 1 })], inventario: [unidad(15, 'Excavadoras', 'bueno'), unidad(16, 'Minicargador', 'bueno')] }))!
    expect(v.hallazgos.some((h) => h.codigo === 'tipo_sin_fila' && h.tipoMaquina === 'Minicargador')).toBe(true)
  })
  it('un renglón sin tipo de máquina se señala en lugar de perderse', () => {
    const r = { fila: 20, bloque: 'distribucion' as const, concepto: 'Terracerías', conceptoHeredado: false, unidad: 'm3', cantidad: vacio, frecuencia: vacio, anual: celda(10), tipo: '', tipoCanonico: null, rendimiento: vacio, horas: celda(5), horasDisponibles: vacio, maquinas: celda(0.5) }
    const v = vistaMaquinaria(conMaquinaria({ renglones: [r], balance: [balance('Excavadoras', { necesarias: 1, existentes: 1, buenoRegular: 1 })] }))!
    expect(v.hallazgos.some((h) => /sin tipo de máquina/.test(h.titulo))).toBe(true)
  })
  it('3DN en cero con B Maq programando máquinas es atípico', () => {
    const base = hayEvidencias ? libroSrl().libro : ({ necesidades: [] } as unknown as LibroDerivado)
    const necesidades = [{ fila: 32, bloque: 'RED DE DISTRIBUCION', concepto: 'Desazolve', unidadParametrica: null, unidadTrabajo: 'M3', cantidadParametrica: vacio, cantidadTrabajo: celda(0), frecuencia: celda(0.25), etiquetaFrecuencia: null, necesidadAnual: celda(0, '3DN!H32'), pu: vacio, importe: vacio, enlaceDiagnostico: null }]
    const r = { fila: 19, bloque: 'distribucion' as const, concepto: 'Desazolve de canales', conceptoHeredado: false, unidad: 'm3', cantidad: celda(100), frecuencia: celda(1), anual: celda(100), tipo: 'Excavadoras', tipoCanonico: 'Excavadoras', rendimiento: celda(10), horas: celda(10), horasDisponibles: celda(1400), maquinas: celda(0.01) }
    const libro: LibroDerivado = { ...base, necesidades, maquinaria: { renglones: [r], totalRenglones: null, balance: [], totalBalance: null, inventario: [], inventarioLeido: true, columnasInventario: { numeroEconomico: true, horas: true }, avisos: [] } }
    const v = vistaMaquinaria(libro)!
    expect(v.hallazgos.find((h) => h.codigo === 'concepto_vs_3dn')?.estado).toBe('atipico')
    expect(v.conceptos[0]!.anual3dn).toBe(0)
  })
  it('celdas ausentes quedan S/D (null), nunca 0', () => {
    const v = vistaMaquinaria(conMaquinaria({ balance: [balance('Excavadoras', { necesarias: 2, existentes: 2 })] }))!
    const f = v.tipos[0]!
    expect(f.faltanteLibro).toBeNull()
    expect(f.libroBaja).toBeNull()
    expect(f.porFaltante).toBeNull()
  })
})

/** Libro mínimo armado a mano: pasa por el extractor real, a diferencia de los casos que construyen MaquinariaLibro. */
function libroMinimo(celdas: Record<string, string | number>) {
  const cells = Object.fromEntries(Object.entries(celdas).map(([k, v]) => [k, typeof v === 'number' ? { value: v, type: 2 } : { value: v, type: 1 }]))
  return new VistaLibro(normalizarDataJson({ 'B Maq': { cells, formulas: {}, nrows: 60, ncols: 14 } } as unknown, { sha256: 'minimo', extractor: 'prueba' }))
}

describe('leerMaquinaria · libro mínimo', () => {
  const cabecera = { A10: 'Concepto de trabajo', G10: 'Tipo de máquina', H10: 'Rendimiento', K10: 'Número de máquinas', A30: 'Tipo de maquinaria' }
  it('un renglón sin tipo a media tabla conserva su concepto y su bloque, no los del final', () => {
    const m = leerMaquinaria(libroMinimo({
      ...cabecera,
      A12: 'Red de canales', B12: 'km', F12: 200, G12: 'Excavadoras', H12: 1, I12: 200, J12: 1400, K12: 0.14,
      A13: 'Desazolve de canales', B13: 'm3', F13: 100, I13: 10, J13: 1400, K13: 0.01,
      A14: 'Red de caminos', B14: 'km', F14: 5, G14: 'Motoconformadora', H14: 1, I14: 5, J14: 1400, K14: 0.004,
      A15: 'Bacheo', B15: 'm3', F15: 7, G15: 'Camión volteo', H15: 1, I15: 7, J15: 1400, K15: 0.005,
      I20: 222, K20: 0.16,
    }))!
    const sinTipo = m.renglones.find((r) => r.fila === 13)!
    expect(sinTipo.tipo).toBe('')
    expect(sinTipo.concepto).toBe('Desazolve de canales')
    expect(sinTipo.bloque).toBe('distribucion')
    expect(m.totalRenglones?.fila).toBe(20)
    expect(m.renglones.find((r) => r.fila === 15)?.bloque).toBe('caminos')
  })
  it('una celda con texto numérico se avisa y no se lee como cero', () => {
    const m = leerMaquinaria(libroMinimo({ ...cabecera, A12: 'Terracerías', F12: '1,5', G12: 'Excavadoras', H12: 1, I12: 3, J12: 1400, K12: 0.002 }))!
    expect(m.renglones[0]!.anual.valor).toBeNull()
    expect(m.avisos.some((a) => /B Maq!F12: trae el texto «1,5»/.test(a))).toBe(true)
  })
  it('sin IM01 el inventario no se lee y se dice', () => {
    const m = leerMaquinaria(libroMinimo(cabecera))!
    expect(m.inventarioLeido).toBe(false)
    expect(m.avisos.some((a) => /no trae la hoja IM01/.test(a))).toBe(true)
  })
})
