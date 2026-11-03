// Auditoría de SOLO LECTURA de «Consumo por cultivo» (ACUM_INF 2020-2024): las 3 vistas del panel «Más agua, más vegetación» (GEO-MONITOR ·
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
    const cel = ANIOS.map((a) => { const r = sv.filter((x) => x.cultivo === c && x.anio === a); if (!r.length) return null; const ha = suma(r.map((x) => x.superficie_ha)), mi = suma(r.map((x) => x.volumen_miles_m3)); return { c, a, ha, lam: ha > 0 && mi != null ? (mi / ha) * 10 : null, fuente: r.some((x) => x.atipico) }; }).filter(Boolean);
    const firmes = cel.filter((x) => (x.ha ?? 0) >= 50 && x.lam != null).map((x) => x.lam);
    let media = null, desv = null; if (firmes.length >= 2) { media = suma(firmes) / firmes.length; desv = Math.sqrt(firmes.reduce((p, q) => p + (q - media) ** 2, 0) / (firmes.length - 1)); }
    for (const x of cel) { x.chica = (x.ha ?? 0) < 50; x.lejos = media != null && desv > 0 && firmes.length >= 4 && !x.chica && x.lam != null && Math.abs(x.lam - media) / desv > 1.5; }
    out.push(...cel);
  }
  return out;
})();
const mayor = (() => { let b = null; for (const x of celdasCultivo.filter((y) => y.a === ULT && !y.chica && y.lam != null)) if (!b || x.lam > b.lam) b = x; return b; })();
const alertas = celdasCultivo.filter((x) => x.lam != null && (x.lejos || x.chica || x.fuente)).length;
const celdasLam = celdasCultivo.filter((x) => x.lam != null).length;
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
const OBJETIVOS = `(() => [...document.querySelectorAll('.vv-vistas button, .vc-sel select')].map((e) => { const b = e.getBoundingClientRect(); return { t: (e.textContent || e.value || e.tagName).trim().slice(0, 24), w: Math.round(b.width), h: Math.round(b.height) }; }).filter((x) => x.h < 35.5 || x.w < 35.5))()`;
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
const VISTAS = [['lamina', 'Lámina por cultivo'], ['mezcla', 'Mezcla de cultivos'], ['ciclo', 'Ciclo actual']];
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
    for (const [id, nombre] of VISTAS) {
      const D = `vistas ${P.id} ${id}`;
      await page.locator('.vv-vistas').scrollIntoViewIfNeeded();
      await page.getByRole('group', { name: 'Vista del panel' }).getByRole('button', { name: nombre }).click();
      await page.waitForSelector('.vc-kpi', { timeout: 15000 });
      if (id === 'ciclo') await page.waitForSelector('.vc-rango', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(900);
      const k = await page.locator('.vc-kpi').count();
      if (k !== 3) hallazgo('alto', D, `${k} tarjetas KPI (esperadas 3)`);
      const txt = await revisar(page, D, '.vv', r);
      r[id] = {};
      const cifras = await page.locator('.vc-kpi-cifra').allInnerTexts();
      const ctx = await page.locator('.vc-kpi-ctx').allInnerTexts();
      r[id].kpi = cifras;
      // cifras clave contra la BD (solo una vez por vista, en el primer perfil de cada motor basta; se repiten en todos: barato)
      if (id === 'lamina') {
        cifra(`${P.id} lámina media ${ULT} (cm)`, Math.round(laminaDistrito), num(cifras[0]));
        cifra(`${P.id} cultivo de mayor lámina`, mayor.c, cifras[1].trim());
        cifra(`${P.id} lámina del cultivo mayor (cm)`, Math.round(mayor.lam), num(ctx[1].match(/(\d+)\s*cm/)?.[1]));
        cifra(`${P.id} celdas con alerta`, alertas, num(cifras[2].split(/\s/)[0]));
        cifra(`${P.id} celdas con lámina`, celdasLam, num(cifras[2].replace(/^\S+\s*(de)?/, '')));
        // lámina de alfalfa del último año: celda de la tabla = BD
        const alf = celdasCultivo.find((x) => x.c === 'Alfalfa' && x.a === ULT);
        const fila = page.locator('.vc-tabla tbody tr', { has: page.locator('th', { hasText: /^Alfalfa$/ }) }).first();
        const tdUlt = await fila.locator('td').nth(ANIOS.length - 1).innerText();
        cifra(`${P.id} lámina alfalfa ${ULT} (cm)`, Math.round(alf.lam), num(tdUlt.split('\n')[0]));
        const minis = await page.locator('.vc-mini').count();
        if (!minis) hallazgo('medio', D, 'no hay mini-barras en la tabla');
      } else if (id === 'mezcla') {
        cifra(`${P.id} % alfalfa+nogal ${ULT}`, Math.round(pctAN), num(cifras[0]));
        cifra(`${P.id} superficie total ${ULT} (ha)`, Math.round(supTot(ULT)), num(cifras[1]));
        cifra(`${P.id} veces altos/bajos`, veces.veces.toFixed(1), num(cifras[2]).toFixed(1));
        if (!ctx[2].includes(veces.altos.join(', ')) || !ctx[2].includes(veces.bajos.join(', '))) hallazgo('alto', D, `años altos/bajos en la tarjeta: ${ctx[2]} vs BD ${veces.altos}/${veces.bajos}`);
      } else {
        await page.waitForTimeout(800);
        const hayVol = ciclo.n > 0;
        if (hayVol) {
          cifra(`${P.id} módulos dentro/sobre/bajo`, `${ciclo.dentro}/${ciclo.sobre}/${ciclo.bajo}`, (await page.locator('.vc-pos b').allInnerTexts()).slice(0, 3).join('/'));
          cifra(`${P.id} módulos comparados`, ciclo.n, num(cifras[0].split(' ')[0]) + num(0));
          cifra(`${P.id} volumen actual (hm³)`, ciclo.act.toFixed(1), num(cifras[1]).toFixed(1));
          cifra(`${P.id} % vs mediana`, Math.round(ciclo.pct), num(cifras[2]));
        }
        const rangos = await page.locator('.vc-rango').count();
        if (rangos !== MODULOS.length) hallazgo('alto', D, `${rangos} gráficos de rango (esperados ${MODULOS.length})`);
        const sinAria = await page.locator('.vc-rango').evaluateAll((els) => els.filter((e) => !e.getAttribute('aria-label')).length);
        if (sinAria) hallazgo('alto', D, `${sinAria} gráficos de rango sin aria-label`);
      }
      await page.locator('.vv').screenshot({ path: `${OUT}${P.id}_${id}.png` }).catch(() => {});
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
  cifra('informe: veces altos/bajos', true, textoDoc.includes(`${veces.veces.toFixed(1)}×`) || textoDoc.includes(`${veces.veces.toFixed(1)} veces`));
  if (ciclo.n) cifra('informe: volumen actual (hm³)', true, textoDoc.includes(ciclo.act.toFixed(1)));
  for (const mal of MALOS_TXT) if (textoDoc.includes(mal)) hallazgo('critico', 'informe', `aparece "${mal}"`);
  if (hayNull(textoDoc)) hallazgo('critico', 'informe', 'aparece "null"');
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
const md = `# Bitácora · Consumo por cultivo (iteración ${iter})

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
