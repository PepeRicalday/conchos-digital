// Tarjeta «Cuenca del Conchos · lluvia observada» de Clima (con filtros de estaciones / variable / ventana y mapa interactivo) y contexto regional
// de la tarjeta Presas → Cuenca del Dashboard.   PORT=5182 node e2e/clima-cuenca-tarjeta.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
const BASE = `http://localhost:${process.env.PORT || 5173}`;
const OUT = fileURLToPath(new URL('./out/clima-cuenca-tarjeta/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };
const SIN_BASURA = /(^|[\s>(])(NaN|undefined|Infinity|null)([\s<).,]|$)/;

const nav = await chromium.launch();
for (const [nombre, vp] of [['escritorio', { width: 1440, height: 900 }], ['ipad', { width: 820, height: 1180 }], ['iphone', { width: 390, height: 844 }]]) {
  const ctx = await nav.newContext({ viewport: vp });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) errs.push(m.text()); });

  // ── Clima ───────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/clima`, { waitUntil: 'domcontentloaded' });
  const card = page.locator('section[aria-label="Lluvia en la cuenca del Conchos"]');
  await card.waitFor({ timeout: 45000 });
  await card.locator('.clima-cuenca-kpi').waitFor({ timeout: 45000 });
  await page.waitForTimeout(2500);
  const seg = (n) => card.getByRole('group', { name: n, exact: true });
  const pres = await seg('Ventana de la cuenca').getByRole('button', { pressed: true }).innerText();
  await seg('Ventana de la cuenca').getByRole('button', { name: '7 días', exact: true }).click();
  await page.waitForTimeout(300);
  let t = await card.innerText();
  verifica(/Cuenca del Conchos · lluvia observada/.test(t), `[${nombre}] clima: título de lluvia observada`);
  verifica(await seg('Estaciones').getByRole('button').count() === 4 && await seg('Variable').getByRole('button').count() === 6, `[${nombre}] clima: filtros de estaciones (4) y variable (6)`);
  verifica(/lluvia promedio de la cuenca · n = \d+ estaciones/.test(t), `[${nombre}] clima: la cifra grande es la lluvia areal de la cuenca`);
  const nAreal = Number((t.match(/n = (\d+) estaciones/) ?? [])[1]);
  verifica(nAreal > 0 && nAreal <= 24, `[${nombre}] clima: la lluvia areal no incluye a Unifrut (n = ${nAreal})`);
  verifica(/Hoy|Ayer/.test(pres), `[${nombre}] clima: abre en una ventana con dato (${pres}); sin lectura de hoy cae en Ayer`);
  verifica(!SIN_BASURA.test(t), `[${nombre}] clima: sin NaN/undefined/Infinity/null`);

  // Solo Unifrut + lluvia 7 días
  await seg('Ventana de la cuenca').getByRole('button', { name: '7 días', exact: true }).click();
  await seg('Estaciones').getByRole('button', { name: 'Unifrut' }).click();
  await page.waitForTimeout(300);
  t = await card.innerText();
  verifica(/media simple/.test(t) && /no es el valor areal de la cuenca/.test(t), `[${nombre}] clima: con solo Unifrut la cifra es media simple, rotulada «no es el valor areal»`);
  verifica(await card.locator('.clima-cuenca-top li').count() >= 1 && (await card.locator('.clima-cuenca-top').innerText()).split('\n').every((l) => !/\(JCAS\)/.test(l)) && /· Unifrut/.test(await card.locator('.clima-cuenca-top').innerText()), `[${nombre}] clima: el top lista estaciones Unifrut con su etiqueta`);
  await card.screenshot({ path: `${OUT}${nombre}-clima-unifrut.png` });

  // Temperatura: título y unidades siguen la variable
  await seg('Estaciones').getByRole('button', { name: 'Todas' }).click();
  await seg('Variable').getByRole('button', { name: 'Temperatura' }).click();
  await page.waitForTimeout(300);
  t = await card.innerText();
  verifica(/temperatura observada/.test(t) && /°C/.test(t) && /media simple/.test(t), `[${nombre}] clima: «Temperatura» cambia título, unidad y es media simple`);
  // Humedad: Unifrut no la tiene → no aparece (S/D, nunca 0)
  await seg('Variable').getByRole('button', { name: 'Humedad' }).click();
  await seg('Estaciones').getByRole('button', { name: 'Unifrut' }).click();
  await page.waitForTimeout(300);
  t = await card.innerText();
  verifica(/Ninguna estación de Unifrut tiene humedad/.test(t) && !/\b0 %/.test(t), `[${nombre}] clima: Unifrut no tiene humedad: lo dice y no inventa 0`);
  await seg('Variable').getByRole('button', { name: 'Lluvia' }).click();
  await seg('Estaciones').getByRole('button', { name: 'Todas' }).click();

  // «Hoy» + Unifrut
  await seg('Ventana de la cuenca').getByRole('button', { name: 'Hoy', exact: true }).click();
  await page.waitForTimeout(300);
  verifica(/solo publica días completos/.test(await card.innerText()), `[${nombre}] clima: «Hoy» avisa que Unifrut solo da días completos`);
  await seg('Ventana de la cuenca').getByRole('button', { name: '7 días', exact: true }).click();

  // Mapa interactivo desde la tarjeta
  await card.getByRole('button', { name: /Mapa interactivo/ }).click();
  const dlg = page.getByRole('dialog', { name: /Mapa interactivo de clima/ });
  await dlg.waitFor({ timeout: 20000 });
  await dlg.locator('.mc-est').first().waitFor({ timeout: 20000 });
  const n = await dlg.locator('.mc-est').count();
  verifica(n >= 20, `[${nombre}] clima: el mapa interactivo abre con las tres redes (${n} estaciones)`);
  verifica(await dlg.locator('.mc-est rect').count() > 0 && await dlg.locator('.mc-est path').count() > 0, `[${nombre}] clima: el mapa trae cuadrados (propias) y hexágonos (Unifrut)`);
  verifica((await page.evaluate(() => getComputedStyle(document.querySelector('.mc').parentElement).position)) === 'fixed', `[${nombre}] clima: el mapa va a pantalla completa (estilos cargados fuera de Presas)`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  verifica(await page.getByRole('dialog', { name: /Mapa interactivo de clima/ }).count() === 0, `[${nombre}] clima: Escape cierra el mapa`);
  const desb = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  verifica(desb <= 1, `[${nombre}] clima: sin scroll horizontal (${desb}px)`);

  // ── Dashboard: tarjeta Presas · Cuenca ──────────────────────────────────
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const tile = page.locator('#kp-presas');
  await tile.waitFor({ timeout: 45000 });
  await page.waitForTimeout(2000);
  const vistas = tile.getByRole('radiogroup', { name: 'Presas a mostrar' });
  if (await vistas.isVisible().catch(() => false)) {
    await vistas.getByRole('radio', { name: /cuenca del Conchos/ }).click();
    await page.waitForTimeout(3500);
    const td = await tile.innerText();
    verifica(/JCAS \+ Distrito/.test(td) && /Unifrut ayer/.test(td), `[${nombre}] dashboard: la cifra de la cuenca nombra su composición (JCAS + Distrito) y Unifrut va aparte`);
    verifica(await tile.locator('.kp-red--unifrut').count() >= 1 && /⬢/.test(await tile.locator('.kp-red--unifrut').first().innerText()), `[${nombre}] dashboard: Unifrut lleva su glifo (⬢) además del color`);
    verifica(/cuenca hoy/.test(td), `[${nombre}] dashboard: la lluvia areal de la cuenca sigue ahí, aparte de Unifrut`);
    verifica(!SIN_BASURA.test(td), `[${nombre}] dashboard: sin NaN/undefined/Infinity/null`);
    verifica(/Unifrut ayer\s*(S\/D|\d+\.\d mm)/.test(td), `[${nombre}] dashboard: «Unifrut ayer» es una cifra o S/D (nunca 0 inventado)`);
    verifica(/NO es la lluvia de la cuenca/.test(await tile.locator('.kp-nw.kp-red--unifrut').first().getAttribute('title')), `[${nombre}] dashboard: el detalle de Unifrut aclara que no es la lluvia de la cuenca`);
    await tile.screenshot({ path: `${OUT}${nombre}-dashboard-cuenca.png` });
    await vistas.getByRole('radio', { name: /Presas del distrito/ }).click();
  } else {
    console.log(`SKIP [${nombre}] dashboard: selector de vista oculto en esta celda`);
  }
  verifica(errs.length === 0, `[${nombre}] sin errores de consola${errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''}`);
  await ctx.close();
}
await nav.close();
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO OK');
process.exit(fallos.length ? 1 : 0);
