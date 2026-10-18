// Abre el detalle de cada estación en /clima, genera su informe y revisa el aviso de viento y el riesgo térmico.
//   node e2e/clima-estacion-informe.mjs   (requiere `npm run dev` en :5173)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('./out/clima-estacion/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errores = [];
page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
page.on('pageerror', (e) => errores.push(String(e)));
// INYECTA_VIENTO=7 fuerza ese viento SOLO en el navegador (intercepta la última lectura de cada estación).
if (process.env.INYECTA_VIENTO) {
  await page.route('**/rest/v1/clima_estacion_lecturas*limit=1*', async (route) => {
    const resp = await route.fetch();
    let json = [];
    try { json = await resp.json(); } catch { /* sin cuerpo */ }
    await route.fulfill({ response: resp, json: (Array.isArray(json) ? json : []).map((r) => ({ ...r, viento_ms: Number(process.env.INYECTA_VIENTO) })) });
  });
}
await page.goto('http://localhost:5173/clima', { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForSelector('[class*="estacion"]', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);

const tarjetas = await page.$$('.estaciones-grid > *, [class*="est-card"], [class*="estacion-card"]');
console.log('tarjetas detectadas:', tarjetas.length);
const resumen = [];
for (let i = 0; i < Math.min(tarjetas.length, 6); i++) {
  const t = (await page.$$('.estaciones-grid > *, [class*="est-card"], [class*="estacion-card"]'))[i];
  if (!t) break;
  await t.click();
  const hayInforme = await page.waitForSelector('.est-det-informe', { timeout: 20000 }).then(() => true).catch(() => false);
  if (!hayInforme) { resumen.push({ i, ok: false, motivo: 'sin botón Informe' }); await page.keyboard.press('Escape'); continue; }
  const nombre = (await page.textContent('[role="dialog"] h2, [role="dialog"] h3').catch(() => ''))?.trim().slice(0, 40);
  const panelViento = await page.evaluate(() => (document.querySelector('.v-alerta')?.textContent || '').trim());
  const riesgo = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] *')].map((e) => e.textContent).find((t) => /Riesgo de helada|Sin riesgo térmico|Rocío|Humedad nocturna/.test(t || '') && (t || '').length < 40) || '');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('.est-det-informe')]);
  const ruta = OUT + `estacion-${i}.html`;
  await dl.saveAs(ruta);
  const html = fs.readFileSync(ruta, 'utf8');
  const alertaInforme = (html.match(/Sobre \d+(?:\.\d+)? m\/s: deriva en aspersión/) || [''])[0];
  resumen.push({ i, nombre, panelViento, alertaInforme, riesgo: riesgo.trim().slice(0, 30), kb: Math.round(html.length / 1024) });
  await page.click('[role="dialog"] button[aria-label*="errar"], [role="dialog"] .est-det-cerrar, [role="dialog"] button:has(svg)').catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
}
await b.close();
console.log(JSON.stringify({ resumen, errores: errores.slice(0, 6) }, null, 1));
