// Planos de la cuenca (Presas → Analítica → Cuenca): isoyetas y planos de temperatura, viento y humedad, observados y pronosticados.
//   PORT=5182 node e2e/cuenca-planos.mjs      (requiere dev server; bypass de login en localhost)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const BASE = `http://localhost:${process.env.PORT || 5173}`;
const OUT = fileURLToPath(new URL('./out/cuenca-planos/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };

const navegador = await chromium.launch();
for (const [nombre, vista] of [['escritorio', { width: 1440, height: 900 }], ['ipad', { width: 820, height: 1180 }], ['iphone', { width: 390, height: 844 }]]) {
  const ctx = await navegador.newContext({ viewport: vista });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) errores.push(m.text()); });

  await page.goto(`${BASE}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'domcontentloaded' });
  const sec = page.locator('section[aria-label="Planos de la cuenca"]');
  await sec.waitFor({ timeout: 45000 });
  const img = sec.locator('img.cu-plano-img');
  await img.waitFor({ timeout: 45000 });
  await page.waitForTimeout(1500);
  const cargada = async () => img.evaluate((i) => i.complete && i.naturalWidth > 0);
  verifica(await cargada(), `[${nombre}] el plano de isoyetas se dibuja (imagen cargada)`);
  const alt = await img.getAttribute('alt');
  verifica(/Isoyetas/.test(alt) && /estaciones/.test(alt) && !/NaN|undefined/.test(alt), `[${nombre}] descripción accesible del plano: "${alt}"`);
  const txt = await sec.innerText();
  verifica(/Lluvia promedio de la cuenca/.test(txt) && /n = \d+ estaciones/.test(txt) && /cobertura \d+ %/.test(txt), `[${nombre}] resumen con promedio, n de estaciones y cobertura`);
  verifica(/Altitud:/.test(txt), `[${nombre}] declara si se ajustó por altitud`);
  verifica(/provisional/i.test(txt) && /JCAS/.test(txt), `[${nombre}] rotulado como provisional y fuente JCAS`);
  verifica(!/Aquarius/i.test(txt) && !/(^|[\s>(])(NaN|undefined|Infinity|null)([\s<).,]|$)/.test(txt), `[${nombre}] sin Aquarius ni NaN/undefined/null`);
  verifica(await page.locator('.an-kpi').count() === 4, `[${nombre}] los 4 indicadores de presas siguen intactos`);

  // Variables observadas
  for (const [boton, titulo] of [['Temperatura', 'Temperatura media'], ['Viento', 'Viento medio'], ['Humedad', 'Humedad relativa'], ['Lluvia', 'Isoyetas']]) {
    await sec.getByRole('button', { name: boton, exact: true }).click();
    await page.waitForTimeout(500);
    const a = await img.getAttribute('alt');
    verifica(a.includes(titulo) && await cargada(), `[${nombre}] variable ${boton}: plano "${titulo}" cargado`);
  }
  // Periodo 7 días
  await sec.getByRole('button', { name: '7 días', exact: true }).click();
  await page.waitForTimeout(400);
  verifica(/últimos 7 días/.test(await img.getAttribute('alt')), `[${nombre}] el periodo cambia a 7 días`);

  // Pronóstico
  await sec.getByRole('button', { name: 'Pronóstico', exact: true }).click();
  await page.waitForTimeout(2500);
  const pt = await sec.innerText();
  verifica(/próximos 7 días/.test(await img.getAttribute('alt')) && await cargada(), `[${nombre}] pronóstico de 7 días: plano cargado`);
  verifica(/Confiabilidad del pronóstico/.test(pt) && /En construcción|Medida con/.test(pt), `[${nombre}] muestra la confiabilidad (en construcción mientras no haya días comparados)`);
  verifica(/Entre modelos/.test(pt) && /Días con lluvia/.test(pt) && /Corrida/.test(pt), `[${nombre}] muestra el rango entre modelos y la antigüedad de la corrida`);
  const filas = await sec.locator('tbody tr').count();
  verifica(filas === 24, `[${nombre}] tabla de pronóstico con los 24 puntos (${filas})`);
  verifica(!/(^|[\s>(])(NaN|undefined|Infinity|null)([\s<).,]|$)/.test(pt), `[${nombre}] pronóstico sin NaN/undefined/null`);
  await sec.getByRole('button', { name: '3 días', exact: true }).click();
  await page.waitForTimeout(400);
  verifica(/próximos 3 días/.test(await img.getAttribute('alt')), `[${nombre}] pronóstico a 3 días`);

  const ancho = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  verifica(ancho.sw <= ancho.cw + 1, `[${nombre}] sin scroll horizontal de página (${ancho.sw}/${ancho.cw})`);
  await sec.getByRole('button', { name: 'Lluvia', exact: true }).click();
  await sec.getByRole('button', { name: 'Observado', exact: true }).click();
  await page.waitForTimeout(800);
  await sec.scrollIntoViewIfNeeded();
  await sec.screenshot({ path: `${OUT}${nombre}.png` });
  verifica(errores.length === 0, `[${nombre}] sin errores de consola${errores.length ? `: ${errores.slice(0, 2).join(' | ')}` : ''}`);
  await ctx.close();
}
// ── Flechas de viento del pronóstico (solo pronóstico; JCAS no da dirección)
{
  const pg = await (await navegador.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await pg.goto(`${BASE}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'domcontentloaded' });
  const sc = pg.locator('section[aria-label="Planos de la cuenca"]');
  await sc.locator('img.cu-plano-img').waitFor({ timeout: 45000 });
  await sc.getByRole('button', { name: 'Viento' }).click();
  await sc.getByRole('button', { name: 'Pronóstico' }).click();
  await pg.waitForTimeout(2000);
  const arrows = decodeURIComponent(await sc.locator('img.cu-plano-img').getAttribute('src')).match(/hacia donde sopla/g)?.length ?? 0;
  verifica(arrows >= 5, `viento pronosticado: flechas de dirección por estación (${arrows}; 0 si la corrida aún no trae dirección)`);
  await sc.getByRole('button', { name: 'Observado' }).click();
  await pg.waitForTimeout(1500);
  const obs = decodeURIComponent(await sc.locator('img.cu-plano-img').getAttribute('src')).match(/hacia donde sopla/g)?.length ?? 0;
  verifica(obs === 0, 'viento observado: sin flechas (JCAS no entrega dirección)');
}

// ── Capas de referencia (filtro activable): ríos y presas por defecto; municipios/poblaciones/carreteras a demanda
for (const [nombre, vista, esPhone] of [['escritorio', { width: 1440, height: 900 }, false], ['iphone', { width: 390, height: 844 }, true]]) {
  const pgc = await (await navegador.newContext({ viewport: vista })).newPage();
  const errc = [];
  pgc.on('pageerror', (e) => errc.push(e.message));
  await pgc.goto(`${BASE}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'domcontentloaded' });
  const sc = pgc.locator('section[aria-label="Planos de la cuenca"]');
  await sc.locator('img.cu-plano-img').waitFor({ timeout: 45000 });
  const svgTxt = async () => decodeURIComponent(await sc.locator('img.cu-plano-img').getAttribute('src'));
  if (esPhone) {
    verifica(await sc.locator('details.cu-capas--plegable summary').count() === 1, `[${nombre}] el filtro de capas va plegado en iPhone`);
    await sc.locator('details.cu-capas--plegable summary').click();
  }
  const chip = (t) => sc.getByRole('button', { name: new RegExp(t) }).first();
  await pgc.waitForTimeout(1200);
  let t0 = await svgTxt();
  verifica(/>río</.test(t0) && /presa/.test(t0), `[${nombre}] por defecto el plano trae ríos y presas`);
  verifica(!/límite municipal/.test(t0), `[${nombre}] los municipios no vienen activos por defecto`);
  verifica(await chip('Municipios').getAttribute('aria-pressed') === 'false', `[${nombre}] el chip Municipios está apagado (aria-pressed)`);
  await chip('Municipios').click();
  await pgc.waitForTimeout(1500);
  verifica(/límite municipal/.test(await svgTxt()) && await chip('Municipios').getAttribute('aria-pressed') === 'true', `[${nombre}] activar Municipios los dibuja y marca el chip`);
  const alto = await chip('Municipios').boundingBox();
  verifica(!esPhone || (alto && alto.height >= 43.5), `[${nombre}] objetivo táctil ≥ 44 px${alto ? ` (${Math.round(alto.height)} px)` : ''}`);
  await sc.getByRole('button', { name: 'Ninguna' }).click();
  await pgc.waitForTimeout(1200);
  t0 = await svgTxt();
  verifica(!/límite municipal|>río</.test(t0), `[${nombre}] «Ninguna» deja el plano solo con la variable`);
  await sc.getByRole('button', { name: 'Todas' }).click();
  await pgc.waitForTimeout(1800);
  t0 = await svgTxt();
  verifica(/límite municipal/.test(t0) && /carretera/.test(t0) && /subcuencas/.test(t0) && /módulos SRL/.test(t0), `[${nombre}] «Todas» activa las 7 capas`);
  verifica(/Escala basada en/.test(t0), `[${nombre}] la leyenda declara la base de la escala de color`);
  await pgc.reload({ waitUntil: 'domcontentloaded' });
  await sc.locator('img.cu-plano-img').waitFor({ timeout: 45000 });
  await pgc.waitForTimeout(1500);
  verifica(/límite municipal/.test(await svgTxt()), `[${nombre}] la elección de capas se recuerda al recargar`);
  verifica(errc.length === 0, `[${nombre}] capas sin errores de consola (${errc.slice(0, 2).join(' | ')})`);
  await sc.screenshot({ path: `${OUT}capas-${nombre}.png` }).catch(() => {});
}
await navegador.close();
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo OK');
process.exit(fallos.length ? 1 : 0);

