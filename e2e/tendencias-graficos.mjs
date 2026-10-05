// Capturas de los bloques de la pestaña Tendencias (Monitor Público).
//   node e2e/tendencias-graficos.mjs [carpeta=tendencias]
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
const carpeta = process.argv[2] || 'tendencias';
const OUT = fileURLToPath(new URL(`./out/${carpeta}/`, import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

async function abrir(page) {
  await page.goto('http://localhost:5173/monitor-publico', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForSelector('.dock-tab', { timeout: 20000 });
  await page.getByText('TENDENCIAS', { exact: false }).first().click();
  await page.waitForSelector('.tnd-block', { timeout: 20000 });
  await page.waitForTimeout(5000);
}
async function bloques(page, pref) {
  const kp = page.locator('.tnd-kpis');
  if (await kp.count()) await kp.first().screenshot({ path: `${OUT}${pref}_kpis.png` });
  const bl = page.locator('.tnd-block');
  const n = await bl.count();
  for (let i = 0; i < n; i++) await bl.nth(i).screenshot({ path: `${OUT}${pref}_bloque${i + 1}.png` });
}
const errs = [];
// Escritorio (Chromium)
{
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', e => errs.push(e.message));
  await abrir(page);
  await bloques(page, 'esc_escalas');
  await page.getByRole('button', { name: 'Comparar' }).click();
  await page.waitForTimeout(800);
  const svg = page.locator('.tnd-block').first().locator('svg').first();
  const bb = await svg.boundingBox();
  await page.mouse.move(bb.x + bb.width * 0.55, bb.y + bb.height * 0.45);
  await page.waitForTimeout(400);
  await page.locator('.tnd-block').first().screenshot({ path: `${OUT}esc_comparar_hover.png` });
  const medidas = await page.evaluate(() => [...document.querySelectorAll('.tnd-block svg text')].map(t => parseFloat(getComputedStyle(t).fontSize)).filter(Boolean));
  console.log('fuente SVG mín/máx (px):', Math.min(...medidas), Math.max(...medidas));
  await b.close();
}
// iPad (WebKit)
{
  const b = await webkit.launch();
  const ctx = await b.newContext({ ...devices['iPad Pro 11'], viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  await abrir(page);
  await bloques(page, 'ipad');
  await b.close();
}
console.log('errores:', errs);
