// Auditoría de SCROLL y táctiles en iPad de TODAS las rutas (solo lectura).
//   node e2e/auditoria-scroll-ipad.mjs [cd|sc] [rutas,separadas,por,coma]
// Por ruta y orientación (horizontal 1180x820, vertical 820x1180):
//  - Chromium con gestos táctiles reales (CDP): arrastra el dedo en el centro y reporta qué contenedor se mueve.
//  - Si la página es más alta que la pantalla, el dedo DEBE mover algo; se mide si se alcanza el final.
//  - Contenedores de scroll anidados grandes (posible atrapamiento), desborde horizontal, fuentes <11 px,
//    objetivos táctiles <44 px (solo visibles, fuera del sidebar), elementos fuera de pantalla a la derecha.
//  - WebKit: layout (overflowX, scrollHeight) y captura.
// Salida: e2e/out/scroll-ipad/<app>.json y capturas.
import { webkit, chromium, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const app = process.argv[2] || 'cd';
const APPS = {
  cd: { base: 'http://localhost:5173', routes: ['/', '/monitor-publico', '/presas', '/canales', '/escalas', '/hidrometria', '/clima', '/reporte-oficial', '/importar', '/alertas', '/geo-monitor', '/bitacora', '/ciclos', '/infraestructura', '/inteligencia-hidrica', '/protocolos', '/balance', '/analisis-historico', '/modelacion-hidraulica', '/conservacion'] },
  sc: { base: 'http://localhost:5176', routes: ['/', '/captura', '/hidrometria', '/monitor'] },
};
const { base } = APPS[app];
const routes = process.argv[3] ? process.argv[3].split(',') : APPS[app].routes;
const OUT = fileURLToPath(new URL('./out/scroll-ipad/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const VP = { horizontal: { width: 1180, height: 820 }, vertical: { width: 820, height: 1180 } };

const medir = () => {
  const vis = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const main = document.querySelector('.main-content') || document.scrollingElement;
  const scrollers = [...document.querySelectorAll('body *')].filter(e => {
    const cs = getComputedStyle(e);
    return /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 40 && e.clientHeight > 120 && vis(e);
  }).map(e => ({ sel: (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : e.tagName.toLowerCase()), h: e.clientHeight, sh: e.scrollHeight }));
  const peq = [...document.querySelectorAll('body *')].filter(e => {
    if (!e.childNodes.length || ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1)) return false;
    return vis(e) && parseFloat(getComputedStyle(e).fontSize) < 10.5 && !e.closest('svg');
  }).slice(0, 6).map(e => `${e.textContent.trim().slice(0, 24)} (${getComputedStyle(e).fontSize})`);
  const chicos = [...document.querySelectorAll('button, a[href], [role=button], [role=tab], select, input:not([type=hidden])')].filter(e => {
    if (!vis(e) || e.closest('aside, .sidebar, svg')) return false;
    const r = e.getBoundingClientRect();
    return (r.width < 40 || r.height < 40) && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth;
  }).slice(0, 6).map(e => { const r = e.getBoundingClientRect(); return `${(e.innerText || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`; });
  const fuera = [...document.querySelectorAll('body *')].filter(e => {
    if (!vis(e) || e.closest('svg')) return false;
    const r = e.getBoundingClientRect(); return r.right > innerWidth + 4 && r.width < innerWidth && !e.closest('[style*="overflow"]') && getComputedStyle(e).position !== 'fixed';
  }).slice(0, 4).map(e => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 30)} r=${Math.round(e.getBoundingClientRect().right)}`);
  return {
    device: document.documentElement.dataset.device, orient: document.documentElement.dataset.orientation,
    main: { ch: main.clientHeight, sh: main.scrollHeight, st: Math.round(main.scrollTop) },
    overflowX: document.documentElement.scrollWidth > innerWidth + 2 || (main.scrollWidth > main.clientWidth + 2),
    chars: (document.body.innerText || '').length, scrollers, textoPequeno: peq, tactilesChicos: chicos, fueraPantalla: fuera,
  };
};

const res = [];
const chr = await chromium.launch();
const wk = await webkit.launch();
for (const route of routes) {
  for (const [ori, viewport] of Object.entries(VP)) {
    const rec = { route, ori };
    // ---- Chromium con dedo real
    const ctx = await chr.newContext({ ...devices['iPad Pro 11'], viewport });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 120)));
    await page.goto(base + route, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(4500);
    rec.m = await page.evaluate(medir);
    const mainScroll = () => page.evaluate(() => { const m = document.querySelector('.main-content') || document.scrollingElement; return [Math.round(m.scrollTop), ...[...document.querySelectorAll('body *')].filter(e => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 40 && e.clientHeight > 120).slice(0, 8).map(e => Math.round(e.scrollTop))]; });
    const hay = rec.m.main.sh > rec.m.main.ch + 20;
    const cdp = await ctx.newCDPSession(page);
    const swipe = async (x, y, dy) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - (dy * i) / 10 }] }); await page.waitForTimeout(14); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(600);
    };
    const cx = Math.round(viewport.width / 2 + (rec.m.device === 'tablet' && ori === 'horizontal' ? 120 : 0));
    let movio = false, intentos = 0;
    if (hay) {
      const a = await mainScroll();
      for (const y of [viewport.height - 160, Math.round(viewport.height / 2), 260]) { await swipe(cx, y, 320); intentos++; const d = await mainScroll(); if (d.join() !== a.join()) { movio = true; break; } }
      rec.dedoMueve = movio;
      // ¿llega al final? sigue arrastrando hasta 25 veces
      let prev = -1, n = 0;
      while (n++ < 25) { const s = (await mainScroll())[0]; if (s === prev) break; prev = s; await swipe(cx, Math.round(viewport.height * 0.7), 400); }
      rec.alFinal = await page.evaluate(() => { const m = document.querySelector('.main-content') || document.scrollingElement; return { restante: Math.round(m.scrollHeight - m.clientHeight - m.scrollTop) }; });
    }
    if (errs.length) rec.errJs = [...new Set(errs)];
    await page.screenshot({ path: `${OUT}${app}_${route.replace(/\//g, '_') || '_root'}_${ori}.png` }).catch(() => {});
    await ctx.close();
    // ---- WebKit: layout
    const ctx2 = await wk.newContext({ ...devices['iPad Pro 11'], viewport });
    const p2 = await ctx2.newPage();
    await p2.goto(base + route, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await p2.waitForTimeout(4500);
    const w = await p2.evaluate(medir);
    rec.webkit = { overflowX: w.overflowX, main: w.main, chars: w.chars, tactilesChicos: w.tactilesChicos.length, fueraPantalla: w.fueraPantalla };
    await ctx2.close();

    const f = [];
    if (hay && !movio) f.push('DEDO NO MUEVE');
    if (hay && rec.alFinal?.restante > 24) f.push(`no llega al final (+${rec.alFinal.restante}px)`);
    if (rec.m.overflowX || w.overflowX) f.push('overflowX');
    if (rec.m.fueraPantalla.length) f.push(`fuera:${rec.m.fueraPantalla.length}`);
    if (rec.m.tactilesChicos.length) f.push(`táctiles<40:${rec.m.tactilesChicos.length}`);
    if (rec.m.textoPequeno.length) f.push(`texto<10.5:${rec.m.textoPequeno.length}`);
    if (rec.m.scrollers.length > 1) f.push(`scrollers anidados:${rec.m.scrollers.length}`);
    if (rec.m.chars < 400 && route !== '/login') f.push('VACÍA?');
    if (rec.errJs) f.push('JS');
    rec.flags = f;
    res.push(rec);
    console.log(`${route.padEnd(24)} ${ori.padEnd(10)} [${rec.m.device}/${rec.m.orient}] main ${rec.m.main.sh}/${rec.m.main.ch} ${f.length ? f.join(' · ') : 'OK'}`);
  }
}
await chr.close(); await wk.close();
fs.writeFileSync(`${OUT}${app}.json`, JSON.stringify(res, null, 1));
const mal = res.filter(r => r.flags.some(x => /DEDO|final|JS|VAC|overflowX/.test(x))).length;
console.log(`\n${res.length} combinaciones · ${mal} con fallos de scroll/layout`);
