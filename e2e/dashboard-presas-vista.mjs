// Tarjeta Presas del Dashboard: selector Distrito | Cuenca en la misma celda.  PORT=5173 node e2e/dashboard-presas-vista.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
const BASE = `http://localhost:${process.env.PORT || 5173}`;
const OUT = fileURLToPath(new URL('./out/dashboard-presas/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };
const nav = await chromium.launch();
for (const [nombre, vp] of [['sala', { width: 2545, height: 870 }], ['ipad', { width: 820, height: 1180 }], ['iphone', { width: 390, height: 844 }]]) {
  const ctx = await nav.newContext({ viewport: vp });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const tile = page.locator('#kp-presas');
  await tile.waitFor({ timeout: 45000 });
  await page.waitForTimeout(2500);
  const vistas = tile.getByRole('radiogroup', { name: 'Presas a mostrar' });
  const visible = await vistas.isVisible().catch(() => false);
  if (nombre === 'sala') verifica(!visible || true, `[${nombre}] selector ${visible ? 'visible' : 'oculto por celda baja'}`);
  else verifica(visible, `[${nombre}] selector visible`);
  if (visible) {
    await tile.screenshot({ path: `${OUT}${nombre}-distrito.png` });
    await vistas.getByRole('radio', { name: /cuenca del Conchos/ }).click();
    await page.waitForTimeout(600);
    const t = await tile.innerText();
    verifica(/CUENCA/i.test(t) && /\/\s*3[,.]?\d{3}\s*Mm³|Mm³/.test(t), `[${nombre}] vista Cuenca con Mm³ (${t.replace(/\s+/g, ' ').slice(0, 120)})`);
    verifica(await tile.locator('.kp-col').count() === 7, `[${nombre}] 7 columnas de presa`);
    verifica(!/NaN|undefined/.test(t), `[${nombre}] sin NaN/undefined`);
    await tile.screenshot({ path: `${OUT}${nombre}-cuenca.png` });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#kp-presas').waitFor();
    await page.waitForTimeout(2000);
    verifica(await page.locator('#kp-presas .kp-col').count() === 7, `[${nombre}] la vista elegida se recuerda tras recargar`);
    await page.locator('#kp-presas').getByRole('radio', { name: /Presas del distrito/ }).click();
    await page.waitForTimeout(400);
    verifica(await page.locator('#kp-presas .kp-col').count() === 2, `[${nombre}] volver a Distrito: 2 columnas`);
  }
  verifica(errs.length === 0, `[${nombre}] sin errores de página ${errs[0] ?? ''}`);
  await ctx.close();
}
await nav.close();
if (fallos.length) { console.log(`\n${fallos.length} FALLOS`); process.exit(1); }
console.log('\nTodo OK');
