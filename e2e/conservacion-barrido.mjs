// SICA Conservación · barrido de legibilidad y objetivos (Tanda 3). Solo lectura.
//   Uso:  node e2e/conservacion-barrido.mjs [desktop|ipad|iphone|all]      (requiere `npm run dev` en :5173)
// Recorre TODAS las pestañas de Derivación (más Comprobación con un tramo abierto, con el perfil desplegado, y obras puntuales) y mide:
//   · texto visible < --sc-texto-min (12 px), incluido el texto de los SVG con su escala real en pantalla;
//   · objetivos (button, select, summary, a, [role=tab], input) < --sc-objetivo-min (44 px) en alto o ancho;
//   · desborde horizontal de la página y celdas/tablas cortadas; · errores de consola/red.
// Capturas en e2e/out/barrido_<vp>_<pestaña>.png. Sale con código 1 si algo falla.
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = new URL('./out/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const sel = process.argv.find((a) => ['desktop', 'ipad', 'iphone', 'all'].includes(a)) ?? 'all';
const VPS = {
  desktop: { viewport: { width: 1440, height: 900 }, opts: {} },
  ipad: { viewport: { width: 1180, height: 820 }, opts: { hasTouch: true } },
  iphone: { viewport: { width: 440, height: 956 }, opts: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
};
const IGNORE = /AUTH_BYPASS|WebSocket|realtime|\[vite\]|DevTools|favicon|supabase/i;
const fallos = [];
const verifica = (n, c, d = '') => { if (!c) fallos.push(`${n}${d ? ` · ${d}` : ''}`); return c; };

const medir = (page) => page.evaluate(() => {
  const raiz = document.querySelector('[role=tabpanel]') ?? document.body;
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const chico = [], peq = [];
  const base = document.querySelector('.sc-root') ?? document.body;
  const min = parseFloat(getComputedStyle(base).getPropertyValue('--sc-texto-min')) || 12;
  const obj = parseFloat(getComputedStyle(base).getPropertyValue('--sc-objetivo-min')) || 44;
  raiz.querySelectorAll('*').forEach((el) => {
    if (el instanceof SVGElement && el.tagName.toLowerCase() !== 'text') return;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
    if (!vis(el) || el.closest('.cons-solo-lector, .cr-solo-lector, .pf-solo-lector, .sc-sr')) return;
    let px = parseFloat(getComputedStyle(el).fontSize);
    if (el instanceof SVGElement) { const m = el.getScreenCTM?.(); if (m) px *= Math.hypot(m.a, m.b); }
    if (px < min - 0.05) chico.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').slice(0, 24)} ${px.toFixed(1)}px "${el.textContent.trim().slice(0, 20)}"`);
  });
  raiz.querySelectorAll('button, select, summary, a[href], [role=tab], input:not([type=hidden]):not([type=file])').forEach((el) => {
    if (el.closest('svg, .leaflet-container') || !vis(el)) return;
    // Una casilla es un objetivo por su etiqueta (label que la envuelve), no por el cuadrito.
    const r = (el.matches('input[type=checkbox], input[type=radio]') && el.closest('label') ? el.closest('label') : el).getBoundingClientRect();
    if (r.height < obj - 0.5 || r.width < obj - 0.5) peq.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  });
  const corta = [];
  raiz.querySelectorAll('td, th').forEach((el) => {
    if (!vis(el)) return;
    const s = getComputedStyle(el);
    if (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) corta.push(`celda cortada "${el.textContent.trim().slice(0, 16)}"`);
  });
  raiz.querySelectorAll('.sc-tabla-wrap').forEach((w) => {
    if (vis(w) && w.scrollWidth > w.clientWidth + 2 && getComputedStyle(w).overflowX === 'visible') corta.push('tabla sin scroll');
  });
  return { chico: [...new Set(chico)], peq: [...new Set(peq)], corta: [...new Set(corta)], overflowX: document.documentElement.scrollWidth > innerWidth + 2, nChico: chico.length, nPeq: peq.length };
});

const browser = await chromium.launch();
const resumen = {};
for (const nombre of sel === 'all' ? Object.keys(VPS) : [sel]) {
  const vp = VPS[nombre];
  const ctx = await browser.newContext({ viewport: vp.viewport, serviceWorkers: 'block', ...vp.opts });
  const page = await ctx.newPage();
  const errores = [], red = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !IGNORE.test(m.text())) errores.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => errores.push(`pageerror: ${String(e.message).slice(0, 200)}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon|\.map$|supabase/.test(r.url())) red.push(`${r.status()} ${r.url().slice(0, 100)}`); });
  await page.addInitScript(() => { try { sessionStorage.clear(); } catch { /* nada */ } });
  await page.goto('http://localhost:5173/conservacion?seccion=derivacion', { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForSelector('.cons-der-slots', { timeout: 120000 });
  const rec = {};
  const paso = async (clave, antes) => {
    if (antes) await antes();
    await page.waitForTimeout(700);
    rec[clave] = await medir(page);
    await page.screenshot({ path: fileURLToPath(new URL(`barrido_${nombre}_${clave}.png`, OUT)) });
    const m = rec[clave];
    verifica(`${nombre} · ${clave}: texto >= 12 px`, m.nChico === 0, `${m.nChico}: ${m.chico.slice(0, 6).join(' | ')}`);
    verifica(`${nombre} · ${clave}: objetivos >= 44 px`, m.nPeq === 0, `${m.nPeq}: ${m.peq.slice(0, 6).join(' | ')}`);
    verifica(`${nombre} · ${clave}: sin desborde horizontal`, !m.overflowX);
    verifica(`${nombre} · ${clave}: sin celdas ni tablas cortadas`, m.corta.length === 0, m.corta.join(' | '));
  };
  const tab = (re) => async () => { await page.getByRole('tab', { name: re }).click(); };
  await paso('ciclo', null);
  await paso('revision', async () => { await tab(/^Revisión/)(); await page.waitForSelector('.cr-fila', { timeout: 60000 }); });
  await paso('concentrado', tab(/^Concentrado/));
  await paso('cadena', async () => { await tab(/^Cadena de cálculo/)(); await page.waitForSelector('.cons-der-cadena'); });
  await paso('tramos', async () => { await tab(/^Tramos/)(); await page.waitForSelector('.cons-der-obra'); await page.locator('.cons-der-obra summary').first().click(); });
  await paso('verificacion', async () => { await tab(/^Verificación/)(); await page.waitForSelector('.cons-h'); await page.locator('.cons-h summary').first().click(); });
  await paso('programa', async () => { await tab(/^Programa/)(); await page.waitForSelector('.pg-fila, .cons-der-obra', { timeout: 20000 }); });
  await paso('comprobacion', async () => {
    await tab(/^Revisión/)(); await page.waitForSelector('.cr-fila');
    await page.locator('.cr-fila .cr-abrir').first().click(); await page.waitForSelector('.cc-raiz .cons-ec');
  });
  await paso('comprobacion_perfil', async () => { const b = page.getByRole('button', { name: /Ver perfil completo/ }); if (await b.count()) await b.first().click(); });
  await paso('comprobacion_obras', async () => {
    const s = page.locator('#cons-comp-red'); const hay = (await s.locator('option[value=obras]').count()) > 0;
    if (hay) { await s.selectOption('obras'); await page.waitForSelector('.op-ficha', { timeout: 20000 }).catch(() => {}); }
  });
  // Caminos y drenes (dibujos de sección distintos al del canal): el texto de los SVG también cuenta a su escala real.
  const ambitos = await page.locator('#cons-comp-amb option').evaluateAll((l) => l.map((o) => o.value));
  for (const amb of ambitos) {
    await page.selectOption('#cons-comp-amb', amb);
    for (const redSel of ['distribucion', 'caminos', 'drenaje', 'tuberia']) {
      const s = page.locator('#cons-comp-red');
      if ((await s.locator(`option[value=${redSel}]`).count()) === 0) continue;
      await paso(`comprobacion_${amb}_${redSel}`, async () => { await s.selectOption(redSel); await page.waitForSelector('.cons-comp-ficha', { timeout: 20000 }).catch(() => {}); });
    }
  }
  // Distribución con el tramo de desazolve abierto desde el Centro (mide también el dibujo de la sección del canal).
  verifica(`${nombre}: 0 errores de consola`, errores.length === 0, errores.join(' | '));
  verifica(`${nombre}: 0 errores de red`, red.length === 0, red.join(' | '));
  resumen[nombre] = Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, { chico: v.nChico, peq: v.nPeq, muestra: [...v.chico.slice(0, 3), ...v.peq.slice(0, 3)] }]));
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(resumen, null, 1));
console.log(fallos.length ? `\nFALLOS (${fallos.length}):\n- ${fallos.join('\n- ')}` : '\nSin fallos.');
process.exit(fallos.length ? 1 : 0);
