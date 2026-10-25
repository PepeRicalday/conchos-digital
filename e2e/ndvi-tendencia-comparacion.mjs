// Auditoría de SOLO LECTURA de GEO-MONITOR · NDVI mensual por módulo: gráficas del panel + modal + INFORME TÉCNICO INTEGRADO.
//   npm run audit:ndvi -- <iteracion>        (con `npm run dev` en :5173)       ·  SALTAR=perfiles,sd,informe para omitir fases
// Capturas y resultado: ../ciclo_2025_2026/auditoria/ndvi_informe_integrado/iter<N>/ (resultado.json, hojas_*, grises_*, PDF, HTML descargados).
// Fases: (1) panel en Chromium 1440/1024/820/430 y WebKit iPhone 15 Pro Max + iPad Pro 11 (vertical/horizontal): gráfica principal, selector año+mes,
// ficha, plano, foco/teclado; (2) S/D simulado por respuesta alterada; (3) cifras del panel contra la BD viva (REST con anon key, solo SELECT);
// (4) informe integrado (e2e/ndvi-informe.mjs): modal, vista previa vs descarga (mismo folio y bytes), 13 configuraciones, impresión (hojas físicas,
// desbordes en px, pt efectivos, contraste), imagen satelital (falla real, éxito simulado con page.route, parcial, progreso), escala de grises y cifras.
// La prueba con raster REAL (sesión SRL en producción) NO se hace aquí: la función exige rol SRL o secreto de cron y este script nunca los usa.
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const iter = process.argv[2] || '1';
const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const OUT = fileURLToPath(new URL(`../../ciclo_2025_2026/auditoria/ndvi_informe_integrado/iter${iter}/`, import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const SALTAR = (process.env.SALTAR || '').split(',');
const res = { iter, hallazgos: [], cifras: [], perfiles: {} };
const hallazgo = (sev, donde, txt) => { res.hallazgos.push({ sev, donde, txt }); console.log(`[${sev}] ${donde}: ${txt}`); };
const cifra = (nombre, bd, pantalla) => {
  const ok = String(bd) === String(pantalla);
  res.cifras.push({ cifra: nombre, bd, pantalla, ok });
  if (!ok) hallazgo('critico', 'cifras', `${nombre}: BD ${bd} vs pantalla ${pantalla}`);
};

// ── BD viva (solo lectura, anon key) ──
const env = fs.readFileSync(RAIZ + '.env', 'utf8');
const leer = (k) => (env.match(new RegExp('^' + k + '="?([^"\\r\\n]+?)"?\\s*$', 'm')) || [])[1]?.trim();
const URL_SB = leer('VITE_SUPABASE_URL'), KEY = leer('VITE_SUPABASE_ANON_KEY');
const rest = async (q) => (await fetch(`${URL_SB}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json();
const bd = await rest('ndvi_modulo_mensual_v2?select=numero_modulo,mes,ndvi_mediana&metodo=eq.scl-mediana-v1&order=mes&limit=5000');
const MODULOS = [1, 2, 3, 4, 5, 12];
const val = (m, mes) => bd.find((x) => x.numero_modulo === m && x.mes === mes)?.ndvi_mediana ?? null;
const media = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const MESES_T = ['03', '04', '05', '06', '07', '08', '09'];
const ULTIMO = bd[bd.length - 1].mes; // 2026-09
const ANIO = Number(ULTIMO.slice(0, 4));
/** Anomalía de la temporada de un módulo: media del año − media de la referencia (mismos meses, otros años), como el informe de tendencia. */
const anomaliaMod = (m, anio) => {
  const meses = MESES_T.filter((t) => val(m, `${anio}-${t}`) != null);
  const otros = [2021, 2022, 2023, 2024, 2025, 2026].filter((a) => a !== anio);
  const vals = meses.map((t) => val(m, `${anio}-${t}`));
  const refs = meses.map((t) => media(otros.map((a) => val(m, `${a}-${t}`)).filter((x) => x != null)));
  return media(vals) - media(refs);
};

const PERFILES = [
  { id: 'chromium-1440', motor: chromium, ctx: { viewport: { width: 1440, height: 900 } } },
  { id: 'chromium-1024', motor: chromium, ctx: { viewport: { width: 1024, height: 768 } } },
  { id: 'chromium-820', motor: chromium, ctx: { viewport: { width: 820, height: 1180 }, hasTouch: true } },
  { id: 'chromium-430', motor: chromium, ctx: { viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true } },
  { id: 'webkit-iphone', motor: webkit, ctx: { ...devices['iPhone 15 Pro Max'] } },
  { id: 'webkit-ipad-vertical', motor: webkit, ctx: { ...devices['iPad Pro 11'] } },
  { id: 'webkit-ipad-horizontal', motor: webkit, ctx: { ...devices['iPad Pro 11 landscape'] } },
];

const IGNORA = /AUTH_BYPASS|WebSocket|realtime|favicon|tile|basemaps|cartocdn|sentinel|copernicus|dataspace|openstreetmap|gibs|earthdata|nasa|windy|\.map$/i;
function vigila(page, err, net) {
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORA.test(m.text()) && !IGNORA.test(m.location()?.url ?? '')) err.push(m.text().slice(0, 200) + ' @ ' + (m.location()?.url ?? '').slice(0, 100)); });
  page.on('pageerror', (e) => err.push('pageerror ' + String(e.message).slice(0, 200)));
  page.on('response', (r) => { if (r.status() >= 400 && !IGNORA.test(r.url())) net.push(`${r.status()} ${r.url().slice(0, 120)}`); });
  page.on('requestfailed', (r) => { if (r.failure()?.errorText !== 'net::ERR_ABORTED' && !IGNORA.test(r.url()) && !/\.woff2?$/.test(r.url())) net.push('FAILED ' + r.url().slice(0, 120)); });
}

async function abrirPanel(page) {
  await page.goto('http://localhost:5173/geo-monitor', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /Ver NDVI mensual por módulo/ }).click({ timeout: 20000 });
  await page.waitForSelector('.ndvi-gr .ndvi-gr-echarts canvas', { timeout: 30000 });
  await page.waitForTimeout(2200);
}

// ── medidores dentro de la página ──
const PARSE = `const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
const lum = ({ r, g, b }) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };`;
const CONTRASTE = (raiz) => `(() => { ${PARSE}
  const fondo = (el) => { const caps = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { caps.push(c); if (c.a >= 1) break; } } let base = { r: 8, g: 14, b: 28 }; if (caps.length && caps[caps.length - 1].a >= 1) base = caps.pop(); for (const c of caps.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) }; return base; };
  const malos = [], chicos = []; const raiz = document.querySelector(${JSON.stringify(raiz)}); if (!raiz) return { malos: [], chicos: [] };
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT); const vistos = new Set();
  while (w.nextNode()) { const n = w.currentNode; const t = n.textContent.trim(); const el = n.parentElement; if (!t || vistos.has(el) || el.closest('svg,.leaflet-container,canvas')) continue; vistos.add(el);
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue; const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    const fg = parse(cs.color); if (!fg) continue; const bg = fondo(el); const a = fg.a; const mix = { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) };
    const L1 = lum(mix), L2 = lum(bg); const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); const px = parseFloat(cs.fontSize);
    if (cr < 4.5) malos.push({ t: t.slice(0, 40), cr: +cr.toFixed(2), px, clase: String(el.className).slice(0, 40) });
    if (px < 11.95) chicos.push({ t: t.slice(0, 30), px, clase: String(el.className).slice(0, 40) }); }
  return { malos, chicos }; })()`;
const DESBORDE = (raiz) => `(() => { const sc = document.querySelector(${JSON.stringify(raiz)}); if (!sc) return null; const r = sc.getBoundingClientRect();
  const culpables = [...sc.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.right > r.right + 2 && !e.closest('.ndvi-gr-tabla-wrap,.ndvi-ia-tabla-wrap,.leaflet-container,.ndvi-chips,canvas,.sr-only,.ndvi-sr-only'); }).slice(0, 4).map((e) => (e.className?.toString() || e.tagName).slice(0, 40));
  return { pagina: document.documentElement.scrollWidth > innerWidth + 2, contenedor: sc.scrollWidth > sc.clientWidth + 2, culpables }; })()`;
const FOCO = `(() => { const e = document.activeElement; if (!e || e === document.body) return { ok: false, clase: 'body' }; const cs = getComputedStyle(e); return { ok: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none', clase: String(e.className).slice(0, 30) || e.tagName }; })()`;

const MALOS_TXT = ['NaN', 'undefined', 'Infinity', '[object Object]', 'null'];
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hayMalo = (txt, mal) => new RegExp(`(^|[^a-záéíóúñ])${escRe(mal)}([^a-záéíóúñ]|$)`).test(txt);
async function textoLimpio(page, sel, donde) {
  const t = await page.locator(sel).first().innerText();
  for (const mal of MALOS_TXT) if (hayMalo(t, mal)) hallazgo('critico', donde, `aparece "${mal}"`);
  return t;
}
async function medidas(page, raiz, donde, r) {
  const d = await page.evaluate(DESBORDE(raiz));
  if (d && (d.pagina || d.contenedor || d.culpables.length)) hallazgo('alto', donde, `desborde horizontal ${JSON.stringify(d)}`);
  const c = await page.evaluate(CONTRASTE(raiz));
  if (c.malos.length) hallazgo('medio', donde, `contraste < 4.5: ${JSON.stringify(c.malos.slice(0, 4))}`);
  if (c.chicos.length) hallazgo('medio', donde, `texto < 12 px: ${JSON.stringify(c.chicos.slice(0, 4))}`);
  if (r) { r.desborde = d; r.contraste = c.malos.length; r.chicos = c.chicos.length; }
}

// ═════════════════ 1) Recorrido por perfil ═════════════════
for (const P of PERFILES.filter(() => !SALTAR.includes('perfiles'))) {
  const t0 = Date.now();
  const browser = await P.motor.launch();
  const ctx = await browser.newContext({ ...P.ctx, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const err = [], net = [];
  vigila(page, err, net);
  const r = { id: P.id };
  const D = P.id;
  const tactil = !!P.ctx.hasTouch;
  const foto = async (nombre, loc) => { try { await (loc ?? page).screenshot({ path: `${OUT}${D}_${nombre}.png` }); } catch (e) { hallazgo('bajo', D, `captura ${nombre}: ${String(e.message).slice(0, 80)}`); } };
  try {
    await abrirPanel(page);
    // — diálogo del panel —
    const dlg = await page.evaluate(() => { const d = document.querySelector('.vaso-container'); return { role: d?.getAttribute('role'), modal: d?.getAttribute('aria-modal'), foco: d?.contains(document.activeElement) }; });
    r.dialogoPanel = dlg;
    if (dlg.role !== 'dialog' || dlg.modal !== 'true') hallazgo('alto', D, 'el panel no es role="dialog" aria-modal');
    if (!dlg.foco) hallazgo('alto', D, 'el foco inicial no está dentro del panel');
    await foto('01_panel_arriba');
    await textoLimpio(page, '.vaso-container', `${D} panel`);
    await medidas(page, '.vaso-scroll-content', `${D} panel`, r);
    const cierre = await page.locator('.vaso-close').boundingBox();
    if (cierre && (cierre.width < 43.5 || cierre.height < 43.5)) hallazgo('alto', D, `botón cerrar del panel ${cierre.width}x${cierre.height} (< 44 px)`);
    // — selector año + mes por teclado (tarjetas) —
    const grupoAnio = page.getByRole('radiogroup', { name: 'Tarjetas: año' });
    const nChipsTarjetas = await page.locator('.ndvi-controles .ndvi-chip').count();
    r.chipsTarjetas = nChipsTarjetas;
    if (nChipsTarjetas > 20) hallazgo('alto', D, `selector de mes de tarjetas con ${nChipsTarjetas} chips`);
    await grupoAnio.getByRole('radio', { checked: true }).focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(500);
    const anioSel = await grupoAnio.getByRole('radio', { checked: true }).innerText();
    if (anioSel !== String(ANIO - 1)) hallazgo('alto', D, `ArrowLeft en el selector de año dejó "${anioSel}" (esperado ${ANIO - 1})`);
    const metaTarj = await page.locator('.ndvi-card-meta').first().innerText();
    if (!metaTarj.includes(`${ANIO - 1}-`)) hallazgo('alto', D, `las tarjetas no muestran un mes de ${ANIO - 1}: "${metaTarj.replace(/\n/g, ' ')}"`);
    const tabIdx = await grupoAnio.locator('[role=radio]').evaluateAll((els) => els.map((e) => e.tabIndex));
    if (tabIdx.filter((x) => x === 0).length !== 1) hallazgo('medio', D, `radiogroup sin una única parada de Tab: ${tabIdx}`);
    await page.keyboard.press('End'); await page.waitForTimeout(300); // último año otra vez
    await page.getByRole('radiogroup', { name: 'Tarjetas: mes' }).getByRole('radio', { name: /septiembre 2026/ }).click();
    await page.waitForTimeout(400);

    // — gráfica principal —
    const gr = page.locator('.ndvi-gr');
    await gr.scrollIntoViewIfNeeded(); await page.waitForTimeout(900);
    const caja = await page.locator('.ndvi-gr-echarts').boundingBox();
    r.alturaGrafica = caja?.height;
    if (!caja || caja.height < 280) hallazgo('alto', D, `gráfica principal muy baja (${caja?.height})`);
    const aria = await page.evaluate(() => [...document.querySelectorAll('.ndvi-gr-lienzo [aria-label]')].map((e) => e.getAttribute('aria-label')).join(' | '));
    if (!/NDVI mensual/.test(aria)) hallazgo('alto', D, 'la gráfica principal no expone descripción aria');
    await foto('02_grafica_un_anio', gr);
    for (const a of [2021, 2022, 2023, 2024, 2025, 2026]) {
      await gr.getByRole('radio', { name: String(a), exact: true }).click();
      await page.waitForTimeout(350);
      const txt = await textoLimpio(page, '.ndvi-gr', `${D} gráfica ${a}`);
      if (!txt.includes(`en ${a}, de enero a diciembre`)) hallazgo('medio', D, `texto de la vista Un año no cambia a ${a}`);
      if (!/por (debajo|encima)|en línea|frente a lo habitual/.test(txt)) hallazgo('medio', D, `sin titular para ${a}`);
      if (a === 2021) await foto('03_grafica_2021', gr);
    }
    const titular = (await page.locator('.ndvi-gr-titular').innerText()).replace(/\n/g, ' ');
    r.titular = titular;
    if (!/programación del riego/.test(titular) || !/29 de septiembre/.test(titular) || !/pasos de satélite/.test(titular) || !/volumen entregado/.test(titular)) hallazgo('alto', D, 'el titular no lleva la cautela completa');
    if (/porque|debido a|causa de|por culpa/i.test(titular)) hallazgo('alto', D, 'el titular afirma causa');
    await gr.getByRole('radio', { name: String(ANIO), exact: true }).click(); await page.waitForTimeout(300);
    // vista Comparar años: promedio SRL y cada módulo
    // Espera a que termine la animación de ECharts: una captura a medio dibujo muestra líneas truncadas y etiquetas fuera de lugar.
    await gr.getByRole('radio', { name: 'Comparar años' }).click(); await page.waitForTimeout(1800);
    await foto('04_grafica_comparar_srl', gr);
    for (const m of ['M1', 'M2', 'M3', 'M4', 'M5', 'M12']) {
      await gr.getByRole('radio', { name: new RegExp(`^${m}$|Módulo ${m.slice(1)}$`) }).click();
      await page.waitForTimeout(300);
      await textoLimpio(page, '.ndvi-gr', `${D} comparar ${m}`);
    }
    await foto('05_grafica_comparar_M12', gr);
    // tabla alternativa
    await gr.getByRole('radio', { name: 'Un año' }).click(); await page.waitForTimeout(300);
    await page.locator('.ndvi-gr-tabla summary').click(); await page.waitForTimeout(300);
    const filasTabla = await page.locator('.ndvi-gr-tabla tbody tr').count();
    if (filasTabla !== 12) hallazgo('alto', D, `la tabla alternativa tiene ${filasTabla} filas (esperadas 12)`);
    const tablaTxt = await page.locator('.ndvi-gr-tabla').innerText();
    if (!/sin medir/.test(tablaTxt)) hallazgo('medio', D, 'la tabla no distingue "sin medir" (meses por venir)');
    r.tablaOk = true;
    await medidas(page, '.vaso-scroll-content', `${D} grafica`, null);

    // — plano —
    const plano = page.locator('.plano-general-card');
    await plano.scrollIntoViewIfNeeded(); await page.waitForTimeout(1800);
    const mapa = await page.locator('.plano-general-map-wrap').boundingBox();
    r.alturaMapa = mapa?.height;
    const vh = page.viewportSize().height;
    if (mapa && mapa.height > vh * 0.8) hallazgo('alto', D, `mapa del plano de ${mapa.height}px en pantalla de ${vh}px`);
    const mover = await page.locator('.plano-general-mover').count();
    if (tactil && mover !== 1) hallazgo('alto', D, 'pantalla táctil sin botón "Mover el mapa"');
    if (!tactil && mover !== 0) hallazgo('medio', D, 'botón "Mover el mapa" en pantalla con ratón');
    if (tactil && mover) {
      const bm = await page.locator('.plano-general-mover').boundingBox();
      if (bm.height < 43.5) hallazgo('alto', D, `botón del mapa de ${bm.height}px`);
      await page.locator('.plano-general-mover').click(); await page.waitForTimeout(200);
      if ((await page.locator('.plano-general-mover').getAttribute('aria-pressed')) !== 'true') hallazgo('medio', D, 'el botón del mapa no cambia de estado');
      await page.locator('.plano-general-mover').click();
    }
    const txtPlano = await textoLimpio(page, '.plano-general-card', `${D} plano`);
    if (!/6 de 6 módulos/.test(txtPlano)) hallazgo('alto', D, 'el plano no muestra "6 de 6 módulos"');
    const nDelta = await page.locator('.plano-general-fila-delta').count();
    if (nDelta !== 6) hallazgo('alto', D, `Δ vs los demás en ${nDelta} filas (esperadas 6)`);
    await foto('06_plano_ndvi', plano);
    await plano.getByRole('radio', { name: 'ICV', exact: true }).click(); await page.waitForTimeout(900);
    const nLey = await page.locator('.plano-general-card .ndvi-ley-lista li').count();
    if (nLey !== 4) hallazgo('alto', D, `leyenda de ICV con ${nLey} clases (esperadas 4)`);
    await foto('07_plano_icv', plano);
    await plano.getByRole('radio', { name: 'IHR', exact: true }).click(); await page.waitForTimeout(500);
    if (await page.locator('.plano-general-card .ndvi-ley-lista li').count() !== 4) hallazgo('alto', D, 'leyenda de IHR sin 4 clases');
    await plano.getByRole('radio', { name: 'NDVI', exact: true }).click();
    await medidas(page, '.vaso-scroll-content', `${D} plano`, null);

    // — ficha del módulo —
    const tarjeta = page.locator('.ndvi-modulo-card-clickable').first();
    await tarjeta.scrollIntoViewIfNeeded();
    await tarjeta.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('.ndvi-detalle-overlay .ndvi-detalle-echarts canvas', { timeout: 20000 });
    await page.waitForTimeout(2500);
    const fi = await page.evaluate(() => { const d = document.querySelector('.ndvi-detalle-container'); const c = document.querySelector('.ndvi-detalle-close'); const b = c.getBoundingClientRect(); return { role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), foco: d.contains(document.activeElement), cierre: [b.width, b.height], label: c.getAttribute('aria-label'), canvases: document.querySelectorAll('.ndvi-detalle-echarts canvas').length, izq: d.getBoundingClientRect().left, panelIzq: document.querySelector('.vaso-screen-overlay').getBoundingClientRect().left }; });
    r.ficha = fi;
    if (fi.role !== 'dialog' || fi.modal !== 'true') hallazgo('alto', D, 'la ficha no es role="dialog" aria-modal');
    if (!fi.foco) hallazgo('alto', D, 'el foco inicial no está dentro de la ficha');
    if (fi.cierre[0] < 43.5 || fi.cierre[1] < 43.5) hallazgo('alto', D, `cerrar de la ficha ${fi.cierre} (< 44 px)`);
    if (!fi.label) hallazgo('alto', D, 'cerrar de la ficha sin aria-label');
    if (fi.canvases < 2) hallazgo('alto', D, `la ficha tiene ${fi.canvases} gráficas (esperadas 2: NDVI e ICV/IHR)`);
    const solape = await page.evaluate(() => { const o = document.querySelector('.ndvi-detalle-overlay').getBoundingClientRect(); const side = document.querySelector('.sidebar')?.getBoundingClientRect(); return side && side.width > 0 && o.left < side.right - 1 ? { ficha: o.left, menu: side.right } : null; });
    if (solape) hallazgo('alto', D, `la ficha se empalma con el menú lateral ${JSON.stringify(solape)}`);
    const tf = await textoLimpio(page, '.ndvi-detalle-container', `${D} ficha`);
    if (/geojson/i.test(tf)) hallazgo('medio', D, 'la ficha muestra el nombre técnico del geojson');
    if (!/0\.330/.test(tf)) hallazgo('alto', D, 'la ficha de M1 no muestra 0.330 (septiembre 2026)');
    await foto('08_ficha_arriba', page);
    await page.locator('.ndvi-detalle-scroll').evaluate((e) => e.scrollTo(0, 99999)); await page.waitForTimeout(900);
    await foto('09_ficha_series', page);
    await medidas(page, '.ndvi-detalle-scroll', `${D} ficha`, null);
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    const cerrada = (await page.locator('.ndvi-detalle-overlay').count()) === 0;
    const panelSigue = (await page.locator('.vaso-container').count()) === 1;
    const focoVuelve = await page.evaluate(() => /^Módulo 1,/.test(document.activeElement?.getAttribute('aria-label') ?? ''));
    if (!cerrada) hallazgo('alto', D, 'Escape no cierra la ficha');
    if (!panelSigue) hallazgo('alto', D, 'Escape en la ficha cerró también el panel');
    if (!focoVuelve) hallazgo('alto', D, 'al cerrar la ficha el foco no vuelve a la tarjeta del módulo');

    // — foco visible por teclado —
    await page.locator('.ndvi-controles .ndvi-chip').first().focus();
    const focos = [];
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); focos.push(await page.evaluate(FOCO)); }
    r.focos = focos;
    const sin = focos.filter((f) => !f.ok);
    if (sin.length) hallazgo('alto', D, `sin indicador de foco: ${JSON.stringify(sin)}`);

    // — Escape cierra el panel y devuelve el foco —
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    if ((await page.locator('.vaso-container').count()) !== 0) hallazgo('alto', D, 'Escape no cierra el panel');
    else if (P.motor !== webkit && !(await page.evaluate(() => /NDVI mensual por módulo/.test((document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || ''))))) hallazgo('medio', D, 'al cerrar el panel el foco no vuelve al botón que lo abrió');
  } catch (e) { hallazgo('critico', D, 'fallo del recorrido: ' + String(e.message).slice(0, 220)); await foto('zz_fallo'); }
  r.errores = err; r.red = net;
  if (err.length) hallazgo('alto', D, `errores de consola: ${JSON.stringify(err.slice(0, 3))}`);
  if (net.length) hallazgo('alto', D, `fallos de red: ${JSON.stringify(net.slice(0, 3))}`);
  res.perfiles[D] = r;
  console.log(`· ${D} listo en ${Math.round((Date.now() - t0) / 1000)} s`);
  await browser.close();
}

// ═════════════════ 2) S/D simulado (respuesta de lectura alterada; la BD no se toca) ═════════════════
if (!SALTAR.includes('sd')) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const err = [], net = [];
  vigila(page, err, net);
  await ctx.route('**/rest/v1/ndvi_modulo_mensual_v2*', async (route) => {
    const resp = await route.fetch();
    const filas = await resp.json();
    const sd = filas.map((f) => ((f.numero_modulo === 2 && String(f.mes).startsWith('2026-05')) || (f.numero_modulo === 3 && String(f.mes).startsWith('2026-09'))
      ? { ...f, ndvi_mediana: null, ndvi_medio: null, ndvi_p10: null, ndvi_p90: null, ndvi_desv: null, kc_estimado: null } : f));
    await route.fulfill({ response: resp, json: sd });
  });
  try {
    await abrirPanel(page);
    const tarj = await page.locator('.ndvi-modulo-card-clickable').nth(2).innerText();
    if (!/S\/D/.test(tarj)) hallazgo('critico', 'S/D simulado', `la tarjeta del M3 sin dato no dice S/D: "${tarj.replace(/\n/g, ' ')}"`);
    const gr = page.locator('.ndvi-gr');
    await gr.scrollIntoViewIfNeeded();
    await page.locator('.ndvi-gr-tabla summary').click(); await page.waitForTimeout(300);
    const celdaMay = await page.evaluate(() => { const t = document.querySelector('.ndvi-gr-tabla table'); const col = [...t.querySelectorAll('thead th')].findIndex((x) => x.textContent === 'Módulo 2'); const fila = [...t.querySelectorAll('tbody tr')].find((x) => x.querySelector('th').textContent === 'May'); return fila.children[col].textContent; });
    if (celdaMay !== 'S/D') hallazgo('critico', 'S/D simulado', `M2 en mayo 2026 debería ser S/D y es "${celdaMay}"`);
    const txt = await page.locator('.ndvi-gr').innerText();
    if (!/May \(5 de 6\)/.test(txt) || !/Sep \(5 de 6\)/.test(txt)) hallazgo('alto', 'S/D simulado', 'no avisa los meses con promedio SRL de 5 de 6');
    await textoLimpio(page, '.ndvi-gr', 'S/D simulado gráfica');
    await page.locator('.ndvi-gr').screenshot({ path: `${OUT}sd_grafica.png` });
    const plano = page.locator('.plano-general-card');
    await plano.scrollIntoViewIfNeeded(); await page.waitForTimeout(1500);
    const tp = await plano.innerText();
    if (!/5 de 6 módulos/.test(tp)) hallazgo('critico', 'S/D simulado', 'el plano no muestra "5 de 6 módulos" con M3 sin dato');
    const fila3 = await page.locator('.plano-general-fila').nth(2).innerText();
    if ((fila3.match(/S\/D/g) ?? []).length < 2) hallazgo('alto', 'S/D simulado', `la fila de M3 debe mostrar S/D en valor y Δ: "${fila3.replace(/\n/g, ' ')}"`);
    await plano.screenshot({ path: `${OUT}sd_plano.png` });
    // Cifra: promedio SRL de septiembre con M3 sin dato = promedio de los otros 5
    const esperado = media(MODULOS.filter((m) => m !== 3).map((m) => val(m, '2026-09'))).toFixed(2);
    cifra('Promedio SRL sep-2026 con M3 S/D (plano, 5 de 6)', esperado, (await page.locator('.plano-general-promedio-valor').innerText()).trim());
    await page.locator('.ndvi-modulo-card-clickable').nth(2).click();
    await page.waitForSelector('.ndvi-detalle-container', { timeout: 15000 }); await page.waitForTimeout(2000);
    const tfi = await page.locator('.ndvi-detalle-container').innerText();
    if (!/NDVI \(mediana\)\s*\n?\s*S\/D/.test(tfi)) hallazgo('alto', 'S/D simulado', 'la ficha de M3 sin dato no muestra S/D en NDVI');
    await textoLimpio(page, '.ndvi-detalle-container', 'S/D simulado ficha');
  } catch (e) { hallazgo('critico', 'S/D simulado', 'fallo: ' + String(e.message).slice(0, 200)); }
  if (err.length) hallazgo('alto', 'S/D simulado', `errores: ${JSON.stringify(err.slice(0, 2))}`);
  await browser.close();
}

// ═════════════════ 3) Cifras del panel contra la BD viva (Chromium 1440) ═════════════════
{
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const err = [], net = [];
  vigila(page, err, net);
  try {
    await abrirPanel(page);
    // cifra 1–2: tarjeta de M1 y delta (septiembre 2026)
    const v1 = val(1, ULTIMO), v1prev = val(1, '2026-08');
    const tarjeta1 = await page.locator('.ndvi-modulo-card-clickable').first().innerText();
    cifra('M1 NDVI sep-2026 (tarjeta, 2 decimales)', v1.toFixed(2), (tarjeta1.match(/(\d\.\d\d)\s*NDVI/) ?? [])[1]);
    const dlt = (v1 - v1prev); const dltTxt = `${dlt >= 0 ? '+' : '−'}${Math.abs(dlt).toFixed(3)}`;
    cifra('M1 Δ vs agosto (tarjeta)', dltTxt, (tarjeta1.match(/([+−]\d\.\d{3})\s+vs mes anterior/) ?? [])[1]);
    // cifra 3: promedio SRL sep-2026 en la tabla de la gráfica (3 decimales)
    await page.locator('.ndvi-gr').scrollIntoViewIfNeeded();
    await page.locator('.ndvi-gr-tabla summary').click(); await page.waitForTimeout(300);
    const promSep = await page.evaluate(() => { const t = document.querySelector('.ndvi-gr-tabla table'); const col = [...t.querySelectorAll('thead th')].findIndex((x) => x.textContent === 'Promedio SRL'); const fila = [...t.querySelectorAll('tbody tr')].find((x) => x.querySelector('th').textContent === 'Sep'); return fila.children[col].textContent; });
    cifra('Promedio SRL sep-2026 (tabla de la gráfica)', media(MODULOS.map((m) => val(m, ULTIMO))).toFixed(3), promSep);
    // M2 en mayo-2025 desde la tabla (año 2025)
    await page.locator('.ndvi-gr').getByRole('radio', { name: '2025', exact: true }).click(); await page.waitForTimeout(400);
    const m2may25 = await page.evaluate(() => { const t = document.querySelector('.ndvi-gr-tabla table'); const col = [...t.querySelectorAll('thead th')].findIndex((x) => x.textContent === 'Módulo 2'); const fila = [...t.querySelectorAll('tbody tr')].find((x) => x.querySelector('th').textContent === 'May'); return fila.children[col].textContent; });
    cifra('M2 NDVI may-2025 (tabla de la gráfica)', val(2, '2025-05').toFixed(3), m2may25);
    // cifra 4: titular −0.063 recalculado
    await page.locator('.ndvi-gr').getByRole('radio', { name: String(ANIO), exact: true }).click(); await page.waitForTimeout(400);
    const esperadoTit = media(MODULOS.map((m) => anomaliaMod(m, ANIO)));
    const titTxt = await page.locator('.ndvi-gr-titular strong').innerText();
    cifra('Titular de 2026: promedio SRL de la anomalía', `${esperadoTit >= 0 ? '+' : '−'}${Math.abs(esperadoTit).toFixed(3)}`, (titTxt.match(/\(([+−]\d\.\d{3}) promedio SRL\)/) ?? [])[1]);
    // cifra 5: Δ de M1 vs los demás en el plano (3 decimales)
    const plano = page.locator('.plano-general-card');
    await plano.scrollIntoViewIfNeeded(); await page.waitForTimeout(1200);
    const d1 = v1 - media(MODULOS.filter((m) => m !== 1).map((m) => val(m, ULTIMO)));
    const filaM1 = (await page.locator('.plano-general-fila').first().locator('.plano-general-fila-delta').innerText()).replace(/\s+/g, ' ');
    cifra('M1 Δ vs los demás, sep-2026 (plano)', `${d1 >= 0 ? '+' : '−'}${Math.abs(d1).toFixed(3)}`, (filaM1.match(/([+−]\d\.\d{3})/) ?? [])[1]);
    cifra('M1 NDVI sep-2026 (valor del plano)', v1.toFixed(2), (await page.locator('.plano-general-fila').first().locator('.plano-general-fila-valor').innerText()).trim());
    const pico21 = await page.evaluate(() => { const t = [...document.querySelectorAll('.ndvi-ia-tabla')].find((x) => x.querySelector('caption')?.textContent.startsWith('Resumen por año')); const tr = [...t.querySelectorAll('tbody tr')].find((x) => x.querySelector('th').textContent.trim().startsWith('2021')); return tr.querySelector('td').textContent.trim(); });
    cifra('M1 pico NDVI 2021 (comparativo interanual)', Math.max(...MESES_T.map((t) => val(1, `2021-${t}`))).toFixed(3), pico21);
  } catch (e) { hallazgo('critico', 'cifras panel', 'fallo: ' + String(e.message).slice(0, 200)); }
  if (err.length) hallazgo('alto', 'cifras panel', `errores de consola: ${JSON.stringify(err.slice(0, 3))}`);
  if (net.length) hallazgo('alto', 'cifras panel', `fallos de red: ${JSON.stringify(net.slice(0, 3))}`);
  await browser.close();
}

// ═════════════════ 4) Informe técnico integrado: modal, vista previa, descarga, impresión, imagen, grises y cifras ═════════════════
const CONTRASTE_SVG = `(() => { ${PARSE}
  const malos = []; for (const t of document.querySelectorAll('svg text')) { const cs = getComputedStyle(t); const f = parse(cs.fill); if (!f || !t.textContent.trim()) continue;
    if (parseFloat(cs.strokeWidth) > 1 && cs.stroke !== 'none') continue; // rotulado con halo blanco (plano): el contraste lo da el halo
    let fondo = t.closest('svg').style.background ? { r: 246, g: 245, b: 242 } : { r: 255, g: 255, b: 255 };
    const prev = t.previousElementSibling; // rótulo claro sobre una pastilla oscura (p. ej. «SRL»): el fondo es el de la pastilla
    if (prev && prev.tagName === 'rect' && lum(f) > 0.5) { const pf = parse(getComputedStyle(prev).fill); if (pf && pf.a > 0) fondo = pf; }
    const L1 = lum(f), L2 = lum(fondo); const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); if (cr < 4.5) malos.push({ t: t.textContent.slice(0, 20), cr: +cr.toFixed(2), fill: cs.fill }); }
  return malos; })()`;
let informe = {};
if (!SALTAR.includes('informe')) {
  const { barridoInforme } = await import('./ndvi-informe.mjs');
  informe = await barridoInforme({
    RAIZ, OUT, res, hallazgo, cifra, vigila, abrirPanel, medidas, CONTRASTE, CONTRASTE_SVG, URL_SB, KEY, rest,
    PERFILES_INFORME: PERFILES.filter((p) => p.id !== 'chromium-1024'),
  });
}

fs.writeFileSync(OUT + 'resultado.json', JSON.stringify(res, null, 2));
const crit = res.hallazgos.filter((h) => h.sev === 'critico' || h.sev === 'alto').length;
console.log(`\nIteración ${iter}: ${res.hallazgos.length} hallazgos (${crit} críticos/altos). Cifras cruzadas con la BD: ${res.cifras.filter((c) => c.ok).length}/${res.cifras.length} coinciden.`);
for (const c of res.cifras) console.log('  ', c.ok ? 'OK ' : 'MAL', c.cifra, '| BD', c.bd, '| informe/pantalla', c.pantalla);
for (const t of res.tablaPdf ?? []) console.log('pdf', JSON.stringify(t));
