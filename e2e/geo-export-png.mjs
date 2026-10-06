// Prueba la exportación del mapa de Geo-Monitor a PNG (descarga real). Requiere `npm run dev` en :5173.
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
const OUT = new URL('./out/geo/', import.meta.url);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:5173/geo-monitor', { waitUntil: 'networkidle' }).catch(() => {});
await p.waitForSelector('.geo-map-leaflet', { timeout: 30000 }); await p.waitForTimeout(6000);
for (const base of ['satellite', 'standard']) {
  await p.evaluate((v) => localStorage.setItem('geo_base_layer', v), base); await p.reload({ waitUntil: 'networkidle' }).catch(() => {});
  await p.waitForSelector('.geo-map-leaflet'); await p.waitForTimeout(6000);
  const [d] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }).catch(() => null), p.getByRole('button', { name: /Exportar el mapa/ }).click()]);
  if (!d) { console.log(base, 'SIN DESCARGA', errs.join('|'), await p.locator('.geo-lotes-zoom-badge').allInnerTexts()); continue; }
  const dest = fileURLToPath(new URL(`export_${base}.png`, OUT)); await d.saveAs(dest);
  console.log(base, d.suggestedFilename(), fs.statSync(dest).size, 'bytes');
}
await b.close();
