// Cuenca del Conchos (Presas → Analítica → «Cuenca del Conchos») v2: tanques proporcionales, detalle, múltiplos, lluvia.
//   PORT=5173 node e2e/cuenca-conchos.mjs      (requiere dev server; bypass de login en localhost)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const BASE = `http://localhost:${process.env.PORT || 5173}`;
const OUT = fileURLToPath(new URL('./out/cuenca-conchos/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };

const navegador = await chromium.launch();
for (const [nombre, vista, esPhone] of [
  ['escritorio', { width: 1440, height: 900 }, false], ['ipad', { width: 820, height: 1180 }, false], ['iphone', { width: 390, height: 844 }, true],
]) {
  const ctx = await navegador.newContext({ viewport: vista });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) errores.push(m.text()); });

  await page.goto(`${BASE}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'domcontentloaded' });
  const panel = page.locator('.cu-root', { has: page.getByRole('heading', { name: 'Cuenca del Conchos' }) }).first();
  await panel.waitFor({ timeout: 45000 });
  verifica(await page.getByRole('button', { name: 'Cuenca del Conchos' }).getAttribute('aria-pressed') === 'true', `[${nombre}] enlace profundo abre la vista Cuenca del Conchos`);

  // ── Vista Tanques (predeterminada): tanques en pantallas anchas, lista en iPhone y contenedores estrechos
  const item = page.locator('.cu-tanque, .cu-movil');
  await item.first().waitFor({ timeout: 45000 });
  await page.waitForTimeout(1500);
  const n = await item.count();
  verifica(n === 7, `[${nombre}] 7 presas en la vista Tanques (${n}, ${esPhone ? 'lista' : 'tanques'})`);
  verifica(esPhone ? await page.locator('.cu-movil').count() === 7 : await page.locator('.cu-tanque').count() === 7, `[${nombre}] ${esPhone ? 'lista móvil' : 'tanques proporcionales'} según el dispositivo`);
  verifica(await page.locator('.an-kpi').count() === 4, `[${nombre}] 4 indicadores`);

  const txt = await panel.innerText();
  verifica(/San Gabriel, Dgo\./.test(txt), `[${nombre}] San Gabriel se rotula con su estado: "San Gabriel, Dgo."`);
  verifica(/Ojinaga/.test(txt) && /USIBWC/.test(txt) && /provisionales/i.test(txt), `[${nombre}] rotulado como Ojinaga / USIBWC / provisional`);
  verifica(!/(^|[\s>])(NaN|undefined|Infinity)([\s<]|$)/.test(txt), `[${nombre}] sin NaN/undefined/Infinity`);

  // Chihuahua: último dato con la marca (no S/D)
  const chi = page.locator('.cu-tanque[data-ubicacion="538"], .cu-movil[data-ubicacion="538"]').first();
  const chiTxt = await chi.innerText();
  // Chihuahua depende del dato real: CONAGUA estuvo 47 días sin actualizar y reanudó el 8-nov-2026. Se acepta cualquiera de los dos estados.
  const chiAtrasada = /Igual \d+ d/.test(chiTxt);
  verifica(/38[.,]\d/.test(chiTxt) && !/S\/D\s*%?/.test(chiTxt.replace(/Mm³/g, '')), `[${nombre}] Chihuahua muestra su 38.x % (no S/D)${chiAtrasada ? ' con la marca "Igual N d"' : ' y ya no está marcada'}`);

  // Selección: tocar una presa abre su detalle
  const pico = page.locator('.cu-tanque[data-ubicacion="540"], .cu-movil[data-ubicacion="540"]').first();
  await pico.click();
  verifica(await pico.getAttribute('aria-pressed') === 'true', `[${nombre}] seleccionar una presa marca aria-pressed`);
  const detalle = page.locator('section[aria-label="Detalle de Pico del Águila"]');
  verifica(await detalle.isVisible(), `[${nombre}] se abre el detalle de la presa seleccionada`);
  const detTxt = await detalle.innerText();
  verifica(/Volumen útil/.test(detTxt) && /Posición histórica/.test(detTxt) && /Tendencia 30 d/.test(detTxt) && /n = \d+ años/.test(detTxt), `[${nombre}] el detalle trae volumen útil, posición histórica (n = N años) y tendencia`);
  verifica(/Coronado/.test(detTxt) && /DR-103/.test(detTxt), `[${nombre}] la ficha de Pico del Águila muestra su municipio y DR-103 verificados`);
  await page.locator('.cu-tanque[data-ubicacion="541"], .cu-movil[data-ubicacion="541"]').first().click();
  const sg = await page.locator('section[aria-label="Detalle de San Gabriel, Dgo."]').innerText();
  verifica(/Ocampo, Dgo\./.test(sg) && /Río Florido/.test(sg), `[${nombre}] la ficha de San Gabriel muestra Ocampo, Dgo. y Río Florido`);

  // Pequeños múltiplos: una mini-serie por presa, con la banda rotulada
  verifica(await page.locator('.cu-mini').count() === 7, `[${nombre}] 7 mini-series (pequeños múltiplos)`);
  verifica(/n = \d+ años/.test(await page.locator('section[aria-label^="Llenado de las presas"]').innerText()), `[${nombre}] los múltiplos rotulan "n = N años" (o el rango de 12 meses)`);

  // Filtros: orden por % llenado pone primero la MENOS llena (Luis L. León, 12.9 %); alcance distrito deja 2
  await page.getByRole('button', { name: '% llenado' }).click();
  const primero = await item.first().innerText();
  verifica(/Luis L\. León/.test(primero), `[${nombre}] Orden "% llenado": la menos llena (Luis L. León) va primero`);
  await page.getByRole('button', { name: 'Solo distrito' }).click();
  verifica(await item.count() === 2, `[${nombre}] Alcance "Solo distrito": 2 presas (${await item.count()})`);
  await page.getByRole('button', { name: 'Todas', exact: true }).click();
  await page.getByRole('button', { name: 'Cuenca', exact: true }).first().click().catch(() => {});

  // ── Vista Tabla: se conserva la tabla con las 7 presas
  await page.getByRole('button', { name: 'Tabla', exact: true }).click();
  const filasSel = 'section[aria-label="Estado de las presas de la cuenca"] .cu-tabla tbody tr';
  await page.locator(filasSel).first().waitFor({ timeout: 15000 });
  const filas = await page.locator(filasSel).count();
  verifica(filas === 7, `[${nombre}] vista Tabla con las 7 presas (${filas})`);
  const boq = page.locator(filasSel, { hasText: 'La Boquilla' });
  verifica(/Distrito/.test(await boq.innerText()) && /819[.,]8/.test(await boq.innerText()), `[${nombre}] Boquilla: presa del distrito con 819.8 Mm³`);
  verifica(/Diferencia contra CILA: 0[.,]00 %/.test(await boq.innerText()), `[${nombre}] Boquilla muestra la diferencia contra CILA`);
  const chiFila = await page.locator(filasSel, { hasText: 'Chihuahua' }).innerText();
  verifica(/8[.,]9/.test(chiFila) && /38[.,]\d\s*%/.test(chiFila) && (!chiAtrasada || /Sin actualizar/i.test(chiFila)), `[${nombre}] tabla: Chihuahua con su último dato${chiAtrasada ? ' y "sin actualizar"' : ''}`);
  if (chiAtrasada) verifica(/desde el \d+/i.test(chiFila) && /\d+ días/.test(chiFila), `[${nombre}] tabla: Chihuahua indica desde cuándo y cuántos días`);
  const mad = await page.locator(filasSel, { hasText: 'Madero' }).innerText();
  verifica(!/Sin actualizar/i.test(mad), `[${nombre}] Madero no se marca como sin actualizar`);
  if (chiAtrasada) verifica(/Lecturas? sin actualizar/i.test(await panel.innerText()), `[${nombre}] aviso de lecturas sin actualizar visible`);
  await page.getByRole('button', { name: 'Tanques', exact: true }).click();

  // ── Lluvia: 3 pluviómetros, tira de 30 días, ciclo agrícola
  const lluvia = page.locator('section[aria-label="Lluvia en la cuenca"]');
  await lluvia.waitFor({ timeout: 15000 });
  verifica(await lluvia.locator('tbody tr').count() === 3, `[${nombre}] lluvia: 3 pluviómetros`);
  verifica(await lluvia.locator('thead th').count() === 5, `[${nombre}] lluvia: pluviómetro, tira de 30 días, 7 d, 30 d y ciclo`);
  verifica(await lluvia.locator('.cu-tira').count() === 3 && await lluvia.locator('.cu-dia').count() === 90, `[${nombre}] lluvia: tira de 30 días por pluviómetro (90 celdas)`);
  const lt = await lluvia.innerText();
  verifica(/Villalba/.test(lt) && /Luis L\. Le[oó]n/.test(lt) && /Bajo Luis L\. Le[oó]n/.test(lt), `[${nombre}] lluvia: rotulados los 3 pluviómetros`);
  verifica(/frente al ciclo anterior \(n = 1\)/.test(lt) && !/normal|anomal/i.test(lt.replace(/«0» es un día seco medido/, '')), `[${nombre}] lluvia: compara con el ciclo anterior (n = 1) y no habla de "normal"/anomalía`);
  verifica(!/(^|[\s>])(NaN|undefined)([\s<]|$)/.test(lt), `[${nombre}] lluvia: sin NaN/undefined`);

  // ── Notas plegables
  const notas = page.locator('details.cu-notas');
  verifica(await notas.count() === 2 && await notas.evaluateAll((els) => els.every((e) => !e.hasAttribute('open'))), `[${nombre}] las 2 notas (presas y red JCAS) están plegadas por defecto`);
  await notas.locator('summary').click();
  verifica(/Nivel GOES de Luis L\. Le[oó]n/.test(await notas.innerText()) && /San Gabriel, Dgo\./.test(await notas.innerText()), `[${nombre}] al abrir las notas se explican el nivel GOES y San Gabriel, Dgo.`);

  // ── Layout
  const ancho = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  verifica(ancho.sw <= ancho.cw + 1, `[${nombre}] sin scroll horizontal de página (${ancho.sw} ≤ ${ancho.cw})`);
  const chico = await panel.evaluate((el) => [...el.querySelectorAll('*:not(svg *)')].filter((x) => [...x.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(x).fontSize) < 11.95).map((x) => x.className || x.tagName).slice(0, 5));
  verifica(chico.length === 0, `[${nombre}] texto no menor a 12 px (${chico.join(', ') || 'ok'})`);
  if (!esPhone) {
    const tq = await page.locator('.cu-tanque').evaluateAll((els) => els.map((e) => e.querySelector('svg').getBoundingClientRect().width));
    verifica(tq[0] > tq[1] && tq[1] >= tq[tq.length - 1] * 0.9 && Math.min(...tq) >= 40, `[${nombre}] el ancho de los tanques sigue la capacidad (Boquilla > Madero ≥ El Rejón; ${tq.map(Math.round).join(', ')})`);
  }
  verifica(errores.length === 0, `[${nombre}] sin errores de consola${errores.length ? ': ' + errores.slice(0, 2).join(' | ') : ''}`);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}${nombre}-panel.png` });
  await ctx.close();
}
await navegador.close();
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo OK');
process.exit(fallos.length ? 1 : 0);
