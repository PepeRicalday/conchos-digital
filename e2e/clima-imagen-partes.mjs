// Genera la imagen compartible del nivel Básico (2 partes) y guarda los PNG para revisarlos a ojo.
//   node e2e/clima-imagen-partes.mjs   (requiere `npm run dev` en :5173)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('./out/clima-imagen/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errores = [];
page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
page.on('pageerror', (e) => errores.push(String(e)));

await page.goto('http://localhost:5173/clima', { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForSelector('button:has-text("Pronóstico")', { timeout: 30000 });
await page.waitForTimeout(6000);
await page.click('button:has-text("Pronóstico")');
await page.waitForSelector('[role="dialog"]');
await page.click('[role="dialog"] button:has-text("Básico")');

const archivos = [];
page.on('download', async (d) => {
  const ruta = OUT + d.suggestedFilename();
  await d.saveAs(ruta);
  archivos.push(ruta);
});
await page.click('[role="dialog"] button:has-text("Imagen para compartir")');
const t0 = Date.now();
while (archivos.length < 2 && Date.now() - t0 < 90000) await page.waitForTimeout(500);

console.log('Archivos:', archivos.map((a) => a.split('/').pop()));
console.log('Errores de consola:', errores.length ? errores : 'ninguno');
await b.close();
