// Auditoría de SOLO LECTURA del comparativo interanual de NDVI (GEO-MONITOR) y de su informe institucional.
//   node e2e/ndvi-interanual-auditoria.mjs <iteracion>     (con `npm run dev` en :5173)
// Capturas: ../ciclo_2025_2026/auditoria/ndvi_interanual/iter<N>/ · Resultado: iter<N>/resultado.json
// Verifica: 0 errores de consola/red, sin desborde horizontal, S/D donde corresponde, sin NaN/undefined/0 engañoso,
// contraste de texto, foco por teclado, 3+ cifras contra la BD viva (REST con anon key) y el informe interanual.
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const iter = process.argv[2] || '1';
const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const OUT = fileURLToPath(new URL(`../../ciclo_2025_2026/auditoria/ndvi_interanual/iter${iter}/`, import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const ANCHOS = [{ w: 1440, h: 900 }, { w: 1024, h: 768 }, { w: 820, h: 1180 }, { w: 430, h: 932 }];
const MODULOS = [1, 2, 3, 4, 5, 12];
const res = { iter, hallazgos: [], cifras: [], informe: {}, anchos: {} };
const hallazgo = (sev, donde, txt) => { res.hallazgos.push({ sev, donde, txt }); console.log(`[${sev}] ${donde}: ${txt}`); };

// ── anon key (solo lectura) ──
const env = fs.readFileSync(RAIZ + '.env', 'utf8');
const leer = (k) => (env.match(new RegExp('^' + k + '="?([^"\\r\\n]+?)"?\\s*$', 'm')) || [])[1]?.trim();
const URL_SB = leer('VITE_SUPABASE_URL'), KEY = leer('VITE_SUPABASE_ANON_KEY');
const rest = async (q) => (await fetch(`${URL_SB}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json();

const browser = await chromium.launch();

async function abrirPanel(page) {
  await page.goto('http://localhost:5173/geo-monitor', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /Ver NDVI mensual por módulo/ }).click({ timeout: 20000 });
  await page.waitForSelector('.ndvi-ia .ndvi-ia-minis', { timeout: 30000 });
  await page.waitForTimeout(2500);
}

const SCROLL = `(() => { const el = document.querySelector('.ndvi-ia'); el.scrollIntoView({ block: 'start' }); })()`;

// Contraste aproximado de todo el texto visible de un contenedor (compone fondos semitransparentes).
const CONTRASTE = `(() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fondo = (el) => { const caps = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { caps.push(c); if (c.a >= 1) break; } } let base = { r: 15, g: 23, b: 42 }; if (!caps.length || caps[caps.length - 1].a < 1) base = { r: 15, g: 23, b: 42 }; else base = caps.pop(); for (const c of caps.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) }; return base; };
  const malos = []; const raiz = document.querySelector('.ndvi-ia');
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT); const vistos = new Set();
  while (w.nextNode()) { const n = w.currentNode; const t = n.textContent.trim(); const el = n.parentElement; if (!t || vistos.has(el) || el.closest('svg')) continue; vistos.add(el);
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue; const r = el.getBoundingClientRect(); if (r.width === 0) continue;
    const fg = parse(cs.color); if (!fg) continue; const bg = fondo(el); const a = fg.a; const mix = { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) };
    const L1 = lum(mix), L2 = lum(bg); const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); const px = parseFloat(cs.fontSize);
    if (cr < 4.5) malos.push({ t: t.slice(0, 40), cr: +cr.toFixed(2), px }); }
  return malos; })()`;

// ═══════════════ 1) Panel en 4 anchos ═══════════════
for (const { w, h } of ANCHOS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block', hasTouch: w < 1000, isMobile: w < 500 });
  const page = await ctx.newPage();
  const err = [], net = [];
  page.on('console', (m) => { if (['error'].includes(m.type()) && !/AUTH_BYPASS|WebSocket|realtime|favicon|Failed to load resource.*(tile|basemaps|cartocdn|sentinel|copernicus|dataspace|openstreetmap|gibs)/i.test(m.text()) && !/gibs\.earthdata/i.test(m.location()?.url ?? '')) err.push(m.text().slice(0, 200) + ' @ ' + (m.location()?.url ?? '').slice(0, 120)); });
  page.on('pageerror', (e) => err.push('pageerror ' + String(e.message).slice(0, 200)));
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon|\.map$|tile|basemaps|cartocdn|sentinel|copernicus|dataspace|openstreetmap|gibs/i.test(r.url())) net.push(`${r.status()} ${r.url().slice(0, 120)}`); });
  page.on('requestfailed', (r) => { if (r.failure()?.errorText !== 'net::ERR_ABORTED' && !/realtime|websocket|favicon|tile|basemaps|cartocdn|sentinel|copernicus|dataspace|openstreetmap|gibs/i.test(r.url())) net.push('FAILED ' + r.url().slice(0, 120)); });
  const r = { w };
  try {
    await abrirPanel(page);
    await page.evaluate(SCROLL); await page.waitForTimeout(1200);
    const el = page.locator('.ndvi-ia');
    // Para capturar el bloque completo (el overlay tiene scroll interno) se libera su altura SOLO al tomar la foto.
    const foto = async (ruta) => {
      const st = await page.addStyleTag({ content: '.vaso-screen-overlay,.vaso-scroll-content,.vaso-screen-overlay>*{height:auto !important;max-height:none !important;overflow:visible !important}' });
      await page.waitForTimeout(500); await el.screenshot({ path: ruta }); await st.evaluate((e) => e.remove()); await page.waitForTimeout(300);
    };
    for (const m of MODULOS) {
      await page.locator('.ndvi-ia-mini').filter({ hasText: new RegExp('^M' + m + '\\b') }).click();
      await page.waitForTimeout(700);
      if (m === 1 || w === 1440) await foto(`${OUT}panel_${w}_M${m}.png`);
      const t = await page.evaluate(() => document.querySelector('.ndvi-ia').innerText);
      for (const mal of ['NaN', 'undefined', 'Infinity', '[object Object]']) if (t.includes(mal)) hallazgo('critico', `panel ${w} M${m}`, `aparece "${mal}"`);
      const ceros = await page.evaluate(() => [...document.querySelectorAll('.ndvi-ia-tabla td')].map((e) => e.textContent.trim()).filter((x) => /^0([.,]0+)?$/.test(x)).length);
      if (ceros) hallazgo('alto', `panel ${w} M${m}`, `${ceros} celda(s) con 0 en tablas (posible S/D disfrazado)`);
    }
    // Desborde horizontal (página y contenedores con scroll del overlay)
    r.desborde = await page.evaluate(() => {
      const ia = document.querySelector('.ndvi-ia'); const ov = ia.closest('.vaso-scroll-content') || document.documentElement;
      const sobran = [...ia.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > innerWidth + 2 && !e.closest('.ndvi-ia-tabla-wrap'); }).slice(0, 3).map((e) => e.className || e.tagName);
      return { pagina: document.documentElement.scrollWidth > innerWidth + 2, overlay: ov.scrollWidth > ov.clientWidth + 2, sobran, culpables: [...ov.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > ov.getBoundingClientRect().right + 2 && !e.closest('.ndvi-ia-tabla-wrap,.ndvi-chips,.leaflet-container'); }).slice(0, 4).map((e) => (e.className?.toString() || e.tagName).slice(0, 40)), wrapsScroll: [...ia.querySelectorAll('.ndvi-ia-tabla-wrap')].map((e) => e.scrollWidth > e.clientWidth) };
    });
    if (r.desborde.pagina || r.desborde.culpables.length || r.desborde.sobran.length) hallazgo('alto', `panel ${w}`, `desborde horizontal ${JSON.stringify(r.desborde)}`);
    // Etiquetas del SVG de dispersión dentro de su viewBox
    r.svgCortado = await page.evaluate(() => [...document.querySelectorAll('.ndvi-ia-fig svg text')].filter((t) => { const s = t.ownerSVGElement.getBoundingClientRect(), b = t.getBoundingClientRect(); return b.right > s.right + 1 || b.left < s.left - 1 || b.top < s.top - 1 || b.bottom > s.bottom + 1; }).map((t) => t.textContent));
    if (r.svgCortado.length) hallazgo('alto', `panel ${w}`, `etiquetas de la dispersión cortadas: ${r.svgCortado.join(',')}`);
    // Contraste
    const malos = await page.evaluate(CONTRASTE);
    r.contrasteBajo = malos;
    if (malos.length) hallazgo('medio', `panel ${w}`, `texto con contraste < 4.5: ${JSON.stringify(malos.slice(0, 4))}`);
    // Foco por teclado
    if (w === 1440 || w === 820) {
      await page.locator('.ndvi-ia .ndvi-chip').first().focus();
      const focos = [];
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        focos.push(await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { clase: e.className?.toString().slice(0, 30), visible: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 || cs.boxShadow !== 'none' }; }));
      }
      r.focos = focos;
      const sinFoco = focos.filter((f) => !f.visible);
      if (sinFoco.length) hallazgo('alto', `panel ${w}`, `elemento(s) sin indicador de foco: ${JSON.stringify(sinFoco)}`);
      await page.screenshot({ path: `${OUT}foco_${w}.png` });
    }
  } catch (e) { hallazgo('critico', `panel ${w}`, 'fallo del recorrido: ' + String(e.message).slice(0, 160)); }
  r.errores = err; r.red = net;
  if (err.length) hallazgo('alto', `panel ${w}`, `errores de consola: ${JSON.stringify(err.slice(0, 3))}`);
  if (net.length) hallazgo('alto', `panel ${w}`, `fallos de red: ${JSON.stringify(net.slice(0, 3))}`);
  res.anchos[w] = r;

  // ═══════════════ 2) Cifras contra la BD viva (solo en el ancho de escritorio) ═══════════════
  if (w === 1440) {
    try {
      await page.locator('.ndvi-ia-mini').filter({ hasText: /^M1\b/ }).click(); await page.waitForTimeout(600);
      const filaDom = (caption, anio) => page.evaluate(([cap, a]) => {
        const t = [...document.querySelectorAll('.ndvi-ia-tabla')].find((x) => x.querySelector('caption')?.textContent.startsWith(cap));
        const tr = [...(t?.querySelectorAll('tbody tr') ?? [])].find((x) => x.querySelector('th')?.textContent.trim().startsWith(String(a)));
        return tr ? [...tr.querySelectorAll('td')].map((x) => x.textContent.trim()) : null;
      }, [caption, anio]);
      const v2 = await rest('ndvi_modulo_mensual_v2?select=mes,ndvi_mediana&numero_modulo=eq.1&metodo=eq.scl-mediana-v1&mes=gte.2026-03&mes=lte.2026-09');
      const pico2026 = Math.max(...v2.map((x) => x.ndvi_mediana).filter((x) => x != null));
      const dom2026 = await filaDom('Resumen por año', 2026);
      res.cifras.push({ cifra: 'M1 pico NDVI 2026', bd: pico2026.toFixed(3), pantalla: dom2026?.[0] });
      if (!dom2026 || dom2026[0] !== pico2026.toFixed(3)) hallazgo('critico', 'cifras', `M1 pico 2026: BD ${pico2026.toFixed(3)} vs pantalla ${dom2026?.[0]}`);
      const sv = await rest('superficie_volumen_anual_modulo?select=anio,numero_modulo,superficie_ha,volumen_miles_m3&numero_modulo=eq.1&anio=eq.2023');
      const sup = sv.reduce((a, s) => a + (s.superficie_ha ?? 0), 0), vol = sv.reduce((a, s) => a + (s.volumen_miles_m3 ?? 0), 0) / 1000;
      const dom2023 = await filaDom('Superficie', 2023);
      const supTxt = sup.toLocaleString('es-MX', { maximumFractionDigits: 0 });
      res.cifras.push({ cifra: 'M1 superficie 2023 (ha)', bd: supTxt, pantalla: dom2023?.[0] }, { cifra: 'M1 volumen 2023 (hm3)', bd: vol.toFixed(1), pantalla: dom2023?.[1] });
      if (!dom2023 || dom2023[0] !== supTxt) hallazgo('critico', 'cifras', `M1 superficie 2023: BD ${supTxt} vs pantalla ${dom2023?.[0]}`);
      if (!dom2023 || dom2023[1] !== vol.toFixed(1)) hallazgo('critico', 'cifras', `M1 volumen 2023: BD ${vol.toFixed(1)} vs pantalla ${dom2023?.[1]}`);
      const v21 = await rest('ndvi_modulo_mensual_v2?select=mes,ndvi_mediana&numero_modulo=eq.1&metodo=eq.scl-mediana-v1&mes=gte.2021-03&mes=lte.2021-09');
      const pico21 = Math.max(...v21.map((x) => x.ndvi_mediana).filter((x) => x != null));
      const dom2021 = await filaDom('Resumen por año', 2021);
      res.cifras.push({ cifra: 'M1 pico NDVI 2021', bd: pico21.toFixed(3), pantalla: dom2021?.[0] });
      if (!dom2021 || dom2021[0] !== pico21.toFixed(3)) hallazgo('critico', 'cifras', `M1 pico 2021: BD ${pico21.toFixed(3)} vs pantalla ${dom2021?.[0]}`);
      // S/D esperados
      const d2025 = await filaDom('Superficie', 2025), d2026 = await filaDom('Superficie', 2026), d2020 = await filaDom('Superficie', 2020);
      res.cifras.push({ cifra: 'S/D 2025 sup/vol', pantalla: d2025?.slice(0, 4).join('|') }, { cifra: 'S/D 2026 sup/vol', pantalla: d2026?.slice(0, 4).join('|') }, { cifra: '2020 pico NDVI', pantalla: d2020?.[4] });
      if (!d2025 || d2025.slice(0, 4).some((x) => x !== 'S/D')) hallazgo('critico', 'S/D', `2025 deberia ser S/D en superficie/volumen: ${d2025}`);
      if (!d2026 || d2026.slice(0, 4).some((x) => x !== 'S/D')) hallazgo('critico', 'S/D', `2026 deberia ser S/D en superficie/volumen: ${d2026}`);
      if (!d2020 || d2020[4] !== 'S/D') hallazgo('critico', 'S/D', `2020 deberia ser S/D en NDVI: ${d2020}`);
      const m1 = await rest('superficie_volumen_anual_modulo?select=anio,atipico&numero_modulo=eq.1&atipico=eq.true');
      res.cifras.push({ cifra: 'M1 anios con atipico en BD', bd: [...new Set(m1.map((x) => x.anio))].join(',') });
    } catch (e) { hallazgo('critico', 'cifras', 'fallo: ' + String(e.message).slice(0, 160)); }

    // ═══════════════ 3) Informe interanual ═══════════════
    try {
      await page.evaluate(() => document.querySelector('.vaso-scroll-content')?.scrollTo(0, 0));
      await page.getByRole('button', { name: /Informe institucional/ }).click({ timeout: 10000 });
      await page.waitForSelector('.ndvi-cfg', { timeout: 10000 });
      const d = page.locator('.ndvi-cfg');
      await d.getByRole('radio', { name: 'Interanual' }).click();
      await page.waitForSelector('.ndvi-cfg [aria-label="Años a comparar"] button', { timeout: 20000 });
      await page.waitForTimeout(600);
      res.informe.chipsAnios = await d.locator('[aria-label="Años a comparar"] button').allTextContents();
      res.informe.resumenModal = await page.locator('.ndvi-cfg-resumen').textContent();
      const avisosModal = await page.locator('.ndvi-cfg-avi').allTextContents();
      res.informe.avisosModal = avisosModal;
      if (avisosModal.some((x) => /IEHP|un solo ciclo/i.test(x))) hallazgo('alto', 'informe modal', 'avisos que no aplican al modo interanual: ' + avisosModal.join(' | ').slice(0, 160));
      await page.screenshot({ path: `${OUT}informe_modal_1440.png` });
      await page.getByRole('button', { name: /Vista previa/ }).click();
      await page.waitForSelector('.ndvi-cfg-marco iframe', { timeout: 30000 });
      await page.waitForTimeout(2500);
      const html = await page.frameLocator('.ndvi-cfg-marco iframe').locator('html').evaluate((e) => e.outerHTML);
      fs.writeFileSync(OUT + 'informe_interanual.html', '<!doctype html>' + html);
      await page.screenshot({ path: `${OUT}informe_previa_1440.png` });
      const marco = page.frameLocator('.ndvi-cfg-marco iframe');
      res.informe.hojas = await marco.locator('.pagina').count();
      const txt = await marco.locator('body').innerText();
      res.informe.chars = txt.length;
      if (res.informe.hojas !== 4) hallazgo('alto', 'informe', `se esperaban 4 hojas y hay ${res.informe.hojas}`);
      for (const mal of ['NaN', 'undefined', 'Infinity', '[object Object]']) if (txt.includes(mal)) hallazgo('critico', 'informe', `aparece "${mal}"`);
      if (/un solo ciclo/i.test(txt)) hallazgo('alto', 'informe', 'aparece el aviso "un solo ciclo"');
      if (!txt.includes('S/D')) hallazgo('alto', 'informe', 'no contiene S/D (2020/2025/2026 deberian aparecer como S/D)');
      if (!/frontera completa/.test(txt)) hallazgo('alto', 'informe', 'falta la nota de que el NDVI es de la frontera del modulo');
      res.informe.logo = await marco.locator('.hdr img').count();
      if (!res.informe.logo) hallazgo('alto', 'informe', 'sin logo SRL en la cabecera');
      res.informe.logoMarron = (await marco.locator('h1').first().evaluate((e) => getComputedStyle(e).color));
      // cifra del informe contra la BD: pico M1 2026 debe estar en el texto
      const v2 = await rest('ndvi_modulo_mensual_v2?select=mes,ndvi_mediana&numero_modulo=eq.1&metodo=eq.scl-mediana-v1&mes=gte.2026-03&mes=lte.2026-09');
      const p26 = Math.max(...v2.map((x) => x.ndvi_mediana).filter((x) => x != null)).toFixed(3);
      res.informe.picoM1_2026_en_texto = txt.includes(p26);
      if (!txt.includes(p26)) hallazgo('critico', 'informe', `no aparece el pico M1 2026 (${p26}) de la BD`);
      await page.keyboard.press('Escape');
    } catch (e) { hallazgo('critico', 'informe', 'fallo: ' + String(e.message).slice(0, 200)); }
  }
  await ctx.close();
}

// ═══════════════ 4) Hojas del informe: capturas por hoja y PDF ═══════════════
try {
  const html = fs.readFileSync(OUT + 'informe_interanual.html', 'utf8');
  for (const w of [1100, 430]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 1000 } });
    const p = await ctx.newPage();
    await p.setContent(html, { waitUntil: 'load' });
    const hojas = p.locator('.pagina');
    const n = await hojas.count();
    if (w === 1100) for (let i = 0; i < n; i++) await hojas.nth(i).screenshot({ path: `${OUT}informe_hoja${i + 1}.png` });
    else { await p.screenshot({ path: `${OUT}informe_movil_430.png`, fullPage: true }); const o = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2); if (o) hallazgo('alto', 'informe movil', 'desborde horizontal en 430'); }
    if (w === 1100) {
      await p.emulateMedia({ media: 'print' });
      await p.pdf({ path: OUT + 'informe_interanual.pdf', format: 'Letter', printBackground: true, preferCSSPageSize: true });
      const pdf = fs.readFileSync(OUT + 'informe_interanual.pdf');
      const paginasPdf = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      res.informe.paginasPdf = paginasPdf;
      if (paginasPdf !== 4) hallazgo('medio', 'informe pdf', `el PDF sale en ${paginasPdf} paginas (esperadas 4: una hoja se desborda)`);
    }
    await ctx.close();
  }
} catch (e) { hallazgo('alto', 'informe hojas', 'fallo: ' + String(e.message).slice(0, 200)); }

await browser.close();
fs.writeFileSync(OUT + 'resultado.json', JSON.stringify(res, null, 2));
const crit = res.hallazgos.filter((h) => h.sev === 'critico' || h.sev === 'alto').length;
console.log(`\nIteracion ${iter}: ${res.hallazgos.length} hallazgos (${crit} criticos/altos). Cifras:`);
for (const c of res.cifras) console.log('  ', JSON.stringify(c));
console.log('informe:', JSON.stringify(res.informe));
