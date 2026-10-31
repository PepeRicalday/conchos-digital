// Auditoría de CONTRASTE y LEGIBILIDAD de solo lectura con Playwright (no pulsa botones).
//   Uso:  node e2e/contraste.mjs [desktop|ipad] [--rutas=/presas,/clima]     (requiere `npm run dev` en :5173; bypass de login en localhost)
// Mide por ruta:
//   1) texto: ratio WCAG de cada nodo de texto contra su fondo efectivo (compone alfa de ancestros y opacidad) · AA 4.5 / texto grande 3
//   2) <select>: fondo y color de cada <option>. El popup nativo de Chrome pinta sobre BLANCO: una opción con fondo translúcido
//      (p. ej. rgba(255,255,255,.05)) y texto claro queda ilegible → se compone sobre blanco, que es lo que ve el usuario
//   3) placeholders, tamaño de letra < 11 px, y foco visible (Tab) con outline/box-shadow
// Salida: e2e/out/contraste_<vp>.json (todo el detalle) + resumen por consola ordenado por gravedad (carpeta ignorada por git).
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = new URL('./out/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const vpName = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'desktop';
const rutasArg = (process.argv.find(a => a.startsWith('--rutas=')) || '').slice(8);
const BASE = 'http://localhost:5173';
const RUTAS = rutasArg ? rutasArg.split(',') : ['/', '/monitor-publico', '/presas', '/canales', '/escalas', '/hidrometria', '/clima', '/reporte-oficial', '/importar', '/alertas', '/geo-monitor', '/bitacora', '/ciclos', '/infraestructura', '/inteligencia-hidrica', '/protocolos', '/balance', '/analisis-historico', '/modelacion-hidraulica', '/conservacion'];
const VPS = {
  desktop: { viewport: { width: 1440, height: 900 }, opts: {} },
  ipad: { viewport: { width: 1180, height: 820 }, opts: { hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } },
};
const vp = VPS[vpName];

// Se serializa dentro de la página.
function MEDIR() {
  // Tailwind 4 emite oklab()/oklch()/color-mix(): getComputedStyle los devuelve tal cual. Un canvas 1x1 los convierte a sRGB.
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const parse = s => {
    s = (s || '').trim();
    if (cache.has(s)) return cache.get(s);
    let out = null;
    const m = /^rgba?\(([^)]+)\)$/.exec(s);
    if (m) { const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); out = [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    else if (s && s !== 'none') {
      try { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; out = [d[0], d[1], d[2], d[3] / 255]; } catch { out = null; }
    }
    cache.set(s, out); return out;
  };
  const over = (f, b) => { const a = f[3]; return [f[0] * a + b[0] * (1 - a), f[1] * a + b[1] * (1 - a), f[2] * a + b[2] * (1 - a), 1]; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const BASE = [2, 6, 23, 1]; // #020617: fondo base de la app
  const fondoEfectivo = (el, baseInicial = BASE) => {
    const capas = []; let img = false;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== 'none' && !e.classList.contains('layout-container')) img = true;
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) { capas.push(c); if (c[3] >= 0.999) break; }
    }
    let out = baseInicial; for (let i = capas.length - 1; i >= 0; i--) out = over(capas[i], out);
    return { bg: out, img };
  };
  const opacidad = el => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  const visible = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility === 'visible' && cs.display !== 'none'; };
  const firma = el => { const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''; return el.tagName.toLowerCase() + (c ? '.' + c : ''); };
  const hex = c => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const rgbaTxt = c => c ? `rgba(${c.map((v, i) => i < 3 ? Math.round(v) : +v.toFixed(2)).join(',')})` : 'n/d';

  const texto = new Map(); const pequenos = new Map(); const selects = []; const placeholders = []; const sinParsear = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const vistos = new Set();
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = n.nodeValue.trim(); const el = n.parentElement;
    if (!t || !el || vistos.has(el)) continue;
    if (/^(SCRIPT|STYLE|NOSCRIPT|OPTION|OPTGROUP|TEXTAREA)$/.test(el.tagName) || el.closest('select') || !visible(el)) continue;
    vistos.add(el);
    const cs = getComputedStyle(el);
    const svg = el instanceof SVGElement;
    const col = parse(svg ? cs.fill : cs.color);
    if (!col) { sinParsear.add(svg ? cs.fill : cs.color); continue; }
    const { bg, img } = fondoEfectivo(el);
    const op = opacidad(el);
    if (op < 0.05) continue;   // oculto por diseño (aparece al pasar el cursor)
    const fg = over([col[0], col[1], col[2], col[3] * op], bg);
    const r = ratio(fg, bg);
    const px = parseFloat(cs.fontSize); const peso = parseInt(cs.fontWeight) || 400;
    const grande = px >= 24 || (px >= 18.66 && peso >= 700);
    const umbral = grande ? 3 : 4.5;
    const k = firma(el) + '|' + hex(fg) + '|' + hex(bg);
    if (r < umbral) {
      const prev = texto.get(k);
      if (prev) prev.n++;
      else texto.set(k, { sel: firma(el), ejemplo: t.slice(0, 50), ratio: +r.toFixed(2), umbral, fg: hex(fg), bg: hex(bg), px, opacidad: +op.toFixed(2), deshabilitado: !!el.closest(':disabled,[aria-disabled=true]'), aprox: img, n: 1 });
    }
    if (px < 11) { const kp = firma(el) + '|' + px; const prev = pequenos.get(kp); if (prev) prev.n++; else pequenos.set(kp, { sel: firma(el), ejemplo: t.slice(0, 40), px, n: 1 }); }
  }
  // <select>: el popup nativo se pinta sobre blanco
  document.querySelectorAll('select').forEach(s => {
    if (!visible(s) && !s.closest('[hidden]')) { /* oculto: se mide igual si tiene tamaño 0 por estar colapsado */ }
    const csS = getComputedStyle(s);
    const bgSel = parse(csS.backgroundColor) || [0, 0, 0, 0];
    const opciones = [...s.options].slice(0, 40).map(o => {
      const cs = getComputedStyle(o);
      const bgO = parse(cs.backgroundColor) || [0, 0, 0, 0];
      const col = parse(cs.color) || [0, 0, 0, 1];
      const fondoPopup = over(bgO, over(bgSel, [255, 255, 255, 1]));   // opción → select → blanco del popup
      const fgO = over(col, fondoPopup);
      return { t: o.textContent.trim().slice(0, 30), ratio: +ratio(fgO, fondoPopup).toFixed(2), bg: rgbaTxt(bgO), fondoPopup: hex(fondoPopup), color: hex(fgO) };
    });
    const peor = opciones.reduce((m, o) => o.ratio < m ? o.ratio : m, 99);
    selects.push({ sel: firma(s), nombre: s.getAttribute('aria-label') || s.name || s.id || '', bgSelect: rgbaTxt(bgSel), colorScheme: csS.colorScheme, opciones: opciones.length, peorRatio: peor, falla: peor < 4.5, muestra: opciones.slice(0, 2) });
  });
  document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
    if (!visible(el)) return;
    const col = parse(getComputedStyle(el, '::placeholder').color);
    if (!col) return;
    const { bg } = fondoEfectivo(el);
    const fg = over(col, bg); const r = ratio(fg, bg);
    if (r < 4.5) placeholders.push({ sel: firma(el), placeholder: el.getAttribute('placeholder').slice(0, 30), ratio: +r.toFixed(2), fg: hex(fg), bg: hex(bg) });
  });
  return {
    texto: [...texto.values()].sort((a, b) => a.ratio - b.ratio),
    pequenos: [...pequenos.values()].sort((a, b) => a.px - b.px),
    selects, placeholders, coloresNoParseados: [...sinParsear].slice(0, 8),
    totalNodos: vistos.size,
  };
}

async function MEDIR_FOCO(page) {
  const fallos = []; const vistos = new Set();
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  for (let i = 0; i < 28; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const e = document.activeElement; if (!e || e === document.body) return null;
      const cs = getComputedStyle(e); const rc = e.getBoundingClientRect();
      const c = typeof e.className === 'string' ? e.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      return { sel: e.tagName.toLowerCase() + (c ? '.' + c : ''), txt: (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 30), outlineStyle: cs.outlineStyle, outlineW: parseFloat(cs.outlineWidth), outlineColor: cs.outlineColor, shadow: cs.boxShadow, w: rc.width, h: rc.height, enfoqueVisible: e.matches(':focus-visible') };
    });
    if (!r || vistos.has(r.sel + r.txt)) continue;
    vistos.add(r.sel + r.txt);
    const sinOutline = r.outlineStyle === 'none' || r.outlineW === 0;
    const sinSombra = !r.shadow || r.shadow === 'none';
    if (r.enfoqueVisible && sinOutline && sinSombra && r.w > 0) fallos.push({ sel: r.sel, txt: r.txt });
  }
  return fallos;
}

const browser = await chromium.launch();
const resultados = [];
for (const ruta of RUTAS) {
  const page = await (await browser.newContext({ viewport: vp.viewport, ...vp.opts })).newPage();
  const rec = { ruta };
  await page.goto(BASE + ruta, { waitUntil: 'networkidle', timeout: 45000 }).catch(e => { rec.gotoError = e.message.slice(0, 100); });
  await page.waitForTimeout(4500);
  try {
    Object.assign(rec, await page.evaluate(MEDIR));
    rec.focoSinIndicador = await MEDIR_FOCO(page);
  } catch (e) { rec.error = String(e.message).slice(0, 150); }
  const nTexto = (rec.texto || []).reduce((s, t) => s + t.n, 0);
  const selMal = (rec.selects || []).filter(s => s.falla).length;
  const flags = [nTexto && `texto<AA:${nTexto}(${rec.texto.length} tipos)`, selMal && `SELECT-ILEGIBLE:${selMal}/${rec.selects.length}`, (rec.placeholders || []).length && `placeholder:${rec.placeholders.length}`, (rec.pequenos || []).length && `<11px:${rec.pequenos.reduce((s, t) => s + t.n, 0)}`, (rec.focoSinIndicador || []).length && `foco-invisible:${rec.focoSinIndicador.length}`, rec.error && `ERR:${rec.error}`].filter(Boolean);
  console.log(`${ruta.padEnd(24)} ${flags.length ? flags.join(' · ') : 'OK'}`);
  if (nTexto || selMal) await page.screenshot({ path: fileURLToPath(new URL(`contraste_${vpName}_${ruta.replace(/\//g, '_') || '_root'}.png`, OUT)) }).catch(() => {});
  resultados.push(rec);
  await page.context().close();
}
fs.writeFileSync(new URL(`contraste_${vpName}.json`, OUT), JSON.stringify(resultados, null, 1));
await browser.close();

// Resumen global
const todos = resultados.flatMap(r => (r.texto || []).map(t => ({ ruta: r.ruta, ...t })));
console.log('\n── PEORES TEXTOS (ratio ascendente, sin deshabilitados) ──');
todos.filter(t => !t.deshabilitado).sort((a, b) => a.ratio - b.ratio).slice(0, 25).forEach(t => console.log(`${String(t.ratio).padStart(5)} (min ${t.umbral}) ${t.ruta.padEnd(22)} ${t.sel.slice(0, 34).padEnd(34)} ${t.fg} sobre ${t.bg}  x${t.n}  «${t.ejemplo}»${t.aprox ? ' ~gradiente' : ''}`));
const selAll = resultados.flatMap(r => (r.selects || []).filter(s => s.falla).map(s => ({ ruta: r.ruta, ...s })));
console.log(`\n── SELECTS CON OPCIONES ILEGIBLES: ${selAll.length} ──`);
selAll.forEach(s => console.log(`${s.ruta.padEnd(22)} ${s.sel.slice(0, 34).padEnd(34)} peor ${s.peorRatio}:1 · fondo select ${s.bgSelect} · color-scheme ${s.colorScheme}`));
const fo = resultados.flatMap(r => (r.focoSinIndicador || []).map(f => ({ ruta: r.ruta, ...f })));
console.log(`\n── FOCO SIN INDICADOR: ${fo.length} ──`);
fo.slice(0, 15).forEach(f => console.log(`${f.ruta.padEnd(22)} ${f.sel} «${f.txt}»`));
console.log(`\nDetalle completo: e2e/out/contraste_${vpName}.json`);
