// Revisión visual del modal "Manejo de vaso" (La Boquilla) en escritorio e iPhone. Solo lectura (bypass de localhost).
//   node e2e/vaso-revision.mjs   (con `npm run dev` en :5173)
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('./out/vaso/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const casos = [
  { nombre: 'escritorio', motor: chromium, ctx: { viewport: { width: 1600, height: 1000 } } },
  { nombre: 'ipad', motor: webkit, ctx: { ...devices['iPad Pro 11 landscape'] } },
  { nombre: 'iphone', motor: webkit, ctx: { ...devices['iPhone 15 Pro Max'] } },
];
for (const c of casos) {
  const b = await c.motor.launch();
  const page = await (await b.newContext({ ...c.ctx, serviceWorkers: 'block' })).newPage();
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
    fuentes: [...document.querySelectorAll('.vaso-sup-item')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 160)),
    evolucion: { kpis: [...document.querySelectorAll('.vaso-evo-kpis .vaso-kpi')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()).slice(0, 3),
      galeria: document.querySelectorAll('.vaso-galeria-mes').length, validacion: [...document.querySelectorAll('.vaso-punto-fila')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 70)),
      metodo: document.querySelector('.vaso-evo-cab .vaso-chip')?.textContent, viejo: !!document.querySelector('.vaso-analytics'), puntos: document.querySelectorAll('.vaso-punto-fila .pista i').length },
    pieBarra: [...document.querySelectorAll('.vaso-barra-pie span')].map((e) => { const b = e.parentElement.getBoundingClientRect(); return e.textContent + '@' + Math.round(((e.getBoundingClientRect().left + e.getBoundingClientRect().width / 2 - b.left) / b.width) * 100) + '%'; }),
    kickerIconoEnLinea: [...document.querySelectorAll('.vaso-kicker')].every((k) => { const s = k.querySelector('svg'); return !s || Math.abs(s.getBoundingClientRect().top - k.getBoundingClientRect().top) < 12; }),
    textoMenor12: [...document.querySelectorAll('.vaso-sc *')].filter((e) => e.childElementCount === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 11.5).map((e) => e.className + ':' + getComputedStyle(e).fontSize).slice(0, 5),
    desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    mensajeFijoViejo: /estable basada en el aforo/.test(document.body.innerText) || /anillo de sequ/.test(document.body.innerText),
  }));
  console.log(c.nombre, JSON.stringify(info, null, 1));
  await page.screenshot({ path: `${OUT}${c.nombre}.png` });
  await page.locator('.vaso-evo').scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}${c.nombre}_evolucion.png` });
  // diferencia de polígonos (azolve) en km² reales
  await page.getByRole('button', { name: /^Diferencia/ }).click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  console.log(c.nombre, 'diferencia:', await page.evaluate(() => [...document.querySelectorAll('.vaso-capa')].map((e) => e.textContent.trim())), 'mapa:', await page.evaluate(() => document.querySelector('.vaso-mapa svg')?.getAttribute('viewBox')));
  // Regla viva: −2 m con el teclado sobre la manija (Av Pág ×4) y luego arrastre hacia arriba.
  await page.locator('.vaso-regla-manija').first().focus().catch((e) => err.push('sin manija: ' + e.message.slice(0, 60)));
  for (let i = 0; i < 4; i++) await page.keyboard.press('PageDown');
  await page.waitForTimeout(600);
  const leeSim = () => page.evaluate(() => ({
    manija: document.querySelector('.vaso-regla-manija')?.getAttribute('aria-valuetext'),
    datos: [...document.querySelectorAll('.vaso-datos > div')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
    pct: document.querySelector('.vaso-num')?.textContent, chip: !!document.querySelector('.vaso-chip--info'),
    bordeSim: !!document.querySelector('.vaso-hero--sim'),
  }));
  console.log(c.nombre, 'simulación teclado:', JSON.stringify(await leeSim()));
  await page.locator('.vaso-hero').scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `${OUT}${c.nombre}_simulado.png` });
  const caja = await page.locator('.vaso-regla-manija rect').first().boundingBox().catch(() => null);
  if (caja) {
    const x = caja.x + caja.width / 2, y = caja.y + caja.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 60, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(500);
    console.log(c.nombre, 'simulación arrastre:', JSON.stringify(await leeSim()));
  } else err.push('no se midió la manija');
  await page.keyboard.press('Escape').catch(() => {});
  console.log(c.nombre, 'errores:', err.length ? err.slice(0, 4) : 'ninguno');
  await b.close();
}
