// Capturas para revisión visual en iPhone con el motor de Safari (WebKit).
//   node e2e/capturas-visuales.mjs [carpeta=vis] [--app=cd|sc]
// Genera, por pantalla, cortes de 1000 px CSS (imágenes de ~880×2000) en e2e/out/<carpeta>/, con la isla
// dinámica y la barra de gestos simuladas (--sat 59 px / --sab 34 px). Incluye el menú abierto y las 5 pestañas
// del tablero del Monitor Público. Solo lectura.
import { webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const carpeta = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'vis';
const app = (process.argv.find(a => a.startsWith('--app=')) || '--app=cd').split('=')[1];
const OUT = fileURLToPath(new URL(`./out/${carpeta}/`, import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const RUTAS = {
  cd: [['dashboard', '/'], ['monitor', '/monitor-publico'], ['presas', '/presas'], ['distribucion', '/canales'], ['niveles', '/escalas'], ['hidrometria', '/hidrometria'], ['clima', '/clima'], ['alertas', '/alertas'], ['geomonitor', '/geo-monitor'], ['balance', '/balance'], ['modelacion', '/modelacion-hidraulica'], ['historico', '/analisis-historico'], ['consultoria', '/inteligencia-hidrica'], ['bitacora', '/bitacora'], ['ciclos', '/ciclos'], ['infraestructura', '/infraestructura'], ['reporte', '/reporte-oficial'], ['importar', '/importar'], ['login', '/login']],
  sc: [['sc-monitor', '/monitor'], ['sc-captura', '/captura'], ['sc-hidro', '/hidrometria'], ['sc-login', '/login']],
};
const base = app === 'cd' ? 'http://localhost:5173' : 'http://localhost:5176';
const b = await webkit.launch();
const ctx = await b.newContext({ ...devices['iPhone 15 Pro Max'], viewport: { width: 440, height: 956 }, deviceScaleFactor: 2 });
const SEGMENTO = 1000;

async function cortes(page, nombre, max = 4) {
  await page.addStyleTag({ content: 'html,body,#root,.layout-container,.main-content{height:auto !important;overflow:visible !important}' });
  await page.waitForTimeout(700);
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  const n = Math.min(Math.ceil(H / SEGMENTO), max);
  for (let i = 0; i < n; i++) await page.screenshot({ path: `${OUT}${nombre}_${i + 1}de${Math.ceil(H / SEGMENTO)}.png`, fullPage: true, clip: { x: 0, y: i * SEGMENTO, width: 440, height: Math.min(SEGMENTO, H - i * SEGMENTO) } });
  return `${nombre}: alto ${H}px → ${n} cortes`;
}

for (const [nombre, ruta] of RUTAS[app]) {
  const page = await ctx.newPage();
  await page.goto(base + ruta, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(5000);
  await page.addStyleTag({ content: ':root{--sat:59px !important;--sab:34px !important}' });
  if (nombre === 'monitor') {
    await page.screenshot({ path: `${OUT}monitor_mapa.png` });
    await page.evaluate(() => { [...document.querySelectorAll('button')].find(e => /TABLERO T/i.test(e.innerText))?.click(); });
    await page.waitForTimeout(1000);
    for (const t of ['PANORAMA', 'CANAL', 'ALERTAS', 'DATOS', 'TENDENCIAS']) {
      await page.evaluate(x => { [...document.querySelectorAll('button,[role=tab]')].find(e => new RegExp('^\\s*' + x, 'i').test((e.innerText || '').trim()))?.click(); }, t);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}monitor_tablero_${t}.png` });
    }
  } else {
    console.log(await cortes(page, nombre, nombre === 'infraestructura' || nombre === 'niveles' ? 3 : 4));
  }
  await page.close();
}
if (app === 'cd') {   // menú abierto
  const page = await ctx.newPage();
  await page.goto(base + '/', { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(4500);
  await page.addStyleTag({ content: ':root{--sat:59px !important;--sab:34px !important}' });
  await page.getByRole('button', { name: /Abrir menú/i }).tap().catch(() => {}); await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}menu_abierto.png` });
  await page.close();
}
await b.close();
console.log('listo →', OUT);
