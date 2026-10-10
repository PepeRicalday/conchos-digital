import { dec, type Dec } from './decimal'

/**
 * Un PK (cadenamiento) es una distancia: K12+350 = 12,350 m. No se resta como decimal de etiquetas.
 * Formatos vistos en los libros: "98+850", "K-0+000", "K-68+582 (texto)", " K-2+000".
 * El guion de "K-" es separador, no signo.
 */
export type ResultadoPK =
  | { readonly ok: true; readonly metros: Dec }
  | { readonly ok: false; readonly error: 'formato' | 'metros_fuera_de_rango' }

export function parsearPK(texto: string): ResultadoPK {
  const m = /^\s*K?\s*-?\s*(\d+)\s*\+\s*(\d+(?:\.\d+)?)/i.exec(texto)
  if (!m || m[1] === undefined || m[2] === undefined) return { ok: false, error: 'formato' }
  const km = dec(m[1])
  const resto = dec(m[2])
  if (resto.greaterThanOrEqualTo(1000)) return { ok: false, error: 'metros_fuera_de_rango' }
  return { ok: true, metros: km.times(1000).plus(resto) }
}

/** Longitud efectiva en km (3 decimales de precisión del formato, sin redondear aquí). */
export function longitudKm(inicial: Dec, final: Dec): Dec {
  return final.minus(inicial).abs().dividedBy(1000)
}

/** true si el PK final es menor que el inicial (tramo invertido). */
export function estaInvertido(inicial: Dec, final: Dec): boolean {
  return final.lessThan(inicial)
}

/**
 * Cadenamiento tal como se captura a mano en IO1/IO4/IO7: `K-44+ (AUTOPISTA)`, `TK-39+940-I (CANO) BOMBEO`,
 * `K-1+370 (LK-72+600, M-3)`, ` K- 23+765`, `.K-39+405-I`, `K-79-025`. Se toma el primer `K-km+mmm`; lo demás es
 * margen (-I/-D, M.I./M.D.) o nota. Si falta la parte de metros queda «parcial» (solo el kilómetro); si no hay un
 * `km+mmm` legible no hay PK: nunca se completa ni se corrige un dato.
 */
export interface PKLimpio {
  /** `k+mmm` normalizado, o null si no es completo. */
  readonly pk: string | null
  readonly metros: number | null
  /** Solo el kilómetro, cuando el PK viene truncado (`K-44+`). */
  readonly kmParcial: number | null
  readonly estado: 'completo' | 'parcial' | 'ilegible'
  /** Margen del canal declarado junto al PK: `-I`, `M.I.` → I; `-D`, `M.D.` → D. */
  readonly margen: 'I' | 'D' | null
  /** Texto sobrante (paréntesis, nombre de la obra…) tal como viene. */
  readonly nota: string | null
  /** Por qué no es completo. */
  readonly motivo: string | null
}

const sinPK = (estado: 'parcial' | 'ilegible', motivo: string, kmParcial: number | null = null): PKLimpio => (
  { pk: null, metros: null, kmParcial, estado, margen: null, nota: null, motivo }
)

export function limpiarPK(entrada: string | number | null | undefined): PKLimpio {
  if (entrada === null || entrada === undefined) return sinPK('ilegible', 'celda vacía')
  const texto = String(entrada).trim()
  if (texto === '') return sinPK('ilegible', 'celda vacía')
  const m = /K\s*-\s*(\d+)\s*\+\s*(\d+)(?:\.\d+)?/i.exec(texto)
  if (m && m[1] !== undefined && m[2] !== undefined) {
    const metros = Number(m[2])
    if (metros >= 1000) return sinPK('ilegible', `metros fuera de rango (+${m[2]})`)
    const km = Number(m[1])
    const resto = texto.slice((m.index ?? 0) + m[0].length)
    const mg = /^\s*-\s*([ID])(?![A-Za-z0-9])/i.exec(resto) ?? /(?<![A-Za-z])M\.\s*([ID])\.?(?![A-Za-z0-9])/i.exec(resto)
    const nota = resto.replace(/^\s*-\s*[ID](?![A-Za-z0-9])/i, '').trim()
    return {
      pk: `${km}+${String(metros).padStart(3, '0')}`, metros: km * 1000 + metros, kmParcial: null, estado: 'completo',
      margen: mg?.[1] === undefined ? null : (mg[1].toUpperCase() as 'I' | 'D'), nota: nota === '' ? null : nota, motivo: null,
    }
  }
  const parcial = /K\s*-\s*(\d+)\s*\+(?!\s*\d)/i.exec(texto)
  if (parcial?.[1] !== undefined) return sinPK('parcial', 'el cadenamiento trae el kilómetro pero no los metros', Number(parcial[1]))
  if (/K\s*-\s*\d+\s*-\s*\d+/i.test(texto)) return sinPK('ilegible', 'el kilómetro y los metros van separados por «-» en lugar de «+»')
  return sinPK('ilegible', 'no hay un cadenamiento km+mmm legible')
}
