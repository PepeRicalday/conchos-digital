// Red de estaciones JCAS en la cuenca del Conchos (Presas → Analítica → Cuenca): mapa propio, lluvia areal, tabla y reglas S/D.
//   PORT=5182 node e2e/cuenca-estaciones.mjs      (requiere dev server; bypass de login en localhost)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const BASE = `http://localhost:${process.env.PORT || 5173}`;
const OUT = fileURLToPath(new URL('./out/cuenca-estaciones/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };

const navegador = await chromium.launch();
for (const [nombre, vista] of [
  ['escritorio', { width: 1440, height: 900 }], ['ipad', { width: 820, height: 1180 }], ['iphone', { width: 390, height: 844 }],
]) {
  const ctx = await navegador.newContext({ viewport: vista });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) errores.push(m.text()); });

  await page.goto(`${BASE}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'domcontentloaded' });
  const sec = page.locator('section[aria-label="Red de estaciones de la cuenca"]');
  await sec.waitFor({ timeout: 45000 });
  await sec.locator('.cu-est').first().waitFor({ timeout: 45000 });
  await page.waitForTimeout(1200);

  const n = await sec.locator('.cu-est').count();
  verifica(n === 15, `[${nombre}] 15 marcadores en el mapa: 18 estaciones, con las 4 de Chihuahua en uno (${n})`);
  verifica(await sec.locator('tbody tr').count() >= 18, `[${nombre}] la tabla lista las 18 estaciones JCAS más las propias`);
  verifica(await page.locator('.an-kpi').count() === 4, `[${nombre}] los 4 indicadores de presas siguen intactos`);

  const txt = await sec.innerText();
  verifica(/Lluvia areal de la cuenca · 30 días/.test(txt), `[${nombre}] lluvia areal de 30 días rotulada`);
  verifica(/n = \d+ estaciones/.test(txt) && /cobertura \d+ %/.test(txt), `[${nombre}] el promedio declara cuántas estaciones y qué cobertura`);
  verifica(/provisional/i.test(txt) && /JCAS/.test(txt) && /contexto/i.test(txt), `[${nombre}] rotulado como JCAS / provisional / contexto`);
  verifica(!/Aquarius/i.test(txt), `[${nombre}] no usa la palabra Aquarius`);
  verifica(!/(^|[\s>(])(NaN|undefined|Infinity|null)([\s<).,]|$)/.test(txt), `[${nombre}] sin NaN/undefined/Infinity/null`);
  verifica(/San Antonio/.test(txt) && /Sin pluviómetro/.test(txt), `[${nombre}] San Antonio figura como "Sin pluviómetro" (lluvia S/D, no 0)`);
  const filaSA = sec.locator('tbody tr', { hasText: 'San Antonio' }).first();
  verifica(/S\/D/.test(await filaSA.innerText()), `[${nombre}] la lluvia de San Antonio es S/D`);
  verifica(/Parral/.test(txt) && /Excluida/.test(txt), `[${nombre}] Parral (0 mm con vecinas lluviosas) aparece como excluida`);

  // Ventana 7 días ↔ 30 días
  await sec.getByRole('button', { name: '7 días' }).click();
  verifica(/Lluvia areal de la cuenca · 7 días/.test(await sec.innerText()), `[${nombre}] el selector cambia la ventana a 7 días`);
  await sec.getByRole('button', { name: '30 días' }).click();
  // Día en curso (parcial) y último día completo: la lectura de hoy se rotula parcial y no se mezcla con los acumulados
  await sec.getByRole('button', { name: 'Hoy', exact: true }).click();
  const tHoy = await sec.innerText();
  verifica(/Lluvia areal de la cuenca · hoy \(parcial\)/.test(tHoy), `[${nombre}] ventana «Hoy» rotulada como parcial`);
  verifica(/hoy \d+-\w+-\d{4} \(parcial, lectura de las \d{2}:\d{2}\)/.test(tHoy) || /hoy sin lectura \(S\/D\)/.test(tHoy), `[${nombre}] el encabezado indica la fecha de hoy y la hora de la lectura (o S/D)`);
  verifica(/Lluvia hoy \(parcial\)/.test(tHoy) && /Lluvia ayer/.test(tHoy), `[${nombre}] la tabla trae las columnas hoy (parcial) y ayer`);
  verifica(await sec.locator('.cu-tag', { hasText: 'Propia' }).count() >= 1, `[${nombre}] la tabla incluye las estaciones propias (etiqueta «Propia»)`);
  await sec.getByRole('button', { name: 'Ayer', exact: true }).click();
  verifica(/Lluvia areal de la cuenca · ayer/.test(await sec.innerText()), `[${nombre}] ventana «Ayer» rotulada`);
  await sec.getByRole('button', { name: '30 días' }).click();

  // Selección desde el mapa (teclado) resalta la fila
  const est = sec.locator('.cu-est').nth(3);
  await est.focus();
  await page.keyboard.press('Enter');
  verifica(await est.getAttribute('aria-pressed') === 'true', `[${nombre}] seleccionar una estación con teclado marca aria-pressed`);
  verifica(await sec.locator('.cu-fila--sel').count() === 1, `[${nombre}] la fila de la tabla se resalta`);

  // Sin desborde horizontal de la página
  const ancho = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  verifica(ancho.sw <= ancho.cw + 1, `[${nombre}] sin scroll horizontal de página (${ancho.sw}/${ancho.cw})`);

  await sec.scrollIntoViewIfNeeded();
  await sec.screenshot({ path: `${OUT}${nombre}.png` });
  verifica(errores.length === 0, `[${nombre}] sin errores de consola${errores.length ? `: ${errores.slice(0, 2).join(' | ')}` : ''}`);
  await ctx.close();
}
await navegador.close();
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo OK');
process.exit(fallos.length ? 1 : 0);
