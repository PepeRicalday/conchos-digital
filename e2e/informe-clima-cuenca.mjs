// Informe de clima y pronóstico de la cuenca (Presas → Analítica → Cuenca → Planos → «Informe de clima»): filtros, vista previa y 3 formatos.
//   PORT=5182 node e2e/informe-clima-cuenca.mjs      (requiere dev server; bypass de login en localhost)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const BASE = `http://localhost:${process.env.PORT || 5173}`;
const OUT = fileURLToPath(new URL('./out/informe-clima-cuenca/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };
const SIN_BASURA = /\b(NaN|undefined|Infinity|null)\b|aquarius/i;

const navegador = await chromium.launch();
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) errores.push(m.text()); });

await page.goto(`${BASE}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'domcontentloaded' });
const sec = page.locator('section[aria-label="Planos de la cuenca"]');
await sec.locator('img.cu-plano-img').waitFor({ timeout: 45000 });
await page.waitForTimeout(1500);

const boton = sec.getByRole('button', { name: /Informe de clima/ });
verifica(await boton.isVisible() && await boton.isEnabled(), 'botón "Informe de clima" visible y activo junto a los planos');
await boton.click();
const dlg = page.getByRole('dialog', { name: /Informe de clima y pronóstico de la cuenca/ });
await dlg.waitFor({ timeout: 15000 });
let t = await dlg.innerText();
verifica(/8 planos/.test(t) && /4 variables · obs 30 d \+ pron 7 d/.test(t), 'filtros: por defecto 8 planos (4 variables, observado 30 d y pronóstico 7 d)');
verifica(/en construcción/i.test(t), 'filtros: avisa que la confiabilidad del pronóstico está en construcción');
await page.screenshot({ path: OUT + 'filtros.png' });

// Quitar todas las variables bloquea; solo lluvia + observado → 1 plano
for (const n of [/Lluvia \(isoyetas\)/, /Temperatura/, /Viento/, /Humedad/]) await dlg.getByLabel(n).uncheck();
verifica(await dlg.getByRole('button', { name: /Vista previa/ }).isDisabled(), 'sin variables la vista previa queda bloqueada');
await dlg.getByLabel(/Lluvia \(isoyetas\)/).check();
await dlg.getByLabel(/Pronóstico \(3 modelos\)/).uncheck();
t = await dlg.innerText();
verifica(/1 plano/.test(t), 'una variable y solo observado: 1 plano');
verifica(await dlg.getByRole('button', { name: /Vista previa/ }).isEnabled(), 'con una variable la vista previa se habilita');
await dlg.getByLabel(/Pronóstico \(3 modelos\)/).check();
for (const n of [/Temperatura/, /Viento/, /Humedad/]) await dlg.getByLabel(n).check();
await dlg.getByRole('radio', { name: 'Últimos 7 días' }).click();
verifica(/obs 7 d \+ pron 7 d/.test(await dlg.innerText()), 'el periodo observado cambia a 7 días');
await dlg.getByRole('radio', { name: 'Últimos 30 días' }).click();

// Vista previa: PDF carta
await dlg.getByRole('button', { name: /Vista previa/ }).click();
const previa = page.getByRole('dialog', { name: /Vista previa del informe/ });
await previa.waitFor({ timeout: 20000 });
const marco = page.frameLocator('iframe[title^="Vista previa del informe de clima"]');
await marco.locator('.pagina').first().waitFor({ timeout: 30000 });
const nPag = await marco.locator('.pagina').count();
verifica(nPag === 8, `carta: 8 hojas (4 de planos, distrito, estaciones observadas, pronóstico por estación y anexo) (${nPag})`);
verifica(/Distrito de Riego 005/.test(await marco.locator('body').innerText()), 'carta: trae el apartado del distrito (módulos SRL con estaciones propias)');
verifica(await marco.locator('figure.plano svg:has-text("límite municipal")').count() >= 8, 'carta: los planos llevan capas de referencia con su leyenda');
verifica(/Escala basada en/.test(await marco.locator('body').innerText()), 'carta: cada plano declara la base de su escala de color');
verifica(await marco.locator('figure.plano:not(.distrito)').count() === 8 && await marco.locator('figure.plano.distrito').count() === 1, 'carta: los 8 planos y el plano del distrito');
const txtCarta = await marco.locator('body').innerText();
verifica(/dato provisional/i.test(txtCarta) && /JCAS/.test(txtCarta) && /Open-Meteo/.test(txtCarta) && /n = \d+ estaciones/.test(txtCarta), 'carta: provisional, fuentes JCAS y Open-Meteo, n de estaciones');
verifica(!SIN_BASURA.test(txtCarta), 'carta: sin NaN/undefined/null/Aquarius');
verifica(/Trazabilidad/.test(txtCarta) && (await marco.locator('.firma').count()) === 3, 'carta: anexo de trazabilidad y 3 firmas');
verifica(/En construcción/.test(txtCarta) && !/acierta \d+ %/.test(txtCarta), 'carta: la confiabilidad se declara en construcción, sin afirmar acierto');
verifica(/Estaciones observadas/.test(txtCarta) && /Pronóstico por estación/.test(txtCarta), 'carta: tablas de estaciones observadas y pronóstico');
const altos = await marco.locator('.pagina').evaluateAll((els) => els.map((e) => e.scrollHeight));
verifica(altos.every((h) => h <= 1060), `carta: cada hoja cabe en una Carta (alturas ${altos.join(', ')})`);
// los planos no se salen de su hoja ni de su columna
const sale = await marco.locator('.pagina').evaluateAll((els) => els.some((p) => { const r = p.getBoundingClientRect(); return [...p.querySelectorAll('figure.plano svg')].some((s) => { const b = s.getBoundingClientRect(); return b.right > r.right + 1 || b.bottom > r.bottom + 1; }); }));
verifica(!sale, 'carta: ningún plano se sale de su hoja');
await page.screenshot({ path: OUT + 'previa-carta.png' });
for (let i = 0; i < nPag; i++) { try { await marco.locator('.pagina').nth(i).screenshot({ path: `${OUT}carta-${i + 1}.png` }); } catch { /* captura opcional */ } }

// Infografía PNG
await previa.getByRole('radio', { name: 'Infografía PNG' }).click();
await marco.locator('.hoja').waitFor({ timeout: 20000 });
await page.waitForTimeout(600);
const dims = await marco.locator('body').evaluate((b) => ({ w: b.scrollWidth, h: document.documentElement.scrollHeight }));
verifica(await marco.locator('figure.plano').count() === 6, 'png: 6 planos (máximo del formato)');
const txtPng = await marco.locator('body').innerText();
verifica(/muestra 6 de 8 planos/.test(txtPng) && !SIN_BASURA.test(txtPng), 'png: avisa que el PDF trae todos los planos y no tiene NaN/undefined/null');
verifica(dims.w <= 1601, `png: sin desborde horizontal (${dims.w} px de ancho, ${dims.h} px de alto)`);
await marco.locator('.hoja').screenshot({ path: OUT + 'infografia.png' });

// Lámina 17×11: debe caber en 1632×1056 sin recortar
await previa.getByRole('radio', { name: 'Lámina 17×11' }).click();
await marco.locator('.hoja.lam').waitFor({ timeout: 20000 });
await page.waitForTimeout(600);
const lam = await marco.locator('.hoja.lam').evaluate((h) => {
  const r = h.getBoundingClientRect();
  const hijos = [...h.querySelectorAll('.kpis, .planos, figure.plano, .pie-inf')];
  const pie = h.querySelector('.pie-inf').getBoundingClientRect();
  // además de caber en la hoja, ningún plano (con su leyenda) puede invadir el pie ni los indicadores
  const kp = h.querySelector('.kpis').getBoundingClientRect();
  const solapa = [...h.querySelectorAll('figure.plano')].some((f) => { const b = f.getBoundingClientRect(); return b.bottom > pie.top + 1 || b.top < kp.bottom - 1; });
  return { alto: h.scrollHeight, caja: h.clientHeight, desborda: hijos.some((e) => e.getBoundingClientRect().bottom > r.bottom + 1) || solapa, planos: h.querySelectorAll('figure.plano').length, holguraPie: Math.round(pie.top - Math.max(...[...h.querySelectorAll('figure.plano')].map((f) => f.getBoundingClientRect().bottom))) };
});
verifica(lam.planos === 3 && !lam.desborda && lam.alto <= lam.caja + 1, `lámina: 3 planos y el contenido cabe en 11 in (${JSON.stringify(lam)})`);
await marco.locator('.hoja.lam').screenshot({ path: OUT + 'lamina.png' });

// Descarga PNG real de la lámina
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), previa.getByRole('button', { name: /Descargar PNG/ }).click()]);
const ruta = OUT + (dl.suggestedFilename() || 'informe.png');
await dl.saveAs(ruta);
verifica(fs.statSync(ruta).size > 30_000 && /\.png$/.test(ruta), `descarga PNG de la lámina (${fs.statSync(ruta).size} bytes)`);

// Modo «Solo infografía»: sin «Cómo se lee», trazabilidad, firmas ni tablas; con el mínimo institucional
await page.getByRole('button', { name: /Volver a filtros/ }).click();
await dlg.waitFor({ timeout: 15000 });
await dlg.getByRole('radio', { name: 'Solo infografía' }).click();
verifica(/infografía/.test(await dlg.innerText()), 'filtros: el modo «Solo infografía» se refleja en el alcance');
await dlg.getByRole('button', { name: /Vista previa/ }).click();
await previa.waitFor({ timeout: 20000 });
await previa.getByRole('radio', { name: 'PDF carta' }).click();
await marco.locator('.pagina').first().waitFor({ timeout: 30000 });
const txtInfo = await marco.locator('body').innerText();
verifica(!/Cómo se lee|Trazabilidad|Elaboró|Huella de la configuración/.test(txtInfo) && (await marco.locator('.firma').count()) === 0, 'infografía carta: sin «Cómo se lee», trazabilidad ni firmas');
verifica(/dato provisional/i.test(txtInfo) && /JCAS/.test(txtInfo) && /INEGI-CONAGUA/.test(txtInfo) && /Folio/.test(txtInfo) && /n = \d+ estaciones/.test(txtInfo), 'infografía carta: conserva provisional, fuente, atribución del contorno, folio y n de estaciones');
verifica(!SIN_BASURA.test(txtInfo), 'infografía carta: sin NaN/undefined/null/Aquarius');
const altosInfo = await marco.locator('.pagina').evaluateAll((els) => els.map((e) => e.scrollHeight));
verifica(altosInfo.every((h) => h <= 1060), `infografía carta: cada hoja cabe en una Carta (${altosInfo.join(', ')})`);
verifica(await marco.locator('.rk li').count() > 0, 'infografía carta: barras de lluvia por estación');
for (let i = 0; i < altosInfo.length; i++) { try { await marco.locator('.pagina').nth(i).screenshot({ path: `${OUT}info-carta-${i + 1}.png` }); } catch { /* opcional */ } }
await previa.getByRole('radio', { name: 'Infografía PNG' }).click();
await marco.locator('.hoja').waitFor({ timeout: 20000 });
await page.waitForTimeout(600);
const dimsInfo = await marco.locator('body').evaluate((b) => ({ w: b.scrollWidth, h: document.documentElement.scrollHeight }));
verifica(dimsInfo.w <= 1601 && !/Cómo se lee|Trazabilidad/.test(await marco.locator('body').innerText()), `infografía png: sin desborde (${dimsInfo.w}×${dimsInfo.h}) y sin notas ni trazabilidad`);
await marco.locator('.hoja').screenshot({ path: OUT + 'info-png.png' });
verifica(await marco.locator('figure.plano[data-protagonista]').count() === 1, 'infografía png: un mapa protagonista');
await previa.getByRole('radio', { name: 'Lámina 17×11' }).click();
await marco.locator('.hoja.lam').waitFor({ timeout: 20000 });
await page.waitForTimeout(600);
const lamInfo = await marco.locator('.hoja.lam').evaluate((h) => {
  const r = h.getBoundingClientRect(); const pie = h.querySelector('.pie-inf').getBoundingClientRect();
  const partes = [...h.querySelectorAll('.lam-hero, .lam-izq figure, .lam-der, .lam-fila figure, .lam-fila .ranking, .inst')];
  const fuera = partes.filter((e) => { const b = e.getBoundingClientRect(); return b.bottom > pie.top + 1 || b.right > r.right + 1; }).map((e) => e.className || e.tagName);
  return { alto: h.scrollHeight, caja: h.clientHeight, fuera, planos: h.querySelectorAll('figure.plano').length, hero: !!h.querySelector('.lam-hero'), rk: h.querySelectorAll('.rk li').length };
});
verifica(lamInfo.hero && lamInfo.planos === 3 && lamInfo.rk > 0 && lamInfo.fuera.length === 0 && lamInfo.alto <= lamInfo.caja + 1, `infografía lámina: mapa protagonista, 2 miniaturas y barras sin invadir el pie (${JSON.stringify(lamInfo)})`);
await marco.locator('.hoja.lam').screenshot({ path: OUT + 'info-lamina.png' });

verifica(errores.length === 0, `sin errores de consola (${errores.slice(0, 3).join(' | ')})`);
await navegador.close();
if (fallos.length) { console.log(`\n${fallos.length} FALLOS`); process.exit(1); }
console.log('\nTodo OK');
