// Anotaciones y captura manual de la Cuenca (Balance → «Anotaciones y captura manual»).
// La tabla cuerpos_agua_anotaciones se SIMULA en el navegador (page.route): la prueba no escribe en la base.
//   PORT=5173 node e2e/cuenca-anotaciones.mjs
import { chromium } from 'playwright';
import { irA } from './_cuenca.mjs';
const PORT = process.env.PORT || 5173;
const VP = [['1440', 1440, 900], ['ipad', 1180, 820], ['iphone', 430, 932]];
const b = await chromium.launch(); let fallos = 0;

for (const [n, w, h] of VP) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1200, isMobile: w < 500, serviceWorkers: 'block' });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const falla = (msg) => { fallos++; console.log(`  ✗ [${n}] ${msg}`); };
  const filas = []; const altas = []; let cambios = 0;
  await pg.route('**/rest/v1/cuerpos_agua_anotaciones*', async (route) => {
    const req = route.request(), m = req.method();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (m === 'POST') {
      const cuerpo = JSON.parse(req.postData() || '{}'); altas.push(cuerpo);
      filas.push({ id: filas.length + 1, anulada: false, creado_por: null, creado_en: new Date().toISOString(), ...cuerpo });
      return route.fulfill({ status: 201, headers: cors, body: '' });
    }
    if (m === 'PATCH') {
      const id = Number(/id=eq\.(\d+)/.exec(req.url())?.[1]); const f = filas.find((x) => x.id === id);
      if (f) { f.anulada = true; cambios++; }
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(f ? [{ id }] : []) });
    }
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(filas) });
  });

  await pg.goto(`http://localhost:${PORT}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'domcontentloaded' });
  await pg.waitForSelector('.cu-root .an-kpis', { timeout: 60000 });
  await irA(pg, 'Balance');
  const sec = pg.locator('#cu-anotaciones');
  await sec.waitFor({ timeout: 45000 });
  await sec.scrollIntoViewIfNeeded();
  if (n === 'ipad') await pg.evaluate(() => document.documentElement.setAttribute('data-device', 'tablet'));

  if (!(await sec.locator('form.cu-an-form').count())) falla('no aparece el formulario (rol SRL en local)');
  if (!/Sin anotaciones todavía/.test(await sec.innerText())) falla('sin filas debe decir «Sin anotaciones todavía»');

  // 1. Captura vacía: no se envía y dice qué falta.
  await sec.locator('button[type=submit]').click();
  await pg.waitForTimeout(300);
  const t1 = await sec.innerText();
  if (!/sin cifra no hay lectura/i.test(t1)) falla('captura sin cifra: falta el error del almacenamiento');
  if (!/de dónde salió la cifra/i.test(t1)) falla('captura sin origen: falta el error');
  if (altas.length) falla('una captura inválida no debe enviarse');

  // 2. Solo cuerpos sin telemetría en la captura manual.
  const ops = await sec.locator('select').first().locator('option').allInnerTexts();
  if (ops.some((o) => /Boquilla|Madero/.test(o))) falla(`la captura manual ofrece vasos con telemetría: ${ops.join(', ')}`);
  if (!ops.length) falla('no hay cuerpos sin telemetría para capturar');

  // 3. Captura válida.
  const campos = sec.locator('.cu-an-form input[type=text]');
  await campos.nth(0).fill('1.25');
  await campos.nth(2).fill('Reporte del jefe de presa (prueba)');
  await sec.locator('button[type=submit]').click();
  await pg.waitForTimeout(900);
  if (altas.length !== 1) falla(`se esperaba 1 alta, hubo ${altas.length}`);
  else {
    const a = altas[0];
    if (a.tipo !== 'captura' || a.almacenamiento_mm3 !== 1.25 || a.elevacion_msnm !== null || !a.origen || !/^\d{4}-\d{2}-\d{2}$/.test(a.fecha)) falla(`alta mal formada: ${JSON.stringify(a)}`);
  }
  if (!/guardada para/i.test(await sec.innerText())) falla('no confirma el guardado');
  if ((await sec.locator('tbody tr').count()) !== 1) falla('la captura no aparece en la tabla');
  if (!/1\.25 Mm³/.test(await sec.locator('tbody').innerText())) falla('la tabla no muestra la cifra capturada');

  // 4. Lectura sospechosa exige comentario.
  await sec.locator('.an-seg-btn:text-is("Lectura sospechosa")').click();
  await sec.locator('button[type=submit]').click();
  await pg.waitForTimeout(300);
  if (!/por qué la lectura es sospechosa/i.test(await sec.innerText())) falla('lectura sospechosa sin comentario: falta el error');
  if (altas.length !== 1) falla('la nota sin comentario no debe enviarse');

  // 5. Táctil y desbordes.
  const med = await pg.evaluate(() => {
    const s = document.querySelector('#cu-anotaciones'), main = document.querySelector('.main-content');
    const peq = [...s.querySelectorAll('button, input, select')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44; }).map((e) => `${e.tagName}:${(e.textContent || e.type || '').trim().slice(0, 18)}:${Math.round(e.getBoundingClientRect().height)}`);
    const chico = [...s.querySelectorAll('*')].filter((e) => e.children.length === 0 && (e.textContent || '').trim() && parseFloat(getComputedStyle(e).fontSize) < 11).length;
    return { peq, chico, scrollW: main ? main.scrollWidth - main.clientWidth : -1, nan: /NaN|undefined/.test(s.innerText) };
  });
  if (n !== '1440' && med.peq.length) falla(`controles < 44 px: ${med.peq.join(', ')}`);
  if (med.chico) falla(`${med.chico} textos menores a 11 px`);
  if (med.scrollW > 2) falla(`desborde horizontal ${med.scrollW}px`);
  if (med.nan) falla('texto con NaN/undefined');

  // 6. Anular con confirmación: queda en el historial, oculta por defecto.
  await sec.locator('tbody button:text-is("Anular")').first().click();
  await sec.locator('button:text-is("Sí, anular")').click();
  await pg.waitForTimeout(900);
  if (cambios !== 1) falla('la anulación no llegó a la base');
  if ((await sec.locator('tbody tr').count()) !== 0) falla('la anotación anulada sigue visible por defecto');
  if (!/Ver anuladas \(1\)/.test(await sec.innerText())) falla('falta «Ver anuladas (1)»');

  if (errs.length) falla(`errores de consola/página: ${errs.slice(0, 2).join(' | ')}`);
  console.log(n, 'altas:', altas.length, 'anulaciones:', cambios, 'controles<44:', med.peq.length);
  await ctx.close();
}

// Sin la tabla en la base (migración sin aplicar): la sección lo dice y no ofrece el formulario.
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const pg = await ctx.newPage();
  await pg.route('**/rest/v1/cuerpos_agua_anotaciones*', (route) => route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.cuerpos_agua_anotaciones' in the schema cache" }) }));
  await pg.goto(`http://localhost:${PORT}/presas?tab=analitica&vista=cuenca`, { waitUntil: 'domcontentloaded' });
  await pg.waitForSelector('.cu-root .an-kpis', { timeout: 60000 });
  await irA(pg, 'Balance');
  const sec = pg.locator('#cu-anotaciones'); await sec.waitFor({ timeout: 45000 }); await pg.waitForTimeout(800);
  const t = await sec.innerText();
  if (!/Edición no disponible todavía/.test(t)) { fallos++; console.log('  ✗ [sin tabla] no avisa que la edición no está disponible'); }
  if (await sec.locator('form.cu-an-form').count()) { fallos++; console.log('  ✗ [sin tabla] ofrece el formulario sin tabla'); }
  console.log('sin tabla: aviso mostrado');
  await ctx.close();
}
await b.close();
console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo en orden');
process.exit(fallos ? 1 : 0);
