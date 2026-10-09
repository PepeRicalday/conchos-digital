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
