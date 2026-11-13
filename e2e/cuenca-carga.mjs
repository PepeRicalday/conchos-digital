// Carga de la Cuenca (solo lectura): aparece en el primer pantallazo y no repite descargas pesadas.
//   PORT=5173 node e2e/cuenca-carga.mjs
// En desarrollo React monta dos veces cada efecto (StrictMode): los topes ya cuentan ese doble.
import { chromium } from 'playwright';
const PORT = process.env.PORT || 5173;
const b = await chromium.launch(); let fallos = 0;
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const pg = await ctx.newPage(); const reqs = [];
pg.on('requestfinished', (r) => { const u = r.url(); if (/supabase\.co|\/geo\//.test(u)) reqs.push(u.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*/, '')); });
await pg.addInitScript(() => { try { localStorage.removeItem('sica.cuenca.pestana'); } catch { /* */ } });
await pg.goto(`http://localhost:${PORT}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'domcontentloaded' });
await pg.waitForSelector('.cu-root .an-kpis', { timeout: 90000 });
await pg.waitForTimeout(7000);
const n = (re) => reqs.filter((u) => re.test(u)).length;
const ok = (c, m) => { if (!c) { fallos++; console.log('  ✗', m); } else console.log('  OK', m); };
const top = await pg.evaluate(() => Math.round(document.querySelector('.cu-root').getBoundingClientRect().top));
ok(top < 500, `la Cuenca empieza en el primer pantallazo (top ${top} px)`);
const kpisVisibles = await pg.evaluate(() => [...document.querySelectorAll('.cu-root .an-kpis .ui-kpi')].filter((e) => e.getBoundingClientRect().top < innerHeight).length);
ok(kpisVisibles >= 3, `al menos 3 indicadores visibles sin desplazar (${kpisVisibles})`);
ok(n(/unifrut/) === 0, `Unifrut no se pide al abrir el Resumen (${n(/unifrut/)})`);
ok(n(/cuerpos_agua_cierre_mensual/) <= 2, `los cierres mensuales se descargan una vez, compartidos (${n(/cuerpos_agua_cierre_mensual/)} con el doble de StrictMode)`);
ok(n(/modulos\.geojson/) <= 2, `modulos.geojson se descarga una vez (${n(/modulos\.geojson/)})`);
ok(reqs.length <= 130, `peticiones al abrir el Resumen: ${reqs.length} (tope 130 en desarrollo)`);
console.log('  total', reqs.length);
await b.close();
console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo en orden');
process.exit(fallos ? 1 : 0);
