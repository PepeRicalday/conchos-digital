// SICA Conservación · verificación de la pestaña "PacOT y derivación de cálculos" con Playwright (solo lectura).
//   Uso:  node e2e/conservacion-derivacion.mjs [derivacion-AAAA-AAAA.json] [desktop|ipad|iphone|all]     (requiere `npm run dev` en :5173)
// Carga un archivo generado con `npm run conservacion:derivar`, recorre las 5 secciones y mide errores de consola/red,
// desbordes horizontales, objetivos táctiles < 44 px, textos rotos (NaN/undefined) y que un dato ausente se muestre "S/D" y no 0.
// Salida: e2e/out/derivacion_<vp>_*.png y derivacion_<vp>.json. Bloquea el service worker (trampa conocida de la PWA).
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const OUT = new URL('./out/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const raiz = fileURLToPath(new URL('../', import.meta.url));

function ultimoArchivo() {
  const dir = path.join(raiz, 'derivacion-conservacion');
  const f = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => /^derivacion-.*\.json$/.test(x)).sort().pop() : null;
  return f ? path.join(dir, f) : null;
}
const archivo = process.argv[2] && process.argv[2].endsWith('.json') ? path.resolve(process.argv[2]) : ultimoArchivo();
if (!archivo || !fs.existsSync(archivo)) { console.error('No hay archivo de derivación: ejecute `npm run conservacion:derivar -- <pacot.xls|.xlsx>`.'); process.exit(1); }
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
  document.querySelectorAll('.cons-pagina button, .cons-pagina select, .cons-pagina input:not([type=file]), .cons-pagina summary, .cons-pagina [role=tab]').forEach((el) => {
    if (!vis(el) || !dentroDePagina(el)) return;
    const r = el.getBoundingClientRect();
    if (r.height < 43.5) peq.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute('aria-label') || el.id || '').trim().slice(0, 28)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  });
  const chico = [];
  document.querySelectorAll('.cons-pagina *').forEach((el) => {
    if (!vis(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 10.9) chico.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 24)} ${px}px`);
  });
  return {
    overflowX: document.documentElement.scrollWidth > innerWidth + 2,
    ancho: { scroll: document.documentElement.scrollWidth, inner: innerWidth },
    objetivosPequenos: [...new Set(peq)].slice(0, 12),
    textoChico: [...new Set(chico)].slice(0, 8),
    tokensRotos: ['NaN', 'undefined', 'Infinity', '[object Object]'].filter((t) => (document.body.innerText || '').includes(t)),
    errorBoundary: /algo sali[oó] mal|something went wrong/i.test(document.body.innerText || ''),
  };
};

const browser = await chromium.launch();
const resumen = {};
for (const nombre of sel === 'all' ? Object.keys(VPS) : [sel]) {
  const vp = VPS[nombre];
  const ctx = await browser.newContext({ viewport: vp.viewport, serviceWorkers: 'block', ...vp.opts });
  const page = await ctx.newPage();
  const errores = [], red = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !IGNORE.test(m.text())) errores.push(`${m.type()}: ${m.text().slice(0, 220)}`); });
  page.on('pageerror', (e) => errores.push(`pageerror: ${String(e.message).slice(0, 220)}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon|\.map$|supabase/.test(r.url())) red.push(`${r.status()} ${r.url().slice(0, 120)}`); });
  const rec = { viewport: vp.viewport, pasos: {} };
  const foto = (n, completa = false) => page.screenshot({ path: fileURLToPath(new URL(`derivacion_${nombre}_${n}.png`, OUT)), fullPage: completa });
  const pestana = async (etiqueta) => { await page.getByRole('tab', { name: etiqueta }).click(); await page.waitForTimeout(400); };

  await page.addInitScript(() => { try { sessionStorage.clear(); } catch { /* sin almacenamiento */ } });
  await page.goto('http://localhost:5173/conservacion?seccion=derivacion', { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => { rec.gotoError = e.message.slice(0, 100); });
  await page.waitForSelector('.cons-pagina', { timeout: 20000 }).catch(() => { rec.sinPagina = true; });
  // La plataforma en local lee sola la carpeta de PacOT: debe llenarse sin arrastrar ningún archivo.
  await page.waitForSelector('.cons-der-slots, .cons-zona', { timeout: 120000 }).catch(() => { rec.sinArchivo = true; });
  rec.cargaAutomatica = (await page.locator('.cons-der-slots').count()) > 0;
  rec.archivosCarpeta = await page.locator('.cons-der-archivos li').count();
  rec.botonActualizar = await page.getByRole('button', { name: /Actualizar desde la carpeta/ }).count();
  rec.pasos.vacio = await page.evaluate(medir);
  await foto('0_inicio');

  // Archivo inválido: debe avisar sin romper (la zona de arrastre aparece al pedir "Abrir otro archivo")
  await page.getByRole('button', { name: /Abrir otro archivo/ }).click().catch(() => {});
  await page.waitForSelector('.cons-zona', { timeout: 10000 }).catch(() => { rec.sinZona = true; });
  fs.writeFileSync(path.join(raiz, 'e2e', 'out', '_no_es_derivacion.json'), '{"hola": 1}');
  await page.setInputFiles('.cons-zona input[type=file]', path.join(raiz, 'e2e', 'out', '_no_es_derivacion.json'));
  rec.errorMostrado = await page.locator('.cons-error').first().innerText().catch(() => null);

  await page.setInputFiles('.cons-zona input[type=file]', archivo);
  await page.waitForSelector('.cons-der-slots', { timeout: 15000 }).catch(() => { rec.sinArchivo = true; });
  await page.waitForTimeout(600);
  rec.pasos.ciclo = await page.evaluate(medir);
  rec.slots = await page.locator('.cons-der-slot').count();
  rec.slotsPendientes = await page.locator('.cons-der-slot-pend').count();
  await foto('1_ciclo'); await foto('1_ciclo_completo', true);

  await pestana(/Concentrado/);
  rec.filasConcentrado = await page.locator('.cons-tabla tbody tr').count();
  rec.pendienteMostrado = await page.locator('.cons-der-pend').count();
  rec.textoParcial = await page.locator('.sc-aviso').first().innerText().catch(() => null);
  rec.pasos.concentrado = await page.evaluate(medir);
  await foto('2_concentrado'); await foto('2_concentrado_completo', true);

  // Del concentrado a la cadena de cálculo
  await page.locator('.cons-der-enlace').first().click(); await page.waitForTimeout(500);
  rec.pasosCadena = await page.locator('.cons-der-paso').count();
  rec.verificaciones = await page.locator('.cons-der-verif li').allInnerTexts();
  rec.pasos.cadena = await page.evaluate(medir);
  await foto('3_cadena'); await foto('3_cadena_completo', true);

  await pestana(/Tramos/);
  await page.locator('.cons-der-obra > summary').first().click(); await page.waitForTimeout(300);
  rec.obras = await page.locator('.cons-der-obra').count();
  rec.tramosVisibles = await page.locator('.cons-der-obra[open] tbody tr').count();
  rec.pasos.tramos = await page.evaluate(medir);
  await foto('4_tramos'); await foto('4_tramos_completo', true);

  // Desazolve por tramo: abre todas las obras y cuenta las insignias de verificación de la última columna
  await page.selectOption('#cons-tr-con', '1').catch(() => {});
  await page.evaluate(() => document.querySelectorAll('.cons-der-obra').forEach((d) => d.setAttribute('open', '')));
  await page.waitForTimeout(300);
  rec.tramosConInsignia = await page.locator('.cons-der-obra[open] tbody tr td:last-child .cons-ins').count();
  await foto('4a_tramos_desazolve', true);

  // Verificación del diagnóstico: resumen por estado, criterio inferido y resultados con su recálculo
  await pestana(/Verificación/);
  rec.verTiles = await page.locator('.cons-der-tile').allInnerTexts();
  rec.verCriterios = await page.locator('.cons-tabla tbody tr').count();
  rec.verResultados = await page.locator('.cons-lista > li').count();
  rec.verAvisoHonesto = await page.locator('.cons-honesto').first().innerText().catch(() => null);
  await page.locator('.cons-lista summary').first().click().catch(() => {});
  rec.pasos.verificacion = await page.evaluate(medir);
  await foto('4b_verificacion'); await foto('4b_verificacion_completo', true);
  // El criterio del libro filtra a sus atípicos; el primero se abre y muestra su recálculo paso a paso
  const atip = page.locator('.cons-tabla .cons-der-enlace').first();
  if (await atip.count()) {
    await atip.click(); await page.waitForTimeout(300);
    rec.verFiltroAtipicos = await page.locator('.cons-cuenta[role=status]').innerText().catch(() => null);
    await page.locator('.cons-lista summary').first().click().catch(() => {});
    rec.verRecalculoAbierto = await page.locator('.cons-lista details[open] table').count();
    rec.verPrimerAtipico = await page.locator('.cons-lista details[open]').first().innerText().catch(() => null);
    await foto('4c_verificacion_atipico');
  }
  // Cambio de PacOT a la SRL (si existe)
  await page.selectOption('#cons-ver-amb', 'SRL').catch(() => {});
  await page.waitForTimeout(400);
  rec.verTilesSrl = await page.locator('.cons-der-tile').allInnerTexts();

  await pestana(/Programa/);
  // Tanda 3: el programa es una lista paginada de renglones (resumen por concepto + filtro + enlaces), ya no grupos plegables.
  await page.waitForSelector('.pg-fila', { timeout: 20000 });
  rec.gruposPrograma = await page.locator('.cons-pg-resumen tbody tr').count();
  rec.renglonesPagina = await page.locator('.pg-fila').count();
  rec.pasos.programa = await page.evaluate(medir);
  await foto('5_programa');

  // Cambio de apartado y regreso conserva la derivación (sessionStorage)
  await page.getByRole('tab', { name: /Comprobación de reglas/ }).click(); await page.waitForTimeout(300);
  await page.getByRole('tab', { name: /derivación de cálculos/ }).click(); await page.waitForTimeout(500);
  rec.conservaAlVolver = (await page.locator('.cons-der-slots, .cons-tabla, .cons-der-cadena').count()) > 0 || (await page.locator('.cons-tabs').count()) > 1;

  rec.errores = errores.slice(0, 15);
  rec.red = [...new Set(red)].slice(0, 10);
  resumen[nombre] = rec;
  fs.writeFileSync(fileURLToPath(new URL(`derivacion_${nombre}.json`, OUT)), JSON.stringify(rec, null, 2));
  await ctx.close();
}
await browser.close();
for (const [n, r] of Object.entries(resumen)) {
  console.log(`\n== ${n} ${r.viewport.width}x${r.viewport.height} ==`);
  console.log(`carga automática: ${r.cargaAutomatica} · archivos en carpeta: ${r.archivosCarpeta} · botón actualizar: ${r.botonActualizar}`);
  console.log(`errores consola/JS: ${r.errores.length} · fallos de red: ${r.red.length} · archivo inválido avisa: ${r.errorMostrado ? 'sí' : 'NO'} · conserva al volver: ${r.conservaAlVolver}`);
  console.log(`slots: ${r.slots} (pendientes ${r.slotsPendientes}) · filas concentrado: ${r.filasConcentrado} · "pendiente" en tabla: ${r.pendienteMostrado} · pasos cadena: ${r.pasosCadena} · obras: ${r.obras} (abierta con ${r.tramosVisibles} tramos) · grupos programa: ${r.gruposPrograma}`);
  console.log(`verificaciones: ${JSON.stringify(r.verificaciones)}`);
  console.log(`tramos con insignia: ${r.tramosConInsignia} · VERIFICACIÓN tiles: ${JSON.stringify(r.verTiles)} · criterios: ${r.verCriterios} · resultados visibles: ${r.verResultados} · recálculo abre: ${r.verRecalculoAbierto}
  primer atípico: ${JSON.stringify((r.verPrimerAtipico||'').slice(0,420))} · filtro atípicos: ${r.verFiltroAtipicos} · tiles SRL: ${JSON.stringify(r.verTilesSrl)}`);
  for (const [p, m] of Object.entries(r.pasos)) console.log(`  ${p}: overflowX=${m.overflowX} (${m.ancho.scroll}/${m.ancho.inner}) taps<44=${m.objetivosPequenos.length} texto<11px=${m.textoChico.length} tokens=${m.tokensRotos.join(',') || '-'} errBoundary=${m.errorBoundary}`);
  if (r.errores.length) console.log('  errores:', r.errores.slice(0, 5));
  for (const [p, m] of Object.entries(r.pasos)) { if (m.objetivosPequenos.length) console.log(`  taps pequeños (${p}):`, m.objetivosPequenos.slice(0, 5)); if (m.textoChico.length) console.log(`  texto chico (${p}):`, m.textoChico.slice(0, 3)); }
}
