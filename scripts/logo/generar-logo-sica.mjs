/**
 * generar-logo-sica — fuente única de la marca SICA 005 (vector) y de todos sus rasterizados.
 *
 *   node scripts/logo/generar-logo-sica.mjs          SVG + PNG (Playwright/Chromium)
 *   node scripts/logo/generar-logo-sica.mjs --solo-svg
 *
 * Diseño de referencia: scripts/logo/referencia/ (20 PNG, solo como guía; no se publican).
 * Aquí se redibuja en vector con tintas planas: emblema (recuadro con valle, surcos, canal, ▽ de nivel, escala
 * hidrométrica y telemetría), ola + hoja, y el nombre «SICA 005». El texto se convierte a trazos con opentype.js
 * (Montserrat ExtraBold, OFL, en ./fuentes) para que se vea idéntico en <img>, html-to-image, impresión e iPad.
 *
 * Salidas (public/logos/sica/):
 *   sica005-emblema.svg      recuadro sin texto (40–120 px, membretes de informe, PWA)
 *   sica005-simbolo.svg      emblema simplificado (≤ 40 px, favicon)
 *   sica005-vertical.svg     emblema + nombre + leyendas (login, portadas)
 *   sica005-horizontal.svg   emblema a la izquierda, texto a la derecha (cabeceras anchas)
 *   sica005-banda.svg        banda «Control · Medición · Monitoreo · Operación»
 *   sica005-sello.svg        sello circular
 *   sica005-escudo.svg       escudo hexagonal
 *   sica005-mono-{negro,azul,blanco}.svg   una tinta, fondo transparente
 *   iconos/{medicion,telemetria,compuertas,monitoreo,distribucion,uso-agricola}.svg  (glifo) y -mosaico.svg
 * Además: src/components/marca/marcaSica.generado.ts (rutas, proporciones y glifos para la interfaz), favicon.svg, PNG de la app,
 * íconos PWA, sica-capture y Conservacion/Logos.
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../..');
const PUB = join(RAIZ, 'public');
const DIR_SICA = join(PUB, 'logos/sica');
const DIR_ICONOS = join(DIR_SICA, 'iconos');
const CAPTURE = resolve(RAIZ, '../sica-capture/public');
const CONSERVACION = resolve(RAIZ, '../Conservacion/Logos');

/* ── Tokens (muestreados de la referencia, llevados a tintas planas) ─────── */
const C = {
    navy: '#0B3170',          // marco y texto (contraste 11:1 sobre blanco)
    navyOscuro: '#06204D',
    cielo: '#CBEAF9',
    cieloAlto: '#9FD6F4',
    montana: '#2B66B1',
    montanaClara: '#5B97D5',
    campo: '#1F7F14',
    campoClaro: '#5DB22A',
    concreto: '#DCD6CC',
    concretoSombra: '#A69F93',
    aguaClaro: '#3FB2F3',
    agua: '#0A7FDB',
    aguaOscura: '#0A5BB0',
    hojaClara: '#7CC520',
    hoja: '#2E9A1E',
    wifi: '#2E9B2E',
    rojo: '#E0242A',
    blanco: '#FFFFFF',
};

const fuente = opentype.loadSync(join(AQUI, 'fuentes/Montserrat-ExtraBold.ttf'));
const n = (v) => +v.toFixed(2);

/* ── Texto a trazos ─────────────────────────────────────────────────────── */
/** Texto en línea recta. Devuelve el path (origen en la línea base) y su ancho. */
function texto(str, tamano, { tracking = 0 } = {}) {
    const esc = tamano / fuente.unitsPerEm;
    const glifos = fuente.stringToGlyphs(str);
    let x = 0;
    const partes = [];
    glifos.forEach((g, i) => {
        const d = g.getPath(x, 0, tamano).toPathData(2);
        if (d) partes.push(d);
        x += g.advanceWidth * esc;
        if (i < glifos.length - 1) x += fuente.getKerningValue(g, glifos[i + 1]) * esc + tracking;
    });
    return { d: partes.join(''), ancho: x, cap: 0.7 * tamano };
}
/** <path> de texto con su origen en (x, y) y alineación 'start' | 'middle' | 'end'. */
function textoEn(str, tamano, x, y, { tracking = 0, ancla = 'start', fill = C.navy, extra = '' } = {}) {
    const t = texto(str, tamano, { tracking });
    const x0 = ancla === 'middle' ? x - t.ancho / 2 : ancla === 'end' ? x - t.ancho : x;
    return { svg: `<path transform="translate(${n(x0)} ${n(y)})" fill="${fill}"${extra} d="${t.d}"/>`, ancho: t.ancho, x0 };
}

/** Texto en arco (para el sello), centrado en (cx, cy). */
function textoEnArco(str, { tamano, rBase, arriba, tracking = 0, cx = 256, cy = 256 }) {
    const esc = tamano / fuente.unitsPerEm;
    const cap = 0.7 * tamano;
    const rMedio = arriba ? rBase + cap / 2 : rBase - cap / 2;
    const glifos = fuente.stringToGlyphs(str);
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
        const x = cx + rBase * Math.cos(phi), y = cy + rBase * Math.sin(phi);
        const rot = (phi * 180) / Math.PI + (arriba ? 90 : -90);
        const d = g.getPath(-(g.advanceWidth * esc) / 2, 0, tamano).toPathData(2);
        if (d) paths.push(`<path transform="translate(${n(x)} ${n(y)}) rotate(${n(rot)})" d="${d}"/>`);
    });
    return { svg: paths.join(''), angulo: angTotal };
}

/* ── Emblema: escena en la retícula de 512 ──────────────────────────────── */
// Ventana de la escena: 46..466 (420 px), esquinas de 76. Marco navy 20..492 y filo blanco 8..504.
const VENTANA = { x: 46, y: 46, lado: 420, r: 76 };
const HORIZONTE = 242;
const PF = { x: 262, y: 236 };   // punto de fuga de los surcos y del canal

function defsEscena(p) {
    return `<linearGradient id="${p}cielo" x1="0" y1="46" x2="0" y2="250" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.cieloAlto}"/><stop offset="1" stop-color="${C.cielo}"/></linearGradient>
    <linearGradient id="${p}agua" x1="0" y1="300" x2="0" y2="470" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.aguaClaro}"/><stop offset="1" stop-color="${C.agua}"/></linearGradient>
    <linearGradient id="${p}hoja" x1="500" y1="250" x2="270" y2="470" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.hojaClara}"/><stop offset="1" stop-color="${C.hoja}"/></linearGradient>
    <linearGradient id="${p}ola" x1="0" y1="0" x2="400" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.aguaClaro}"/><stop offset="1" stop-color="${C.aguaOscura}"/></linearGradient>`;
}

/** 12 · cuenca: cielo y dos cordilleras. */
function cuenca(p) {
    return `<rect x="0" y="0" width="512" height="${HORIZONTE + 10}" fill="url(#${p}cielo)"/>
    <path fill="${C.montana}" d="M30 222 L92 182 L128 196 L190 150 L236 186 L286 160 L344 200 L398 172 L480 214 L480 ${HORIZONTE + 6} L30 ${HORIZONTE + 6} Z"/>
    <path fill="${C.montanaClara}" d="M30 236 L110 206 L170 222 L232 200 L300 220 L360 204 L430 224 L480 214 L480 ${HORIZONTE + 6} L30 ${HORIZONTE + 6} Z"/>`;
}

/** 13 · cultivos: campo con surcos en perspectiva. */
function cultivos() {
    const franjas = [];
    const yb = 480, nF = 22, x0 = -420, x1 = 940, paso = (x1 - x0) / nF;
    const enHorizonte = (xb) => PF.x + (xb - PF.x) * 0.06;
    for (let i = 0; i < nF; i += 2) {
        const a = x0 + i * paso, b = a + paso;
        franjas.push(`M${n(enHorizonte(a))} ${HORIZONTE}L${n(enHorizonte(b))} ${HORIZONTE}L${n(b)} ${yb}L${n(a)} ${yb}Z`);
    }
    return `<rect x="0" y="${HORIZONTE}" width="512" height="${512 - HORIZONTE}" fill="${C.campo}"/>
    <path fill="${C.campoClaro}" d="${franjas.join('')}"/>`;
}

/** 09 · canal trapezoidal revestido, visto desde aguas arriba, con olas. */
function canal(p) {
    const olas = [
        [330, 196, 330, 5], [366, 160, 360, 6], [404, 122, 396, 7], [446, 80, 436, 8],
    ].map(([y, xa, w, sw]) => {
        const xb = xa + w, m = (xa + xb) / 2, a = 7 + sw;
        return `<path d="M${xa} ${y}C${n(xa + w * 0.18)} ${y - a} ${n(m - w * 0.12)} ${y - a} ${m} ${y}S${n(xb - w * 0.18)} ${y + a} ${xb} ${y}" stroke-width="${sw}"/>`;
    }).join('');
    return `<path fill="${C.concreto}" d="M190 288 L338 288 L560 520 L-40 520 Z"/>
    <path fill="${C.concretoSombra}" d="M204 294 L324 294 L470 520 L42 520 Z"/>
    <path fill="url(#${p}agua)" d="M212 302 L316 302 L452 520 L62 520 Z"/>
    <g fill="none" stroke="${C.blanco}" stroke-linecap="round" opacity=".9">${olas}</g>`;
}

/** ▽ marcador de nivel. */
function marcadorNivel({ x = 264, y = 304, lado = 46, borde = 5 } = {}) {
    const h = lado * 0.8;
    return `<path d="M${x - lado / 2} ${y}H${x + lado / 2}L${x} ${y + h}Z" fill="${C.blanco}" stroke="${C.navy}" stroke-width="${borde}" stroke-linejoin="round"/>`;
}

/** 10 · escala hidrométrica: regla blanca con graduaciones y banda roja. */
function escala({ x = 352, y = 104, ancho = 58, alto = 278, graduaciones = true } = {}) {
    const marcas = [];
    if (graduaciones) {
        for (let yy = y + 20, i = 0; yy < y + alto - 14; yy += 15, i++) {
            const rojo = yy > y + 112 && yy < y + 200;
            const largo = i % 2 === 0 ? ancho * 0.5 : ancho * 0.3;
            marcas.push(`<rect x="${x + 8}" y="${yy}" width="${n(largo)}" height="6" rx="1.5" fill="${rojo ? C.rojo : C.navyOscuro}"/>`);
        }
    }
    const banda = `<rect x="${n(x + ancho * 0.6)}" y="${y + 58}" width="${n(ancho * 0.28)}" height="${n(alto * 0.13)}" fill="${C.rojo}"/>`;
    return `<rect x="${x}" y="${y}" width="${ancho}" height="${alto}" rx="9" fill="${C.blanco}" stroke="${C.navy}" stroke-width="7"/>
    ${marcas.join('')}${banda}`;
}

/** 11 · telemetría: tres arcos y punto, con filo blanco. */
function telemetria({ cx = 222, cy = 196, color = C.wifi, filo = true } = {}) {
    const arco = (r) => {
        const a0 = (-135 * Math.PI) / 180, a1 = (-45 * Math.PI) / 180;
        return `M${n(cx + r * Math.cos(a0))} ${n(cy + r * Math.sin(a0))}A${r} ${r} 0 0 1 ${n(cx + r * Math.cos(a1))} ${n(cy + r * Math.sin(a1))}`;
    };
    const d = [42, 78, 114].map(arco).join('');
    return `${filo ? `<path d="${d}" fill="none" stroke="${C.blanco}" stroke-width="32" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="21" fill="${C.blanco}"/>` : ''}
    <path d="${d}" fill="none" stroke="${color}" stroke-width="20" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="15" fill="${color}"/>`;
}

/** 14 · ola + hoja que salen del marco por abajo y a la derecha. */
const OLA = 'M2 446C86 404 186 412 262 446C318 470 376 474 430 456C372 498 300 504 238 482C170 458 94 446 2 470Z';
const HOJA = 'M250 478C292 382 384 300 506 252C506 364 434 456 250 478Z';
const HOJA_NERVIO = 'M268 468C336 398 410 336 494 268';
function aguaHoja(p, { filo = true } = {}) {
    const f = filo ? ` stroke="${C.blanco}" stroke-width="12" stroke-linejoin="round" paint-order="stroke"` : '';
    return `<path d="${HOJA}" fill="url(#${p}hoja)"${f}/>
    <path d="${HOJA_NERVIO}" fill="none" stroke="${C.blanco}" stroke-width="6" stroke-linecap="round" opacity=".75"/>
    <path d="${OLA}" fill="url(#${p}ola)"${f}/>`;
}

/** Escena completa recortada a la ventana. `p` = prefijo de ids (varias escenas en un mismo documento). */
function escena(p) {
    const v = VENTANA;
    return `<clipPath id="${p}ventana"><rect x="${v.x}" y="${v.y}" width="${v.lado}" height="${v.lado}" rx="${v.r}"/></clipPath>
    <g clip-path="url(#${p}ventana)">${cuenca(p)}${cultivos()}${canal(p)}${marcadorNivel()}${telemetria()}${escala()}</g>`;
}

/** Emblema completo (512×512) como grupo; sin <svg>. */
function emblemaG(p, { conOlaHoja = true } = {}) {
    return `<rect x="8" y="8" width="496" height="496" rx="112" fill="${C.blanco}"/>
    <rect x="20" y="20" width="472" height="472" rx="100" fill="${C.navy}"/>
    ${escena(p)}
    ${conOlaHoja ? aguaHoja(p) : ''}`;
}

const svgDoc = (vb, titulo, cuerpo, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${titulo}">
  <title>${titulo}</title>
  ${defs ? `<defs>${defs}</defs>` : ''}
  ${cuerpo}
</svg>
`;
const TITULO = 'SICA 005 · Sistema Integral de Control del Agua';

function emblema() {
    return svgDoc('0 0 512 512', TITULO, emblemaG('e-'), defsEscena('e-'));
}

/** Símbolo para ≤ 40 px: marco grueso, campo, canal, ▽ grande y escala sin graduaciones. */
function simbolo() {
    return svgDoc('0 0 512 512', 'SICA 005', `<rect x="0" y="0" width="512" height="512" rx="116" fill="${C.blanco}"/>
  <rect x="18" y="18" width="476" height="476" rx="100" fill="${C.navy}"/>
  <clipPath id="s-v"><rect x="62" y="62" width="388" height="388" rx="64"/></clipPath>
  <g clip-path="url(#s-v)">
    <rect x="0" y="0" width="512" height="512" fill="${C.cielo}"/>
    <path fill="${C.campoClaro}" d="M0 200H512V512H0Z"/>
    <path fill="${C.concreto}" d="M150 250H330L520 520H-40Z"/>
    <path fill="${C.agua}" d="M178 266H302L470 520H10Z"/>
  </g>
  ${marcadorNivel({ x: 214, y: 268, lado: 118, borde: 12 })}
  <rect x="326" y="96" width="84" height="300" rx="12" fill="${C.blanco}" stroke="${C.navyOscuro}" stroke-width="12"/>
  <rect x="368" y="150" width="30" height="64" fill="${C.rojo}"/>`);
}

/* ── Nombre «SICA 005» ──────────────────────────────────────────────────── */
// «SICA» va inclinado (itálica sintética de 10°) y «005» recto, como en la referencia. Filo blanco para fondos oscuros.
const INCLINA = Math.tan((10 * Math.PI) / 180);
function nombre(tamano, { tinta = C.navy, filo = true, hojaEnA = true, p = 'n-' } = {}) {
    const sica = texto('SICA', tamano);
    const cero = texto('005', tamano);
    const hueco = tamano * 0.2;
    const ancho = sica.ancho + hueco + cero.ancho;
    const f = filo ? ` stroke="${C.blanco}" stroke-width="${n(tamano * 0.09)}" stroke-linejoin="round" paint-order="stroke"` : '';
    const skew = `matrix(1 0 ${n(-INCLINA)} 1 0 0)`;
    // hoja que cruza la «A» (cuarta letra) a la altura del travesaño
    const aX = texto('SIC', tamano).ancho;
    const aW = sica.ancho - aX;
    const hoja = hojaEnA
        ? `<path transform="translate(${n(aX + aW * 0.02)} ${n(-tamano * 0.13)}) scale(${n(aW / 100)})" fill="url(#${p}hoja)"${filo ? ` stroke="${C.blanco}" stroke-width="5" paint-order="stroke"` : ''} d="M0 0C30 -26 70 -40 112 -38C84 -12 46 6 0 0Z"/>`
        : '';
    const svg = `<g transform="${skew}"><path fill="${tinta}"${f} d="${sica.d}"/>${hoja}</g>
    <path transform="translate(${n(sica.ancho + hueco)} 0)" fill="${tinta}"${f} d="${cero.d}"/>`;
    return { svg, ancho, cap: 0.7 * tamano };
}
const defsNombre = (p) => `<linearGradient id="${p}hoja" x1="0" y1="0" x2="112" y2="-38" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.hoja}"/><stop offset="1" stop-color="${C.hojaClara}"/></linearGradient>`;

/** Barras verdes a los lados de un texto centrado. */
function conBarras(str, tamano, cx, y, ancho, { fill = C.navy } = {}) {
    const t = textoEn(str, tamano, cx, y, { tracking: tamano * 0.06, ancla: 'middle', fill });
    const sep = tamano * 0.5, gruesa = tamano * 0.2;
    const yb = y - tamano * 0.35 - gruesa / 2;
    const izq = cx - ancho / 2, der = cx + ancho / 2;
    const bi = t.x0 - sep, bd = t.x0 + t.ancho + sep;
    return `<rect x="${n(izq)}" y="${n(yb)}" width="${n(bi - izq)}" height="${n(gruesa)}" rx="${n(gruesa / 2)}" fill="${C.hoja}"/>
    <rect x="${n(bd)}" y="${n(yb)}" width="${n(der - bd)}" height="${n(gruesa)}" rx="${n(gruesa / 2)}" fill="${C.hoja}"/>${t.svg}`;
}

/* ── 01 · Vertical ──────────────────────────────────────────────────────── */
function vertical() {
    const tam = 196;
    const nom = nombre(tam);
    const W = Math.ceil(nom.ancho + 80);
    const cx = W / 2;
    const yNom = 512 + 40 + nom.cap;
    const sub = texto('SISTEMA INTEGRAL DE CONTROL DEL AGUA', 34, { tracking: 1 });
    const bandaW = sub.ancho + 60, bandaY = yNom + 34;
    const linea = W - 120;
    const cuerpo = `<g transform="translate(${n(cx - 256)} 0)">${emblemaG('v-')}</g>
  <rect x="${n(cx - Math.max(bandaW, linea) / 2 - 24)}" y="${n(bandaY - 10)}" width="${n(Math.max(bandaW, linea) + 48)}" height="196" rx="34" fill="${C.blanco}"/>
  <g transform="translate(${n(cx - nom.ancho / 2 + nom.cap * INCLINA / 2)} ${n(yNom)})">${nom.svg}</g>
  <rect x="${n(cx - bandaW / 2)}" y="${n(bandaY)}" width="${n(bandaW)}" height="58" rx="29" fill="${C.navy}"/>
  ${textoEn('SISTEMA INTEGRAL DE CONTROL DEL AGUA', 34, cx, bandaY + 41, { tracking: 1, ancla: 'middle', fill: C.blanco }).svg}
  ${conBarras('DISTRITO DE RIEGO 005', 34, cx, bandaY + 112, linea)}
  ${textoEn('DELICIAS, CHIHUAHUA', 30, cx, bandaY + 164, { tracking: 4, ancla: 'middle' }).svg}`;
    const H = Math.ceil(bandaY + 196);
    return svgDoc(`0 0 ${W} ${H}`, TITULO, cuerpo, defsEscena('v-') + defsNombre('n-'));
}

/* ── 02 · Horizontal ────────────────────────────────────────────────────── */
function horizontal() {
    const nom = nombre(232);
    const x0 = 600;
    const sub = texto('SISTEMA INTEGRAL DE CONTROL DEL AGUA', 47, { tracking: 1 });
    const anchoTexto = Math.max(nom.ancho, sub.ancho);
    const W = Math.ceil(x0 + anchoTexto + 56);
    const cuerpo = `<rect x="0" y="0" width="${W}" height="512" rx="70" fill="${C.blanco}"/>
  ${emblemaG('h-')}
  <rect x="${x0 - 46}" y="70" width="10" height="372" rx="5" fill="${C.navy}"/>
  <g transform="translate(${x0 + n(nom.cap * INCLINA * 0.2)} 262)">${nom.svg}</g>
  ${textoEn('SISTEMA INTEGRAL DE CONTROL DEL AGUA', 47, x0, 346, { tracking: 1 }).svg}
  ${conBarras('DISTRITO DE RIEGO 005 • DELICIAS, CHIHUAHUA', 33, x0 + anchoTexto / 2, 424, anchoTexto)}`;
    return svgDoc(`0 0 ${W} 512`, TITULO, cuerpo, defsEscena('h-') + defsNombre('n-'));
}

/* ── 03 · Banda «Control · Medición · Monitoreo · Operación» ───────────── */
function banda() {
    const H = 200;
    const nom = nombre(150, { tinta: C.blanco, filo: false, hojaEnA: true, p: 'b-' });
    const xN = 64, finNavy = xN + nom.ancho + 70;
    const l1 = texto('CONTROL · MEDICIÓN', 50, { tracking: 2 });
    const l2 = texto('MONITOREO · OPERACIÓN', 50, { tracking: 2 });
    const anchoDer = Math.max(l1.ancho, l2.ancho);
    const xDer = finNavy + 60;
    const W = Math.ceil(xDer + anchoDer + 60);
    const cuerpo = `<rect x="0" y="0" width="${W}" height="${H}" rx="40" fill="${C.blanco}"/>
  <path d="M12 52Q12 12 52 12H${finNavy + 40}L${finNavy - 30} ${H - 12}H52Q12 ${H - 12} 12 ${H - 52}Z" fill="${C.navy}"/>
  <g transform="translate(${xN} ${n(H / 2 + nom.cap / 2)})">${nom.svg.replace(/url\(#b-hoja\)/g, `url(#b-hoja)`)}</g>
  ${textoEn('CONTROL · MEDICIÓN', 50, xDer + anchoDer / 2, 86, { tracking: 2, ancla: 'middle' }).svg}
  ${textoEn('MONITOREO · OPERACIÓN', 50, xDer + anchoDer / 2, 150, { tracking: 2, ancla: 'middle' }).svg}
  <rect x="${xDer - 20}" y="170" width="${n(anchoDer + 40)}" height="10" rx="5" fill="${C.hoja}"/>`;
    return svgDoc(`0 0 ${W} ${H}`, 'SICA 005 · Control, medición, monitoreo, operación', cuerpo, defsNombre('b-'));
}

/* ── 04 · Sello circular ────────────────────────────────────────────────── */
function sello() {
    const cx = 256;
    const sup = textoEnArco('SICA 005', { tamano: 66, rBase: 196, arriba: true, tracking: 6 });
    const inf = textoEnArco('DISTRITO DE RIEGO 005', { tamano: 32, rBase: 213, arriba: false, tracking: 2 });
    // banda verde inferior: anillo entre r 172 y 238, de 25° a 155°
    const anillo = (r1, r2, a0, a1) => {
        const p = (r, a) => `${n(cx + r * Math.cos(a))} ${n(cx + r * Math.sin(a))}`;
        return `M${p(r2, a0)}A${r2} ${r2} 0 0 1 ${p(r2, a1)}L${p(r1, a1)}A${r1} ${r1} 0 0 0 ${p(r1, a0)}Z`;
    };
    const rad = (g) => (g * Math.PI) / 180;
    const k = 168 / 210;   // la ventana (lado 420) se ajusta al círculo interior
    const cuerpo = `<circle cx="${cx}" cy="${cx}" r="256" fill="${C.blanco}"/>
  <circle cx="${cx}" cy="${cx}" r="244" fill="none" stroke="${C.navy}" stroke-width="16"/>
  <path d="${anillo(170, 236, rad(12), rad(168))}" fill="${C.hoja}"/>
  <g fill="${C.navy}">${sup.svg}</g>
  <g fill="${C.blanco}">${inf.svg}</g>
  <clipPath id="c-circ"><circle cx="${cx}" cy="${cx}" r="164"/></clipPath>
  <g clip-path="url(#c-circ)"><g transform="translate(${cx} ${cx}) scale(${n(k)}) translate(-256 -260)">
    ${cuenca('c-')}${cultivos()}${canal('c-')}${marcadorNivel()}${telemetria()}${escala()}</g></g>
  <circle cx="${cx}" cy="${cx}" r="168" fill="none" stroke="${C.navy}" stroke-width="10"/>
  ${[-1, 1].map((s) => `<circle cx="${n(cx + s * 203 * Math.cos(rad(4)))}" cy="${n(cx - 203 * Math.sin(rad(4)))}" r="8" fill="${C.navy}"/>`).join('')}`;
    return svgDoc('0 0 512 512', 'SICA 005 · Distrito de Riego 005', cuerpo, defsEscena('c-'));
}

/* ── 05 · Escudo hexagonal ──────────────────────────────────────────────── */
function escudo() {
    const cx = 256, cy = 282;
    const hex = (R) => [0, 1, 2, 3, 4, 5].map((i) => {
        const a = ((-90 + 60 * i) * Math.PI) / 180;
        return `${n(cx + R * Math.cos(a))} ${n(cy + R * Math.sin(a))}`;
    });
    const poli = (R) => `M${hex(R).join('L')}Z`;
    const nom = nombre(78, { filo: false, p: 'x-' });
    const corte = 312;
    const cuerpo = `<path d="${poli(282)}" fill="${C.blanco}" stroke="${C.blanco}" stroke-width="24" stroke-linejoin="round"/>
  <path d="${poli(262)}" fill="${C.blanco}" stroke="${C.navy}" stroke-width="22" stroke-linejoin="round"/>
  <clipPath id="x-hex"><path d="${poli(250)}"/></clipPath>
  <g clip-path="url(#x-hex)">
    <g transform="translate(0 -40)">${cuenca('x-')}${cultivos()}${canal('x-')}${marcadorNivel()}${telemetria()}${escala({ alto: 250 })}</g>
    <rect x="0" y="${corte}" width="512" height="300" fill="${C.blanco}"/>
    <rect x="0" y="${corte - 4}" width="512" height="8" fill="${C.navy}"/>
  </g>
  <g transform="translate(${n(cx - nom.ancho / 2 + nom.cap * INCLINA / 2)} 386)">${nom.svg}</g>
  ${textoEn('CONTROL DEL AGUA', 30, cx, 428, { tracking: 2, ancla: 'middle' }).svg}
  <path d="M168 476C222 456 300 454 352 470C298 468 226 472 168 488Z" fill="${C.agua}"/>
  <path d="M238 474C274 446 328 436 372 442C346 466 300 480 238 474Z" fill="${C.hoja}"/>`;
    return svgDoc('0 0 512 564', 'SICA 005 · Control del Agua', cuerpo, defsEscena('x-') + defsNombre('x-'));
}

/* ── 06-08 · Monocromáticos (una tinta, fondo transparente) ─────────────── */
function mono(tinta) {
    const nom = nombre(100, { tinta, filo: false, hojaEnA: false });
    const ondas = [[330, 196, 330], [366, 160, 360], [404, 122, 396], [446, 80, 436]].map(([y, xa, w]) => {
        const xb = xa + w, m = (xa + xb) / 2, a = 12;
        return `M${xa} ${y}C${n(xa + w * 0.18)} ${y - a} ${n(m - w * 0.12)} ${y - a} ${m} ${y}S${n(xb - w * 0.18)} ${y + a} ${xb} ${y}`;
    }).join('');
    const cuerpo = `<rect x="24" y="24" width="464" height="464" rx="96" fill="none" stroke="${tinta}" stroke-width="26"/>
  <clipPath id="m-v"><rect x="46" y="46" width="420" height="420" rx="76"/></clipPath>
  <g clip-path="url(#m-v)" fill="none" stroke="${tinta}" stroke-linecap="round" stroke-linejoin="round">
    <path fill="${tinta}" stroke="none" d="M30 222 L92 182 L128 196 L190 150 L236 186 L286 160 L344 200 L398 172 L480 214 L480 ${HORIZONTE} L30 ${HORIZONTE} Z"/>
    <path d="M40 ${HORIZONTE + 8}H190M338 ${HORIZONTE + 8}H470" stroke-width="8"/>
    <path d="M190 288L-40 520M338 288L560 520M212 302L62 520M316 302L452 520M204 294H324" stroke-width="10"/>
    <path d="${ondas}" stroke-width="9"/>
  </g>
  <path d="M241 304H287L264 341Z" fill="${tinta}"/>
  ${telemetria({ color: tinta, filo: false })}
  <rect x="352" y="104" width="58" height="278" rx="9" fill="none" stroke="${tinta}" stroke-width="10"/>
  <g fill="${tinta}">${Array.from({ length: 16 }, (_, i) => `<rect x="362" y="${124 + i * 15}" width="${i % 2 ? 16 : 27}" height="6" rx="1.5"/>`).join('')}
  <rect x="388" y="162" width="14" height="36"/></g>
  <g transform="translate(${n(256 - nom.ancho / 2 + nom.cap * INCLINA / 2)} ${n(512 + 34 + nom.cap)})">${nom.svg}</g>`;
    return svgDoc(`0 0 512 ${Math.ceil(512 + 34 + nom.cap + 20)}`, 'SICA 005', cuerpo);
}

/* ── 15-20 · Íconos de sección ──────────────────────────────────────────── */
// Retícula de 24, trazo 2, estilo lucide: se usan junto a los íconos lucide del menú y de las tarjetas.
const OLAS = (y) => `M2 ${y}c1.6 0 2.4-1.4 4-1.4s2.4 1.4 4 1.4 2.4-1.4 4-1.4 2.4 1.4 4 1.4 2.4-1.4 4-1.4`;
const ICONOS = {
    medicion: {
        etiqueta: ['MEDICIÓN', 'DE NIVEL'],
        d: ['M9 2h6v13H9z', 'M9 5h3', 'M9 8h2', 'M9 11h3', OLAS(18.5), OLAS(22)],
    },
    telemetria: {
        etiqueta: ['TELEMETRÍA', 'Y DATOS'],
        d: ['M2 8.8a15 15 0 0 1 20 0', 'M5 12.6a10 10 0 0 1 14 0', 'M8.5 16.4a5 5 0 0 1 7 0', 'M12 20h.01'],
    },
    compuertas: {
        etiqueta: ['OPERACIÓN', 'DE COMPUERTAS'],
        d: ['M3 3h18v11H3z', 'M12 3v11', 'M3 7h18', 'M6.5 10.5h2M15.5 10.5h2', OLAS(18.5), OLAS(22)],
    },
    monitoreo: {
        etiqueta: ['MONITOREO', 'EN TIEMPO REAL'],
        d: ['M4 20v-4', 'M9.3 20v-7', 'M14.7 20v-10', 'M20 20V4'],
    },
    distribucion: {
        etiqueta: ['DISTRIBUCIÓN', 'DEL AGUA'],
        d: ['M12 2.7 6.3 9.4a7.5 7.5 0 1 0 11.4 0z', 'M8.6 15.4a3.6 3.6 0 0 0 4.6 3'],
    },
    'uso-agricola': {
        etiqueta: ['USO AGRÍCOLA', 'EFICIENTE'],
        verde: true,
        d: ['M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z', 'M2 21c0-3 1.9-5.4 5.1-6C9.5 14.5 12 13 13 12'],
    },
};

function glifo(clave) {
    const i = ICONOS[clave];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${i.d.map((d) => `<path d="${d}"/>`).join('')}</svg>
`;
}

function mosaico(clave) {
    const i = ICONOS[clave];
    const tam = 15;
    const lineas = i.etiqueta.map((t) => texto(t, tam, { tracking: 0.3 }));
    const W = Math.ceil(Math.max(128, ...lineas.map((l) => l.ancho + 16)));
    const cx = W / 2, lado = 112, x = cx - lado / 2;
    const fondo = i.verde ? C.hoja : C.navy;
    const cuerpo = `<rect x="${n(x - 5)}" y="3" width="${lado + 10}" height="${lado + 10}" rx="28" fill="${C.blanco}"/>
  <rect x="${n(x)}" y="8" width="${lado}" height="${lado}" rx="24" fill="${fondo}"/>
  <g transform="translate(${n(cx - 36)} 28) scale(3)" fill="none" stroke="${C.blanco}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${i.d.map((d) => `<path d="${d}"/>`).join('')}</g>
  ${i.etiqueta.map((t, k) => textoEn(t, tam, cx, 142 + k * 18, { tracking: 0.3, ancla: 'middle', fill: C.navyOscuro }).svg).join('')}`;
    return svgDoc(`0 0 ${W} 166`, i.etiqueta.join(' ').toLowerCase(), cuerpo);
}

function moduloMarcaTs(svgs) {
    const filas = Object.entries(ICONOS).map(([k, v]) => `    '${k}': ${JSON.stringify(v.d)},`).join('\n');
    const variantes = ['emblema', 'simbolo', 'vertical', 'horizontal', 'banda', 'sello', 'escudo', 'mono-blanco'];
    const proporcion = (svg) => { const [, , w, h] = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number); return n(w / h); };
    const marca = variantes.map((k) => `    '${k}': { ruta: '/logos/sica/sica005-${k}.svg', proporcion: ${proporcion(svgs[k])} },`).join('\n');
    return `// GENERADO por scripts/logo/generar-logo-sica.mjs — no editar a mano (npm run logo:generar).
/** Versiones del logo SICA 005: ruta pública y proporción ancho/alto del viewBox. */
export const MARCA_SICA = {
${marca}
} as const;

export type VarianteMarcaSica = keyof typeof MARCA_SICA;

/** Trazos de los íconos de sección SICA 005 (retícula 24, trazo 2, mismo estilo que lucide). */
export const GLIFOS_SICA = {
${filas}
} as const;

export type ClaveIconoSica = keyof typeof GLIFOS_SICA;
`;
}

/* ── Escritura ──────────────────────────────────────────────────────────── */
mkdirSync(DIR_ICONOS, { recursive: true });
const svgs = {
    emblema: emblema(),
    simbolo: simbolo(),
    vertical: vertical(),
    horizontal: horizontal(),
    banda: banda(),
    sello: sello(),
    escudo: escudo(),
    'mono-negro': mono('#111111'),
    'mono-azul': mono(C.navy),
    'mono-blanco': mono(C.blanco),
};
for (const [k, svg] of Object.entries(svgs)) writeFileSync(join(DIR_SICA, `sica005-${k}.svg`), svg);
for (const k of Object.keys(ICONOS)) {
    writeFileSync(join(DIR_ICONOS, `${k}.svg`), glifo(k));
    writeFileSync(join(DIR_ICONOS, `${k}-mosaico.svg`), mosaico(k));
}
writeFileSync(join(RAIZ, 'src/components/marca/marcaSica.generado.ts'), moduloMarcaTs(svgs));
writeFileSync(join(PUB, 'favicon.svg'), svgs.simbolo);
console.log('SVG →', DIR_SICA);

if (process.argv.includes('--solo-svg')) process.exit(0);

/* ── Rasterizado con Chromium (Playwright) ──────────────────────────────── */
const { chromium } = await import('playwright');
const navegador = await chromium.launch();
const pagina = await navegador.newPage({ deviceScaleFactor: 1 });

/** Pinta un SVG cuadrado a `lado` px. `fondo` null = transparente; `ocupa` = fracción del lienzo que ocupa el logo. */
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

// Los íconos de app salen del emblema (sin texto), no de una versión con leyendas ilegibles a ese tamaño.
const FONDO_APP = '#020617';   // theme_color de la PWA
await png(svgs.emblema, 512, join(PUB, 'logos/SICA005.png'));
await png(svgs.emblema, 256, join(PUB, 'logos/SICA005-informe.png'));
await png(svgs.emblema, 192, join(PUB, 'pwa-192x192.png'), { fondo: FONDO_APP, ocupa: 0.9 });
await png(svgs.emblema, 512, join(PUB, 'pwa-512x512.png'), { fondo: FONDO_APP, ocupa: 0.9 });
await png(svgs.emblema, 512, join(PUB, 'pwa-maskable-512x512.png'), { fondo: FONDO_APP, ocupa: 0.74 });
await png(svgs.emblema, 180, join(PUB, 'apple-touch-icon.png'), { fondo: FONDO_APP, ocupa: 0.88 });

if (existsSync(CAPTURE)) {
    writeFileSync(join(CAPTURE, 'sica005-emblema.svg'), svgs.emblema);
    writeFileSync(join(CAPTURE, 'favicon.svg'), svgs.simbolo);
    await png(svgs.emblema, 512, join(CAPTURE, 'SICA005.png'));
    await png(svgs.emblema, 192, join(CAPTURE, 'icon.png'), { fondo: FONDO_APP, ocupa: 0.9 });
    await png(svgs.emblema, 512, join(CAPTURE, 'icon-512.png'), { fondo: FONDO_APP, ocupa: 0.9 });
    await png(svgs.emblema, 180, join(CAPTURE, 'apple-touch-icon.png'), { fondo: FONDO_APP, ocupa: 0.88 });
}
if (existsSync(CONSERVACION)) {
    writeFileSync(join(CONSERVACION, 'SICA005-sello.svg'), svgs.sello);
    writeFileSync(join(CONSERVACION, 'SICA005-horizontal.svg'), svgs.horizontal);
    writeFileSync(join(CONSERVACION, 'SICA005-emblema.svg'), svgs.emblema);
    copyFileSync(join(PUB, 'logos/SICA005.png'), join(CONSERVACION, 'SICA005-512.png'));
}
await navegador.close();
