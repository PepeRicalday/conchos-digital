// Mide el layout de /modelacion-hidraulica a varios tamaños y guarda capturas.
//   node e2e/modelacion-medir.mjs [carpeta=modelacion]
// Solo lectura. Salida en e2e/out/<carpeta>/<tamaño>.png
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const carpeta = process.argv[2] || 'modelacion';
const OUT = fileURLToPath(new URL(`./out/${carpeta}/`, import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const TAMANOS = { '1366x768': [1366, 768], '1920x1080': [1920, 1080], '1180x820': [1180, 820] };
const b = await chromium.launch();
for (const [nombre, [width, height]] of Object.entries(TAMANOS)) {
  const page = await b.newPage({ viewport: { width, height } });
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  await page.goto('http://localhost:5173/modelacion-hidraulica', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(5000);
  const m = await page.evaluate(() => {
    const h = s => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().height) : null; };
    const top = s => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top) : null; };
    const mc = document.querySelector('.main-content');
    return {
      innerH: innerHeight,
      mainContent: { h: h('.main-content'), scrollTop: mc?.scrollTop, scrollH: mc?.scrollHeight, clientH: mc?.clientHeight },
      simRoot: { h: h('.sim-root'), top: top('.sim-root') },
      simBody: { h: h('.sim-body'), top: top('.sim-body') },
      simCenter: { h: h('.sim-center'), scrollH: document.querySelector('.sim-center')?.scrollHeight },
      perfil: { card: h('.sim-profile-card'), chart: h('.sim-chart-wrap') },
      qflow: h('.sim-qflow-card'),
      cross: h('.sim-cross-card'),
      compare: h('.sim-compare-card'),
    };
  });
  await page.screenshot({ path: `${OUT}${nombre}.png` });
  console.log(nombre, JSON.stringify(m), errores.length ? 'ERRORES: ' + errores.join(' | ') : '');
  await page.close();
}
await b.close();
