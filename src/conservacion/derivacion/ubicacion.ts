import { parseDMSConEje } from '../nucleo/num/dms'
import type { EjeGeo } from '../nucleo/num/dms'
import type { CoordenadasLeidas, DefectoCoord, UbicacionResuelta } from './tipos'

/**
 * Lee el par longitud/latitud de dos celdas del inventario. Defecto conocido del PacOT: en varias filas la columna de latitud
 * trae el texto de la longitud (o al revés). Esa celda NO se reutiliza ni se «corrige»: queda null con su defecto y el punto sin
 * esa coordenada; la otra columna, si es válida, se conserva. Nunca devuelve 0 por falta de dato.
 */

const limpia = (t: string | null | undefined): string | null => {
  if (t === null || t === undefined) return null
  const s = t.replace(/\s+/g, ' ').trim()
  return s === '' ? null : s
}

function una(texto: string | null, otro: string | null, eje: EjeGeo): { valor: number | null; defecto: DefectoCoord | null } {
  if (texto === null) return { valor: null, defecto: 'vacia' }
  const c = parseDMSConEje(texto)
  if (c === null) return { valor: null, defecto: 'ilegible' }
  if (c.eje !== eje) return { valor: null, defecto: otro !== null && otro === texto ? 'duplicada' : 'eje_incorrecto' }
  return { valor: c.valor, defecto: null }
}

export function repararLonLat(lonTxt: string | null | undefined, latTxt: string | null | undefined): CoordenadasLeidas {
  const lt = limpia(lonTxt), at = limpia(latTxt)
  const lo = una(lt, at, 'lon'), la = una(at, lt, 'lat')
  return { lon: lo.valor, lat: la.valor, lonTexto: lt, latTexto: at, defectoLon: lo.defecto, defectoLat: la.defecto }
}

export const coordenadasCompletas = (c: CoordenadasLeidas): boolean => c.lon !== null && c.lat !== null

/** Texto del defecto para el aviso («La latitud repite la longitud…»). */
export function describirDefecto(c: CoordenadasLeidas): string | null {
  const partes: string[] = []
  const d = (eje: string, def: DefectoCoord | null, otro: string): void => {
    if (def === null) return
    partes.push(def === 'vacia' ? `${eje} vacía`
      : def === 'ilegible' ? `${eje} ilegible`
        : def === 'duplicada' ? `${eje} repite el valor de la ${otro} (duplicada)`
          : `${eje} trae una coordenada del otro eje`)
  }
  d('la longitud', c.defectoLon, 'latitud')
  d('la latitud', c.defectoLat, 'longitud')
  return partes.length === 0 ? null : partes.join('; ')
}

/** Ubicación declarada: 'valida' si hay las dos coordenadas; si no, 'sin_ubicar' (la estimación por cadenamiento la hace geo/). */
export function ubicacionDeclarada(c: CoordenadasLeidas): UbicacionResuelta {
  if (coordenadasCompletas(c)) return { estado: 'valida', lon: c.lon, lat: c.lat, motivo: null }
  return { estado: 'sin_ubicar', lon: null, lat: null, motivo: describirDefecto(c) ?? 'sin coordenadas' }
}
