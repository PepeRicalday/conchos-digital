// Verificación del sinóptico «El agua en la cuenca» (Cuenca → Red y estaciones): capturas por ancho + comprobaciones.
//   PORT=5173 node e2e/cuenca-sistema.mjs [prefijo]
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { irA } from './_cuenca.mjs';
const PORT = process.env.PORT || 5173, pref = process.argv[2] || 'sistema';
const OUT = new URL('./out/cuenca-sistema/', import.meta.url); fs.mkdirSync(OUT, { recursive: true });
const VP = [['1900', 1900, 1000], ['1440', 1440, 900], ['ipad', 1180, 820], ['iphone', 430, 932]];
const b = await chromium.launch(); let fallos = 0;
for (const [n, w, h] of VP) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1200, isMobile: w < 500 });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const falla = (msg) => { fallos++; console.log(`  ✗ [${n}] ${msg}`); };
  await pg.goto(`http://localhost:${PORT}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'domcontentloaded' });
  await pg.waitForSelector('.cu-root .an-kpis', { timeout: 45000 });
  await irA(pg, 'Red y estaciones');
  await pg.waitForSelector('#cu-red .cu-sis-svg .cu-sis-nodo--presa', { timeout: 45000 });
  await pg.waitForSelector('.cu-sis-nodo--lluvia', { timeout: 45000 }).catch(() => falla('no aparecieron los nodos de lluvia'));
  await pg.waitForTimeout(3500);
  const sis = pg.locator('#cu-red');
  await sis.screenshot({ path: fileURLToPath(new URL(`${pref}-${n}.png`, OUT)) });

  const r = await pg.evaluate(() => {
    const main = document.querySelector('.main-content'), svg = document.querySelector('.cu-sis-svg');
    const caja = (e) => e.getBoundingClientRect();
    const nodos = [...document.querySelectorAll('.cu-sis-nodo')];
    const etq = (t) => nodos.find((g) => (g.getAttribute('aria-label') || '').includes(t));
    const centroX = (t) => { const e = etq(t); if (!e) return null; const q = caja(e); return q.left + q.width / 2; };
    const textos = [...svg.querySelectorAll('text')].map((t) => parseFloat(getComputedStyle(t).fontSize) * (caja(svg).width / svg.viewBox.baseVal.width));
    // Texto de un nodo que se sale de su caja
    const desbordes = nodos.filter((g) => !g.classList.contains('cu-sis-nodo--confluencia')).filter((g) => { const c = caja(g.querySelector('.cu-sis-caja')); return [...g.querySelectorAll('text')].some((t) => { const q = caja(t); return q.right > c.right + 1 || q.left < c.left - 1; }); }).map((g) => (g.getAttribute('aria-label') || '').slice(0, 40));
    return {
      scrollW: main ? main.scrollWidth - main.clientWidth : -1, nan: /NaN|undefined/.test(document.querySelector('#cu-red')?.innerText || '') || /NaN|undefined/.test(svg.textContent || ''),
      tipos: Object.fromEntries(['presa', 'lluvia', 'estacion', 'distrito', 'confluencia', 'salida'].map((t) => [t, document.querySelectorAll(`.cu-sis-nodo--${t}`).length])),
      fuenteMin: Math.round(Math.min(...textos) * 10) / 10, desbordes,
      orden: { colina: centroX('La Colina'), florido: centroX('Confluencia del Río Florido'), distrito: centroX('Distrito de Riego 005'), sanPedro: centroX('Confluencia del Río San Pedro'), chuviscar: centroX('Confluencia del Río Chuvíscar'), babisas: centroX('Estación hidrométrica Babisas'), cierre: centroX('Luis L. León'), salida: centroX('Salida de la cuenca') },
      pasos: document.querySelectorAll('.cu-sis-paso').length, chips: document.querySelectorAll('.cu-sis-capas .cu-capa-chip').length,
      tactilesMenor44: [...document.querySelectorAll('#cu-red button, #cu-red select')].filter((e) => { const q = caja(e); return q.width > 0 && q.height > 0 && q.height < 44; }).length,
    };
  });
  console.log(n, JSON.stringify(r), errs.length ? 'ERRS:' + errs.slice(0, 3).join(' | ') : '');
  if (r.scrollW > 2) falla(`desborde horizontal de la página ${r.scrollW}px`);
  if (r.nan) falla('texto con NaN/undefined');
  if (errs.length) falla(`errores de consola/página: ${errs.length}`);
  if (r.tipos.presa < 9) falla(`vasos dibujados = ${r.tipos.presa} (esperado 9)`);
  if (r.tipos.confluencia !== 3) falla(`confluencias = ${r.tipos.confluencia} (esperado 3)`);
  if (r.tipos.distrito !== 1 || r.tipos.salida !== 1) falla('falta el distrito o la salida');
  if (r.tipos.lluvia < 5) falla(`regiones de lluvia = ${r.tipos.lluvia} (esperado 5)`);
  if (r.fuenteMin < 11) falla(`texto del esquema a ${r.fuenteMin}px (mínimo 11)`);
  if (r.desbordes.length) falla(`texto fuera de su caja: ${r.desbordes.join(' | ')}`);
  if (r.pasos !== 6) falla(`etapas = ${r.pasos} (esperado 6)`);
  const o = r.orden, sec = [o.colina, o.florido, o.sanPedro, o.chuviscar, o.babisas, o.cierre, o.salida];
  if (sec.some((x) => x == null)) falla(`falta un elemento del tronco: ${JSON.stringify(o)}`);
  else if (sec.some((x, i) => i > 0 && x <= sec[i - 1])) falla(`orden del tronco incorrecto (Babisas debe ir tras las confluencias): ${JSON.stringify(o)}`);
  if (w < 500 && r.tactilesMenor44) falla(`${r.tactilesMenor44} controles táctiles menores a 44 px`);

  // Ventanas: cada tipo de elemento abre la suya, resalta su recorrido y se cierra con Escape.
  for (const [tipo, texto] of [['presa', 'La Boquilla'], ['lluvia', 'Lluvia ·'], ['estacion', 'Babisas'], ['confluencia', 'Confluencia ·'], ['distrito', 'Distrito de Riego 005'], ['salida', 'Ojinaga']]) {
    const g = tipo === 'estacion' ? pg.locator('.cu-sis-nodo--estacion[aria-label*="Babisas"]') : tipo === 'presa' ? pg.locator('.cu-sis-nodo--presa[aria-label^="La Boquilla"]') : pg.locator(`.cu-sis-nodo--${tipo}`).first();
    await g.scrollIntoViewIfNeeded();
    await g.click({ force: true });
    await pg.waitForTimeout(350);
    const v = await pg.evaluate(() => { const e = document.querySelector('.cu-sis-ventana'); if (!e) return null; const q = e.getBoundingClientRect(), l = document.querySelector('.cu-sis-wrap').getBoundingClientRect(); return { t: e.querySelector('.cu-sis-ventana-t')?.textContent, txt: e.innerText, dentro: q.left >= l.left - 1 && q.right <= l.right + 1 && q.top >= l.top - 1 && q.bottom <= l.bottom + 1, fija: e.classList.contains('cu-sis-ventana--fija'), atenuados: document.querySelectorAll('.cu-sis-atenuado').length }; });
    if (!v) { falla(`la ventana de ${tipo} no abre`); continue; }
    if (!v.t?.includes(texto)) falla(`ventana de ${tipo}: título «${v.t}»`);
    if (/NaN|undefined/.test(v.txt)) falla(`ventana de ${tipo} con NaN/undefined`);
    if (!v.fija && !v.dentro) falla(`la ventana de ${tipo} se sale del lienzo`);
    if (tipo === 'estacion' && !/salida del distrito/.test(v.txt)) falla('Babisas no se describe a la salida del distrito');
    if (tipo === 'distrito' && !/lluvia dentro del distrito/i.test(v.txt)) falla('el distrito no muestra su lluvia');
    if (tipo === 'presa' || tipo === 'distrito' || tipo === 'estacion') await pg.locator(v.fija ? '.cu-sis-ventana' : '#cu-red').screenshot({ path: fileURLToPath(new URL(`${pref}-${n}-ventana-${tipo}.png`, OUT)) });
    await pg.locator('.cu-sis-cerrar').click();
    await pg.waitForTimeout(150);
    if (await pg.locator('.cu-sis-ventana').count()) falla(`la ventana de ${tipo} no cierra`);
  }
  // Capas: apagar la lluvia quita sus nodos; volver a encenderla los devuelve.
  const chip = pg.locator('.cu-sis-capas .cu-capa-chip', { hasText: 'Lluvia' });
  await chip.click(); await pg.waitForTimeout(200);
  if (await pg.locator('.cu-sis-nodo--lluvia').count()) falla('apagar la capa Lluvia no quita sus nodos');
  await chip.click(); await pg.waitForTimeout(200);
  if (!(await pg.locator('.cu-sis-nodo--lluvia').count())) falla('encender la capa Lluvia no devuelve sus nodos');
  await ctx.close();
}
await b.close();
console.log(fallos ? `\n${fallos} fallo(s)` : '\nOK: sinóptico verificado');
process.exit(fallos ? 1 : 0);
