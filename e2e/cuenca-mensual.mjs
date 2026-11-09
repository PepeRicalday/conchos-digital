// Mes a mes de la Cuenca (totales mensuales de JCAS): barras + tabla, S/D explícito, sin NaN.
//   PORT=5173 node e2e/cuenca-mensual.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
const BASE = `http://localhost:${process.env.PORT || 5173}`;
const OUT = fileURLToPath(new URL('./out/cuenca-mensual/', import.meta.url)); fs.mkdirSync(OUT, { recursive: true });
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };
const b = await chromium.launch();
for (const [n, w, h] of [['desktop', 1600, 1000], ['iphone', 430, 932]]) {
  const pg = await (await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500 })).newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) errs.push(m.text()); });
  await pg.goto(`${BASE}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'domcontentloaded' });
  const sec = pg.locator('#cu-mensual');
  await sec.locator('svg.cu-mes-svg').waitFor({ timeout: 45000 });
  const txt = await sec.innerText();
  verifica(!/\bNaN\b|undefined|Infinity|\bnull\b/.test(txt), `[${n}] sin NaN/undefined/null`);
  verifica(await sec.locator('tbody tr').count() >= 6, `[${n}] la tabla trae varios meses (${await sec.locator('tbody tr').count()})`);
  verifica(await sec.locator('rect.cu-mes-barra, rect.cu-mes-sd').count() === await sec.locator('tbody tr').count(), `[${n}] una barra o casilla S/D por mes`);
  verifica(/provisional/i.test(txt) && !/normal\b.*anomal/.test('') && /no hay «normal» ni anomalía/.test(txt), `[${n}] provisional y sin «normal»/anomalía`);
  verifica(/Acumulado de/.test(txt), `[${n}] KPI de acumulado (S/D no se suma como 0)`);
  const ancho = await sec.evaluate((e) => ({ w: e.scrollWidth, c: e.clientWidth }));
  verifica(ancho.w <= ancho.c + 2, `[${n}] sin desborde horizontal (${ancho.w}/${ancho.c})`);
  await sec.scrollIntoViewIfNeeded(); await pg.waitForTimeout(500);
  await sec.screenshot({ path: `${OUT}mensual-${n}.png` });
  verifica(errs.length === 0, `[${n}] sin errores de consola (${errs.slice(0, 2).join(' | ')})`);
  await pg.close();
}
await b.close();
if (fallos.length) { console.log(`\n${fallos.length} FALLOS`); process.exit(1); }
console.log('\nTodo OK');
