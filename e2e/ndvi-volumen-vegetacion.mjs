// Auditoría de SOLO LECTURA de la sección «Más agua, más vegetación» (comparativo interanual del panel NDVI mensual por módulo).
// Se invoca desde ndvi-tendencia-comparacion.mjs (fase 'vv'; omitible con SALTAR=vv). Cubre: 7 perfiles (Chromium 1440/1024/820/430, WebKit iPhone e iPad),
// consola/red, desborde, texto ≥ 12 px y contraste ≥ 4.5 (HTML y texto SVG a escala real), foco/teclado/tooltips, 44 px, S/D simulado por respuesta
// alterada (sin volumen 2026, lectura caída, mes parcial), cifras exactas contra la BD viva (REST con anon key) y escala de grises.
import fs from 'fs';

const MODULOS = [1, 2, 3, 4, 5, 12];
const ANIOS = [2021, 2022, 2023, 2024];
const MESES_T = ['03', '04', '05', '06', '07', '08', '09'];

/** Texto SVG: tamaño efectivo (px de pantalla = font-size × escala del viewBox) y contraste del relleno contra el peor fondo posible del cuadro. */
const MEDIR_SVG = `(() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fondos = [{ r: 8, g: 14, b: 28 }, { r: 20, g: 44, b: 66 }]; // fondo normal y cuadro elegido (más claro): se mide contra el más exigente
  const chicos = [], malos = [];
  for (const svg of document.querySelectorAll('.vv-lienzo svg')) {
    const vb = svg.viewBox.baseVal; const esc = svg.getBoundingClientRect().width / vb.width;
    for (const t of svg.querySelectorAll('text')) {
      if (!t.textContent.trim()) continue;
      const cs = getComputedStyle(t); const px = parseFloat(cs.fontSize) * esc;
      if (px < 11.95) chicos.push({ t: t.textContent.slice(0, 24), px: +px.toFixed(2) });
      const f = parse(cs.fill); if (!f) continue;
      const peor = Math.min(...fondos.map((b) => { const L1 = lum(f), L2 = lum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); }));
      if (peor < 4.5) malos.push({ t: t.textContent.slice(0, 24), cr: +peor.toFixed(2) });
    }
  }
  return { chicos, malos };
})()`;

const COLUMNAS = `(() => { const xs = [...document.querySelectorAll('.vv-cuadro')].map((c) => Math.round(c.getBoundingClientRect().left)); return new Set(xs).size; })()`;

const leerPuntos = `(() => [...document.querySelectorAll('.vv-cuadro')].map((c) => ({
  modulo: Number(c.querySelector('.vv-cab b').textContent.replace(/\\D/g, '')),
  chip: c.querySelector('.vv-chip').textContent.trim(),
  frase: c.querySelectorAll('.vv-frase')[0]?.textContent ?? '',
  frase26: c.querySelectorAll('.vv-frase')[1]?.textContent ?? '',
  puntos: [...c.querySelectorAll('.vv-pto')].map((p) => ({ label: p.getAttribute('aria-label'), actual: p.classList.contains('actual') })),
  titulo: c.querySelector('svg title')?.textContent ?? '', desc: c.querySelector('svg desc')?.textContent ?? '',
})))()`;

async function abrirVV(page, abrirPanel, esperaActual = true) {
  await abrirPanel(page);
  await page.waitForSelector('.vv-cuadro', { timeout: 30000, state: 'attached' });
  await page.locator('.vv').scrollIntoViewIfNeeded();
  if (esperaActual) await page.waitForSelector('.vv-pto.actual', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1900);
}

export async function barridoVolumenVegetacion(ctx) {
  const { OUT, res, hallazgo, cifra, vigila, abrirPanel, medidas, rest, bd, PERFILES, CONTRASTE_FRASES } = ctx;
  const { chromium } = await import('playwright');
  const carpeta = `${OUT}vv/`;
  fs.mkdirSync(carpeta, { recursive: true });

  // ── BD viva ──
  const sv = await rest('superficie_volumen_anual_modulo?select=anio,numero_modulo,superficie_ha,volumen_miles_m3,atipico&limit=2000');
  const prov = await rest('volumen_modulo_mensual_provisional?select=numero_modulo,mes,volumen_miles_m3,es_mes_parcial&mes=gte.2026-03&mes=lte.2026-09&limit=500');
  const volBd = (m, a) => { const f = sv.filter((s) => s.numero_modulo === m && s.anio === a && s.volumen_miles_m3 != null); return f.length ? f.reduce((x, s) => x + s.volumen_miles_m3, 0) / 1000 : null; };
  const vol26 = (m) => prov.filter((p) => p.numero_modulo === m).reduce((x, p) => x + p.volumen_miles_m3, 0) / 1000;
  const ndviMedio = (m, a) => { const v = MESES_T.map((t) => bd.find((x) => x.numero_modulo === m && x.mes === `${a}-${t}`)?.ndvi_mediana).filter((x) => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
  const pearson = (xs, ys) => { const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n; let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; }); return sxy / Math.sqrt(sxx * syy); };
  const signoR = (r) => `${r < 0 ? '−' : '+'}${Math.abs(r).toFixed(2)}`;
  res.vv = { perfiles: {}, cifrasPuntos: 0 };

  // ═════ 1) Recorrido por perfil ═════
  for (const P of PERFILES) {
    const t0 = Date.now();
    const browser = await P.motor.launch();
    const c = await browser.newContext({ ...P.ctx, serviceWorkers: 'block' });
    const page = await c.newPage();
    const err = [], net = [];
    vigila(page, err, net);
    const D = `vv ${P.id}`;
    const r = {};
    const tactil = !!P.ctx.hasTouch;
    try {
      await abrirVV(page, abrirPanel);
      const cuadros = await page.locator('.vv-cuadro').count();
      if (cuadros !== 6) hallazgo('critico', D, `${cuadros} cuadros (esperados 6)`);
      const pts = await page.locator('.vv-pto').count();
      if (pts !== 30) hallazgo('alto', D, `${pts} puntos (esperados 24 de 2021–2024 + 6 de 2026)`);
      r.columnas = await page.evaluate(COLUMNAS);
      const w = page.viewportSize().width;
      const anchoCuadro = await page.locator('.vv-cuadro').first().evaluate((e) => e.getBoundingClientRect().width);
      if (anchoCuadro < 300) hallazgo('alto', D, `cuadros de ${Math.round(anchoCuadro)} px (< 300: el texto SVG se achicaría)`);
      await page.locator('.vv').screenshot({ path: `${carpeta}${P.id}_seccion.png` }).catch(() => {});
      await page.locator('.vv-cuadro').nth(1).screenshot({ path: `${carpeta}${P.id}_M2.png` }).catch(() => {});
      await page.locator('.vv-cuadro').nth(3).screenshot({ path: `${carpeta}${P.id}_M4.png` }).catch(() => {});
      // texto limpio, desborde, contraste, tamaños (HTML y SVG a escala real)
      const txt = await page.locator('.vv').innerText();
      for (const mal of ['NaN', 'undefined', 'Infinity', '[object Object]']) if (txt.includes(mal)) hallazgo('critico', D, `aparece "${mal}"`);
      if (/\bnull\b/.test(txt)) hallazgo('critico', D, 'aparece "null"');
      if (/porque|debido a|por culpa|gracias a/i.test(await page.locator('.vv-lectura, .vv-frase, .vv-comparabilidad').allInnerTexts().then((a) => a.join(' ')))) hallazgo('alto', D, 'texto con lenguaje causal');
      await medidas(page, '.vv', D, r);
      const svg = await page.evaluate(MEDIR_SVG);
      r.svg = { chicos: svg.chicos.length, malos: svg.malos.length };
      if (svg.chicos.length) hallazgo('medio', D, `texto SVG < 12 px efectivos: ${JSON.stringify(svg.chicos.slice(0, 4))}`);
      if (svg.malos.length) hallazgo('medio', D, `contraste SVG < 4.5: ${JSON.stringify(svg.malos.slice(0, 4))}`);
      // objetivos táctiles de los controles (encabezado de cuadro = elegir módulo)
      const cabs = await page.locator('.vv-cab').evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }));
      if (cabs.some(([ancho, alto]) => alto < 43.5 || ancho < 43.5)) hallazgo('alto', D, `controles de cuadro < 44 px: ${JSON.stringify(cabs.filter(([a, h]) => h < 43.5 || a < 43.5))}`);
      // lectura de los seis cuadros
      const datos = await page.evaluate(leerPuntos);
      r.chips = datos.map((d) => `M${d.modulo}:${d.chip.replace('✓ ', '')}`);
      const firmes = datos.filter((d) => /Firme/.test(d.chip));
      if (firmes.length !== 1 || firmes[0].modulo !== 2) hallazgo('alto', D, `«Firme» debería ser solo M2: ${JSON.stringify(firmes.map((f) => f.modulo))}`);
      const m4 = datos.find((d) => d.modulo === 4);
      if (!/Sin relación/.test(m4.chip)) hallazgo('alto', D, `M4 debería decir «Sin relación»: ${m4.chip}`);
      for (const d of datos) {
        if (d.puntos.filter((p) => p.actual).length !== 1) hallazgo('alto', D, `M${d.modulo}: sin exactamente un punto 2026`);
        if (!d.titulo || !d.desc || d.desc.split(';').length < 5) hallazgo('alto', D, `M${d.modulo}: <title>/<desc> incompletos`);
        if (!d.puntos.every((p) => p.label)) hallazgo('alto', D, `M${d.modulo}: puntos sin aria-label`);
      }
      // foco, tooltip y teclado (en táctil: toque)
      const cuadro = page.locator('.vv-cuadro').nth(1);
      const puntos = cuadro.locator('.vv-pto');
      if (tactil) { await puntos.nth(2).locator('.vv-forma').tap(); } else { await puntos.first().focus(); }
      await page.waitForTimeout(300);
      const tip1 = await cuadro.locator('.vv-tip').innerText().catch(() => '');
      if (!/hm³ · NDVI/.test(tip1)) hallazgo('alto', D, `el punto no muestra tooltip (${tactil ? 'toque' : 'foco'})`);
      if (!tactil) {
        const trazoFoco = await page.evaluate(() => { const h = document.activeElement?.querySelector('.vv-hit'); return h ? getComputedStyle(h).stroke : null; });
        if (!trazoFoco || trazoFoco === 'none') hallazgo('alto', D, 'el punto enfocado no tiene indicador de foco visible');
        await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250);
        const tip2 = await cuadro.locator('.vv-tip').innerText().catch(() => '');
        if (!tip2 || tip2 === tip1) hallazgo('alto', D, 'ArrowRight no mueve el foco al punto siguiente');
        await page.keyboard.press('Enter'); await page.waitForTimeout(250);
        if (await cuadro.locator('.vv-tip').count() !== 0) hallazgo('medio', D, 'Enter no cierra el tooltip abierto');
        await page.keyboard.press('Enter'); await page.waitForTimeout(250);
        if (await cuadro.locator('.vv-tip').count() !== 1) hallazgo('medio', D, 'Enter no vuelve a abrir el tooltip');
        // una sola parada de Tab por cuadro (roving tabindex)
        const paradas = await cuadro.locator('.vv-pto').evaluateAll((els) => els.filter((e) => e.getAttribute('tabindex') === '0').length);
        if (paradas !== 1) hallazgo('medio', D, `${paradas} paradas de Tab en un cuadro (esperada 1)`);
        // Tab desde el encabezado llega al primer punto y luego sale del cuadro
        await cuadro.locator('.vv-cab').focus(); await page.keyboard.press('Tab');
        const enPunto = await page.evaluate(() => document.activeElement?.classList.contains('vv-pto'));
        if (!enPunto) hallazgo('alto', D, 'Tab desde el encabezado no llega a un punto');
      }
      // elegir M4: queda resaltado y la tabla cambia a M4 con 2026 = 45.5 provisional
      await page.locator('.vv-cuadro').nth(3).locator('.vv-cab').click(); await page.waitForTimeout(500);
      const sel = await page.locator('.vv-cuadro.on').count();
      if (sel !== 1) hallazgo('alto', D, `${sel} cuadros resaltados (esperado 1)`);
      const tabla = await page.locator('.vv-tabla').innerText();
      if (!/Módulo 4/.test(tabla)) hallazgo('alto', D, 'la tabla no cambió a M4');
      const fila26 = await page.locator('.vv-tabla tbody tr', { has: page.locator('th', { hasText: '2026' }) }).innerText();
      if (!/45\.5/.test(fila26) || !/0\.167/.test(fila26) || !/provisional/.test(fila26)) hallazgo('critico', D, `fila 2026 de M4 ≠ 45.5 / 0.167 provisional: "${fila26.replace(/\s+/g, ' ')}"`);
      const fila25 = await page.locator('.vv-tabla tbody tr', { has: page.locator('th', { hasText: '2025' }) }).innerText();
      if (!/Sin informe ACUM_INF/.test(fila25)) hallazgo('alto', D, '2025 no dice «Sin informe ACUM_INF»');
      // Escape: primero cierra el tooltip (el panel sigue abierto, foco en el punto); el segundo Escape cierra el panel y devuelve el foco a su botón
      if (!tactil) {
        const cEsc = page.locator('.vv-cuadro').nth(1);
        await cEsc.locator('.vv-pto').first().focus(); await page.waitForTimeout(250);
        if (await cEsc.locator('.vv-tip').count() !== 1) hallazgo('alto', D, 'Escape: el tooltip no se abrió para la prueba');
        await page.keyboard.press('Escape'); await page.waitForTimeout(300);
        const tras1 = await page.evaluate(() => ({ tip: document.querySelectorAll('.vv-tip').length, panel: document.querySelectorAll('.vv-cuadro').length, enPunto: !!document.activeElement?.classList.contains('vv-pto') }));
        if (tras1.tip !== 0) hallazgo('alto', D, 'Escape no cierra el tooltip abierto');
        if (tras1.panel === 0) hallazgo('critico', D, 'Escape con tooltip abierto cerró todo el panel');
        if (!tras1.enPunto) hallazgo('medio', D, 'Escape cerró el tooltip pero el foco no quedó en el punto que lo abrió');
        r.escape = { tras1 };
        await page.screenshot({ path: `${carpeta}${P.id}_escape_tooltip_cerrado.png` });
        await page.keyboard.press('Escape'); await page.waitForTimeout(700);
        const tras2 = await page.evaluate(() => ({ panel: document.querySelectorAll('.vv-cuadro').length, foco: `${document.activeElement?.getAttribute('aria-label') ?? ''} ${(document.activeElement?.textContent ?? '').trim()}`.trim().slice(0, 80), enBody: document.activeElement === document.body }));
        if (tras2.panel !== 0) hallazgo('alto', D, 'el segundo Escape no cerró el panel');
        if (!/Ver NDVI mensual/.test(tras2.foco)) hallazgo('medio', D, `al cerrar el panel el foco no volvió a su botón («${tras2.foco}»)`);
        r.escape.tras2 = tras2;
      }
    } catch (e) { hallazgo('critico', D, 'fallo del recorrido: ' + String(e.message).slice(0, 220)); await page.screenshot({ path: `${carpeta}${P.id}_fallo.png` }).catch(() => {}); }
    if (err.length) hallazgo('alto', D, `errores de consola: ${JSON.stringify(err.slice(0, 3))}`);
    if (net.length) hallazgo('alto', D, `fallos de red: ${JSON.stringify(net.slice(0, 3))}`);
    // El volumen provisional se pide UNA vez por sesión de página (sin consultas duplicadas)
    res.vv.perfiles[P.id] = r;
    console.log(`· ${D} listo en ${Math.round((Date.now() - t0) / 1000)} s`);
    await browser.close();
  }

  // ═════ 2) Cifras contra la BD viva + una sola consulta de volumen (Chromium 1440) ═════
  {
    const browser = await chromium.launch();
    const c = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const page = await c.newPage();
    const err = [], net = [];
    vigila(page, err, net);
    let consultasVol = 0;
    page.on('request', (rq) => { if (/volumen_modulo_mensual_provisional/.test(rq.url())) consultasVol++; });
    try {
      await abrirVV(page, abrirPanel);
      const datos = await page.evaluate(leerPuntos);
      const lee = (m, anio) => { const d = datos.find((x) => x.modulo === m); const p = d.puntos.find((q) => q.label.startsWith(`${anio}`)); const mt = p?.label.match(/: ([\d.]+) hm³, NDVI ([\d.]+)/); return mt ? { vol: mt[1], ndvi: mt[2] } : null; };
      let n = 0;
      for (const m of MODULOS) {
        for (const a of ANIOS) {
          const vb = volBd(m, a), nb = ndviMedio(m, a); const pant = lee(m, a);
          cifra(`M${m} ${a} volumen hm³`, vb.toFixed(1), pant?.vol); cifra(`M${m} ${a} NDVI medio`, nb.toFixed(3), pant?.ndvi); n += 2;
        }
        const p26 = lee(m, 2026);
        cifra(`M${m} 2026 volumen hm³ (hoja SRL)`, vol26(m).toFixed(1), p26?.vol); cifra(`M${m} 2026 NDVI medio`, ndviMedio(m, 2026).toFixed(3), p26?.ndvi); n += 2;
      }
      res.vv.cifrasPuntos = n;
      // r de cada módulo recalculado desde la BD contra la frase de pantalla
      const rBd = {};
      for (const m of MODULOS) rBd[m] = pearson(ANIOS.map((a) => volBd(m, a)), ANIOS.map((a) => ndviMedio(m, a)));
      res.vv.r = rBd;
      for (const m of MODULOS) { const d = datos.find((x) => x.modulo === m); cifra(`r volumen–NDVI de M${m}`, signoR(rBd[m]), (d.frase.match(/r = ([+−]\d\.\d\d)/) ?? [])[1]); }
      if (Math.abs(rBd[2] - 0.98) > 0.01) hallazgo('alto', 'vv cifras', `r de M2 recalculado ${rBd[2].toFixed(3)} (esperado ≈ 0.98)`);
      if (Math.abs(rBd[4] + 0.18) > 0.01) hallazgo('alto', 'vv cifras', `r de M4 recalculado ${rBd[4].toFixed(3)} (esperado ≈ −0.18)`);
      // tabla de M1: volumen y NDVI de 2021 (18.9 / 0.289) y 2026 (30.2 prov.)
      await page.locator('.vv-cuadro').first().locator('.vv-cab').click(); await page.waitForTimeout(400);
      const celdas = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.vv-tabla tbody tr')].map((tr) => [tr.querySelector('th').textContent.trim(), [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())])));
      cifra('M1 2021 tabla: volumen', volBd(1, 2021).toFixed(1), celdas['2021']?.[1]);
      cifra('M1 2021 tabla: NDVI medio', ndviMedio(1, 2021).toFixed(3), celdas['2021']?.[2]);
      cifra('M1 2026 tabla: volumen provisional', `${vol26(1).toFixed(1)} provisional`, celdas['2026']?.[1]);
      cifra('M1 2021 tabla: superficie ha', Math.round(sv.filter((s) => s.numero_modulo === 1 && s.anio === 2021).reduce((x, s) => x + (s.superficie_ha ?? 0), 0)).toLocaleString('en-US'), celdas['2021']?.[0]);
      // lectura general
      const lect = await page.locator('.vv-lectura').innerText();
      if (!/5 de 6 módulos/.test(lect) || !/único firme: M2/.test(lect) || !/Excepción: M4/.test(lect) || !/2026/.test(lect)) hallazgo('alto', 'vv cifras', `lectura general inesperada: ${lect}`);
      // volumen provisional: una sola consulta aunque el panel se monte/desmonte (reabrir el panel no repite la lectura)
      const antes = consultasVol;
      await page.keyboard.press('Escape'); await page.waitForTimeout(500);
      await page.getByRole('button', { name: /Ver NDVI mensual por módulo/ }).click({ timeout: 20000 });
      await page.waitForSelector('.vv-pto.actual', { timeout: 20000 }); await page.waitForTimeout(800);
      res.vv.consultasVolumen = { alAbrir: antes, trasReabrir: consultasVol };
      if (antes !== 1 || consultasVol !== 1) hallazgo('medio', 'vv consultas', `el volumen provisional se pidió ${antes} vez/veces al abrir y ${consultasVol} tras reabrir (se esperaba 1 y 1: caché compartida)`);
    } catch (e) { hallazgo('critico', 'vv cifras', 'fallo: ' + String(e.message).slice(0, 220)); }
    if (err.length) hallazgo('alto', 'vv cifras', `errores de consola: ${JSON.stringify(err.slice(0, 3))}`);
    if (net.length) hallazgo('alto', 'vv cifras', `fallos de red: ${JSON.stringify(net.slice(0, 3))}`);
    await browser.close();
  }

  // ═════ 3) S/D simulado (respuesta alterada; la BD no se toca) ═════
  const escenarios = [
    { id: 'sin-volumen-2026', ruta: async (route) => { const resp = await route.fetch(); const f = await resp.json(); await route.fulfill({ response: resp, json: f.filter((x) => !String(x.mes).startsWith('2026')) }); },
      verifica: async (page, D) => {
        if (await page.locator('.vv-pto.actual').count() !== 0) hallazgo('critico', D, 'hay punto 2026 sin volumen 2026');
        const t = await page.locator('.vv').innerText();
        if (!/Sin volumen 2026 cargado para el módulo \(S\/D\)/.test(t)) hallazgo('alto', D, 'no dice claramente que falta el volumen 2026');
        if (/0\.0 hm³|\b0 hm³/.test(t)) hallazgo('critico', D, 'aparece un volumen en cero');
        const fila = await page.locator('.vv-tabla tbody tr', { has: page.locator('th', { hasText: '2026' }) }).innerText();
        if (!/S\/D/.test(fila)) hallazgo('alto', D, `fila 2026 sin S/D: "${fila.replace(/\s+/g, ' ')}"`);
        if (await page.locator('.vv-cuadro.est-firme').count() !== 1) hallazgo('alto', D, 'el ajuste de 2021–2024 cambió al faltar 2026');
      } },
    { id: 'lectura-caida', ruta: async (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'simulado', code: 'X' }) }),
      verifica: async (page, D) => {
        if (await page.locator('.vv-pto.actual').count() !== 0) hallazgo('critico', D, 'hay punto 2026 con la lectura caída');
        const alerta = await page.locator('.vv-error[role=alert]').innerText().catch(() => '');
        if (!/No se pudo leer el volumen 2026/.test(alerta) || !/no en cero/.test(alerta)) hallazgo('alto', D, `sin aviso visible de error: "${alerta}"`);
        if (await page.locator('.vv-pto').count() !== 24) hallazgo('alto', D, 'los años con informe deberían seguir dibujados');
        if (/\b0\.0 hm³/.test(await page.locator('.vv').innerText())) hallazgo('critico', D, 'aparece un volumen en cero');
      } },
    { id: 'mes-parcial', ruta: async (route) => { const resp = await route.fetch(); const f = await resp.json(); await route.fulfill({ response: resp, json: f.map((x) => (x.mes === '2026-09' ? { ...x, es_mes_parcial: true } : x)) }); },
      verifica: async (page, D) => {
        const t = await page.locator('.vv').innerText();
        if (!/incompleto/.test(t)) hallazgo('alto', D, 'un mes parcial no se avisa');
        if (await page.locator('.vv-pto.actual').count() !== 6) hallazgo('medio', D, 'el punto 2026 con mes parcial debería dibujarse (con aviso)');
      } },
  ];
  for (const esc of escenarios) {
    const browser = await chromium.launch();
    const c = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const page = await c.newPage();
    const err = [], net = [];
    vigila(page, err, net);
    await c.route('**/rest/v1/volumen_modulo_mensual_provisional*', esc.ruta);
    const D = `vv S/D ${esc.id}`;
    try {
      await abrirVV(page, abrirPanel, false);
      await page.waitForTimeout(1500);
      await page.locator('.vv').screenshot({ path: `${carpeta}sd_${esc.id}.png` }).catch(() => {});
      await esc.verifica(page, D);
      await page.waitForTimeout(100);
    } catch (e) { hallazgo('critico', D, 'fallo: ' + String(e.message).slice(0, 220)); }
    // con la lectura caída el navegador registra el 500 simulado: es esperado y no cuenta
    const netReal = net.filter((x) => !(esc.id === 'lectura-caida' && /volumen_modulo_mensual_provisional/.test(x)));
    const errReal = err.filter((x) => !(esc.id === 'lectura-caida' && /500|volumen_modulo_mensual_provisional/.test(x)));
    if (errReal.length) hallazgo('alto', D, `errores de consola: ${JSON.stringify(errReal.slice(0, 2))}`);
    if (netReal.length) hallazgo('alto', D, `fallos de red: ${JSON.stringify(netReal.slice(0, 2))}`);
    await browser.close();
  }

  // ═════ 4) Escala de grises: formas, rombo, aros y rectas deben distinguirse sin color ═════
  {
    const browser = await chromium.launch();
    const c = await browser.newContext({ viewport: { width: 1440, height: 2300 }, serviceWorkers: 'block' });
    const page = await c.newPage();
    try {
      await abrirVV(page, abrirPanel);
      await page.addStyleTag({ content: 'html { filter: grayscale(1) !important; }' });
      await page.waitForTimeout(400);
      await page.locator('.vv').screenshot({ path: `${carpeta}grises_seccion.png` });
      // las seis formas del módulo deben ser trazos distintos
      const formas = await page.evaluate(() => [...document.querySelectorAll('.vv-cab .vv-sim path')].map((p) => p.getAttribute('d')));
      if (new Set(formas).size !== 6) hallazgo('alto', 'vv grises', `solo ${new Set(formas).size} símbolos distintos de módulo`);
    } catch (e) { hallazgo('critico', 'vv grises', 'fallo: ' + String(e.message).slice(0, 200)); }
    await browser.close();
  }
}
