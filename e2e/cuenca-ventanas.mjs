// Ventanas largas de la Cuenca (60 d, 90 d, ciclo agrícola): una sola ventana para cabecera, planos y red; S/D con motivo y nunca 0/NaN.
//   PORT=5173 node e2e/cuenca-ventanas.mjs      (requiere dev server; bypass de login en localhost)
import { chromium } from 'playwright';
const BASE = `http://localhost:${process.env.PORT || 5173}`;
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errs = [];
pg.on('pageerror', (e) => errs.push(e.message));
pg.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) errs.push(m.text()); });
await pg.goto(`${BASE}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'domcontentloaded' });
const planos = pg.locator('section[aria-label="Planos de la cuenca"]');
const red = pg.locator('section[aria-label="Red de estaciones de la cuenca"]');
await planos.locator('img.cu-plano-img').waitFor({ timeout: 45000 });
await red.locator('tbody tr').first().waitFor({ timeout: 45000 });
verifica(await red.getByRole('button', { name: 'Ciclo agrícola' }).count() === 1 && await red.getByRole('button', { name: '60 días' }).count() === 1 && await red.getByRole('button', { name: '90 días' }).count() === 1, 'la red ofrece 60 días, 90 días y ciclo agrícola');
const kpis = pg.locator('.cu-root .an-kpis');
const SIN = /\bNaN\b|undefined|Infinity|\bnull\b/;
for (const [nombre, etq] of [['60 días', /· 60 d/], ['90 días', /· 90 d/], ['Ciclo agrícola', /· ciclo/]]) {
  await red.getByRole('button', { name: nombre }).click();
  await pg.waitForTimeout(900);
  const t = await kpis.innerText();
  verifica(etq.test(t) && /Lluvia de la cuenca/.test(t), `[${nombre}] la cabecera sigue la ventana elegida`);
  verifica(await planos.getByRole('button', { name: nombre, pressed: true }).count() === 1, `[${nombre}] los planos quedan en la misma ventana (una sola)`);
  const txtRed = await red.innerText(), txtPl = await planos.innerText();
  verifica(!SIN.test(t + txtRed + txtPl), `[${nombre}] sin NaN/undefined/null`);
  const kpiArea = (await red.locator('.cu-red-kpi').first().innerText()).replace(/\s+/g, ' ');
  if (nombre !== 'Ciclo agrícola') verifica(/S\/D/.test(kpiArea) && /historia diaria guardada empieza el/.test(kpiArea), `[${nombre}] sin historia suficiente: S/D con el motivo y la fecha de inicio, no 0 (${kpiArea.slice(0, 120)})`);
  else verifica(/\d/.test(kpiArea) && !/NaN/.test(kpiArea), `[${nombre}] el ciclo en curso tiene cifra o S/D explicado (${kpiArea.slice(0, 120)})`);
  verifica(await red.locator('thead th', { hasText: /^Lluvia (60|90) d$|^Lluvia ciclo$/ }).count() === 1, `[${nombre}] la tabla añade su columna de lluvia`);
  verifica(await planos.locator('img.cu-plano-img').count() === 1 || await planos.locator('.cu-pl-estado').count() === 1, `[${nombre}] el plano se dibuja o dice S/D`);
}
// Parral: excluida por criterio explícito
await red.getByRole('button', { name: '30 días' }).click();
verifica(/criterio de SICA/.test(await red.innerText()), 'Parral aparece excluida por criterio explícito de SICA');
// propias con temperatura
verifica(/Boquilla[\s\S]{0,200}°C/.test(await red.locator('tbody').innerText()), 'las estaciones propias muestran temperatura');
verifica(errs.length === 0, `sin errores de consola (${errs.slice(0, 3).join(' | ')})`);
await b.close();
if (fallos.length) { console.log(`\n${fallos.length} FALLOS`); process.exit(1); }
console.log('\nTodo OK');
