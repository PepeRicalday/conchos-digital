// Revisión visual de /alertas en escritorio e iPhone (solo lectura; usa el bypass de localhost).
//   node e2e/alertas-revision.mjs   (con `npm run dev` en :5173)
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('./out/alertas/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const base = 'http://localhost:5173';
const errores = [];

const b = await chromium.launch();
const pc = await b.newPage({ viewport: { width: 1999, height: 1000 } });
pc.on('console', (m) => { if (m.type() === 'error') errores.push(m.text().slice(0, 200)); });
pc.on('pageerror', (e) => errores.push('pageerror: ' + e.message.slice(0, 200)));
await pc.goto(base + '/alertas', { waitUntil: 'networkidle' }).catch(() => {});
await pc.waitForTimeout(4000);
await pc.screenshot({ path: OUT + 'escritorio.png', fullPage: true });
// pestaña Antiguas + confirmación de "Atender" (sin confirmar: solo lectura)
await pc.getByRole('tab', { name: /Antiguas/ }).click().catch(() => {});
await pc.waitForTimeout(600);
await pc.getByRole('button', { name: /^Atender alerta/ }).first().click().catch(() => {});
await pc.waitForTimeout(400);
await pc.screenshot({ path: OUT + 'escritorio_antiguas_confirmacion.png', fullPage: true });
const info = await pc.evaluate(() => ({
  tabs: [...document.querySelectorAll('[role=tab]')].map((t) => t.textContent.trim()),
  filas: document.querySelectorAll('.al-fila').length,
  scrollH: document.documentElement.scrollHeight,
  overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}));
console.log('escritorio', JSON.stringify(info));
await b.close();

const w = await webkit.launch();
const ctx = await w.newContext({ ...devices['iPhone 15 Pro Max'] });
const ph = await ctx.newPage();
ph.on('pageerror', (e) => errores.push('pageerror(ph): ' + e.message.slice(0, 200)));
await ph.goto(base + '/alertas', { waitUntil: 'networkidle' }).catch(() => {});
await ph.waitForTimeout(4000);
await ph.screenshot({ path: OUT + 'iphone.png', fullPage: true });
console.log('iphone overflowX:', await ph.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth));
await w.close();
console.log('errores de consola:', errores.length ? errores : 'ninguno');
