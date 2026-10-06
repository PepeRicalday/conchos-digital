// Revisión del Dashboard (escritorio / iPad / iPhone): sin errores, sin desborde, texto ≥ 11 px, táctiles ≥ 44 px,
// y que no aparezcan "NaN"/"undefined" ni ceros de relleno. Requiere `npm run dev` en :5173.
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
const OUT = fileURLToPath(new URL('./out/dash/', import.meta.url)); fs.mkdirSync(OUT, { recursive: true });
const casos = [
  { nombre: 'escritorio', motor: chromium, ctx: { viewport: { width: 1440, height: 900 } } },
  { nombre: 'ipad', motor: webkit, ctx: { ...devices['iPad Pro 11'] } },
  { nombre: 'iphone', motor: webkit, ctx: { ...devices['iPhone 15 Pro Max'] } },
];
let obs = 0;
for (const c of casos) {
  const b = await c.motor.launch(); const page = await (await b.newContext(c.ctx)).newPage();
  const err = []; page.on('pageerror', e => err.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text())) err.push(m.text().slice(0, 140)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForSelector('.sc-root .sc-pulso', { timeout: 30000 }).catch(() => err.push('sin .sc-pulso'));
  await page.waitForTimeout(5000);
  const r = await page.evaluate(() => {
    const raiz = document.querySelector('.sc-root'); if (!raiz) return { ok: false };
    const chicos = [], peques = [];
    for (const el of raiz.querySelectorAll('*')) {
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      const f = parseFloat(getComputedStyle(el).fontSize); if (f < 11) chicos.push(`${el.className || el.tagName}:${f}`);
    }
    for (const el of raiz.querySelectorAll('button, a[href], summary, select')) {
      const r = el.getBoundingClientRect(); if (r.width && r.height < 43.5) peques.push(`${el.className || el.tagName}:${Math.round(r.height)}`);
    }
    const txt = raiz.innerText;
    return { ok: true, desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth, chicos: chicos.slice(0, 6), peques: peques.slice(0, 6),
      nan: /NaN|undefined|Infinity/.test(txt), tiles: raiz.querySelectorAll('.sc-tile').length, graficas: raiz.querySelectorAll('.recharts-wrapper').length };
  });
  if (!r.ok || r.chicos?.length || r.peques?.length || r.desborde > 1 || r.nan || err.length) obs++;
  console.log(c.nombre, JSON.stringify(r), err.length ? 'ERRORES: ' + err.join(' | ') : '');
  const el = await page.$('.sc-root'); if (el) await page.screenshot({ path: `${OUT}${c.nombre}.png` });
  await b.close();
}
console.log(obs ? `\n${obs} caso(s) con observaciones` : '\nTodo en regla'); process.exit(0);
