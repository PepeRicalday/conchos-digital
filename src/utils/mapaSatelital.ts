// ═══════════════════════════════════════════════════════════════════════════
// FONDO SATELITAL GEOMORFOLÓGICO — SICA-005
// ---------------------------------------------------------------------------
// Descarga las teselas de imagen satelital (ArcGIS World Imagery) que cubren el
// distrito, las une en un solo lienzo y les aplica un tratamiento de realce
// GEOMORFOLÓGICO orientado a que los VASOS DE LAS PRESAS y los cuerpos de agua
// destaquen sobre el terreno árido del semidesierto chihuahuense.
//
// Por qué un tratamiento y no la imagen cruda: sobre la foto satelital sin
// procesar, el agua de los vasos y el suelo desnudo del valle tienen luminancia
// parecida en época de estiaje, y el trazo del canal se pierde. El realce separa
// ambas cosas por color, no solo por brillo.
//
// El resultado es un data URI PNG que se incrusta en el SVG del plano, de modo
// que el informe descargado sigue siendo un archivo HTML autónomo (sin red).
// ═══════════════════════════════════════════════════════════════════════════

/** Proveedor de teselas: mismo que ya usa el GeoMonitor (sin API key). */
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TILE_PX = 256;

/** Zoom 11 ≈ 28 teselas para el distrito: buen detalle sin descarga excesiva. */
const ZOOM = 11;

/**
 * Vasos conocidos del distrito: cortina y radio que envuelve holgadamente el
 * embalse. Delimitan DÓNDE puede haber agua embalsada, porque el color por sí
 * solo no distingue el vaso de una parcela regada (ver `realceGeomorfologico`).
 * El radio es generoso a propósito: cubre el embalse a capacidad, no el nivel
 * del día — recortar de más borraría las colas en época de aguas altas.
 */
const VASOS: { nombre: string; lat: number; lon: number; radioKm: number }[] = [
    { nombre: 'La Boquilla', lat: 27.5517, lon: -105.4375, radioKm: 26 },
    { nombre: 'Fco. I. Madero', lat: 28.3364, lon: -105.5278, radioKm: 12 },
];

// ── Web Mercator (EPSG:3857): lon/lat → coordenada de tesela fraccionaria ───
export const lon2tile = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
export const lat2tile = (lat: number, z: number) => {
    const r = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

export interface FondoSatelital {
    /** PNG en data URI, listo para <image href> dentro del SVG. */
    dataURI: string;
    /** Extensión geográfica REAL del lienzo (los bordes de las teselas). */
    minLon: number; maxLon: number; minLat: number; maxLat: number;
    ancho: number; alto: number;
}

/** Carga una tesela como <img>; resuelve a null si falla (se pinta hueco). */
function cargaTesela(url: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';   // necesario para poder exportar el canvas
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

/**
 * Realce geomorfológico sobre los píxeles del mosaico.
 *
 * Trabaja en dos clases separadas por índice espectral aproximado:
 *   · AGUA (vasos de presa, río, canal): en World Imagery el agua tiene azul
 *     dominante y baja luminancia. Se satura hacia un cian/azul profundo y se
 *     le sube el contraste para que el vaso quede nítido contra la orilla.
 *   · TERRENO: se lleva a una rampa hipsométrica cálida (ocres/sepias) y se le
 *     aplica realce local de relieve, que es lo que da la lectura geomorfológica
 *     de sierras y valle.
 */
function realceGeomorfologico(
    d: Uint8ClampedArray, W: number, dentroDeVaso?: (x: number, y: number) => boolean,
): void {
    for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const px = (i / 4) % W, py = Math.floor(i / 4 / W);

        // Detección de agua por índice tipo NDWI (verde frente a rojo).
        //
        // OJO con la intuición de "el agua es azul": en La Boquilla NO lo es. El
        // agua del vaso es TURBIA y verde —valores medidos sobre la imagen del
        // orden de rgb(23,67,16)—, con el azul como canal MÁS BAJO. Una regla
        // basada en "azul > rojo" detectaba el 0.22 % del lienzo y dejaba el
        // vaso entero sin realzar; este índice detecta ~5.6 %, que sí
        // corresponde a la superficie embalsada.
        //
        // POR QUÉ NO BASTA EL COLOR. El cultivo de riego en pleno vigor es
        // espectralmente indistinguible del agua turbia a este zoom: medido
        // sobre la imagen del distrito, la alfalfa regada da rgb(61,102,36) →
        // ndwi 0.250 / lum 89, mientras el vaso da rgb(21,68,14) → ndwi 0.522 /
        // lum 54. Los rangos SE SOLAPAN: no existe umbral RGB que separe ambos,
        // y al bajarlo el mosaico de parcelas de Delicias salía moteado de azul
        // como si fueran cuerpos de agua.
        //
        // Por eso el realce de agua se restringe GEOMÉTRICAMENTE al entorno de
        // los vasos conocidos (`dentroDeVaso`). Fuera de esa zona el verde se
        // trata como vegetación, que es lo que casi siempre es.
        const ndwi = (g - r) / (g + r + 1);
        const esAgua = ndwi > 0.10 && lum < 90
            && (!dentroDeVaso || dentroDeVaso(px, py));

        if (esAgua) {
            // Cian profundo: el vaso se lee de un vistazo contra el terreno ocre.
            // La intensidad sigue al índice, así que la zona más profunda del
            // embalse queda más saturada que las colas y bajos.
            const p = Math.min(1, (ndwi - 0.10) / 0.30);
            d[i]     = Math.round(8 + lum * 0.10);
            d[i + 1] = Math.round(105 + p * 85 + lum * 0.16);
            d[i + 2] = Math.round(158 + p * 80 + lum * 0.10);
        } else {
            // Terreno: rampa cálida con más contraste en las medias tintas, que
            // es donde se distingue el relieve de las sierras.
            const t = Math.min(1, Math.max(0, (lum - 28) / 190));
            const c = Math.min(1, Math.max(0, (t - 0.5) * 1.32 + 0.5));  // contraste
            // Interpola sombra (pardo oscuro) → media (ocre) → luz (arena clara)
            const [r0, g0, b0] = [58, 46, 34];
            const [r1, g1, b1] = [150, 126, 88];
            const [r2, g2, b2] = [226, 212, 178];
            let R: number, G: number, B: number;
            if (c < 0.5) {
                const k = c / 0.5;
                R = r0 + (r1 - r0) * k; G = g0 + (g1 - g0) * k; B = b0 + (b1 - b0) * k;
            } else {
                const k = (c - 0.5) / 0.5;
                R = r1 + (r2 - r1) * k; G = g1 + (g2 - g1) * k; B = b1 + (b2 - b1) * k;
            }
            // Conserva algo del verde original: delata la vegetación de riego,
            // que es justamente lo que distingue el valle agrícola del desierto.
            const verdor = Math.max(0, g - (r + b) / 2) / 60;
            d[i]     = Math.round(R * (1 - verdor * 0.45));
            d[i + 1] = Math.round(G * (1 - verdor * 0.05) + verdor * 42);
            d[i + 2] = Math.round(B * (1 - verdor * 0.55));
        }
    }
}

/**
 * Superficie mínima (píxeles) para aceptar una mancha como vaso de presa.
 * A zoom 11 cada píxel ≈ 0.0019 km²; 2000 px ≈ 3.8 km². El vaso de Boquilla
 * ronda los 100 km² a capacidad, mientras una parcela regada grande no pasa de
 * unas decenas de hectáreas: el corte los separa con holgura.
 */
const MIN_PX_VASO = 2000;

/**
 * Marca los píxeles que pertenecen a un VASO DE PRESA: agua por índice, cerca de
 * un vaso conocido y formando una mancha contigua grande.
 *
 * El filtro por tamaño es imprescindible: la parcela de riego en vigor tiene el
 * mismo color que el agua turbia (ndwi 0.25 / lum 89 frente a 0.52 / 54), de
 * modo que sin él el mosaico agrícola de Delicias aparecía teñido de azul como
 * si fuese lámina embalsada.
 *
 * Devuelve 1 = vaso, 0 = resto. Recorrido iterativo (pila explícita) para no
 * desbordar la pila de llamadas en manchas de miles de píxeles.
 */
function mascaraVasos(
    d: Uint8ClampedArray, W: number, H: number,
    cercaDeVaso: (x: number, y: number) => boolean,
): Uint8Array {
    const N = W * H;
    const cand = new Uint8Array(N);
    for (let p = 0; p < N; p++) {
        const i = p * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const ndwi = (g - r) / (g + r + 1);
        if (ndwi > 0.10 && lum < 90 && cercaDeVaso(p % W, (p / W) | 0)) cand[p] = 1;
    }

    const salida = new Uint8Array(N);
    const visto = new Uint8Array(N);
    const pila = new Int32Array(N);
    const blob = new Int32Array(N);
    for (let s = 0; s < N; s++) {
        if (!cand[s] || visto[s]) continue;
        let tope = 0, n = 0;
        pila[tope++] = s; visto[s] = 1;
        while (tope > 0) {
            const p = pila[--tope];
            blob[n++] = p;
            const x = p % W, y = (p / W) | 0;
            // Vecindad 4: suficiente y más estricta que la de 8 para no encadenar
            // parcelas contiguas a través de una esquina.
            if (x > 0     && cand[p - 1] && !visto[p - 1]) { visto[p - 1] = 1; pila[tope++] = p - 1; }
            if (x < W - 1 && cand[p + 1] && !visto[p + 1]) { visto[p + 1] = 1; pila[tope++] = p + 1; }
            if (y > 0     && cand[p - W] && !visto[p - W]) { visto[p - W] = 1; pila[tope++] = p - W; }
            if (y < H - 1 && cand[p + W] && !visto[p + W]) { visto[p + W] = 1; pila[tope++] = p + W; }
        }
        if (n >= MIN_PX_VASO) for (let k = 0; k < n; k++) salida[blob[k]] = 1;
    }
    return salida;
}

/**
 * Realce de relieve (unsharp direccional): resalta bordes de sierra y barrancas
 * para dar la lectura geomorfológica. Se aplica SOLO al terreno; los píxeles de
 * agua se dejan planos para que los vasos no queden con textura de ruido.
 */
function sombreadoRelieve(
    src: Uint8ClampedArray, dst: Uint8ClampedArray, W: number, H: number,
): void {
    const lumDe = (i: number) => 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
    for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
            const i = (y * W + x) * 4;
            // Tras el realce, el agua quedó en cian saturado (azul muy por encima
            // del rojo). Se salta para que la lámina del vaso quede lisa y no
            // adquiera textura de relieve, que insinuaría un terreno que no hay.
            if (src[i + 2] > src[i] + 60 && src[i + 1] > src[i] + 40) continue;
            // Gradiente noroeste→sureste, la iluminación cartográfica convencional.
            const iNW = ((y - 1) * W + (x - 1)) * 4;
            const iSE = ((y + 1) * W + (x + 1)) * 4;
            const g = (lumDe(iNW) - lumDe(iSE)) * 0.55;
            dst[i]     = Math.max(0, Math.min(255, src[i] + g));
            dst[i + 1] = Math.max(0, Math.min(255, src[i + 1] + g));
            dst[i + 2] = Math.max(0, Math.min(255, src[i + 2] + g));
        }
    }
}

/**
 * Construye el fondo satelital geomorfológico para la extensión indicada.
 * Devuelve null si no hay red o el canvas queda contaminado (CORS): en ese caso
 * el plano cae al fondo vectorial de siempre, en vez de quedarse en blanco.
 */
export async function construyeFondoSatelital(
    minLon: number, maxLon: number, minLat: number, maxLat: number,
    zoom = ZOOM,
): Promise<FondoSatelital | null> {
    try {
        const x0 = Math.floor(lon2tile(minLon, zoom));
        const x1 = Math.floor(lon2tile(maxLon, zoom));
        const y0 = Math.floor(lat2tile(maxLat, zoom));   // lat mayor = y menor
        const y1 = Math.floor(lat2tile(minLat, zoom));
        const nx = x1 - x0 + 1, ny = y1 - y0 + 1;
        if (nx < 1 || ny < 1 || nx * ny > 120) return null;   // cordura

        const W = nx * TILE_PX, H = ny * TILE_PX;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;

        // Fondo neutro: si alguna tesela falla, el hueco no queda transparente.
        ctx.fillStyle = '#d9cfba';
        ctx.fillRect(0, 0, W, H);

        const trabajos: Promise<boolean>[] = [];
        for (let ty = y0; ty <= y1; ty++) {
            for (let tx = x0; tx <= x1; tx++) {
                const url = TILE_URL.replace('{z}', String(zoom))
                    .replace('{y}', String(ty)).replace('{x}', String(tx));
                trabajos.push(cargaTesela(url).then((img) => {
                    if (!img) return false;
                    ctx.drawImage(img, (tx - x0) * TILE_PX, (ty - y0) * TILE_PX);
                    return true;
                }));
            }
        }
        const logradas = (await Promise.all(trabajos)).filter(Boolean).length;

        // Sin teselas suficientes el mosaico es un rectángulo liso: devolverlo
        // taparía el plano con un fondo beige vacío, PEOR que no tener imagen.
        // Se abandona para que el mapa use su fondo vectorial, que al menos
        // dibuja relieve y valle. Umbral: al menos la mitad del mosaico.
        if (logradas < Math.ceil((nx * ny) / 2)) return null;

        // ── Máscara de vasos ────────────────────────────────────────────────
        // Doble criterio, porque ninguno basta por separado:
        //  1) GEOGRÁFICO: solo cerca de un vaso conocido.
        //  2) MORFOLÓGICO: solo manchas de agua GRANDES Y CONTIGUAS. Un embalse
        //     es un cuerpo único de miles de píxeles; la parcela regada son
        //     muchas manchas pequeñas e inconexas. Este segundo filtro es el que
        //     limpia Delicias, donde la cortina de Madero cae dentro de la zona
        //     agrícola y el criterio de radio por sí solo no puede separarlas.
        const tile2px = (tx: number) => (tx - x0) * TILE_PX;
        const tile2py = (ty: number) => (ty - y0) * TILE_PX;
        const vasosPx = VASOS.map(v => {
            const cx = tile2px(lon2tile(v.lon, zoom));
            const cy = tile2py(lat2tile(v.lat, zoom));
            // 1° de latitud ≈ 111.32 km → radio en píxeles por la escala vertical.
            const pxPorGradoLat = tile2py(lat2tile(v.lat - 0.5, zoom)) - tile2py(lat2tile(v.lat + 0.5, zoom));
            return { cx, cy, r: (v.radioKm / 111.32) * pxPorGradoLat };
        });
        const cercaDeVaso = (px: number, py: number) =>
            vasosPx.some(v => (px - v.cx) ** 2 + (py - v.cy) ** 2 <= v.r ** 2);

        const datos = ctx.getImageData(0, 0, W, H);   // lanza si el canvas está "tainted"
        const mascara = mascaraVasos(datos.data, W, H, cercaDeVaso);

        // ── Tratamiento geomorfológico ──────────────────────────────────────
        realceGeomorfologico(datos.data, W, (px, py) => mascara[py * W + px] === 1);
        const conRelieve = new Uint8ClampedArray(datos.data);
        sombreadoRelieve(datos.data, conRelieve, W, H);
        ctx.putImageData(new ImageData(conRelieve, W, H), 0, 0);

        // Extensión REAL del lienzo = bordes de las teselas completas.
        const tile2lon = (x: number) => (x / 2 ** zoom) * 360 - 180;
        const tile2lat = (y: number) => {
            const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
            return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
        };

        return {
            dataURI: canvas.toDataURL('image/jpeg', 0.82),  // JPEG: mosaico grande
            minLon: tile2lon(x0), maxLon: tile2lon(x1 + 1),
            maxLat: tile2lat(y0), minLat: tile2lat(y1 + 1),
            ancho: W, alto: H,
        };
    } catch {
        return null;   // sin red, CORS o canvas contaminado → fondo vectorial
    }
}
