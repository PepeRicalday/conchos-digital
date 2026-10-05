// Revisión visual y de reglas del Observatorio de Clima (escritorio / iPad / iPhone).
//   node e2e/clima-observatorio.mjs   (requiere `npm run dev` en :5173)
// Verifica: sin errores de consola, sin desborde horizontal, texto ≥ 11 px dentro de .cl-obs, objetivos táctiles ≥ 44 px.
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('./out/clima/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const base = 'http://localhost:5173';

const casos = [
  { nombre: 'escritorio', motor: chromium, ctx: { viewport: { width: 1440, height: 900 } } },
  { nombre: 'ipad', motor: webkit, ctx: { ...devices['iPad Pro 11'] } },
  { nombre: 'iphone', motor: webkit, ctx: { ...devices['iPhone 15 Pro Max'] } },
];

let fallos = 0;
for (const c of casos) {
  const b = await c.motor.launch();
  const ctx = await b.newContext(c.ctx);
  const page = await ctx.newPage();
  const errores = [];
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  page.on('pageerror', (e) => errores.push(String(e)));
  await page.goto(base + '/clima', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForSelector('.cl-obs', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const r = await page.evaluate(() => {
    const raiz = document.querySelector('.cl-obs');
    if (!raiz) return { ok: false };
    const chicos = [];
    for (const el of raiz.querySelectorAll('*')) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 11) chicos.push(`${el.tagName}.${el.className}: ${fs}px`);
    }
    const peques = [];
    for (const el of raiz.querySelectorAll('button, summary, select')) {
      const b = el.getBoundingClientRect();
      if (b.width && b.height < 43.5) peques.push(`${el.tagName}.${el.className}: ${Math.round(b.height)}px`);
    }
    return {
      ok: true,
      desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      chicos: chicos.slice(0, 8), peques: peques.slice(0, 8),
      secciones: raiz.querySelectorAll('.cl-seccion').length,
      graficas: raiz.querySelectorAll('.recharts-wrapper').length,
    };
  });
  const malo = !r.ok || r.chicos?.length || r.peques?.length || r.desborde > 1 || errores.length;
  if (malo) fallos++;
  console.log(c.nombre, JSON.stringify(r), errores.length ? `ERRORES: ${errores.slice(0, 3).join(' | ')}` : '');
  const el = await page.$('.cl-obs');
  if (el) await el.screenshot({ path: `${OUT}${c.nombre}.png` });
  await b.close();
}
console.log(fallos ? `\n${fallos} caso(s) con observaciones` : '\nTodo en regla');
process.exit(0);
