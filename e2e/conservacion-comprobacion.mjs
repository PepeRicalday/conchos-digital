// SICA Conservación · comprobación por tramo de DIAG-01 (Playwright, solo lectura).
//   Uso:  node e2e/conservacion-comprobacion.mjs [desktop|ipad|iphone|all]     (requiere `npm run dev` en :5173)
// Abre «Comprobación por tramo», recorre los conceptos de canales de la SRL, y mide errores de consola/red y desbordes.
// T-01 (2026-10-10): recorre también la red de caminos de la SRL (dibujo de calzada, ecuación coloreada, motivo de lo no evaluable,
// texto >= 12 px, sin desborde). Sale con código 1 si algo falla.
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = new URL('./out/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const sel = process.argv.find((a) => ['desktop', 'ipad', 'iphone', 'all'].includes(a)) ?? 'all';
const fallos = [];
const verifica = (nombre, cond, detalle = '') => { if (!cond) fallos.push(`${nombre}${detalle ? ` · ${detalle}` : ''}`); return cond; };
const VPS = {
  desktop: { viewport: { width: 1440, height: 900 }, opts: {} },
  ipad: { viewport: { width: 1180, height: 820 }, opts: { hasTouch: true } },
  iphone: { viewport: { width: 440, height: 956 }, opts: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
};
const IGNORE = /AUTH_BYPASS|WebSocket|realtime|\[vite\]|DevTools|favicon|supabase/i;
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
  const rec = {};
  await page.addInitScript(() => { try { sessionStorage.clear(); } catch { /* nada */ } });
  await page.goto('http://localhost:5173/conservacion?seccion=derivacion', { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForSelector('.cons-der-slots', { timeout: 120000 }).catch(() => { rec.sinCarga = true; });
  await page.getByRole('tab', { name: /Comprobación por tramo/ }).click(); await page.waitForTimeout(500);
  await page.setViewportSize({ width: vp.viewport.width, height: nombre === 'desktop' ? 2000 : 3000 });
  const conceptos = await page.locator('#cons-comp-con option').allInnerTexts();
  rec.conceptos = conceptos;
  for (let i = 0; i < conceptos.length; i++) {
    await page.selectOption('#cons-comp-con', { index: i }); await page.waitForTimeout(300);
    const t = conceptos[i].replace(/[^A-Za-z]+/g, '_').slice(0, 14);
    rec[`tramos_${t}`] = await page.locator('.cons-comp-ficha').count();
    rec[`filaTabla_${t}`] = await page.locator('.cons-comp-fila-sel').count();
    await page.locator('.cons-comp').screenshot({ path: fileURLToPath(new URL(`comprobacion_${nombre}_${i}_${t}.png`, OUT)) });
  }
  // Un tramo atípico por el control (descopete que excede al desazolve) y uno atípico por criterio (desazolve)
  for (const [concepto, etiqueta] of [[2, 'descopete'], [1, 'desazolve']]) {
    await page.selectOption('#cons-comp-con', { index: concepto });
    await page.getByRole('button', { name: /Solo atípicos/ }).click(); await page.waitForTimeout(300);
    rec[`atipicos_${etiqueta}`] = await page.locator('.cons-comp-ficha .cc-estados').first().innerText();
    await page.locator('.cons-comp').screenshot({ path: fileURLToPath(new URL(`comprobacion_${nombre}_atipico_${etiqueta}.png`, OUT)) });
    await page.getByRole('button', { name: /Solo atípicos/ }).click();
  }

  // ── Caminos de la SRL (T-01) ──
  await page.selectOption('#cons-comp-red', { label: 'Red de caminos' }); await page.waitForTimeout(300);
  const quien = (t) => `${nombre} · caminos · ${t}`;
  const cam = await page.locator('#cons-comp-con option').allInnerTexts();
  rec.caminos = { conceptos: cam, tramos: {} };
  const medirFicha = () => page.evaluate(() => {
    const f = document.querySelector('.cons-comp-ficha');
    const svg = f?.querySelector('.cons-comp-dibujo svg') ?? null;
    const w = svg ? svg.getBoundingClientRect().width : 0;
    const vb = svg ? svg.viewBox.baseVal.width : 1;
    const textosSvg = svg ? [...svg.querySelectorAll('text')].map((t) => ({ t: t.textContent, px: Math.round(parseFloat(t.getAttribute('font-size')) * (w / vb) * 10) / 10 })) : [];
    const chico = [];
    f?.querySelectorAll('*').forEach((el) => {
      if (el.closest('svg, .scada-action-btn')) return;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < 11.95) chico.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 20)} ${px}px "${el.textContent.trim().slice(0, 16)}"`);
    });
    const tokens = [...(f?.querySelectorAll('.cons-ec-dato') ?? [])].map((e) => e.getAttribute('data-origen'));
    return {
      texto: f?.innerText ?? '', hayDibujo: svg !== null, aria: svg?.getAttribute('aria-label') ?? '', textosSvg, chico: [...new Set(chico)].slice(0, 8), tokens,
      resultado: f?.querySelector('.cons-ec-res b')?.textContent ?? null, estados: f?.querySelector('.cc-estados')?.innerText ?? '',
      motivo: f?.querySelector('.cons-motivo')?.innerText ?? '', ley: f?.querySelector('.cons-leyenda')?.innerText ?? '',
      overflowX: document.documentElement.scrollWidth > innerWidth + 2,
    };
  });
  const filasCam = {};
  for (let i = 0; i < cam.length; i++) {
    await page.selectOption('#cons-comp-con', { index: i }); await page.waitForTimeout(250);
    const opts = await page.locator('#cons-comp-tramo option').evaluateAll((o) => o.map((x) => x.value));
    for (const fila of opts) {
      await page.selectOption('#cons-comp-tramo', fila); await page.waitForTimeout(200);
      const m = await medirFicha();
      filasCam[`${cam[i]}|${fila}`] = m;
      rec.caminos.tramos[`${cam[i]}|${fila}`] = { dibujo: m.hayDibujo, tokens: m.tokens.length, resultado: m.resultado, motivo: m.motivo.slice(0, 70), svgMin: m.textosSvg.length ? Math.min(...m.textosSvg.map((x) => x.px)) : null };
      verifica(quien(`${cam[i]} f${fila}: texto ≥ 12 px`), m.chico.length === 0, m.chico.join(' | '));
      verifica(quien(`${cam[i]} f${fila}: texto del dibujo ≥ 12 px`), m.textosSvg.every((x) => x.px >= 12), JSON.stringify(m.textosSvg.filter((x) => x.px < 12)));
      verifica(quien(`${cam[i]} f${fila}: sin desborde horizontal`), !m.overflowX);
    }
  }
  const F = (c, f) => filasCam[`${c}|${f}`];
  const rep = cam.find((c) => /Reposici/.test(c)), conf = cam.find((c) => /Conformaci/.test(c)), ter = cam.find((c) => /Terracer/.test(c)), ras = cam.find((c) => /Rastreo/.test(c));
  verifica(quien('Reposición f98: dibujo con ancho 6.00 m y espesor «(inferencia)»'), !!F(rep, 98)?.hayDibujo && /ancho 6\.00 m/.test(F(rep, 98).aria) && F(rep, 98).textosSvg.some((x) => /espesor 0\.15 m \(inferencia\)/.test(x.t)));
  verifica(quien('Reposición f98: ecuación 150 · 6 · 98.951 con los tres orígenes'), F(rep, 98)?.tokens.join(',') === 'parametro_libre,inventario,diagnostico' && /89[,.]055[.,]9/.test(F(rep, 98)?.resultado ?? ''), `${F(rep, 98)?.tokens} ${F(rep, 98)?.resultado}`);
  verifica(quien('Reposición f98: dice que el 150 es una inferencia'), /El 150 es una inferencia/.test(F(rep, 98)?.texto ?? ''));
  verifica(quien('Reposición f98: leyenda con lo ilustrativo y la nota del libro'), /ilustrativas/.test(F(rep, 98)?.ley ?? '') && /no trae medidas de bermas ni cunetas/.test(F(rep, 98)?.ley ?? ''));
  verifica(quien('Reposición f102: 1,881 m³'), /^1[,.]?881$/.test((F(rep, 102)?.resultado ?? '').replace(/\s/g, '')), F(rep, 102)?.resultado);
  verifica(quien('Reposición f100 (terracería): coherente, 0 y «terracería: no lleva revestimiento»'), /terracería: no lleva revestimiento/.test(F(rep, 100)?.texto ?? '') && F(rep, 100)?.resultado === '0' && /Coherente/.test(F(rep, 100)?.estados ?? ''), `${F(rep, 100)?.resultado} ${F(rep, 100)?.estados}`);
  verifica(quien('Reposición f100: dibujo sin espesor inferido'), !!F(rep, 100)?.hayDibujo && !F(rep, 100).textosSvg.some((x) => /inferencia/.test(x.t)));
  for (const [c, nom] of [[conf, 'Conformación'], [ras, 'Rastreo']]) {
    verifica(quien(`${nom} f98 y f102: dibujo y 1 × L`), !!F(c, 98)?.hayDibujo && !!F(c, 102)?.hayDibujo && F(c, 98).tokens.length === 2);
    verifica(quien(`${nom} f100: no evaluable por muestra insuficiente, sin dibujo`), !F(c, 100)?.hayDibujo && /Muestra insuficiente/.test(F(c, 100)?.motivo ?? ''), F(c, 100)?.motivo);
  }
  for (const f of [98, 100, 102]) verifica(quien(`Terracerías f${f}: no evaluable por unidad sospechosa (sin convertir)`), !F(ter, f)?.hayDibujo && /unidad sospechosa: el valor equivale a 1·L y 2·L expresados en km/.test(F(ter, f)?.motivo ?? '') && F(ter, f).resultado === null);
  await page.selectOption('#cons-comp-con', { index: cam.indexOf(rep) }); await page.selectOption('#cons-comp-tramo', '98'); await page.waitForTimeout(300);
  await page.locator('.cons-comp-ficha').screenshot({ path: fileURLToPath(new URL(`comprobacion_${nombre}_camino_reposicion.png`, OUT)) });
  await page.selectOption('#cons-comp-tramo', '100'); await page.waitForTimeout(300);
  await page.locator('.cons-comp-ficha').screenshot({ path: fileURLToPath(new URL(`comprobacion_${nombre}_camino_terraceria.png`, OUT)) });

  // ── Obras puntuales (T-02/T-03): estructuras y edificios con el modelo por-pieza ──
  const op = (t) => `${nombre} · obras puntuales · ${t}`;
  const medirOP = () => page.evaluate(() => {
    const f = document.querySelector('.op-ficha');
    if (!f) return null;
    const chico = [], pequenos = [];
    f.querySelectorAll('*').forEach((el) => {
      if (el.closest('svg')) return;
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return;
      if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
        const px = parseFloat(getComputedStyle(el).fontSize);
        if (px < 11.95) chico.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 20)} ${px}px "${el.textContent.trim().slice(0, 16)}"`);
      }
    });
    for (const el of [...f.querySelectorAll('button, select, a[href]'), ...document.querySelectorAll('#cons-comp-amb, #cons-comp-red, #cons-comp-con')]) {
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
      if (r.height < 43.5) pequenos.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 18)} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent || el.id).trim().slice(0, 16)}"`);
    }
    const tokens = [...f.querySelectorAll('.cons-ec-dato')].map((e) => e.getAttribute('data-origen'));
    return {
      texto: f.innerText, chico: [...new Set(chico)].slice(0, 8), pequenos: [...new Set(pequenos)].slice(0, 8), tokens,
      resultados: [...f.querySelectorAll('.cons-comp-resultado dd')].map((d) => d.innerText.replace(/\s+/g, ' ').trim()),
      estados: f.querySelector('.cc-estados')?.innerText ?? '', barra: document.querySelector('.cc-barra')?.textContent ?? '',
      nFilas: f.querySelectorAll('.cons-inv-lista > li').length, overflowX: document.documentElement.scrollWidth > innerWidth + 2,
      leyenda: [...f.querySelectorAll('.cons-leyfam-it')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()),
    };
  });
  // Navegación con teclado: la red «Obras puntuales» se elige sin ratón (End = última opción del selector).
  await page.focus('#cons-comp-red'); await page.keyboard.press('End'); await page.waitForTimeout(500);
  verifica(op('el teclado (End) elige «Obras puntuales»'), (await page.inputValue('#cons-comp-red')) === 'obras' && (await page.locator('.op-ficha').count()) === 1);
  await page.keyboard.press('Tab');
  verifica(op('el foco pasa al selector de concepto'), (await page.evaluate(() => document.activeElement?.id)) === 'cons-comp-con');
  const nombresOP = await page.locator('#cons-comp-con option').allInnerTexts();
  rec.obras = { conceptos: nombresOP, fichas: {} };
  verifica(op('conceptos: obra civil, compuertas, edificios y comunicaciones'), nombresOP.length === 4 && /obra civil/i.test(nombresOP[0]) && /compuertas/i.test(nombresOP[1]) && /edificios/i.test(nombresOP[2]) && /comunicaci/i.test(nombresOP[3]), nombresOP.join(' | '));
  for (let i = 0; i < nombresOP.length; i++) {
    await page.keyboard.press(i === 0 ? 'Home' : 'ArrowDown'); await page.waitForTimeout(350);
    const m = await medirOP();
    rec.obras.fichas[nombresOP[i]] = { resultados: m?.resultados, estados: m?.estados.replace(/\s+/g, ' ').slice(0, 120), tokens: m?.tokens.length, leyenda: m?.leyenda };
    verifica(op(`${nombresOP[i]}: ficha visible`), m !== null);
    if (m === null) continue;
    verifica(op(`${nombresOP[i]}: texto ≥ 12 px`), m.chico.length === 0, m.chico.join(' | '));
    verifica(op(`${nombresOP[i]}: objetivos ≥ 44 px`), m.pequenos.length === 0, m.pequenos.join(' | '));
    verifica(op(`${nombresOP[i]}: sin desborde horizontal`), !m.overflowX);
    verifica(op(`${nombresOP[i]}: barra de contexto con concepto y grupo`), /Obras puntuales/.test(m.barra) && m.barra.includes('Todo el concepto'), m.barra.slice(0, 120));
    verifica(op(`${nombresOP[i]}: sin «no verificada» ni «correcto»`), !/no verificada|correcto|aprobado|conforme|válido/.test(m.texto));
    await page.locator('.cons-comp').screenshot({ path: fileURLToPath(new URL(`obras_${nombre}_${i}.png`, OUT)) });
  }
  await page.selectOption('#cons-comp-con', { index: 0 }); await page.waitForTimeout(350);
  const oc = await medirOP();
  verifica(op('obra civil: 385 / 385 / 0'), oc.resultados.join('|') === '385 pza|385 pza|0 pza', oc.resultados.join('|'));
  verifica(op('obra civil: coherente con el inventario'), /Coherente/.test(oc.estados) && !/Atípico/.test(oc.estados), oc.estados);
  verifica(op('obra civil: leyenda de familias 149/14/42/163/16/1'), ['149', '14', '42', '163', '16', '1'].every((n) => oc.leyenda.some((l) => new RegExp(`\\b${n}$`).test(l))), oc.leyenda.join(' | '));
  verifica(op('obra civil: ecuación con inventario, 3DN y PacOT'), ['inventario', 'diagnostico', 'parametro_libre'].every((o) => oc.tokens.includes(o)));
  await page.selectOption('#op-grupo', 'fam:proteccion'); await page.waitForTimeout(300);
  const gp = await medirOP();
  verifica(op('grupo Protección: 163 de 385 y barra con el grupo'), /163 de 385/.test(gp.texto) && /Protección y conducción/.test(gp.barra), gp.barra.slice(0, 160));
  verifica(op('grupo Protección: reparto proporcional rotulado'), /reparto proporcional, no una cifra del libro/.test(gp.texto));
  verifica(op('grupo Protección: lista paginada (25) con «Mostrar más»'), gp.nFilas === 25 && (await page.getByRole('button', { name: /Mostrar \d+ más/ }).count()) === 1, String(gp.nFilas));
  verifica(op('grupo Protección: marca las ambiguas'), /tipo ambiguo/.test(gp.texto));
  const ver = page.locator('.op-lista .cons-inv-ver').first();
  if (await ver.count()) {
    await ver.click(); await page.waitForSelector('.cons-ubic', { timeout: 15000 }).catch(() => {});
    verifica(op('«Ver» abre la ventana de ubicación'), (await page.locator('.cons-ubic').count()) === 1);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    verifica(op('Escape cierra la ventana'), (await page.locator('.cons-ubic').count()) === 0);
  }
  await page.getByRole('button', { name: /Toma y entrega/ }).click(); await page.waitForTimeout(300);
  verifica(op('la leyenda elige la familia Toma y entrega (149)'), /149 de 385/.test((await medirOP()).texto));
  await page.selectOption('#op-grupo', 'todo');
  await page.selectOption('#cons-comp-con', { index: 1 }); await page.waitForTimeout(350);
  const cp = await medirOP();
  verifica(op('compuertas: 269.5, no evaluable por estructura'), /269\.5/.test(cp.resultados[0]) && /No evaluable/.test(cp.estados) && /no reconstruible por estructura/.test(cp.texto), `${cp.resultados} ${cp.estados}`);
  verifica(op('compuertas: sin selector de grupo ni lista de estructuras'), (await page.locator('#op-grupo').count()) === 0 && cp.nFilas === 0);
  await page.selectOption('#cons-comp-con', { index: 2 }); await page.waitForTimeout(350);
  const ed = await medirOP();
  verifica(op('edificios: 6 = 6 coherente y 6 fichas'), ed.resultados[0].startsWith('6') && ed.resultados[1].startsWith('6') && /Coherente/.test(ed.estados) && ed.nFilas === 6 && /O1-SRL/.test(ed.texto) && /CASETA JEFE DE ZONA/.test(ed.texto), `${ed.nFilas} ${ed.resultados}`);
  const redesSRL = await page.locator('#cons-comp-red option').evaluateAll((o) => o.map((x) => x.value));
  verifica(op('SRL: sin red de drenaje en el selector'), !redesSRL.includes('drenaje'), redesSRL.join(','));
  await page.selectOption('#cons-comp-red', 'distribucion'); await page.waitForTimeout(300);
  verifica(op('SRL: «Red de drenaje: no aplica a este PacOT»'), /Red de drenaje: no aplica a este PacOT/.test(await page.locator('.cons-comp').textContent()));

  // ── Módulo 5 (si está cargado): obras puntuales atípicas y drenes con su dibujo ──
  const ambitos = await page.locator('#cons-comp-amb option').evaluateAll((o) => o.map((x) => ({ v: x.value, t: x.textContent.trim() })));
  const m5 = ambitos.find((x) => /^M5$/.test(x.v) || /Módulo 5/.test(x.t));
  if (m5) {
    await page.selectOption('#cons-comp-amb', m5.v); await page.waitForTimeout(800);
    await page.selectOption('#cons-comp-red', 'obras'); await page.waitForTimeout(500);
    const nom5 = await page.locator('#cons-comp-con option').allInnerTexts();
    verifica(op('M5: hay conceptos de obras puntuales'), nom5.length >= 4, nom5.join(' | '));
    await page.selectOption('#cons-comp-con', { label: 'Reparación de obra civil' }); await page.waitForTimeout(400);
    const o5 = await medirOP();
    rec.obras.m5 = { resultados: o5?.resultados, estados: o5?.estados.replace(/\s+/g, ' ').slice(0, 120) };
    verifica(op('M5 obra civil: 2,002 en el libro y 1,715 en IO4 → atípico, sin cifra dudosa'), /2[,.]?002/.test(o5.resultados[0]) && /1[,.]?715/.test(o5.resultados[1]) && /Atípico/.test(o5.estados) && !/no verificada/.test(o5.texto), `${o5.resultados} ${o5.estados}`);
    verifica(op('M5 obra civil: texto ≥ 12 px, objetivos ≥ 44 px, sin desborde'), o5.chico.length === 0 && o5.pequenos.length === 0 && !o5.overflowX, `${o5.chico.join(' | ')} ${o5.pequenos.join(' | ')}`);
    await page.locator('.cons-comp').screenshot({ path: fileURLToPath(new URL(`obras_${nombre}_m5_obra_civil.png`, OUT)) });
    await page.selectOption('#cons-comp-red', 'drenaje'); await page.waitForTimeout(500);
    const dr = await page.locator('#cons-comp-con option').allInnerTexts();
    rec.obras.drenes = { conceptos: dr, fichas: {} };
    for (let i = 0; i < dr.length; i++) {
      await page.selectOption('#cons-comp-con', { index: i }); await page.waitForTimeout(300);
      await page.selectOption('#cons-comp-tramo', '208').catch(() => {}); await page.waitForTimeout(250);
      const m = await medirFicha();
      rec.obras.drenes.fichas[dr[i]] = { dibujo: m.hayDibujo, resultado: m.resultado, aria: m.aria.slice(0, 60) };
      verifica(op(`dren f208 · ${dr[i]}: texto ≥ 12 px, sin desborde`), m.chico.length === 0 && !m.overflowX, m.chico.join(' | '));
      if (/TERRACER|ACUATIC|DESAZOLVE|LIMPIA/i.test(dr[i])) verifica(op(`dren f208 · ${dr[i]}: con dibujo de sección`), m.hayDibujo, m.aria);
      if (/TERRACER/i.test(dr[i])) verifica(op('dren f208 · terracerías: 27,200 m³'), /^27[,.]?200$/.test((m.resultado ?? '').replace(/\s/g, '')), m.resultado ?? 'null');
      if (/ACUATIC/i.test(dr[i])) verifica(op('dren f208 · acuáticas: 6.8 ha'), (m.resultado ?? '') === '6.8', m.resultado ?? 'null');
    }
    await page.locator('.cons-comp').screenshot({ path: fileURLToPath(new URL(`obras_${nombre}_m5_dren.png`, OUT)) });
    verifica(op('dren: dice «Recorrido del dren» y no «canal»'), /Recorrido del dren/.test(await page.locator('.cc-raiz').innerText()) && !/Recorrido del canal/.test(await page.locator('.cc-raiz').innerText()));
    await page.selectOption('#cons-comp-amb', ambitos.find((x) => x.v !== m5.v)?.v ?? 'SRL'); await page.waitForTimeout(500);
  }

  rec.desborde = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  rec.tokensRotos = await page.evaluate(() => ['NaN', 'undefined', 'Infinity', '[object Object]'].filter((t) => (document.body.innerText || '').includes(t)));
  rec.errores = errores; rec.red = red;
  verifica(`${nombre} · 0 errores de consola`, errores.length === 0, errores.join(' | '));
  verifica(`${nombre} · 0 errores de red`, red.length === 0, red.join(' | '));
  verifica(`${nombre} · sin desborde horizontal ni NaN/undefined`, !rec.desborde && rec.tokensRotos.length === 0);
  resumen[nombre] = rec;
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(resumen, null, 1));
console.log(fallos.length ? `\nFALLOS (${fallos.length}):\n- ${fallos.join('\n- ')}` : '\nSin fallos.');
process.exit(fallos.length ? 1 : 0);
