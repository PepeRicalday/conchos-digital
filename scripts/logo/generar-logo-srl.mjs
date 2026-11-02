/**
 * generar-logo-srl — vectoriza el escudo de SRL Unidad Conchos (arte de dos colores) a SVG.
 *
 *   node scripts/logo/generar-logo-srl.mjs            traza, escribe los SVG y mide la fidelidad
 *
 * Entrada:  scripts/logo/referencia/srl/logo-srl-original.jpg  (el JPEG oficial de 399×348; NO se modifica)
 * Salidas:  public/logos/srl/logo-srl.svg (marrón institucional), logo-srl-claro.svg (crema, para fondos oscuros),
 *           logo-srl-negro.svg (una tinta), y la hoja de comparación en el scratchpad indicado por --hoja=<ruta>.
 *
 * Es un trazo automático del mismo dibujo: no rediseña ni simplifica el escudo. Se escala 4× antes de trazar para que las
 * curvas salgan suaves y se mide el IoU contra el original umbralizado (meta ≥ 0,97). El rótulo interior queda como curvas
 * (no hay <text>), así que no depende de ninguna tipografía. La SRL debería validar el trazo antes de difundirlo.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Jimp = require('jimp');   // 0.14 (la que usa potrace)
const potrace = require('potrace');

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../..');
const ORIGINAL = join(AQUI, 'referencia/srl/logo-srl-original.jpg');
const SALIDA = join(RAIZ, 'public/logos/srl');
const ESCALA = 2;
const UMBRAL = 150;            // 0 = negro, 255 = blanco; la tinta marrón queda por debajo
const MARRON = '#6B2D2D';
const CREMA = '#F7F3EA';
const NEGRO = '#161616';

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=')[1];

/** Imagen en grises y ampliada 4× (bicúbica) lista para trazar. */
async function preparar() {
    const img = await Jimp.read(ORIGINAL);
    img.greyscale().resize(img.bitmap.width * ESCALA, img.bitmap.height * ESCALA, Jimp.RESIZE_BICUBIC);
    return img;
}

/** Máscara de tinta (1 = tinta) de una imagen en grises. */
function mascara(img) {
    const { width: w, height: h, data } = img.bitmap;
    const m = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) m[i] = data[i * 4] < UMBRAL ? 1 : 0;
    return { w, h, m };
}

function bbox({ w, h, m }) {
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { x0, y0, x1, y1 };
}

function trazar(buffer) {
    return new Promise((ok, mal) => {
        potrace.trace(buffer, { threshold: UMBRAL, blackOnWhite: true, turdSize: 24, optTolerance: 1.0, alphaMax: 1.0, turnPolicy: 'minority' }, (e, svg) => (e ? mal(e) : ok(svg)));
    });
}

/** Redondea los números del path a 1 decimal y recorta espacios: el SVG pesa ~40 % menos sin cambio visible a 4×. */
function compacta(d) {
    const enteros = d.replace(/-?\d+\.\d+/g, (n) => String(Math.round(+n))).replace(/[,\s]+/g, ' ').trim();
    // sintaxis mínima: sin espacio tras la letra y con la «C» implícita cuando se repite
    let prev = '';
    return enteros.split(/(?=[MCLZ])/).map((t) => {
        const cmd = t[0], resto = t.slice(1).trim();
        const out = cmd === prev && cmd === 'C' ? ` ${resto}` : `${cmd}${resto}`;
        prev = cmd;
        return out;
    }).join('').replace(/ -/g, '-');
}

function svg(d, caja, color, titulo) {
    const w = caja.x1 - caja.x0 + 1, h = caja.y1 - caja.y0 + 1;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${caja.x0} ${caja.y0} ${w} ${h}" role="img" aria-label="${titulo}"><title>${titulo}</title><path fill="${color}" fill-rule="evenodd" d="${d}"/></svg>\n`;
}

const img = await preparar();
const ref = mascara(img);
const caja = bbox(ref);
const crudo = await img.getBufferAsync(Jimp.MIME_PNG);
const traza = await trazar(crudo);
const d = compacta((/ d="([^"]+)"/.exec(traza) ?? [])[1] ?? '');
if (!d) throw new Error('potrace no devolvió trazo');

mkdirSync(SALIDA, { recursive: true });
const titulo = 'SRL Unidad Conchos, Delicias';
const archivos = { 'logo-srl.svg': MARRON, 'logo-srl-claro.svg': CREMA, 'logo-srl-negro.svg': NEGRO };
for (const [n, c] of Object.entries(archivos)) writeFileSync(join(SALIDA, n), svg(d, caja, c, titulo));
const peso = readFileSync(join(SALIDA, 'logo-srl.svg')).length;
console.log(`SVG → ${SALIDA}  (${(peso / 1024).toFixed(1)} KB, caja ${caja.x1 - caja.x0 + 1}×${caja.y1 - caja.y0 + 1} a ${ESCALA}×)`);

/* ── Fidelidad: rasteriza el SVG con Chromium y compara con la máscara del original (IoU) ── */
const { chromium } = await import(pathToFileURL(join(RAIZ, 'node_modules/playwright/index.mjs')).href);
const nav = await chromium.launch();
const pag = await nav.newPage({ viewport: { width: ref.w, height: ref.h }, deviceScaleFactor: 1 });
const w = caja.x1 - caja.x0 + 1, h = caja.y1 - caja.y0 + 1;
const uri = `data:image/svg+xml;base64,${Buffer.from(svg(d, caja, '#000', 'x')).toString('base64')}`;
await pag.setContent(`<body style="margin:0;background:#fff"><img id="i" src="${uri}" style="position:absolute;left:${caja.x0}px;top:${caja.y0}px;width:${w}px;height:${h}px"></body>`);
await pag.waitForFunction(() => document.getElementById('i').complete);
const png = await pag.screenshot();
const ras = await Jimp.read(png);
let inter = 0, union = 0, solo = 0, falta = 0;
for (let i = 0; i < ref.w * ref.h; i++) {
    const a = ref.m[i], b = ras.bitmap.data[i * 4] < 128 ? 1 : 0;
    if (a && b) inter++; if (a || b) union++; if (b && !a) solo++; if (a && !b) falta++;
}
console.log(`IoU = ${(inter / union).toFixed(4)}  (sobra ${solo} px, falta ${falta} px, de ${union} px de tinta)  → meta ≥ 0.97`);

/* ── Hoja de comparación: original (izq), trazo (centro) y diferencia (der: rojo = falta, azul = sobra) ── */
const hoja = arg('hoja');
if (hoja) {
    const dif = new Jimp(ref.w, ref.h, 0xffffffff);
    for (let y = 0; y < ref.h; y++) for (let x = 0; x < ref.w; x++) {
        const i = y * ref.w + x, a = ref.m[i], b = ras.bitmap.data[i * 4] < 128 ? 1 : 0;
        dif.setPixelColor(a && b ? 0xbbbbbbff : a ? 0xe0242aff : b ? 0x0a7fdbff : 0xffffffff, x, y);
    }
    const sal = new Jimp(ref.w * 3, ref.h, 0xffffffff);
    sal.composite(img, 0, 0).composite(ras, ref.w, 0).composite(dif, ref.w * 2, 0);
    await sal.writeAsync(hoja);
    console.log('Hoja de comparación →', hoja);
}
await nav.close();
