// SICA Conservación · verificación del VOCABULARIO ÚNICO en la interfaz (solo lectura).
//   Uso: node e2e/conservacion-vocabulario.mjs   (requiere `npm run dev` en :5173; PacOT SRL y M5 se auto-cargan)
// Recorre las pestañas de derivación (SRL y M5) y «Comprobación de reglas», en 1440x900 y 440x956, y comprueba:
// (a) no queda ninguna etiqueta de los vocabularios viejos; (b) conceptos canónicos con el rótulo del libro en title;
// (c) avisos de honestidad en Cadena, Tramos y Concentrado; (d) 0 errores consola/red, texto >= 12 px, objetivos >= 44 px, sin desborde.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const OUT = new URL('./out/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const raiz = fileURLToPath(new URL('../', import.meta.url));
const informeDir = path.join(raiz, 'informes-conservacion');
const informe = fs.existsSync(informeDir) ? fs.readdirSync(informeDir).filter((x) => /^informe-.*\.json$/.test(x)).sort().pop() : null;

const VPS = {
  desktop: { viewport: { width: 1440, height: 900 }, opts: {} },
  iphone: { viewport: { width: 440, height: 956 }, opts: { hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' } },
};
const IGNORE = /AUTH_BYPASS|WebSocket|realtime|\[vite\]|DevTools|favicon|supabase/i;
// Etiquetas de los vocabularios anteriores que ya no deben verse como estado.
const VIEJAS = [/\bCuadra\b/, /\bCoincide\b/, /\bDifiere\b/, /Coincide por ahora/, /Dato faltante/, /Sin dato SRL/, /Sin módulos/, /Parcial \(faltan módulos\)/, /Sin hallazgos\b/, /Con hallazgos/, /No implementada/, /\bDescopete bordos\b/i, /correcto|aprobado|conforme|válido/i];

const medir = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const peq = [];
  document.querySelectorAll('.cons-pagina button, .cons-pagina select, .cons-pagina input:not([type=file]), .cons-pagina summary, .cons-pagina [role=tab]').forEach((el) => {
    if (!vis(el) || el.closest('aside, nav')) return;
    const r = el.getBoundingClientRect();
    if (r.height < 43.5) peq.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute('aria-label') || el.id || '').trim().slice(0, 28)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  });
  const chico = [];
  document.querySelectorAll('.cons-pagina *').forEach((el) => {
    if (!vis(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 11.9) chico.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 24)} ${px}px`);
  });
  const txt = document.querySelector('.cons-pagina')?.innerText ?? '';
  return {
    overflowX: document.documentElement.scrollWidth > innerWidth + 2,
    objetivosPequenos: [...new Set(peq)].slice(0, 8), nPeq: peq.length,
    textoChico: [...new Set(chico)].slice(0, 6), nChico: chico.length,
    tokensRotos: ['NaN', 'undefined', 'Infinity', '[object Object]'].filter((t) => txt.includes(t)),
  };
};
// Texto visible + opciones de <select> (innerText no incluye las <option>).
const textoVivo = () => {
  const raiz = document.querySelector('.cons-pagina');
  const opts = [...raiz.querySelectorAll('select option')].map((o) => o.textContent);
  return `${raiz.innerText}\n${opts.join('\n')}`;
};

const browser = await chromium.launch();
const res = {};
const fallas = [];
for (const [nombre, vp] of Object.entries(VPS)) {
  const ctx = await browser.newContext({ viewport: vp.viewport, serviceWorkers: 'block', ...vp.opts });
  const page = await ctx.newPage();
  const errores = [], red = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !IGNORE.test(m.text())) errores.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => errores.push(`pageerror: ${String(e.message).slice(0, 200)}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon|\.map$|supabase/.test(r.url())) red.push(`${r.status()} ${r.url().slice(0, 100)}`); });
  const rec = { pestanas: {} };
  const foto = (n, completa = false) => page.screenshot({ path: fileURLToPath(new URL(`vocab_${nombre}_${n}.png`, OUT)), fullPage: completa });
  const pestana = async (re) => { await page.getByRole('tab', { name: re }).click(); await page.waitForTimeout(500); };
  const registrar = async (clave) => {
    const t = await page.evaluate(textoVivo);
    const viejas = VIEJAS.filter((re) => re.test(t)).map((re) => `${re} «…${t.slice(Math.max(0, t.search(re) - 40), t.search(re) + 30).replace(/\s+/g, ' ')}…»`);
    rec.pestanas[clave] = { medidas: await page.evaluate(medir), viejas, honestidad: /no es aprobación ni rechazo/.test(t) };
    if (viejas.length) fallas.push(`${nombre}/${clave}: vocabulario viejo ${viejas.join(' ')}`);
  };

  await page.goto('http://localhost:5173/conservacion?seccion=derivacion', { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForSelector('.cons-der-slots', { timeout: 60000 }).catch(() => { fallas.push(`${nombre}: no cargó .cons-der-slots`); });
  await page.waitForTimeout(800);
  rec.chips = await page.locator('.sc-hero, [class*="hero"]').first().innerText().catch(() => null);
  await registrar('ciclo'); await foto('1_ciclo');

  await pestana(/Concentrado/); await registrar('concentrado');
  rec.concentradoEstados = [...new Set(await page.locator('.cons-tabla tbody tr td:nth-child(5)').allInnerTexts())];
  rec.concentradoConceptos = await page.locator('.cons-tabla tbody .cons-der-enlace').evaluateAll((els) => els.slice(0, 40).map((e) => `${e.textContent} <- ${e.title}`));
  await foto('2_concentrado');

  await pestana(/Cadena/); await registrar('cadena');
  rec.cadenaOpciones = await page.locator('#cons-cad-con option').evaluateAll((os) => os.slice(0, 40).map((o) => `${o.textContent} <- ${o.title}`));
  await foto('3_cadena');

  await pestana(/^Tramos|Tramos$/); await registrar('tramos');
  rec.tramosConceptos = await page.locator('#cons-tr-con option').evaluateAll((os) => os.map((o) => `${o.textContent} <- ${o.title}`));
  await foto('4_tramos');

  await pestana(/Verificación/); await registrar('verificacion');
  rec.verTiles = await page.locator('.cons-der-tile').allInnerTexts();
  rec.verConceptos = await page.locator('#cons-ver-con option').evaluateAll((os) => os.map((o) => `${o.textContent} <- ${o.title}`));
  rec.verRedes = await page.locator('#cons-ver-red option').allInnerTexts();
  rec.verBotonesEstado = await page.locator('.cons-sev-btn').allInnerTexts();
  await page.locator('.cons-lista summary').first().click().catch(() => {});
  rec.verPrimero = (await page.locator('.cons-lista details[open]').first().innerText().catch(() => '')).slice(0, 500);
  await foto('5_verificacion');
  // M5
  await page.selectOption('#cons-ver-amb', 'M5').catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('.cons-sev-btn').first().click().catch(() => {});
  rec.verTilesM5 = await page.locator('.cons-der-tile').allInnerTexts();
  rec.verConceptosM5 = await page.locator('#cons-ver-con option').evaluateAll((os) => os.map((o) => `${o.textContent} <- ${o.title}`));
  rec.verOpcionesPacot = await page.locator('#cons-ver-amb option').allInnerTexts();
  await registrar('verificacion_m5'); await foto('5b_verificacion_m5');

  // Cadena y Tramos en M5
  await pestana(/Cadena/); await page.selectOption('#cons-cad-amb', 'M5').catch(() => {}); await page.waitForTimeout(500);
  rec.cadenaOpcionesM5 = await page.locator('#cons-cad-con option').evaluateAll((os) => os.slice(0, 40).map((o) => `${o.textContent} <- ${o.title}`));
  await registrar('cadena_m5'); await foto('3b_cadena_m5');
  await pestana(/^Tramos|Tramos$/); await page.selectOption('#cons-tr-amb', 'M5').catch(() => {}); await page.waitForTimeout(500);
  rec.tramosConceptosM5 = await page.locator('#cons-tr-con option').evaluateAll((os) => os.map((o) => `${o.textContent} <- ${o.title}`));
  rec.tramosResumenM5 = await page.locator('.cons-der-obra > summary').evaluateAll((els) => els.slice(0, 6).map((e) => `${e.innerText.replace(/\n/g, ' | ')} <- ${e.querySelector('[title]')?.title ?? ''}`));
  await registrar('tramos_m5'); await foto('4b_tramos_m5');
  await pestana(/Programa/); await registrar('programa');

  // Comprobación de reglas
  await page.getByRole('tab', { name: /Comprobación de reglas/ }).click(); await page.waitForTimeout(500);
  if (informe) {
    await page.setInputFiles('input[type=file]', path.join(informeDir, informe)).catch((e) => fallas.push(`informe: ${e.message.slice(0, 80)}`));
    await page.waitForSelector('.cons-pulso', { timeout: 15000 }).catch(() => fallas.push(`${nombre}: no abrió el informe`));
    await registrar('reglas_resumen'); await foto('6_reglas_resumen');
    await page.getByRole('tab', { name: /^Reglas/ }).click().catch(() => {}); await page.waitForTimeout(400);
    rec.reglasEstados = await page.locator('#cons-g-estado option').allInnerTexts().catch(() => []);
    rec.reglasInsignias = [...new Set(await page.locator('.cons-tabla tbody td[data-label=Estado]').allInnerTexts().catch(() => []))];
    await registrar('reglas_reglas'); await foto('7_reglas_reglas');
    await page.getByRole('tab', { name: /Hallazgos/ }).click().catch(() => {}); await page.waitForTimeout(400);
    await registrar('reglas_hallazgos');
    await page.getByRole('tab', { name: /Parámetros/ }).click().catch(() => {}); await page.waitForTimeout(400);
    await registrar('reglas_parametros');
  } else fallas.push('sin informe de reglas en informes-conservacion/');

  rec.errores = errores.slice(0, 10); rec.red = [...new Set(red)].slice(0, 8);
  if (errores.length) fallas.push(`${nombre}: ${errores.length} errores de consola`);
  if (red.length) fallas.push(`${nombre}: ${red.length} fallos de red`);
  res[nombre] = rec;
  await ctx.close();
}
await browser.close();
fs.writeFileSync(fileURLToPath(new URL('vocabulario_ui.json', OUT)), JSON.stringify(res, null, 2));
for (const [n, r] of Object.entries(res)) {
  console.log(`\n== ${n} ==`);
  for (const [k, p] of Object.entries(r.pestanas)) {
    const m = p.medidas;
    console.log(`${k.padEnd(18)} viejas=${p.viejas.length} aviso=${p.honestidad} overflowX=${m.overflowX} taps<44=${m.nPeq} texto<12=${m.nChico} rotos=${m.tokensRotos.join(',') || '-'}`);
    if (m.nPeq) console.log('   taps:', m.objetivosPequenos.slice(0, 3));
    if (m.nChico) console.log('   chico:', m.textoChico.slice(0, 3));
  }
}
console.log('\nFALLAS:', fallas.length ? fallas : 'ninguna');
