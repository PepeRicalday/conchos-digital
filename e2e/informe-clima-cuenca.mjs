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
verifica(nPag === 7, `carta: 7 hojas (4 de planos, estaciones observadas, pronóstico por estación y anexo) (${nPag})`);
verifica(await marco.locator('figure.plano').count() === 8, 'carta: los 8 planos');
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

verifica(errores.length === 0, `sin errores de consola (${errores.slice(0, 3).join(' | ')})`);
await navegador.close();
if (fallos.length) { console.log(`\n${fallos.length} FALLOS`); process.exit(1); }
console.log('\nTodo OK');
