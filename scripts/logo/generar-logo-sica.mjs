/**
 * generar-logo-sica — fuente única del sello SICA-005 (vector) y de todos sus rasterizados.
 *
 *   node scripts/logo/generar-logo-sica.mjs          SVG + PNG (Playwright/Chromium)
 *   node scripts/logo/generar-logo-sica.mjs --solo-svg
 *
 * Geometría sobre retícula de 512 (centro 256). El texto del anillo se convierte a trazos con opentype.js
 * (Montserrat ExtraBold, OFL, en ./fuentes) para que el sello se vea idéntico en <img>, html-to-image,
 * impresión e iPad sin depender de fuentes del sistema.
 *
 * Salidas:
 *   public/logos/sica/sica005-sello.svg       sello a color (uso general, claro y oscuro)
 *   public/logos/sica/sica005-simbolo.svg     disco con río + hoja, sin texto (≤ 40 px, favicon)
 *   public/logos/sica/sica005-sello-mono.svg  una tinta blanca (sobre fotos o bandas de color)
 *   public/logos/SICA005.png (512), public/logos/SICA005-informe.png (256), íconos PWA, favicon.svg
 *   ../sica-capture/public/{SICA005.png, icon.png, icon-512.png, apple-touch-icon.png}
 *   ../Conservacion/Logos/{SICA005-sello.svg, SICA005-512.png}
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../..');
const PUB = join(RAIZ, 'public');
const DIR_SICA = join(PUB, 'logos/sica');
const CAPTURE = resolve(RAIZ, '../sica-capture/public');
const CONSERVACION = resolve(RAIZ, '../Conservacion/Logos');

/* ── Tokens ─────────────────────────────────────────────────────────────── */
const C = {
    navy: '#0B4F8A',      // anillo y texto (contraste 8.3:1 sobre blanco)
    aguaClaro: '#5BB8EC',
    aguaOscuro: '#1A74B8',
    hojaClaro: '#5CC46F',
    hojaOscuro: '#2A8A45',
    verde: '#2E9E4F',     // anillo interior
    blanco: '#FFFFFF',
};
const CX = 256;
const R_DISCO = 256;          // disco blanco: deja un filo blanco por fuera del anillo (contorno en fondos oscuros)
const R_ANILLO = 240, W_ANILLO = 14;     // 233–247
const R_VERDE = 146, W_VERDE = 12;       // 140–152
const R_INTERIOR = 140;

const fuente = opentype.loadSync(join(AQUI, 'fuentes/Montserrat-ExtraBold.ttf'));
const n = (v) => +v.toFixed(2);

/* ── Texto en arco convertido a trazos ──────────────────────────────────── */
function textoEnArco(texto, { tamano, rBase, arriba, tracking = 0 }) {
    const esc = tamano / fuente.unitsPerEm;
    const cap = (fuente.tables.os2.sCapHeight || 700) * esc;
    const rMedio = arriba ? rBase + cap / 2 : rBase - cap / 2;   // el espaciado se mide a media altura
    const glifos = fuente.stringToGlyphs(texto);
    const avances = glifos.map((g, i) => g.advanceWidth * esc + (i < glifos.length - 1 ? fuente.getKerningValue(g, glifos[i + 1]) * esc + tracking : 0));
    const total = avances.reduce((a, b) => a + b, 0);
    const angTotal = total / rMedio;
    let s = 0;
    const paths = [];
    glifos.forEach((g, i) => {
        const centro = s + (g.advanceWidth * esc) / 2;
        s += avances[i];
        const frac = centro / rMedio - angTotal / 2;
        const phi = arriba ? -Math.PI / 2 + frac : Math.PI / 2 - frac;
        const x = CX + rBase * Math.cos(phi), y = CX + rBase * Math.sin(phi);
        const rot = (phi * 180) / Math.PI + (arriba ? 90 : -90);
        const d = g.getPath(-(g.advanceWidth * esc) / 2, 0, tamano).toPathData(2);
        if (d) paths.push(`<path transform="translate(${n(x)} ${n(y)}) rotate(${n(rot)})" d="${d}"/>`);
    });
    return { svg: paths.join(''), angulo: angTotal };
}

/* ── Centro: río + hoja (coordenadas absolutas en la retícula de 512) ───── */
// El río nace angosto arriba a la izquierda (lejos), cruza, y baja en S ensanchándose hacia el frente.
const RIO = 'M100 174 C166 142 242 150 268 188 C292 224 278 266 252 300 C224 336 224 378 248 424 L140 424 C128 372 144 322 182 284 C208 258 226 238 222 216 C218 198 172 194 100 214 Z';
const RIO_BRILLO = ['M130 186 C168 171 210 171 236 186', 'M184 354 C189 328 203 307 222 289'];
const HOJA = 'M288 410 C258 330 300 234 400 182 C430 280 388 382 288 410 Z';
const HOJA_NERVIO = 'M294 398 C320 318 352 250 394 196';

function centro({ mono = false, escala = 1 } = {}) {
    const t = escala === 1 ? '' : ` transform="translate(${CX} ${CX}) scale(${escala}) translate(${-CX} ${-CX})"`;
    const rio = mono ? C.blanco : 'url(#sica-agua)';
    const hoja = mono ? C.blanco : 'url(#sica-hoja)';
    const corte = mono ? '#000' : C.blanco;   // en mono, los brillos son recortes (máscara)
    const brillos = `<g fill="none" stroke="${corte}" stroke-linecap="round">
      ${RIO_BRILLO.map((d, i) => `<path d="${d}" stroke-width="${i ? 7 : 8}"${mono ? '' : ' opacity=".85"'}/>`).join('')}
      <path d="${HOJA_NERVIO}" stroke-width="8"/>
    </g>`;
    const formas = `<path d="${RIO}" fill="${rio}"/><path d="${HOJA}" fill="${hoja}"/>`;
    if (mono) {
        return `<mask id="sica-m-centro" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
      <g${t}><circle cx="${CX}" cy="${CX}" r="${R_INTERIOR}" fill="#fff"/></g></mask>
    <mask id="sica-m-brillo" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
      <rect width="512" height="512" fill="#fff"/><g${t}>${brillos}</g></mask>
    <g mask="url(#sica-m-centro)"><g mask="url(#sica-m-brillo)"><g${t}>${formas}</g></g></g>`;
    }
    return `<clipPath id="sica-clip"><circle cx="${CX}" cy="${CX}" r="${R_INTERIOR * escala}"/></clipPath>
    <g clip-path="url(#sica-clip)"><g${t}>${formas}${brillos}</g></g>`;
}

const DEFS = `<defs>
    <linearGradient id="sica-agua" x1="150" y1="140" x2="230" y2="420" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.aguaClaro}"/><stop offset="1" stop-color="${C.aguaOscuro}"/></linearGradient>
    <linearGradient id="sica-hoja" x1="390" y1="170" x2="290" y2="410" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.hojaClaro}"/><stop offset="1" stop-color="${C.hojaOscuro}"/></linearGradient>
  </defs>`;

function separadores(aArriba, aAbajo, color) {
    // un punto a cada lado, a la mitad del hueco entre el fin del texto inferior (π/2 + aAbajo/2) y el
    // inicio del superior (3π/2 − aArriba/2); ángulos desde +x en sentido horario. El derecho es su espejo.
    const izq = Math.PI + (aAbajo - aArriba) / 4;
    const pts = [izq, Math.PI - izq];
    const r = (R_ANILLO - W_ANILLO / 2 + R_VERDE + W_VERDE / 2) / 2;
    return pts.map((p) => `<circle cx="${n(CX + r * Math.cos(p))}" cy="${n(CX + r * Math.sin(p))}" r="7" fill="${color}"/>`).join('');
}

function sello({ mono = false } = {}) {
    const tinta = mono ? C.blanco : C.navy;
    const sup = textoEnArco('SICA-005', { tamano: 70, rBase: 169, arriba: true, tracking: 3 });
    const inf = textoEnArco('DISTRITO 005', { tamano: 52, rBase: 212, arriba: false, tracking: 4 });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="SICA-005, Distrito de Riego 005">
  <title>SICA-005 · Distrito 005</title>
  ${mono ? '' : DEFS}
  ${mono ? '' : `<circle cx="${CX}" cy="${CX}" r="${R_DISCO}" fill="${C.blanco}"/>`}
  <circle cx="${CX}" cy="${CX}" r="${R_ANILLO}" fill="none" stroke="${tinta}" stroke-width="${W_ANILLO}"/>
  <circle cx="${CX}" cy="${CX}" r="${R_VERDE}" fill="none" stroke="${mono ? C.blanco : C.verde}" stroke-width="${W_VERDE}"/>
  <g fill="${tinta}">${sup.svg}${inf.svg}</g>
  ${separadores(sup.angulo, inf.angulo, tinta)}
  ${centro({ mono })}
</svg>
`;
}

function simbolo() {
    // a tamaño de favicon el texto no se lee: disco, anillo grueso y el centro ampliado
    const esc = 1.55;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="SICA-005">
  <title>SICA-005</title>
  ${DEFS}
  <circle cx="${CX}" cy="${CX}" r="${R_DISCO}" fill="${C.blanco}"/>
  <circle cx="${CX}" cy="${CX}" r="236" fill="none" stroke="${C.navy}" stroke-width="22"/>
  ${centro({ escala: esc })}
</svg>
`;
}

/* ── Escritura ──────────────────────────────────────────────────────────── */
mkdirSync(DIR_SICA, { recursive: true });
const svgs = {
    sello: sello(),
    simbolo: simbolo(),
    mono: sello({ mono: true }),
};
writeFileSync(join(DIR_SICA, 'sica005-sello.svg'), svgs.sello);
writeFileSync(join(DIR_SICA, 'sica005-simbolo.svg'), svgs.simbolo);
writeFileSync(join(DIR_SICA, 'sica005-sello-mono.svg'), svgs.mono);
writeFileSync(join(PUB, 'favicon.svg'), svgs.simbolo);
console.log('SVG →', DIR_SICA);

if (process.argv.includes('--solo-svg')) process.exit(0);

/* ── Rasterizado con Chromium (Playwright) ──────────────────────────────── */
const { chromium } = await import('playwright');
const navegador = await chromium.launch();
const pagina = await navegador.newPage({ deviceScaleFactor: 1 });

/** Pinta un SVG a `lado` px. `fondo` null = transparente; `ocupa` = fracción del lienzo que ocupa el sello. */
async function png(svg, lado, destino, { fondo = null, ocupa = 1 } = {}) {
    const d = Math.round(lado * ocupa);
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    await pagina.setViewportSize({ width: lado, height: lado });
    await pagina.setContent(`<html><body style="margin:0;background:${fondo ?? 'transparent'}">
      <div style="width:${lado}px;height:${lado}px;display:grid;place-items:center">
      <img src="${src}" width="${d}" height="${d}" style="display:block"></div></body></html>`);
    await pagina.waitForFunction(() => [...document.images].every((i) => i.complete));
    mkdirSync(dirname(destino), { recursive: true });
    await pagina.screenshot({ path: destino, omitBackground: fondo === null, clip: { x: 0, y: 0, width: lado, height: lado } });
    console.log('PNG', lado, '→', destino);
}

const FONDO_APP = '#020617';   // theme_color de la PWA
await png(svgs.sello, 512, join(PUB, 'logos/SICA005.png'));
await png(svgs.sello, 256, join(PUB, 'logos/SICA005-informe.png'));
await png(svgs.sello, 192, join(PUB, 'pwa-192x192.png'), { fondo: FONDO_APP, ocupa: 0.9 });
await png(svgs.sello, 512, join(PUB, 'pwa-512x512.png'), { fondo: FONDO_APP, ocupa: 0.9 });
await png(svgs.sello, 512, join(PUB, 'pwa-maskable-512x512.png'), { fondo: FONDO_APP, ocupa: 0.78 });
await png(svgs.sello, 180, join(PUB, 'apple-touch-icon.png'), { fondo: FONDO_APP, ocupa: 0.88 });

if (existsSync(CAPTURE)) {
    await png(svgs.sello, 512, join(CAPTURE, 'SICA005.png'));
    await png(svgs.sello, 192, join(CAPTURE, 'icon.png'), { fondo: FONDO_APP, ocupa: 0.9 });
    await png(svgs.sello, 512, join(CAPTURE, 'icon-512.png'), { fondo: FONDO_APP, ocupa: 0.9 });
    await png(svgs.sello, 180, join(CAPTURE, 'apple-touch-icon.png'), { fondo: FONDO_APP, ocupa: 0.88 });
}
if (existsSync(CONSERVACION)) {
    writeFileSync(join(CONSERVACION, 'SICA005-sello.svg'), svgs.sello);
    copyFileSync(join(PUB, 'logos/SICA005.png'), join(CONSERVACION, 'SICA005-512.png'));
}
await navegador.close();
