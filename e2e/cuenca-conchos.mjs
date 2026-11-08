// Cuenca del Conchos (Presas → Analítica → «Cuenca del Conchos»): datos USIBWC AQUARIUS ya cargados en aqwp_*.
//   PORT=5182 node e2e/cuenca-conchos.mjs      (requiere dev server; bypass de login en localhost)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const BASE = `http://localhost:${process.env.PORT || 5182}`;
const OUT = fileURLToPath(new URL('./out/cuenca-conchos/', import.meta.url));
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

  await page.goto(`${BASE}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'networkidle' }).catch(() => {});
  const panel = page.locator('.an-root', { has: page.getByRole('heading', { name: 'Cuenca del Conchos' }) }).first();
  await panel.waitFor({ timeout: 30000 });
  verifica(await page.getByRole('button', { name: 'Cuenca del Conchos' }).getAttribute('aria-pressed') === 'true', `[${nombre}] enlace profundo abre la vista Cuenca del Conchos`);

  await page.locator('section[aria-label="Estado de las presas de la cuenca"] .cu-tabla tbody tr').first().waitFor({ timeout: 30000 });
  const filas = await page.locator('section[aria-label="Estado de las presas de la cuenca"] .cu-tabla tbody tr').count();
  verifica(filas === 7, `[${nombre}] tabla con las 7 presas (${filas})`);
  const txt = await panel.innerText();

  const boq = page.locator('section[aria-label="Estado de las presas de la cuenca"] .cu-tabla tbody tr', { hasText: 'La Boquilla' });
  verifica(/Distrito/.test(await boq.innerText()), `[${nombre}] Boquilla marcada como presa del distrito`);
  verifica(/819[.,]8/.test(await boq.innerText()), `[${nombre}] Boquilla muestra 819.8 Mm³ del portal`);
  verifica(/Diferencia contra CILA: 0[.,]00 %/.test(await boq.innerText()), `[${nombre}] Boquilla muestra diferencia contra CILA`);

  // Una lectura sin actualizar (Chihuahua) NO se oculta: muestra su último dato, su % del NAMO y la marca con desde cuándo.
  const chi = page.locator('section[aria-label="Estado de las presas de la cuenca"] .cu-tabla tbody tr', { hasText: 'Chihuahua' });
  const chiTxt = await chi.innerText();
  verifica(/8[.,]9/.test(chiTxt) && /38[.,]\d\s*%/.test(chiTxt) && /Sin actualizar/i.test(chiTxt), `[${nombre}] Chihuahua conserva su último dato (8.9 Mm³, 38.x %) con la marca "sin actualizar"`);
  verifica(!/S\/D/.test(chiTxt), `[${nombre}] Chihuahua no aparece sin almacenamiento (sin S/D)`);
  verifica(/Madero/.test(await page.locator('section[aria-label="Estado de las presas de la cuenca"] .cu-tabla tbody tr', { hasText: 'Madero' }).innerText()) && !/SIN ACTUALIZAR/.test(await page.locator('section[aria-label="Estado de las presas de la cuenca"] .cu-tabla tbody tr', { hasText: 'Madero' }).innerText()), `[${nombre}] Madero ya no se marca como sin actualizar`);
  verifica(/desde el 22-sep-2026/i.test(chiTxt) && /47 días/.test(chiTxt), `[${nombre}] Chihuahua indica desde cuándo y cuántos días`);
  verifica(/Lecturas? sin actualizar/i.test(txt), `[${nombre}] aviso de lecturas sin actualizar visible`);

  const kpis = await page.locator('.an-kpi').count();
  verifica(kpis === 4, `[${nombre}] 4 indicadores (${kpis})`);
  verifica(/Ojinaga/.test(txt) && /USIBWC/.test(txt) && /provisionales/i.test(txt), `[${nombre}] rotulado como Ojinaga / USIBWC / provisional`);

  // Lluvia GOES: 3 pluviómetros, 7 días + totales, S/D distinto de 0, gráfica de 30 días
  const lluvia = page.locator('section[aria-label="Lluvia en la cuenca"]');
  await lluvia.waitFor({ timeout: 15000 });
  const filasLluvia = await lluvia.locator('tbody tr').count();
  verifica(filasLluvia === 3, `[${nombre}] lluvia: 3 pluviómetros (${filasLluvia})`);
  verifica(await lluvia.locator('thead th').count() === 10, `[${nombre}] lluvia: pluviómetro + 7 días + 2 totales`);
  const textoLluvia = await lluvia.innerText();
  verifica(/Villalba/.test(textoLluvia) && /Luis L\. Le[oó]n/.test(textoLluvia) && /Bajo Luis L\. Le[oó]n/.test(textoLluvia), `[${nombre}] lluvia: rotulados Villalba / Luis L. León / Bajo Luis L. León`);
  const celdas = await lluvia.locator('tbody td').allInnerTexts();
  verifica(celdas.some(c => /^\d/.test(c.trim())) , `[${nombre}] lluvia: hay cifras en mm`);
  verifica(celdas.every(c => !/^(NaN|undefined|null)/.test(c.trim())), `[${nombre}] lluvia: sin NaN/undefined/null en celdas`);
  verifica(await lluvia.locator('.recharts-bar-rectangle').count() > 0 || /Sin lluvia registrada/.test(textoLluvia), `[${nombre}] lluvia: gráfica de 30 días (o aviso de sin lluvia)`);
  verifica(/Nivel GOES de Luis L\. Le[oó]n/.test(txt), `[${nombre}] se explica por qué no se usa el nivel GOES de Luis L. León`);

  // Gráfica: una línea por presa y chips que ocultan/muestran
  await page.locator('.recharts-line-curve').first().waitFor({ timeout: 15000 }).catch(() => {});
  const lineas = await page.locator('.recharts-line-curve').count();
  verifica(lineas >= 5, `[${nombre}] gráfica con líneas (${lineas})`);
  const chip = page.getByRole('button', { name: /Pico del Águila/ });
  await chip.click();
  verifica(await chip.getAttribute('aria-pressed') === 'false', `[${nombre}] chip oculta la presa`);
  const despues = await page.locator('.recharts-line-curve').count();
  verifica(despues < lineas, `[${nombre}] las líneas de la presa desaparecen de la gráfica (${lineas} → ${despues})`);
  verifica(/Punteado/.test(await panel.innerText()), `[${nombre}] la leyenda explica el trazo punteado`);
  await chip.click();

  // Sin desborde horizontal de la página
  const ancho = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  verifica(ancho.sw <= ancho.cw + 1, `[${nombre}] sin scroll horizontal de página (${ancho.sw} ≤ ${ancho.cw})`);

  // Texto mínimo 11 px (regla del proyecto)
  const chico = await panel.evaluate((el) => [...el.querySelectorAll('*')].filter((n) => n.childNodes.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(n).fontSize) < 11).length);
  verifica(chico === 0, `[${nombre}] texto no menor a 11 px (${chico} elementos)`);
  verifica(errores.length === 0, `[${nombre}] sin errores de consola${errores.length ? ': ' + errores.slice(0, 2).join(' | ') : ''}`);

  await panel.screenshot({ path: `${OUT}${nombre}-panel.png` });
  await ctx.close();
}
await navegador.close();
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo OK');
process.exit(fallos.length ? 1 : 0);
