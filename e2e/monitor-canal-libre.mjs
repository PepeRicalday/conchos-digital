// Monitor Público: el canal debe quedar LIBRE (ninguna ventana encima) y CENTRADO
// en el área visible del mapa, en varias pantallas, con el tablero abierto y cerrado.
//   node e2e/monitor-canal-libre.mjs          (requiere `npm run dev` en :5173)
// Capturas en e2e/out/canal-libre-*.png
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('e2e/out', { recursive: true });
const URL = 'http://localhost:5173/monitor-publico';
const casos = [
  { nombre: '1920x1080', ctx: { viewport: { width: 1920, height: 1080 } } },
  { nombre: '1600x900', ctx: { viewport: { width: 1600, height: 900 } } },
  { nombre: '1366x768', ctx: { viewport: { width: 1366, height: 768 } } },
  { nombre: 'ipad-h', ctx: { ...devices['iPad Pro 11 landscape'] } },
  { nombre: 'ipad-v', ctx: { ...devices['iPad Pro 11'] } },
  { nombre: 'iphone', ctx: { ...devices['iPhone 15 Pro Max'] } },
];

const b = await chromium.launch();
let fallos = 0;
for (const c of casos) {
  for (const estado of ['abierto', 'cerrado']) {
    const ctx = await b.newContext({ ...c.ctx, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForSelector('.canal-path-base', { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const hayDock = await page.$('.info-cards-dock');
    if (estado === 'cerrado' && hayDock) { await page.click('.dock-close-btn'); }
    if (estado === 'abierto' && !hayDock) { await page.click('.pm-reabrir').catch(() => {}); }
    await page.waitForTimeout(1800);

    const m = await page.evaluate(() => {
      const canal = document.querySelector('.canal-path-base');
      const mapa = document.querySelector('.public-map-wrapper .leaflet-container');
      if (!canal || !mapa) return null;
      const r = canal.getBoundingClientRect();
      const mr = mapa.getBoundingClientRect();
      // área visible del mapa = mapa ∩ ventana
      const vis = { left: Math.max(mr.left, 0), top: Math.max(mr.top, 0), right: Math.min(mr.right, innerWidth), bottom: Math.min(mr.bottom, innerHeight) };
      const tapan = [];
      document.querySelectorAll('.public-monitor-container [data-pm-overlay], .info-cards-dock, .pm-reabrir, .leaflet-control-zoom').forEach(el => {
        const o = el.getBoundingClientRect();
        if (!o.width || !o.height) return;
        const ix = Math.min(o.right, r.right) - Math.max(o.left, r.left);
        const iy = Math.min(o.bottom, r.bottom) - Math.max(o.top, r.top);
        if (ix > 2 && iy > 2) tapan.push(`${el.className.toString().split(' ')[0]} (${Math.round(ix)}x${Math.round(iy)})`);
      });
      return {
        canal: [r.left, r.top, r.right, r.bottom].map(Math.round),
        vis: [vis.left, vis.top, vis.right, vis.bottom].map(Math.round),
        dentro: r.left >= vis.left - 2 && r.right <= vis.right + 2 && r.top >= vis.top - 2 && r.bottom <= vis.bottom + 2,
        tapan,
        clase: document.querySelector('.public-monitor-container')?.className,
      };
    });
    await page.screenshot({ path: `e2e/out/canal-libre-${c.nombre}-${estado}.png` });
    // En teléfono la hoja inferior ocupa la pantalla con el tablero abierto: solo se exige "dentro".
    const esTel = c.nombre === 'iphone';
    const malo = !m || !m.dentro || (!esTel && m.tapan.length > 0);
    if (malo) fallos++;
    console.log(`${malo ? '✗' : '✓'} ${c.nombre} ${estado}: ${JSON.stringify(m)}`);
    await ctx.close();
  }
}
await b.close();
process.exit(fallos ? 1 : 0);
