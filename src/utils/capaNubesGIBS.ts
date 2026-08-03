// ═══════════════════════════════════════════════════════════════════════════
// CAPA DE NUBOSIDAD ACTUAL (NASA GIBS) — SICA-005
// ---------------------------------------------------------------------------
// Superpone al plano la imagen satelital de nubes REAL de la zona, a diferencia
// del fondo de `mapaSatelital.ts` (World Imagery), que es terreno fijo sin
// componente temporal. Fuente: NASA GIBS, dos capas GOES-East ABI según la
// hora del corte:
//   · De día:  GeoColor — luz visible, la más fiel a "foto de nubes" a simple
//     vista, pero sin señal útil sin sol.
//   · De noche: Band13 (10.3 µm, IR de onda larga limpia) — nubes altas/frías
//     se ven brillantes contra la superficie cálida; es la capa estándar para
//     nubosidad nocturna en GOES-East, pública y sin API key igual que GeoColor.
// Ambas cuasi-tiempo-real (recorridas cada ~10 min, cobertura América).
//
// Cada capa tiene su PROPIO TileMatrixSet, zoom máximo y formato de imagen en
// el catálogo de GIBS (confirmado contra su GetCapabilities) — no son
// intercambiables:
//   · GeoColor: GoogleMapsCompatible_Level7, PNG, hasta zoom 7.
//   · Band13:   GoogleMapsCompatible_Level6, PNG, hasta zoom 5.
// El timestamp RESTful también debe llevar segundos (HH:MM:SSZ); GIBS
// responde 400 con el formato corto HH:MMZ para ambas capas.
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

interface DefCapa {
    id: string;
    tileMatrixSet: string;
    /** Zoom máximo soportado por el TileMatrixSetLimits real de esta capa en
     *  GIBS — pedir uno mayor devuelve 400, no una tesela vacía. */
    zoom: number;
    formato: 'png' | 'jpg';
}

/** Geocolor GOES-East: la más próxima a "foto de nubes ahora mismo" con
 *  cobertura sobre Chihuahua, pero solo tiene señal útil con luz de día. */
const CAPA_DIA: DefCapa = {
    id: 'GOES-East_ABI_GeoColor',
    tileMatrixSet: 'GoogleMapsCompatible_Level7',
    zoom: 6,
    formato: 'png',
};
/** Band13 (10.3 µm, IR ventana limpia) GOES-East: capa estándar para
 *  nubosidad nocturna — nubes brillantes por frías, superficie oscura por
 *  cálida. Sustituye a GeoColor fuera de la ventana de luz solar. */
const CAPA_NOCHE: DefCapa = {
    id: 'GOES-East_ABI_Band13_Clean_Infrared',
    tileMatrixSet: 'GoogleMapsCompatible_Level6',
    zoom: 5,
    formato: 'png',
};

const TILE_URL_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

export const lon2tile = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
export const lat2tile = (lat: number, z: number) => {
    const r = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

export interface CapaNubes {
    /** Mosaico de nubes en data URI, listo para <image href> en el SVG. */
    dataURI: string;
    minLon: number; maxLon: number; minLat: number; maxLat: number;
    ancho: number; alto: number;
    /** Instante (UTC, redondeado a 10 min) que retrata la imagen — se imprime en
     *  el plano para no confundir "nubosidad de ahora" con una toma vieja. */
    vigenteEn: Date;
    /** Capa GIBS usada: para no rotular una toma IR nocturna como "satélite
     *  visible" en el pie del plano — son lecturas distintas del mismo fenómeno. */
    fuente: 'geocolor' | 'infrarrojo';
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

/** Decide qué capa GIBS tiene señal útil para el instante y longitud dados.
 *  GeoColor usa luz visible: solo sirve con sol. Band13 (IR) no depende de
 *  luz y cubre el resto del día, así que la capa nocturna nunca deja el plano
 *  sin observación real disponible. */
function capaParaInstante(fecha: Date, lonDeg: number): DefCapa & { fuente: 'geocolor' | 'infrarrojo' } {
    // Hora solar local aproximada: UTC + lon/15. Entre 07:00 y 20:00 solar hay
    // luz suficiente en el valle del Conchos para el geocolor.
    const horaSolar = (fecha.getUTCHours() + lonDeg / 15 + 24) % 24;
    return (horaSolar >= 7 && horaSolar <= 20)
        ? { ...CAPA_DIA, fuente: 'geocolor' }
        : { ...CAPA_NOCHE, fuente: 'infrarrojo' };
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

/** GIBS responde 400 al formato corto (sin segundos) en el path RESTful;
 *  exige HH:MM:SSZ aunque la resolución temporal real sea de 10 minutos. */
function isoParaGIBS(d: Date): string {
    return d.toISOString().slice(0, 19) + 'Z'; // YYYY-MM-DDTHH:MM:SSZ
}

/**
 * Construye el mosaico de nubosidad real (GOES-East GeoColor de día, Band13
 * IR de noche) para la extensión geográfica indicada. Devuelve null si no hay
 * red, GIBS no tiene tesela para el corte pedido, o el mosaico queda
 * incompleto — el plano no debe mostrar un parche de nubes a medias, eso
 * sería peor que no mostrar la capa.
 */
export async function construyeCapaNubes(
    minLon: number, maxLon: number, minLat: number, maxLat: number,
): Promise<CapaNubes | null> {
    try {
        const centroLon = (minLon + maxLon) / 2;
        const momento = instanteDisponible();
        const { id: capaGIBS, tileMatrixSet, zoom, formato, fuente } = capaParaInstante(momento, centroLon);

        const x0 = Math.floor(lon2tile(minLon, zoom));
        const x1 = Math.floor(lon2tile(maxLon, zoom));
        const y0 = Math.floor(lat2tile(maxLat, zoom));
        const y1 = Math.floor(lat2tile(minLat, zoom));
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
                const url = `${TILE_URL_BASE}/${capaGIBS}/default/${tiempoGIBS}/`
                    + `${tileMatrixSet}/${zoom}/${ty}/${tx}.${formato}`;
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

        const tile2lon = (x: number) => (x / 2 ** zoom) * 360 - 180;
        const tile2lat = (y: number) => {
            const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
            return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
        };

        return {
            dataURI: canvas.toDataURL('image/jpeg', 0.85),
            minLon: tile2lon(x0), maxLon: tile2lon(x1 + 1),
            maxLat: tile2lat(y0), minLat: tile2lat(y1 + 1),
            ancho: W, alto: H,
            vigenteEn: momento,
            fuente,
        };
    } catch {
        return null; // sin red, CORS o GIBS sin tesela para el corte pedido
    }
}
