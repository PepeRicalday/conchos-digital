// Balance por tramo de río (Cuenca → Balance → «Balance por tramo de río»), solo lectura.
//   PORT=5173 node e2e/cuenca-tramos.mjs [prefijo]
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { irA } from './_cuenca.mjs';
const PORT = process.env.PORT || 5173, pref = process.argv[2] || 'tramos';
const OUT = new URL('./out/cuenca-auditoria/', import.meta.url); fs.mkdirSync(OUT, { recursive: true });
const VP = [['1440', 1440, 900], ['ipad', 1180, 820], ['iphone', 430, 932]];
const b = await chromium.launch(); let fallos = 0;
for (const [n, w, h] of VP) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900, isMobile: w < 500, serviceWorkers: 'block' });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errs.push(m.text()); }); // 404: la tabla de anotaciones aún no existe en la base (migración sin aplicar)
  const falla = (msg) => { fallos++; console.log(`  ✗ [${n}] ${msg}`); };
  await pg.goto(`http://localhost:${PORT}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'domcontentloaded' });
  await pg.waitForSelector('.cu-root .an-kpis', { timeout: 45000 });
  await irA(pg, 'Balance');
  await pg.waitForSelector('#cu-balance-tramos', { timeout: 45000 });
  await pg.waitForTimeout(2500); // la toma K-0 llega aparte
  const r = await pg.evaluate(() => {
    const sec = document.querySelector('#cu-balance-tramos');
    const main = document.querySelector('.main-content');
    const filas = [...sec.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, ' ').trim()));
    const peq = [...sec.querySelectorAll('button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44; }).length;
    return {
      filas, barras: sec.querySelectorAll('.cu-bc-fila').length, lecturas: sec.querySelectorAll('.cu-lec-item').length,
      textos: [...sec.querySelectorAll('.cu-lec-item')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
      nan: /NaN|undefined|Infinity/.test(sec.innerText), scrollW: main ? main.scrollWidth - main.clientWidth : -1, tactilesMenor44: peq,
    };
  });
  console.log(n, 'tramos:', r.filas.length, 'barras:', r.barras, 'lecturas:', r.lecturas, 'tactiles<44:', r.tactilesMenor44);
  if (n === '1440') { for (const f of r.filas) console.log('   ', f.join(' | ')); for (const t of r.textos) console.log('   •', t); }
  if (r.filas.length < 2) falla(`se esperaban al menos 2 tramos, hay ${r.filas.length}`);
  if (r.barras !== r.filas.length) falla('barras y filas no coinciden');
  if (r.lecturas !== r.filas.length) falla('cada tramo debe tener su lectura');
  if (r.nan) falla('texto con NaN/undefined/Infinity');
  if (r.scrollW > 2) falla(`desborde horizontal ${r.scrollW}px`);
  if (errs.length) falla(`errores de consola/página: ${errs.slice(0, 2).join(' | ')}`);
  await pg.locator('#cu-balance-tramos').screenshot({ path: fileURLToPath(new URL(`${pref}-${n}.png`, OUT)) });
  await ctx.close();
}
await b.close();
console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo en orden');
process.exit(fallos ? 1 : 0);
