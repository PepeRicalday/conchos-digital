/**
 * Coordenadas geográficas en grados, minutos y segundos tal como las traen los libros del PacOT:
 * `105°12'35.25"O`, ` 27°40'4.39"N`, ` 28° 8'38.00"N` (espacios sueltos, y a veces segundos = 60).
 * Un texto que no se puede leer da `null`, nunca 0: un cero sería una coordenada inventada.
 */

export type EjeGeo = 'lon' | 'lat'

export interface CoordenadaDMS {
  /** Grados decimales con signo (O/W y S negativos). */
  readonly valor: number
  /** Eje que declara la letra del hemisferio: N/S → latitud, E/O/W → longitud. */
  readonly eje: EjeGeo
}

const DMS = /^\s*(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['′’]\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|″|”|'')?\s*([NSEOW])\s*$/i

/**
 * Lee un DMS y dice a qué eje pertenece según su letra. Minutos 0-59; segundos 0-60 (el 60 se acarrea al minuto
 * por aritmética: 12°59'60" = 13°00'00"). Sin letra de hemisferio no se sabe el signo: `null`.
 */
export function parseDMSConEje(texto: string | null | undefined): CoordenadaDMS | null {
  if (texto === null || texto === undefined) return null
  const m = DMS.exec(texto)
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined || m[4] === undefined) return null
  const g = Number(m[1]), min = Number(m[2]), seg = Number(m[3])
  if (min > 59 || seg > 60) return null
  const letra = m[4].toUpperCase()
  const eje: EjeGeo = letra === 'N' || letra === 'S' ? 'lat' : 'lon'
  if (g > (eje === 'lat' ? 90 : 180)) return null
  const abs = g + min / 60 + seg / 3600
  if (abs > (eje === 'lat' ? 90 : 180)) return null
  const negativo = letra === 'S' || letra === 'O' || letra === 'W'
  // 9 decimales (~0.1 mm): quita el ruido de coma flotante sin perder precisión útil.
  return { valor: Math.round((negativo ? -abs : abs) * 1e9) / 1e9, eje }
}

/** Grados decimales con signo, o `null` si el texto no es un DMS legible. */
export function parseDMS(texto: string | null | undefined): number | null {
  return parseDMSConEje(texto)?.valor ?? null
}
