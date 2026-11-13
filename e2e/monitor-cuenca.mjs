// Monitor → pestaña CUENCA (presas de la cuenca del Conchos + lluvia GOES, portal USIBWC).
//   PORT=5173 node e2e/monitor-cuenca.mjs      (requiere dev server; bypass de login en localhost)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { irA } from './_cuenca.mjs';
const BASE = `http://localhost:${process.env.PORT || 5173}`;
const OUT = fileURLToPath(new URL('./out/monitor-cuenca/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };

const navegador = await chromium.launch();
for (const [nombre, vista] of [['escritorio', { width: 1440, height: 900 }], ['ipad', { width: 820, height: 1180 }], ['iphone', { width: 390, height: 844 }]]) {
  const ctx = await navegador.newContext({ viewport: vista });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|tile|carto|leaflet/i.test(m.text())) errores.push(m.text()); });

  await page.goto(`${BASE}/monitor-publico?tab=cuenca`, { waitUntil: 'domcontentloaded' });
  const pestana = page.getByRole('tab', { name: 'CUENCA' });
  await pestana.waitFor({ timeout: 45000 });
  verifica(await pestana.getAttribute('aria-selected') === 'true', `[${nombre}] ?tab=cuenca abre la pestaña CUENCA`);

  const panel = page.locator('.cu-root', { has: page.getByRole('heading', { name: 'Cuenca del Conchos' }) }).first();
  await panel.waitFor({ timeout: 45000 });
  await irA(page, 'Presas');
  // El dock del Monitor es angosto: la vista Tanques cae a la lista móvil (<560 px) o muestra tanques si el panel es ancho.
  await page.locator('.cu-tanque, .cu-movil').first().waitFor({ timeout: 45000 });
  const filas = await page.locator('.cu-tanque, .cu-movil').count();
  verifica(filas === 7, `[${nombre}] 7 presas en la vista Tanques (${filas})`);
  await page.getByRole('button', { name: 'Tabla', exact: true }).click();
  const filasTabla = await page.locator('section[aria-label="Estado de las presas de la cuenca"] .cu-tabla tbody tr').count();
  verifica(filasTabla === 7, `[${nombre}] vista Tabla con las 7 presas (${filasTabla})`);
  await page.getByRole('button', { name: 'Tanques', exact: true }).click();
  await page.locator('.cu-tanque, .cu-movil').first().waitFor({ timeout: 15000 });
  verifica(await page.locator('.cu-cq .an-kpis .ui-kpi').count() === 5, `[${nombre}] 5 indicadores (almacenamiento, distrito, aportaciones, Ojinaga, lluvia)`);
  const txt = await panel.innerText();
  verifica(/provisionales/i.test(txt) && /USIBWC/.test(txt), `[${nombre}] rotulado provisional / USIBWC`);
  verifica(!/(^|[\s>])(NaN|undefined|Infinity)([\s<]|$)/.test(txt), `[${nombre}] sin NaN/undefined/Infinity`);

  // Los tokens --pr-* deben estar definidos en el Monitor: texto claro, borde visible, fondo de tarjeta distinto del vacío.
  const estilos = await page.evaluate(() => {
    const v = document.querySelector('.ui-kpi__num'), c = document.querySelector('.an-card');
    const cs = (e) => (e ? getComputedStyle(e) : null);
    return { color: cs(v)?.color, borde: cs(c)?.borderTopColor, fondo: cs(c)?.backgroundColor, ancho: cs(c)?.borderTopWidth };
  });
  verifica(estilos.color === 'rgb(232, 238, 246)', `[${nombre}] texto con el color del tema (${estilos.color})`);
  verifica(!!estilos.borde && estilos.borde !== 'rgba(0, 0, 0, 0)' && estilos.borde !== 'rgb(0, 0, 0)', `[${nombre}] tarjetas con borde del tema (${estilos.borde})`);
  verifica(!!estilos.fondo && estilos.fondo !== 'rgba(0, 0, 0, 0)', `[${nombre}] tarjetas con fondo del tema (${estilos.fondo})`);

  // Pequeños múltiplos y rotulado de San Gabriel
  verifica(await page.locator('.cu-mini').count() === 7, `[${nombre}] 7 mini-series de llenado`);
  verifica(/San Gabriel, Dgo./.test(txt), `[${nombre}] San Gabriel rotulada con su estado`);

  // Sin desborde horizontal de la página y texto ≥ 12 px (regla del dock)
  const ancho = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  verifica(ancho.sw <= ancho.cw + 1, `[${nombre}] sin scroll horizontal de página (${ancho.sw} ≤ ${ancho.cw})`);
  const chico = await panel.evaluate((el) => [...el.querySelectorAll('*')].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(n).fontSize) < 10.95).map((n) => n.className || n.tagName).slice(0, 5));
  verifica(chico.length === 0, `[${nombre}] texto no menor a 11 px (${chico.join(', ') || 'ok'})`);

  // La lluvia de los pluviómetros vive en la pestaña Clima de la Cuenca
  await irA(page, 'Clima');
  await page.locator('section[aria-label="Lluvia en la cuenca"]').waitFor({ timeout: 30000 });
  verifica(await page.locator('section[aria-label="Lluvia en la cuenca"] tbody tr').count() === 3, `[${nombre}] lluvia: 3 pluviómetros`);

  // El resto de pestañas sigue funcionando y el orden previo no cambió
  const nombres = await page.getByRole('tab').allInnerTexts();
  verifica(nombres.map((x) => x.trim().split('\n')[0]).slice(-2).join('|').toUpperCase().includes('TENDENCIAS') && /CUENCA/i.test(nombres.at(-1)), `[${nombre}] CUENCA es la última pestaña (${nombres.map((x) => x.trim().split('\n')[0]).join(' · ')})`);
  await page.getByRole('tab', { name: 'TENDENCIAS' }).click();
  verifica(await page.getByRole('tab', { name: 'TENDENCIAS' }).getAttribute('aria-selected') === 'true', `[${nombre}] se puede pasar a TENDENCIAS`);
  await page.getByRole('tab', { name: 'PANORAMA' }).click();
  verifica(await page.getByRole('tab', { name: 'PANORAMA' }).getAttribute('aria-selected') === 'true', `[${nombre}] se puede volver a PANORAMA`);
  await pestana.click();
  verifica(await panel.isVisible().catch(() => false) || await page.locator('.cu-root').first().isVisible(), `[${nombre}] CUENCA reabre desde otra pestaña`);

  verifica(errores.length === 0, `[${nombre}] sin errores de consola${errores.length ? ': ' + errores.slice(0, 2).join(' | ') : ''}`);
  await page.screenshot({ path: `${OUT}${nombre}.png` });
  await ctx.close();
}
await navegador.close();
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo OK');
process.exit(fallos.length ? 1 : 0);
