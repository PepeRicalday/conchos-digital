// SICA Conservación · auditoría de presentación de «Comprobación por tramo» (Playwright, solo lectura).
//   Uso:  node e2e/conservacion-comprobacion-auditoria.mjs [etiqueta]     (requiere `npm run dev` en :5173)
// Mide: posición de la ficha respecto al primer pantallazo, tamaño efectivo del texto del dibujo, solapes entre textos del SVG,
// contraste, objetivos táctiles, tablas recortadas y foco visible. Salida: e2e/out/auditoria_<etiqueta>.json
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = new URL('./out/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const etiqueta = process.argv[2] ?? 'antes';
const VPS = { desktop: { viewport: { width: 1440, height: 900 }, opts: {} }, iphone: { viewport: { width: 440, height: 956 }, opts: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } } };

const medir = () => {
  const ficha = document.querySelector('.cons-comp-ficha');
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const rgba = (c) => { const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1]; return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fondo = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c.a > 0.5) return c; } return { r: 5, g: 8, b: 20, a: 1 }; };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const out = { fichaTopY: ficha ? Math.round(ficha.getBoundingClientRect().top + scrollY) : null, fichaTopEnPantalla: ficha ? Math.round(ficha.getBoundingClientRect().top) : null, viewportAlto: innerHeight };
  if (!ficha) return out;
  out.fichaAlto = Math.round(ficha.getBoundingClientRect().height);
  // SVG: tamaño efectivo del texto y solapes
  const svg = ficha.querySelector('.cons-seccion svg');
  if (svg) {
    const vb = svg.viewBox.baseVal; const esc = svg.getBoundingClientRect().width / vb.width;
    const textos = [...svg.querySelectorAll('text')].map((t) => ({ t, px: parseFloat(t.getAttribute('font-size') ?? '12') * esc, r: t.getBoundingClientRect(), txt: t.textContent }));
    out.svgEscala = Number(esc.toFixed(2));
    out.svgTextoMinPx = Number(Math.min(...textos.map((x) => x.px)).toFixed(1));
    out.svgTextosBajo11px = textos.filter((x) => x.px < 11).length;
    const sol = [];
    for (let i = 0; i < textos.length; i++) for (let j = i + 1; j < textos.length; j++) {
      const a = textos[i].r, b = textos[j].r;
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) sol.push(`${textos[i].txt.slice(0, 22)} × ${textos[j].txt.slice(0, 22)}`);
    }
    out.svgSolapes = sol;
    out.svgAlto = Math.round(svg.getBoundingClientRect().height);
  }
  // Contraste de los textos de la ficha (texto < 18 px → 4.5:1)
  const malos = [];
  ficha.querySelectorAll('*').forEach((el) => {
    if (!vis(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
    if (el.closest('svg')) return;
    const cs = getComputedStyle(el); const fg = rgba(cs.color); const bg = fondo(el);
    const r = ratio({ ...fg, a: 1 }, bg); const px = parseFloat(cs.fontSize);
    if (r < (px >= 18 ? 3 : 4.5)) malos.push(`${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 24)}" ${r.toFixed(2)} ${px}px`);
  });
  out.contrasteBajo = [...new Set(malos)].slice(0, 10);
  const chico = []; ficha.querySelectorAll('*').forEach((el) => { if (!vis(el) || el.closest('svg') || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return; const px = parseFloat(getComputedStyle(el).fontSize); if (px < 12) chico.push(`${el.tagName.toLowerCase()} ${px}px`); });
  out.textoMenor12px = [...new Set(chico)].slice(0, 8);
  // Tablas recortadas
  out.tablasRecortadas = [...document.querySelectorAll('.cons-comp-ficha .table-scroll, .cons-comp-ficha .sc-tabla-wrap')].filter((w) => w.scrollWidth > w.clientWidth + 2).length;
  // Objetivos táctiles de la zona de comprobación
  const zona = document.querySelector('#cons-comp-t')?.closest('section') ?? document;
  const peq = []; zona.querySelectorAll('button, select, input, summary, a, [role=button]').forEach((el) => { if (!vis(el)) return; const r = el.getBoundingClientRect(); if (r.height < 43.5 || r.width < (el.classList.contains('cons-rc-celda') ? 23.5 : 43.5)) peq.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`); });
  out.objetivosPequenos = [...new Set(peq)].slice(0, 10);
  out.desborde = document.documentElement.scrollWidth > innerWidth + 2;
  return out;
};

const browser = await chromium.launch();
const res = {};
for (const [nombre, vp] of Object.entries(VPS)) {
  const ctx = await browser.newContext({ viewport: vp.viewport, serviceWorkers: 'block', ...vp.opts });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { sessionStorage.clear(); } catch { /* nada */ } });
  await page.goto('http://localhost:5173/conservacion?seccion=derivacion', { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForSelector('.cons-der-slots', { timeout: 120000 });
  await page.getByRole('tab', { name: /Comprobación por tramo/ }).click(); await page.waitForTimeout(600);
  const r = {};
  r.limpia = await page.evaluate(medir);
  await page.selectOption('#cons-comp-con', { index: 1 }); await page.waitForTimeout(300);
  r.desazolve = await page.evaluate(medir);
  // Foco visible con teclado: Tab desde el selector de concepto
  await page.focus('#cons-comp-con'); await page.keyboard.press('Tab'); await page.waitForTimeout(100);
  r.focoVisible = await page.evaluate(() => { const b = document.activeElement; if (!b) return null; const s = getComputedStyle(b); return { elemento: `${b.tagName.toLowerCase()} ${(b.textContent || '').trim().slice(0, 16)}`, outline: s.outlineStyle, ancho: s.outlineWidth, sombra: s.boxShadow !== 'none' }; });
  // Pasos hasta ver la ficha completa en el primer pantallazo (scroll necesario)
  r.scrollParaVerFicha = await page.evaluate(() => { const f = document.querySelector('.cons-comp-ficha'); return f ? Math.max(0, Math.round(f.getBoundingClientRect().top + scrollY - innerHeight * 0.1)) : null; });
  res[nombre] = r;
  await ctx.close();
}
await browser.close();
fs.writeFileSync(fileURLToPath(new URL(`auditoria_${etiqueta}.json`, OUT)), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
