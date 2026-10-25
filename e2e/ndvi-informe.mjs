// Barrido del INFORME TÉCNICO INTEGRADO de NDVI (GEO-MONITOR). Lo invoca e2e/ndvi-tendencia-comparacion.mjs (`npm run audit:ndvi -- <iteracion>`).
// Solo lectura: la BD solo recibe SELECT; la función sentinel-ndvi-modulo-raster NUNCA se llama de verdad (sin sesión SRL responde 401, que es lo
// esperado en local; el éxito se SIMULA interceptando la llamada con page.route y un PNG sintético de clases discretas: e2e/informe-ndvi-rasters.ts).
// Cubre: modal (periodo, años, módulos, secciones, interruptores) en 6 perfiles; vista previa vs descarga (mismo folio y mismos bytes); 12
// configuraciones; impresión (hojas físicas, desbordes en px, tamaño efectivo en pt, contraste); imagen satelital (falla real, éxito simulado,
// éxito parcial, progreso); escala de grises; cifras contra la BD viva.
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { execFileSync } from 'child_process';

const MALOS_TXT = ['NaN', 'undefined', 'Infinity', '[object Object]', 'null'];
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hayMalo = (txt, mal) => new RegExp(`(^|[^a-záéíóúñ])${escRe(mal)}([^a-záéíóúñ]|$)`).test(txt);
const kib = (n) => +(n / 1024).toFixed(1);
const textoDe = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

// ── medidores de impresión (se ejecutan dentro de la página con emulateMedia('print')) ──
const HOJAS = `(() => [...document.querySelectorAll('.pagina')].map((p, i) => { const r = p.getBoundingClientRect();
  let desbordeX = 0; for (const e of p.querySelectorAll('*')) { if (e.closest('svg') && e.tagName !== 'svg') continue; const b = e.getBoundingClientRect(); if (b.width > 0 && b.right > r.right + 1) desbordeX = Math.max(desbordeX, Math.round(b.right - r.right)); }
  const cu = p.querySelector('.cuerpo'), pie = p.querySelector('footer');
  return { n: i + 1, alto: +r.height.toFixed(1), desbordeX, cuerpoFin: cu ? +(cu.getBoundingClientRect().bottom - r.top).toFixed(1) : null, pieIni: pie ? +(pie.getBoundingClientRect().top - r.top).toFixed(1) : null }; }))()`;
const PT_HTML = `(() => { const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const vistos = new Set();
  while (w.nextNode()) { const n = w.currentNode; const t = n.textContent.trim(); const el = n.parentElement; if (!t || vistos.has(el) || el.closest('svg,style,script')) continue; vistos.add(el);
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue; const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    out.push({ pt: +(parseFloat(cs.fontSize) * 0.75).toFixed(2), t: t.slice(0, 28), c: String(el.className).slice(0, 24) }); }
  out.sort((a, b) => a.pt - b.pt); return { min: out[0]?.pt ?? null, peores: out.slice(0, 4), bajo: out.filter((x) => x.pt < 7.49).length, n: out.length }; })()`;

/** Contexto de red del escenario: sesión SRL falsa (solo para que el cliente pida la imagen) + la función raster simulada. */
async function prepararContexto(browser, P, A, { sesion = false, raster = null, retrasoMs = 700, falla = [], sd = false } = {}) {
  const ctx = await browser.newContext({ ...P.ctx, serviceWorkers: 'block', acceptDownloads: true });
  if (sd) {
    await ctx.route('**/rest/v1/ndvi_modulo_mensual_v2*', async (route) => {
      const resp = await route.fetch(); const filas = await resp.json();
      const anula = (f) => ({ ...f, ndvi_mediana: null, ndvi_medio: null, ndvi_p10: null, ndvi_p90: null, ndvi_desv: null, kc_estimado: null });
      await route.fulfill({ response: resp, json: filas.map((f) => ((f.numero_modulo === 2 && String(f.mes).startsWith('2026-05')) || (f.numero_modulo === 3 && String(f.mes).startsWith('2026-09')) ? anula(f) : f)) });
    });
  }
  if (!sesion) return ctx;
  const ref = new URL(A.URL_SB).hostname.split('.')[0];
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 86400 * 30;
  const uid = '00000000-0000-4000-8000-0000000000aa';
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp })}.firma-falsa-qa`;
  const s = { access_token: jwt, token_type: 'bearer', expires_in: 86400 * 30, expires_at: exp, refresh_token: 'qa', user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'qa@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }, [`sb-${ref}-auth-token`, JSON.stringify(s)]);
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  ctx.llamadasRaster = [];
  await ctx.route(`${A.URL_SB}/**`, async (route) => {
    const req = route.request(); const u = req.url();
    if (req.method() === 'OPTIONS' && u.includes('/functions/v1/')) return route.fulfill({ status: 204, headers: cors });
    if (u.includes('/functions/v1/sentinel-ndvi-modulo-raster')) {
      const m = JSON.parse(req.postData() || '{}').numero_modulo; ctx.llamadasRaster.push(m);
      await new Promise((r) => setTimeout(r, retrasoMs));
      if (falla.includes(m)) return route.fulfill({ status: 503, contentType: 'application/json', headers: cors, body: JSON.stringify({ error: 'CDSE no responde (simulado)', codigo: 'cdse' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(raster[m]) });
    }
    if (u.includes('/rest/v1/perfiles_usuario')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: uid, rol: 'SRL', modulo_id: '01', nombre: 'QA Playwright (sesión simulada)' }) });
    // El JWT es falso: las lecturas REST van con la anon key, como sin sesión.
    return route.continue({ headers: { ...req.headers(), authorization: `Bearer ${A.KEY}` } });
  });
  return ctx;
}

async function abrirModal(page) {
  await page.getByRole('button', { name: /Informe institucional/ }).click({ timeout: 10000 });
  await page.waitForSelector('.ndvi-cfg', { timeout: 10000 });
  await page.waitForTimeout(350);
  return page.locator('.ndvi-cfg');
}
async function cerrarModal(page) {
  await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  if (await page.locator('.ndvi-cfg').count()) { await page.getByRole('button', { name: 'Cancelar' }).click().catch(() => {}); await page.waitForTimeout(250); }
}

// ── acciones sobre el modal (nombres accesibles reales de ConfigInformeNdviModal) ──
const sel = {
  preset: (n) => (m) => m.getByRole('radio', { name: n, exact: true }).click(),
  desde: (anio, mes) => async (m) => { await m.getByRole('radiogroup', { name: 'Desde: año' }).getByRole('radio', { name: String(anio), exact: true }).click(); await m.getByRole('radiogroup', { name: 'Desde: mes' }).getByRole('radio', { name: `${mes} ${anio}` }).click(); },
  hasta: (anio, mes) => async (m) => { await m.getByRole('radiogroup', { name: 'Hasta: año' }).getByRole('radio', { name: String(anio), exact: true }).click(); await m.getByRole('radiogroup', { name: 'Hasta: mes' }).getByRole('radio', { name: `${mes} ${anio}` }).click(); },
  anioRef: (a) => (m) => m.getByRole('group', { name: 'Años de referencia' }).getByRole('button', { name: String(a), exact: true }).click(),
  modulo: (n) => (m) => m.getByRole('group', { name: 'Módulos' }).getByRole('button', { name: new RegExp(`^Módulo ${n}(?!\\d)`) }).click(),
  soloModulo: (n) => async (m) => { const g = m.getByRole('group', { name: 'Módulos' }); await g.getByRole('button', { name: 'Ninguno' }).click(); await g.getByRole('button', { name: new RegExp(`^Módulo ${n}(?!\\d)`) }).click(); },
  quitaSecciones: (...nombres) => async (m) => { for (const n of nombres) await m.getByRole('checkbox', { name: n }).uncheck(); },
  marca: (n, on = true) => (m) => (on ? m.getByRole('checkbox', { name: n }).check() : m.getByRole('checkbox', { name: n }).uncheck()),
  indicador: (n) => (m) => m.getByRole('group', { name: 'Indicadores opcionales' }).getByRole('button', { name: n, exact: true }).click(),
  base: (n) => (m) => m.getByRole('radio', { name: n }).click(),
  hoja: (n) => (m) => m.getByRole('radio', { name: n, exact: true }).click(),
  compara: (tipo) => (m) => m.getByRole('radio', { name: tipo, exact: true }).click(),
};
const todas = (...fns) => async (m) => { for (const f of fns) await f(m); };

/** Configuraciones del barrido. `ctx` elige el escenario de red. */
const CONFIGS = [
  { id: 'completo', ctx: 'bypass', pdf: true, accion: async () => {} },
  { id: 'solo_resumen', ctx: 'bypass', pdf: true, accion: sel.quitaSecciones(/^Situación/, /^Tendencia y contraste/, /^Comparación entre años/, /^Módulo por módulo/, /^Anexo: serie/, /^Anexo: superficie/, /^Anexos: metodología/) },
  { id: 'sin_relieve', ctx: 'bypass', pdf: true, accion: sel.marca('Plano con relieve', false) },
  { id: 'imagen_falla', ctx: 'bypass', pdf: true, accion: sel.marca('Incluir imagen satelital', true) },
  { id: 'imagen_ok', ctx: 'sesion', pdf: true, accion: sel.marca('Incluir imagen satelital', true), descargaPrimero: true },
  { id: 'imagen_parcial', ctx: 'parcial', pdf: true, accion: sel.marca('Incluir imagen satelital', true) },
  { id: 'mes_unico', ctx: 'bypass', accion: sel.preset('Mes de referencia') },
  { id: 'ultimos3', ctx: 'bypass', accion: sel.preset('Últimos 3 meses') },
  { id: 'm1_ponderado_todos', ctx: 'bypass', accion: todas(sel.soloModulo(1), sel.base('Ponderado por superficie'), sel.indicador('Kc'), sel.indicador('ICV'), sel.indicador('IEHP')) },
  { id: 'anio2025', ctx: 'bypass', accion: todas(sel.desde(2025, 'marzo'), sel.hasta(2025, 'septiembre'), sel.anioRef(2021)) },
  { id: 'comp_modulos', ctx: 'bypass', accion: sel.compara('Módulo vs módulo') },
  { id: 'a4', ctx: 'bypass', accion: sel.hoja('A4') },
  { id: 'sd', ctx: 'sd', accion: async () => {} },
];

/** Genera una configuración por la UI: modal → vista previa → descarga; compara folio y bytes entre vista previa y descarga (y con la descarga desde el modal). */
async function generarPorUI(page, cfg, A, OUT, D) {
  const r = { id: cfg.id, ok: false };
  const modal = await abrirModal(page);
  await cfg.accion(modal);
  await page.waitForTimeout(250);
  const errs = await modal.locator('.ndvi-cfg-err').allTextContents();
  if (errs.length) { A.hallazgo('alto', `${D} ${cfg.id}`, `el modal muestra errores con una configuración válida: ${errs.join(' | ').slice(0, 140)}`); }
  r.resumenModal = (await modal.locator('.ndvi-cfg-resumen').innerText()).trim();
  r.hojasModal = Number((r.resumenModal.match(/(\d+) hojas?/) ?? [])[1]);
  const bajarDesde = async (donde) => {
    const boton = page.getByRole('button', { name: /Descargar HTML|Imágenes \d+\/\d+|Generando/ }).last();
    const esperaDl = page.waitForEvent('download', { timeout: 90000 });
    await boton.click();
    // Progreso visible mientras se piden las imágenes (solo con sesión simulada: hay llamadas lentas).
    const vistos = new Set();
    let fin = false;
    const sondeo = (async () => { while (!fin) { const tx = await page.evaluate(() => [...document.querySelectorAll('.ndvi-cfg-acc button, .ndvi-cfg-estado')].map((e) => e.innerText).join(' | ')).catch(() => ''); const mm = tx.match(/Imágenes( satelitales:)? \d+(\/| de )\d+/g); if (mm) mm.forEach((x) => vistos.add(x)); await page.waitForTimeout(120); } })();
    const dl = await esperaDl; fin = true; await sondeo.catch(() => {});
    const ruta = `${OUT}${D}_${cfg.id}_${donde}.html`;
    await dl.saveAs(ruta);
    return { ruta, nombre: dl.suggestedFilename(), progreso: [...vistos] };
  };
  let dlModal = null;
  const tGen0 = Date.now();
  if (cfg.descargaPrimero) { dlModal = await bajarDesde('modal'); r.progreso = dlModal.progreso; }
  await page.getByRole('button', { name: /Vista previa/ }).click();
  const estadosPrevia = new Set();
  const sond = (async () => { for (let i = 0; i < 160; i++) { const tx = await page.locator('.ndvi-cfg-estado').first().innerText({ timeout: 300 }).catch(() => null); if (tx) { const mm = tx.match(/Imágenes satelitales: \d+ de \d+/); if (mm) estadosPrevia.add(mm[0]); } else if (await page.locator('.ndvi-cfg-marco iframe').count()) break; await page.waitForTimeout(120); } })();
  await page.waitForSelector('.ndvi-cfg-marco iframe', { timeout: 120000 });
  await sond.catch(() => {});
  r.msGeneracion = Date.now() - tGen0;
  await page.waitForTimeout(1500);
  const fr = page.frameLocator('.ndvi-cfg-marco iframe');
  const htmlPrevia = '<!doctype html>' + await fr.locator('html').evaluate((e) => e.outerHTML);
  const textoPrevia = await fr.locator('body').innerText();
  const dlPrevia = await bajarDesde('previa');
  const htmlDesc = fs.readFileSync(dlPrevia.ruta, 'utf8');
  r.archivo = dlPrevia.nombre; r.ruta = dlPrevia.ruta; r.kib = kib(Buffer.byteLength(htmlDesc));
  r.folio = (textoDe(htmlDesc).match(/Folio:? (NDVI-[A-Z0-9-]+)/) ?? [])[1];
  const folioPrevia = (textoDe(htmlPrevia).match(/Folio:? (NDVI-[A-Z0-9-]+)/) ?? [])[1];
  if (!r.folio || r.folio !== folioPrevia) A.hallazgo('alto', `${D} ${cfg.id}`, `folio distinto entre vista previa (${folioPrevia}) y descarga (${r.folio})`);
  const norm = (t) => t.replace(/\s+/g, ' ').trim();
  const textoDesc = textoDe(htmlDesc);
  // Mismo contenido: el texto del iframe (renderizado) contra el texto de la descarga (marcado).
  const sinEspacios = (t) => t.replace(/\s+/g, '');
  const a = sinEspacios(textoDe(htmlPrevia)), b = sinEspacios(textoDesc);
  if (a !== b) A.hallazgo('alto', `${D} ${cfg.id}`, `la vista previa y la descarga no tienen el mismo texto (${a.length} vs ${b.length} caracteres)`);
  if (norm(textoPrevia).length < 500) A.hallazgo('alto', `${D} ${cfg.id}`, 'la vista previa quedó casi vacía');
  // Volver a filtros y descargar desde el modal: mismos bytes.
  if (!cfg.descargaPrimero) {
    await page.getByRole('button', { name: /Volver a filtros/ }).click(); await page.waitForTimeout(400);
    dlModal = await bajarDesde('modal');
  } else {
    await page.getByRole('button', { name: /Volver a filtros/ }).click(); await page.waitForTimeout(400);
  }
  const iguales = fs.readFileSync(dlModal.ruta).equals(fs.readFileSync(dlPrevia.ruta));
  if (!iguales) A.hallazgo('alto', `${D} ${cfg.id}`, 'la descarga desde el modal y desde la vista previa no son el mismo archivo (folio/contenido distinto)');
  if (dlModal.nombre !== dlPrevia.nombre) A.hallazgo('alto', `${D} ${cfg.id}`, `nombres de archivo distintos: ${dlModal.nombre} vs ${dlPrevia.nombre}`);
  r.mismosBytes = iguales;
  r.progresoPrevia = [...estadosPrevia];
  // Nombre de archivo con alcance y periodo.
  if (!/^informe-ndvi-conchos-\d{4}-\d{2}(a\d{2})?-?[a-z0-9-]*\d{4}-\d{2}-\d{2}\.html$/.test(r.archivo)) A.hallazgo('medio', `${D} ${cfg.id}`, `nombre de archivo inesperado: ${r.archivo}`);
  r.ok = true;
  await cerrarModal(page);
  return r;
}

// ── análisis de un HTML descargado: pantalla (1100), móvil (430) e impresión ──
async function analizarHtml(browser, ruta, id, A, OUT, { capturas = false, gris = false, formato = 'letter' } = {}) {
  const html = fs.readFileSync(ruta, 'utf8');
  const r = { id, kib: kib(Buffer.byteLength(html)) };
  const dir = `${OUT}hojas_${id}/`;
  // Pantalla 1100
  let ctx = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  let p = await ctx.newPage();
  await p.setContent(html, { waitUntil: 'load' });
  r.hojas = await p.locator('.pagina').count();
  const txt = await p.locator('body').innerText();
  for (const mal of MALOS_TXT) if (hayMalo(txt, mal)) A.hallazgo('critico', `informe ${id}`, `aparece "${mal}"`);
  if (/\b0\.000\b/.test(textoDe(html).replace(/B − A [■▲▼]? ?[+−]?0\.000/g, '').replace(/diferencia B − A \+0\.000/g, '')) && id === 'sd') A.hallazgo('medio', `informe ${id}`, 'aparece 0.000 con datos sin medir (revisar que no sea un S/D disfrazado)');
  const sinTitulo = await p.evaluate(() => [...document.querySelectorAll('svg[width="100%"]')].filter((s) => !s.querySelector('title') && !s.getAttribute('aria-label')).length);
  if (sinTitulo) A.hallazgo('medio', `informe ${id}`, `${sinTitulo} SVG sin título/etiqueta accesible`);
  if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)) A.hallazgo('alto', `informe ${id}`, 'desborde horizontal a 1100');
  const pies = [...txt.matchAll(/Pág\. (\d+) de (\d+)/gi)].map((m) => Number(m[2]));
  r.paginasPie = pies.length ? Math.max(...pies) : null;
  if (!r.paginasPie || pies.some((x) => x !== r.paginasPie) || r.paginasPie !== r.hojas) A.hallazgo('alto', `informe ${id}`, `numeración "Pág. n de N" inconsistente (${r.hojas} hojas, pies ${[...new Set(pies)]})`);
  await ctx.close();
  // Móvil 430 y 390
  for (const w of [430, 360]) {
    ctx = await browser.newContext({ viewport: { width: w, height: 900 }, isMobile: true });
    p = await ctx.newPage();
    await p.setContent(html, { waitUntil: 'load' });
    const ov = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth - innerWidth, culp: [...document.querySelectorAll('.pagina *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 2 && !e.closest('.tabla-scroll,table,svg')).slice(0, 3).map((e) => String(e.className || e.tagName).slice(0, 30)) }));
    if (ov.doc > 2) A.hallazgo('alto', `informe ${id}`, `desborde horizontal a ${w}: +${ov.doc}px ${JSON.stringify(ov.culp)}`);
    if (id === 'completo' && w === 430) await p.screenshot({ path: `${OUT}movil430_${id}.png`, fullPage: true });
    await ctx.close();
  }
  // Impresión
  const alto = formato === 'a4' ? 1122.52 : 1056, ancho = formato === 'a4' ? 794 : 816;
  ctx = await browser.newContext({ viewport: { width: ancho, height: Math.round(alto) }, deviceScaleFactor: capturas ? 1.6 : 1 });
  p = await ctx.newPage();
  await p.setContent(html, { waitUntil: 'load' });
  await p.emulateMedia({ media: 'print' });
  await p.waitForTimeout(300);
  r.hojasImpresas = await p.evaluate(HOJAS);
  r.desbordes = r.hojasImpresas.filter((h) => h.alto > alto + 1.5 || h.desbordeX > 1).map((h) => ({ hoja: h.n, pxDeMas: +(h.alto - alto).toFixed(1), pxX: h.desbordeX }));
  for (const d of r.desbordes) A.hallazgo(d.pxDeMas > 8 || d.pxX > 4 ? 'alto' : 'medio', `informe ${id}`, `la hoja ${d.hoja} desborda ${d.pxDeMas} px en vertical (${d.pxX} px en horizontal)`);
  await p.pdf({ path: `${OUT}informe_${id}.pdf`, format: formato === 'a4' ? 'A4' : 'Letter', printBackground: true, preferCSSPageSize: true });
  r.paginasPdf = (fs.readFileSync(`${OUT}informe_${id}.pdf`).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  if (r.paginasPdf !== r.paginasPie) A.hallazgo('alto', `informe ${id}`, `el PDF sale en ${r.paginasPdf} páginas físicas y el pie dice ${r.paginasPie}`);
  r.ptHtml = await p.evaluate(PT_HTML);
  if (r.ptHtml.bajo) A.hallazgo('medio', `informe ${id}`, `${r.ptHtml.bajo} elementos de texto HTML < 7.5 pt efectivos: ${JSON.stringify(r.ptHtml.peores.slice(0, 3))}`);
  r.ptSvg = await p.evaluate(A.PT_SVG_TODO);
  if (r.ptSvg.minTexto != null && r.ptSvg.minTexto < 7.45) A.hallazgo('medio', `informe ${id}`, `texto de SVG de ${r.ptSvg.minTexto} pt efectivos (mínimo 7.5): ${JSON.stringify(r.ptSvg.peorTexto)}`);
  const c = await p.evaluate(A.CONTRASTE('body'));
  r.contrasteMalos = c.malos.length;
  if (c.malos.length) A.hallazgo('medio', `informe ${id}`, `contraste < 4.5 en impresión: ${JSON.stringify(c.malos.slice(0, 3))}`);
  const cs = await p.evaluate(A.CONTRASTE_SVG);
  r.contrasteSvgMalos = cs.length;
  if (cs.length) A.hallazgo('medio', `informe ${id}`, `texto de SVG con contraste < 4.5: ${JSON.stringify(cs.slice(0, 3))}`);
  if (capturas) {
    fs.mkdirSync(dir, { recursive: true });
    const hojas = p.locator('.pagina');
    for (let i = 0; i < r.hojas; i++) await hojas.nth(i).screenshot({ path: `${dir}hoja${i + 1}.png` });
  }
  if (gris) {
    await p.addStyleTag({ content: 'html{filter:grayscale(1)!important}' });
    const dg = `${OUT}grises_${id}/`; fs.mkdirSync(dg, { recursive: true });
    const hojas = p.locator('.pagina');
    for (let i = 0; i < r.hojas; i++) await hojas.nth(i).screenshot({ path: `${dg}hoja${i + 1}.png` });
  }
  await ctx.close();
  return r;
}

const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const lstar = (hex) => { const y = lum(hex); return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y; };

export async function barridoInforme(A) {
  const { OUT, res, hallazgo } = A;
  const INF = {};
  A.PT_SVG_TODO = `(() => { const out = []; for (const s of document.querySelectorAll('svg[viewBox]')) { const vb = s.viewBox.baseVal; if (!vb || !vb.width) continue; const k = s.getBoundingClientRect().width / vb.width; if (!k) continue;
    const ti = s.querySelector('title')?.textContent?.slice(0, 40) ?? s.getAttribute('aria-label')?.slice(0, 40) ?? 'svg';
    for (const t of s.querySelectorAll('text')) { if (!t.textContent.trim()) continue; const fs = parseFloat(getComputedStyle(t).fontSize) * k * 0.75; out.push({ ti, pt: +fs.toFixed(2), txt: t.textContent.slice(0, 14) }); } }
    out.sort((a, b) => a.pt - b.pt); return { minTexto: out[0]?.pt ?? null, peorTexto: out[0] ?? null, n: out.length }; })()`;

  // Fixture de rasters sintéticos (PNG de clases discretas). Se genera con vite-node si no existe.
  const fx = `${A.RAIZ}e2e/out/informe-ndvi/rasters_sinteticos.json`;
  if (!fs.existsSync(fx)) execFileSync('npx', ['vite-node', 'e2e/informe-ndvi-rasters.ts'], { cwd: A.RAIZ, shell: true, stdio: 'inherit' });
  const raster = JSON.parse(fs.readFileSync(fx, 'utf8'));

  // ═════════ 1) Modal y flujo por perfil ═════════
  const PERFILES = A.PERFILES_INFORME;
  for (const P of PERFILES) {
    const D = `inf-${P.id}`;
    const browser = await P.motor.launch();
    const grande = P.id === 'chromium-1440';
    const ctxs = {}; // escenarios de red del perfil (solo el principal los usa todos)
    const ctxDe = async (clave) => {
      if (ctxs[clave]) return ctxs[clave];
      const opc = { bypass: {}, sesion: { sesion: true, raster }, parcial: { sesion: true, raster, falla: [3, 12] }, sd: { sd: true } }[clave];
      const ctx = await prepararContexto(browser, P, A, opc);
      const page = await ctx.newPage(); const err = [], net = [];
      A.vigila(page, err, net);
      // El 401/403 de la función raster sin sesión SRL es el comportamiento esperado en local.
      page.on('pageerror', () => {});
      await A.abrirPanel(page);
      ctxs[clave] = { ctx, page, err, net };
      return ctxs[clave];
    };
    const rp = { id: P.id, configs: {} };
    try {
      const { page, err, net } = await ctxDe('bypass');
      const tactil = !!P.ctx.hasTouch;
      // — apertura del modal y chequeos de estructura —
      const modal = await abrirModal(page);
      await page.screenshot({ path: `${OUT}${D}_modal_arriba.png` });
      const dlg = await page.evaluate(() => { const d = document.querySelector('.ndvi-cfg'); const r = d.getBoundingClientRect(); return { role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), foco: d.contains(document.activeElement), izq: Math.round(r.left), der: Math.round(r.right), vw: innerWidth, arr: Math.round(r.top), aba: Math.round(r.bottom), vh: innerHeight, nombre: document.getElementById(d.getAttribute('aria-labelledby'))?.textContent }; });
      rp.dialogo = dlg;
      if (dlg.role !== 'dialog' || dlg.modal !== 'true') hallazgo('alto', D, 'el modal no es role="dialog" aria-modal');
      if (!dlg.foco) hallazgo('alto', D, 'el foco inicial no está dentro del modal');
      if (dlg.izq < -1 || dlg.der > dlg.vw + 1 || dlg.arr < -1 || dlg.aba > dlg.vh + 1) hallazgo('alto', D, `el modal se sale de la pantalla ${JSON.stringify(dlg)}`);
      await A.medidas(page, '.ndvi-cfg-cuerpo', `${D} modal`, rp);
      const ovM = await page.evaluate(() => { const c = document.querySelector('.ndvi-cfg-cuerpo'), d = document.querySelector('.ndvi-cfg'); return { cuerpoX: c.scrollWidth - c.clientWidth, dialogoX: d.scrollWidth - d.clientWidth, pagina: document.documentElement.scrollWidth - innerWidth }; });
      if (ovM.cuerpoX > 2 || ovM.dialogoX > 2 || ovM.pagina > 2) hallazgo('alto', D, `desborde horizontal del modal ${JSON.stringify(ovM)}`);
      // — objetivos táctiles —
      if (tactil) {
        const chicos = await page.evaluate(() => [...document.querySelectorAll('.ndvi-cfg button, .ndvi-cfg label')].map((e) => ({ t: (e.innerText || e.getAttribute('aria-label') || e.tagName).slice(0, 22), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) })).filter((x) => x.h > 0 && x.h < 30));
        if (chicos.length) hallazgo('medio', D, `${chicos.length} controles del modal táctil con menos de 30 px de alto: ${JSON.stringify(chicos.slice(0, 4))}`);
        rp.controlesBajos = chicos.length;
      }
      // — recorrido de controles: cada cambio debe dejar coherente el resumen de hojas y sin desborde —
      const verifica = async (nombre) => {
        const ov = await page.evaluate(() => ({ cuerpoX: document.querySelector('.ndvi-cfg-cuerpo').scrollWidth - document.querySelector('.ndvi-cfg-cuerpo').clientWidth, pagina: document.documentElement.scrollWidth - innerWidth }));
        if (ov.cuerpoX > 2 || ov.pagina > 2) hallazgo('alto', D, `desborde tras «${nombre}»: ${JSON.stringify(ov)}`);
        const tx = await modal.innerText();
        for (const mal of MALOS_TXT) if (hayMalo(tx, mal)) hallazgo('critico', D, `el modal muestra "${mal}" tras «${nombre}»`);
      };
      const hojasTxt = async () => Number(((await modal.locator('.ndvi-cfg-cuenta').innerText()).match(/(\d+) hojas?/) ?? [])[1]);
      const h0 = await hojasTxt();
      await sel.preset('Mes de referencia')(modal); await verifica('mes de referencia');
      const hMes = await hojasTxt();
      await sel.preset('Ciclo completo')(modal); await verifica('ciclo completo');
      await sel.desde(2025, 'marzo')(modal); await verifica('desde 2025-03');
      if ((await modal.getByRole('radio', { name: 'Personalizado' }).getAttribute('aria-checked')) !== 'true') hallazgo('medio', D, 'al elegir un mes a mano el preajuste no pasa a «Personalizado»');
      await sel.hasta(2025, 'septiembre')(modal); await verifica('hasta 2025-09');
      await sel.anioRef(2022)(modal); await verifica('quitar 2022 de referencia');
      await sel.modulo(3)(modal); await sel.modulo(12)(modal); await verifica('quitar M3 y M12');
      const resumenMod = await modal.locator('.ndvi-cfg-resumen').innerText();
      if (!/4 módulos/.test(resumenMod)) hallazgo('alto', D, `el resumen del pie no cuenta 4 módulos tras quitar M3 y M12: "${resumenMod}"`);
      await sel.marca('Plano con relieve', false)(modal); await sel.marca('Incluir imagen satelital', true)(modal); await verifica('interruptores');
      await modal.getByRole('group', { name: 'Módulos' }).getByRole('button', { name: 'Ninguno' }).click(); await page.waitForTimeout(200);
      const errNinguno = await modal.locator('.ndvi-cfg-err').count();
      const vpDesh = await page.getByRole('button', { name: /Vista previa/ }).isDisabled();
      if (!errNinguno || !vpDesh) hallazgo('alto', D, 'sin módulos elegidos el modal no avisa ni deshabilita la vista previa');
      await verifica('sin módulos');
      await modal.getByRole('group', { name: 'Módulos' }).getByRole('button', { name: 'Todos' }).click();
      rp.hojas = { defecto: h0, mesUnico: hMes };
      if (hMes > h0) hallazgo('medio', D, `con «Mes de referencia» el informe tiene más hojas (${hMes}) que el de ciclo completo (${h0})`);
      // — teclado: Tab no escapa del modal, foco visible; Escape cierra y devuelve el foco —
      await page.locator('.ndvi-cfg').focus();
      const focos = []; let fuera = 0;
      for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); const f = await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { dentro: !!e.closest('.ndvi-cfg'), ok: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none', t: (e.getAttribute('aria-label') || e.innerText || e.tagName).slice(0, 20) }; }); if (!f.dentro) fuera++; focos.push(f); }
      rp.tabFuera = fuera;
      if (fuera) hallazgo('alto', D, `Tab sacó el foco del modal ${fuera} veces en 40 pulsaciones`);
      const sinFoco = focos.filter((f) => f.dentro && !f.ok);
      if (sinFoco.length) hallazgo('alto', D, `${sinFoco.length} controles del modal sin indicador de foco: ${JSON.stringify(sinFoco.slice(0, 3))}`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      if (await page.locator('.ndvi-cfg').count()) hallazgo('alto', D, 'Escape no cierra el modal');
      const focoVuelve = await page.evaluate(() => /Informe institucional/i.test(document.activeElement?.innerText || document.activeElement?.getAttribute('aria-label') || ''));
      if (!focoVuelve && P.motor !== webkit) hallazgo('medio', D, 'al cerrar el modal con Escape el foco no vuelve al botón «Informe institucional»');

      // — generación (todas las configuraciones en el perfil grande; en los demás, la de por defecto y un par de variantes) —
      const lista = grande ? CONFIGS : CONFIGS.filter((c) => ['completo', 'mes_unico'].includes(c.id) || (P.id === 'chromium-430' && c.id === 'imagen_ok'));
      for (const cfg of lista) {
        const { page: pg } = await ctxDe(cfg.ctx);
        try { rp.configs[cfg.id] = await generarPorUI(pg, cfg, A, OUT, D); }
        catch (e) { hallazgo('critico', `${D} ${cfg.id}`, 'fallo: ' + String(e.message).slice(0, 200)); await pg.screenshot({ path: `${OUT}${D}_${cfg.id}_fallo.png` }).catch(() => {}); await pg.keyboard.press('Escape'); await pg.keyboard.press('Escape'); }
      }
      // — vista previa a este ancho: captura y sin desborde de la página —
      if (rp.configs.completo?.ok) {
        const m2 = await abrirModal(page); void m2;
        await page.getByRole('button', { name: /Vista previa/ }).click();
        await page.waitForSelector('.ndvi-cfg-marco iframe', { timeout: 60000 }); await page.waitForTimeout(1800);
        await page.screenshot({ path: `${OUT}${D}_previa.png` });
        const ovP = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth - innerWidth, marco: document.querySelector('.ndvi-cfg-marco').scrollWidth - document.querySelector('.ndvi-cfg-marco').clientWidth }));
        if (ovP.pagina > 2) hallazgo('alto', D, `desborde horizontal de la página con la vista previa abierta (+${ovP.pagina}px)`);
        const botones = await page.locator('.ndvi-cfg-barra button').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: (e.innerText || e.getAttribute('aria-label')).slice(0, 20), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; }));
        if (botones.some((b) => b.r > page.viewportSize().width + 1)) hallazgo('alto', D, `botones de la vista previa fuera de pantalla ${JSON.stringify(botones)}`);
        if (tactil && botones.some((b) => b.h < 40)) hallazgo('medio', D, `botones de la vista previa con menos de 40 px de alto ${JSON.stringify(botones.filter((b) => b.h < 40))}`);
        await page.keyboard.press('Escape'); await page.waitForTimeout(400);
        if (!(await page.locator('.ndvi-cfg').count()) || (await page.locator('.ndvi-cfg-marco').count())) hallazgo('medio', D, 'Escape en la vista previa no regresa a los filtros');
        await cerrarModal(page);
      }
      // — sesión simulada: llamadas a la función raster —
      const csn = ctxs.sesion;
      if (csn) rp.llamadasRaster = csn.ctx.llamadasRaster?.length ?? 0;
      for (const [k, c] of Object.entries(ctxs)) {
        if (c.err.length) hallazgo('alto', `${D} ${k}`, `errores de consola: ${JSON.stringify(c.err.slice(0, 3))}`);
        const redMal = c.net.filter((x) => !/sentinel-ndvi-modulo-raster/.test(x));
        if (redMal.length) hallazgo('alto', `${D} ${k}`, `fallos de red: ${JSON.stringify(redMal.slice(0, 3))}`);
      }
    } catch (e) { hallazgo('critico', D, 'fallo del recorrido: ' + String(e.message).slice(0, 220)); }
    res.informePerfiles ??= {}; res.informePerfiles[P.id] = rp;
    INF[P.id] = rp;
    console.log(`· informe ${P.id} listo`);
    await browser.close();
  }

  // ═════════ 2) Análisis del HTML generado (Chromium 1440) ═════════
  const grande = INF['chromium-1440'];
  const tablaPdf = [];
  if (grande) {
    const browser = await chromium.launch();
    for (const cfg of CONFIGS) {
      const g = grande.configs[cfg.id];
      if (!g?.ok) continue;
      try {
        const formato = cfg.id === 'a4' ? 'a4' : 'letter';
        const an = await analizarHtml(browser, g.ruta, cfg.id, A, OUT, { capturas: ['completo', 'imagen_ok', 'imagen_falla', 'solo_resumen', 'sin_relieve', 'imagen_parcial', 'sd', 'mes_unico'].includes(cfg.id), gris: ['completo', 'imagen_ok'].includes(cfg.id), formato });
        Object.assign(g, { analisis: an });
        tablaPdf.push({ config: cfg.id, hojas: an.hojas, pie: an.paginasPie, pdf: an.paginasPdf, kib: an.kib, desbordes: an.desbordes, ptHtmlMin: an.ptHtml.min, ptSvgMin: an.ptSvg.minTexto, contrasteMalos: an.contrasteMalos, ms: g.msGeneracion });
      } catch (e) { hallazgo('critico', `informe ${cfg.id}`, 'fallo en el análisis: ' + String(e.message).slice(0, 200)); }
    }
    await browser.close();
    res.tablaPdf = tablaPdf;
    // Presupuestos de peso
    const kb = (id) => grande.configs[id]?.kib;
    if (kb('solo_resumen') > 40) hallazgo('medio', 'pesos', `solo resumen pesa ${kb('solo_resumen')} KiB (presupuesto ≈27)`);
    if (kb('completo') > 160) hallazgo('medio', 'pesos', `completo con relieve pesa ${kb('completo')} KiB (presupuesto ≈140)`);
    if (kb('imagen_ok') > 260) hallazgo('medio', 'pesos', `con imagen sintética RUIDOSA (20 m, moteado, ~20 % sin dato) pesa ${kb('imagen_ok')} KiB (presupuesto ≤260)`);
    if (kb('sin_relieve') > 108 + 25) hallazgo('medio', 'pesos', `sin relieve pesa ${kb('sin_relieve')} KiB (tope de prueba sin plano/imagen 108)`);
  }

  // ═════════ 3) Imagen satelital: contenido ═════════
  if (grande) {
    const leer = (id) => (grande.configs[id]?.ruta ? fs.readFileSync(grande.configs[id].ruta, 'utf8') : '');
    const hFalla = leer('imagen_falla'), hOk = leer('imagen_ok'), hPar = leer('imagen_parcial');
    const cuenta = (h, re) => (h.match(re) ?? []).length;
    const ver = { falla: {}, ok: {}, parcial: {} };
    ver.falla.avisos = cuenta(hFalla, /Imagen satelital no disponible para 6 de 6 módulos:/g); ver.falla.avisosTarjeta = cuenta(hFalla, /Sin imagen satelital:/g); ver.falla.avisosViejos = cuenta(hFalla, /Imagen no disponible:/g); ver.falla.imagenes = cuenta(hFalla, /<image href="data:image\/png/g);
    if (ver.falla.avisos !== 1 || ver.falla.avisosTarjeta !== 6 || ver.falla.avisosViejos || ver.falla.imagenes) hallazgo('alto', 'imagen_falla', `con la función caída debe haber UN aviso agregado, 6 estados breves por tarjeta y 0 imágenes: ${JSON.stringify(ver.falla)}`);
    if (!/aria-label="Plano del Módulo 1"/.test(hFalla)) hallazgo('alto', 'imagen_falla', 'sin imagen, la tarjeta no conserva el plano vectorial del módulo');
    if (!/sin sesión|no hay sesión/i.test(textoDe(hFalla))) hallazgo('medio', 'imagen_falla', 'el aviso no dice el motivo (sin sesión con permiso)');
    ver.ok.imagenes = cuenta(hOk, /<image href="data:image\/png/g); ver.ok.clip = cuenta(hOk, /clip-path="url\(#mm\d+c\)"/g); ver.ok.avisos = cuenta(hOk, /Imagen satelital no disponible para|Sin imagen satelital:/g);
    ver.ok.pies = cuenta(textoDe(hOk), /pasos? de satélite · \d+ % de píxeles válidos/g);
    if (ver.ok.imagenes !== 6 || ver.ok.clip < 6 || ver.ok.avisos || ver.ok.pies !== 6) hallazgo('alto', 'imagen_ok', `esperadas 6 imágenes recortadas con pie y 0 avisos: ${JSON.stringify(ver.ok)}`);
    ver.parcial.imagenes = cuenta(hPar, /<image href="data:image\/png/g); ver.parcial.avisos = cuenta(hPar, /Imagen satelital no disponible para 2 de 6 módulos:/g); ver.parcial.avisosTarjeta = cuenta(hPar, /Sin imagen satelital:/g);
    if (ver.parcial.imagenes !== 4 || ver.parcial.avisos !== 1 || ver.parcial.avisosTarjeta !== 2) hallazgo('alto', 'imagen_parcial', `con M3 y M12 caídos se esperaban 4 imágenes, 1 aviso agregado y 2 estados breves: ${JSON.stringify(ver.parcial)}`);
    if (!/no respondió/.test(textoDe(hPar))) hallazgo('medio', 'imagen_parcial', 'el aviso de CDSE caído no lo dice');
    const prog = grande.configs.imagen_ok?.progreso ?? [], progP = grande.configs.imagen_ok?.progresoPrevia ?? [];
    ver.progreso = { botonModal: prog, vistaPrevia: progP, llamadas: grande.llamadasRaster };
    if (!prog.some((x) => /Imágenes \d\/6/.test(x))) hallazgo('alto', 'imagen_ok', `el botón «Descargar» no mostró «Imágenes n/6» durante la obtención (vistos: ${JSON.stringify(prog)})`);
    res.imagenVerificacion = ver;
    // Textos genéricos en todos los informes generados
    for (const [id, g] of Object.entries(grande.configs)) {
      if (!g?.ok) continue;
      const h = fs.readFileSync(g.ruta, 'utf8'); const t = textoDe(h);
      if (/porque|debido a|a causa de|causad[oa] por|se debe a|por culpa de|provocad[oa] por|originad[oa] por/i.test(t.replace(/no se explica solo|puede reflejar|no (prueba|indica) (una |la )?causa|no prueban una causa|porque miden cosas distintas|se usa la media y no el pico porque/gi, ''))) hallazgo('alto', `informe ${id}`, 'el texto parece afirmar una causa: ' + (t.match(/.{50}(porque|debido a|a causa de|causad[oa] por|se debe a|por culpa de).{50}/i) ?? [''])[0]);
      const tit = h.match(/<p class="frase titular">[\s\S]{0,700}?<\/div>/);
      if (!tit || !/class="aviso cautela"/.test(tit[0])) hallazgo('alto', `informe ${id}`, 'el titular de la hoja 1 no lleva su cautela justo debajo');
      if (!/Cautela:/.test(tit?.[0] ?? '')) hallazgo('alto', `informe ${id}`, 'la cautela del titular no dice «Cautela:»');
    }
  }

  // ═════════ 4) Escala de grises y daltonismo ═════════
  {
    const rampa = fs.readFileSync(`${A.RAIZ}src/utils/ndviRampa.ts`, 'utf8');
    const clases = [...rampa.matchAll(/clave: '(\w+)', etiqueta: '([^']+)'[^}]*?color: '(#[0-9A-Fa-f]{6})'/g)].map((m) => ({ clave: m[1], etiqueta: m[2], color: m[3], Y: lum(m[3]), L: lstar(m[3]) }));
    const pares = clases.slice(1).map((c, i) => ({ par: `${clases[i].etiqueta} / ${c.etiqueta}`, razon: +((Math.max(c.Y, clases[i].Y) + 0.05) / (Math.min(c.Y, clases[i].Y) + 0.05)).toFixed(2), dL: +Math.abs(c.L - clases[i].L).toFixed(1) }));
    const sd = '#e9e7e2';
    res.grises = { clases: clases.map((c) => ({ ...c, Y: +c.Y.toFixed(3), L: +c.L.toFixed(1) })), pares, sdContraSuelo: +((Math.max(lum(sd), clases[0].Y) + 0.05) / (Math.min(lum(sd), clases[0].Y) + 0.05)).toFixed(2) };
    for (const p of pares) if (p.razon < 1.25) hallazgo('medio', 'grises', `clases adyacentes casi iguales en grises: ${p.par} razón de luminancia ${p.razon} (ΔL* ${p.dL}); no se puede cambiar CLASES_NDVI (la función raster lo compara): decisión pendiente`);
    // Formas de los 6 módulos: todas distintas.
    const marcas = fs.readFileSync(`${A.RAIZ}src/utils/informeNdviMarcas.ts`, 'utf8');
    const trazos = [...marcas.matchAll(/TRAZO_MODULO[^=]*=\s*\{([^}]+)\}/g)][0]?.[1] ?? '';
    res.grises.trazos = trazos.trim();
    const simbolos = fs.readFileSync(`${A.RAIZ}src/utils/ndviGrafica.ts`, 'utf8').match(/SIMBOLO_MODULO[^=]*=\s*\{([^}]+)\}/)?.[1] ?? '';
    const formas = [...simbolos.matchAll(/(\d+):\s*'(\w+)'/g)].map((m) => `${m[1]}:${m[2]}`);
    res.grises.formas = formas;
    if (new Set(formas.map((f) => f.split(':')[1])).size !== 6) hallazgo('alto', 'grises', `los 6 módulos no tienen 6 formas distintas: ${formas}`);
  }

  // ═════════ 5) Cifras contra la BD viva ═════════
  if (grande?.configs.completo?.ok) await cifrasContraBD(A, grande);
  return { INF, tablaPdf };
}

// ───────────────────────── cifras ─────────────────────────
async function cifrasContraBD(A, grande) {
  const { cifra, hallazgo } = A;
  const filas = await A.rest('ndvi_modulo_mensual_v2?select=numero_modulo,mes,ndvi_mediana,superficie_ha&metodo=eq.scl-mediana-v1&order=mes&limit=5000');
  const MODS = [1, 2, 3, 4, 5, 12];
  const v = (m, mes) => filas.find((x) => x.numero_modulo === m && x.mes === mes)?.ndvi_mediana ?? null;
  const sup = (m, mes) => filas.find((x) => x.numero_modulo === m && x.mes === mes)?.superficie_ha ?? null;
  const media = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const sg = (x, d = 3) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(d)}`;
  const MM = ['03', '04', '05', '06', '07', '08', '09'];
  const srl = (mes) => media(MODS.map((m) => v(m, mes)).filter((x) => x != null));
  const AN = [2021, 2022, 2023, 2024, 2025, 2026];
  const T = textoDe(fs.readFileSync(grande.configs.completo.ruta, 'utf8'));
  const tiene = (nombre, esperado) => { const ok = T.includes(esperado); A.res.cifras.push({ cifra: nombre, bd: esperado, pantalla: ok ? esperado : '(no aparece)', ok }); if (!ok) hallazgo('critico', 'cifras informe', `${nombre}: no aparece «${esperado}»`); };

  const sep = srl('2026-09'), ago = srl('2026-08');
  const pond = MODS.reduce((s, m) => s + v(m, '2026-09') * sup(m, '2026-09'), 0) / MODS.reduce((s, m) => s + sup(m, '2026-09'), 0);
  tiene('Promedio SRL sep-2026 (simple) y Δ vs agosto', `septiembre 2026: ${sep.toFixed(2)} (`);
  tiene('Δ del promedio SRL sep vs ago 2026', `${sg(sep - ago)} frente a agosto 2026`);
  tiene('Promedio SRL sep-2026 ponderado por superficie', `Ponderado por superficie: ${pond.toFixed(2)}`);
  // Habitual: media del periodo vs promedio de cada mes en los otros años.
  const per = media(MM.map((t) => srl(`2026-${t}`)));
  const hab = media(MM.map((t) => media([2021, 2022, 2023, 2024, 2025].map((a) => srl(`${a}-${t}`)))));
  tiene('Media del periodo, habitual, diferencia y % (promedio SRL)', `${per.toFixed(2)} contra ${hab.toFixed(2)} (${sg(per - hab)}, ${sg(((per - hab) / hab) * 100, 1)} %)`);
  const mayor = MODS.map((m) => [m, v(m, '2026-09')]).sort((a, b) => b[1] - a[1]);
  tiene('Mayor y menor vigor de septiembre', `Módulo ${mayor[0][0]} (${mayor[0][1].toFixed(2)}); menor vigor: Módulo ${mayor.at(-1)[0]} (${mayor.at(-1)[1].toFixed(2)})`);
  // Diferencia de cada módulo frente a lo habitual (fila de la tabla)
  for (const m of [1, 2, 5]) {
    const p = media(MM.map((t) => v(m, `2026-${t}`)));
    const h = media(MM.map((t) => media([2021, 2022, 2023, 2024, 2025].map((a) => v(m, `${a}-${t}`)))));
    tiene(`Módulo ${m}: NDVI del periodo, habitual y diferencia`, `Módulo ${m} ${p.toFixed(2)} ${h.toFixed(2)} ${p - h < 0 ? '▼' : '▲'} ${sg(p - h)}`);
  }
  // Pico por año (tabla de comparación entre años)
  for (const a of [2021, 2024, 2026]) {
    const picos = MODS.map((m) => Math.max(...MM.map((t) => v(m, `${a}-${t}`)).filter((x) => x != null)));
    tiene(`Pico por año ${a} (6 módulos y promedio SRL)`, `${a} ${picos.map((x) => x.toFixed(3)).join(' ')} ${media(picos).toFixed(3)}`);
  }
  const picosAnio = (a) => media(MODS.map((m) => Math.max(...MM.map((t) => v(m, `${a}-${t}`)))));
  tiene('2026 vs otros años (pico, promedio SRL)', sg(picosAnio(2026) - media([2021, 2022, 2023, 2024, 2025].map(picosAnio))));
  // Media de temporada de un módulo (anexo B)
  const mediaTemp = (m, a) => media(MM.map((t) => v(m, `${a}-${t}`)));
  tiene('Media de NDVI de la temporada, Módulo 1 (2021–2026)', `Módulo 1 ${AN.map((a) => mediaTemp(1, a).toFixed(3)).join(' ')}`);
  // Δ de M1 vs agosto en su ficha
  const dM1 = v(1, '2026-09') - v(1, '2026-08');
  tiene('Ficha de M1: Δ vs agosto', `${dM1 >= 0 ? '▲' : '▼'} ${sg(dM1)} vs agosto 2026`);
  // Contraste contra 2025 (diferencia B − A de M3)
  const a3 = media(MM.map((t) => v(3, `2025-${t}`))), b3 = media(MM.map((t) => v(3, `2026-${t}`)));
  tiene('Contraste 2025 vs 2026, Módulo 3 (A, B, B − A)', `Módulo 3 ${a3.toFixed(2)} ${b3.toFixed(2)} ${b3 - a3 >= 0 ? '▲' : '▼'} ${sg(b3 - a3)}`);
  tiene('Módulos con dato', '6 de 6 módulos con dato');
  // Superficie y volumen anual (anexo B) del Módulo 1 y 4
  const sv = await A.rest('superficie_volumen_anual_modulo?select=anio,numero_modulo,superficie_ha,volumen_miles_m3&limit=2000');
  const fmtEn = (n) => Math.round(n).toLocaleString('en-US');
  for (const m of [1, 12]) {
    const porAnio = (a, campo) => sv.filter((x) => x.anio === a && x.numero_modulo === m).reduce((s, x) => s + (x[campo] ?? 0), 0);
    const hay = (a) => sv.some((x) => x.anio === a && x.numero_modulo === m);
    const celdas = (f) => [2021, 2022, 2023, 2024, 2025, 2026].map((a) => (hay(a) ? f(a) : 'S/D'));
    const m1sup = celdas((a) => fmtEn(porAnio(a, 'superficie_ha'))), vol = celdas((a) => (porAnio(a, 'volumen_miles_m3') / 1000).toFixed(1));
    // El marcador ⚠ (captura atípica) puede ir tras la cifra: se acepta con o sin él.
    const re = (cel) => new RegExp(`Módulo ${m} ${cel.map((c) => `${escRe(c)}( ⚠)?`).join(' ')}`);
    for (const [nombre, cel] of [[`Superficie regada anexo B, Módulo ${m}`, m1sup], [`Volumen entregado anexo B (hm³), Módulo ${m}`, vol]]) {
      const ok = re(cel).test(T);
      A.res.cifras.push({ cifra: nombre, bd: cel.join(' | '), pantalla: ok ? cel.join(' | ') : '(no coincide)', ok });
      if (!ok) hallazgo('critico', 'cifras informe', `${nombre}: no coincide con ${cel.join(' ')}`);
    }
  }
  // n de módulos con dato en el escenario S/D (M3 sin septiembre): 5 de 6
  const gsd = grande.configs.sd;
  if (gsd?.ok) {
    const Tsd = textoDe(fs.readFileSync(gsd.ruta, 'utf8'));
    const sd5 = media([1, 2, 4, 5, 12].map((m) => v(m, '2026-09')));
    for (const [n, e] of [['S/D simulado: módulos con dato', '5 de 6 módulos con dato'], ['S/D simulado: promedio SRL de septiembre con 5 módulos', `septiembre 2026: ${sd5.toFixed(2)} (`]]) {
      const ok = Tsd.includes(e); A.res.cifras.push({ cifra: n, bd: e, pantalla: ok ? e : '(no aparece)', ok }); if (!ok) hallazgo('critico', 'cifras informe', `${n}: no aparece «${e}»`);
    }
    if (!/Módulo 3[^]{0,200}S\/D/.test(Tsd)) hallazgo('alto', 'informe sd', 'la ficha o tabla del Módulo 3 sin dato de septiembre no dice S/D');
  }
}
