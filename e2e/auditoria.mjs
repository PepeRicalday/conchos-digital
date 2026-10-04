// Auditoría funcional de SOLO LECTURA con Playwright.
//   Uso:  node e2e/auditoria.mjs [desktop|ipad] [cd|sc]      (requiere `npm run dev` corriendo)
//   cd = conchos-digital (:5173) · sc = sica-capture (:5176). Ambos usan el bypass de login de localhost.
// Revisa cada ruta: errores de consola/JS, fallos de red reales, textos rotos (NaN/undefined),
// desbordes horizontales, imágenes rotas, páginas vacías y tormentas de peticiones; luego hace clic en
// pestañas/filtros SEGUROS (lista negra de acciones que escriben). NUNCA pulsa guardar/eliminar/etc.
// Salida: e2e/out/<app>_<viewport>.json y capturas .png (carpeta ignorada por git).
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = new URL('./out/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const vpName = process.argv[2] || 'desktop';
const app = process.argv[3] || 'cd';
const APPS = {
  cd: { base: 'http://localhost:5173', routes: ['/', '/monitor-publico', '/presas', '/canales', '/escalas', '/hidrometria', '/clima', '/reporte-oficial', '/importar', '/alertas', '/geo-monitor', '/bitacora', '/ciclos', '/infraestructura', '/inteligencia-hidrica', '/balance', '/analisis-historico', '/modelacion-hidraulica', '/login'] },
  sc: { base: 'http://localhost:5176', routes: ['/', '/captura', '/hidrometria', '/monitor', '/login'] },   // /nuke es destructiva: excluida
};
const VPS = {
  desktop: { viewport: { width: 1440, height: 900 }, opts: {} },
  ipad: { viewport: { width: 1180, height: 820 }, opts: { hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } },
};
const DANGER = /guardar|eliminar|borrar|enviar|activar|cerrar sesi|sincroniz|confirmar|crear|nuev[oa]|importar|subir|delete|save|reset|limpiar|regenerar|publicar|aplicar|ejecutar|descargar|exportar|generar|imprimir|copiar|snapshot|json|skill|desactivar|cancelar|editar|modificar|firmar|autorizar|quitar|remover|logout|salir|nuke|purgar|atender/i;
const IGNORE_CONSOLE = /AUTH_BYPASS|WebSocket connection|realtime|\[vite\]|Download the React DevTools|favicon/i;
const { base, routes } = APPS[app];
const vp = VPS[vpName];
const norm = u => u.replace(/eq\.[^&]+/g, 'eq.*').replace(/gte\.[^&]+/g, 'gte.*').slice(0, 140);

const browser = await chromium.launch();
const results = [];
for (const route of routes) {
  const page = await (await browser.newContext({ viewport: vp.viewport, ...vp.opts })).newPage();
  const consoleErrs = [], pageErrs = [], netFail = [], reqTimes = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !IGNORE_CONSOLE.test(m.text())) consoleErrs.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', e => pageErrs.push(String(e.message).slice(0, 200)));
  page.on('response', r => { if (r.status() >= 400 && !/favicon|\.map$/.test(r.url())) netFail.push(`${r.status()} ${norm(r.url())}`); });
  page.on('requestfailed', r => { if (r.failure()?.errorText !== 'net::ERR_ABORTED' && !/realtime|websocket|favicon/i.test(r.url())) netFail.push(`FAILED ${norm(r.url())}`); });
  page.on('request', r => { if (/rest\/v1|rpc|functions\/v1/.test(r.url())) reqTimes.push(Date.now()); });
  const rec = { route };
  await page.goto(base + route, { waitUntil: 'networkidle', timeout: 45000 }).catch(e => { rec.gotoError = e.message.slice(0, 100); });
  await page.waitForTimeout(5000);
  const n0 = reqTimes.length; await page.waitForTimeout(6000); rec.requestsEnReposo6s = reqTimes.length - n0;
  rec.dom = await page.evaluate(() => {
    const txt = document.body.innerText || '';
    const bad = ['NaN', 'undefined', 'Infinity', '[object Object]'].filter(t => new RegExp('\\b' + t.replace(/[[\]]/g, '\\$&') + '\\b').test(txt) || txt.includes(t) && t.startsWith('['));
    return {
      chars: txt.length, tokensRotos: bad,
      errorBoundary: /algo sali[oó] mal|something went wrong|error inesperado/i.test(txt),
      overflowX: document.documentElement.scrollWidth > innerWidth + 2,
      imgsRotas: [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.src.slice(-50)),
    };
  });
  await page.screenshot({ path: fileURLToPath(new URL(`${app}_${vpName}_${route.replace(/\//g, '_') || '_root'}.png`, OUT)) });
  const cands = await page.evaluate(DS => {
    const bad = new RegExp(DS, 'i'); const seen = new Set(); const out = [];
    document.querySelectorAll('[role=tab], button').forEach((el, i) => {
      const t = (el.innerText || '').trim().replace(/\s+/g, ' '); const r = el.getBoundingClientRect();
      if (!t || t.length > 28 || bad.test(t) || el.disabled || r.width < 8 || el.closest('aside, .sidebar') || seen.has(t)) return;
      seen.add(t); el.setAttribute('data-aud', i); out.push({ i, t });
    });
    return out.slice(0, 12);
  }, DANGER.source);
  rec.interacciones = [];
  for (const c of cands) {
    const e0 = consoleErrs.length, p0 = pageErrs.length, n1 = netFail.length;
    try { await page.locator(`[data-aud="${c.i}"]`).first().click({ timeout: 2500 }); await page.waitForTimeout(800); } catch { /* un modal previo puede tapar el clic: no es defecto */ }
    rec.interacciones.push({ el: c.t, nuevosConsole: consoleErrs.length - e0, nuevosJs: pageErrs.length - p0, nuevosRed: netFail.length - n1 });
    if (new URL(page.url()).pathname !== route) { await page.goto(base + route, { waitUntil: 'domcontentloaded' }).catch(() => {}); await page.waitForTimeout(1200); }
  }
  rec.consola = [...new Set(consoleErrs)]; rec.errJs = [...new Set(pageErrs)]; rec.red = [...new Set(netFail)];
  results.push(rec);
  const flags = [rec.red.length && `red:${rec.red.length}`, rec.consola.length && `consola:${rec.consola.length}`, rec.errJs.length && `JS:${rec.errJs.length}`, rec.dom.tokensRotos.length && `tokens:${rec.dom.tokensRotos}`, rec.dom.overflowX && 'overflowX', rec.dom.imgsRotas.length && 'img-rota', rec.dom.errorBoundary && 'ERROR-BOUNDARY', rec.dom.chars < 600 && route !== '/login' && 'VACÍA?', rec.requestsEnReposo6s > 12 && 'peticiones-en-reposo'].filter(Boolean);
  console.log(`${route.padEnd(24)} ${flags.length ? flags.join(' · ') : 'OK'}`);
  await page.context().close();
}
fs.writeFileSync(new URL(`${app}_${vpName}.json`, OUT), JSON.stringify(results, null, 1));
await browser.close();
const mal = results.filter(r => r.red.length || r.errJs.length || r.dom.errorBoundary).length;
console.log(`\n${results.length} rutas · ${mal} con errores de red/JS`);
process.exit(mal ? 1 : 0);
