// ═══════════════════════════════════════════════════════════════════════════
// FONDO DE RELIEVE/SATELITAL REAL — Informe Geoclimático por Módulo (SICA-005)
// ---------------------------------------------------------------------------
// Capa de fondo que va DETRÁS del raster de color de cada variable climática
// en mapaVariableSVG() (exportClimaGeoInforme.ts), dando textura de terreno
// real en vez de un rectángulo gris plano.
//
// MODO DÍA (elevación solar > UMBRAL_ELEV_DIA_DEG): fondo PRE-COMPUESTO
// (JPEG) de textura satelital real (Sentinel-2 L2A TRUE_COLOR, color natural
// — vegetación/suelo/agua reales, mismo evalscript que
// supabase/functions/sentinel-truecolor-terreno-sync/index.ts usa para el
// vaso de La Boquilla) con un hillshade del terreno MULTIPLICADO encima
// (algoritmo de Horn, z-factor=2.2 — misma exageración vertical ya validada
// en VasoVisor3D.tsx para que el relieve real, ~903 m de rango en este
// bbox (re-sintetizado 2026-09-14 con el bbox real de extentModulos(), ver
// BBOX_HILLSHADE_DISTRITO abajo), se lea con claridad sin verse artificial),
// con dirección/longitud de
// sombra acorde a la posición solar REAL del corte
// (azimutSolar()/elevacionSolar(), cielo.ts) — sombras largas al
// amanecer/atardecer, cortas a mediodía. El DEM es de Copernicus GLO-30
// (30 m, vía OpenTopography), igual fuente que
// supabase/functions/dem-boquilla-sync/index.ts usa para el vaso de La
// Boquilla, pero este archivo NO llama a esa función en tiempo de informe:
// ni el terreno ni la textura satelital cambian de un informe a otro (la
// escena Sentinel-2 se fija una sola vez, no se resincroniza en cada
// descarga — el informe es un documento estático, no necesita estar "al
// día" con la temporada de cultivo cada vez), así que el compuesto
// textura+hillshade se PRE-CALCULÓ una sola vez (2026-09-14) para 8
// combinaciones de azimut/elevación representativas del barrido solar real
// a esta latitud (~28°N) y se embebió como JPEG estático en
// /public/dem-distrito-hillshade/ (ver manifest.json ahí: fuente exacta del
// DEM y de la escena Sentinel-2, fecha, nubosidad) — no existe función ni
// tabla nueva por esto (decisión explícita: un asset estático es más simple
// que una edge function que recalcularía cada vez el mismo resultado). En
// tiempo de generación del informe solo se elige, por nearest-neighbor en el
// espacio azimut/elevación, cuál de los 8 JPG ya calculados usar — igual que
// se hace clic en el asset más parecido, no una interpolación entre imágenes
// (el usuario aprobó explícitamente "no hace falta interpolar"). El
// compuesto se pre-renderiza en un solo PNG/JPG por ángulo (no 2 capas SVG
// separadas con blend-mode) porque el multiply real está entre TEXTURA y
// HILLSHADE (ambos assets estáticos, se pueden pre-multiplicar una vez sin
// perder nada); el raster de color de la variable climática — que si cambia
// cada informe — sigue siendo la capa SVG separada de arriba, con su propio
// mix-blend-mode:multiply contra este compuesto (ver mapaVariableSVG).
//
// MODO NOCHE (elevación solar <= UMBRAL_ELEV_DIA_DEG): capa NASA GIBS
// VIIRS_Black_Marble — MISMO patrón que capaNubesGIBS.ts (mismo host
// gibs.earthdata.nasa.gov, sin API key, mosaico de teselas → canvas → data
// URI construido en el navegador). Es un composite FIJO de 2016 (fecha de
// tesela hardcodeada en la URL RESTful, no la fecha del corte) — por eso
// SIEMPRE lleva una etiqueta explícita "referencia 2016, no tiempo real" allí
// donde se use (ver LEYENDA_VIIRS más abajo); nunca se presenta como la
// imagen de esa noche real (condición estricta con la que el usuario aprobó
// esta capa).
//
// RELIEVE SOBRE VIIRS (2026-09-14): VIIRS_Black_Marble en GIBS solo existe
// en el TileMatrixSet GoogleMapsCompatible_Level8 (confirmado contra el
// WMTSCapabilities real: zoom 9/10 devuelven 400 con cualquier
// TileMatrixSet) — no hay forma de pedir más resolución a esta fuente, así
// que sin relieve el fondo nocturno se veía como una imagen plana de puntos
// de luz sobre negro, sin sensación de terreno (inconsistente con el fondo
// de día, que sí tiene relieve DEM). Se compone el mismo DEM (Copernicus
// GLO-30, z-factor 2.2, mismo algoritmo de Horn + piso de luz ambiental 0.45
// que el fondo de día) como un hillshade PURO pre-calculado
// (hillshade_noche_315_45.jpg, ver HILLSHADE_NOCHE abajo) con iluminación
// FIJA convencional 315°NO/45° (no hay sol real que calcular de noche, a
// diferencia de los 8 ángulos del fondo de día) — se multiplica sobre el
// mosaico VIIRS en el propio canvas del navegador (globalCompositeOperation
// 'multiply') antes de exportar a data URI: el relieve oscurece las laderas
// en sombra sin apagar las luces del valle agrícola (donde el hillshade
// sale casi blanco). A diferencia del fondo de día, aquí NO se pre-compone
// el JPEG final (el mosaico VIIRS varía según qué teselas toque descargar
// por bbox, no es un asset fijo) — el hillshade es el único componente
// estático, la composición ocurre en tiempo de generación del informe.
//
// Por qué el fetch de VIIRS vive AQUÍ y no en Clima.tsx: capaNubesGIBS.ts ya
// sienta el precedente de que un archivo "generador de informe" puede hacer
// fetch directo a GIBS desde el navegador en tiempo de generación — el
// principio de "sin depender de la conexión a BD" que exportClimaGeoInforme.ts
// declara para sí mismo se refiere a Supabase/BD (ver comentario de
// OpcionesGeoInforme ahí), no a cualquier red; GIBS es información pública
// sin autenticación, igual categoría que los logos vía assetToDataURI. Mover
// esto a Clima.tsx solo trasladaría el mismo try/catch a un archivo que ya
// depende de Supabase por otras razones, sin ganar nada — y rompería la
// simetría con capaNubesGIBS.ts, que ya vive en utils/ por el mismo motivo.
// Fallback si falla el fetch (sin red, CORS, sin tesela): hillshade
// oscurecido con tono azul-noche — nunca se deja el mapa sin fondo ni se
// lanza una excepción (mismo contrato que capaNubesGIBS.ts: try/catch,
// devuelve null en la parte satelital, el llamador decide el fallback).
// ═══════════════════════════════════════════════════════════════════════════
import { azimutSolar, elevacionSolar } from './cielo';

/** Elevación solar por debajo de la cual se considera "noche" para efectos
 *  del fondo del mapa — no 0° (crepúsculo civil todavía da luz rasante
 *  utilizable en un hillshade) ni el umbral de 10-15° que usa cielo.ts/
 *  capaNubesGIBS.ts para radiación/GeoColor (esos necesitan luz *reflejada*
 *  suficiente para una imagen útil; el hillshade solo necesita saber de qué
 *  lado viene la luz, así que sigue siendo válido con el sol muy bajo). */
export const UMBRAL_ELEV_DIA_DEG = 5;

interface AnguloHillshade { id: string; azimut: number; elevacion: number; archivo: string; }

/** Los 8 ángulos pre-calculados (ver manifest.json junto a los JPG, con la
 *  fuente exacta de DEM/textura, z-factor y fecha de escena Sentinel-2) —
 *  duplicados aquí como constante porque el manifest solo se usa para
 *  trazabilidad/regeneración, no se fetchea en cada informe (evita un
 *  round-trip extra por algo que no cambia). Si se regeneran los assets,
 *  este arreglo debe actualizarse a mano (ver nota de la sesión
 *  2026-09-14: re-síntesis DEM+Sentinel-2, z-factor 2.2, compuesto JPEG). */
const ANGULOS_HILLSHADE: AnguloHillshade[] = [
    { id: 'amanecer_ne', azimut: 70, elevacion: 12, archivo: 'fondo_amanecer_ne.jpg' },
    { id: 'manana_e', azimut: 95, elevacion: 35, archivo: 'fondo_manana_e.jpg' },
    { id: 'media_manana_se', azimut: 120, elevacion: 55, archivo: 'fondo_media_manana_se.jpg' },
    { id: 'mediodia_alto', azimut: 160, elevacion: 75, archivo: 'fondo_mediodia_alto.jpg' },
    { id: 'tarde_sw', azimut: 220, elevacion: 55, archivo: 'fondo_tarde_sw.jpg' },
    { id: 'media_tarde_w', azimut: 260, elevacion: 35, archivo: 'fondo_media_tarde_w.jpg' },
    { id: 'atardecer_nw', azimut: 285, elevacion: 15, archivo: 'fondo_atardecer_nw.jpg' },
    { id: 'crepusculo', azimut: 295, elevacion: 6, archivo: 'fondo_crepusculo.jpg' },
];

/** Bbox real cubierto por los JPG de hillshade — EXACTAMENTE el mismo bbox
 *  que produce extentModulos() en exportClimaGeoInforme.ts (polígonos de
 *  los 6 módulos SRL + estaciones con rol≠presa [Módulo 1, 3, 5, Riego San
 *  Rafael] + el punto de Boquilla explícito + margen del 12%), calculado
 *  2026-09-14 contra los datos reales de clima_estaciones en Supabase. Antes
 *  este bbox cubría solo los polígonos de módulo (más angosto que el extent
 *  real del mapa) — con el fix de preserveAspectRatio en mapaVariableSVG
 *  (xMidYMid slice, ya no estira la imagen) eso dejaba bordes vacíos/parche
 *  flotando alrededor de la foto en vez de deformarla; re-sintetizado con
 *  este bbox para que la foto cubra el marco completo del mapa sin huecos.
 *  Ya no es estrictamente necesario que coincida al pixel con
 *  extentModulos() gracias a ese mismo fix (slice recorta el sobrante en vez
 *  de dejar huecos), pero mantenerlo igual evita cualquier recorte
 *  perceptible en los bordes. */
export const BBOX_HILLSHADE_DISTRITO = { west: -105.672304, south: 27.45251344, east: -105.115296, north: 28.40497356 };

const DIR_HILLSHADE = '/dem-distrito-hillshade';

/** Elige el JPG pre-compuesto (textura Sentinel-2 + hillshade multiplicado)
 *  más cercano (nearest-neighbor euclidiano en el espacio azimut/elevación,
 *  con azimut tratado como variable circular — 350° y 10° están a 20° de
 *  distancia, no a 340°) al azimut/elevación solar REAL del instante del
 *  corte. */
function anguloMasCercano(azimutDeg: number, elevacionDeg: number): AnguloHillshade {
    let mejor = ANGULOS_HILLSHADE[0], mejorDist = Infinity;
    for (const a of ANGULOS_HILLSHADE) {
        let dAz = Math.abs(a.azimut - azimutDeg) % 360;
        if (dAz > 180) dAz = 360 - dAz;
        const dElev = a.elevacion - elevacionDeg;
        const dist = dAz * dAz + dElev * dElev; // mismo peso por grado en ambos ejes — suficiente para 8 puntos, no requiere normalizar
        if (dist < mejorDist) { mejorDist = dist; mejor = a; }
    }
    return mejor;
}

export interface FondoHillshade {
    modo: 'dia';
    dataURI: string;
    /** Ángulo pre-calculado efectivamente usado — para depuración/pie de mapa si hiciera falta. */
    anguloUsado: AnguloHillshade;
    /** Bbox REAL que cubre el JPG (BBOX_HILLSHADE_DISTRITO, fijo desde que se
     *  generó el asset) — el consumidor (mapaVariableSVG) debe dibujar esta
     *  imagen posicionada con ESTE bbox, nunca estirada al extent del mapa
     *  (que varía por variable e incluye un margen del 12% + a veces Boquilla,
     *  ver extentModulos() en exportClimaGeoInforme.ts): si ambos bbox no
     *  coinciden, la imagen se deforma y el terreno real queda desplazado
     *  respecto a las coordenadas/estaciones dibujadas encima — bug
     *  reportado por el usuario 2026-09-14 (estación Boquilla apareciendo
     *  sobre tierra seca en vez de junto al vaso visible en la foto). Mismo
     *  principio que FondoNocturno ya aplicaba correctamente con su propio
     *  minLon/maxLon/minLat/maxLat. */
    minLon: number; maxLon: number; minLat: number; maxLat: number;
}

/** Carga el JPG pre-compuesto (textura + hillshade) más cercano al
 *  azimut/elevación solar dados, como data URI (informe HTML autónomo, sin
 *  dependencias externas al abrirse offline — mismo motivo que
 *  assetToDataURI.ts). */
export async function cargaFondoHillshadeDia(azimutDeg: number, elevacionDeg: number): Promise<FondoHillshade | null> {
    try {
        const angulo = anguloMasCercano(azimutDeg, elevacionDeg);
        const res = await fetch(`${DIR_HILLSHADE}/${angulo.archivo}`);
        if (!res.ok) return null;
        const blob = await res.blob();
        const dataURI = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onloadend = () => (typeof r.result === 'string' ? resolve(r.result) : reject(new Error('lectura de JPG fallida')));
            r.onerror = () => reject(new Error('lectura de JPG fallida'));
            r.readAsDataURL(blob);
        });
        return {
            modo: 'dia', dataURI, anguloUsado: angulo,
            minLon: BBOX_HILLSHADE_DISTRITO.west, maxLon: BBOX_HILLSHADE_DISTRITO.east,
            minLat: BBOX_HILLSHADE_DISTRITO.south, maxLat: BBOX_HILLSHADE_DISTRITO.north,
        };
    } catch {
        return null; // asset no disponible (offline, 404) — el llamador cae a "sin fondo"
    }
}

// ── Modo noche: NASA GIBS VIIRS_Black_Marble ────────────────────────────────
const TILE_PX = 256;
const VIIRS_TILE_URL_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const VIIRS_LAYER = 'VIIRS_Black_Marble';
const VIIRS_TILE_MATRIX_SET = 'GoogleMapsCompatible_Level8';
const VIIRS_ZOOM = 8;
// Fecha de tesela FIJA — VIIRS_Black_Marble en GIBS solo publica el
// composite anual 2016 bajo este layer id (confirmado por investigación
// previa a esta sesión); pedir la fecha del corte actual devolvería 400. Por
// eso esta capa SIEMPRE debe presentarse etiquetada como referencia, nunca
// como observación de la noche real.
const VIIRS_FECHA_TESELA = '2016-01-01';

/** Texto de atribución OBLIGATORIO dondequiera que se dibuje la capa VIIRS —
 *  no es una nota opcional: es la condición bajo la que el usuario aprobó
 *  usar este layer (composite fijo, no tiempo real). */
export const LEYENDA_VIIRS = 'Luces nocturnas: referencia 2016 (VIIRS Black Marble), no tiempo real';

/** Hillshade puro (escala de grises, sin textura) para multiplicar sobre el
 *  mosaico VIIRS — mismo DEM y z-factor que el fondo de día, pero con
 *  iluminación FIJA convencional 315°NO/45° (no hay sol real que calcular de
 *  noche). Cubre el mismo BBOX_HILLSHADE_DISTRITO que los 8 JPG de día. */
const HILLSHADE_NOCHE_ARCHIVO = 'hillshade_noche_315_45.jpg';

function cargaImagenComoElement(url: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

function lon2tileWebMercator(lon: number, z: number): number { return ((lon + 180) / 360) * 2 ** z; }
function lat2tileWebMercator(lat: number, z: number): number {
    const r = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}
function tile2lon(x: number, z: number): number { return (x / 2 ** z) * 360 - 180; }
function tile2lat(y: number, z: number): number {
    const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export interface FondoNocturno {
    modo: 'noche';
    dataURI: string;
    minLon: number; maxLon: number; minLat: number; maxLat: number;
}

/**
 * Construye el mosaico VIIRS Black Marble para el bbox indicado — mismo
 * patrón de mosaico tesela→canvas que construyeCapaNubes() en
 * capaNubesGIBS.ts, adaptado al layer/TileMatrixSet propio de VIIRS (no son
 * intercambiables entre capas GIBS, cada una define los suyos). Devuelve
 * null si falla cualquier tesela (mosaico a medias sería peor que ninguno) —
 * el llamador debe caer al fallback azul-noche, nunca dejar el mapa vacío.
 */
export async function construyeFondoNocturnoVIIRS(
    minLon: number, maxLon: number, minLat: number, maxLat: number,
): Promise<FondoNocturno | null> {
    try {
        const x0 = Math.floor(lon2tileWebMercator(minLon, VIIRS_ZOOM));
        const x1 = Math.floor(lon2tileWebMercator(maxLon, VIIRS_ZOOM));
        const y0 = Math.floor(lat2tileWebMercator(maxLat, VIIRS_ZOOM));
        const y1 = Math.floor(lat2tileWebMercator(minLat, VIIRS_ZOOM));
        const nx = x1 - x0 + 1, ny = y1 - y0 + 1;
        if (nx < 1 || ny < 1 || nx * ny > 40) return null;

        // VIIRS Black Marble está topada en zoom 8 en TODO GIBS (verificado
        // 2026-09-14 contra el WMTSCapabilities real: cada variante de night
        // lights del catálogo —DayNightBand, GapFilled, CityLights— vive como
        // máximo en GoogleMapsCompatible_Level7/8, límite de la resolución
        // real del sensor VIIRS DNB [~750m/px], no de esta capa en particular
        // — no existe una fuente GIBS con más detalle real de luces
        // nocturnas). El mosaico crudo (256px/tesela) se dibuja primero en un
        // canvas de trabajo a su tamaño nativo, y de ahí se reescala a
        // ESCALA_SUAVIZADO con imageSmoothingEnabled + filter blur —el
        // upscale nativo del navegador (que dibuja el <image> SVG final más
        // grande vía CSS) se veía "en bloques" duros porque no interpola
        // entre ellos; este paso adelanta el escalado con interpolación
        // bilineal + un desenfoque sutil, para que el resultado se lea como
        // una imagen borrosa natural en vez de píxeles cuadrados — no agrega
        // ningún dato real, solo mejora la percepción visual del mismo dato.
        const ESCALA_SUAVIZADO = 3;
        const wCrudo = nx * TILE_PX, hCrudo = ny * TILE_PX;
        const W = wCrudo * ESCALA_SUAVIZADO, H = hCrudo * ESCALA_SUAVIZADO;

        const canvasCrudo = document.createElement('canvas');
        canvasCrudo.width = wCrudo; canvasCrudo.height = hCrudo;
        const ctxCrudo = canvasCrudo.getContext('2d');
        if (!ctxCrudo) return null;

        const trabajos: Promise<boolean>[] = [];
        for (let ty = y0; ty <= y1; ty++) {
            for (let tx = x0; tx <= x1; tx++) {
                const url = `${VIIRS_TILE_URL_BASE}/${VIIRS_LAYER}/default/${VIIRS_FECHA_TESELA}/`
                    + `${VIIRS_TILE_MATRIX_SET}/${VIIRS_ZOOM}/${ty}/${tx}.png`;
                trabajos.push(cargaImagenComoElement(url).then((img) => {
                    if (!img) return false;
                    ctxCrudo.drawImage(img, (tx - x0) * TILE_PX, (ty - y0) * TILE_PX);
                    return true;
                }));
            }
        }
        const logradas = (await Promise.all(trabajos)).filter(Boolean).length;
        if (logradas < nx * ny) return null;

        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.filter = 'blur(2.5px)'; // suaviza los bordes de tesela sin borrar los clústeres de luz
        ctx.drawImage(canvasCrudo, 0, 0, W, H);
        ctx.filter = 'none';

        // Relieve DEM multiplicado sobre las luces (ver nota HILLSHADE_NOCHE
        // arriba) — falla silenciosa si el asset no carga (offline, 404): el
        // mosaico VIIRS ya está completo y sigue siendo un fondo válido sin
        // relieve, no vale la pena descartar todo el trabajo de las teselas
        // por esto. El hillshade cubre BBOX_HILLSHADE_DISTRITO, que NO
        // coincide con el bbox de teselas de este canvas (más ancho, definido
        // por los límites de tesela de VIIRS_ZOOM) — se dibuja proyectando su
        // propio bbox real a coordenadas de píxel de ESTE canvas, mismo
        // principio que mapaVariableSVG usa para posicionar el fondo de día
        // sin asumir que los bboxes coinciden.
        const mosaicoWest = tile2lon(x0, VIIRS_ZOOM), mosaicoEast = tile2lon(x1 + 1, VIIRS_ZOOM);
        const mosaicoNorth = tile2lat(y0, VIIRS_ZOOM), mosaicoSur = tile2lat(y1 + 1, VIIRS_ZOOM);
        const hillshadeImg = await cargaImagenComoElement(`${DIR_HILLSHADE}/${HILLSHADE_NOCHE_ARCHIVO}`);
        if (hillshadeImg) {
            const lonToPx = (lon: number) => ((lon - mosaicoWest) / (mosaicoEast - mosaicoWest)) * W;
            const latToPx = (lat: number) => ((mosaicoNorth - lat) / (mosaicoNorth - mosaicoSur)) * H;
            const hx = lonToPx(BBOX_HILLSHADE_DISTRITO.west), hy = latToPx(BBOX_HILLSHADE_DISTRITO.north);
            const hw = lonToPx(BBOX_HILLSHADE_DISTRITO.east) - hx, hh = latToPx(BBOX_HILLSHADE_DISTRITO.south) - hy;
            ctx.globalCompositeOperation = 'multiply';
            ctx.drawImage(hillshadeImg, hx, hy, hw, hh);
            ctx.globalCompositeOperation = 'source-over';
        }

        return {
            modo: 'noche',
            dataURI: canvas.toDataURL('image/jpeg', 0.85),
            minLon: tile2lon(x0, VIIRS_ZOOM), maxLon: tile2lon(x1 + 1, VIIRS_ZOOM),
            maxLat: tile2lat(y0, VIIRS_ZOOM), minLat: tile2lat(y1 + 1, VIIRS_ZOOM),
        };
    } catch {
        return null; // sin red, CORS, o GIBS sin tesela — el llamador cae al fallback azul-noche
    }
}

/**
 * Punto de entrada único: decide día/noche por elevación solar REAL del
 * centro del bbox en el instante del corte (mismo modelo que el resto del
 * sistema, cielo.ts) y devuelve el fondo correspondiente. `null` significa
 * "sin fondo disponible" — el llamador (mapaVariableSVG) debe seguir
 * pintando el raster de color sin este fondo, nunca lanzar ni dejar el mapa
 * roto.
 */
export async function resuelveFondoHillshade(
    minLon: number, maxLon: number, minLat: number, maxLat: number, corte: Date,
): Promise<FondoHillshade | FondoNocturno | null> {
    const centroLon = (minLon + maxLon) / 2, centroLat = (minLat + maxLat) / 2;
    const elev = elevacionSolar(corte, centroLat, centroLon);
    if (elev > UMBRAL_ELEV_DIA_DEG) {
        const az = azimutSolar(corte, centroLat, centroLon);
        return cargaFondoHillshadeDia(az, elev);
    }
    return construyeFondoNocturnoVIIRS(minLon, maxLon, minLat, maxLat);
}
