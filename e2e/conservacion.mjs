// SICA Conservación · verificación de interfaz con Playwright (solo lectura).
//   Uso:  node e2e/conservacion.mjs [ruta-del-informe.json] [desktop|ipad|iphone|all]     (requiere `npm run dev` en :5173)
// Carga un informe generado con `npm run conservacion:analizar`, recorre las 4 pestañas y el informe imprimible,
// y mide errores de consola/red, desbordes horizontales, objetivos táctiles < 44 px, texto < 11 px y logos rotos.
// Salida: e2e/out/conservacion_<vp>_*.png y conservacion_<vp>.json. Bloquea el service worker (trampa conocida de la PWA).
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const OUT = new URL('./out/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const raiz = fileURLToPath(new URL('../', import.meta.url));

function ultimoInforme() {
  const dir = path.join(raiz, 'informes-conservacion');
  const f = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => /^informe-.*\.json$/.test(x)).sort().pop() : null;
  return f ? path.join(dir, f) : null;
}
const informe = process.argv[2] && process.argv[2].endsWith('.json') ? path.resolve(process.argv[2]) : ultimoInforme();
if (!informe || !fs.existsSync(informe)) { console.error('No hay informe .json: ejecute `npm run conservacion:analizar -- <pacot.xls> --modulo MOD-001`.'); process.exit(1); }
const sel = process.argv.find((a) => ['desktop', 'ipad', 'iphone', 'all'].includes(a)) ?? 'all';

const VPS = {
  desktop: { viewport: { width: 1440, height: 900 }, opts: {} },
  ipad: { viewport: { width: 1180, height: 820 }, opts: { hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } },
  iphone: { viewport: { width: 440, height: 956 }, opts: { hasTouch: true, isMobile: true, deviceScaleFactor: 3, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' } },
};
const IGNORE = /AUTH_BYPASS|WebSocket|realtime|\[vite\]|DevTools|favicon|supabase/i;

const medir = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const dentroDePagina = (el) => !el.closest('aside, nav, .sidebar, [class*="sidebar"], [class*="Sidebar"], [class*="topbar"], [class*="TopBar"]');
  const peq = [];
  document.querySelectorAll('button, select, input:not([type=file]), summary, [role=tab], [role=button]').forEach((el) => {
    if (!vis(el) || !dentroDePagina(el)) return;
    const r = el.getBoundingClientRect();
    if (r.height < 43.5 || r.width < 43.5) peq.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute('aria-label') || el.id || '').trim().slice(0, 28)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  });
  const chico = [];
  document.querySelectorAll('.cons-pagina *').forEach((el) => {
    if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
    if (!vis(el)) return;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 10.9) chico.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 24)} ${px}px "${el.textContent.trim().slice(0, 20)}"`);
  });
  return {
    overflowX: document.documentElement.scrollWidth > innerWidth + 2,
    ancho: { scroll: document.documentElement.scrollWidth, inner: innerWidth },
    objetivosPequenos: [...new Set(peq)].slice(0, 20),
    textoChico: [...new Set(chico)].slice(0, 10),
    imgsRotas: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src.slice(-60)),
    tokensRotos: ['NaN', 'undefined', 'Infinity', '[object Object]'].filter((t) => (document.body.innerText || '').includes(t)),
    errorBoundary: /algo sali[oó] mal|something went wrong/i.test(document.body.innerText || ''),
  };
};

const browser = await chromium.launch();
const resumen = {};
for (const nombre of sel === 'all' ? Object.keys(VPS) : [sel]) {
  const vp = VPS[nombre];
  const ctx = await browser.newContext({ viewport: vp.viewport, serviceWorkers: 'block', acceptDownloads: true, ...vp.opts });
  const page = await ctx.newPage();
  const errores = [], red = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !IGNORE.test(m.text())) errores.push(`${m.type()}: ${m.text().slice(0, 220)}`); });
  page.on('pageerror', (e) => errores.push(`pageerror: ${String(e.message).slice(0, 220)}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon|\.map$|supabase/.test(r.url())) red.push(`${r.status()} ${r.url().slice(0, 120)}`); });
  const rec = { viewport: vp.viewport, pasos: {} };
  const foto = (n) => page.screenshot({ path: fileURLToPath(new URL(`conservacion_${nombre}_${n}.png`, OUT)), fullPage: false });
  const fotoCompleta = (n) => page.screenshot({ path: fileURLToPath(new URL(`conservacion_${nombre}_${n}.png`, OUT)), fullPage: true });

  await page.addInitScript(() => { try { sessionStorage.clear(); } catch { /* sin almacenamiento */ } });
  await page.goto('http://localhost:5173/conservacion', { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => { rec.gotoError = e.message.slice(0, 100); });
  await page.waitForSelector('.cons-pagina', { timeout: 20000 }).catch(() => { rec.sinPagina = true; });
  rec.pasos.vacio = await page.evaluate(medir);
  await foto('0_vacio');

  // Informe inválido: debe avisar sin romper
  fs.writeFileSync(path.join(raiz, 'e2e', 'out', '_no_es_informe.json'), '{"hola": 1}');
  await page.setInputFiles('.cons-zona input[type=file]', path.join(raiz, 'e2e', 'out', '_no_es_informe.json'));
  rec.errorMostrado = await page.locator('.cons-error').first().innerText().catch(() => null);

  await page.setInputFiles('.cons-zona input[type=file]', informe);
  await page.waitForSelector('.cons-tabs', { timeout: 15000 }).catch(() => { rec.sinInforme = true; });
  await page.waitForTimeout(600);
  rec.pasos.resumen = await page.evaluate(medir);
  rec.logos = await page.evaluate(() => [...document.querySelectorAll('.cons-marca img')].map((i) => ({ alt: i.alt, w: i.naturalWidth, h: i.naturalHeight, ok: i.complete && i.naturalWidth > 0 })));
  await foto('1_resumen'); await fotoCompleta('1_resumen_completo');

  for (const [id, n] of [['hallazgos', '2_hallazgos'], ['reglas', '3_reglas'], ['parametros', '4_parametros']]) {
    await page.click(`#cons-tab-${id}`); await page.waitForTimeout(400);
    if (id === 'hallazgos') {
      rec.cuentaInicial = await page.locator('.cons-cuenta').innerText();
      await page.click('.cons-sev-btn >> nth=0'); await page.waitForTimeout(200);
      rec.cuentaAlta = await page.locator('.cons-cuenta').innerText();
      await page.locator('.cons-h summary').first().click(); await page.waitForTimeout(200);
    }
    rec.pasos[id] = await page.evaluate(medir);
    await foto(n);
  }
  await page.click('#cons-tab-hallazgos');
  await page.click('.cons-sev-btn >> nth=0'); // quitar filtro
  await page.fill('#cons-f-q', 'zzz-no-existe'); await page.waitForTimeout(200);
  rec.sinResultados = await page.locator('.sc-vacio').innerText().catch(() => null);
  await page.fill('#cons-f-q', '');

  // Informe imprimible
  await page.click('#cons-tab-resumen');
  await page.getByRole('button', { name: /Informe imprimible/ }).click();
  await page.waitForSelector('.cons-previa-marco iframe', { timeout: 15000 }).catch(() => { rec.sinPrevia = true; });
  await page.waitForTimeout(1200);
  const marco = page.frameLocator('.cons-previa-marco iframe');
  rec.informeImprimible = {
    paginas: await marco.locator('.pagina').count().catch(() => 0),
    logos: await marco.locator('.hdr img').evaluateAll((l) => l.map((i) => i.naturalWidth > 0)).catch(() => []),
    desborde: await page.evaluate(medir).then((m) => m.overflowX),
  };
  await foto('5_informe_imprimible');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  rec.cierraConEscape = (await page.locator('.cons-previa').count()) === 0;

  rec.errores = errores.slice(0, 15);
  rec.red = [...new Set(red)].slice(0, 10);
  resumen[nombre] = rec;
  fs.writeFileSync(fileURLToPath(new URL(`conservacion_${nombre}.json`, OUT)), JSON.stringify(rec, null, 2));
  await ctx.close();
}
await browser.close();
for (const [n, r] of Object.entries(resumen)) {
  const pasos = Object.entries(r.pasos);
  console.log(`\n== ${n} ${r.viewport.width}x${r.viewport.height} ==`);
  console.log(`errores consola/JS: ${r.errores.length} · fallos de red: ${r.red.length} · informe inválido avisa: ${r.errorMostrado ? 'sí' : 'NO'} · cierra con Esc: ${r.cierraConEscape}`);
  console.log(`logos: ${JSON.stringify(r.logos)} · hallazgos: ${r.cuentaInicial} → alta: ${r.cuentaAlta} · sin resultados: ${r.sinResultados ? 'aviso' : 'NO'}`);
  console.log(`informe imprimible: ${JSON.stringify(r.informeImprimible)}`);
  for (const [p, m] of pasos) console.log(`  ${p}: overflowX=${m.overflowX} (${m.ancho.scroll}/${m.ancho.inner}) taps<44=${m.objetivosPequenos.length} texto<11px=${m.textoChico.length} imgsRotas=${m.imgsRotas.length} tokens=${m.tokensRotos.join(',') || '-'} errBoundary=${m.errorBoundary}`);
  if (r.errores.length) console.log('  errores:', r.errores.slice(0, 5));
  for (const [p, m] of pasos) { if (m.objetivosPequenos.length) console.log(`  taps pequeños (${p}):`, m.objetivosPequenos.slice(0, 6)); if (m.textoChico.length) console.log(`  texto chico (${p}):`, m.textoChico.slice(0, 4)); }
}
