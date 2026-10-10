// SICA Conservación · Centro de revisión, «Abrir tramo» y barra de contexto (Playwright, solo lectura).
//   Uso:  node e2e/conservacion-revision.mjs [desktop|ipad|iphone|all]     (requiere `npm run dev` en :5173; la carpeta de PacOT se lee sola)
// Mide: clics y scroll hasta ver la ecuación del primer atípico, «Abrir tramo» desde Verificación/Tramos/Hallazgos, barra de contexto
// (visible tras el scroll), tramo con dos razones agrupado, drenes y caminos sin vocabulario de canal, texto >= 12 px, objetivos >= 44 px,
// desbordes, foco por teclado y errores de consola/red. Capturas en e2e/out/rev_<vp>_*.png. Sale con código 1 si algo falla.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const OUT = new URL('./out/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const raiz = fileURLToPath(new URL('../', import.meta.url));
const sel = process.argv.find((a) => ['desktop', 'ipad', 'iphone', 'all'].includes(a)) ?? 'all';
const VPS = {
  desktop: { viewport: { width: 1440, height: 900 }, opts: {} },
  ipad: { viewport: { width: 1180, height: 820 }, opts: { hasTouch: true } },
  iphone: { viewport: { width: 440, height: 956 }, opts: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
};
const IGNORE = /AUTH_BYPASS|WebSocket|realtime|\[vite\]|DevTools|favicon|supabase/i;
const informes = fs.existsSync(path.join(raiz, 'informes-conservacion')) ? fs.readdirSync(path.join(raiz, 'informes-conservacion')).filter((x) => /^informe-.*\.json$/.test(x)).sort() : [];
const informe = informes.length ? path.join(raiz, 'informes-conservacion', informes[informes.length - 1]) : null;

const fallos = [];
const verifica = (nombre, cond, detalle = '') => { if (!cond) fallos.push(`${nombre}${detalle ? ` · ${detalle}` : ''}`); return cond; };

const browser = await chromium.launch();
const resumen = {};
for (const nombre of sel === 'all' ? Object.keys(VPS) : [sel]) {
  const vp = VPS[nombre];
  const esPhone = vp.viewport.width <= 600;
  const ctx = await browser.newContext({ viewport: vp.viewport, serviceWorkers: 'block', ...vp.opts });
  const page = await ctx.newPage();
  const errores = [], red = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !IGNORE.test(m.text())) errores.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => errores.push(`pageerror: ${String(e.message).slice(0, 200)}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon|\.map$|supabase/.test(r.url())) red.push(`${r.status()} ${r.url().slice(0, 100)}`); });
  const foto = async (n) => { await page.waitForTimeout(700); await page.screenshot({ path: fileURLToPath(new URL(`rev_${nombre}_${n}.png`, OUT)) }); };
  const rec = {};
  const quien = (t) => `${nombre} · ${t}`;

  const cargar = async () => {
    await page.goto('http://localhost:5173/conservacion?seccion=derivacion', { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await page.waitForSelector('.cons-der-slots', { timeout: 120000 }).catch(() => { rec.sinCarga = true; });
  };
  await page.addInitScript(() => { try { sessionStorage.clear(); } catch { /* sin almacenamiento */ } });
  await cargar();

  // Un clic «real»: cuenta, y comprueba que el botón ya estaba a la vista (sin scroll previo).
  let clics = 0; const sinScroll = [];
  const clic = async (loc, etiqueta) => {
    const r = await loc.boundingBox();
    const dentro = r !== null && r.y >= 0 && r.y + r.height <= vp.viewport.height + 1;
    sinScroll.push(`${etiqueta}:${dentro ? 'a la vista' : `FUERA (y=${Math.round(r?.y ?? -1)})`}`);
    await loc.click(); clics++;
  };
  // En teléfono la barra se colapsa a una línea (oculta PacOT y red): el texto completo sigue en el DOM.
  const barraTexto = () => page.locator('.cc-barra').evaluate((el, completo) => (completo ? el.textContent : el.innerText), esPhone);
  const medirEc = () => page.evaluate(() => {
    const e = document.querySelector('.cc-raiz .cons-ec'); const r = e?.getBoundingClientRect();
    const m = document.querySelector('.main-content'); const b = document.querySelector('.cc-barra')?.getBoundingClientRect();
    return { top: r ? Math.round(r.top) : null, bottom: r ? Math.round(r.bottom) : null, alto: innerHeight, scrollMain: m ? Math.round(m.scrollTop) : null, barraTop: b ? Math.round(b.top) : null, barraAlto: b ? Math.round(b.height) : null };
  });
  const abrirDesdeCentro = async (etiqueta) => {
    await clic(page.getByRole('tab', { name: /^Revisión/ }), 'pestaña Revisión');
    await page.waitForSelector('.cr-fila', { timeout: 60000 });
    await clic(page.locator('.cr-fila .cr-abrir').first(), 'Abrir tramo');
    await page.waitForSelector('.cc-raiz .cons-ec', { timeout: 20000 });
    await page.waitForTimeout(350);
    rec[etiqueta] = { clics, sinScroll: [...sinScroll], ...(await medirEc()) };
  };

  // ── A. Primer atípico del ciclo: ≤2 clics y la ecuación a la vista ──
  await abrirDesdeCentro('primerAtipico');
  const A = rec.primerAtipico;
  verifica(quien('primer atípico en ≤2 clics'), A.clics <= 2, `clics=${A.clics}`);
  verifica(quien('los dos clics sin scroll previo'), A.sinScroll.every((s) => s.includes('a la vista')), A.sinScroll.join(' | '));
  if (!esPhone) verifica(quien('ecuación visible sin scroll inicial'), A.top !== null && A.top >= 0 && A.bottom <= A.alto, `top=${A.top} bottom=${A.bottom} de ${A.alto}`);
  else {
    // En teléfono se admite un scroll corto: se mide cuánto hace falta.
    const falta = Math.max(0, (A.bottom ?? 0) - A.alto + 24);
    rec.scrollCortoTelefono = falta;
    verifica(quien('ecuación tras un scroll corto (≤ 600 px)'), A.top !== null && falta <= 600, `falta=${falta}`);
    await page.evaluate((px) => document.querySelector('.main-content')?.scrollBy(0, px), falta);
    const despues = await medirEc();
    verifica(quien('ecuación a la vista tras el scroll corto'), despues.top !== null && despues.bottom <= despues.alto, JSON.stringify(despues));
  }
  rec.barra = await barraTexto();
  await foto('3_ficha_contexto');

  // ── B. La barra de contexto sigue visible al bajar ──
  const antes = await page.evaluate(() => document.querySelector('.main-content')?.scrollTop ?? 0);
  await page.evaluate(() => document.querySelector('.main-content')?.scrollBy(0, 900));
  await page.waitForTimeout(200);
  const tras = await page.evaluate(() => { const b = document.querySelector('.cc-barra')?.getBoundingClientRect(); const tb = document.querySelector('.mobile-topbar')?.getBoundingClientRect(); return { top: b ? Math.round(b.top) : null, bottom: b ? Math.round(b.bottom) : null, h: b ? Math.round(b.height) : null, topbarBottom: tb ? Math.round(tb.bottom) : 0, scroll: document.querySelector('.main-content')?.scrollTop ?? 0 }; });
  rec.barraTrasScroll = tras;
  verifica(quien('el scroll bajó'), tras.scroll > antes + 50, JSON.stringify(tras));
  verifica(quien('barra de contexto visible tras el scroll y bajo la cabecera de la app'), tras.top !== null && tras.top >= tras.topbarBottom - 1 && tras.top <= tras.topbarBottom + 12 && tras.h <= 56, JSON.stringify(tras));
  verifica(quien('barra de una sola línea'), tras.h !== null && tras.h <= 56, `h=${tras.h}`);
  await foto('4_barra_tras_scroll');

  // ── C. Teclado y foco en «Abrir tramo» ──
  await page.getByRole('tab', { name: /^Revisión/ }).click();
  await page.waitForSelector('.cr-fila');
  await page.focus('#cr-raz');
  await page.keyboard.press('Tab');
  rec.focoVisible = await page.evaluate(() => { const el = document.activeElement; const s = getComputedStyle(el); return { esAbrir: el.classList.contains('cr-abrir'), match: el.matches(':focus-visible'), outline: s.outlineStyle, ancho: s.outlineWidth }; });
  verifica(quien('Tab llega a «Abrir tramo» con foco visible'), rec.focoVisible.esAbrir && rec.focoVisible.match && rec.focoVisible.outline !== 'none' && parseFloat(rec.focoVisible.ancho) >= 2, JSON.stringify(rec.focoVisible));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.cc-raiz .cons-ec', { timeout: 20000 });
  verifica(quien('Abrir tramo operable con teclado'), (await page.locator('.cc-barra').count()) === 1);

  // ── D. Tramo con dos razones: SRL fila 55 (K-68+720 → K-70+000) ──
  await page.getByRole('tab', { name: /^Revisión/ }).click();
  await page.waitForSelector('.cr-fila');
  await page.selectOption('#cr-amb', 'SRL');
  const filas7068 = page.locator('.cr-fila', { hasText: 'K-68+720 → K-70+000' });
  rec.filasK68720 = await filas7068.count();
  verifica(quien('K-68+720 → K-70+000 aparece UNA vez en el Centro'), rec.filasK68720 === 1, `n=${rec.filasK68720}`);
  if (rec.filasK68720 >= 1) {
    const f = filas7068.first();
    rec.chipsK68720 = await f.locator('.cons-der-base').allInnerTexts();
    verifica(quien('el tramo K-68+720 trae sus dos razones (criterio y control adicional)'), rec.chipsK68720.includes('Por criterio') && rec.chipsK68720.includes('Control adicional'), rec.chipsK68720.join(','));
    verifica(quien('cada razón con su cifra'), (await f.locator('.cr-cifras').count()) >= 2);
    await f.scrollIntoViewIfNeeded();
    await foto('5_centro_dos_razones');
    await f.locator('.cr-abrir').click();
    await page.waitForSelector('.cc-raiz .cons-ec');
    rec.barraK68720 = await barraTexto();
    verifica(quien('barra con PacOT › red › concepto › tramo'), /SRL Unidad Conchos[\s\S]*Red de distribución[\s\S]*Desazolve[\s\S]*K-68\+720 → K-70\+000/.test(rec.barraK68720), rec.barraK68720);
    verifica(quien('la ficha lo dice «por criterio»'), /Atípico[\s\S]*por criterio/i.test(rec.barraK68720));
    const otra = page.locator('.cc-otra');
    verifica(quien('la ficha enlaza la otra razón (descopete)'), (await otra.count()) >= 1 && /Terracerías \(descopete\)/.test(await otra.first().innerText()));
    await foto('6_ficha_desazolve_con_otra');
    if (await otra.count()) {
      await otra.first().click();
      await page.waitForTimeout(250);
      const b2 = await barraTexto();
      verifica(quien('al pasar a la otra razón el tramo sigue siendo K-68+720'), /Terracerías \(descopete\)[\s\S]*K-68\+720 → K-70\+000/.test(b2) && /control adicional/i.test(b2), b2);
      const est = await page.locator('.cc-estados').innerText();
      verifica(quien('«Sigue el criterio» y «Atípico» separados con su razón'), /Criterio del libro[\s\S]*Coherente/.test(est) && /Controles adicionales[\s\S]*Atípico/.test(est), est);
      verifica(quien('una línea dice cuál control y por qué'), /descopete excede al desazolve/i.test(await page.locator('.cc-razon').innerText()));
      await foto('7_ficha_control_adicional');
    }
  }

  // ── E. Drenes y caminos: sin vocabulario de canal ──
  const sinCanalismo = async (rotulo) => {
    const t = await page.locator('.cc-raiz').innerText();
    verifica(quien(`${rotulo}: sin «Recorrido del canal»`), !/Recorrido del canal/.test(t));
    verifica(quien(`${rotulo}: sin «ramal auxiliar»`), !/ramal auxiliar/i.test(t));
    verifica(quien(`${rotulo}: sin leyenda de estructuras`), (await page.locator('.cc-raiz .cons-leyenda-estructuras, .cc-raiz [aria-label="Filtrar el perfil por familia de estructuras"]').count()) === 0);
  };
  for (const [ambito, redTxt, titulo] of [['SRL', 'Red de caminos', 'Recorrido del camino'], ['M5', 'Red de drenaje', 'Recorrido del dren'], ['M5', 'Red de caminos', 'Recorrido del camino']]) {
    await page.getByRole('tab', { name: /^Revisión/ }).click();
    await page.waitForSelector('.cr-fila');
    const optAmb = await page.locator('#cr-amb option').allInnerTexts();
    const val = optAmb.find((o) => (ambito === 'SRL' ? /SRL/.test(o) : /Módulo 5/.test(o)));
    if (!val) { rec[`sin_${ambito}`] = true; continue; }
    await page.selectOption('#cr-amb', { label: val });
    const optRed = await page.locator('#cr-red option').allInnerTexts();
    if (!optRed.includes(redTxt)) { rec[`sinAtipicos_${ambito}_${redTxt}`] = true; continue; }
    await page.selectOption('#cr-red', { label: redTxt });
    // T-01 (2026-10-10): los caminos de la SRL ya no salen como atípicos «difiere 100 %» (el grupo de 1 tramo no se compara; se declara el modelo en el registro).
    const nFilasRed = await page.locator('.cr-fila').count();
    if (ambito === 'SRL' && redTxt === 'Red de caminos') {
      rec.srlCaminosEnCentro = nFilasRed;
      verifica(quien('SRL · Red de caminos: 0 tramos atípicos en el Centro (T-01)'), nFilasRed === 0, `filas=${nFilasRed}`);
      verifica(quien('SRL · el Centro no menciona «CAMINO CANAL» ni «difiere 100 %»'), !/CAMINO CANAL|difiere 100/i.test(await page.locator('.cr').innerText()));
      await page.selectOption('#cr-red', { label: 'Todas' });
      continue;
    }
    if (nFilasRed === 0) { verifica(quien(`${ambito} ${redTxt}: tiene atípicos que abrir`), false, 'filas=0'); continue; }
    await page.locator('.cr-fila .cr-abrir').first().click();
    await page.waitForSelector('.cc-raiz .cons-ec, .cc-raiz .cons-comp-ficha');
    await page.waitForTimeout(250);
    const txt = await page.locator('.cc-tira').innerText().catch(() => '');
    verifica(quien(`${ambito} ${redTxt}: título «${titulo}»`), txt.includes(titulo), txt.slice(0, 80));
    await page.getByRole('button', { name: /Ver perfil completo/ }).click();
    await page.waitForTimeout(250);
    await sinCanalismo(`${ambito} ${redTxt}`);
    if (ambito === 'M5' && redTxt === 'Red de drenaje') await foto('8_m5_dren_perfil');
  }

  // ── F. «Abrir tramo» desde Verificación y Tramos ──
  await page.getByRole('tab', { name: /^Verificación/ }).click();
  await page.waitForSelector('.cons-h');
  const cartaCon = page.locator('.cons-h', { has: page.locator('.cr-abrir') }).first();
  rec.verifTarjetasConBoton = await page.locator('.cons-h .cr-abrir').count();
  rec.verifTarjetasTotal = await page.locator('.cons-h').count();
  if (rec.verifTarjetasConBoton > 0) {
    const txtCarta = await cartaCon.locator('summary').innerText();
    const fila = (/DIAG-01 fila (\d+)/.exec(txtCarta) ?? [])[1];
    await cartaCon.locator('.cr-abrir').click();
    await page.waitForSelector('.cc-raiz .cons-comp-ficha');
    const aria = await page.locator('.cons-comp-ficha').first().getAttribute('aria-label');
    verifica(quien('Verificación → Abrir tramo deja la fila correcta'), aria !== null && new RegExp(`fila ${fila}\\b`).test(aria), `fila=${fila} aria=${aria}`);
    verifica(quien('Verificación → barra de contexto presente'), (await page.locator('.cc-barra').count()) === 1);
  } else verifica(quien('Verificación tiene tarjetas con Abrir tramo'), false, `0 de ${rec.verifTarjetasTotal}`);

  await page.getByRole('tab', { name: /^Tramos/ }).click();
  await page.waitForSelector('.cons-der-obra');
  await page.locator('.cons-der-obra summary').first().click();
  const btnTr = page.locator('.cons-der-obra[open] .cr-abrir').first();
  if (await btnTr.count()) {
    const filaTxt = await btnTr.locator('xpath=ancestor::tr').locator('td').first().innerText();
    const estadoTxt = await btnTr.locator('xpath=ancestor::tr').locator('td').nth(5).innerText();
    rec.tramosFila = { pk: filaTxt, estado: estadoTxt.replace(/\n/g, ' ') };
    verifica(quien('Tramos: la columna Verificación muestra el estado real, no «—»'), /Coherente|Atípico|No evaluable/.test(estadoTxt), estadoTxt);
    await foto('9_tramos');
    await btnTr.click();
    await page.waitForSelector('.cc-raiz .cons-comp-ficha');
    const pkBarra = await page.locator('.cc-pk').innerText();
    verifica(quien('Tramos → Ver cálculo abre el mismo tramo'), pkBarra.replace(/\s/g, '') === filaTxt.replace(/\s/g, ''), `${pkBarra} vs ${filaTxt}`);
  } else verifica(quien('Tramos tiene «Ver cálculo»'), false);

  // ── G. Cadena: «Ver cálculo por tramo» ──
  await page.getByRole('tab', { name: /^Cadena de cálculo/ }).click();
  await page.waitForSelector('.cons-der-cadena');
  const optDes = (await page.locator('#cons-cad-con option').allInnerTexts()).find((t) => /Desazolve/.test(t));
  if (optDes) { await page.selectOption('#cons-cad-con', { label: optDes }); await page.waitForTimeout(300); }
  const bCad = page.locator('.cons-der-verif .cr-abrir');
  rec.cadenaBotones = await bCad.count();
  if (rec.cadenaBotones > 0) {
    await bCad.first().click();
    await page.waitForSelector('.cc-raiz .cons-comp-ficha');
    verifica(quien('Cadena → abre la comprobación por tramo'), (await page.locator('.cc-barra').count()) === 1);
  } else rec.cadenaSinCriterios = true;

  // ── H. Hallazgos de «Comprobación de reglas» → «Ver en derivación» ──
  if (informe) {
    await page.goto('http://localhost:5173/conservacion', { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await page.waitForSelector('.cons-zona input[type=file]', { state: 'attached', timeout: 20000 }).catch(() => {});
    await page.setInputFiles('.cons-zona input[type=file]', informe).catch(() => {});
    await page.waitForSelector('#cons-tab-hallazgos', { timeout: 15000 }).catch(() => { rec.sinInforme = true; });
    if (!rec.sinInforme) {
      await page.locator('#cons-tab-hallazgos').click();
      await page.waitForSelector('.cons-h');
      rec.hallazgos = { total: await page.locator('.cons-h').count(), conEnlace: await page.locator('.cons-h .cr-abrir').count() };
      rec.hallazgos.primero = (await page.locator('.cons-h-fila').first().innerText()).replace(/\s+/g, ' ').slice(0, 60);
      for (const [etiqueta, busca, espera] of [['3DN', '3DN!', 'cadena'], ['IO1', 'IO1!', 'tramo']]) {
        await page.goto('http://localhost:5173/conservacion', { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
        await page.setInputFiles('.cons-zona input[type=file]', informe);
        await page.waitForSelector('#cons-tab-hallazgos', { timeout: 15000 });
        await page.locator('#cons-tab-hallazgos').click();
        await page.waitForSelector('#cons-f-q', { timeout: 15000 });
        await page.fill('#cons-f-q', busca);
        await page.waitForTimeout(300);
        const botones = page.locator('.cons-h .cr-abrir');
        rec.hallazgos[`enlaces_${etiqueta}`] = await botones.count();
        if (!(await botones.count())) { verifica(quien(`Hallazgos con celdas ${etiqueta} traen «Ver en derivación»`), false); continue; }
        if (etiqueta === '3DN') await foto('10_hallazgos');
        await botones.first().click();
        await page.waitForSelector('[aria-label="Secciones de la derivación"]', { timeout: 120000 });
        await page.waitForTimeout(2500);
        if (espera === 'cadena') {
          const tabSel = await page.getByRole('tab', { name: /^Cadena de cálculo/ }).getAttribute('aria-selected');
          rec.hallazgos[`resultado_${etiqueta}`] = `cadena seleccionada=${tabSel}`;
          verifica(quien('Hallazgo 3DN → Ver en derivación abre la cadena de cálculo'), tabSel === 'true' && (await page.locator('.cons-der-cadena').count()) === 1);
        } else {
          const hay = (await page.locator('.cc-barra').count()) === 1;
          rec.hallazgos[`resultado_${etiqueta}`] = hay ? `barra: ${(await page.locator('.cc-barra').innerText()).replace(/\s+/g, ' ')}` : `aviso: ${(await page.locator('.sc-aviso').first().innerText().catch(() => '')).slice(0, 140)}`;
          verifica(quien('Hallazgo IO1 → Ver en derivación abre un tramo'), hay, rec.hallazgos[`resultado_${etiqueta}`]);
        }
      }
    }
  }

  // ── I. Medidas de legibilidad en lo que se tocó ──
  const medir = (secciones) => page.evaluate((sels) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const chico = [], peq = [];
    for (const sel of sels) document.querySelectorAll(sel).forEach((raiz) => {
      raiz.querySelectorAll('*').forEach((el) => {
        if (el.closest('svg, .pf, .scada-action-btn, .cons-comp-ficha .cons-ec, .cons-comp-dibujo')) return;
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
        if (!vis(el)) return;
        const px = parseFloat(getComputedStyle(el).fontSize);
        if (px < 11.95) chico.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 22)} ${px}px "${el.textContent.trim().slice(0, 18)}"`);
      });
      raiz.querySelectorAll('button, select, summary, [role=tab]').forEach((el) => {
        if (el.closest('svg, .pf, .scada-action-btn') || !vis(el)) return;
        const r = el.getBoundingClientRect();
        if (r.height < 43.5 || r.width < 43.5) peq.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 22)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      });
    });
    return { chico: [...new Set(chico)].slice(0, 12), peq: [...new Set(peq)].slice(0, 12), overflowX: document.documentElement.scrollWidth > innerWidth + 2 };
  }, secciones);
  await page.goto('http://localhost:5173/conservacion?seccion=derivacion', { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForSelector('.cons-der-slots', { timeout: 120000 }).catch(() => {});
  await page.getByRole('tab', { name: /^Revisión/ }).click();
  await page.waitForSelector('.cr-fila');
  rec.medidasCentro = await medir(['.cr']);
  await foto('1_centro');
  await page.locator('.cr-fila .cr-abrir').first().click();
  await page.waitForSelector('.cc-raiz .cons-ec');
  rec.medidasFicha = await medir(['.cc-barra', '.cc-tira', '.cc-estados', '.cc-razon', '.cc-otras', '.cons-comp-cab', '.cons-comp-nav', '.cons-comp > .cons-filtros']);
  await foto('2_ficha');
  for (const k of ['medidasCentro', 'medidasFicha']) {
    verifica(quien(`${k}: texto ≥ 12 px`), rec[k].chico.length === 0, rec[k].chico.join(' | '));
    verifica(quien(`${k}: objetivos ≥ 44 px`), rec[k].peq.length === 0, rec[k].peq.join(' | '));
    verifica(quien(`${k}: sin desborde horizontal`), !rec[k].overflowX);
  }
  rec.tokensRotos = await page.evaluate(() => ['NaN', 'undefined', 'Infinity', '[object Object]'].filter((t) => (document.body.innerText || '').includes(t)));
  verifica(quien('sin NaN/undefined en pantalla'), rec.tokensRotos.length === 0, rec.tokensRotos.join(','));
  verifica(quien('0 errores de consola'), errores.length === 0, errores.join(' | '));
  verifica(quien('0 errores de red'), red.length === 0, red.join(' | '));
  // ── Obras puntuales en el Centro de revisión (T-02/T-03): sin falsos positivos y con «Abrir» ──
  await page.getByRole('tab', { name: /^Revisión/ }).click(); await page.waitForSelector('.cr-fila', { timeout: 60000 });
  const filasPieza = await page.locator('.cr-pieza').evaluateAll((l) => l.map((x) => x.innerText.replace(/\s+/g, ' ')));
  rec.obrasRevision = filasPieza.map((t) => t.slice(0, 110));
  const hayM5 = (await page.locator('.cr-fila:not(.cr-pieza)').first().innerText().catch(() => '')).length > 0 && (await page.locator('.cons-der-slot-pend').count()) < 6;
  const m5Pieza = filasPieza.filter((t) => /M5|Módulo 5/.test(t));
  verifica(quien('revisión: ninguna obra puntual de la SRL aparece como atípica'), filasPieza.every((t) => !/SRL Unidad Conchos/.test(t)), filasPieza.join(' | ').slice(0, 200));
  if (m5Pieza.length > 0) {
    verifica(quien('revisión: M5 lista la obra civil (conciliación con el inventario)'), m5Pieza.some((t) => /obra civil/i.test(t) && /2[,.]?002/.test(t) && /1[,.]?715/.test(t)), m5Pieza.join(' | ').slice(0, 300));
    verifica(quien('revisión: M5 no lista compuertas ni edificios'), m5Pieza.every((t) => !/compuertas|edificios/i.test(t)));
    await page.locator('.cr-pieza .cr-abrir').first().click(); await page.waitForSelector('.op-ficha', { timeout: 20000 });
    verifica(quien('«Abrir» de una obra puntual lleva a su ficha en Comprobación por tramo'), (await page.locator('.op-ficha').count()) === 1 && (await page.inputValue('#cons-comp-red')) === 'obras');
  }
  void hayM5;
  rec.errores = errores; rec.red = red;
  resumen[nombre] = rec;
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(resumen, null, 1));
console.log(fallos.length ? `\nFALLOS (${fallos.length}):\n- ${fallos.join('\n- ')}` : '\nSin fallos.');
process.exit(fallos.length ? 1 : 0);
