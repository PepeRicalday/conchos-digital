// Revisión visual del panel "NDVI mensual por módulo" de /geo-monitor (solo lectura; bypass de localhost).
//   node e2e/ndvi-revision.mjs   (con `npm run dev` en :5173)
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('./out/ndvi/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const casos = [
  { nombre: 'escritorio', motor: chromium, ctx: { viewport: { width: 1600, height: 900 } } },
  { nombre: 'iphone', motor: webkit, ctx: { ...devices['iPhone 15 Pro Max'] } },
];
for (const c of casos) {
  const b = await c.motor.launch();
  const page = await (await b.newContext(c.ctx)).newPage();
  const err = [];
  page.on('pageerror', (e) => err.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|tile/i.test(m.text())) err.push(m.text().slice(0, 200)); });
  let mapaRequests = 0;
  page.on('request', (r) => { if (/sentinel|services\.sentinel-hub|dataspace/i.test(r.url())) mapaRequests++; });
  await page.goto('http://localhost:5173/geo-monitor', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /Ver NDVI mensual por módulo/ }).click({ timeout: 20000 }).catch((e) => err.push('no abrió: ' + e.message.slice(0, 80)));
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => ({
    tarjetas: document.querySelectorAll('.ndvi-modulo-card-clickable').length,
    clases: [...document.querySelectorAll('.ndvi-clase')].map((e) => e.textContent.trim()),
    chipsMes: [...document.querySelectorAll('.ndvi-chip')].map((e) => e.textContent.trim()).slice(0, 12),
    selectsNativos: document.querySelectorAll('.vaso-scroll-content select').length,
    minimapas: document.querySelectorAll('.ndvi-minimap').length,
    leyenda: document.querySelectorAll('.ndvi-ley-lista li').length,
    pines: document.querySelectorAll('.ndvi-pin').length,
    promedio: document.querySelector('.plano-general-promedio-valor')?.textContent,
  }));
  console.log(c.nombre, JSON.stringify(info), 'peticiones satélite:', mapaRequests);
  await page.screenshot({ path: `${OUT}${c.nombre}.png`, fullPage: false });
  await page.evaluate(() => document.querySelector('.vaso-scroll-content')?.scrollTo(0, 900));
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}${c.nombre}_plano.png`, fullPage: false });
  console.log(c.nombre, 'errores:', err.length ? err.slice(0, 4) : 'ninguno');
  await b.close();
}
