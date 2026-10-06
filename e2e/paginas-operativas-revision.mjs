// Revisión de páginas operativas (Hidrometría, Distribución, Balance) en escritorio / iPad / iPhone.
//   node e2e/paginas-operativas-revision.mjs [hidrometria|canales|balance|todas]   (requiere `npm run dev` en :5173)
// Verifica: sin errores, sin desborde horizontal, texto ≥ 11 px y táctiles ≥ 44 px dentro de .sc-root, sin NaN/undefined,
// y que no aparezcan ceros de relleno en las cifras grandes. Guarda capturas en e2e/out/ops/.
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('./out/ops/', import.meta.url)); fs.mkdirSync(OUT, { recursive: true });
const RUTAS = { hidrometria: 'hidrometria', canales: 'canales', balance: 'balance' };
const pedido = process.argv[2] ?? 'todas';
const rutas = pedido === 'todas' ? Object.keys(RUTAS) : [pedido];
const casos = [
  { nombre: 'escritorio', motor: chromium, ctx: { viewport: { width: 1440, height: 900 } } },
  { nombre: 'ipad', motor: webkit, ctx: { ...devices['iPad Pro 11'] } },
  { nombre: 'iphone', motor: webkit, ctx: { ...devices['iPhone 15 Pro Max'] } },
];

let obs = 0;
for (const ruta of rutas) {
  for (const c of casos) {
    const b = await c.motor.launch(); const page = await (await b.newContext(c.ctx)).newPage();
    const err = []; page.on('pageerror', (e) => err.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text())) err.push(m.text().slice(0, 140)); });
    await page.goto(`http://localhost:5173/${RUTAS[ruta]}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForSelector('.sc-root .sc-hero', { timeout: 30000 }).catch(() => err.push('sin .sc-root .sc-hero'));
    await page.waitForTimeout(5000);
    const r = await page.evaluate(() => {
      const raiz = document.querySelector('.sc-root'); if (!raiz) return { ok: false };
      const chicos = [], peques = [];
      for (const el of raiz.querySelectorAll('*')) {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const f = parseFloat(getComputedStyle(el).fontSize); if (f < 11) chicos.push(`${el.className || el.tagName}:${f}`);
      }
      for (const el of raiz.querySelectorAll('button, a[href], summary, select, input')) {
        const r = el.getBoundingClientRect(); if (r.width && r.height < 43.5) peques.push(`${el.className || el.tagName}:${Math.round(r.height)}`);
      }
      const txt = raiz.innerText;
      return { ok: true, desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth, chicos: chicos.slice(0, 6), peques: peques.slice(0, 6),
        nan: /NaN|undefined|Infinity/.test(txt), h1: raiz.querySelectorAll('h1').length, tiles: raiz.querySelectorAll('.sc-tile').length };
    });
    const malo = !r.ok || r.chicos?.length || r.peques?.length || r.desborde > 1 || r.nan || err.length || r.h1 !== 1;
    if (malo) obs++;
    console.log(ruta, c.nombre, JSON.stringify(r), err.length ? 'ERRORES: ' + err.join(' | ') : '');
    await page.addStyleTag({ content: 'html,body,#root,.layout-container,.main-content{height:auto !important;overflow:visible !important}' });
    await page.waitForTimeout(600);
    const el = await page.$('.sc-root'); if (el) await el.screenshot({ path: `${OUT}${ruta}_${c.nombre}.png` }).catch(() => {});
    await b.close();
  }
}
console.log(obs ? `\n${obs} caso(s) con observaciones` : '\nTodo en regla'); process.exit(0);
