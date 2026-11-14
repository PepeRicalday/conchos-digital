// Tratado de Aguas de 1944 (Cuenca → Resumen → «Tratado de Aguas de 1944»): tarjeta desplegable, periodo, conciliación, captura y
// el informe en 3 formatos (carta, PNG, lámina). Contra datos reales de producción (el bypass de login de localhost no trae sesión:
// si la RLS no deja leer, el test lo dice).
//   PORT=5173 node e2e/informe-tratado.mjs      (requiere dev server)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { irA } from './_cuenca.mjs';

const BASE = `http://localhost:${process.env.PORT || 5173}`;
const OUT = fileURLToPath(new URL('./out/informe-tratado/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };
const SIN_BASURA = /\b(NaN|undefined|Infinity|null)\b|aquarius/i;

const navegador = await chromium.launch();
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|401|403/i.test(m.text())) errores.push(m.text()); });

await page.goto(`${BASE}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'domcontentloaded' });
await page.locator('.cu-nav-btn:text-is("Resumen")').first().waitFor({ timeout: 45000 });
const sec = page.locator('#cu-sec-tratado');
await sec.waitFor({ timeout: 30000 });
verifica(await sec.count() === 1, 'la tarjeta «Tratado de Aguas de 1944» está en Cuenca → Resumen');
verifica(!(await sec.evaluate((e) => e.open)), 'la tarjeta llega plegada (resumen de una línea)');
await page.waitForTimeout(2500);
const resumen = (await sec.locator('summary').innerText()).replace(/\s+/g, ' ');
console.log('INFO resumen plegado:', resumen);
verifica(/AF/.test(resumen) || /S\/D|Sin corte|No se pudo/.test(resumen), 'el resumen plegado dice el acumulado o declara S/D (no queda en blanco)');

await sec.locator('summary').click();
await page.locator('#cu-tratado').waitFor({ timeout: 30000 });
await page.waitForTimeout(2000);
const cuerpo = page.locator('#cu-tratado');
let t = await cuerpo.innerText();
verifica(!SIN_BASURA.test(t), 'la tarjeta abierta no muestra NaN/undefined/null');
verifica(/Entregado en el ciclo/.test(t) && /Contra la meta lineal/.test(t) && /Falta para el compromiso/.test(t) && /Deuda del ciclo anterior/.test(t), 'cuatro KPI oficiales');
verifica(await cuerpo.locator('svg[role="img"]').count() >= 2, 'tiene las gráficas (avance y mensual)');
verifica(/Conciliación: EUA contra México/.test(t) && /IBWC/.test(t) && /CONAGUA/.test(t), 'tabla de conciliación EUA contra México (IBWC, SICA, CONAGUA)');
const ok363 = /363,679/.test(t);
console.log(`INFO acumulado oficial visible 363,679 AF: ${ok363} (puede haber avanzado el corte)`);
await page.screenshot({ path: OUT + 'tarjeta.png', fullPage: false });
await cuerpo.screenshot({ path: OUT + 'tarjeta-completa.png' });

// Periodo: año 1, mes, rango
await cuerpo.getByRole('button', { name: 'Año del ciclo' }).click();
await cuerpo.getByRole('button', { name: /^1/ }).first().click();
t = await cuerpo.innerText();
verifica(/Año 1 del ciclo/.test(t), 'periodo «Año del ciclo» → año 1 (25-oct-2025 al 24-oct-2026)');
await cuerpo.getByRole('button', { name: 'Mes' }).click();
verifica(await cuerpo.locator('select.tr-sel').count() === 1, 'periodo «Mes» ofrece selector de mes');
await cuerpo.getByRole('button', { name: 'Ciclo completo' }).click();

// Informe
const boton = cuerpo.getByRole('button', { name: /Informe del Tratado/ });
verifica(await boton.isVisible() && await boton.isEnabled(), 'botón «Informe del Tratado» activo');
await boton.click();
const dlg = page.getByRole('dialog', { name: /Informe del Tratado de Aguas de 1944/ });
await dlg.waitFor({ timeout: 15000 });
await page.screenshot({ path: OUT + 'filtros.png' });
await dlg.getByRole('button', { name: /Vista previa/ }).click();
const previa = page.getByRole('dialog', { name: /Vista previa del informe/ });
await previa.waitFor({ timeout: 20000 });
const marco = page.frameLocator('iframe[title^="Vista previa del informe del Tratado"]');
await marco.locator('.pagina').first().waitFor({ timeout: 30000 });
verifica(await marco.locator('.pagina').count() === 3, 'carta: 3 hojas (avance, afluentes, conciliación)');
const txt = await marco.locator('body').innerText();
verifica(!SIN_BASURA.test(txt), 'carta: sin NaN/undefined/null/aquarius');
verifica(/TRATADO-1944/.test(txt) && /Trazabilidad/.test(txt) && /Firmas/.test(txt) && /Elaboró/.test(txt), 'carta: folio, trazabilidad y firmas');
verifica(/350,000/.test(txt) && /1,750,000/.test(txt), 'carta: dice el compromiso (350,000 AF al año, 1,750,000 por ciclo)');
verifica(/Sutron/.test(txt), 'carta: declara el Sutron de Ojinaga como medición propia');
await page.waitForTimeout(800);
await marco.locator('.pagina').nth(0).screenshot({ path: OUT + 'carta-1.png' });
await marco.locator('.pagina').nth(1).screenshot({ path: OUT + 'carta-2.png' });
await marco.locator('.pagina').nth(2).screenshot({ path: OUT + 'carta-3.png' });

for (const [formato, archivo] of [['Infografía PNG', 'png'], ['Lámina 17×11', 'lamina']]) {
  await previa.getByRole('radio', { name: formato }).click();
  await page.waitForTimeout(1500);
  const m = page.frameLocator('iframe[title^="Vista previa del informe del Tratado"]');
  await m.locator('.hoja').waitFor({ timeout: 20000 });
  const tx = await m.locator('body').innerText();
  verifica(!SIN_BASURA.test(tx) && /Tratado de Aguas de 1944/.test(tx), `${archivo}: sin basura y con título`);
  await page.screenshot({ path: OUT + `${archivo}.png` });
}

verifica(errores.length === 0, `sin errores de consola (${errores.slice(0, 3).join(' | ')})`);
await navegador.close();
if (fallos.length) { console.log(`\n${fallos.length} fallo(s)`); process.exit(1); }
console.log('\nTodo bien');
