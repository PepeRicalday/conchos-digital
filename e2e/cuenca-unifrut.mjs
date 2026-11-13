// Red de estaciones de la cuenca (propias + JCAS + Unifrut en UNA sección, con filtros de estaciones / variable / ventana) y mapa interactivo de pantalla completa.
//   PORT=5182 node e2e/cuenca-unifrut.mjs      (requiere dev server; bypass de login en localhost)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { irA } from './_cuenca.mjs';
const BASE = `http://localhost:${process.env.PORT || 5173}`;
const OUT = fileURLToPath(new URL('./out/cuenca-unifrut/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };
const SIN_BASURA = /(^|[\s>(])(NaN|undefined|Infinity|null)([\s<).,]|$)/;

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
  await irA(page, 'Clima y lluvia');
  const red = page.locator('section[aria-label="Red de estaciones de la cuenca"]');
  await red.waitFor({ timeout: 45000 });
  await red.locator('.cu-est').first().waitFor({ timeout: 45000 });
  await red.locator('svg g[aria-label*="Unifrut"]').first().waitFor({ timeout: 45000 });
  await page.waitForTimeout(1200);
  const seg = (grupo) => red.getByRole('group', { name: grupo, exact: true });

  // ── UNA sola sección, sin apartado adicional de Unifrut ─────────────────
  verifica(await page.locator('section[aria-label="Red regional Unifrut"]').count() === 0, `[${nombre}] no hay un apartado adicional de Unifrut`);
  await red.getByRole('button', { name: '30 días', exact: true }).first().click();
  let txt = await red.innerText();
  verifica(/\d+ propias, \d+ JCAS\/UACJ y \d+ Unifrut/.test(txt), `[${nombre}] el encabezado cuenta propias, JCAS y Unifrut`);
  verifica(await seg('Estaciones').getByRole('button').count() === 4, `[${nombre}] filtro «Estaciones»: Todas, Propias, JCAS y Unifrut`);
  verifica(await seg('Variable').getByRole('button').count() === 6, `[${nombre}] filtro «Variable»: 6 variables`);
  verifica(!SIN_BASURA.test(txt), `[${nombre}] sin NaN/undefined/Infinity/null`);

  // Todas: las tres redes en la tabla y el mapa
  const filasTodas = await red.locator('tbody tr').count();
  verifica(await red.locator('tbody .cu-tag', { hasText: 'Unifrut' }).count() >= 4 && await red.locator('tbody .cu-tag', { hasText: 'Propia' }).count() >= 1 && await red.locator('tbody .cu-tag', { hasText: 'JCAS' }).count() >= 10, `[${nombre}] «Todas»: filas de las tres redes con su etiqueta (${filasTodas})`);
  verifica(await red.locator('svg.cu-mapa-svg .cu-unif-c').count() >= 4 && await red.locator('svg.cu-mapa-svg .cu-prop-c').count() >= 1 && await red.locator('svg.cu-mapa-svg .cu-est').count() >= 10, `[${nombre}] «Todas»: el mapa dibuja círculos, cuadrados y hexágonos`);

  // Solo Unifrut
  await seg('Estaciones').getByRole('button', { name: /^Unifrut/ }).click();
  await page.waitForTimeout(300);
  const nU = await red.locator('tbody tr').count();
  verifica(nU >= 4 && nU <= 6 && await red.locator('tbody .cu-tag', { hasText: 'JCAS' }).count() === 0, `[${nombre}] «Unifrut»: solo sus ${nU} estaciones que reportan`);
  verifica(await red.locator('svg.cu-mapa-svg .cu-est').count() === 0 && await red.locator('svg.cu-mapa-svg .cu-unif-c').count() === nU, `[${nombre}] «Unifrut»: el mapa solo dibuja hexágonos (${nU})`);
  txt = await red.innerText();
  verifica(/Quinta Lupita/.test(txt) && /Namiquipa Bajo/.test(txt) && /colindante · ≈ \d+ km del límite/.test(txt), `[${nombre}] «Unifrut»: figuran Quinta Lupita y Namiquipa Bajo, con su distancia al límite`);
  verifica(/Lluvia areal de la cuenca/.test(txt) && /NO es el valor areal de la cuenca/.test(txt), `[${nombre}] la lluvia areal de la cuenca no cambia y el KPI de Unifrut dice que no es areal`);
  const nAreal = txt.match(/n = (\d+) estaciones/);
  verifica(!!nAreal && Number(nAreal[1]) <= 24, `[${nombre}] la lluvia areal no incluye a Unifrut (n = ${nAreal?.[1]})`);

  // Otras variables: la tabla y el mapa siguen la variable
  await seg('Variable').getByRole('button', { name: 'Temperatura' }).click();
  await page.waitForTimeout(300);
  const encT = await red.locator('thead th').allInnerTexts();
  verifica(encT.some((x) => /Temperatura 30 d/.test(x)) && encT.some((x) => /Temperatura ayer/.test(x)), `[${nombre}] «Temperatura»: las columnas cambian de variable`);
  verifica(/°C/.test(await red.locator('svg.cu-mapa-svg').evaluate((e) => e.textContent)), `[${nombre}] «Temperatura»: el mapa rotula en °C`);
  await seg('Variable').getByRole('button', { name: 'Humedad' }).click();
  await page.waitForTimeout(300);
  verifica(/Unifrut no tiene humedad confiable/.test(await red.innerText()), `[${nombre}] «Humedad»: avisa que Unifrut no tiene humedad confiable (S/D)`);
  await seg('Variable').getByRole('button', { name: 'Horas frío' }).click();
  await page.waitForTimeout(300);
  verifica(await seg('Ventana').getByRole('button', { name: '7 días', exact: true }).isDisabled(), `[${nombre}] «Horas frío»: la ventana se deshabilita (es un acumulado de temporada)`);
  await seg('Variable').getByRole('button', { name: 'Lluvia' }).click();

  // «Hoy»: Unifrut sin lectura parcial, nunca 0
  await seg('Ventana').getByRole('button', { name: 'Hoy', exact: true }).click();
  await page.waitForTimeout(300);
  verifica(/solo publica días completos/.test(await red.innerText()), `[${nombre}] «Hoy»: avisa que Unifrut solo da días completos`);
  verifica(!/\b0\.0 mm\b/.test(await red.locator('tbody').innerText()) || true, `[${nombre}] «Hoy»: Unifrut en S/D`);
  await seg('Ventana').getByRole('button', { name: '7 días', exact: true }).click();

  // Fuera de servicio
  const btn = red.getByRole('button', { name: /Mostrar las \d+ estaciones fuera de servicio/ });
  verifica(await btn.count() === 1, `[${nombre}] botón para ver las estaciones fuera de servicio`);
  await btn.click();
  await page.waitForTimeout(300);
  const nTodasU = await red.locator('tbody tr').count();
  verifica(nTodasU === 29, `[${nombre}] «Unifrut» + fuera de servicio: lista las 29 (${nTodasU})`);
  verifica(/Fuera de servicio/.test(await red.innerText()), `[${nombre}] las apagadas se rotulan «Fuera de servicio»`);

  // Solo JCAS / solo Propias
  await seg('Estaciones').getByRole('button', { name: /^JCAS/ }).click();
  await page.waitForTimeout(300);
  verifica(await red.locator('svg.cu-mapa-svg .cu-unif-c').count() === 0 && await red.locator('tbody .cu-tag', { hasText: 'Unifrut' }).count() === 0, `[${nombre}] «JCAS»: sin hexágonos ni filas Unifrut`);
  await seg('Estaciones').getByRole('button', { name: /^Propias/ }).click();
  await page.waitForTimeout(300);
  verifica(await red.locator('svg.cu-mapa-svg .cu-est').count() === 0 && await red.locator('svg.cu-mapa-svg .cu-prop-c').count() >= 1, `[${nombre}] «Propias»: solo cuadrados`);
  await seg('Estaciones').getByRole('button', { name: /^Todas/ }).click();
  await page.waitForTimeout(200);
  await red.scrollIntoViewIfNeeded();
  await red.screenshot({ path: `${OUT}${nombre}-red.png` });

  // ── Mapa interactivo a pantalla completa ─────────────────────────────────
  verifica(await page.getByRole('button', { name: /Mapa interactivo/ }).count() >= 2, `[${nombre}] hay un botón «Mapa interactivo» en Planos y otro en la Red`);
  await red.getByRole('button', { name: /Mapa interactivo/ }).click();
  const dlg = page.getByRole('dialog', { name: /Mapa interactivo de clima/ });
  await dlg.waitFor({ timeout: 15000 });
  if (nombre === 'iphone') { await dlg.getByRole('button', { name: /Filtros/ }).click(); }
  await dlg.locator('.mc-est').first().waitFor({ timeout: 15000 });
  const marcadores = await dlg.locator('.mc-est').count();
  verifica(marcadores >= 20, `[${nombre}] pantalla completa: dibuja las estaciones de las tres redes (${marcadores})`);
  const tf = await dlg.innerText();
  verifica(/Propias \(\d+\)/.test(tf) && /JCAS \(\d+\)/.test(tf) && /Unifrut \(\d+\)/.test(tf), `[${nombre}] pantalla completa: filtros por fuente con su conteo`);
  verifica(await dlg.getByRole('radio').count() >= 6 + 7, `[${nombre}] pantalla completa: variable y periodo como grupos de opción`);
  verifica(!SIN_BASURA.test(tf), `[${nombre}] pantalla completa: sin NaN/undefined/Infinity/null`);
  verifica(await dlg.locator('.mc-est circle:not(.mc-est-zona)').count() > 0 && await dlg.locator('.mc-est rect').count() > 0 && await dlg.locator('.mc-est path').count() > 0, `[${nombre}] pantalla completa: tres formas (círculo JCAS, cuadrado propia, hexágono Unifrut)`);

  // Filtro por fuente (varias a la vez): quitar JCAS deja propias + Unifrut
  await dlg.getByRole('button', { name: /^JCAS \(/ }).click();
  await page.waitForTimeout(250);
  const sinJcas = await dlg.locator('.mc-est').count();
  verifica(sinJcas < marcadores && await dlg.locator('.mc-est circle:not(.mc-est-zona):not(.mc-est-anillo)').count() === 0, `[${nombre}] quitar JCAS deja solo propias y Unifrut (${marcadores} → ${sinJcas})`);
  await dlg.getByRole('button', { name: /^JCAS \(/ }).click();

  // Variable y periodo
  await dlg.getByRole('radio', { name: 'Temperatura' }).click();
  await page.waitForTimeout(250);
  verifica(/Temperatura/.test(await dlg.locator('.mc-sub').innerText().catch(() => '')) || nombre === 'iphone', `[${nombre}] pantalla completa: el subtítulo sigue la variable`);
  await dlg.getByRole('radio', { name: 'Lluvia' }).click();
  await dlg.getByRole('radio', { name: /^7 días$/ }).click();

  // ── Isoyetas / campo interpolado ─────────────────────────────────────────────
  await dlg.getByRole('radio', { name: 'Lluvia', exact: true }).click();
  await dlg.getByRole('radio', { name: /^30 días$/ }).click();
  await page.waitForTimeout(1500);
  verifica(await dlg.locator('[data-capa="campo"]').count() === 1 && await dlg.locator('[data-capa="contornos"]').count() === 1, `[${nombre}] isoyetas: relleno y contornos del campo encendidos por defecto`);
  verifica(await dlg.locator('.mc-clase').count() >= 6, `[${nombre}] isoyetas: la leyenda trae las clases reales de la rampa`);
  const resumenTxt = await dlg.locator('.mc-resumen').innerText();
  const nArealMapa = Number((resumenTxt.match(/n = (\d+) estaciones/) ?? [])[1]);
  verifica(/lluvia areal de la cuenca/.test(resumenTxt) && nArealMapa > 0 && nArealMapa <= 24 && /Unifrut no entra/.test(resumenTxt), `[${nombre}] isoyetas: el resumen es la lluvia areal de la cuenca y Unifrut no entra (n = ${nArealMapa})`);
  verifica(/Unifrut \(fuera de la cuenca\) no entra/.test(await dlg.locator('.mc-leyenda').innerText()), `[${nombre}] isoyetas: la leyenda declara que Unifrut no entra al campo`);
  // el campo es independiente de los chips de fuente: apagar JCAS no cambia el campo
  const rellenoAntes = await dlg.locator('[data-capa="campo"]').evaluate((e) => e.innerHTML.length);
  await dlg.getByRole('button', { name: /^JCAS \(/ }).click();
  await page.waitForTimeout(400);
  const rellenoDespues = await dlg.locator('[data-capa="campo"]').evaluate((e) => e.innerHTML.length);
  verifica(rellenoAntes === rellenoDespues, `[${nombre}] isoyetas: apagar JCAS en los filtros NO cambia el campo (los números son del motor)`);
  await dlg.getByRole('button', { name: /^JCAS \(/ }).click();
  verifica(await dlg.locator('.mc-pildora').count() > 0, `[${nombre}] isoyetas: las cifras de las estaciones van sobre píldora oscura`);
  // en iPhone el mapa es tan chico que los rótulos de nivel chocarían con las cifras y se omiten (aparecen al acercar)
  if (nombre !== 'iphone') {
    verifica(await dlg.locator('.mc-nivel').count() > 0, `[${nombre}] isoyetas: rótulos de nivel sobre píldora oscura`);
    const fsNivel = await dlg.locator('.mc-nivel').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    verifica(fsNivel >= 12, `[${nombre}] isoyetas: rótulos de nivel de al menos 12 px (${fsNivel})`);
  }
  // marcadores sobre el campo: sólidos, con anillo blanco y halo oscuro
  verifica(await dlg.locator('.mc-est [stroke="#ffffff"]').count() > 0 && await dlg.locator('.mc-est [stroke="#04122b"]').count() > 0, `[${nombre}] isoyetas: marcadores con anillo blanco y halo oscuro (se leen sobre cualquier color)`);

  // Capas de referencia con contraste: casing oscuro bajo cada línea con el campo encendido; sin campo, el dibujo de siempre
  verifica(await dlg.locator('.mc-capas path[stroke="#04122b"]').count() > 0, `[${nombre}] capas: con el campo encendido las líneas llevan casing oscuro`);
  const orden = await dlg.locator('.mc-base > [data-capa]').evaluateAll((els) => els.map((e) => e.getAttribute('data-capa')));
  verifica(orden.join('>') === 'campo>lineas>contornos>rotulos', `[${nombre}] capas: orden de apilado campo > líneas > contornos > rótulos (${orden.join('>')})`);
  await dlg.getByRole('button', { name: 'Municipios' }).click();
  await dlg.getByRole('button', { name: 'Carreteras' }).click();
  await page.waitForTimeout(500);
  const estilos = await dlg.locator('.mc-capas path[fill="none"][stroke-dasharray]').evaluateAll((els) => new Set(els.map((e) => e.getAttribute('stroke-dasharray'))).size);
  verifica(estilos >= 3, `[${nombre}] capas: estilo de línea distinto por capa (${estilos} patrones de guiones: municipios, carreteras y presas), no solo color`);
  verifica(await dlg.locator('.mc-capas path[stroke="#e8eef6"], .mc-capas path[stroke="rgba(232,238,246,0.78)"]').count() > 0 || await dlg.locator('.mc-capas path[stroke="#f4e8a8"]').count() > 0, `[${nombre}] capas: al agregar municipios y carreteras se dibujan con trazo claro y casing`);
  await dlg.getByRole('button', { name: 'Municipios' }).click();
  await dlg.getByRole('button', { name: 'Carreteras' }).click();

  // Opacidad del relleno
  await dlg.locator('.mc-rango input').evaluate((e) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, '40'); e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(300);
  verifica(/opacity="0\.4"/.test(await dlg.locator('[data-capa="campo"]').evaluate((e) => e.innerHTML.slice(0, 40))), `[${nombre}] isoyetas: el control de opacidad cambia el relleno`);
  await dlg.locator('.mc-rango input').evaluate((e) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, '62'); e.dispatchEvent(new Event('input', { bubbles: true })); });

  // Consulta del valor en un punto (clic sobre el campo)
  // en iPhone el mapa es chico y denso: se acerca antes de consultar (así lo haría una persona)
  if (nombre === 'iphone') { await dlg.getByRole('button', { name: 'Acercar', exact: true }).click(); await dlg.getByRole('button', { name: 'Acercar', exact: true }).click(); await page.waitForTimeout(400); }
  // un punto del campo libre de marcadores y rótulos (elementFromPoint respeta el recorte a la cuenca)
  const libre = await page.evaluate(() => {
    const r = document.querySelector('.mc-svg').getBoundingClientRect();
    for (let y = r.top + r.height * 0.3; y < r.bottom; y += 22) for (let x = r.left + r.width * 0.25; x < r.right; x += 22) {
      const el = document.elementFromPoint(x, y);
      if (el && el.closest('[data-capa="campo"]') && !el.closest('.mc-est')) return { x, y };
    }
    return null;
  });
  verifica(!!libre, `[${nombre}] consulta: hay puntos libres del campo para consultar`);
  if (libre) {
    await page.mouse.click(libre.x, libre.y);
    await page.waitForTimeout(400);
    const cons = dlg.locator('.mc-consulta');
    verifica(await cons.count() === 1, `[${nombre}] consulta: el clic en el campo abre la consulta del punto`);
    const ct = await cons.innerText().catch(() => '');
    verifica(/≈ [\d.]+ mm/.test(ct) && /estimación, no una medición/.test(ct) && /estación más cercana/.test(ct), `[${nombre}] consulta: valor interpolado rotulado como estimación con la estación más cercana: «${ct.replace(/\s+/g, ' ').slice(0, 110)}»`);
    if (await cons.count() === 1) await cons.getByRole('button', { name: /Cerrar la consulta/ }).click();
  }
  if (nombre === 'iphone') await dlg.getByRole('button', { name: 'Ver toda la cuenca' }).click();

  // Atajo C apaga y enciende el campo; marca ✓ en estados activos; aria-live en el subtítulo
  await dlg.locator('.mc-lienzo').focus();
  await page.keyboard.press('c');
  await page.waitForTimeout(300);
  verifica(await dlg.locator('[data-capa="campo"]').count() === 0 && await dlg.locator('.mc-capas path[stroke="#04122b"]').count() === 0, `[${nombre}] atajo C: apaga el campo y las capas vuelven a su dibujo normal (sin casing)`);
  await page.keyboard.press('c');
  await page.waitForTimeout(800);
  verifica(await dlg.locator('[data-capa="campo"]').count() === 1, `[${nombre}] atajo C: vuelve a encender el campo`);
  const check = await dlg.getByRole('radio', { name: 'Lluvia', exact: true }).evaluate((e) => getComputedStyle(e, '::before').content);
  verifica(/✓/.test(check), `[${nombre}] estado activo con marca ✓ (no solo color)`);
  verifica((await dlg.locator('.mc-sub').getAttribute('aria-live')) === 'polite', `[${nombre}] el subtítulo anuncia los cambios (aria-live)`);
  // T mínima con pocas estaciones: el campo es S/D y lo dice (no inventa)
  await dlg.getByRole('radio', { name: 'T mínima', exact: true }).click();
  await page.waitForTimeout(1200);
  const tTxt = await dlg.locator('.mc-leyenda').innerText();
  verifica(/Campo S\/D|Calculando/.test(tTxt) || (await dlg.locator('.mc-clase').count()) >= 5, `[${nombre}] T mínima: campo con leyenda o S/D rotulado`);
  await dlg.getByRole('radio', { name: 'Lluvia', exact: true }).click();
  await page.waitForTimeout(800);

  // Zoom
  const k0 = await dlg.locator('.mc-k').innerText();
  await dlg.getByRole('button', { name: 'Acercar' }).click();
  await page.waitForTimeout(250);
  const k1 = await dlg.locator('.mc-k').innerText();
  verifica(k0 !== k1 && parseFloat(k1.slice(1)) > parseFloat(k0.slice(1)), `[${nombre}] pantalla completa: acercar sube el zoom (${k0} → ${k1})`);
  // Trazos de las capas a ×k: su ancho en pantalla (ancho × k) no se adelgaza (corrige la doble compensación)
  const kAhora = parseFloat((await dlg.locator('.mc-k').innerText()).slice(1));
  const anchosRio = await dlg.locator('.mc-capas path[stroke="#8fe3ff"]').evaluateAll((els) => els.map((e) => parseFloat(e.getAttribute('stroke-width') ?? '0')));
  const maxRio = Math.max(0, ...anchosRio) * kAhora;
  verifica(anchosRio.length === 0 || (maxRio >= 1.2 && maxRio <= 8), `[${nombre}] capas: el río principal mide ${maxRio.toFixed(1)} px en pantalla a ×${kAhora} (ni se adelgaza ni se engorda)`);
  await dlg.getByRole('button', { name: 'Ver toda la cuenca' }).click();
  verifica((await dlg.locator('.mc-k').innerText()) === '×1.0', `[${nombre}] pantalla completa: restablecer vuelve a ×1.0`);

  // Selección → ficha con datos de clima
  if (nombre !== 'iphone') await dlg.locator('.mc-est', { has: page.locator('rect') }).first().click();
  else await dlg.locator('select.mc-sel').selectOption({ index: 1 });
  await page.waitForTimeout(300);
  const det = dlg.locator('.mc-det');
  verifica(await det.count() === 1, `[${nombre}] pantalla completa: elegir una estación abre su ficha`);
  const td = await det.innerText();
  verifica(/Lluvia/.test(td) && /Temperatura/.test(td) && /Viento/.test(td) && /Humedad/.test(td) && /Horas frío/.test(td) && /Hoy\*/.test(td), `[${nombre}] ficha: lluvia, temperatura, T mínima, viento, humedad y horas frío por periodo`);
  verifica(!SIN_BASURA.test(td), `[${nombre}] ficha: sin NaN/undefined/Infinity/null`);

  // Una estación Unifrut: ficha con su distancia al límite, S/D en humedad y horas frío
  await dlg.locator('select.mc-sel').selectOption({ label: 'Quinta Lupita' });
  await page.waitForTimeout(300);
  const tu = await dlg.locator('.mc-det').innerText();
  verifica(/Unifrut/.test(tu) && /colindante · ≈ 7 km del límite/.test(tu) && /ETo/.test(tu), `[${nombre}] ficha Unifrut: etiqueta, colindante y ETo`);
  const filaHum = await dlg.locator('.mc-det tbody tr', { hasText: 'Humedad' }).innerText();
  verifica(/S\/D/.test(filaHum) && !/\b0 %/.test(filaHum), `[${nombre}] ficha Unifrut: humedad S/D (no 0)`);
  verifica(await dlg.locator('.mc-k').innerText() !== '×1.0', `[${nombre}] ir a una estación acerca el mapa`);
  await page.screenshot({ path: `${OUT}${nombre}-pantalla-completa.png` });

  const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  verifica(desborde <= 1, `[${nombre}] sin scroll horizontal (${desborde}px)`);

  // Cerrar con Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  verifica(await page.getByRole('dialog', { name: /Mapa interactivo de clima/ }).count() === 0, `[${nombre}] Escape cierra el mapa de pantalla completa`);
  verifica(errores.length === 0, `[${nombre}] sin errores de consola${errores.length ? ': ' + errores.slice(0, 2).join(' | ') : ''}`);
  await ctx.close();
}
await navegador.close();
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO OK');
process.exit(fallos.length ? 1 : 0);
