// Verificación del rediseño de Cuenca del Conchos (solo lectura): capturas por ancho + comprobaciones de layout.
//   PORT=5173 node e2e/cuenca-rediseno.mjs [prefijo]
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
const PORT = process.env.PORT || 5173, pref = process.argv[2] || 'despues';
const OUT = new URL('./out/cuenca-auditoria/', import.meta.url); fs.mkdirSync(OUT, { recursive: true });
const VP = [['1900', 1900, 1000], ['1440', 1440, 900], ['ipad', 1180, 820], ['ipadv', 820, 1180], ['iphone', 430, 932]];
const b = await chromium.launch(); let fallos = 0;
for (const [n, w, h] of VP) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900, isMobile: w < 500 });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(`http://localhost:${PORT}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'networkidle' }).catch(() => {});
  await pg.waitForSelector('.cu-root .an-kpis', { timeout: 45000 }).catch(() => {});
  await pg.waitForSelector('.cu-plano-img', { timeout: 45000 }).catch(() => {});
  await pg.waitForTimeout(2500);
  const r = await pg.evaluate(() => {
    const main = document.querySelector('.main-content'); const q = (s) => document.querySelector(s);
    const box = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
    const peq = [...document.querySelectorAll('.cu-root button, .cu-root .an-seg-btn')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44; }).length;
    return { scrollW: main ? main.scrollWidth - main.clientWidth : -1, altoTotal: main?.scrollHeight, kpis: document.querySelectorAll('.cu-root .an-kpi').length, kpiCols: getComputedStyle(q('.an-kpis--6') || document.body).gridTemplateColumns.split(' ').length,
      plano: box('.cu-plano'), pl: box('.cu-pl-res'), ctl: box('.cu-pl-ctl'), mapa: box('.cu-mapa-svg'), tabla: box('.cu-tabla-wrap--red'), presas: box('.cu-presas-grid'), nan: /NaN|undefined/.test(document.querySelector('.cu-root')?.innerText || ''), tactilesMenor44: peq,
      anchos: [...document.querySelectorAll('.cu-root *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 4 && e.getBoundingClientRect().width > 0).slice(0, 4).map((e) => e.className?.baseVal ?? e.className),
      navSticky: getComputedStyle(q('.cu-nav') || document.body).position, rank: document.querySelectorAll('.cu-rank-fila').length };
  });
  console.log(n, JSON.stringify(r), errs.length ? 'ERRS:' + errs.slice(0, 3).join(' | ') : '');
  if (r.scrollW > 2 || r.nan || (errs.length)) fallos++;
  await pg.setViewportSize({ width: w, height: Math.min(9000, Math.max(h, (r.altoTotal || h) + 40)) });
  await pg.waitForTimeout(800);
  await pg.screenshot({ path: fileURLToPath(new URL(`${pref}-${n}.png`, OUT)), fullPage: false });
  if (w >= 1000) for (const [k, sel] of [['planos', '.cu-planos'], ['red', '.cu-red'], ['presas', '.cu-presas-grid'], ['cab', '.cu-nav']]) {
    const el = await pg.$(sel); if (el) await el.screenshot({ path: fileURLToPath(new URL(`${pref}-${n}-${k}.png`, OUT)) }).catch(() => {});
  }
  await ctx.close();
}
await b.close(); console.log(fallos ? `FALLOS: ${fallos}` : 'OK'); process.exit(fallos ? 1 : 0);
