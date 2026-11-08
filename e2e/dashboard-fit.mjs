// Dashboard "fit-to-screen": la primera pantalla (barra + 8 KPIs) debe caber en el alto visible de cada dispositivo,
// sin tarjetas con contenido recortado, sin texto < 12 px y sin objetivos táctiles < 44 px. Requiere `npm run dev` en :5173.
//   node e2e/dashboard-fit.mjs            → todos los viewports
//   node e2e/dashboard-fit.mjs iphone     → uno solo
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
const OUT = fileURLToPath(new URL('./out/fit/', import.meta.url)); fs.mkdirSync(OUT, { recursive: true });

const casos = [
  { n: 'desktop-1500x1000', motor: chromium, ctx: { viewport: { width: 1500, height: 1000 } } },
  { n: 'laptop-1366x768', motor: chromium, ctx: { viewport: { width: 1366, height: 768 } } },
  { n: 'tv-1920x1080', motor: chromium, ctx: { viewport: { width: 1920, height: 1080 } } },
  { n: 'sala-2545x870', motor: chromium, ctx: { viewport: { width: 2545, height: 870 } } },
  { n: 'ipad-h-1180x820', motor: webkit, ctx: { ...devices['iPad Pro 11 landscape'] } },
  { n: 'ipad-v-820x1180', motor: webkit, ctx: { ...devices['iPad Pro 11'], viewport: { width: 820, height: 1180 } } },
  { n: 'iphone-430x932', motor: webkit, ctx: { ...devices['iPhone 15 Pro Max'] } },
  { n: 'iphone-390x844', motor: webkit, ctx: { ...devices['iPhone 14'] } },
];
const filtro = process.argv[2];
let fallos = 0;
for (const c of casos) {
  if (filtro && !c.n.startsWith(filtro)) continue;
  const b = await c.motor.launch(); const page = await (await b.newContext(c.ctx)).newPage();
  const err = []; page.on('pageerror', (e) => err.push(String(e).slice(0, 140)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text())) err.push(m.text().slice(0, 140)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.kp-grid', { timeout: 45000 }).catch(() => err.push('sin .kp-grid'));
  await page.waitForTimeout(7000);
  const r = await page.evaluate(() => {
    const main = document.querySelector('.main-content'); const fold = document.querySelector('.dash-fold');
    if (!main || !fold) return { ok: false };
    const cs = getComputedStyle(main); const mb = main.getBoundingClientRect();
    const visibleBottom = mb.top + main.clientHeight - parseFloat(cs.paddingBottom);
    const fb = fold.getBoundingClientRect().bottom;
    const tiles = [...document.querySelectorAll('.kp-tile')];
    const recortadas = tiles.filter((t) => t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1).map((t) => t.id);
    const chicos = [], peques = [], desborde = [];
    for (const el of document.querySelectorAll('.dash-fold *')) {
      if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
        const f = parseFloat(getComputedStyle(el).fontSize); if (f < 11.95) chicos.push(`${el.className || el.tagName}:${f}`);
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow === 'visible' && el.closest('.kp-tile')) desborde.push(`${el.className || el.tagName}`);
      }
    }
    for (const el of document.querySelectorAll('.dash-fold button, .dash-fold a[href], .dash-fold select')) {
      const r = el.getBoundingClientRect(); if (r.width && r.height < 43.5) peques.push(`${el.className || el.tagName}:${Math.round(r.height)}`);
    }
    return {
      ok: true, tiles: tiles.length, visibleBottom: Math.round(visibleBottom), foldBottom: Math.round(fb), sobra: Math.round(fb - visibleBottom),
      scrollPagina: main.scrollHeight > main.clientHeight + 1, docH: main.scrollHeight, recortadas, chicos: [...new Set(chicos)], peques: [...new Set(peques)], desborde: [...new Set(desborde)],
      nan: /NaN|undefined|Infinity/.test(document.body.innerText),
    };
  });
  await page.screenshot({ path: OUT + `${c.n}.png` });
  
  // Teléfono: con la tarjeta Clima destacada (v2.68.0) la pantalla se desplaza a propósito; solo se exige que no haya recortes.
  const telefono = c.n.startsWith('iphone');
  const cabe = telefono || (r.ok && r.sobra <= 1);
  const limpio = r.ok && r.tiles === 10 && (telefono || !r.scrollPagina) && cabe && r.recortadas.length === 0 && r.chicos.length === 0 && r.peques.length === 0 && !r.nan && err.length === 0;
  if (!limpio) fallos++;
  console.log(limpio ? 'OK  ' : 'FALLA', c.n, JSON.stringify({ ...r, err }));
  await b.close();
}
console.log(fallos ? `\n${fallos} caso(s) con observaciones` : '\nTodo en regla');
process.exit(fallos ? 1 : 0);
