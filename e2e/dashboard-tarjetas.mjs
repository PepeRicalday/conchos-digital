// Captura cada tarjeta del Dashboard por separado (recorte) para revisar su diseño y su uso del espacio.
//   node e2e/dashboard-tarjetas.mjs [ancho alto etiqueta]     p. ej.  node e2e/dashboard-tarjetas.mjs 2545 870 sala
// Requiere `npm run dev` en :5173. Salida: e2e/out/tarjetas/<etiqueta>-<id>.png y tamaño de cada tarjeta.
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('./out/tarjetas/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const [w, h, tag] = [Number(process.argv[2] || 2545), Number(process.argv[3] || 870), process.argv[4] || 'sala'];
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.kp-grid', { timeout: 45000 });
await page.waitForTimeout(7000);
for (const el of await page.$$('.kp-tile')) {
  const id = await el.evaluate((e) => e.id || 'sin-id');
  const r = await el.boundingBox();
  console.log(id, `${Math.round(r.width)}x${Math.round(r.height)}`);
  await el.screenshot({ path: `${OUT}${tag}-${id}.png` });
}
const ahora = await page.$('.kc-ahora');
if (ahora) { const r = await ahora.boundingBox(); console.log('clima-ahora', `${Math.round(r.width)}x${Math.round(r.height)}`); await ahora.screenshot({ path: `${OUT}${tag}-clima-ahora.png` }); }
await b.close();
