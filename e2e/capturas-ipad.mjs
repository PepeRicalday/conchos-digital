// Capturas iPad con el motor de Safari (WebKit), horizontal (1180x820) y vertical (820x1180).
//   node e2e/capturas-ipad.mjs [carpeta=ipad]
// Solo lectura. Salida en e2e/out/<carpeta>/<orientacion>_<pantalla>.png (pantalla visible, sin recortar el layout).
import { webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const carpeta = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'ipad';
const OUT = fileURLToPath(new URL(`./out/${carpeta}/`, import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const RUTAS = [['dashboard', '/'], ['monitor', '/monitor-publico'], ['presas', '/presas'], ['distribucion', '/canales'], ['niveles', '/escalas'], ['hidrometria', '/hidrometria'], ['clima', '/clima'], ['alertas', '/alertas'], ['geomonitor', '/geo-monitor'], ['balance', '/balance'], ['modelacion', '/modelacion-hidraulica'], ['historico', '/analisis-historico'], ['consultoria', '/inteligencia-hidrica'], ['bitacora', '/bitacora'], ['ciclos', '/ciclos'], ['infraestructura', '/infraestructura'], ['reporte', '/reporte-oficial'], ['importar', '/importar'], ['login', '/login']];
const VP = { horizontal: { width: 1180, height: 820 }, vertical: { width: 820, height: 1180 } };
const b = await webkit.launch();
for (const [ori, viewport] of Object.entries(VP)) {
  const ctx = await b.newContext({ ...devices['iPad Pro 11'], viewport });
  for (const [nombre, ruta] of RUTAS) {
    const page = await ctx.newPage();
    await page.goto('http://localhost:5173' + ruta, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(4000);
    const m = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: innerWidth, device: document.documentElement.dataset.device }));
    await page.screenshot({ path: `${OUT}${ori}_${nombre}.png` });
    console.log(`${ori} ${nombre}: device=${m.device} desborde=${m.scrollW > m.innerW ? m.scrollW - m.innerW + 'px' : 'no'}`);
    await page.close();
  }
  await ctx.close();
}
await b.close();
console.log('listo →', OUT);
