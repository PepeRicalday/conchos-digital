// Revisión visual del modal "Manejo de vaso" (La Boquilla) en escritorio e iPhone. Solo lectura (bypass de localhost).
//   node e2e/vaso-revision.mjs   (con `npm run dev` en :5173)
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('./out/vaso/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const casos = [
  { nombre: 'escritorio', motor: chromium, ctx: { viewport: { width: 1600, height: 1000 } } },
  { nombre: 'iphone', motor: webkit, ctx: { ...devices['iPhone 15 Pro Max'] } },
];
for (const c of casos) {
  const b = await c.motor.launch();
  const page = await (await b.newContext(c.ctx)).newPage();
  const err = [];
  page.on('pageerror', (e) => err.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|tile|arcgis/i.test(m.text())) err.push(m.text().slice(0, 200)); });
  await page.goto('http://localhost:5173/geo-monitor', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(4000);
  // La Boquilla aparece como evento "ALMACENAMIENTO" mientras su llenado esté bajo: al pulsarlo se selecciona la presa.
  const evento = page.getByText(/Boquilla.{0,3} al \d/).first();
  await evento.click({ timeout: 15000 }).catch((e) => err.push('no se halló el evento de la presa: ' + e.message.slice(0, 80)));
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Analizar Vaso Satelital/ }).click({ timeout: 10000 }).catch((e) => err.push('no abrió el modal: ' + e.message.slice(0, 80)));
  await page.waitForSelector('.vaso-hero', { timeout: 20000 }).catch(() => err.push('no apareció el bloque principal'));
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => ({
    titulo: document.querySelector('.vaso-header h2')?.textContent,
    pct: document.querySelector('.vaso-num')?.textContent,
    chips: [...document.querySelectorAll('.vaso-chips .vaso-chip')].map((e) => e.textContent.trim()),
    mensaje: document.querySelector('.vaso-mensaje')?.textContent,
    datos: [...document.querySelectorAll('.vaso-datos > div')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
    limnimetro: !!document.querySelector('.pr-lim-svg'),
    fuentes: [...document.querySelectorAll('.vaso-sup-item')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 90)),
    desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    mensajeFijoViejo: /estable basada en el aforo/.test(document.body.innerText) || /anillo de sequ/.test(document.body.innerText),
  }));
  console.log(c.nombre, JSON.stringify(info, null, 1));
  await page.screenshot({ path: `${OUT}${c.nombre}.png` });
  // simula -2 m con el teclado (PageDown ×4) y revisa el resultado junto al control
  await page.locator('.vaso-sim-ctl input[type=range]').focus().catch(() => {});
  for (let i = 0; i < 4; i++) await page.keyboard.press('PageDown');
  await page.waitForTimeout(500);
  console.log(c.nombre, 'simulación:', await page.evaluate(() => ({ valor: document.querySelector('.vaso-sim-valor')?.textContent, res: document.querySelector('.vaso-sim-res')?.textContent.replace(/\s+/g, ' '), chip: [...document.querySelectorAll('.vaso-chip')].map((e) => e.textContent.trim()).includes('SIMULADO') })));
  await page.screenshot({ path: `${OUT}${c.nombre}_simulado.png` });
  console.log(c.nombre, 'errores:', err.length ? err.slice(0, 4) : 'ninguno');
  await b.close();
}
