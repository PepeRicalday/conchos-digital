/**
 * vectorizar-modulos — traza los logos oficiales de las A.C.U. (módulos 1, 2, 3, 4, 5 y 12) a SVG con fondo transparente.
 *
 *   node scripts/logo/vectorizar-modulos.mjs [--k=10] [--solo=1,5]
 *
 * Entrada:  scripts/logo/referencia/modulos/modulo_N.jpg  (JPEG oficial; NO se modifica)
 * Salida:   public/logos/modulos/modulo-N.svg  (capas de color trazadas con potrace, sin <image> ni <text>)
 *
 * Método: ampliar 3×, suavizar el ruido JPEG, reducir a K colores (k-means) y trazar cada color como capa. El blanco que toca
 * el borde de la imagen es el fondo y se descarta (transparente); el blanco interior (gota, reflejos) se conserva. Cada capa se
 * dilata 1 px para que no queden costuras entre colores. Es un trazo automático del mismo dibujo: no lo rediseña.
 * La A.C.U. de cada módulo debería validar el trazo antes de difundirlo en informes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Jimp = require('jimp');
const { Potrace } = require('potrace');

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../..');
const ENTRADA = join(AQUI, 'referencia/modulos');
const SALIDA = join(RAIZ, 'public/logos/modulos');
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=')[1];
const K = Number(arg('k', 10));
const MODULOS = arg('solo', '1,2,3,4,5,12').split(',').map(Number);
const ESCALA = 2;

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** k-means con inicialización k-means++ determinista (semilla fija) sobre una muestra de píxeles. */
function kmeans(px, k) {
    let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const paso = Math.max(1, Math.floor(px.length / 20000));
    const m = []; for (let i = 0; i < px.length; i += paso) m.push(px[i]);
    const cs = [m[Math.floor(rnd() * m.length)]];
    while (cs.length < k) {
        const d = m.map((p) => Math.min(...cs.map((c) => dist2(p, c))));
        const tot = d.reduce((a, b) => a + b, 0); let r = rnd() * tot, i = 0;
        while (i < d.length - 1 && (r -= d[i]) > 0) i++;
        cs.push(m[i]);
    }
    for (let it = 0; it < 25; it++) {
        const suma = cs.map(() => [0, 0, 0, 0]);
        for (const p of m) { let b = 0, bd = Infinity; cs.forEach((c, i) => { const d = dist2(p, c); if (d < bd) { bd = d; b = i; } }); suma[b][0] += p[0]; suma[b][1] += p[1]; suma[b][2] += p[2]; suma[b][3]++; }
        suma.forEach((s2, i) => { if (s2[3]) cs[i] = [s2[0] / s2[3], s2[1] / s2[3], s2[2] / s2[3]]; });
    }
    return cs;
}

async function trazar(mascara, w, h, color) {
    const img = new Jimp(w, h, 0xffffffff);
    for (let i = 0; i < mascara.length; i++) if (mascara[i]) { const x = i % w, y = (i / w) | 0; img.setPixelColor(0x000000ff, x, y); }
    const buf = await img.getBufferAsync(Jimp.MIME_PNG);
    const p = new Potrace({ turdSize: Number(arg('turd', 20)), optTolerance: 1.0, alphaMax: 1, threshold: 128 });
    await new Promise((ok, ko) => p.loadImage(buf, (e) => (e ? ko(e) : ok())));
    // Coordenadas a 1 decimal: el trazo pesa una fracción y no se nota a tamaños de interfaz.
    return p.getPathTag(color).replace(/-?\d+\.\d+/g, (v) => String(Math.round(Number(v) * 10) / 10));
}

function dilatar(m, w, h) {
    const o = new Uint8Array(m.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; if (m[i]) { o[i] = 1; continue; }
        if ((x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) || (y > 0 && m[i - w]) || (y < h - 1 && m[i + w])) o[i] = 1;
    }
    return o;
}

async function vectorizar(n) {
    const img = await Jimp.read(join(ENTRADA, `modulo_${n}.jpg`));
    img.resize(img.bitmap.width * ESCALA, img.bitmap.height * ESCALA, Jimp.RESIZE_BICUBIC).gaussian(1);
    const w = img.bitmap.width, h = img.bitmap.height, d = img.bitmap.data;
    const px = new Array(w * h); for (let i = 0; i < w * h; i++) px[i] = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
    const cs = kmeans(px, K);
    const etq = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) { let b = 0, bd = Infinity; for (let c = 0; c < cs.length; c++) { const dd = dist2(px[i], cs[c]); if (dd < bd) { bd = dd; b = c; } } etq[i] = b; }
    // Fondo: píxeles casi blancos conectados al borde de la imagen (inundación).
    const claro = (c) => cs[c][0] > 225 && cs[c][1] > 225 && cs[c][2] > 225;
    const fondo = new Uint8Array(w * h); const pila = [];
    const empuja = (x, y) => { const i = y * w + x; if (!fondo[i] && claro(etq[i])) { fondo[i] = 1; pila.push(i); } };
    for (let x = 0; x < w; x++) { empuja(x, 0); empuja(x, h - 1); } for (let y = 0; y < h; y++) { empuja(0, y); empuja(w - 1, y); }
    while (pila.length) { const i = pila.pop(), x = i % w, y = (i / w) | 0; if (x > 0) empuja(x - 1, y); if (x < w - 1) empuja(x + 1, y); if (y > 0) empuja(x, y - 1); if (y < h - 1) empuja(x, y + 1); }
    // Recorte al contenido (caja de lo que no es fondo) con margen.
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let i = 0; i < w * h; i++) if (!fondo[i]) { const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const mg = 6; x0 = Math.max(0, x0 - mg); y0 = Math.max(0, y0 - mg); x1 = Math.min(w - 1, x1 + mg); y1 = Math.min(h - 1, y1 + mg);
    const W = x1 - x0 + 1, H = y1 - y0 + 1;
    const capas = [];
    for (let c = 0; c < cs.length; c++) {
        const m = new Uint8Array(W * H); let area = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y + y0) * w + (x + x0); if (etq[i] === c && !fondo[i]) { m[y * W + x] = 1; area++; } }
        if (area < 60) continue;
        capas.push({ c, area, m: dilatar(m, W, H) });
    }
    capas.sort((a, b) => b.area - a.area);   // lo grande abajo, lo pequeño encima
    const paths = [];
    for (const k of capas) paths.push(await trazar(k.m, W, H, hex(cs[k.c])));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Logo de la A.C.U. Módulo ${n}"><title>A.C.U. Módulo ${n}</title>${paths.join('')}</svg>\n`;
    mkdirSync(SALIDA, { recursive: true });
    writeFileSync(join(SALIDA, `modulo-${n}.svg`), svg);
    console.log(`modulo-${n}.svg  ${W}×${H}  ${capas.length} capas  ${(svg.length / 1024).toFixed(0)} KB`);
}

for (const n of MODULOS) await vectorizar(n);
