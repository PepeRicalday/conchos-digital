// Salud de las fuentes de datos (línea del encabezado de Cuenca), solo lectura.
//   PORT=5173 node e2e/cuenca-salud.mjs [prefijo]
// Acepta los dos estados válidos: con la vista (lista de fuentes) o sin ella («sin información», nunca «al día»).
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
const PORT = process.env.PORT || 5173, pref = process.argv[2] || 'salud';
const OUT = new URL('./out/cuenca-auditoria/', import.meta.url); fs.mkdirSync(OUT, { recursive: true });
const VP = [['1440', 1440, 900], ['ipad', 1180, 820], ['iphone', 430, 932]];
const b = await chromium.launch(); let fallos = 0;
for (const [n, w, h] of VP) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900, isMobile: w < 500, serviceWorkers: 'block' });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error' && !/v_cuenca_salud_fuentes|404|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  const falla = (msg) => { fallos++; console.log(`  ✗ [${n}] ${msg}`); };
  await pg.goto(`http://localhost:${PORT}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'domcontentloaded' });
  await pg.waitForSelector('.cu-root .an-kpis', { timeout: 45000 });
  await pg.waitForSelector('.cu-salud', { timeout: 20000 });
  const resumen = (await pg.locator('.cu-salud summary').innerText()).replace(/\s+/g, ' ').trim();
  await pg.locator('.cu-salud summary').click();
  await pg.waitForTimeout(600);
  const r = await pg.evaluate(() => {
    const d = document.querySelector('.cu-salud'), main = document.querySelector('.main-content');
    const sum = d.querySelector('summary').getBoundingClientRect();
    return {
      abierto: d.open, filas: d.querySelectorAll('tbody tr').length, aviso: d.querySelector('.an-aviso')?.innerText || null,
      nan: /NaN|undefined|Infinity/.test(d.innerText), scrollW: main ? main.scrollWidth - main.clientWidth : -1, altoSummary: Math.round(sum.height),
      estados: [...d.querySelectorAll('tbody .cu-estado')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
    };
  });
  console.log(n, JSON.stringify({ resumen, ...r }));
  const conVista = r.filas > 0;
  if (!r.abierto) falla('el detalle no se abre');
  if (conVista && !/Fuentes de datos: \d+ de \d+ al día/.test(resumen)) falla(`resumen inesperado: ${resumen}`);
  if (!conVista && !/sin información/.test(resumen)) falla(`sin la vista debe decir «sin información», dice: ${resumen}`);
  if (!conVista && /al día/.test(resumen)) falla('sin la vista NO puede afirmar que está al día');
  if (!conVista && !r.aviso) falla('sin la vista falta el aviso de no suponer que están al día');
  if (r.nan) falla('texto con NaN/undefined/Infinity');
  if (r.scrollW > 2) falla(`desborde horizontal ${r.scrollW}px`);
  if (errs.length) falla(`errores de consola/página: ${errs.slice(0, 2).join(' | ')}`);
  await pg.locator('.cu-salud').screenshot({ path: fileURLToPath(new URL(`${pref}-${n}.png`, OUT)) });
  await ctx.close();
}
await b.close();
console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo en orden');
process.exit(fallos ? 1 : 0);
