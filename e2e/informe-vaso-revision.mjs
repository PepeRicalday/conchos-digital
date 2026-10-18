// Revisión del informe del vaso: abre la ventana de filtros, genera la vista previa y exporta PDF + capturas.
//   node e2e/informe-vaso-revision.mjs   (con `npm run dev` en :5173)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('./out/vaso/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const err = [];
page.on('pageerror', (e) => err.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|tile|arcgis|WebGL|Context/i.test(m.text())) err.push(m.text().slice(0, 200)); });
await page.goto('http://localhost:5173/geo-monitor', { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(4000);
await page.getByText(/Boquilla.{0,3} al \d/).first().click({ timeout: 15000 }).catch((e) => err.push('evento: ' + e.message.slice(0, 80)));
await page.waitForTimeout(800);
await page.getByRole('button', { name: /Analizar Vaso Satelital/ }).click({ timeout: 10000 }).catch((e) => err.push('modal: ' + e.message.slice(0, 80)));
await page.waitForSelector('.vaso-hero', { timeout: 20000 });
await page.waitForTimeout(3000);
await page.getByRole('button', { name: /Informe institucional/ }).first().click();
await page.getByRole('dialog', { name: /Configurar informe del vaso/ }).waitFor({ timeout: 90000 });
await page.screenshot({ path: OUT + 'informe_config.png' });
await page.getByRole('button', { name: /Vista previa/ }).click();
const frame = page.frameLocator('iframe[title*="Vista previa"]');
await frame.locator('.pagina').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + 'informe_previa.png' });
const html = await page.evaluate(() => document.querySelector('iframe[title*="Vista previa"]').contentDocument.documentElement.outerHTML);
const p2 = await (await b.newContext({ viewport: { width: 1000, height: 1300 } })).newPage();
await p2.setContent(html, { waitUntil: 'load' });
await p2.pdf({ path: OUT + 'informe_vaso.pdf', format: 'Letter', printBackground: true, preferCSSPageSize: true });
const hojas = await p2.locator('.pagina').count();
for (let i = 0; i < hojas; i++) await p2.locator('.pagina').nth(i).screenshot({ path: `${OUT}informe_hoja${i + 1}.png` });
console.log('hojas:', hojas, 'errores:', err.length ? err : 'ninguno');
await b.close();
