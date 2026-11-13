// Verificación del rediseño de Cuenca del Conchos (solo lectura): capturas por ancho + comprobaciones de layout.
//   PORT=5173 node e2e/cuenca-rediseno.mjs [prefijo]
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { irA, abrirSecciones } from './_cuenca.mjs';
const PORT = process.env.PORT || 5173, pref = process.argv[2] || 'despues';
const OUT = new URL('./out/cuenca-auditoria/', import.meta.url); fs.mkdirSync(OUT, { recursive: true });
const VP = [['1900', 1900, 1000], ['1440', 1440, 900], ['ipad', 1180, 820], ['ipadv', 820, 1180], ['iphone', 430, 932]];
const b = await chromium.launch(); let fallos = 0;
for (const [n, w, h] of VP) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900, isMobile: w < 500 });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const falla = (msg) => { fallos++; console.log(`  ✗ [${n}] ${msg}`); };
  await pg.goto(`http://localhost:${PORT}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'domcontentloaded' });
  // Sin .catch: si el panel no carga, el script debe fallar y no medir una página vacía.
  await pg.waitForSelector('.cu-root .an-kpis', { timeout: 45000 });
  await irA(pg, 'Clima');
  await pg.waitForSelector('.cu-plano-img', { timeout: 45000 });
  await pg.waitForTimeout(2500);
  const r = await pg.evaluate(() => {
    const main = document.querySelector('.main-content'); const q = (s) => document.querySelector(s);
    const box = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
    const peq = [...document.querySelectorAll('.cu-root button, .cu-root .an-seg-btn')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44; }).length;
    return { scrollW: main ? main.scrollWidth - main.clientWidth : -1, altoTotal: main?.scrollHeight, kpis: document.querySelectorAll('.cu-root .an-kpis .ui-kpi').length, kpiCols: getComputedStyle(q('.an-kpis--5') || document.body).gridTemplateColumns.split(' ').length,
      plano: box('.cu-plano'), pl: box('.cu-pl-res'), ctl: box('.cu-pl-ctl'), mapa: box('.cu-mapa-svg'), tabla: box('.cu-tabla-wrap--red'), presas: box('.cu-presas-grid'), nan: /NaN|undefined/.test(document.querySelector('.cu-root')?.innerText || ''), tactilesMenor44: peq,
      anchos: [...document.querySelectorAll('.cu-root *')].filter((e) => !e.closest('.cu-tabla-wrap, .cu-nav, .ui-tabla-contenedor, [role=region][tabindex]') && e.getBoundingClientRect().right > innerWidth + 4 && e.getBoundingClientRect().width > 0).slice(0, 4).map((e) => e.className?.baseVal ?? e.className),
      navSticky: getComputedStyle(q('.cu-nav') || document.body).position, rank: document.querySelectorAll('.cu-rank-fila').length };
  });
  console.log(n, JSON.stringify(r), errs.length ? 'ERRS:' + errs.slice(0, 3).join(' | ') : '');
  if (r.scrollW > 2) falla(`desborde horizontal ${r.scrollW}px`);
  if (r.nan) falla('texto con NaN/undefined');
  if (errs.length) falla(`errores de consola/página: ${errs.length}`);
  if (r.kpis !== 5) falla(`KPIs de cabecera = ${r.kpis} (esperado 5)`);
  if (r.navSticky !== 'sticky') falla(`la navegación no es sticky (${r.navSticky})`);
  if (r.anchos.length) falla(`elementos fuera del viewport: ${r.anchos.join(', ')}`);
  // Pistas de la rejilla por ancho del CONTENEDOR del panel (≥1000 → 5 en fila; ≥760 → 6 pistas para acomodar 3 + 2; si no 2).
  const colsEsp = { 1900: 5, 1440: 5, ipad: 6, ipadv: 2, iphone: 2 }[n]; // ipadv: el panel mide ~722 px (<760)
  if (r.kpiCols !== colsEsp) falla(`columnas de KPI = ${r.kpiCols} (esperado ${colsEsp})`);
  // Cada pestaña de la navegación debe abrir su contenido y marcarse como actual.
  const pestanas = ['Resumen', 'Vasos', 'Balance', 'Clima'];
  // Con todas las secciones abiertas: cada pestaña debe traer los bloques de las pestañas que absorbió.
  const esperado = [['.cu-lec', '#cu-red'], ['#cu-presas', '#cu-ficha', '#cu-comparador', '#cu-vasos'], ['#cu-balance-cuenca', '#cu-balance-tramos', '#cu-ojinaga-ciclos', '#cu-cierres', '#cu-balance', '#cu-hidro'], ['.cu-planos', '#cu-estaciones', '#cu-mensual', '#cu-lluvia']];
  for (let i = 0; i < pestanas.length; i++) {
    await pg.click(`.cu-nav-btn:text-is("${pestanas[i]}")`);
    await pg.waitForTimeout(500);
    const plegadas = await pg.locator('.cu-root details.cu-sec:not([open])').count();
    if ((i === 1 || i === 2) && plegadas === 0) falla(`la pestaña «${pestanas[i]}» abre sin secciones plegadas`);
    await abrirSecciones(pg);
    for (const sel of esperado[i]) await pg.waitForSelector(sel, { timeout: 30000, state: 'attached' }).catch(() => falla(`la pestaña «${pestanas[i]}» no muestra ${sel}`));
    const actual = await pg.evaluate((t) => document.querySelector('.cu-nav-btn[aria-current="page"]')?.textContent === t, pestanas[i]);
    if (!actual) falla(`la pestaña «${pestanas[i]}» no queda marcada como actual`);
  }
  console.log('  pestañas verificadas:', pestanas.length);
  await pg.click('.cu-nav-btn:text-is("Resumen")');
  await pg.evaluate(() => document.querySelector('.main-content')?.scrollTo(0, 0));
  await pg.setViewportSize({ width: w, height: Math.min(9000, Math.max(h, (r.altoTotal || h) + 40)) });
  await pg.waitForTimeout(800);
  await pg.screenshot({ path: fileURLToPath(new URL(`${pref}-${n}.png`, OUT)), fullPage: false });
  if (w >= 1000) for (const [k, sel] of [['planos', '.cu-planos'], ['red', '.cu-red'], ['presas', '.cu-presas-grid'], ['cab', '.cu-nav']]) {
    const el = await pg.$(sel); if (el) await el.screenshot({ path: fileURLToPath(new URL(`${pref}-${n}-${k}.png`, OUT)) }).catch(() => {});
  }
  await ctx.close();
}
await b.close(); console.log(fallos ? `FALLOS: ${fallos}` : 'OK'); process.exit(fallos ? 1 : 0);
