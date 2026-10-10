import { describe, expect, it } from 'vitest'
import {
  AVISO_HONESTIDAD_COHERENCIA, TEXTO_SIN_DATOS_AMBOS, desdeComp, desdeConciliacion, desdeRegla, desdeVerif, describirEstado,
  ETIQUETAS_ESTADO, TEXTO_RAZON_ATIPICO, formatoPK, idLegible, nombreConcepto, nombreModulo, nombreRed, razonAtipicoDeId,
  redDeRotulo, rotuloDocumento, siglaAmbito, type EstadoConMotivo,
} from '../vocabulario'
import { hayEvidencias, libroSrl } from './ayuda/libroSrl'

const PROHIBIDAS = /correct|aprobad|conforme|v[aá]lid/i

describe('estados canónicos', () => {
  it('mapea EstadoVerif', () => {
    expect(desdeVerif('cuadra')).toEqual({ estado: 'coherente' })
    expect(desdeVerif('atipico')).toEqual({ estado: 'atipico' })
    expect(desdeVerif('no_cuadra')).toEqual({ estado: 'discrepa' })
    expect(desdeVerif('informativo')).toEqual({ estado: 'informativo' })
    expect(desdeVerif('no_evaluable', 'sin ficha')).toEqual({ estado: 'no_evaluable', motivo: 'sin ficha' })
  })
  it('mapea EstadoComp y EstadoConciliacion', () => {
    expect(desdeComp('cuadra').estado).toBe('coherente')
    expect(desdeComp('atipico').estado).toBe('atipico')
    expect(desdeComp('no_evaluable').estado).toBe('no_evaluable')
    expect(desdeConciliacion('coincide').estado).toBe('coherente')
    expect(desdeConciliacion('difiere').estado).toBe('discrepa')
    expect(desdeConciliacion('incompleto').estado).toBe('parcial')
    for (const e of ['sin_srl', 'sin_modulos', 'no_aplica_srl'] as const) {
      const r = desdeConciliacion(e)
      expect(r.estado).toBe('no_evaluable')
      expect(r.motivo ?? '').not.toBe('')
    }
  })
  it('mapea estados de reglas; no_evaluable siempre trae motivo', () => {
    expect(desdeRegla('superada').estado).toBe('coherente')
    expect(desdeRegla('hallazgo').estado).toBe('atipico')
    for (const e of ['no_evaluable', 'sin_datos', 'no_aplica', 'no_ejecutada', 'no_implementada', 'error_interno'] as const) {
      const r = desdeRegla(e)
      expect(r.estado).toBe('no_evaluable')
      expect(r.motivo?.length ?? 0).toBeGreaterThan(5)
    }
  })
  it('ninguna etiqueta dice correcto/aprobado/conforme/válido', () => {
    const todos: EstadoConMotivo[] = [
      ...(['cuadra', 'atipico', 'no_cuadra', 'no_evaluable', 'informativo'] as const).map((e) => desdeVerif(e)),
      ...(['coincide', 'difiere', 'sin_srl', 'sin_modulos', 'incompleto', 'no_aplica_srl'] as const).map(desdeConciliacion),
      ...(['superada', 'hallazgo', 'no_evaluable', 'sin_datos', 'no_aplica', 'no_ejecutada', 'no_implementada', 'error_interno'] as const).map(desdeRegla),
    ]
    for (const e of todos) {
      const d = describirEstado(e)
      expect(`${d.corta} ${d.larga} ${d.motivo ?? ''}`).not.toMatch(PROHIBIDAS)
    }
    for (const v of Object.values(ETIQUETAS_ESTADO)) expect(`${v.corta} ${v.larga}`).not.toMatch(PROHIBIDAS)
    expect(describirEstado({ estado: 'coherente' }).corta).toBe('Coherente')
    expect(describirEstado({ estado: 'atipico' }).larga).toBe('Atípico: candidato a revisión')
    expect(describirEstado({ estado: 'no_evaluable', motivo: 'x' }).motivo).toBe('x')
    expect(describirEstado({ estado: 'coherente' }).motivo).toBeNull()
  })
  it('textos de honestidad', () => {
    expect(AVISO_HONESTIDAD_COHERENCIA).toBe('Esto marca coherencia con el propio libro o un candidato a revisión; no es aprobación ni rechazo.')
    expect(TEXTO_SIN_DATOS_AMBOS).toBe('Sin datos en ambos')
  })
  it('razón del atípico por id', () => {
    expect(razonAtipicoDeId('CRI-02:55:DESAZOLVE')).toBe('criterio')
    expect(razonAtipicoDeId('INT-15:tramo:18')).toBe('conciliacion')
    expect(razonAtipicoDeId('descopete-vs-desazolve')).toBe('control_adicional')
    expect(TEXTO_RAZON_ATIPICO.criterio.corta).not.toBe(TEXTO_RAZON_ATIPICO.control_adicional.corta)
  })
})

describe('conceptos: grafías a canónico, rótulo intacto', () => {
  const casos: Array<[string, { red?: 'distribucion' | 'drenaje' | 'caminos'; bloque?: string }, string]> = [
    ['DESAZOLVE', {}, 'Desazolve'],
    ['Desazolve', { red: 'drenaje' }, 'Desazolve'],
    ['DESCOPETE BORDOS', { red: 'distribucion' }, 'Terracerías (descopete)'],
    ['Descopete bordos', { red: 'distribucion' }, 'Terracerías (descopete)'],
    ['Terracerias', { bloque: 'RED DE DISTRIBUCION' }, 'Terracerías (descopete)'],
    ['Terracerías', { red: 'distribucion' }, 'Terracerías (descopete)'],
    ['TERRACERÍAS', { red: 'distribucion' }, 'Terracerías (descopete)'],
    ['Terracerias', { red: 'caminos' }, 'Terracerías'],
    ['Terracerias', { red: 'drenaje' }, 'Terracerías'],
    ['Terracerías', { bloque: 'RED DE CAMINOS' }, 'Terracerías'],
    ['EXTRAC. PLANTAS ACUATICAS', {}, 'Extracción de plantas acuáticas'],
    ['EXTRACCIÓN DE PLANTAS ACUATICAS', {}, 'Extracción de plantas acuáticas'],
    ['Extracción de plantas acuaticas', {}, 'Extracción de plantas acuáticas'],
    ['LIMPIA Y DESHIERBE', {}, 'Limpia y deshierbe'],
    ['Extracción de plantas terrestres', {}, 'Limpia y deshierbe'],
    ['REPARACIÓN DE REVESTIMIENTO', {}, 'Reparación de revestimiento'],
    ['Reparación revestimiento', {}, 'Reparación de revestimiento'],
    ['Conformación (col. DESAZOLVE)', { red: 'caminos' }, 'Conformación'],
    ['Rastreo (col. LIMPIA Y DESHIERBE)', { red: 'caminos' }, 'Rastreo'],
    ['Terracerías (col. DESCOPETE BORDOS)', { red: 'caminos' }, 'Terracerías'],
    ['Reposición revestimiento (col. REPARACIÓN DE REVESTIMIENTO)', { red: 'caminos' }, 'Reposición de revestimiento'],
  ]
  it.each(casos)('«%s» %j a «%s»', (rotulo, ctx, esperado) => {
    const n = nombreConcepto(rotulo, ctx)
    expect(n.canonico).toBe(esperado)
    expect(n.rotuloLibro).toBe(rotulo)
    expect(n.conocido).toBe(true)
  })
  it('familia consistente', () => {
    expect(nombreConcepto('Descopete bordos', { red: 'distribucion' }).familia).toBe('descopete')
    expect(nombreConcepto('Terracerias', { red: 'caminos' }).familia).toBe('terracerias')
    expect(nombreConcepto('EXTRAC. PLANTAS ACUATICAS').familia).toBe('acuaticas')
  })
  it('SRL canales y M5 canales dan el mismo canónico', () => {
    expect(nombreConcepto('DESCOPETE BORDOS', { red: 'distribucion' }).canonico).toBe(nombreConcepto('Terracerias', { red: 'distribucion' }).canonico)
  })
  it('rótulo desconocido: oración segura, sin tildes inventadas, conocido:false', () => {
    const n = nombreConcepto('REPARACION DE COMPUERTA X')
    expect(n.canonico).toBe('Reparacion de compuerta x')
    expect(n.conocido).toBe(false)
    expect(n.rotuloLibro).toBe('REPARACION DE COMPUERTA X')
    const m = nombreConcepto('Mantenimiento, reparación o reposición de tubería')
    expect(m.canonico).toBe('Mantenimiento, reparación o reposición de tubería')
    expect(m.conocido).toBe(false)
  })
  it.skipIf(!hayEvidencias)('rótulos reales de la SRL (DIAG-01 y 3DN)', () => {
    const { libro } = libroSrl()
    const esperadosDiag = ['Limpia y deshierbe', 'Desazolve', 'Terracerías (descopete)', 'Extracción de plantas acuáticas', 'Reparación de revestimiento']
    expect(libro.conceptosDiagnostico.map((c) => nombreConcepto(c, { red: 'distribucion' }).canonico)).toEqual(esperadosDiag)
    for (const n of libro.necesidades) {
      const r = redDeRotulo(n.bloque)
      const v = nombreConcepto(n.concepto, { red: r, bloque: n.bloque })
      expect(v.rotuloLibro).toBe(n.concepto)
      expect(v.canonico.length).toBeGreaterThan(0)
      if (/^RED DE CAMINOS/i.test(n.bloque) && /terracer/i.test(n.concepto)) expect(v.canonico).toBe('Terracerías')
      if (/^RED DE DISTRIBUCION/i.test(n.bloque) && /^terracer/i.test(n.concepto)) expect(v.canonico).toBe('Terracerías (descopete)')
    }
  })
})

describe('redes, módulos, documento', () => {
  it('nombreRed y redDeRotulo', () => {
    expect(nombreRed('distribucion')).toBe('Red de distribución')
    expect(nombreRed('drenaje')).toBe('Red de drenaje')
    expect(nombreRed('caminos')).toBe('Red de caminos')
    expect(redDeRotulo('RED DE DISTRIBUCION')).toBe('distribucion')
    expect(redDeRotulo('Red de distribución (canales)')).toBe('distribucion')
    expect(redDeRotulo('Red de distribución en tubería (sección circular)')).toBe('tuberia')
    expect(redDeRotulo('Red de drenaje (drenes)')).toBe('drenaje')
    expect(redDeRotulo('RED DE CAMINOS')).toBe('caminos')
    expect(redDeRotulo('ESTRUCTURAS')).toBeNull()
  })
  it('módulo, sigla y documento', () => {
    const m5 = { tipo: 'MODULO', numeroModulo: 5 } as const
    const srl = { tipo: 'SRL', numeroModulo: null } as const
    expect(nombreModulo(m5)).toBe('Módulo 5')
    expect(nombreModulo(srl)).toBe('SRL Unidad Conchos')
    expect(siglaAmbito(m5)).toBe('M5')
    expect(siglaAmbito(srl)).toBe('SRL')
    expect(rotuloDocumento(m5)).toBe('PacOT del Módulo 5')
    expect(rotuloDocumento(srl)).toBe('PacOT de la SRL Unidad Conchos')
    expect(nombreModulo(m5)).not.toMatch(/PacOT/)
  })
})

describe('formatoPK', () => {
  it.each([
    ['68+720', 'K-68+720'], ['K-68+720', 'K-68+720'], [' K- 48+000', 'K-48+000'], ['K68+720', 'K-68+720'],
    ['0+000', 'K-0+000'], ['K-98+951', 'K-98+951'], ['98+850', 'K-98+850'], ['K-2+5', 'K-2+005'],
  ])('%s a %s', (e, s) => expect(formatoPK(e)).toBe(s))
  it('metros numéricos', () => {
    expect(formatoPK(68720)).toBe('K-68+720')
    expect(formatoPK(0)).toBe('K-0+000')
    expect(formatoPK(98951)).toBe('K-98+951')
    expect(formatoPK('68720')).toBe('K-68+720')
  })
  it('ilegible a S/D, nunca inventa', () => {
    expect(formatoPK(null)).toBe('S/D')
    expect(formatoPK(undefined)).toBe('S/D')
    expect(formatoPK('')).toBe('S/D')
    expect(formatoPK('K-44+')).toBe('S/D')
    expect(formatoPK('K-1+1500')).toBe('S/D')
    expect(formatoPK(NaN)).toBe('S/D')
  })
})

describe('idLegible', () => {
  it('INT-15 por tramo', () => {
    const r = idLegible('INT-15:tramo:18')
    expect(r.idCopiable).toBe('INT-15:tramo:18')
    expect(r.regla).toBe('INT-15')
    expect(r.titulo).toBe('Estructuras: IO4 contra IO1 · tramo de la fila 18')
  })
  it('CRI-02 con concepto canónico', () => {
    const r = idLegible('CRI-02:55:DESAZOLVE')
    expect(r.titulo).toBe('Tramo que se aparta del criterio del libro · fila 55 · Desazolve')
    expect(r.idCopiable).toBe('CRI-02:55:DESAZOLVE')
  })
  it('INT-14, resumen con red e id sin partes', () => {
    expect(idLegible('INT-14:12').titulo).toBe('Revestimiento del inventario contra el del diagnóstico · fila 12')
    expect(idLegible('INT-01:resumen:tuberia').titulo).toContain('Red de distribución en tubería')
    expect(idLegible('INT-13').titulo).toBe('Tubería listada en dos bloques')
  })
  it('id desconocido: título genérico + id', () => {
    const r = idLegible('XYZ-99:1')
    expect(r.titulo).toBe('Resultado XYZ-99:1')
    expect(r.idCopiable).toBe('XYZ-99:1')
  })
})
