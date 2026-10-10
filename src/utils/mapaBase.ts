/**
 * Mapa base para las ventanas de ubicación: imagen satelital de ArcGIS World_Imagery, pública y sin clave ni cuenta.
 * URL única: cualquier mapa nuevo debe tomarla de aquí. (Las copias de CARTO que ya existen en otras pantallas no se tocan:
 * es deuda anotada, no parte de esta entrega.)
 */
export const MAPA_BASE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
export const MAPA_BASE_ATRIBUCION = 'Imagen: Esri, Maxar, Earthstar Geographics'
export const MAPA_BASE_ZOOM_MAXIMO = 18
/** Fondo que se ve si las teselas no cargan: el mapa sigue mostrando trazo y marcadores. */
export const MAPA_FONDO_SIN_TESELAS = '#0b1624'
