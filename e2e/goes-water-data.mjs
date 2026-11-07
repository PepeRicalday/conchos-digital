// Water Data USA (USIBWC 08373000) en Estaciones GOES: tarjeta con líneas unidas entre lecturas de 2 h y gráfica.
//   PORT=5182 node e2e/goes-water-data.mjs      (requiere dev server; bypass de login en localhost)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const BASE = `http://localhost:${process.env.PORT || 5182}`;
const OUT = fileURLToPath(new URL('./out/goes-water-data/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };

const navegador = await chromium.launch();
for (const [nombre, vista] of [['escritorio', { width: 1440, height: 900 }], ['iphone', { width: 390, height: 844 }]]) {
  const page = await (await navegador.newContext({ viewport: vista })).newPage();
  await page.goto(`${BASE}/presas`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.getByRole('button', { name: /^Anal[ií]tica/i }).first().click();
  await page.getByRole('button', { name: /Estaciones GOES/ }).click();
  const tarjeta = page.locator('.goes-fichas > *', { hasText: 'Water Data USA' }).first();
  await tarjeta.waitFor({ timeout: 30000 });
  verifica(await tarjeta.isVisible(), `[${nombre}] aparece la tarjeta Water Data USA`);
  verifica(/USIBWC 08373000/.test(await tarjeta.innerText()), `[${nombre}] rotulada como USIBWC 08373000`);
  verifica(!/Sin transmisi/i.test(await tarjeta.innerText()), `[${nombre}] enlace no marcado sin transmisión`);
  // Cada minigráfica debe trazar una línea (path con L/segmentos), no solo puntos.
  const trazos = await tarjeta.locator('svg path[d*="L"], svg polyline').count();
  verifica(trazos >= 2, `[${nombre}] minigráficas de nivel y gasto con línea (${trazos} trazos)`);
  await tarjeta.screenshot({ path: `${OUT}${nombre}-tarjeta.png` });
  await page.locator('.goes-card--grafica').first().screenshot({ path: `${OUT}${nombre}-grafica.png` }).catch(() => {});
  await page.close();
}
await navegador.close();
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo OK');
process.exit(fallos.length ? 1 : 0);
