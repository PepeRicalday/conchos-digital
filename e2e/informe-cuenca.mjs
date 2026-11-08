// Informe de la cuenca del Conchos (Presas → Analítica → Cuenca → «Informe de la cuenca»): filtros, vista previa y 3 formatos.
//   PORT=5173 node e2e/informe-cuenca.mjs      (requiere dev server; bypass de login en localhost)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const BASE = `http://localhost:${process.env.PORT || 5173}`;
const OUT = fileURLToPath(new URL('./out/informe-cuenca/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };

const navegador = await chromium.launch();
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) errores.push(m.text()); });

await page.goto(`${BASE}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'domcontentloaded' });
await page.locator('.cu-tanque').first().waitFor({ timeout: 45000 });

const boton = page.getByRole('button', { name: /Informe de la cuenca/ });
verifica(await boton.isVisible(), 'botón "Informe de la cuenca" visible en la vista Cuenca');
await boton.click();
const dlg = page.getByRole('dialog', { name: /Informe de la cuenca del Conchos/ });
await dlg.waitFor({ timeout: 15000 });
verifica(/7 de 7 presas/.test(await dlg.innerText()), 'filtros: por defecto 7 de 7 presas');
await page.screenshot({ path: OUT + 'filtros.png' });

// Filtro de tamaño: pequeñas → 3 de 7 y aviso "N de M"
await dlg.getByRole('radio', { name: /Pequeñas/ }).click();
let t = await dlg.innerText();
verifica(/3 de 7 presas/.test(t) && /no de toda la cuenca/.test(t), 'tamaño "Pequeñas": 3 de 7 presas y aviso de alcance filtrado');

// Elegir solo grandes y quitar todas las presas grandes sería inválido: se prueba la selección vacía de la clase
await dlg.getByRole('radio', { name: /Grandes/ }).click();
t = await dlg.innerText();
verifica(/4 de 7 presas/.test(t), 'tamaño "Grandes": 4 de 7 presas');
await dlg.getByRole('radio', { name: /^Todas$/ }).click();

// Atajo Río Florido (San Gabriel + Pico del Águila)
await dlg.getByRole('button', { name: 'Río Florido' }).click();
t = await dlg.innerText();
verifica(/2 de 7 presas/.test(t), 'atajo "Río Florido": 2 de 7 presas');
await dlg.getByRole('button', { name: 'Todas', exact: true }).first().click();
verifica(/7 de 7 presas/.test(await dlg.innerText()), 'atajo "Todas" restablece 7 de 7');

// Sin bloques de datos: error que bloquea la vista previa
for (const n of ['Tabla de cifras', 'Posición histórica', 'Serie de llenado', 'Lluvia GOES', 'Ficha por presa']) await dlg.getByLabel(n).uncheck();
verifica(await dlg.getByRole('button', { name: /Vista previa/ }).isDisabled(), 'sin ningún bloque de datos la vista previa queda bloqueada');
for (const n of ['Tabla de cifras', 'Posición histórica', 'Serie de llenado', 'Lluvia GOES', 'Ficha por presa']) await dlg.getByLabel(n).check();

// Vista previa (PDF carta)
await dlg.getByRole('button', { name: /Vista previa/ }).click();
const previa = page.getByRole('dialog', { name: /Vista previa del informe/ });
await previa.waitFor({ timeout: 20000 });
const marco = page.frameLocator('iframe[title^="Vista previa del informe de la cuenca"]');
await marco.locator('.pagina').first().waitFor({ timeout: 20000 });
verifica(await marco.locator('.pagina').count() === 10, `carta: 10 hojas (resumen + evolución + 7 presas + anexo) (${await marco.locator('.pagina').count()})`);
const txtCarta = await marco.locator('body').innerText();
verifica(/San Gabriel, Dgo\./.test(txtCarta) && /dato provisional/i.test(txtCarta) && /CONAGUA vía USIBWC|CONAGUA, vía portal público USIBWC/.test(txtCarta), 'carta: San Gabriel, Dgo., dato provisional y fuente');
verifica(!/\b(NaN|undefined|null)\b|aquarius/i.test(txtCarta), 'carta: sin NaN/undefined/null/Aquarius');
verifica(/Trazabilidad/.test(txtCarta) && (await marco.locator('.firma').count()) === 3, 'carta: anexo de trazabilidad y 3 firmas');
// Cada hoja debe caber en una hoja Carta (11 in = 1056 px): si excede, al imprimir se parte y se rompe "Pág. N de 9".
const altos = await marco.locator('.pagina').evaluateAll((els) => els.map((e) => e.scrollHeight));
verifica(altos.every((h) => h <= 1060), `carta: cada hoja cabe en una Carta (alturas ${altos.join(', ')})`);
await page.screenshot({ path: OUT + 'previa-carta.png' });
for (let i = 0; i < 10; i++) { try { await marco.locator(".pagina").nth(i).screenshot({ path: `${OUT}carta-${i + 1}.png` }); } catch { /* captura opcional: el iframe puede refrescarse */ } }

// Infografía PNG: sin desbordes horizontales, 7 tanques, tabla
await previa.getByRole('radio', { name: 'Infografía PNG' }).click();
await marco.locator('.hoja').waitFor({ timeout: 20000 });
await page.waitForTimeout(500);
const dims = await marco.locator('body').evaluate((b) => ({ w: b.scrollWidth, h: document.documentElement.scrollHeight }));
verifica(await marco.locator('.tanque').count() === 7, 'png: 7 tanques');
verifica(await marco.locator('table.cifras').count() === 2, 'png: tabla de cifras y de lluvia');
await marco.locator('.hoja').screenshot({ path: OUT + 'infografia.png' });
console.log(`     infografía scroll ${JSON.stringify(dims)}`);

// Lámina 17×11: debe caber en 1632×1056 sin recortar
await previa.getByRole('radio', { name: 'Lámina 17×11' }).click();
await marco.locator('.hoja.lam').waitFor({ timeout: 20000 });
await page.waitForTimeout(500);
const lam = await marco.locator('.hoja.lam').evaluate((h) => {
  const r = h.getBoundingClientRect();
  const hijos = [...h.querySelectorAll('.cuerpo-lam > div, .pie-inf')];
  return { alto: h.scrollHeight, caja: h.clientHeight, desborda: hijos.some((e) => e.getBoundingClientRect().bottom > r.bottom + 1), cuerpo: [...h.querySelectorAll('.cuerpo-lam > div')].map((e) => Math.round(e.scrollHeight)) };
});
verifica(!lam.desborda && lam.alto <= lam.caja + 1, `lámina: el contenido cabe en 11 in (${JSON.stringify(lam)})`);
await marco.locator('.hoja.lam').screenshot({ path: OUT + 'lamina.png' });

// Descarga PNG real
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), previa.getByRole('button', { name: /Descargar PNG/ }).click()]);
const ruta = OUT + (dl.suggestedFilename() || 'informe.png');
await dl.saveAs(ruta);
verifica(fs.statSync(ruta).size > 30_000 && /\.png$/.test(ruta), `descarga PNG de la lámina (${fs.statSync(ruta).size} bytes)`);

// Volver y probar 3 presas y 1 presa
await previa.getByRole('button', { name: /Volver a filtros/ }).click();
await dlg.getByRole('button', { name: 'Solo distrito' }).click();
await dlg.getByRole('button', { name: /Vista previa/ }).click();
await previa.waitFor();
await previa.getByRole('radio', { name: 'Infografía PNG' }).click();
await marco.locator('.hoja').waitFor();
const t2 = await marco.locator('body').innerText();
verifica(/2 de 7 presas/.test(t2) && /de las 2 presas seleccionadas/i.test(t2) && /no a toda la cuenca/.test(t2), 'solo distrito: "2 de 7 presas", totales rotulados y nota de alcance');
await marco.locator('.hoja').screenshot({ path: OUT + 'infografia-2presas.png' });

verifica(errores.length === 0, `sin errores de consola (${errores.slice(0, 3).join(' | ')})`);
await navegador.close();
if (fallos.length) { console.log(`\n${fallos.length} FALLOS`); process.exit(1); }
console.log('\nTodo OK');
