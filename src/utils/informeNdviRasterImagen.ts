/**
 * informeNdviRasterImagen — imagen NDVI real por módulo dentro del informe: reducción en cliente, PNG indexado liviano y
 * bloque HTML (un mini-mapa por módulo con el raster recortado al polígono por clipPath).
 *
 * Peso: la función devuelve ≈ 124 KB de PNG RGBA por módulo (≈ 750 KB en base64 para seis). Aquí cada raster se reduce a un
 * máximo de MAX_LADO_PX por lado (vecino más cercano: son clases discretas, no se mezclan colores) y se vuelve a codificar
 * como PNG INDEXADO de 4 bits (5 clases + transparente) → ≈ 3–12 KB por módulo.
 * Si un módulo falla (sin sesión, CDSE caído, tiempo, sin datos) su tarjeta lleva el plano vectorial con el aviso
 * "imagen no disponible: <motivo>": nunca un hueco silencioso. El NDVI es de la frontera del módulo, no de parcela.
 */
import { CLASES_NDVI, SD_FONDO, SD_TRAZO, colorClaseNdvi } from './ndviRampa';
import { esc } from './informeBase';
import { FS_MIN, monogramaHtml } from './informeNdviMarcas';
import { solicitarRastersDelPeriodo, type ClienteRaster, type MotivoFalloRaster, type RasterFallo, type RasterOk, type ResultadoRaster } from './informeNdviRaster';
import { trazoRelativo, type Anillo, type Contornos } from './informeNdviSvg';
import type { InformeNdvi, ModuloInforme } from './informeNdviDatos';

/** Lado máximo (px) del raster incrustado: a 20–33 m/px cada módulo ya cabe sobradamente en una tarjeta de ≈ 330 px. */
export const MAX_LADO_PX = 420;
/** Tope de tiempo de TODA la obtención de imágenes (ms): pasado ese tiempo, los módulos pendientes quedan con aviso. */
export const LIMITE_TOTAL_MS = 150_000;

// ── Reducción y PNG indexado (puros) ──────────────────────────────────────────────────────────────────────────────────────────
export interface ImagenRgba { rgba: Uint8ClampedArray | Uint8Array; ancho: number; alto: number }

/** Reduce por vecino más cercano (muestreo en el centro de cada bloque) de modo que el lado mayor sea ≤ maxLado. */
export function reducirVecino(img: ImagenRgba, maxLado = MAX_LADO_PX): ImagenRgba {
    const f = Math.min(1, maxLado / Math.max(img.ancho, img.alto));
    if (f >= 1) return img;
    const nw = Math.max(1, Math.round(img.ancho * f)), nh = Math.max(1, Math.round(img.alto * f));
    const out = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
        const sy = Math.min(img.alto - 1, Math.floor((y + 0.5) * img.alto / nh));
        for (let x = 0; x < nw; x++) {
            const sx = Math.min(img.ancho - 1, Math.floor((x + 0.5) * img.ancho / nw));
            const s = (sy * img.ancho + sx) * 4, o = (y * nw + x) * 4;
            out[o] = img.rgba[s]; out[o + 1] = img.rgba[s + 1]; out[o + 2] = img.rgba[s + 2]; out[o + 3] = img.rgba[s + 3];
        }
    }
    return { rgba: out, ancho: nw, alto: nh };
}

const PALETA: [number, number, number][] = CLASES_NDVI.map((c) => [parseInt(c.color.slice(1, 3), 16), parseInt(c.color.slice(3, 5), 16), parseInt(c.color.slice(5, 7), 16)]);

/** Índice de paleta de un píxel: 0 = transparente (S/D), 1..5 = clase de vigor más cercana por color. */
export function indiceDePixel(r: number, g: number, b: number, a: number): number {
    if (a < 128) return 0;
    let mejor = 1, d0 = Infinity;
    for (let i = 0; i < PALETA.length; i++) {
        const d = (r - PALETA[i][0]) ** 2 + (g - PALETA[i][1]) ** 2 + (b - PALETA[i][2]) ** 2;
        if (d < d0) { d0 = d; mejor = i + 1; }
    }
    return mejor;
}

let tablaCrc: Uint32Array | null = null;
function crc32(buf: Uint8Array): number {
    if (!tablaCrc) {
        tablaCrc = new Uint32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tablaCrc[n] = c >>> 0; }
    }
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = tablaCrc[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo: string, datos: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + datos.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, datos.length);
    for (let i = 0; i < 4; i++) out[4 + i] = tipo.charCodeAt(i);
    out.set(datos, 8);
    v.setUint32(8 + datos.length, crc32(out.subarray(4, 8 + datos.length)));
    return out;
}

async function zlibDeflate(datos: Uint8Array): Promise<Uint8Array> {
    const cs = new CompressionStream('deflate'); // 'deflate' de la Compression Streams API = formato zlib, el que exige PNG
    const w = cs.writable.getWriter();
    void w.write(datos as unknown as BufferSource); void w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

/** Codifica como PNG indexado de 4 bits (paleta = clases de vigor, índice 0 transparente por tRNS). Devuelve los bytes del archivo. */
export async function pngIndexado(img: ImagenRgba): Promise<Uint8Array> {
    const { ancho, alto, rgba } = img;
    const fila = Math.ceil(ancho / 2);
    const crudo = new Uint8Array((fila + 1) * alto);
    for (let y = 0; y < alto; y++) {
        const o = y * (fila + 1);
        crudo[o] = 0; // filtro 0
        for (let x = 0; x < ancho; x++) {
            const s = (y * ancho + x) * 4;
            const idx = indiceDePixel(rgba[s], rgba[s + 1], rgba[s + 2], rgba[s + 3]);
            crudo[o + 1 + (x >> 1)] |= x & 1 ? idx : idx << 4;
        }
    }
    const ihdr = new Uint8Array(13);
    const v = new DataView(ihdr.buffer);
    v.setUint32(0, ancho); v.setUint32(4, alto); ihdr[8] = 4; ihdr[9] = 3; // 4 bits, color indexado
    const plte = new Uint8Array(3 * (PALETA.length + 1));
    PALETA.forEach((c, i) => plte.set(c, 3 * (i + 1)));
    const trns = new Uint8Array(PALETA.length + 1).fill(255); trns[0] = 0;
    const partes = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('tRNS', trns), chunk('IDAT', await zlibDeflate(crudo)), chunk('IEND', new Uint8Array(0))];
    const out = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
    let o = 0; for (const p of partes) { out.set(p, o); o += p.length; }
    return out;
}

export function bytesADataUriPng(b: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(bin)}`;
}

/** Solo navegador: decodifica un data URI de imagen a RGBA (createImageBitmap + canvas). Lanza si no hay DOM. */
export async function decodificarImagenRgba(dataUri: string): Promise<ImagenRgba> {
    const bmp = await createImageBitmap(await (await fetch(dataUri)).blob());
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
    const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('El navegador no ofrece canvas 2D');
    ctx.drawImage(bmp, 0, 0);
    const id = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { rgba: id.data, ancho: bmp.width, alto: bmp.height };
}

/** Presupuesto de peso por imagen (bytes del PNG indexado; ≈ 27 KB en base64): seis módulos ≲ 160 KB de HTML. */
export const PRESUPUESTO_IMAGEN_BYTES = 20 * 1024;
/** Lados máximos que se prueban, de mayor a menor, hasta entrar en el presupuesto (un módulo muy "ruidoso" baja de resolución antes que pesar de más). */
export const LADOS_PROBADOS = [MAX_LADO_PX, 340, 280, 220, 180];

/** Reduce y codifica probando lados cada vez menores hasta que el PNG indexado cabe en `presupuesto`. Siempre devuelve el último intento. */
export async function reducirAPresupuesto(img: ImagenRgba, presupuesto = PRESUPUESTO_IMAGEN_BYTES): Promise<{ imagen: ImagenRgba; bytes: Uint8Array }> {
    let ultimo: { imagen: ImagenRgba; bytes: Uint8Array } | null = null;
    for (const lado of LADOS_PROBADOS) {
        const imagen = reducirVecino(img, lado);
        const bytes = await pngIndexado(imagen);
        ultimo = { imagen, bytes };
        if (bytes.length <= presupuesto) break;
    }
    return ultimo as { imagen: ImagenRgba; bytes: Uint8Array };
}

/** Reduce un raster ya descargado a PNG indexado liviano. Si no puede (sin DOM, imagen corrupta) devuelve el original. */
export async function reducirRaster(r: RasterOk): Promise<RasterOk> {
    try {
        const { imagen, bytes } = await reducirAPresupuesto(await decodificarImagenRgba(r.dataUri));
        return { ...r, dataUri: bytesADataUriPng(bytes), ancho: imagen.ancho, alto: imagen.alto };
    } catch { return r; }
}

// ── Bloque HTML ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const TEXTO_MOTIVO: Record<MotivoFalloRaster, string> = {
    'sin-sesion': 'no hay sesión con permiso para pedir la imagen',
    'cdse-caido': 'el servicio de Sentinel (Copernicus) no respondió',
    'mes-invalido': 'el mes no admite imagen (debe estar cerrado)',
    'sin-datos': 'el mes no tiene píxeles limpios tras la máscara de nubes',
    timeout: 'se agotó el tiempo de espera',
    error: 'error al pedirla',
};
export const textoMotivoRaster = (f: Pick<RasterFallo, 'motivo' | 'detalle'>): string => `${TEXTO_MOTIVO[f.motivo]}${f.detalle && f.motivo === 'error' ? ` (${f.detalle})` : ''}`;

const f1 = (n: number) => String(Number(n.toFixed(1)));
const INK = '#1f2328';
const ANCHO_TARJETA = 204, ALTO_MAX = 290, ANCHO_MIN = 150;

/** Mini-mapa de un módulo: raster (si hay) recortado al polígono, con el contorno encima; sin raster, el plano vectorial en el color de su clase. */
export function miniMapaModuloSvg(modulo: ModuloInforme, anillos: Anillo[], raster: RasterOk | null): string {
    const lons = anillos.flat().map((p) => p[0]), lats = anillos.flat().map((p) => p[1]);
    const mLon = (Math.max(...lons) - Math.min(...lons)) * 0.04 || 0.005, mLat = (Math.max(...lats) - Math.min(...lats)) * 0.04 || 0.005;
    const minLon = Math.min(...lons) - mLon, maxLon = Math.max(...lons) + mLon, minLat = Math.min(...lats) - mLat, maxLat = Math.max(...lats) + mLat;
    const cosLat = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const spanLon = (maxLon - minLon) * cosLat, spanLat = maxLat - minLat;
    const pie = 20; // franja inferior para la escala
    const k = Math.min((ANCHO_TARJETA - 6) / spanLon, (ALTO_MAX - pie) / spanLat);
    const wPoly = Math.round(spanLon * k) + 6, w = Math.max(wPoly, ANCHO_MIN), h = Math.round(spanLat * k) + pie;
    const dx = (w - wPoly) / 2 + 3; // módulos angostos: el dibujo se centra y queda lugar para escala y norte
    const px = (lon: number) => dx + (lon - minLon) * cosLat * k, py = (lat: number) => (maxLat - lat) * k;
    const d = anillos.map((a) => trazoRelativo(a.map(([lon, lat]) => [px(lon), py(lat)]), true)).join('');
    const id = `mm${modulo.numero}`;
    const relleno = colorClaseNdvi(modulo.ndvi) ?? `url(#${id}h)`;
    const hach = `<pattern id="${id}h" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="${SD_FONDO}"/><line x1="0" y1="0" x2="0" y2="7" stroke="${SD_TRAZO}" stroke-width="2"/></pattern>`;
    // Escala de 2 segmentos: 5 km si cabe en la mitad del ancho, si no 2 km
    const pxKm = k / 111.32;
    const km = [10, 5, 2, 1].find((q) => q * pxKm <= w * 0.5) ?? 1;
    const seg = (km * pxKm) / 2, y0 = h - 14;
    const escala = `<rect x="3" y="${y0}" width="${f1(seg)}" height="5" fill="${INK}"/><rect x="${f1(3 + seg)}" y="${y0}" width="${f1(seg)}" height="5" fill="#fff" stroke="${INK}" stroke-width=".8"/>
<text x="${f1(3 + 2 * seg + 5)}" y="${y0 + 6}" font-size="${FS_MIN}" fill="${INK}">${km} km</text>`;
    const norte = `<g transform="translate(${w - 13},${h - 14})"><path d="M0,-9 L4.5,4 L0,1.5 L-4.5,4 Z" fill="${INK}"/><text x="-12" y="4" font-size="${FS_MIN}" font-weight="700" fill="${INK}" text-anchor="middle">N</text></g>`;
    let imagen = '';
    if (raster) {
        const [bx0, by0, bx1, by1] = raster.bbox;
        imagen = `<image href="${raster.dataUri}" x="${f1(px(bx0))}" y="${f1(py(by1))}" width="${f1(px(bx1) - px(bx0))}" height="${f1(py(by0) - py(by1))}" preserveAspectRatio="none" clip-path="url(#${id}c)"/>`;
    }
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;display:block;margin:0 auto" role="img" aria-label="${raster ? 'Imagen NDVI' : 'Plano'} del Módulo ${modulo.numero}">
<defs>${hach}<path id="${id}p" d="${d}"/><clipPath id="${id}c"><use href="#${id}p" clip-rule="evenodd"/></clipPath></defs>
<use href="#${id}p" fill="${raster ? `url(#${id}h)` : relleno}" fill-rule="evenodd"/>${imagen}
<use href="#${id}p" fill="none" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>${escala}${norte}</svg>`;
}

/** Tarjeta de un módulo: encabezado (monograma, NDVI y clase), mini-mapa y pie de la imagen. */
export function tarjetaImagenModulo(modulo: ModuloInforme, anillos: Anillo[] | undefined, r: ResultadoRaster | undefined): string {
    const cab = `<div class="im-cab">${monogramaHtml(modulo.numero)}<b>${esc(modulo.nombre)}</b><span class="im-v">${modulo.ndvi != null ? modulo.ndvi.toFixed(2) : 'S/D'}</span></div>`;
    if (!anillos?.length) return `<div class="im">${cab}<div class="aviso">Imagen no disponible: no hay contorno del módulo.</div></div>`;
    const ok = r && r.ok ? r : null;
    const mapa = miniMapaModuloSvg(modulo, anillos, ok);
    const pie = ok
        ? `<p class="fuente">${ok.nEscenas != null ? `${ok.nEscenas} ${ok.nEscenas === 1 ? 'paso' : 'pasos'} de satélite` : 'pasos S/D'} · ${ok.pctValidos != null ? `${Math.round(ok.pctValidos * 100)} % de píxeles válidos` : 'píxeles válidos S/D'}</p>`
        : `<div class="aviso"><b>Imagen no disponible:</b> ${esc(r && !r.ok ? textoMotivoRaster(r) : 'no se solicitó')}. Se muestra el plano del módulo.</div>`;
    return `<div class="im">${cab}${mapa}${pie}</div>`;
}

export const CSS_IMAGENES = `
.imgs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 8px}
.im{border:1px solid var(--linea);border-top:3px solid var(--ink);border-radius:3px;padding:5px 7px;break-inside:avoid}
.im-cab{display:flex;align-items:center;gap:5px;margin-bottom:3px;font-size:9pt}
.im-cab .mono{font-size:8.5pt}
.im-v{margin-left:auto;font:700 13pt Georgia,serif}
.im .fuente{margin:3px 0 0}
.im .aviso{margin:4px 0 0;font-size:7.5pt}
`;

/** Bloque completo: nota de alcance, leyenda de clases (una sola vez) y una tarjeta por módulo. `resultados` vacío = nada solicitado. */
export function imagenesHtml(modulos: ModuloInforme[], contornos: Contornos, resultados: Record<number, ResultadoRaster>, mes: string): string {
    const tarjetas = modulos.map((m) => tarjetaImagenModulo(m, contornos[m.numero], resultados[m.numero])).join('');
    const nOk = modulos.filter((m) => resultados[m.numero]?.ok).length;
    const leyenda = `<ul class="leyenda-im" aria-label="Clases de vigor de la imagen">${CLASES_NDVI.map((c) => `<li><i style="background:${c.color}"></i>${esc(c.etiqueta)}</li>`).join('')}<li><i class="hach"></i>sin dato (nube o sin paso limpio)</li></ul>`;
    return `<p class="fuente">Fuente: Sentinel-2 L2A (Copernicus), mediana de ${esc(mes)} por píxel con máscara de nubes (SCL); mismas clases de vigor que el plano. NDVI de la frontera del módulo (incluye caminos, canales y suelo sin riego), no de parcela. Imágenes recortadas al polígono de cada módulo${nOk < modulos.length ? `; ${modulos.length - nOk} de ${modulos.length} sin imagen (ver el aviso de cada tarjeta)` : ''}.</p>
${leyenda}<div class="imgs">${tarjetas}</div>`;
}

export const CSS_LEYENDA_IM = `
.leyenda-im{display:flex;flex-wrap:wrap;gap:3px 12px;list-style:none;padding:0;margin:4px 0 8px;font-size:7.5pt}
.leyenda-im li{display:inline-flex;align-items:center;gap:5px}
.leyenda-im i{width:16px;height:10px;border:1px solid rgba(0,0,0,.4);display:inline-block}
`;

// ── Obtención (red) ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface OpcionesImagenes {
    cliente: ClienteRaster;
    /** Se llama al terminar cada módulo (también si falló). */
    onProgreso?: (hechos: number, total: number) => void;
    concurrencia?: number;
    timeoutPorModuloMs?: number;
    limiteTotalMs?: number;
    /** Reducción de cada raster (por defecto reducirRaster: canvas + PNG indexado). Se inyecta en pruebas. */
    reducir?: (r: RasterOk) => Promise<RasterOk>;
}

/**
 * Pide las imágenes de los módulos del informe (concurrencia 3, tope total de tiempo) y arma el bloque HTML. NUNCA lanza:
 * cada fallo queda en la tarjeta del módulo. El mes es el de referencia del informe (debe estar cerrado).
 */
export async function obtenerImagenesNdvi(datos: InformeNdvi, contornos: Contornos, o: OpcionesImagenes): Promise<string> {
    const mes = datos.mesReferencia;
    if (!mes) return '<div class="aviso"><b>Imagen satelital no disponible:</b> el informe no tiene un mes de referencia con datos.</div>';
    const numeros = datos.modulos.map((m) => m.numero);
    const resultados: Record<number, ResultadoRaster> = {};
    const falla = (modulo: number, motivo: MotivoFalloRaster, detalle: string): RasterFallo => ({ ok: false, motivo, detalle, mes, modulo });
    const reducir = o.reducir ?? reducirRaster;
    let hechos = 0;
    const avisa = () => { try { o.onProgreso?.(hechos, numeros.length); } catch { /* el progreso no debe romper la carga */ } };
    avisa();

    const pendientes: Promise<void>[] = [];
    const carga = solicitarRastersDelPeriodo(o.cliente, mes, numeros, {
        concurrencia: o.concurrencia ?? 3, timeoutMs: o.timeoutPorModuloMs,
        onProgreso: (_h, _t, modulo, r) => {
            // Reducir módulo a módulo evita tener seis PNG completos en memoria a la vez.
            const p = r.ok ? reducir(r).catch(() => r) : Promise.resolve(r);
            pendientes.push(p.then((x) => { if (!(modulo in resultados)) { resultados[modulo] = x; hechos++; avisa(); } }));
        },
    });
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const limite = new Promise<void>((res) => { temporizador = setTimeout(res, o.limiteTotalMs ?? LIMITE_TOTAL_MS); });
    await Promise.race([carga.then(() => Promise.all(pendientes)).then(() => undefined), limite]);
    if (temporizador) clearTimeout(temporizador);
    for (const n of numeros) if (!(n in resultados)) resultados[n] = falla(n, 'timeout', `Sin respuesta en ${Math.round((o.limiteTotalMs ?? LIMITE_TOTAL_MS) / 1000)} s en total`);
    return imagenesHtml(datos.modulos, contornos, resultados, mes);
}
