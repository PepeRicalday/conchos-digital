// Auditoría de SOLO LECTURA de «Agua entregada por cultivo» (ACUM_INF 2020-2024; iter4+: lectura simple, 2025 = sin ciclo): las 3 vistas del panel «Más agua, más vegetación» (GEO-MONITOR ·
// NDVI mensual por módulo) y el informe estadístico descargado desde el modal de informes NDVI.
//   node e2e/volumen-cultivo.mjs <iteracion>        (con `npm run dev` en :5173)
// Perfiles: Chromium 430 / 820 / 1440 y WebKit iPhone 15 Pro Max + iPad Pro 11. Detecta desborde horizontal, solapes entre piezas de las tarjetas KPI,
// texto < 11 px (HTML y SVG a escala real), objetivos táctiles < 36 px, errores de consola/red y textos basura (NaN, undefined, null).
// Cifras clave contra la BD viva (REST con anon key, solo SELECT), calculadas aquí de forma independiente.
// Salida: ../ciclo_2025_2026/auditoria/volumen_cultivo/iter<N>/ (capturas, informe descargado, PDF, resultado.json, bitacora.md).
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const iter = process.argv[2] || '1';
const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const OUT = fileURLToPath(new URL(`../../ciclo_2025_2026/auditoria/volumen_cultivo/iter${iter}/`, import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const res = { iter, hallazgos: [], cifras: [], perfiles: {} };
const hallazgo = (sev, donde, txt) => { res.hallazgos.push({ sev, donde, txt }); console.log(`[${sev}] ${donde}: ${txt}`); };
const cifra = (nombre, bd, pantalla) => {
  const ok = String(bd) === String(pantalla);
  res.cifras.push({ cifra: nombre, bd, pantalla, ok });
  if (!ok) hallazgo('critico', 'cifras', `${nombre}: BD ${bd} vs pantalla ${pantalla}`);
};

// ── BD viva (solo lectura) ──
const env = fs.readFileSync(RAIZ + '.env', 'utf8');
const leer = (k) => (env.match(new RegExp('^' + k + '="?([^"\\r\\n]+?)"?\\s*$', 'm')) || [])[1]?.trim();
const URL_SB = leer('VITE_SUPABASE_URL'), KEY = leer('VITE_SUPABASE_ANON_KEY');
const rest = async (q) => (await fetch(`${URL_SB}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json();
const sv = await rest('superficie_volumen_anual_modulo?select=anio,numero_modulo,cultivo,superficie_ha,volumen_miles_m3,atipico&limit=2000');
const prov = await rest('volumen_modulo_mensual_provisional?select=numero_modulo,mes,volumen_miles_m3,es_mes_parcial&mes=gte.2026-03&mes=lte.2026-09&limit=500');
const MODULOS = [1, 2, 3, 4, 5, 12];
const ANIOS = [...new Set(sv.map((r) => r.anio))].sort();
const ULT = ANIOS[ANIOS.length - 1];
const suma = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((p, q) => p + q, 0) : null; };
const mediana = (v) => { const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Cálculos independientes de lo que muestra la pantalla
const laminaDistrito = (() => { const r = sv.filter((x) => x.anio === ULT && x.superficie_ha != null && x.volumen_miles_m3 != null); return (suma(r.map((x) => x.volumen_miles_m3)) / suma(r.map((x) => x.superficie_ha))) * 10; })();
const celdasCultivo = (() => {
  const out = [];
  for (const c of [...new Set(sv.map((x) => x.cultivo))]) {
    const cel = ANIOS.map((a) => { const r = sv.filter((x) => x.cultivo === c && x.anio === a); if (!r.length) return null; const ha = suma(r.map((x) => x.superficie_ha)), mi = suma(r.map((x) => x.volumen_miles_m3)); const cero = mi === 0 && ha > 0; return { c, a, ha, cero, lam: ha > 0 && mi != null && !cero ? (mi / ha) * 10 : null, fuente: r.some((x) => x.atipico) }; }).filter(Boolean);
    const firmes = cel.filter((x) => (x.ha ?? 0) >= 50 && x.lam != null).map((x) => x.lam);
    let media = null, desv = null; if (firmes.length >= 2) { media = suma(firmes) / firmes.length; desv = Math.sqrt(firmes.reduce((p, q) => p + (q - media) ** 2, 0) / (firmes.length - 1)); }
    for (const x of cel) { x.chica = (x.ha ?? 0) < 50; x.lejos = media != null && desv > 0 && firmes.length >= 4 && !x.chica && x.lam != null && Math.abs(x.lam - media) / desv > 1.5; }
    out.push(...cel);
  }
  return out;
})();
const mayor = (() => { let b = null; for (const x of celdasCultivo.filter((y) => y.a === ULT && !y.chica && y.lam != null)) if (!b || x.lam > b.lam) b = x; return b; })();
const alertas = celdasCultivo.filter((x) => (x.lam != null || x.cero) && (x.lejos || x.chica || x.fuente || x.cero)).length;
const celdasLam = celdasCultivo.filter((x) => x.lam != null || x.cero).length;
const pctAN = (() => { const r = sv.filter((x) => x.anio === ULT); const t = suma(r.map((x) => x.volumen_miles_m3)); const an = suma(r.filter((x) => /^(alfalfa|nogal)/i.test(x.cultivo)).map((x) => x.volumen_miles_m3)); return (an / t) * 100; })();
const supTot = (a) => suma(sv.filter((x) => x.anio === a).map((x) => x.superficie_ha));
const veces = (() => { const s = ANIOS.map((a) => ({ a, ha: supTot(a) })); const mn = Math.min(...s.map((x) => x.ha)), mx = Math.max(...s.map((x) => x.ha)); const corte = (mn + mx) / 2; const alt = s.filter((x) => x.ha >= corte), baj = s.filter((x) => x.ha < corte); return { veces: suma(alt.map((x) => x.ha)) / alt.length / (suma(baj.map((x) => x.ha)) / baj.length), altos: alt.map((x) => x.a), bajos: baj.map((x) => x.a) }; })();
const volMod = (m, a) => { const r = sv.filter((x) => x.numero_modulo === m && x.anio === a && x.volumen_miles_m3 != null); return r.length ? suma(r.map((x) => x.volumen_miles_m3)) / 1000 : null; };
const vol26 = (m) => { const r = prov.filter((p) => p.numero_modulo === m); return r.length ? suma(r.map((p) => p.volumen_miles_m3)) / 1000 : null; };
const ciclo = (() => {
  let dentro = 0, sobre = 0, bajo = 0, act = 0, med = 0, n = 0;
  for (const m of MODULOS) {
    const h = ANIOS.map((a) => volMod(m, a)).filter((x) => x != null); const v = vol26(m);
    if (v == null || !h.length) continue;
    n++; act += v; med += mediana(h);
    if (v < Math.min(...h)) bajo++; else if (v > Math.max(...h)) sobre++; else dentro++;
  }
  return { dentro, sobre, bajo, n, act, med, pct: n ? ((act - med) / med) * 100 : null };
})();
const act26 = suma(MODULOS.map((m) => vol26(m)).filter((x) => x != null));
const lista = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} y ${a[a.length - 1]}`);
const num = (t) => Number(String(t).replace(/[^\d.\-−]/g, '').replace('−', '-'));

const PERFILES = [
  { id: 'chromium-1440', motor: chromium, ctx: { viewport: { width: 1440, height: 900 } } },
  { id: 'chromium-820', motor: chromium, ctx: { viewport: { width: 820, height: 1180 }, hasTouch: true } },
  { id: 'chromium-430', motor: chromium, ctx: { viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true } },
  { id: 'webkit-iphone', motor: webkit, ctx: { ...devices['iPhone 15 Pro Max'] } },
  { id: 'webkit-ipad', motor: webkit, ctx: { ...devices['iPad Pro 11'] } },
];
const IGNORA = /AUTH_BYPASS|WebSocket|realtime|favicon|tile|basemaps|cartocdn|sentinel|copernicus|dataspace|openstreetmap|gibs|earthdata|nasa|windy|\.map$/i;
function vigila(page, err, net) {
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORA.test(m.text()) && !IGNORA.test(m.location()?.url ?? '')) err.push(m.text().slice(0, 200) + ' @ ' + (m.location()?.url ?? '').slice(0, 100)); });
  page.on('pageerror', (e) => err.push('pageerror ' + String(e.message).slice(0, 200)));
  page.on('response', (r) => { if (r.status() >= 400 && !IGNORA.test(r.url())) net.push(`${r.status()} ${r.url().slice(0, 120)}`); });
}
async function abrirPanel(page) {
  await page.goto('http://localhost:5173/geo-monitor', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /Ver NDVI mensual por módulo/ }).click({ timeout: 20000 });
  await page.waitForSelector('.ndvi-gr .ndvi-gr-echarts canvas', { timeout: 30000 });
  await page.waitForTimeout(2200);
}


// El panel vive dentro de un modal con scroll: para ver TODO el panel se agranda el viewport un momento y se restituye.
async function captura(page, ruta) {
  const vp = page.viewportSize();
  try {
    await page.setViewportSize({ width: vp.width, height: 4200 });
    await page.waitForTimeout(350);
    await page.locator('.vv').screenshot({ path: ruta });
  } catch { /* la captura no es un criterio de aprobación */ }
  await page.setViewportSize(vp).catch(() => {});
  await page.waitForTimeout(250);
}

// ── medidores dentro de la página ──
const MEDIR = (raiz, minPx) => `(() => {
  const r0 = document.querySelector(${JSON.stringify(raiz)}); if (!r0) return null; const R = r0.getBoundingClientRect();
  const chicos = [], culpables = [];
  const w = document.createTreeWalker(r0, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; const t = n.textContent.trim(); const el = n.parentElement; if (!t || el.closest('.sr-only,.ndvi-sr-only')) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue; const b = el.getBoundingClientRect(); if (!b.width || !b.height) continue;
    let px = parseFloat(cs.fontSize);
    const svg = el.closest('svg'); if (svg && svg.viewBox?.baseVal?.width) px *= svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    if (px < ${minPx}) chicos.push({ t: t.slice(0, 28), px: +px.toFixed(2), clase: String(el.className?.baseVal ?? el.className).slice(0, 30) }); }
  for (const e of r0.querySelectorAll('*')) { const b = e.getBoundingClientRect(); if (b.width > 0 && b.height > 0 && b.right > R.right + 2 && !e.closest('.ndvi-ia-tabla-wrap,.tabla-wrap,canvas,.ndvi-chips')) culpables.push((e.className?.baseVal ?? e.className ?? e.tagName).toString().slice(0, 40)); }
  return { pagina: document.documentElement.scrollWidth > innerWidth + 2, contenedor: r0.scrollWidth > r0.clientWidth + 2, culpables: culpables.slice(0, 4), chicos };
})()`;
const SOLAPES = `(() => {
  const malos = [];
  const inter = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
  for (const t of document.querySelectorAll('.vc-kpi')) {
    const tb = t.getBoundingClientRect();
    if (t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1) malos.push('tarjeta desbordada: ' + t.innerText.slice(0, 30));
    const piezas = [...t.children].map((c) => ({ c, b: c.getBoundingClientRect() }));
    for (const p of piezas) if (p.b.right > tb.right + 1 || p.b.bottom > tb.bottom + 1) malos.push('pieza fuera de la tarjeta: ' + p.c.className);
    for (let i = 0; i < piezas.length; i++) for (let j = i + 1; j < piezas.length; j++) if (inter(piezas[i].b, piezas[j].b)) malos.push('solape en tarjeta: ' + piezas[i].c.className + ' x ' + piezas[j].c.className);
  }
  const ts = [...document.querySelectorAll('.vc-kpi')].map((t) => t.getBoundingClientRect());
  for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) if (inter(ts[i], ts[j])) malos.push('tarjetas KPI solapadas');
  return malos;
})()`;
const OBJETIVOS = `(() => [...document.querySelectorAll('.vv-vistas button, .vc-seg-btn, .vc-detalle > summary, .vc-comp-btn, .vc-chip-cu, .vv select')].map((e) => { const b = e.getBoundingClientRect(); return { t: (e.textContent || e.value || e.tagName).trim().slice(0, 24), w: Math.round(b.width), h: Math.round(b.height) }; }).filter((x) => x.h < 35.5 || x.w < 35.5))()`;
// Identidad de cultivo: cada ficha (.vc-ncu / chip / lectura) con ícono SVG con trazos, color propio y nombre escrito; el color de un cultivo es el mismo en todas las vistas.
const IDENTIDAD = String.raw`(() => [...document.querySelectorAll('.vv .vc-ncu, .vv .vc-chip-cu, .vv .vc-lectura li.vc-cu')].map((e) => {
  const ico = e.querySelector('.vc-ncu-ico'), svg = e.querySelector('svg.vc-ico');
  const nombre = (e.querySelector('.vc-ncu-txt')?.textContent ?? e.textContent).replace(/\s*\d+ %\s*$/, '').trim();
  return { nombre, color: ico ? getComputedStyle(ico).color : '', trazos: svg ? svg.querySelectorAll('path,ellipse,circle').length : 0, oculto: svg?.getAttribute('aria-hidden') === 'true', ancho: svg ? Math.round(svg.getBoundingClientRect().width) : 0 };
}))()`;
const COLOR_DE = {};
async function revisaIdentidad(page, D) {
  const fichas = await page.evaluate(IDENTIDAD);
  if (!fichas.length) { hallazgo('alto', D, 'no hay fichas de cultivo (ícono + nombre)'); return 0; }
  for (const x of fichas) {
    if (!x.nombre) hallazgo('alto', D, 'ficha de cultivo sin nombre escrito');
    if (!x.trazos || x.ancho < 14) hallazgo('alto', D, `cultivo «${x.nombre}» sin ícono visible (trazos ${x.trazos}, ancho ${x.ancho})`);
    if (!x.oculto) hallazgo('medio', D, `el ícono de «${x.nombre}» no es aria-hidden`);
    if (!x.color || /rgba\(0, 0, 0, 0\)|transparent/.test(x.color)) hallazgo('alto', D, `cultivo «${x.nombre}» sin color de identificación`);
    else if (!/^Otros/.test(x.nombre)) { const k = x.nombre; if (COLOR_DE[k] && COLOR_DE[k] !== x.color) hallazgo('alto', D, `«${k}» cambia de color entre vistas: ${COLOR_DE[k]} → ${x.color}`); COLOR_DE[k] = x.color; }
  }
  return fichas.length;
}
const MALOS_TXT = ['NaN', 'undefined', 'Infinity', '[object Object]'];
const hayNull = (t) => /(^|[^a-záéíóúñ])null([^a-záéíóúñ]|$)/.test(t);

async function revisar(page, D, raiz, r, minPx = 10.95) {
  const m = await page.evaluate(MEDIR(raiz, minPx));
  if (m && (m.pagina || m.contenedor || m.culpables.length)) hallazgo('alto', D, `desborde horizontal ${JSON.stringify({ pagina: m.pagina, contenedor: m.contenedor, culpables: m.culpables })}`);
  if (m && m.chicos.length) hallazgo('medio', D, `texto < 11 px: ${JSON.stringify(m.chicos.slice(0, 4))}`);
  const so = await page.evaluate(SOLAPES).catch(() => []);
  if (so.length) hallazgo('alto', D, `solapes: ${JSON.stringify([...new Set(so)].slice(0, 4))}`);
  const tg = await page.evaluate(OBJETIVOS);
  if (tg.length) hallazgo('alto', D, `objetivos táctiles < 36 px: ${JSON.stringify(tg)}`);
  const txt = await page.locator(raiz).first().innerText();
  for (const mal of MALOS_TXT) if (txt.includes(mal)) hallazgo('critico', D, `aparece "${mal}"`);
  if (hayNull(txt)) hallazgo('critico', D, 'aparece "null"');
  if (r) r.chicos = m?.chicos.length ?? 0;
  return txt;
}

// ═════════════ 1) Vistas del panel por perfil ═════════════
const VISTAS = [['lamina', 'Agua por hectárea'], ['mezcla', 'Mezcla de cultivos'], ['ciclo', 'Ciclo actual']];
const JERGA = /\d\.\d\s?×|\bpp\b|\brazón\b|lámina bruta|\bmediana\b|Diferencia \(pp\)|\baltos\b|\bbajos\b/i;
const abreDetalles = (page) => page.evaluate(() => document.querySelectorAll('.vv details').forEach((d) => { d.open = true; }));
let htmlInforme = null;
for (const P of PERFILES) {
  const browser = await P.motor.launch();
  const c = await browser.newContext({ ...P.ctx, serviceWorkers: 'block', acceptDownloads: true });
  const page = await c.newPage();
  const err = [], net = [];
  vigila(page, err, net);
  const r = {};
  try {
    await abrirPanel(page);
    await page.waitForSelector('.vv-vistas', { timeout: 30000 });
    {
      const D = `agua y ndvi ${P.id}`;
      const fila = await page.locator('.vv-tabla tbody tr', { has: page.locator('th', { hasText: /^2025$/ }) }).first().innerText().catch(() => '');
      if (!/Sin ciclo/.test(fila)) hallazgo('alto', D, `la fila 2025 no dice «Sin ciclo»: "${fila.replace(/\s+/g, ' ')}"`);
      if (/S\/D/.test(fila)) hallazgo('alto', D, `la fila 2025 trae S/D: "${fila.replace(/\s+/g, ' ')}"`);
      if (/sin riego de presa/.test(fila) === false) hallazgo('medio', D, 'el NDVI de 2025 no está rotulado «sin riego de presa»');
      const f20 = await page.locator('.vv-tabla tbody tr', { has: page.locator('th', { hasText: /^2020$/ }) }).first().innerText().catch(() => '');
      if (!/S\/D/.test(f20)) hallazgo('medio', D, 'el NDVI de 2020 (faltante real) debería seguir como S/D');
      const nota = await page.locator('.vv-comparabilidad').innerText().catch(() => '');
      if (/No hay informe de 2025/.test(nota) || !/sin ciclo/i.test(nota)) hallazgo('alto', D, 'la nota de comparabilidad no trata 2025 como sin ciclo');
      await captura(page, `${OUT}${P.id}_aguaNdvi.png`);
    }
    for (const [id, nombre] of VISTAS) {
      const D = `vistas ${P.id} ${id}`;
      await page.locator('.vv-vistas').scrollIntoViewIfNeeded();
      await page.getByRole('group', { name: 'Vista del panel' }).getByRole('button', { name: nombre }).click();
      await page.waitForSelector('.vc-kpi', { timeout: 15000 });
      if (id === 'ciclo') await page.waitForSelector('.vc-rango', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(900);
      const k = await page.locator('.vc-kpi').count();
      if (k !== 3) hallazgo('alto', D, `${k} tarjetas KPI (esperadas 3)`);
      const sinFrase = await page.locator('.vc-kpi').evaluateAll((els) => els.filter((e) => (e.querySelector('.vc-kpi-ctx')?.textContent ?? '').trim().length < 20 || !e.querySelector('.vc-estado svg') || !(e.querySelector('.vc-estado')?.textContent ?? '').trim()).length);
      if (sinFrase) hallazgo('alto', D, `${sinFrase} tarjetas KPI sin frase de lectura o sin estado con ícono y texto`);
      const txt = await revisar(page, D, '.vv', r);
      r[id] = {};
      if (id !== 'ciclo') r[id].fichas = await revisaIdentidad(page, D);
      if (await page.locator('.vv select').count()) hallazgo('alto', D, 'quedó un <select> nativo en el panel');
      if (id !== 'ciclo' && !(await page.locator('.vc-seg-btn').count())) hallazgo('alto', D, 'no hay botones segmentados');
      await abreDetalles(page); await page.waitForTimeout(150);
      const txtTodo = await page.locator('.vv').innerText();
      const jerga = txtTodo.match(JERGA);
      if (jerga) hallazgo('alto', D, `jerga prohibida: «${jerga[0]}»`);
      if (/por eso|explica\b|debido a|gracias a|a causa de/i.test(txtTodo.replace(/no explica|Describe, no explica/gi, ''))) hallazgo('alto', D, 'lenguaje causal');
      await page.evaluate(() => document.querySelectorAll('.vv details').forEach((d) => { d.open = false; }));
      const cifras = await page.locator('.vc-kpi-cifra').allInnerTexts();
      const ctx = await page.locator('.vc-kpi-ctx').allInnerTexts();
      r[id].kpi = cifras;
      // cifras clave contra la BD (solo una vez por vista, en el primer perfil de cada motor basta; se repiten en todos: barato)
      if (id === 'lamina') {
        cifra(`${P.id} lámina media ${ULT} (cm)`, Math.round(laminaDistrito), num(cifras[0]));
        cifra(`${P.id} cultivo de mayor lámina`, mayor.c, cifras[1].trim());
        cifra(`${P.id} lámina del cultivo mayor (cm)`, Math.round(mayor.lam), num(ctx[1].match(/(\d+)\s*cm/)?.[1]));
        cifra(`${P.id} cifras por revisar`, alertas, num(cifras[2].split(/\s/)[0]));
        cifra(`${P.id} cifras con dato (denominador)`, celdasLam, num(cifras[2].replace(/^\S+\s*(de)?/, '')));
        if (!/^Agua por hectárea en \d{4}/.test(await page.locator('.vc-kpi-et').first().innerText())) hallazgo('medio', D, 'la primera tarjeta no se titula «Agua por hectárea en AAAA»');
        // lámina de alfalfa del último año: celda de la tabla de detalle (plegada) = BD
        await abreDetalles(page);
        const alf = celdasCultivo.find((x) => x.c === 'Alfalfa' && x.a === ULT);
        const fila = page.locator('.vc-tabla tbody tr', { has: page.locator('th', { hasText: /^Alfalfa$/ }) }).first();
        const tdUlt = await fila.locator('td').nth(ANIOS.length - 1).innerText();
        cifra(`${P.id} lámina alfalfa ${ULT} (cm)`, Math.round(alf.lam), num(tdUlt.split('\n')[0]));
        // columna 2025 de la tabla: «Sin ciclo» en todas las filas, nunca S/D ni 0
        const idx25 = await page.locator('.vc-tabla thead th').allInnerTexts().then((h) => h.indexOf('2025'));
        const col25 = await page.locator('.vc-tabla tbody tr').evaluateAll((trs, i) => trs.map((tr) => tr.children[i]?.textContent.trim()), idx25);
        if (idx25 < 0 || !col25.length || col25.some((t) => t !== 'Sin ciclo')) hallazgo('alto', D, `columna 2025 de la tabla: ${JSON.stringify([...new Set(col25)])} (esperado solo «Sin ciclo»)`);
        await page.evaluate(() => document.querySelectorAll('.vv details').forEach((d) => { d.open = false; }));
        const puntos = await page.locator('.vc-track[role=img]').count();
        if (puntos < 3) hallazgo('alto', D, `solo ${puntos} filas de puntos con banda`);
        const filasLam = await page.locator('.vc-fila-lam').count();
        const conIco = await page.locator('.vc-fila-lam svg.vc-ico').count();
        if (!filasLam || conIco !== filasLam) hallazgo('alto', D, `filas de cultivo con ícono: ${conIco} de ${filasLam}`);
        const colsFila = await page.locator('.vc-fila-lam').evaluateAll((els) => els.map((e) => getComputedStyle(e.querySelector('.vc-pto')).backgroundColor));
        if (new Set(colsFila).size !== colsFila.length) hallazgo('alto', D, `dos filas de cultivo comparten color de punto: ${JSON.stringify(colsFila)}`);
        const sinAriaP = await page.locator('.vc-track[role=img]').evaluateAll((els) => els.filter((e) => !e.getAttribute('aria-label')).length);
        if (sinAriaP) hallazgo('alto', D, `${sinAriaP} filas de puntos sin aria-label`);
      } else if (id === 'mezcla') {
        cifra(`${P.id} % alfalfa+nogal ${ULT}`, Math.round(pctAN), num(cifras[0]));
        cifra(`${P.id} superficie total ${ULT} (ha)`, Math.round(supTot(ULT)), num(cifras[1]));
        const fraseBD = `En ${lista(veces.altos)} se regó`, finBD = `que en ${lista(veces.bajos)}.`;
        if (!ctx[2].startsWith(fraseBD) || !ctx[2].trim().endsWith(finBD)) hallazgo('alto', D, `frase de superficie: «${ctx[2]}» vs BD «${fraseBD} … ${finBD}»`);
        const cuant = veces.veces >= 2.15 ? 'Más del doble' : veces.veces >= 1.85 ? 'El doble' : veces.veces >= 1.6 ? 'Casi el doble' : `${veces.veces.toFixed(1)} veces`;
        cifra(`${P.id} cifra de superficie (de ${veces.veces.toFixed(2)}x)`, cuant, cifras[2].trim());
        // barras de participación: top 5 + otros, ordenadas, con %
        const pcts = await page.locator('.vc-part').first().locator('li .vc-part-val b').allInnerTexts();
        const nums = pcts.map(num);
        if (pcts.length < 2 || pcts.length > 6) hallazgo('alto', D, `barras de participación: ${pcts.length} renglones (esperado 2 a 6)`);
        const sinOtros = nums.slice(0, 5);
        if (sinOtros.some((v, i) => i > 0 && v > sinOtros[i - 1])) hallazgo('alto', D, `barras de agua no ordenadas: ${nums}`);
        const sumaP = nums.reduce((a, b) => a + b, 0);
        if (Math.abs(sumaP - 100) > 3) hallazgo('alto', D, `las barras de agua suman ${sumaP} % (esperado ≈100)`);
        // el cultivo líder y su % contra la BD
        const rowsAnio = sv.filter((x) => x.anio === ULT);
        const porCult = {}; for (const x of rowsAnio) porCult[x.cultivo] = (porCult[x.cultivo] ?? 0) + (x.volumen_miles_m3 ?? 0);
        const totV = suma(Object.values(porCult)); const lider = Object.entries(porCult).sort((a, b) => b[1] - a[1])[0];
        cifra(`${P.id} cultivo que más agua recibe ${ULT}`, lider[0], (await page.locator('.vc-part').first().locator('li .vc-part-nom').first().innerText()).trim());
        cifra(`${P.id} % del líder`, Math.round((lider[1] / totV) * 100), nums[0]);
        const filasPart = await page.locator('.vc-part li').count(), icoPart = await page.locator('.vc-part li svg.vc-ico').count();
        if (!filasPart || icoPart !== filasPart) hallazgo('alto', D, `barras de participación con ícono: ${icoPart} de ${filasPart}`);
        const barraCols = await page.locator('.vc-part').first().locator('li .vc-part-pista i').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundImage));
        if (barraCols.some((b) => !b || b === 'none')) hallazgo('alto', D, 'una barra de participación sin color propio');
        // apilada por año
        const filasComp = await page.locator('.vc-comp-btn').count();
        if (filasComp !== ANIOS.length) hallazgo('alto', D, `barras apiladas con informe: ${filasComp} (esperadas ${ANIOS.length})`);
        if ((await page.locator('.vc-comp-fila.hueco').count()) !== 2) hallazgo('alto', D, 'la apilada debe traer 2025 («sin ciclo») y 2026 («sin desglose») como huecos');
        const t25h = await page.locator('.vc-comp-fila.hueco').first().innerText();
        if (!/2025/.test(t25h) || !/Sin ciclo/.test(t25h) || /S\/D|\b0 hm/.test(t25h)) hallazgo('alto', D, `hueco de 2025 en la apilada: "${t25h.replace(/\s+/g, ' ')}"`);
        const lbls = await page.locator('.vc-comp-btn').evaluateAll((els) => els.map((e) => ({ l: e.getAttribute('aria-label'), n: e.querySelectorAll('.vc-segm').length })));
        for (const x of lbls) {
          const ps = [...(x.l ?? '').matchAll(/(\d+|<1) %/g)].map((m) => (m[1] === '<1' ? 0.5 : Number(m[1])));
          const sp = ps.reduce((a, b) => a + b, 0);
          if (!x.n || Math.abs(sp - 100) > 4) hallazgo('alto', D, `apilada «${x.l?.slice(0, 20)}»: suma ${sp} % con ${x.n} segmentos`);
        }
        // el último año de la apilada = BD
        const lbl24 = lbls[lbls.length - 1].l ?? '';
        const alf24 = (lbl24.match(/Alfalfa (\d+) %/) ?? [])[1];
        cifra(`${P.id} apilada: % alfalfa ${ULT}`, Math.round((porCult['Alfalfa'] / totV) * 100), Number(alf24));
        cifra(`${P.id} apilada: total ${ULT} (hm³)`, Math.round(totV / 1000), num((lbl24.match(/, ([\d,.]+) hm³/) ?? [])[1]));
        // interacción: resaltar un cultivo atenúa a los demás y cambia la lectura; tocar una barra cambia el año de la lectura
        await page.locator('.vc-chip-cu', { hasText: 'Nogal' }).click();
        const tenues = await page.locator('.vc-segm.tenue').count(), vivos = await page.locator('.vc-segm:not(.tenue)').count();
        if (!tenues || vivos !== ANIOS.length) hallazgo('alto', D, `resaltar «Nogal»: ${vivos} segmentos vivos (esperados ${ANIOS.length}) y ${tenues} atenuados`);
        if (!/Nogal: su parte/.test(await page.locator('.vc-lectura').innerText())) hallazgo('alto', D, 'la lectura no sigue al cultivo resaltado');
        await page.locator('.vc-chip-cu', { hasText: 'Nogal' }).click();
        await page.locator('.vc-comp-btn').first().click();
        if (!new RegExp(`^${ANIOS[0]}:`).test(await page.locator('.vc-lectura b').first().innerText())) hallazgo('alto', D, 'tocar la primera barra no cambia la lectura a su año');
        await page.locator('.vc-comp-btn').last().click();
        await page.locator('.vc-comp-btn').first().focus();
        if (!(await page.evaluate(() => document.activeElement?.classList.contains('vc-comp-btn')))) hallazgo('alto', D, 'las barras apiladas no reciben foco de teclado');
        // superficie: cambia la medida
        await page.getByRole('group', { name: 'Medir' }).getByRole('button', { name: 'Superficie regada' }).click();
        const sup24 = (await page.locator('.vc-comp-btn').last().getAttribute('aria-label')) ?? '';
        cifra(`${P.id} apilada: superficie ${ULT} (ha)`, Math.round(supTot(ULT)), num((sup24.match(/, ([\d,.]+) ha/) ?? [])[1]));
        await page.getByRole('group', { name: 'Medir' }).getByRole('button', { name: 'Agua entregada' }).click();
        // 2025: tarjeta de explicación, sin S/D ni cero
        await page.getByRole('group', { name: 'Año' }).getByRole('button', { name: /2025/ }).click();
        await page.waitForTimeout(400);
        const t25 = await page.locator('.vv').innerText();
        if (!(await page.locator('.vc-sinciclo').count())) hallazgo('alto', D, 'al elegir 2025 no aparece la tarjeta «sin ciclo»');
        if (!/2025: sin ciclo de riego/.test(t25) || !/No es un dato faltante/.test(t25)) hallazgo('alto', D, 'la tarjeta de 2025 no explica que no hubo ciclo');
        if (/S\/D/.test(t25)) hallazgo('alto', D, '2025 aparece con S/D');
        if (!/Sin ciclo/.test(await page.locator('.vc-col.sin-ciclo').first().innerText().catch(() => ''))) hallazgo('alto', D, 'la barra de 2025 no es un hueco rotulado «Sin ciclo»');
        if (await page.locator('.vc-kpi').count()) hallazgo('medio', D, 'con 2025 elegido no deben mostrarse tarjetas KPI');
        await captura(page, `${OUT}${P.id}_mezcla2025.png`);
        await page.getByRole('group', { name: 'Año' }).getByRole('button', { name: '2024', exact: true }).click();
        await page.waitForTimeout(300);
      } else {
        await page.waitForTimeout(800);
        const hayVol = ciclo.n > 0;
        if (hayVol) {
          const chips = await page.locator('.vc-mod .vc-chip').allInnerTexts();
          const cuenta = (re) => chips.filter((t) => re.test(t)).length;
          cifra(`${P.id} módulos dentro/arriba/debajo`, `${ciclo.dentro}/${ciclo.sobre}/${ciclo.bajo}`, `${cuenta(/Dentro del rango/)}/${cuenta(/Arriba del rango/)}/${cuenta(/Debajo del rango/)}`);
          cifra(`${P.id} módulos dentro del rango`, ciclo.dentro, num(cifras[2].split(' ')[0]));
          cifra(`${P.id} de cuántos módulos (denominador)`, MODULOS.length, num(cifras[2].split(' ').pop()));
          cifra(`${P.id} volumen 2026 mar–sep (hm³)`, act26.toFixed(1), num(cifras[0]).toFixed(1));
          cifra(`${P.id} volumen 2026 = 221.2 hm³ (cifra de la hoja SRL)`, '221.2', num(cifras[0]).toFixed(1));
          cifra(`${P.id} % frente a un año típico`, Math.round(Math.abs(ciclo.pct)), num(cifras[1]));
          cifra(`${P.id} menos/más`, ciclo.pct < 0 ? 'menos' : 'más', /menos/.test(cifras[1]) ? 'menos' : /más/.test(cifras[1]) ? 'más' : '?');
          if (!/2025 no cuenta/.test(ctx[1])) hallazgo('alto', D, 'la tarjeta del año típico no aclara que 2025 no cuenta');
        }
        const hueco = await page.locator('.vc-col.sin-ciclo').first().innerText().catch(() => '');
        if (!/Sin ciclo/.test(hueco) || !/presas cerradas/.test(hueco)) hallazgo('alto', D, `el hueco de 2025 no está rotulado «Sin ciclo / presas cerradas»: "${hueco}"`);
        if (await page.locator('.vc-col.provisional').count() !== 1) hallazgo('alto', D, 'falta la barra provisional de 2026');
        if (await page.locator('.vc-col.con-informe').count() !== ANIOS.length) hallazgo('alto', D, `barras con informe: ${await page.locator('.vc-col.con-informe').count()} (esperadas ${ANIOS.length})`);
        const rangos = await page.locator('.vc-rango').count();
        if (rangos !== MODULOS.length) hallazgo('alto', D, `${rangos} gráficos de rango (esperados ${MODULOS.length})`);
        const sinAria = await page.locator('.vc-rango').evaluateAll((els) => els.filter((e) => !e.getAttribute('aria-label')).length);
        if (sinAria) hallazgo('alto', D, `${sinAria} gráficos de rango sin aria-label`);
      }
      await captura(page, `${OUT}${P.id}_${id}.png`);
      r[id].texto = txt.length;
    }
    // ═════ 2) Informe: se descarga desde el modal (solo se baja una vez; luego se revisa en todos los perfiles) ═════
    if (!htmlInforme) {
      await page.getByRole('button', { name: /Informe institucional/ }).click({ timeout: 10000 });
      await page.waitForSelector('.ndvi-cfg', { timeout: 10000 });
      await page.waitForTimeout(400);
      const btn = page.getByRole('button', { name: /Descargar informe por cultivo/ });
      await btn.scrollIntoViewIfNeeded();
      const alto = await btn.evaluate((e) => Math.round(e.getBoundingClientRect().height));
      if (alto < 35.5) hallazgo('alto', `modal ${P.id}`, `botón del informe de ${alto} px (< 36)`);
      await page.locator('.ndvi-cfg').screenshot({ path: `${OUT}${P.id}_modal.png` }).catch(() => {});
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), btn.click()]);
      const ruta = `${OUT}informe_descargado.html`;
      await dl.saveAs(ruta);
      htmlInforme = fs.readFileSync(ruta, 'utf8');
      await page.waitForTimeout(500);
      const msg = await page.locator('.ndvi-cfg [role=status]').first().innerText().catch(() => '');
      if (!/Informe generado \(folio VCULT-/.test(msg)) hallazgo('medio', `modal ${P.id}`, `mensaje tras generar: "${msg}"`);
      res.nombreDescarga = dl.suggestedFilename();
    }
  } catch (e) { hallazgo('critico', P.id, `recorrido interrumpido: ${String(e.message).split('\n')[0]}`); await page.screenshot({ path: `${OUT}${P.id}_ERROR.png` }).catch(() => {}); }
  if (err.length) hallazgo('alto', P.id, `errores de consola: ${JSON.stringify(err.slice(0, 3))}`);
  if (net.length) hallazgo('medio', P.id, `respuestas ≥ 400: ${JSON.stringify([...new Set(net)].slice(0, 3))}`);
  res.perfiles[P.id] = r;
  await browser.close();
}

// ═════════════ 3) El informe descargado, en cada perfil ═════════════
if (htmlInforme) {
  const MEDIR_DOC = `(() => {
    const chicos = [], culp = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) { const n = w.currentNode; const t = n.textContent.trim(); const el = n.parentElement; if (!t || el.closest('script,style')) continue;
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue; const b = el.getBoundingClientRect(); if (!b.width || !b.height) continue;
      let px = parseFloat(cs.fontSize); const svg = el.closest('svg'); if (svg && svg.viewBox?.baseVal?.width) px *= svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      if (px < 9.95) chicos.push({ t: t.slice(0, 26), px: +px.toFixed(2) }); } // 7.5 pt = 10 px: piso del sistema de informes
    for (const p of document.querySelectorAll('.pagina')) { const R = p.getBoundingClientRect(); for (const e of p.querySelectorAll('*')) { const b = e.getBoundingClientRect(); if (b.width > 0 && b.right > R.right + 1 && !e.closest('.tabla-wrap,.fig')) culp.push((e.className?.baseVal ?? e.className ?? e.tagName).toString().slice(0, 30)); } }
    const hojas = [...document.querySelectorAll('.pagina')];
    return { chicos, culp: culp.slice(0, 5), pagina: document.documentElement.scrollWidth > innerWidth + 2, hojas: hojas.length,
      pies: [...document.querySelectorAll('.pie-pagina span:last-child')].map((s) => s.textContent.trim()),
      altos: hojas.map((h) => Math.round(h.getBoundingClientRect().height)), svgs: document.querySelectorAll('svg[role=img]').length,
      sinAria: [...document.querySelectorAll('svg[role=img]')].filter((s) => !s.getAttribute('aria-label')).length,
      logos: [...document.querySelectorAll('.mb img')].map((i) => ({ ok: i.complete && i.naturalWidth > 0, alt: i.alt })) };
  })()`;
  fs.writeFileSync(`${OUT}informe_para_revisar.html`, htmlInforme);
  const folio = (htmlInforme.match(/VCULT-[0-9A-F]{8}-\d{8}-\d{4}/) || [''])[0];
  res.informe = { folio, bytes: htmlInforme.length };
  // cifras del documento contra la BD
  const alf = celdasCultivo.find((x) => x.c === 'Alfalfa' && x.a === ULT);
  const textoDoc = htmlInforme.replace(/<[^>]+>/g, ' ');
  const tieneNum = (n) => new RegExp(`(^|[^\\d.,])${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',?')}([^\\d]|$)`).test(textoDoc);
  cifra('informe: lámina media del distrito en el resumen', true, tieneNum(Math.round(laminaDistrito)));
  cifra('informe: lámina alfalfa último año', true, tieneNum(Math.round(alf.lam)));
  cifra('informe: superficie total último año', true, tieneNum(Math.round(supTot(ULT))));
  cifra('informe: % alfalfa+nogal', true, new RegExp(`${Math.round(pctAN)}\\s*%`).test(textoDoc));
  cifra('informe: frase de superficie (años de más y de menos)', true, textoDoc.includes(`En ${lista(veces.altos)} se regó`) && textoDoc.includes(`que en ${lista(veces.bajos)}.`));
  cifra('informe: 2025 explicado como sin ciclo', true, /2025: sin ciclo de riego/.test(textoDoc) && /No es un dato faltante/.test(textoDoc));
  cifra('informe: sin jerga (×, pp, razón)', true, !/\d\.\d\s?×|\bpp\b|\brazón\b|Diferencia \(pp\)/.test(textoDoc));
  if (ciclo.n) cifra('informe: volumen actual (hm³)', true, textoDoc.includes(ciclo.act.toFixed(1)));
  for (const mal of MALOS_TXT) if (textoDoc.includes(mal)) hallazgo('critico', 'informe', `aparece "${mal}"`);
  if (hayNull(textoDoc)) hallazgo('critico', 'informe', 'aparece "null"');
  {
    const nIco = (htmlInforme.match(/class="ico-cul"/g) ?? []).length;
    cifra('informe: íconos de cultivo (>= 20 en tablas, leyenda y paneles)', true, nIco >= 20);
    cifra('informe: trama distintiva en la apilada (pattern)', true, /<pattern id="tr-mz-/.test(htmlInforme));
    const nombres = [...new Set(sv.map((x) => x.cultivo))];
    const sinIcono = nombres.filter((n) => !new RegExp(`class="ico-cul"[^>]*>[^]*?</svg>${n}</th>`).test(htmlInforme));
    cifra('informe: cada cultivo con ícono en su encabezado de fila', '', sinIcono.join(','));
    cifra('informe: leyenda de cultivos con ícono', true, /aria-label="Leyenda de cultivos"><li[^>]*><i class="sw"[^>]*><\/i><svg class="ico-cul"/.test(htmlInforme));
  }
  if (!/Anexo A/.test(textoDoc) || !/Anexo B/.test(textoDoc)) hallazgo('alto', 'informe', 'faltan los anexos A/B');

  for (const P of PERFILES) {
    const browser = await P.motor.launch();
    const c = await browser.newContext({ ...P.ctx, serviceWorkers: 'block' });
    const page = await c.newPage();
    const err = []; vigila(page, err, []);
    const D = `informe ${P.id}`;
    await page.setContent(htmlInforme, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    const m = await page.evaluate(MEDIR_DOC);
    if (m.pagina) hallazgo('alto', D, 'desborde horizontal de la página');
    if (m.culp.length) hallazgo('alto', D, `contenido fuera de la hoja: ${JSON.stringify(m.culp)}`);
    if (m.chicos.length) hallazgo('medio', D, `texto < 7.5 pt (10 px): ${JSON.stringify(m.chicos.slice(0, 4))}`);
    if (m.sinAria) hallazgo('alto', D, `${m.sinAria} gráficos sin aria-label`);
    if (m.logos.length !== 2 || m.logos.some((l) => !l.ok)) hallazgo('alto', D, `logos del membrete: ${JSON.stringify(m.logos)}`);
    m.pies.forEach((p, i) => { if (p !== `Pág. ${i + 1} de ${m.hojas}`) hallazgo('alto', D, `pie ${i + 1}: "${p}"`); });
    if (err.length) hallazgo('alto', D, `errores de consola: ${JSON.stringify(err.slice(0, 2))}`);
    res.perfiles[P.id].informe = { hojas: m.hojas, altos: m.altos, svgs: m.svgs, chicos: m.chicos.length };
    const hojas = page.locator('.pagina');
    for (let i = 0; i < m.hojas; i++) await hojas.nth(i).screenshot({ path: `${OUT}informe_${P.id}_h${i + 1}.png` }).catch(() => {});
    if (P.id === 'chromium-1440') {
      await page.pdf({ path: `${OUT}informe.pdf`, format: 'Letter', printBackground: true, preferCSSPageSize: true });
      const bytes = fs.readFileSync(`${OUT}informe.pdf`);
      const paginasPdf = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
      res.informe.paginasPdf = paginasPdf;
      if (paginasPdf < m.hojas) hallazgo('medio', D, `PDF con ${paginasPdf} páginas físicas para ${m.hojas} hojas`);
    }
    await browser.close();
  }
}

fs.writeFileSync(`${OUT}resultado.json`, JSON.stringify(res, null, 2));
const sev = (s) => res.hallazgos.filter((h) => h.sev === s).length;
const fallas = res.cifras.filter((x) => !x.ok).length;
const md = `# Bitácora · Agua entregada por cultivo (iteración ${iter})

- Perfiles: ${PERFILES.map((p) => p.id).join(', ')}
- Hallazgos: ${res.hallazgos.length} (críticos ${sev('critico')}, altos ${sev('alto')}, medios ${sev('medio')})
- Cifras contra la BD: ${res.cifras.length - fallas} de ${res.cifras.length} coinciden
- Informe: ${res.informe ? `${res.informe.folio}, ${res.informe.paginasPdf ?? '?'} páginas físicas en PDF` : 'no se pudo descargar'}

## Hallazgos
${res.hallazgos.length ? res.hallazgos.map((h) => `- [${h.sev}] ${h.donde}: ${h.txt}`).join('\n') : '- Ninguno.'}

## Cifras
${res.cifras.map((x) => `- ${x.ok ? 'OK ' : 'FALLA'} ${x.cifra}: BD ${x.bd} · pantalla ${x.pantalla}`).join('\n')}
`;
fs.writeFileSync(`${OUT}bitacora.md`, md);
console.log(`\nHallazgos: ${res.hallazgos.length} · cifras ${res.cifras.length - fallas}/${res.cifras.length} · salida ${OUT}`);
process.exit(res.hallazgos.length ? 1 : 0);
