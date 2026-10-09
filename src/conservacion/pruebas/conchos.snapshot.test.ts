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

const carpeta = process.env.CONCHOS_EVIDENCIAS ?? path.resolve(process.cwd(), '../Conservacion/Skill/ejemplo_Conchos/evidencias/lector_xls')
const hay = existsSync(path.join(carpeta, 'data.json')) && existsSync(path.join(carpeta, 'manifest.json'))

describe.skipIf(!hay)('Conchos · reglas implementadas contra datos reales', () => {
  let inf: InformeEjecucion
  const hall = (regla: string): readonly Hallazgo[] => inf.resultados.filter((r) => r.reglaId === regla).flatMap((r) => r.hallazgos)
  const sufijo = (h: Hallazgo): string => h.id.split(':').slice(-1)[0] ?? ''
  const cuenta = (regla: string, suf: string): number => hall(regla).filter((h) => sufijo(h) === suf).length

  beforeAll(() => {
    const crudo: unknown = JSON.parse(readFileSync(path.join(carpeta, 'data.json'), 'utf8'))
    const manifest = JSON.parse(readFileSync(path.join(carpeta, 'manifest.json'), 'utf8')) as { sha256: string }
    const libro = normalizarDataJson(crudo, { sha256: manifest.sha256, extractor: 'lector_xls 1.0.0' })
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

  it('TRV-001 · 4 errores #VALUE! almacenados en 2PAC; 52 fórmulas con libros externos declaradas; ADDIN y matriciales ya interpretadas (C-DYP-P03)', () => {
    expect(hall('TRV-001').map((x) => x.referencias[0]).sort()).toEqual(['2PAC!C102', '2PAC!C106', '2PAC!D102', '2PAC!D106'])
    const r = inf.resultados.find((x) => x.reglaId === 'TRV-001')
    expect(r?.cobertura).toMatchObject({ identificados: 3212, revisados: 3160 })
    expect(r?.pendientes.join(' ')).not.toMatch(/ADDIN|matriciales/)
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

  it('DYP-007 · 5 cruces de unidad en PO-2 (4 con impacto vigente, 1 latente) y 2 en 3DND con terracerías en m³ (C-DYP-P04, C-DIA-02, C-DIA-03)', () => {
    const h = hall('DYP-007')
    expect(h.map((x) => x.id)).toEqual([
      'DYP-007:PO-2!C43:PO-2!R42', 'DYP-007:PO-2!C47:PO-2!R46', 'DYP-007:PO-2!C48:PO-2!R47', 'DYP-007:PO-2!C50:PO-2!R49', 'DYP-007:PO-2!C51:PO-2!R50',
      'DYP-007:3DND!F51:SEG-3!F269', 'DYP-007:3DND!J51:SEG-3!F263',
    ])
    // valores que la auditoría documentó: +0.5 ha, +1.25 m3, +$752,939.25 dentro de km, +1.25 m3; 20 km y 35 km dentro de m3
    expect(h.map((x) => x.diferencia ?? 'blanco')).toEqual(['0.5', 'blanco', '1.25', '752939.25', '1.25', '20', '35'])
    expect(h.map((x) => x.severidad)).toEqual(['alta', 'media', 'alta', 'alta', 'alta', 'alta', 'alta'])
    expect(h[1]?.detalle).toContain('latente') // C47: R46 ($) está en blanco
    expect(h.slice(5).every((x) => x.esperado === 'm3' && x.observado === 'km')).toBe(true)
    // lo que no se pudo comprobar se declara
    const r = inf.resultados.find((x) => x.reglaId === 'DYP-007')
    expect(r?.pendientes.join(' ')).toMatch(/26 referencias a libros externos/)
    expect(r?.pendientes.join(' ')).toMatch(/29 fórmulas con producto o cociente/)
  })

  it('DYP-013 · totales de PO-2, PO-2C, 2PA y 2PAAB: filas de importe omitidas, término no aditivo y participaciones (C-DYP-P08/P09/P10/P11)', () => {
    const h = hall('DYP-013')
    expect(h.map((x) => x.id)).toEqual([
      'DYP-013:PO-2!fila104:obra:omite-20_22_25_27_30_32_35_37_46_58_61_64_67_71_74_77_80', // P08: presas, pozos, bombeo, tuberías y drenaje
      'DYP-013:PO-2!fila108:total:omite-107', // P09: rehabilitación de maquinaria
      'DYP-013:PO-2C!fila104:obra:omite-46',
      'DYP-013:PO-2C!fila108:total:omite-107',
      'DYP-013:2PA!C106:termino_no_aditivo', // P10: C105/C102*100 dentro del total
      'DYP-013:2PA!fila106:participacion', // P11: 12 columnas
      'DYP-013:2PAAB!fila106:participacion', // P11: H106
    ])
    // Todo es fragilidad latente: las filas omitidas y C105 están en blanco o en cero (la auditoría: "sin importe vigente")
    expect(h.filter((x) => x.severidad === 'alta')).toHaveLength(0)
    expect(h.filter((x) => x.severidad === 'media')).toHaveLength(5)
    expect(h.slice(0, 5).every((x) => x.limites.join(' ').length > 0)).toBe(true)
    expect(h[0]?.detalle).toContain('fragilidad latente')
    expect(h[0]?.titulo).toContain('17 fila(s)')
    expect(h[0]?.detalle).toContain('26 columna(s)') // C, E y los meses con fórmula vertical
    expect(h[0]?.detalle).toContain('20 (Reparación obra civil)') // cada fila omitida se nombra con su rubro
    expect(h[5]?.referencias).toHaveLength(6) // muestra de las 12 columnas
    expect(h[5]?.titulo).toContain('12 columna(s)')
    expect(h[6]?.referencias).toEqual(['2PAAB!H106'])
  })

  it('DYP-014, DYP-015 y DYP-018 quedan "sin datos": Conchos no trae APU (Dt_Maq vacío) ni ejecución; no se dan por superadas', () => {
    expect(inf.reglasSinDatos).toEqual(['DYP-014', 'DYP-015', 'DYP-018'])
    expect(inf.resultados.filter((r) => r.estado === 'no_evaluable').every((r) => (r.motivo ?? '').length > 20)).toBe(true)
  })

  it('DYP-010 · 4 filas de PO-2 cuyos meses no suman el total (ha 5.5 frente a 5; m³ con 1.25 de más; km con 752,944.25); UM-1 sin diferencias', () => {
    const h = hall('DYP-010')
    expect(h.map((x) => x.id).sort()).toEqual(['DYP-010:PO-2!E43:suma_meses', 'DYP-010:PO-2!E48:suma_meses', 'DYP-010:PO-2!E50:suma_meses', 'DYP-010:PO-2!E51:suma_meses'])
    const ha = h.find((x) => x.id.endsWith('E43:suma_meses'))
    expect([ha?.esperado, ha?.observado, ha?.diferencia]).toEqual(['5.5', '5', '-0.5'])
    // el reparto de los meses activos es uniforme y contiguo en todas las filas: Conchos programa enero a abril en partes iguales
    expect(h.some((x) => /no_uniforme|discontinuo/.test(x.id))).toBe(false)
    expect(inf.resultados.find((x) => x.reglaId === 'DYP-010')?.pendientes.join(' ')).not.toMatch(/F22/)
  })

  it('MAQ-012 · 4 tipos revisados: las excavadoras superan 167 h/mes con 1 máquina elegible (305.22 h); todo el programa cae en enero-abril', () => {
    const r = inf.resultados.find((x) => x.reglaId === 'MAQ-012')
    expect(r?.cobertura).toMatchObject({ revisados: 4, identificados: 7 })
    expect(hall('MAQ-012').map((x) => x.id).sort()).toEqual(['MAQ-012:Excavadoras:capacidad', 'MAQ-012:UM1:concentracion'])
    const c = hall('MAQ-012').find((x) => x.id.endsWith(':capacidad'))
    expect([c?.esperado, c?.observado, c?.severidad]).toEqual(['167', '305.22', 'alta'])
    expect(c?.detalle).toContain('4 mes(es) excedidos')
    expect(c?.detalle).not.toContain('cabría')
    expect(hall('MAQ-012').find((x) => x.id.endsWith(':concentracion'))?.severidad).toBe('informativa')
  })

  it('NOR-001 · declara 8 parámetros con fuente; 5 notas informativas por valores alternos de los Anexos, ninguna como error del PacOT', () => {
    const r = inf.resultados.find((x) => x.reglaId === 'NOR-001')
    expect(r?.cobertura).toMatchObject({ revisados: 8, identificados: 17 })
    expect(hall('NOR-001').map((x) => x.id).sort()).toEqual(['NOR-001:PAR-01:alterno', 'NOR-001:PAR-02:alterno', 'NOR-001:PAR-03:alterno', 'NOR-001:PAR-07:alterno', 'NOR-001:PAR-17:alterno'])
    expect(hall('NOR-001').every((x) => x.severidad === 'informativa' && x.origen === 'norma')).toBe(true)
    expect(r?.pendientes.join(' ')).toContain('PAR-06')
  })

  it('NOR-002 · las 11 piezas del Manual y 5 del Anexo 3 que viven en el libro tienen datos; el resto se entrega aparte', () => {
    const r = inf.resultados.find((x) => x.reglaId === 'NOR-002')
    expect(r?.estado).toBe('superada')
    expect(r?.cobertura).toMatchObject({ revisados: 17, identificados: 27 })
    expect(r?.pendientes.join(' ')).toMatch(/6 documento\(s\) se entregan aparte/)
    expect(r?.pendientes.join(' ')).toMatch(/4 documento\(s\) se entregan aparte/)
  })

  it('NOR-004 · el ciclo 2026 - 2027 es el mismo en todas las hojas (el catálogo se excluye) y los meses van de octubre a septiembre', () => {
    const r = inf.resultados.find((x) => x.reglaId === 'NOR-004')
    expect(r?.estado).toBe('superada')
    expect(r?.cobertura.revisados).toBe(r?.cobertura.identificados)
    expect(r?.pendientes.join(' ')).toContain('última semana de septiembre')
  })

  it('INV-001 · T_I concilia con IO1 e IO3 (101.231 km de canal, 202.462 de caminos, 385 estructuras); el concreto de principales solo con "CANCRETO" (1.96 km)', () => {
    const r = inf.resultados.find((x) => x.reglaId === 'INV-001')
    expect(r?.cobertura).toMatchObject({ revisados: 16, identificados: 16 })
    expect(hall('INV-001').map((x) => x.id).sort()).toEqual(['INV-001:T_I!H52:reparto_fijo', 'INV-001:T_I!H53:reparto_fijo', 'INV-001:T_I!L36:categoria'])
    const c = hall('INV-001').find((x) => x.id.endsWith('L36:categoria'))
    expect([c?.esperado, c?.observado, c?.diferencia, c?.severidad]).toEqual(['98.951', '96.991', '-1.96', 'media'])
    expect(c?.detalle).toContain('"CANCRETO"')
    // ninguna diferencia dura: los totales de canales, caminos y estructuras concilian
    expect(hall('INV-001').some((x) => x.id.endsWith(':diferencia') || x.id.endsWith(':estructuras'))).toBe(false)
  })

  it('INV-005 · 4 pares de latitudes capturadas con una longitud (…°O) y 1 suelta; 2 con segundos = 60; los extremos contiguos coinciden (C-INV-005)', () => {
    const h = hall('INV-005')
    expect(inf.resultados.find((x) => x.reglaId === 'INV-005')?.cobertura).toMatchObject({ revisados: 240, identificados: 240 })
    const hem = h.filter((x) => x.id.endsWith(':hemisferio')).map((x) => x.id).sort()
    expect(hem).toEqual(['INV-005:IO1!F27:hemisferio', 'INV-005:IO1!F50:hemisferio', 'INV-005:IO1!F59:hemisferio', 'INV-005:IO1!F74:hemisferio',
      'INV-005:IO1!I26:hemisferio', 'INV-005:IO1!I49:hemisferio', 'INV-005:IO1!I58:hemisferio'])
    expect(h.filter((x) => x.id.endsWith(':hemisferio')).every((x) => x.severidad === 'alta')).toBe(true)
    expect(h.filter((x) => x.id.endsWith(':segundos_60')).map((x) => x.severidad)).toEqual(['informativa', 'informativa'])
    expect(h.some((x) => x.id.endsWith(':discontinuidad'))).toBe(false)
  })

  it('INV-006 · A = d(b+z·d) y Q = A·V concilian en los 60 tramos de IO1 (C-INV-009 no se reproduce con tolerancia de captura)', () => {
    const r = inf.resultados.find((x) => x.reglaId === 'INV-006')
    expect(r?.estado).toBe('superada')
    expect(r?.cobertura).toMatchObject({ revisados: 60, identificados: 60 })
  })

  it('INV-007 · 3 valores fuera de enumeración: TRAPECIOIDAL (60), CANCRETO (1) y un PK con espacio "K- 48+000"', () => {
    const h = hall('INV-007')
    expect(h.map((x) => x.id).sort()).toEqual(['INV-007:IO1!G:k--48+000', 'INV-007:IO1!U:cancreto', 'INV-007:IO1!V:trapecioidal'])
    expect(h.every((x) => x.severidad === 'informativa' && x.origen === 'pacot')).toBe(true)
    expect(h.find((x) => x.id.endsWith('trapecioidal'))?.titulo).toContain('60 registros')
  })

  it('el informe no declara un "aprobado": resume hallazgos y la cobertura real de reglas (23 de 52)', () => {
    expect(inf.coberturaReglas).toMatchObject({ implementadas: 23, totales: 52, ejecutadas: 23 })
    expect(inf.resumen.hallazgos).toBe(343)
    expect(inf.resumen.alta + inf.resumen.media + inf.resumen.informativa).toBe(343)
  })

  it('es determinista sobre el libro real', () => {
    expect(JSON.stringify(inf).length).toBeGreaterThan(1000)
  })
})
