// Captura de un elemento de página. Uso: node e2e/_shot.mjs <ruta-sin-barra-inicial> <salida.png> [ancho] [selector]
// (Git Bash convierte "/clima" en una ruta de Windows: por eso la ruta va sin la barra inicial.)
import { chromium, webkit, devices } from 'playwright';
const [,, ruta, out, w = '1440', sel = '.clima-container', disp = ''] = process.argv;
const motor = disp ? webkit : chromium;
const ctxOpts = disp ? { ...devices[disp] } : { viewport: { width: +w, height: 900 } };
const b = await motor.launch(); const p = await (await b.newContext(ctxOpts)).newPage();
const err = []; p.on('pageerror', e => err.push(String(e)));
await p.goto('http://localhost:5173/' + ruta.replace(/^\/+/, ''), { waitUntil: 'networkidle' }).catch(() => {});
await p.waitForSelector(sel, { timeout: 30000 }).catch(() => err.push('sin ' + sel));
await p.waitForTimeout(5000);
await p.addStyleTag({ content: 'html,body,#root,.layout-container,.main-content{height:auto !important;overflow:visible !important;max-height:none !important}' }); await p.waitForTimeout(1200);
const el = await p.$(sel);
if (el) await el.screenshot({ path: out });
console.log(err.join(' | ') || 'ok', el ? Math.round((await el.boundingBox()).height) : 0);
await b.close();
