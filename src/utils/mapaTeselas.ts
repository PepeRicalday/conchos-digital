/**
 * mapaTeselas — mapa base REAL para imágenes compartibles (Web Mercator + teselas XYZ), sin dibujar ningún trazo propio.
 * Núcleo puro y probable: encuadre, proyección, teselas necesarias, barra de escala y colocación de etiquetas sin solape.
 * La descarga (fetch → data URI) es la única parte con red y nunca bloquea: la tesela que falla simplemente no se dibuja.
 *
 * Proveedor: Esri World_Topo_Map (sin clave, CORS abierto; muestra ríos, relieve y poblados reales). CARTO sin clave devuelve una
 * tesela de «API KEY REQUIRED», por eso no se usa. La atribución es obligatoria y va visible en la imagen.
 */
export const TESELA_PX = 256;
export const TESELA_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
export const TESELA_ATRIBUCION = 'Mapa base: Esri, HERE, Garmin, FAO, NOAA, USGS, © OpenStreetMap contributors';

export interface PuntoGeo { lat: number; lon: number }
/** Ventana del mapa en píxeles del mundo a zoom `z`: (ox, oy) es la esquina superior izquierda. */
export interface VistaMapa { z: number; ox: number; oy: number; ancho: number; alto: number }
export interface Tesela { z: number; x: number; y: number; /** posición dentro de la vista, px */ px: number; py: number }
export interface TeselaConUri extends Tesela { uri: string }

const mundo = (z: number): number => TESELA_PX * 2 ** z;

/** lat/lon → píxel del mundo (Web Mercator). */
export function aMundo(z: number, lat: number, lon: number): [number, number] {
    const s = Math.sin((lat * Math.PI) / 180);
    return [((lon + 180) / 360) * mundo(z), (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * mundo(z)];
}

/** Mayor zoom (≤ zMax) en que todos los puntos caben en ancho×alto con `margen` px; null sin puntos válidos. */
export function vistaMapa(puntos: PuntoGeo[], ancho: number, alto: number, margen = 80, zMax = 9): VistaMapa | null {
    const ok = puntos.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (ok.length === 0) return null;
    for (let z = zMax; z >= 3; z--) {
        const m = ok.map((p) => aMundo(z, p.lat, p.lon));
        const x0 = Math.min(...m.map((q) => q[0])), x1 = Math.max(...m.map((q) => q[0]));
        const y0 = Math.min(...m.map((q) => q[1])), y1 = Math.max(...m.map((q) => q[1]));
        if (x1 - x0 + 2 * margen <= ancho && y1 - y0 + 2 * margen <= alto) {
            return { z, ox: (x0 + x1) / 2 - ancho / 2, oy: (y0 + y1) / 2 - alto / 2, ancho, alto };
        }
    }
    return null;
}

/** lat/lon → píxel dentro de la vista. */
export function aPantalla(v: VistaMapa, lat: number, lon: number): [number, number] {
    const [wx, wy] = aMundo(v.z, lat, lon);
    return [wx - v.ox, wy - v.oy];
}

export function teselasDeVista(v: VistaMapa): Tesela[] {
    const n = 2 ** v.z;
    const out: Tesela[] = [];
    for (let x = Math.floor(v.ox / TESELA_PX); x <= Math.floor((v.ox + v.ancho - 1) / TESELA_PX); x++) {
        for (let y = Math.floor(v.oy / TESELA_PX); y <= Math.floor((v.oy + v.alto - 1) / TESELA_PX); y++) {
            if (y < 0 || y >= n) continue;
            out.push({ z: v.z, x: ((x % n) + n) % n, y, px: x * TESELA_PX - v.ox, py: y * TESELA_PX - v.oy });
        }
    }
    return out;
}

export const urlTesela = (t: Pick<Tesela, 'z' | 'x' | 'y'>): string => TESELA_URL.replace('{z}', String(t.z)).replace('{y}', String(t.y)).replace('{x}', String(t.x));

/** Blob → data URI sin FileReader (sirve en navegador y en Node, donde se prueba). */
const leerComoDataUri = async (blob: Blob): Promise<string> => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return bytes.length ? `data:${blob.type};base64,${btoa(bin)}` : '';
};

/** Baja las teselas de la vista; las que fallan (red, timeout, no-imagen) se omiten. Nunca lanza. */
export async function descargarTeselas(
    v: VistaMapa, { fetchFn = fetch, timeoutMs = 7000 }: { fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<TeselaConUri[]> {
    const una = async (t: Tesela): Promise<TeselaConUri> => {
        const res = await fetchFn(urlTesela(t), { mode: 'cors', signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!blob.type.startsWith('image/')) throw new Error('no es imagen');
        const uri = await leerComoDataUri(blob);
        if (!uri) throw new Error('sin datos');
        return { ...t, uri };
    };
    const r = await Promise.allSettled(teselasDeVista(v).map(una));
    return r.flatMap((x) => (x.status === 'fulfilled' ? [x.value] : []));
}

/** Metros por píxel a una latitud y zoom dados (teselas de 256 px). */
export const metrosPorPixel = (z: number, lat: number): number => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

/** Barra de escala: el mayor valor «redondo» en km cuya longitud cabe en `maxPx`. */
export function barraEscala(z: number, latCentro: number, maxPx = 170): { km: number; px: number } {
    const mpp = metrosPorPixel(z, latCentro);
    let mejor = { km: 5, px: 5000 / mpp };
    for (const km of [5, 10, 20, 25, 50, 100, 200]) if (km * 1000 / mpp <= maxPx) mejor = { km, px: (km * 1000) / mpp };
    return mejor;
}

// ── Colocación de etiquetas sin solape ──────────────────────────────────────────

export interface ItemEtiqueta { id: string; x: number; y: number; /** radio del marcador */ r: number; lineas: string[]; tam: number }
export interface Etiqueta { id: string; x: number; y: number; anchor: 'start' | 'end' | 'middle'; lineas: string[]; tam: number; caja: Caja }
export interface Caja { x0: number; y0: number; x1: number; y1: number }

const ancho = (l: string[], tam: number): number => Math.max(...l.map((s) => s.length)) * tam * 0.56;
const alto = (l: string[], tam: number): number => l.length * tam * 1.15;
const solapa = (a: Caja, b: Caja): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/**
 * Para cada marcador prueba posiciones (derecha, izquierda, arriba, abajo, diagonales) y toma la primera cuya caja no choque con
 * otra etiqueta, con ningún marcador ni salga del mapa. Si ninguna libre, usa la de menor solape.
 */
export function colocarEtiquetas(items: ItemEtiqueta[], anchoMapa: number, altoMapa: number, holgura = 8): Etiqueta[] {
    const marcadores: Caja[] = items.map((i) => ({ x0: i.x - i.r - 2, y0: i.y - i.r - 2, x1: i.x + i.r + 2, y1: i.y + i.r + 2 }));
    const puestas: Etiqueta[] = [];
    for (const it of items) {
        const w = ancho(it.lineas, it.tam), h = alto(it.lineas, it.tam), g = it.r + holgura;
        const cand: { x: number; y: number; anchor: Etiqueta['anchor']; caja: Caja }[] = [
            { x: it.x + g, y: it.y, anchor: 'start', caja: { x0: it.x + g, y0: it.y - h / 2, x1: it.x + g + w, y1: it.y + h / 2 } },
            { x: it.x - g, y: it.y, anchor: 'end', caja: { x0: it.x - g - w, y0: it.y - h / 2, x1: it.x - g, y1: it.y + h / 2 } },
            { x: it.x, y: it.y - g - h + it.tam, anchor: 'middle', caja: { x0: it.x - w / 2, y0: it.y - g - h, x1: it.x + w / 2, y1: it.y - g } },
            { x: it.x, y: it.y + g + it.tam, anchor: 'middle', caja: { x0: it.x - w / 2, y0: it.y + g, x1: it.x + w / 2, y1: it.y + g + h } },
            { x: it.x + g, y: it.y - g, anchor: 'start', caja: { x0: it.x + g, y0: it.y - g - h, x1: it.x + g + w, y1: it.y - g } },
            { x: it.x - g, y: it.y - g, anchor: 'end', caja: { x0: it.x - g - w, y0: it.y - g - h, x1: it.x - g, y1: it.y - g } },
            { x: it.x + g, y: it.y + g + it.tam, anchor: 'start', caja: { x0: it.x + g, y0: it.y + g, x1: it.x + g + w, y1: it.y + g + h } },
            { x: it.x - g, y: it.y + g + it.tam, anchor: 'end', caja: { x0: it.x - g - w, y0: it.y + g, x1: it.x - g, y1: it.y + g + h } },
        ];
        const dentro = (c: Caja) => c.x0 >= 6 && c.y0 >= 6 && c.x1 <= anchoMapa - 6 && c.y1 <= altoMapa - 6;
        const choques = (c: Caja) => puestas.filter((p) => solapa(c, p.caja)).length + marcadores.filter((m, k) => items[k].id !== it.id && solapa(c, m)).length;
        const libre = cand.find((c) => dentro(c.caja) && choques(c.caja) === 0);
        const elegida = libre ?? [...cand].sort((a, b) => Number(!dentro(a.caja)) * 9 + choques(a.caja) - (Number(!dentro(b.caja)) * 9 + choques(b.caja)))[0];
        // y de la primera línea: el texto SVG se ancla en la línea base.
        puestas.push({ id: it.id, x: elegida.x, y: elegida.caja.y0 + it.tam * 0.95, anchor: elegida.anchor, lineas: it.lineas, tam: it.tam, caja: elegida.caja });
    }
    return puestas;
}

export const hayChoque = (etiquetas: Etiqueta[]): boolean =>
    etiquetas.some((a, i) => etiquetas.some((b, j) => j > i && solapa(a.caja, b.caja)));
