/**
 * Símbolo de una familia (o «sin clasificar») como cadena SVG. Envuelve `simboloSvg` del catálogo y le añade el símbolo de las obras
 * que ninguna regla reconoce. Compartido por la pantalla, el mapa y la infografía: la forma identifica la familia, nunca solo el color.
 */
import { simboloSvg } from '../../../conservacion/estructuras/catalogo'
import type { OpcionesSimbolo } from '../../../conservacion/estructuras/catalogo'
import type { ClaveFamilia } from './ubicacionModelo'

export const COLOR_NINGUNA = '#64748b'

export function simboloClave(clave: ClaveFamilia, o: OpcionesSimbolo = {}): string {
  if (clave !== 'ninguna') return simboloSvg(clave, o)
  const lado = o.tamano !== undefined && o.tamano > 0 && o.tamano < 512 ? o.tamano : 24
  const trazo = o.punteado === true ? ' stroke-dasharray="2.6 2"' : ''
  const titulo = o.titulo !== undefined ? `<title>${o.titulo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>` : ''
  const acc = o.titulo !== undefined ? 'role="img"' : 'aria-hidden="true"'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}" viewBox="0 0 24 24" ${acc} focusable="false">${titulo}`
    + `<g fill="${o.relleno ?? '#ffffff'}" stroke="${o.contorno ?? COLOR_NINGUNA}" stroke-width="${o.grosor ?? 1.6}"${trazo}><circle cx="12" cy="12" r="9"/></g>`
    // El «?» va dibujado (trazo) y no como texto: en un símbolo de 20 px un glifo de texto quedaría por debajo de los 12 px.
    + `<g fill="none" stroke="${o.contorno ?? COLOR_NINGUNA}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.3 9.6a2.8 2.8 0 1 1 4.2 2.4c-1 .6-1.5 1.1-1.5 2.1"/></g><circle cx="12" cy="16.9" r="1.2" fill="${o.contorno ?? COLOR_NINGUNA}"/></svg>`
}
