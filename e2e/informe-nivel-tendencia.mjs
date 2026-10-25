// Informe "Nivel y tendencia de presas": abre el modal en /presas, genera la vista previa, captura el iframe y descarga los PNG.
//   node e2e/informe-nivel-tendencia.mjs [carpeta=informe-nivel-tendencia]      (requiere dev server en :5173)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const carpeta = process.argv[2] || 'informe-nivel-tendencia';
const OUT = fileURLToPath(new URL(`./out/${carpeta}/`, import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const errs = [];
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto('http://localhost:5173/presas', { waitUntil: 'networkidle' }).catch(() => {});
const info = page.getByRole('button', { name: /infograf/i }).first();
const boton = page.getByRole('button', { name: /informe nivel y tendencia/i }).first();
await boton.waitFor({ timeout: 30000 });
verifica(await info.isVisible(), 'botón de infografía visible junto al informe');
await page.screenshot({ path: `${OUT}00-cabecera.png`, clip: { x: 200, y: 30, width: 1400, height: 90 } });

await boton.click();
const dialogo = page.getByRole('dialog');
await dialogo.waitFor();
await page.getByRole('button', { name: /vista previa/i }).first().waitFor();
await page.waitForFunction(() => { const x = [...document.querySelectorAll('button')].find(e => /vista previa/i.test(e.textContent || '')); return x && !x.disabled; }, null, { timeout: 30000 });
await page.screenshot({ path: `${OUT}01-filtros.png` });

await page.getByRole('button', { name: /vista previa/i }).first().click();
const marco = page.locator('iframe[title^="Vista previa"]');
await marco.waitFor({ timeout: 30000 });
const frame = await (await marco.elementHandle()).contentFrame();
await frame.waitForSelector('.hoja', { timeout: 15000 });
const hojas = await frame.locator('.hoja').count();
verifica(hojas === 2, `una hoja por presa (${hojas})`);
const texto = await frame.locator('body').innerText();
verifica(!/NaN|undefined/.test(texto), 'sin NaN/undefined en el informe');
const alto = await frame.evaluate(() => document.documentElement.scrollHeight);
await page.setViewportSize({ width: 1600, height: Math.min(alto + 200, 9000) });
await page.waitForTimeout(400);
for (let i = 0; i < hojas; i++) {
  await frame.locator('.hoja').nth(i).screenshot({ path: `${OUT}hoja-${i + 1}.png` });
}
console.log('Hojas:', OUT);

await page.setViewportSize({ width: 1600, height: 950 });
const [d1] = await Promise.all([
  page.waitForEvent('download', { timeout: 90000 }),
  page.getByRole('button', { name: /descargar png/i }).click(),
]);
const nombre = d1.suggestedFilename();
await d1.saveAs(`${OUT}${nombre}`);
const buf = fs.readFileSync(`${OUT}${nombre}`);
verifica(buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', `PNG válido (${nombre})`);
verifica(buf.readUInt32BE(16) === 1960, `ancho 1960 px (2x de 980): ${buf.readUInt32BE(16)}`);
console.log('alto PNG:', buf.readUInt32BE(20), 'peso MB:', (buf.length / 1048576).toFixed(2));

await b.close();
const relevantes = errs.filter(e => !/favicon|ResizeObserver/i.test(e));
verifica(relevantes.length === 0, `sin errores de consola/JS (${relevantes.length})`);
if (relevantes.length) console.log(relevantes.slice(0, 5));
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo OK');
process.exit(fallos.length ? 1 : 0);
