import type { VistaLibro } from '../nucleo/libro/vista'

/**
 * Admisión de PacOT: solo los libros de la SRL Unidad Conchos (Distrito de Riego 005 Delicias) entran a la plataforma.
 * Se lee la portada (hoja Resumen). Un dato que no cuadra con la SRL rechaza el libro; una discrepancia menor
 * (p. ej. un carácter del RFC) se admite con aviso y nunca se corrige en silencio.
 */

export const SRL_ADMITIDA = {
  nombre: 'UNIDAD CONCHOS',
  distritoNumero: '005',
  rfcSrl: 'AUU9203138I8',
} as const

export type TipoPacot = 'SRL' | 'MODULO'

export interface FichaPacot {
  readonly tipo: TipoPacot
  /** Número tal como encabeza "05. 5 DELICIAS"; null para el libro de la SRL. */
  readonly numeroModulo: number | null
  readonly moduloTexto: string
  readonly srl: string
  readonly rfcSrl: string
  readonly distrito: string
  readonly ciclo: string
}

export interface ResultadoAdmision {
  readonly admitido: boolean
  readonly ficha: FichaPacot | null
  /** Razones por las que se rechaza. */
  readonly motivos: readonly string[]
  /** Discrepancias que no impiden la admisión pero quedan visibles. */
  readonly avisos: readonly string[]
}

const norm = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase()
const sinEspacios = (t: string): string => norm(t).replace(/\s/g, '')

/** Mismo texto salvo confusiones visuales habituales (I/1, O/0, l/1). */
const parecido = (a: string, b: string): boolean => {
  const f = (t: string): string => t.replace(/[I1L]/g, '1').replace(/[O0]/g, '0')
  return a !== b && f(a) === f(b)
}

export function admitirPacot(libro: VistaLibro): ResultadoAdmision {
  const motivos: string[] = []
  const avisos: string[] = []
  const t = (c: string): string => libro.texto('Resumen', c)?.trim() ?? ''

  if (!libro.hoja('Resumen')) {
    return { admitido: false, ficha: null, motivos: ['El libro no tiene la hoja "Resumen"; no parece un PacOT.'], avisos }
  }

  const srl = t('B8')
  const rfc = t('B9')
  const distrito = t('B4')
  const moduloTexto = t('B6')
  const ciclo = t('B10')

  if (srl === '') motivos.push('Resumen!B8 (SRL) está vacío.')
  else if (norm(srl) !== SRL_ADMITIDA.nombre) motivos.push(`La SRL del libro es "${srl}"; esta plataforma solo admite SRL ${SRL_ADMITIDA.nombre}.`)

  if (!norm(distrito).startsWith(SRL_ADMITIDA.distritoNumero)) {
    motivos.push(`El distrito del libro es "${distrito || 's/d'}"; se esperaba el ${SRL_ADMITIDA.distritoNumero} (Delicias).`)
  }
  if (moduloTexto === '') motivos.push('Resumen!B6 (módulo de riego) está vacío.')
  if (!/^\d{4}\s*-\s*\d{4}$/.test(ciclo)) motivos.push(`El ciclo "${ciclo || 's/d'}" no tiene la forma AAAA - AAAA.`)

  if (rfc !== '') {
    const a = sinEspacios(rfc)
    if (a !== SRL_ADMITIDA.rfcSrl) {
      if (parecido(a, SRL_ADMITIDA.rfcSrl)) {
        avisos.push(`RFC de la SRL "${rfc}" difiere en un carácter de ${SRL_ADMITIDA.rfcSrl} (confusión I/1 u O/0); se admite. PENDIENTE DE COMPROBAR cuál es el correcto.`)
      } else motivos.push(`El RFC de la SRL "${rfc}" no corresponde a ${SRL_ADMITIDA.rfcSrl}.`)
    }
  } else avisos.push('Resumen!B9 (RFC de la SRL) está vacío.')

  if (motivos.length > 0) return { admitido: false, ficha: null, motivos, avisos }

  const esSrl = norm(moduloTexto).includes(SRL_ADMITIDA.nombre) || /^SRL\b/.test(norm(moduloTexto))
  const m = /^(\d{1,2})\s*\./.exec(moduloTexto)
  const numero = m?.[1] !== undefined ? Number(m[1]) : null
  if (!esSrl && numero === null) {
    return { admitido: false, ficha: null, motivos: [`No se reconoce el módulo "${moduloTexto}": debe ser "SRL UNIDAD CONCHOS" o empezar con su número ("05. …").`], avisos }
  }
  return {
    admitido: true,
    ficha: { tipo: esSrl ? 'SRL' : 'MODULO', numeroModulo: esSrl ? null : numero, moduloTexto, srl, rfcSrl: rfc, distrito, ciclo: ciclo.replace(/\s*-\s*/, ' - ') },
    motivos: [],
    avisos,
  }
}
