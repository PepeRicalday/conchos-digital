// ═══════════════════════════════════════════════════════════════════════════
// CAPA DE NUBOSIDAD ACTUAL (NASA GIBS) — SICA-005
// ---------------------------------------------------------------------------
// Superpone al plano la imagen satelital de nubes REAL de la zona, a diferencia
// del fondo de `mapaSatelital.ts` (World Imagery), que es terreno fijo sin
// componente temporal. Fuente: NASA GIBS, capa GOES-East_ABI_GeoColor —
// geocolor cuasi-tiempo-real (recorrida cada ~10 min, cobertura América),
// pública y sin API key.
//
// Por qué NO se interpola nubosidad entre estaciones (ver cielo.ts): los
// sensores dan un % puntual, y rellenar el resto del plano con un gradiente
// inventaría dato donde no lo hay. La imagen GIBS, en cambio, es observación
// real de cobertura para TODA la zona, así que no incurre en esa regla — es
// la única fuente legítima para "nubosidad de la zona" y no solo por estación.
//
// Igual que el fondo satelital: si no hay red, CORS bloquea el canvas, o GIBS
// no tiene tesela para el corte horario pedido, se devuelve null y el plano
// sigue mostrando los íconos de nube por estación sin esta capa adicional.
// ═══════════════════════════════════════════════════════════════════════════

const TILE_PX = 256;
/** Zoom bajo: GOES-East GeoColor no tiene el detalle de una imagen aérea, y un
 *  zoom alto solo pide más teselas para el mismo nivel de detalle real. */
const ZOOM = 6;
/** Capa GIBS: geocolor GOES-East, la más próxima a "foto de nubes ahora mismo"
 *  con cobertura sobre Chihuahua entre las capas públicas de NASA. */
const CAPA_GIBS = 'GOES-East_ABI_GeoColor';
const TILE_MATRIX_SET = 'GoogleMapsCompatible_Level6';

const TILE_URL_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

export const lon2tile = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
export const lat2tile = (lat: number, z: number) => {
    const r = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

export interface CapaNubes {
    /** JPEG del mosaico de nubes en data URI, listo para <image href> en el SVG. */
    dataURI: string;
    minLon: number; maxLon: number; minLat: number; maxLat: number;
    ancho: number; alto: number;
    /** Instante (UTC, redondeado a 10 min) que retrata la imagen — se imprime en
     *  el plano para no confundir "nubosidad de ahora" con una toma vieja. */
    vigenteEn: Date;
}

function cargaTesela(url: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

/** GOES-East GeoColor solo tiene sentido de día (usa luz visible, no IR
 *  térmico); de noche GIBS no publica tesela útil para esta capa. */
function esDeDia(fecha: Date, lonDeg: number): boolean {
    // Hora solar local aproximada: UTC + lon/15. Entre 07:00 y 20:00 solar hay
    // luz suficiente en el valle del Conchos para el geocolor.
    const horaSolar = (fecha.getUTCHours() + lonDeg / 15 + 24) % 24;
    return horaSolar >= 7 && horaSolar <= 20;
}

/**
 * Instante más reciente con tesela disponible en GIBS para la capa geocolor.
 * GIBS publica cada ~10 min con ~20-30 min de rezago; se retrocede 35 min desde
 * "ahora" y se redondea al múltiplo de 10 anterior para pedir un corte que ya
 * exista, en vez de fallar por pedir uno demasiado reciente.
 */
function instanteDisponible(): Date {
    const ahora = new Date(Date.now() - 35 * 60000);
    ahora.setUTCSeconds(0, 0);
    ahora.setUTCMinutes(Math.floor(ahora.getUTCMinutes() / 10) * 10);
    return ahora;
}

function isoParaGIBS(d: Date): string {
    return d.toISOString().slice(0, 16) + 'Z'; // YYYY-MM-DDTHH:MMZ
}

/**
 * Construye el mosaico de nubosidad real (GOES-East GeoColor) para la extensión
 * geográfica indicada. Devuelve null si no hay red, es de noche (la capa no
 * tiene dato útil) o el mosaico queda incompleto — el plano no debe mostrar un
 * parche de nubes a medias, eso sería peor que no mostrar la capa.
 */
export async function construyeCapaNubes(
    minLon: number, maxLon: number, minLat: number, maxLat: number,
): Promise<CapaNubes | null> {
    try {
        const centroLon = (minLon + maxLon) / 2;
        const momento = instanteDisponible();
        if (!esDeDia(momento, centroLon)) return null; // sin geocolor útil de noche

        const x0 = Math.floor(lon2tile(minLon, ZOOM));
        const x1 = Math.floor(lon2tile(maxLon, ZOOM));
        const y0 = Math.floor(lat2tile(maxLat, ZOOM));
        const y1 = Math.floor(lat2tile(minLat, ZOOM));
        const nx = x1 - x0 + 1, ny = y1 - y0 + 1;
        if (nx < 1 || ny < 1 || nx * ny > 40) return null;

        const W = nx * TILE_PX, H = ny * TILE_PX;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d', { willReadFrequently: false });
        if (!ctx) return null;

        const tiempoGIBS = isoParaGIBS(momento);
        const trabajos: Promise<boolean>[] = [];
        for (let ty = y0; ty <= y1; ty++) {
            for (let tx = x0; tx <= x1; tx++) {
                const url = `${TILE_URL_BASE}/${CAPA_GIBS}/default/${tiempoGIBS}/`
                    + `${TILE_MATRIX_SET}/${ZOOM}/${ty}/${tx}.jpg`;
                trabajos.push(cargaTesela(url).then((img) => {
                    if (!img) return false;
                    ctx.drawImage(img, (tx - x0) * TILE_PX, (ty - y0) * TILE_PX);
                    return true;
                }));
            }
        }
        const logradas = (await Promise.all(trabajos)).filter(Boolean).length;
        // Umbral estricto (todas las teselas): un mosaico de nubes a medias es
        // engañoso —parecería que solo una parte del distrito tiene nubes—.
        if (logradas < nx * ny) return null;

        const tile2lon = (x: number) => (x / 2 ** ZOOM) * 360 - 180;
        const tile2lat = (y: number) => {
            const n = Math.PI - (2 * Math.PI * y) / 2 ** ZOOM;
            return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
        };

        return {
            dataURI: canvas.toDataURL('image/jpeg', 0.85),
            minLon: tile2lon(x0), maxLon: tile2lon(x1 + 1),
            maxLat: tile2lat(y0), minLat: tile2lat(y1 + 1),
            ancho: W, alto: H,
            vigenteEn: momento,
        };
    } catch {
        return null; // sin red, CORS o GIBS sin tesela para el corte pedido
    }
}
