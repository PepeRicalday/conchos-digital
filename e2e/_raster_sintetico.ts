// Raster NDVI SINTÉTICO (RGBA con las clases discretas de CLASES_NDVI) para probar el layout del informe sin red ni sesión.
// Imita el contrato de sentinel-ndvi-modulo-raster: rectángulo del bbox, 20 m/píxel, sin dato = alfa 0 (parches de "nube").
import { deflateSync } from 'node:zlib';
import { CLASES_NDVI, claseNdvi } from '../src/utils/ndviRampa';
import type { Anillo } from '../src/utils/informeNdviSvg';
import type { ImagenRgba } from '../src/utils/informeNdviRasterImagen';
import type { RasterOk } from '../src/utils/informeNdviRaster';

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export function bboxDe(anillos: Anillo[], margen = 0.02): [number, number, number, number] {
    const lons = anillos.flat().map((p) => p[0]), lats = anillos.flat().map((p) => p[1]);
    const mx = (Math.max(...lons) - Math.min(...lons)) * margen, my = (Math.max(...lats) - Math.min(...lats)) * margen;
    return [Math.min(...lons) - mx, Math.min(...lats) - my, Math.max(...lons) + mx, Math.max(...lats) + my];
}

/**
 * Imagen RGBA a 20 m/píxel (como la función real): NDVI = media del módulo + ondulaciones (parcelas) + RUIDO por píxel (±0.12,
 * salta entre clases vecinas como el moteado real) + parches transparentes tipo nube (~20 % de los píxeles). Un módulo de ≈ 9 × 18 km
 * da ≈ 461 × 886 px: el peor caso realista para el reductor a PNG indexado.
 */
export function rasterSinteticoRgba(bbox: [number, number, number, number], ndviMedio: number, semilla = 1): ImagenRgba {
    const [x0, y0, x1, y1] = bbox;
    const mAncho = (x1 - x0) * 111320 * Math.cos(((y0 + y1) / 2) * Math.PI / 180), mAlto = (y1 - y0) * 111320;
    const ancho = Math.round(mAncho / 20), alto = Math.round(mAlto / 20);
    const rgba = new Uint8Array(ancho * alto * 4);
    for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
        const u = x / ancho, v = y / alto;
        const campo = Math.sin(u * 23 + semilla) * Math.cos(v * 31 - semilla) * 0.14 + Math.sin((u + v) * 61) * 0.06 + Math.sin(u * 7) * 0.08;
        const nube = Math.sin(u * 9 + semilla * 2) * Math.sin(v * 11 - semilla) > 0.55;
        const h = Math.sin((x * 12.9898 + y * 78.233 + semilla * 37.719)) * 43758.5453, ruido = (h - Math.floor(h) - 0.5) * 0.24;
        const ndvi = Math.max(-0.05, ndviMedio + campo + ruido);
        const o = (y * ancho + x) * 4;
        if (nube) { rgba[o + 3] = 0; continue; }
        const c = hex((claseNdvi(ndvi) ?? CLASES_NDVI[0]).color);
        rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
    }
    return { rgba, ancho, alto };
}

/** PNG RGBA (8 bits, sin indexar) tal como lo devuelve la función: sirve para medir el peso "de origen". */
export function pngRgba(img: ImagenRgba): Uint8Array {
    const crc = (b: Uint8Array) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; };
    const chunk = (t: string, d: Uint8Array) => { const o = Buffer.alloc(12 + d.length); o.writeUInt32BE(d.length, 0); o.write(t, 4, 'latin1'); Buffer.from(d).copy(o, 8); o.writeUInt32BE(crc(o.subarray(4, 8 + d.length)), 8 + d.length); return o; };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(img.ancho, 0); ihdr.writeUInt32BE(img.alto, 4); ihdr[8] = 8; ihdr[9] = 6;
    const crudo = Buffer.alloc((img.ancho * 4 + 1) * img.alto);
    for (let y = 0; y < img.alto; y++) Buffer.from(img.rgba.buffer, img.rgba.byteOffset + y * img.ancho * 4, img.ancho * 4).copy(crudo, y * (img.ancho * 4 + 1) + 1);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(crudo)), chunk('IEND', new Uint8Array(0))]);
}

export const rasterOkDe = (numero: number, mes: string, bbox: [number, number, number, number], dataUri: string, ancho: number, alto: number, nEscenas: number | null, pct: number | null): RasterOk =>
    ({ ok: true, dataUri, bbox, ancho, alto, nEscenas, pctValidos: pct, resolucionM: 20, mes, modulo: numero, nota: 'NDVI de la frontera del módulo' });
