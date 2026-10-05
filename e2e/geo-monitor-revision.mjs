// Revisión de /geo-monitor: errores de consola/red, desborde, S/D y controles de mapa (zoom, escala, atribución).
//   node e2e/geo-monitor-revision.mjs   (requiere `npm run dev` en :5173)
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
const OUT = fileURLToPath(new URL('./out/geo/', import.meta.url)); fs.mkdirSync(OUT, { recursive: true });
const casos = [
  { nombre: 'escritorio', motor: chromium, ctx: { viewport: { width: 1440, height: 900 } } },
  { nombre: 'ipad', motor: webkit, ctx: { ...devices['iPad Pro 11'] } },
  { nombre: 'iphone', motor: webkit, ctx: { ...devices['iPhone 15 Pro Max'] } },
];
for (const c of casos) {
  const b = await c.motor.launch(); const page = await (await b.newContext(c.ctx)).newPage();
  const err = []; page.on('pageerror', e => err.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text())) err.push(m.text()); });
  await page.goto('http://localhost:5173/geo-monitor', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForSelector('.geo-map-leaflet', { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const r = await page.evaluate(() => ({
    desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    zoom: !!document.querySelector('.leaflet-control-zoom'), escala: !!document.querySelector('.leaflet-control-scale'),
    atrib: document.querySelector('.leaflet-control-attribution')?.textContent?.slice(0, 60) ?? null,
    cerradasConNulo: [...document.querySelectorAll('.geo-apertura-badge b')].map(e => e.textContent),
    eficiencia: [...document.querySelectorAll('.geo-kpi-value')].map(e => e.textContent).slice(0, 8),
  }));
  console.log(c.nombre, JSON.stringify(r), err.length ? 'ERRORES: ' + err.slice(0, 3).join(' | ') : '');
  await page.getByRole("button", { name: /Capas y leyenda/ }).click().catch(() => {}); await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}${c.nombre}.png` }); await b.close();
}
