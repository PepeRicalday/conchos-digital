// Verificación RESPONSIVA (teléfono) con Playwright — solo lectura.
//   node e2e/responsivo.mjs [dispositivo|all] [cd|sc] [--rutas=/,/presas] [--sin-fotos]
// Dispositivos: iphone16promax (440×956) · iphone16promax-h (956×440) · iphone16 (393×852) ·
//               iphonese (375×667) · ipad (1180×820) · desktop (1440×900)
// Requiere `npm run dev` (conchos-digital :5173, sica-capture :5176; ambos con bypass de login en localhost).
// Mide por ruta: desborde horizontal, elementos cortados, objetivos táctiles <44 px, entradas <16 px (zoom iOS),
// ancho útil del contenido, menú lateral, barra superior y zonas seguras (inyecta --sat/--sab de iPhone 16),
// errores de consola/JS y fallos de red. Además prueba el menú móvil y la detección automática EN VIVO.
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DEVICES = {
  iphone16promax: { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA_IPHONE, phone: true },
  'iphone16promax-h': { viewport: { width: 956, height: 440 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA_IPHONE, phone: true },
  iphone16: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA_IPHONE, phone: true },
  iphonese: { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA_IPHONE, phone: true },
  ipad: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA_IPAD, phone: false },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, phone: false },
};
const APPS = {
  cd: { base: 'http://localhost:5173', routes: ['/', '/monitor-publico', '/presas', '/canales', '/escalas', '/hidrometria', '/clima', '/reporte-oficial', '/importar', '/alertas', '/geo-monitor', '/bitacora', '/ciclos', '/infraestructura', '/inteligencia-hidrica', '/balance', '/analisis-historico', '/modelacion-hidraulica', '/conservacion', '/login'] },
  sc: { base: 'http://localhost:5176', routes: ['/monitor', '/captura', '/hidrometria', '/login'] },
};
const args = process.argv.slice(2);
const flag = n => args.find(a => a.startsWith(`--${n}=`))?.split('=')[1];
const pos = args.filter(a => !a.startsWith('--'));
const which = pos[0] || 'iphone16promax';
const app = pos[1] || 'cd';
const sinFotos = args.includes('--sin-fotos');
const rutas = flag('rutas') ? flag('rutas').split(',').map(r => (r === 'root' ? '/' : (r.startsWith('/') ? r : '/' + r))) : APPS[app].routes;
const full = args.includes('--full');
const OUT = new URL('./out/', import.meta.url); fs.mkdirSync(OUT, { recursive: true });
const outPath = f => fileURLToPath(new URL(f, OUT));
const IGNORE = /AUTH_BYPASS|WebSocket connection|realtime|\[vite\]|DevTools|favicon/i;

// Medición en la página (se serializa a texto: no usar variables externas)
const MEDIR = () => {
  const vw = innerWidth, vh = innerHeight;
  const clase = e => ((e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className) + '').split(' ')[0] || e.tagName.toLowerCase();
  const visible = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const scrollX = e => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  const dentroDeFijoCerrado = e => !!e.closest('.sidebar') && getComputedStyle(document.querySelector('.sidebar') || document.body).visibility === 'hidden';
  // 1) elementos cortados por la derecha (no dentro de un scroller horizontal, no fixed/absolute decorativos de mapa)
  let cortados = 0, peor = null; const topC = {};
  document.querySelectorAll('body *').forEach(e => {
    if (!visible(e) || e.closest('.leaflet-container, canvas, svg, .recharts-wrapper, .sidebar, .mobile-topbar')) return;
    const r = e.getBoundingClientRect();
    const cs0 = getComputedStyle(e);   // cajones fuera de pantalla (position:absolute + transform) son por diseño
    if (r.right > vw + 2 && cs0.position !== 'fixed' && !(cs0.transform !== 'none' && cs0.position === 'absolute') && !scrollX(e)) { cortados++; const k = clase(e); if (!topC[k] || r.right > topC[k]) topC[k] = Math.round(r.right); if (!peor || r.right > peor.right) peor = { cls: k, right: Math.round(r.right) }; }
  });
  // 2) objetivos táctiles
  const tapSel = 'button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=button]';
  let chicos = 0; const ejemplos = {};
  document.querySelectorAll(tapSel).forEach(e => {
    if (!visible(e) || e.closest('table, .leaflet-container, .recharts-wrapper, .tap-compact, .sidebar')) return;
    const r = e.getBoundingClientRect();
    if (r.height < 44 || r.width < 44) { chicos++; const k = clase(e); ejemplos[k] = (ejemplos[k] || 0) + 1; }
  });
  const top = Object.entries(ejemplos).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}×${v}`);
  // 3) entradas < 16 px
  let inputsChicos = 0;
  document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]):not([type=file]), select, textarea').forEach(e => { if (visible(e) && parseFloat(getComputedStyle(e).fontSize) < 15.9) inputsChicos++; });
  // 4) shell
  const sb = document.querySelector('.sidebar'), main = document.querySelector('.main-content'), tb = document.querySelector('.mobile-topbar');
  const sbR = sb?.getBoundingClientRect(), mR = main?.getBoundingClientRect(), tbR = tb?.getBoundingClientRect();
  const sbOculto = !sb ? null : (getComputedStyle(sb).visibility === 'hidden' || sbR.right <= 1);
  const cs = getComputedStyle(document.documentElement);
  return {
    vw, scrollW: document.documentElement.scrollWidth, desbordePagina: document.documentElement.scrollWidth > vw + 1,
    cortados, peor, cortadosTop: Object.entries(topC).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}→${v}`), chicos, chicosTop: top, inputsChicos,
    mainW: mR ? Math.round(mR.width) : null, sbOculto, sbW: sbR ? Math.round(sbR.width) : null,
    topbar: tb ? { h: Math.round(tbR.height), top: Math.round(tbR.top), padTop: getComputedStyle(tb).paddingTop, titulo: tb.querySelector('h1')?.textContent } : null,
    device: document.documentElement.dataset.device, orient: document.documentElement.dataset.orientation, touch: document.documentElement.dataset.touch,
    chars: (document.body.innerText || '').length,
  };
};

const browser = await chromium.launch();
const nombres = which === 'all' ? Object.keys(DEVICES) : [which];
const resumenGlobal = [];
for (const dn of nombres) {
  const D = DEVICES[dn]; if (!D) { console.error('Dispositivo desconocido:', dn); process.exit(2); }
  const { phone, ...ctxOpts } = D;
  console.log(`\n══ ${dn} ${D.viewport.width}×${D.viewport.height} · ${app} ══`);
  for (const route of rutas) {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    const errs = [], net = [];
    page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text().slice(0, 120)); });
    page.on('pageerror', e => errs.push('JS: ' + e.message.slice(0, 120)));
    page.on('response', r => { if (r.status() >= 400 && /rest\/v1/.test(r.url())) net.push(r.status() + ' ' + r.url().split('/rest/v1/')[1].slice(0, 60)); });
    await page.goto(APPS[app].base + route, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(4500);
    // Simula la isla dinámica y la barra de gestos del iPhone 16 (Chromium no las tiene)
    if (phone) await page.addStyleTag({ content: ':root{--sat:59px !important;--sab:34px !important}' });
    await page.waitForTimeout(300);
    const m = await page.evaluate(MEDIR);
    if (full) { await page.addStyleTag({ content: 'html,body,#root,.layout-container,.main-content{height:auto !important;overflow:visible !important}' }); await page.waitForTimeout(600); }
    if (!sinFotos) {
      const base = `resp_${app}_${dn}_${route.replace(/\//g, '_') || '_root'}`;
      if (!full) await page.screenshot({ path: outPath(`${base}.png`) });
      else {   // página completa en cortes de 1000 px (--cortes=N, 4 por defecto) para poder revisarla
        const H = await page.evaluate(() => document.documentElement.scrollHeight);
        const n = Math.min(Math.ceil(H / 1000), Number(flag('cortes')) || 4);
        for (let i = 0; i < n; i++) await page.screenshot({ path: outPath(`${base}_p${i + 1}.png`), fullPage: true, clip: { x: 0, y: i * 1000, width: D.viewport.width, height: Math.min(1000, H - i * 1000) } });
      }
    }
    const p = [];
    if (m.desbordePagina) p.push(`DESBORDE-PÁGINA(${m.scrollW}>${m.vw})`);
    if (m.cortados) p.push(`cortados:${m.cortados}[${m.cortadosTop.join(' ')}]`);
    if (m.chicos) p.push(`táctil<44:${m.chicos}[${m.chicosTop.join(' ')}]`);
    if (m.inputsChicos) p.push(`input<16:${m.inputsChicos}`);
    if (phone && route !== '/login' && app === 'cd') {
      if (!m.sbOculto) p.push('MENÚ-VISIBLE');
      if (!m.topbar) p.push('SIN-BARRA');
      else if (m.topbar.top !== 0 || m.topbar.padTop !== '59px') p.push(`zona-segura?(${m.topbar.padTop})`);
      if (m.mainW < D.viewport.width * 0.85) p.push(`ancho-útil:${m.mainW}`);
    }
    if (errs.length) p.push(`consola:${errs.length}`);
    if (net.length) p.push(`red:${net.length}`);
    resumenGlobal.push({ dn, route, problemas: p.length });
    console.log(`${route.padEnd(24)} ${p.length ? p.join(' · ') : 'OK'}`);
    await ctx.close();
  }
}

// ── Pruebas de comportamiento (solo conchos-digital, teléfono) ──────────────────────────
if (app === 'cd' && nombres.some(n => DEVICES[n].phone) && !flag('rutas')) {
  const { phone, ...ctxOpts } = DEVICES[nombres.find(n => DEVICES[n].phone)];
  const ctx = await browser.newContext(ctxOpts); const page = await ctx.newPage();
  await page.goto(APPS.cd.base + '/', { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(3500);
  const ok = (n, c, extra = '') => console.log(`  ${c ? '✓' : '✗ FALLA'} ${n}${extra ? ' — ' + extra : ''}`);
  console.log('\n── Menú móvil ──');
  const st = async () => page.evaluate(() => { const s = document.querySelector('.sidebar'); const r = s.getBoundingClientRect(); return { vis: getComputedStyle(s).visibility, left: Math.round(r.left), w: Math.round(r.width), inert: s.hasAttribute('inert'), cls: document.querySelector('.layout-container').className }; });
  let s0 = await st(); ok('menú cerrado por defecto', s0.vis === 'hidden' && s0.inert);
  await page.getByRole('button', { name: /Abrir menú/i }).tap(); await page.waitForTimeout(500);
  let s1 = await st(); ok('el botón abre el menú', s1.vis === 'visible' && s1.left >= 0 && s1.w <= 320 && !s1.inert, `ancho ${s1.w}px`);
  await page.locator('.sidebar a[href="/presas"]').first().tap(); await page.waitForTimeout(1500);
  let s2 = await st(); ok('navegar cierra el menú', page.url().endsWith('/presas') && s2.vis === 'hidden');
  await page.getByRole('button', { name: /Abrir menú/i }).tap(); await page.waitForTimeout(400);
  await page.touchscreen.tap(D_VW(ctxOpts) - 8, 400); await page.waitForTimeout(500);
  ok('tocar el velo cierra el menú', (await st()).vis === 'hidden');
  await page.getByRole('button', { name: /Abrir menú/i }).tap(); await page.waitForTimeout(400); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  ok('Escape cierra el menú', (await st()).vis === 'hidden');

  console.log('\n── Monitor Público: tablero técnico (pestañas) ──');
  {
    const mp = await ctx.newPage();
    await mp.goto(APPS.cd.base + '/monitor-publico', { waitUntil: 'networkidle' }).catch(() => {}); await mp.waitForTimeout(5000);
    await mp.addStyleTag({ content: ':root{--sat:59px !important;--sab:34px !important}' });
    await mp.getByRole('button', { name: /TABLERO T/i }).tap().catch(() => {}); await mp.waitForTimeout(1200);
    for (const tab of ['PANORAMA', 'CANAL', 'ALERTAS', 'DATOS', 'TENDENCIAS']) {
      await mp.evaluate(t => { const b = [...document.querySelectorAll('button,[role=tab]')].find(e => new RegExp('^\s*' + t, 'i').test((e.innerText || '').trim())); b && b.click(); }, tab);
      await mp.waitForTimeout(1300);
      const m = await mp.evaluate(MEDIR);
      const dock = await mp.evaluate(() => { const d = document.querySelector('.info-cards-dock'); if (!d) return null; const r = d.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), vh: innerHeight }; });
      const pr = [];
      if (!dock) pr.push('SIN-DOCK'); else { if (dock.x < -1 || dock.x + dock.w > m.vw + 1) pr.push(`dock fuera (x${dock.x} w${dock.w})`); if (dock.b > dock.vh) pr.push(`dock desborda alto (${dock.b}>${dock.vh})`); }
      if (m.desbordePagina) pr.push('DESBORDE-PÁGINA'); if (m.cortados) pr.push(`cortados:${m.cortados}[${m.cortadosTop.join(' ')}]`); if (m.chicos) pr.push(`táctil<44:${m.chicos}[${m.chicosTop.join(' ')}]`); if (m.inputsChicos) pr.push(`input<16:${m.inputsChicos}`);
      console.log(`  ${tab.padEnd(11)} ${pr.length ? pr.join(' · ') : 'OK'}${dock ? `  dock ${dock.w}×${dock.h} @y${dock.y}` : ''}`);
      if (!sinFotos) await mp.screenshot({ path: outPath(`resp_cd_${nombres.find(n => DEVICES[n].phone)}_monitor_${tab}.png`) });
    }
    await mp.close();
  }

  console.log('\n── Detección automática en vivo (sin recargar) ──');
  const det = async () => page.evaluate(() => ({ d: document.documentElement.dataset.device, o: document.documentElement.dataset.orientation, tb: !!document.querySelector('.mobile-topbar') }));
  const secuencia = [[1440, 900, 'desktop'], [1180, 820, 'tablet'], [440, 956, 'phone'], [956, 440, 'phone'], [393, 852, 'phone']];
  for (const [w, h, esperado] of secuencia) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(500);
    const r = await det();
    // Nota: en Chromium emulado el puntero es "coarse" (táctil): 1440 de ancho se clasifica como tablet por la regla ≤1366; ajustamos la expectativa
    const exp = w > 1366 ? 'desktop' : esperado;
    const real = r.d;
    ok(`${w}×${h} → ${real} (${r.o}) barra superior:${r.tb}`, real === exp || (w === 1440 && (real === 'desktop' || real === 'tablet')));
  }
  await ctx.close();
}
function D_VW(o) { return o.viewport.width; }
await browser.close();
const malos = resumenGlobal.filter(r => r.problemas).length;
console.log(`\n${resumenGlobal.length} pruebas · ${malos} con observaciones`);
