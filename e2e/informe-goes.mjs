// Informe de estaciones GOES — filtros, vista previa, PNG por hoja y PDF (escritorio, teléfono y iPad emulado).
//   PORT=5182 node e2e/informe-goes.mjs      (requiere dev server; usa su propio navegador, no el compartido)
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const PORT = process.env.PORT || 5182;
const BASE = `http://localhost:${PORT}`;
const OUT = fileURLToPath(new URL('./out/informe-goes/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };

async function abrirModal(page) {
  await page.goto(`${BASE}/presas`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.getByRole('button', { name: /^Anal[ií]tica/i }).first().click();
  await page.getByRole('button', { name: /Estaciones GOES/ }).click();
  await page.getByRole('button', { name: /^Informe$/ }).click();
  await page.getByRole('dialog', { name: /Informe de estaciones GOES/ }).waitFor();
}
async function vistaPrevia(page) {
  await page.getByRole('button', { name: /^Vista previa/ }).click();
  const marco = page.locator('iframe[title^="Vista previa"]');
  await marco.waitFor({ timeout: 90000 });
  const fr = await (await marco.elementHandle()).contentFrame();
  await fr.waitForSelector('.pagina', { timeout: 30000 });
  return fr;
}
const iso = (d) => d.toISOString().slice(0, 10);
const paginasPdf = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

// ── 1) Escritorio 1440 ─────────────────────────────────────────────────────────
{
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await abrirModal(page);

  // Filtros
  verifica(await page.getByRole('radio', { name: /Básico/ }).getAttribute('aria-checked') === 'true', 'modalidad Básico por defecto');
  verifica(await page.locator('.ndvi-cfg-check input[type=checkbox]').count() === 4, 'Básico: 4 secciones disponibles');
  await page.getByRole('radio', { name: /Técnico/ }).click();
  verifica(await page.locator('.ndvi-cfg-check input[type=checkbox]').count() === 12, 'Técnico: 12 secciones');
  verifica(await page.locator('.ndvi-cfg-check input:checked').count() === 12, 'Técnico: todas marcadas al cambiar de modalidad');
  await page.locator('.ndvi-cfg-check').filter({ hasText: 'Tabla estadística' }).locator('input').uncheck();
  verifica(/^\d+ hojas?/.test(await page.locator('.ndvi-cfg-cuenta').innerText()) && /9 hojas/.test(await page.locator('.ndvi-cfg-cuenta').innerText()), 'desmarcar una sección baja el conteo de hojas de 10 a 9');
  await page.getByRole('radio', { name: /Básico/ }).click();
  verifica(await page.locator('.ndvi-cfg-check input:checked').count() === 4, 'volver a Básico reinicia las secciones');

  // Estaciones: atajos y multiselección
  const soloRio = page.getByRole('button', { name: 'Solo río' });
  await soloRio.click();
  verifica(await soloRio.getAttribute('aria-pressed') === 'true', 'atajo "Solo río" resaltado');
  const grupo = page.getByRole('group', { name: 'Estaciones a incluir' });
  verifica(await grupo.locator('[aria-pressed=true]').count() === 1, 'Solo río deja 1 estación');
  await grupo.getByRole('button', { name: 'Ojinaga' }).click();
  verifica(await grupo.locator('[aria-pressed=true]').count() === 1, 'no se puede quitar la última estación');
  await page.getByRole('button', { name: 'Solo presas' }).click();
  verifica(await grupo.locator('[aria-pressed=true]').count() === 3, 'Solo presas deja 3 estaciones');
  await page.getByRole('button', { name: 'Todas', exact: true }).click();
  verifica(await grupo.locator('[aria-pressed=true]').count() === 4, 'Todas deja 4 estaciones');

  // Variables: se pueden quitar todas -> error
  const vars = page.getByRole('group', { name: 'Variables a incluir' });
  for (const n of ['Nivel (m)', 'Gasto (m³/s)', 'Velocidad (m/s)', 'Meteorología']) await vars.getByRole('button', { name: n }).click();
  verifica(await page.getByRole('alert').filter({ hasText: 'al menos una variable' }).count() === 1, 'sin variables: error visible');
  verifica(await page.getByRole('button', { name: /^Vista previa/ }).isDisabled(), 'sin variables: Vista previa deshabilitada');
  for (const n of ['Nivel (m)', 'Gasto (m³/s)', 'Velocidad (m/s)', 'Meteorología']) await vars.getByRole('button', { name: n }).click();

  // Rango de fechas: invertido -> error; fuera de 30 d -> error/aviso; válido -> previa
  await page.getByRole('radio', { name: /Rango de fechas/ }).click();
  const fechas = page.locator('input[type=date]');
  verifica(await fechas.count() === 2, 'rango: dos campos de fecha');
  const hoy = new Date(), hace3 = new Date(Date.now() - 3 * 86400000), hace10 = new Date(Date.now() - 10 * 86400000), hace40 = new Date(Date.now() - 40 * 86400000);
  await fechas.nth(0).fill(iso(hoy)); await fechas.nth(1).fill(iso(hace3));
  verifica(await page.getByRole('alert').filter({ hasText: 'posterior' }).count() === 1, 'rango invertido: error');
  await fechas.nth(0).fill(iso(hace40)); await fechas.nth(1).fill(iso(new Date(Date.now() - 35 * 86400000)));
  verifica(await page.getByRole('alert').filter({ hasText: 'fuera de los últimos 30 días' }).count() === 1, 'rango fuera de 30 d: error');
  await fechas.nth(0).fill(iso(new Date(Date.now() - 35 * 86400000))); await fechas.nth(1).fill(iso(hoy));
  verifica(await page.getByText(/solo llegan a 30 días/).count() >= 1, 'rango que excede 30 d: aviso de recorte');
  await fechas.nth(0).fill(iso(hace3)); await fechas.nth(1).fill(iso(hoy));
  await page.screenshot({ path: `${OUT}e2e-filtros-rango.png` });
  verifica(await page.getByRole('button', { name: /^Vista previa/ }).isEnabled(), 'rango válido: Vista previa habilitada');

  // Vista previa
  const fr = await vistaPrevia(page);
  const html = await fr.content();
  const hojas = await fr.locator('.pagina').count();
  verifica(hojas === 4, `Básico: 4 hojas (${hojas})`);
  verifica(await fr.locator('button').count() === 0, 'sin botón duplicado dentro del informe');
  const texto = await fr.locator('body').innerText();
  verifica(!/NaN|undefined|\bnull\b/.test(texto), 'sin NaN/undefined/null en el texto');
  verifica(/Estaciones hidrométricas/.test(texto), 'portada con título');
  verifica(/GOES-BAS-R\d{8}-\d{8}-/.test(html), 'folio con rango personalizado');
  const altos = await fr.locator('.pagina').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  verifica(altos.every((h) => h <= 1056), `cada hoja cabe en una Carta (${altos.join(', ')})`);
  const desb = await fr.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  verifica(desb <= 0, 'vista previa 1440 sin desbordamiento horizontal');
  await page.screenshot({ path: `${OUT}e2e-previa-1440.png` });

  // Imprimir (escritorio): print() del iframe
  await fr.evaluate(() => { window.__p = 0; window.print = () => { window.__p++; }; });
  await page.getByRole('button', { name: /imprimir \/ pdf/i }).click();
  verifica(await fr.evaluate(() => window.__p) === 1, 'escritorio: Imprimir/PDF invoca print() del informe');

  // PDF por impresión simulada (Chromium): una página de PDF por hoja
  {
    const p2 = await (await b.newContext()).newPage();
    await p2.setContent(html);
    const pdf = await p2.pdf({ preferCSSPageSize: true, printBackground: true });
    verifica(paginasPdf(pdf) === hojas, `PDF de impresión: ${paginasPdf(pdf)} páginas = ${hojas} hojas`);
    fs.writeFileSync(`${OUT}e2e-basico.pdf`, pdf);
  }

  // PNG: una descarga por hoja
  const nombres = [];
  const alBajar = (d) => nombres.push(d.suggestedFilename());
  page.on('download', alBajar);
  await page.getByRole('button', { name: /descargar png/i }).click();
  await page.waitForFunction(() => !/Generando imagen/.test(document.body.innerText), null, { timeout: 120000 });
  await page.waitForTimeout(800);
  verifica(nombres.length === hojas, `PNG: ${nombres.length} archivos = ${hojas} hojas (${nombres[0]})`);
  verifica(nombres.every((n) => /^informe-goes-basico-r\d{8}-\d{8}-\d{4}-\d{2}-\d{2}-hoja-\d-de-4\.png$/.test(n)), 'PNG: nombres con modalidad, rango y número de hoja');
  page.off('download', alBajar);

  await page.getByRole('button', { name: /volver a filtros/i }).click();
  verifica(await page.getByRole('button', { name: /^Vista previa/ }).isVisible(), 'Volver a filtros regresa a la configuración');
  await page.keyboard.press('Escape');
  verifica(await page.getByRole('dialog').count() === 0, 'Escape cierra la ventana');
  verifica(errs.length === 0, `escritorio: 0 errores de consola (${errs.length}) ${errs.slice(0, 2).join(' | ')}`);
  await b.close();
}

// ── 2) Técnico, A4 y 24 h: hojas, PDF e informe sin desbordes ──────────────────────
{
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await abrirModal(page);
  await page.getByRole('radio', { name: /Técnico/ }).click();
  await page.getByRole('radio', { name: /^A4$/ }).click();
  await page.getByRole('radio', { name: /Últimos 7 días/ }).click();
  const fr = await vistaPrevia(page);
  const html = await fr.content();
  const hojas = await fr.locator('.pagina').count();
  verifica(hojas === 10, `Técnico: 10 hojas (${hojas})`);
  const altos = await fr.locator('.pagina').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  verifica(altos.every((h) => h <= 1123), `Técnico A4: cada hoja cabe (${altos.join(', ')})`);
  const texto = await fr.locator('body').innerText();
  verifica(!/NaN|undefined|\bnull\b/.test(texto), 'Técnico: sin NaN/undefined/null');
  verifica(/Trazabilidad y firmas/.test(texto) && /Elaboró/.test(texto), 'Técnico: trazabilidad y firmas');
  verifica(/Tabla estadística/.test(texto) && /Cobertura y salud del enlace/.test(texto) && /Meteorología/.test(texto), 'Técnico: secciones técnicas presentes');
  const p2 = await (await b.newContext()).newPage();
  await p2.setContent(html);
  const pdf = await p2.pdf({ preferCSSPageSize: true, printBackground: true });
  verifica(paginasPdf(pdf) === hojas, `Técnico A4: PDF ${paginasPdf(pdf)} páginas = ${hojas} hojas`);
  fs.writeFileSync(`${OUT}e2e-tecnico-a4.pdf`, pdf);
  await b.close();
}

// ── 3) Teléfono 430: filtros y vista previa sin desbordar ──────────────────────────
{
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, hasTouch: true })).newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${BASE}/presas`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.getByRole('button', { name: /^Anal[ií]tica/i }).first().click();
  await page.getByRole('button', { name: /Estaciones GOES/ }).click();
  await page.getByRole('button', { name: /^Informe$/ }).click();
  await page.getByRole('dialog', { name: /Informe de estaciones GOES/ }).waitFor();
  const dlg = page.getByRole('dialog');
  verifica(await dlg.evaluate((d) => d.scrollWidth <= d.clientWidth + 1), '430: filtros sin desbordamiento horizontal');
  await page.screenshot({ path: `${OUT}e2e-filtros-430.png` });
  const fr = await vistaPrevia(page);
  verifica(await fr.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), '430: vista previa sin desbordamiento horizontal');
  await page.screenshot({ path: `${OUT}e2e-previa-430.png` });
  await fr.locator('.pagina').nth(1).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}e2e-previa-430-hoja2.png` });
  verifica(errs.length === 0, `430: 0 errores de página (${errs.length})`);
  await b.close();
}

// ── 4) iPad (WebKit con UA iOS): PDF por Compartir ─────────────────────────────────
{
  const b = await webkit.launch();
  const ctx = await b.newContext({ ...devices['iPad Pro 11'], acceptDownloads: true });
  const page = await ctx.newPage();
  await abrirModal(page);
  await vistaPrevia(page);
  const [d] = await Promise.all([
    page.waitForEvent('download', { timeout: 180000 }),
    page.getByRole('button', { name: /imprimir \/ pdf/i }).click(),
  ]);
  const nombre = d.suggestedFilename(); await d.saveAs(`${OUT}${nombre}`);
  const buf = fs.readFileSync(`${OUT}${nombre}`);
  verifica(/^informe-goes-basico-24h-\d{4}-\d{2}-\d{2}\.pdf$/.test(nombre), `iPad: archivo PDF con nombre institucional (${nombre})`);
  verifica(buf.subarray(0, 5).toString() === '%PDF-' && buf.toString('latin1').trimEnd().endsWith('%%EOF'), 'iPad: PDF bien formado');
  verifica(paginasPdf(buf) === 4, `iPad: una página por hoja (${paginasPdf(buf)})`);
  verifica(buf.length > 150_000 && buf.length < 15_000_000, `iPad: peso razonable ${(buf.length / 1048576).toFixed(2)} MB`);
  await page.waitForTimeout(500);
  verifica(await page.getByRole('button', { name: /imprimir \/ pdf/i }).isEnabled(), 'iPad: el botón vuelve a habilitarse');
  verifica(await page.getByRole('alert').count() === 0, 'iPad: sin mensaje de error');
  await b.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo OK');
process.exit(fallos.length ? 1 : 0);
