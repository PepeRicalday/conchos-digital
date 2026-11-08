// Monitor → pestaña CUENCA (presas de la cuenca del Conchos + lluvia GOES, portal USIBWC).
//   PORT=5173 node e2e/monitor-cuenca.mjs      (requiere dev server; bypass de login en localhost)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

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
  await page.locator('section[aria-label="Estado de las presas de la cuenca"] .cu-tabla tbody tr').first().waitFor({ timeout: 45000 });
  const filas = await page.locator('section[aria-label="Estado de las presas de la cuenca"] .cu-tabla tbody tr').count();
  verifica(filas === 7, `[${nombre}] 7 presas en la tabla (${filas})`);
  verifica(await page.locator('.an-kpi').count() === 4, `[${nombre}] 4 indicadores`);
  verifica(await page.locator('section[aria-label="Lluvia en la cuenca"] tbody tr').count() === 3, `[${nombre}] lluvia: 3 pluviómetros`);
  const txt = await panel.innerText();
  verifica(/provisionales/i.test(txt) && /USIBWC/.test(txt), `[${nombre}] rotulado provisional / USIBWC`);
  verifica(!/(^|[\s>])(NaN|undefined|Infinity)([\s<]|$)/.test(txt), `[${nombre}] sin NaN/undefined/Infinity`);

  // Los tokens --pr-* deben estar definidos en el Monitor: texto claro, borde visible, fondo de tarjeta distinto del vacío.
  const estilos = await page.evaluate(() => {
    const v = document.querySelector('.an-kpi-val'), c = document.querySelector('.an-card');
    const cs = (e) => (e ? getComputedStyle(e) : null);
    return { color: cs(v)?.color, borde: cs(c)?.borderTopColor, fondo: cs(c)?.backgroundColor, ancho: cs(c)?.borderTopWidth };
  });
  verifica(estilos.color === 'rgb(232, 238, 246)', `[${nombre}] texto con el color del tema (${estilos.color})`);
  verifica(!!estilos.borde && estilos.borde !== 'rgba(0, 0, 0, 0)' && estilos.borde !== 'rgb(0, 0, 0)', `[${nombre}] tarjetas con borde del tema (${estilos.borde})`);
  verifica(!!estilos.fondo && estilos.fondo !== 'rgba(0, 0, 0, 0)', `[${nombre}] tarjetas con fondo del tema (${estilos.fondo})`);

  // Gráficas
  await page.locator('.recharts-line-curve').first().waitFor({ timeout: 20000 }).catch(() => {});
  verifica(await page.locator('.recharts-line-curve').count() >= 5, `[${nombre}] gráfica de llenado con líneas`);

  // Sin desborde horizontal de la página y texto ≥ 12 px (regla del dock)
  const ancho = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  verifica(ancho.sw <= ancho.cw + 1, `[${nombre}] sin scroll horizontal de página (${ancho.sw} ≤ ${ancho.cw})`);
  const chico = await panel.evaluate((el) => [...el.querySelectorAll('*')].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(n).fontSize) < 11.95).map((n) => n.className || n.tagName).slice(0, 5));
  verifica(chico.length === 0, `[${nombre}] texto no menor a 12 px (${chico.join(', ') || 'ok'})`);

  // El resto de pestañas sigue funcionando y el orden previo no cambió
  const nombres = await page.getByRole('tab').allInnerTexts();
  verifica(nombres.map((x) => x.trim().split('\n')[0]).slice(-2).join('|').includes('TENDENCIAS') && /CUENCA/.test(nombres.at(-1)), `[${nombre}] CUENCA es la última pestaña (${nombres.map((x) => x.trim().split('\n')[0]).join(' · ')})`);
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
