// SICA Conservación · perfil del canal y ventana de ubicación de «Comprobación por tramo» (Playwright, solo lectura).
//   Uso:  node e2e/conservacion-ubicacion.mjs [desktop|ipad|iphone|all] [conTeselas]     (requiere `npm run dev` en :5173)
// Las teselas satelitales externas se BLOQUEAN con page.route para que la prueba sea estable y para comprobar que el mapa degrada bien
// (con `conTeselas` se sirven teselas sintéticas, solo para ver el aspecto normal en las capturas).
// Mide: 0 errores de consola/red, objetivos táctiles ≥44 px, texto ≥12 px, sin desborde horizontal, foco y Escape en la ventana,
// perfil operable solo con teclado, la ventana no tapa el menú lateral, y que el tramo del perfil es el de la ficha.
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('./out/ubic/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const sel = process.argv.find((a) => ['desktop', 'ipad', 'iphone', 'all'].includes(a)) ?? 'all';
const conTeselas = process.argv.includes('conTeselas');
const teselasReales = process.argv.includes('reales'); // sin bloqueo: sirve las teselas satelitales de verdad (necesita red)
const VPS = {
  desktop: { viewport: { width: 1440, height: 900 }, opts: {} },
  ipad: { viewport: { width: 1180, height: 820 }, opts: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  iphone: { viewport: { width: 440, height: 956 }, opts: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
};
const IGNORE = /AUTH_BYPASS|WebSocket|realtime|\[vite\]|DevTools|favicon|supabase|ResizeObserver/i;
// Tesela sintética (solo con `conTeselas`): ruido verde/pardo de 256x256, para ver el símbolo sobre un fondo parecido a una imagen satelital.
import zlib from 'zlib';
function pngRuido() {
  const W = 256, raw = Buffer.alloc((W * 3 + 1) * W);
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < W; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W; x++) { const v = (Math.sin(x / 19) + Math.cos(y / 27)) * 12 + rnd() * 22; const o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = 70 + v; raw[o + 1] = 88 + v; raw[o + 2] = 52 + v / 2; } }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const trozo = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', zlib.deflateSync(raw)), trozo('IEND', Buffer.alloc(0))]);
}
const PNG = conTeselas ? pngRuido() : null;

const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };

const browser = await chromium.launch();
for (const nombre of sel === 'all' ? Object.keys(VPS) : [sel]) {
  const vp = VPS[nombre];
  console.log(`\n=== ${nombre} ${vp.viewport.width}x${vp.viewport.height} ===`);
  const ctx = await browser.newContext({ viewport: vp.viewport, serviceWorkers: 'block', ...vp.opts });
  const page = await ctx.newPage();
  const errores = [], red = [];
  let teselasBloqueadas = 0;
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !IGNORE.test(m.text()) && !/arcgisonline/.test(m.location().url ?? '')) errores.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => errores.push(`pageerror: ${String(e.message).slice(0, 200)}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon|\.map$|supabase/.test(r.url())) red.push(`${r.status()} ${r.url().slice(0, 100)}`); });
  // Una lectura cancelada por el propio componente al desmontarse (AbortController, doble efecto de React en dev) no es un fallo de red.
  page.on('requestfailed', (r) => { if (!/arcgisonline/.test(r.url()) && !/supabase|favicon/.test(r.url()) && !/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) red.push(`falla ${r.url().slice(0, 100)}`); });
  let pedidosTrazo = 0;
  page.on('request', (r) => { if (/canal_conchos\.geojson/.test(r.url())) pedidosTrazo++; });
  if (!teselasReales) await page.route(/arcgisonline\.com/, (r) => {
    if (conTeselas) return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    teselasBloqueadas++; return r.abort();
  });
  const foto = (n, opts = {}) => page.screenshot({ path: `${OUT}${nombre}_${n}.png`, ...opts });

  await page.addInitScript(() => { try { sessionStorage.clear(); } catch { /* nada */ } });
  await page.goto('http://localhost:5173/conservacion?seccion=derivacion', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForSelector('.cons-der-slots', { timeout: 120000 });
  await page.getByRole('tab', { name: /Comprobación por tramo/ }).click();
  // El perfil llega plegado (tira de ~120 px): estas pruebas miden el perfil completo.
  await page.getByRole('button', { name: /Ver perfil completo/ }).click();
  await page.waitForSelector('.pf', { timeout: 30000 });
  await page.waitForTimeout(600);
  const esPhone = nombre === 'iphone';

  // Tanda 3 (T-09): en pantallas chicas los avisos de cadenamiento van plegados; se despliegan para leerlos.
  const abreAvisos = async () => { const d = page.locator('.cons-ubic-avisos-det'); if ((await d.count()) > 0 && (await d.first().getAttribute('open')) === null) await d.first().locator('summary').click(); };
  const tramoDeBanda = (label) => { const m = /Tramo K-(\d+\+\d+) a K-(\d+\+\d+)/.exec(label ?? ''); return m ? `${m[1]} → ${m[2]}` : null; };
  const tramoFicha = async () => (await page.locator('.cons-comp-ficha .cf-pk').first().innerText()).replace(/K-/g, '').trim();
  const bandaSel = () => page.locator('.pf-banda[aria-pressed="true"]').first();

  // 1 · el perfil existe y cuenta lo mismo que el modelo
  const dn = await page.evaluate(() => ({ ...document.querySelector('.pf').dataset }));
  verifica(Number(dn.nTramos) === 60 && Number(dn.nEstructuras) === 385, `perfil: ${dn.nTramos} tramos y ${dn.nEstructuras} estructuras (esperado 60 y 385)`);
  verifica((await page.locator('.cons-rc').count()) === 0, 'la fila de recuadros .cons-rc ya no se usa en la pantalla');
  verifica((await page.locator('.pf-banda').count()) > 5, `bandas visibles: ${await page.locator('.pf-banda').count()}`);
  verifica((await page.locator('.pf-banda[role="button"][aria-label^="Tramo K-"]').count()) === (await page.locator('.pf-banda').count()), 'toda banda es role=button con aria-label «Tramo K-.. a K-.., estado»');

  // 2 · el tramo del perfil es el de la ficha (clic en una banda)
  const bandas = page.locator('.pf-banda');
  const nb = await bandas.count();
  const objetivo = bandas.nth(Math.min(3, nb - 1));
  const etq = await objetivo.getAttribute('aria-label');
  await objetivo.click({ force: true }); await page.waitForTimeout(250);
  verifica(tramoDeBanda(etq) === (await tramoFicha()), `clic en banda → la ficha muestra ${tramoDeBanda(etq)} (ficha: ${await tramoFicha()})`);
  verifica(tramoDeBanda(await bandaSel().getAttribute('aria-label')) === tramoDeBanda(etq), 'la banda seleccionada (aria-pressed) es la del clic');

  // 3 · la selección desde fuera (Siguiente) mueve la banda seleccionada
  await page.getByRole('button', { name: /Siguiente/ }).click(); await page.waitForTimeout(250);
  verifica(tramoDeBanda(await bandaSel().getAttribute('aria-label')) === (await tramoFicha()), `Siguiente: perfil y ficha coinciden (${await tramoFicha()})`);

  // 4 · teclado: ← → cambian de tramo, Intro abre, foco dentro, Tab atrapado, Escape cierra y devuelve el foco
  await bandaSel().focus();
  const antes = await tramoFicha();
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250);
  const despues = await tramoFicha();
  verifica(antes !== despues, `teclado: → cambia de tramo (${antes} → ${despues})`);
  verifica(await page.evaluate(() => document.activeElement?.classList.contains('pf-banda')), 'teclado: el foco queda en la banda del nuevo tramo');
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(250);
  verifica((await tramoFicha()) === antes, 'teclado: ← regresa al tramo anterior');
  const rango0 = (await page.locator('.pf-rango').count()) ? await page.locator('.pf-rango').innerText() : null;
  if (rango0) {
    await page.keyboard.press('Shift+ArrowRight'); await page.waitForTimeout(200);
    const rango1 = await page.locator('.pf-rango').innerText();
    verifica(rango1 !== rango0, `teclado: Mayús+→ mueve la vista (${rango0} → ${rango1})`);
    await page.keyboard.press('+'); await page.waitForTimeout(200);
    const rango2 = await page.locator('.pf-rango').innerText();
    verifica(rango2 !== rango1, `teclado: + acerca (${rango1} → ${rango2})`);
    await page.keyboard.press('-'); await page.waitForTimeout(150);
    await page.keyboard.press('End'); await page.waitForTimeout(250);
    verifica((await page.locator('.pf-rango').innerText()).includes('K-98+'), `teclado: Fin lleva al último tramo (${await page.locator('.pf-rango').innerText()})`);
    await page.keyboard.press('Home'); await page.waitForTimeout(250);
    verifica((await page.locator('.pf-rango').innerText()).startsWith('K-0+000'), 'teclado: Inicio lleva al primer tramo');
  }

  // 5 · medir el perfil: texto ≥12 px, objetivos táctiles, desborde
  const medida = () => page.evaluate((raices) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const out = { chico: [], peq: [] };
    for (const sel of raices) {
      const raiz = document.querySelector(sel);
      if (!raiz) continue;
      raiz.querySelectorAll('*').forEach((el) => {
        if (!vis(el)) return;
        if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
          const px = parseFloat(getComputedStyle(el).fontSize);
          if (px < 11.95 && !el.closest('.pf-solo-lector, .cons-solo-lector, .leaflet-control-zoom')) out.chico.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').toString().slice(0, 30)} ${px}px «${el.textContent.trim().slice(0, 20)}»`);
        }
        if (el.matches('button, select, summary, a, [role=button], input')) {
          if (el.closest('.leaflet-control-attribution')) return; // enlaces de atribución obligatoria de Leaflet/Esri
          const r = el.getBoundingClientRect();
          // Una banda de 1 km a escala de 24 km mide ~40 px de ancho: el requisito es el alto (48 px); el ancho se recupera con el zoom.
          const angosta = el.getAttribute('role') === 'button' && el.closest('svg') !== null;
          if (r.height < 43.5 || (!angosta && r.width < 43.5)) out.peq.push(`${el.tagName.toLowerCase()} «${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 24)}» ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      });
    }
    out.desborde = document.documentElement.scrollWidth > innerWidth + 2;
    out.tokens = ['NaN', 'undefined', 'Infinity', '[object Object]'].filter((t) => (document.body.innerText || '').includes(t));
    return out;
  }, ['.cons-comp-recorrido', '.cons-inv', '.cons-comp-cab']);
  let m = await medida();
  verifica(m.chico.length === 0, `texto ≥12 px en perfil/inventario ${m.chico.length ? JSON.stringify([...new Set(m.chico)].slice(0, 6)) : ''}`);
  verifica(m.peq.length === 0, `objetivos táctiles ≥44 px en perfil/inventario ${m.peq.length ? JSON.stringify([...new Set(m.peq)].slice(0, 8)) : ''}`);
  verifica(!m.desborde, 'sin desborde horizontal del documento (perfil)');
  verifica(m.tokens.length === 0, 'sin NaN/undefined en pantalla');
  await page.locator('.cons-comp-recorrido').scrollIntoViewIfNeeded();
  await page.locator('.cons-comp-recorrido').screenshot({ path: `${OUT}${nombre}_perfil.png` });

  // 6 · filtro por familia
  const nObrasAntes = await page.locator('.pf-obra').count();
  const primerFiltro = page.locator('.cons-comp-recorrido > .cons-leyfam button.cons-leyfam-it').first();
  await primerFiltro.click(); await page.waitForTimeout(200);
  verifica((await primerFiltro.getAttribute('aria-pressed')) === 'false' && (await page.locator('.pf-obra').count()) < nObrasAntes, `filtro por familia: ${nObrasAntes} → ${await page.locator('.pf-obra').count()} grupos`);
  await primerFiltro.click(); await page.waitForTimeout(150);

  // 7 · abrir con Intro desde la banda → foco dentro → Tab atrapado → Escape devuelve el foco
  await bandaSel().focus();
  const filaAbre = await tramoFicha();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.cons-ubic', { timeout: 20000 });
  await page.waitForTimeout(1500);
  verifica(await page.evaluate(() => !!document.activeElement?.closest('.cons-ubic')), 'ventana: el foco entra a la ventana');
  const rol = await page.locator('.cons-ubic').getAttribute('role');
  verifica(rol === 'dialog' && (await page.locator('.cons-ubic').getAttribute('aria-modal')) === 'true' && !!(await page.locator('.cons-ubic').getAttribute('aria-labelledby')), 'ventana: role=dialog, aria-modal y aria-labelledby');
  const titulo = await page.locator('.cons-ubic-tit').innerText();
  verifica(tramoDeBanda(`Tramo K-${filaAbre.split(' → ')[0]} a K-${filaAbre.split(' → ')[1]}`) !== null && titulo.replace(/K-/g, '').includes(filaAbre), `ventana: el título nombra el tramo de la ficha (${filaAbre})`);
  let sale = 0;
  for (let i = 0; i < 60; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement?.closest('.cons-ubic')))) { sale++; break; } }
  verifica(sale === 0, 'ventana: el foco con Tab no sale de la ventana (60 Tab)');
  const txt = await page.locator('.cons-ubic').innerText();
  verifica(/La ubicación es la declarada por el PacOT; no acredita la posición física\./.test(txt), 'ventana: texto fijo «La ubicación es la declarada por el PacOT…»');
  verifica(/PK inicial/.test(txt) && /PK final/.test(txt) && /Longitud/.test(txt) && /Coordenadas en IO1/.test(txt) && /Conteo de estructuras IO1 vs IO4/.test(txt) && /Comprobación del concepto/.test(txt), 'ventana: panel con PK, longitud, coordenadas, comprobación del concepto y conteo IO1 vs IO4');
  verifica((await page.locator('.cons-ubic canvas').count()) > 0, `ventana: el mapa dibuja en canvas (${await page.locator('.cons-ubic canvas').count()})`);
  if (!conTeselas && !teselasReales) {
    await page.waitForSelector('.cons-ubic-aviso', { timeout: 15000 }).catch(() => {});
    verifica((await page.locator('.cons-ubic-aviso').count()) === 1, `ventana: sin teselas (${teselasBloqueadas} bloqueadas) el mapa lo avisa y sigue mostrando trazo y marcadores`);
  }
  // sidebar
  const geo = await page.evaluate(() => {
    const f = document.querySelector('.cons-ubic-fondo').getBoundingClientRect();
    const d = document.querySelector('.cons-ubic').getBoundingClientRect();
    const sb = document.querySelector('.sidebar')?.getBoundingClientRect();
    return { fondoLeft: f.left, dialogW: d.width, dialogH: d.height, vw: innerWidth, vh: innerHeight, sbRight: sb && sb.width > 0 ? sb.right : 0, sbVisible: !!sb && sb.right > 0 && sb.left >= 0 };
  });
  if (esPhone) verifica(geo.fondoLeft === 0 && geo.dialogW >= geo.vw - 1 && geo.dialogH >= geo.vh - 1, `ventana: en teléfono ocupa toda la pantalla (${Math.round(geo.dialogW)}x${Math.round(geo.dialogH)})`);
  else verifica(geo.fondoLeft >= geo.sbRight - 1, `ventana: no tapa el menú lateral (fondo.left ${geo.fondoLeft} ≥ sidebar.right ${geo.sbRight})`);
  const med2 = await page.evaluate((raices) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const out = { chico: [], peq: [] };
    document.querySelector('.cons-ubic').querySelectorAll('*').forEach((el) => {
      if (!vis(el)) return;
      if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
        const px = parseFloat(getComputedStyle(el).fontSize);
        if (px < 11.95 && !el.closest('.cons-solo-lector')) out.chico.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').toString().slice(0, 30)} ${px}px «${el.textContent.trim().slice(0, 20)}»`);
      }
      if (el.matches('button, select, summary, a, [role=button], input, .leaflet-marker-icon')) {
        if (el.closest('.leaflet-control-attribution')) return;
        const r = el.getBoundingClientRect();
        if (r.height < 43.5 || r.width < 43.5) out.peq.push(`${el.tagName.toLowerCase()} «${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 24)}» ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    });
    out.desborde = document.documentElement.scrollWidth > innerWidth + 2;
    const dlg = document.querySelector('.cons-ubic');
    out.desbordeDialogo = dlg.scrollWidth > dlg.clientWidth + 2;
    out.tokens = ['NaN', 'undefined', 'Infinity', '[object Object]'].filter((t) => (dlg.innerText || '').includes(t));
    return out;
  }, []);
  verifica(med2.chico.length === 0, `ventana: texto ≥12 px ${med2.chico.length ? JSON.stringify([...new Set(med2.chico)].slice(0, 6)) : ''}`);
  verifica(med2.peq.length === 0, `ventana: objetivos táctiles ≥44 px ${med2.peq.length ? JSON.stringify([...new Set(med2.peq)].slice(0, 8)) : ''}`);
  verifica(!med2.desborde && !med2.desbordeDialogo, 'ventana: sin desborde horizontal');
  verifica(med2.tokens.length === 0, 'ventana: sin NaN/undefined');
  await foto('modal');
  if (esPhone) { await page.locator('.cons-ubic-cuerpo').evaluate((e) => { e.scrollTop = e.scrollHeight * 0.45; }); await page.waitForTimeout(300); await foto('modal_panel'); await page.locator('.cons-ubic-cuerpo').evaluate((e) => { e.scrollTop = 0; }); }
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  verifica((await page.locator('.cons-ubic').count()) === 0, 'ventana: Escape la cierra');
  verifica(await page.evaluate(() => document.activeElement?.classList.contains('pf-banda')), 'ventana: Escape devuelve el foco a la banda que la abrió');

  // 8 · doble clic en una banda abre la ventana del tramo de la banda; botón X cierra (≥44 px)
  const b2 = page.locator('.pf-banda').nth(1);
  const etq2 = await b2.getAttribute('aria-label');
  await b2.dblclick({ force: true });
  await page.waitForSelector('.cons-ubic', { timeout: 20000 });
  await page.waitForTimeout(800);
  verifica(((await page.locator('.cons-ubic-tit').innerText()).replace(/K-/g, '')).includes(tramoDeBanda(etq2)), `doble clic: abre la ventana del tramo ${tramoDeBanda(etq2)}`);
  const x = await page.getByRole('button', { name: /Cerrar la ventana/ }).boundingBox();
  verifica(x.width >= 44 && x.height >= 44, `botón cerrar ${Math.round(x.width)}x${Math.round(x.height)}`);
  await page.getByRole('button', { name: /Cerrar la ventana/ }).click(); await page.waitForTimeout(300);
  verifica((await page.locator('.cons-ubic').count()) === 0, 'ventana: el botón X la cierra');

  // 9 · un tramo con obras de ubicación estimada: símbolo punteado + rótulo, y las que no se ubican se listan
  const opciones = await page.locator('#cons-comp-tramo option').evaluateAll((o) => o.map((x) => x.value));
  let conEst = null;
  for (const v of opciones) {
    await page.selectOption('#cons-comp-tramo', v);
    if ((await page.locator('.cons-comp-ficha .cons-inv-lista .cons-ubic-marca-estimada').count()) > 0) { conEst = v; break; }
  }
  verifica(conEst !== null, `existe un tramo con obras de ubicación estimada (fila ${conEst})`);
  if (conEst !== null) {
    await page.locator('.cons-comp-ficha .cons-inv summary').first().click();
    await page.locator('.cons-comp-ficha .cons-inv-ver').first().scrollIntoViewIfNeeded();
    const filaEst = page.locator('.cons-comp-ficha .cons-inv-lista li', { has: page.locator('.cons-ubic-marca-estimada') }).first();
    await filaEst.locator('.cons-inv-ver').click();
    await page.waitForSelector('.cons-ubic', { timeout: 20000 });
    await page.waitForTimeout(1500);
    verifica((await page.locator('.cons-mk-rotulo-est').count()) > 0 && /posición estimada/.test(await page.locator('.cons-mk-rotulo-est').first().innerText()), 'mapa: la obra estimada lleva el rótulo «posición estimada»');
    verifica((await page.locator('.cons-ubic-ficha').count()) === 1 && /Ficha de la obra/.test(await page.locator('.cons-ubic-ficha').innerText()), 'ventana: desde una estructura se abre su ficha');
    verifica(/estimada con su cadenamiento/.test(await page.locator('.cons-ubic-ficha').innerText()), 'ficha de la obra: dice que la ubicación es estimada y su motivo');
    await foto('modal_estimada');
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    verifica(await page.evaluate(() => document.activeElement?.classList.contains('cons-inv-ver')), 'ventana abierta desde una obra: Escape devuelve el foco a su botón «Ver»');
  }

  // 10 · tramos atípicos: banda con trama y glifo «!»
  const iDes = await page.locator('#cons-comp-con option').evaluateAll((o) => o.findIndex((x) => /DESAZOLVE/i.test(x.textContent ?? '')));
  if (iDes >= 0) {
    await page.selectOption('#cons-comp-con', { index: iDes }); await page.waitForTimeout(300);
    await page.getByRole('button', { name: /Solo atípicos/ }).click(); await page.waitForTimeout(300);
    verifica((await page.locator('.pf-atipico .pf-glifo').count()) > 0 && (await page.locator('.pf-atipico .pf-banda-trama').count()) > 0, 'atípico: banda con glifo «!» y trama (no solo color)');
    await page.locator('.cons-comp-recorrido').screenshot({ path: `${OUT}${nombre}_perfil_atipicos.png` });
    await page.getByRole('button', { name: /Solo atípicos/ }).click();
  }

  // 11 · el ramal auxiliar tiene su propio eje
  verifica((await page.locator('.pf-pista').count()) === 2 && /nace en K-68\+582/.test(await page.locator('.pf-pista-cab').nth(1).innerText()), 'ramal auxiliar K-68+582: pista propia con cadenamiento propio');

  // 12 · contorno real del tramo: insignia de calidad, saltos de cadenamiento, contradicción IO1/IO3, auxiliar sin contorno, un solo fetch del trazo
  const abreTramoPor = async (re) => {
    const v = await page.locator('#cons-comp-tramo option').evaluateAll((o, src) => { const r = new RegExp(src); const x = o.find((e) => r.test((e.textContent ?? '').replace(/K-/g, '').replace(/ ·.*$/, '').trim())); return x ? x.value : null; }, re.source);
    if (v === null) return false;
    await page.selectOption('#cons-comp-tramo', v); await page.waitForTimeout(250);
    await page.locator('.cons-comp-ubicar').scrollIntoViewIfNeeded();
    await page.locator('.cons-comp-ubicar').click();
    await page.waitForSelector('.cons-ubic', { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('.cons-ubic-nota-corta'), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2200);
    return true;
  };
  const cierraModal = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); };
  if (await abreTramoPor(/^56\+000 → 58\+000/)) {
    const ins = await page.locator('.cons-ubic-insignia').innerText();
    verifica(/^Contorno real · \d+ ancla/.test(ins) && /respaldo \d+ %/.test(ins), `K-56→58: insignia «${ins}»`);
    const t = await page.locator('.cons-ubic').innerText();
    verifica(/Comprobación del concepto/.test(t) && /Conteo de estructuras IO1 vs IO4/.test(t), 'K-56→58: etiquetas separadas «Comprobación del concepto» y «Conteo de estructuras IO1 vs IO4»');
    verifica(!/Conteo:[^\n]*atípico/.test(t), 'K-56→58: el conteo nunca usa la palabra «atípico» (usa «difiere»)');
    const tit = await page.locator('.cons-ubic-tit').innerText();
    verifica(/SRL/.test(tit) && /Red de distribución/.test(tit) && /56\+000/.test(tit), `K-56→58: el título nombra PacOT, red, concepto y tramo («${tit.replace(/\n/g, ' | ').slice(0, 170)}»)`);
    await page.waitForTimeout(600);
    await foto('contorno_56_58');
    await cierraModal();
  } else verifica(false, 'existe el tramo K-56+000 → K-58+000');
  if (await abreTramoPor(/^46\+000 → 46\+500/)) {
    await abreAvisos();
    const t = await page.locator('.cons-ubic-calidad').innerText();
    verifica(/salto de ~235 m respecto al trazo/.test(t), `K-46+000→46+500: aviso de salto de cadenamiento (${t.replace(/\n/g, ' | ').slice(0, 160)})`);
    await foto('salto_46');
    await cierraModal();
  } else verifica(false, 'existe el tramo K-46+000 → K-46+500');
  const ultimo = await page.locator('#cons-comp-tramo option').evaluateAll((o) => o.map((x) => x.textContent.replace(/K-/g, '').replace(/ ·.*$/, '').trim()).filter((x) => /→ 98\+951/.test(x)).pop() ?? null);
  if (ultimo !== null && await abreTramoPor(new RegExp('^' + ultimo.split(' ')[0].replace('+', '\\+') + ' → 98\\+951'))) {
    await abreAvisos();
    const t = await page.locator('.cons-ubic-calidad').innerText();
    verifica(/IO3/.test(t) && /~101 m/.test(t), `tramo final: aviso de la contradicción IO1/IO3 (${t.replace(/\n/g, ' | ').slice(0, 200)})`);
    await foto('final_io3');
    await cierraModal();
  } else verifica(false, 'existe el último tramo (→ K-98+951)');
  // auxiliar: cuerda punteada rotulada
  await page.locator('.pf-pista').nth(1).locator('.pf-banda').first().click({ force: true }); await page.waitForTimeout(300);
  await page.locator('.cons-comp-ubicar').click();
  await page.waitForSelector('.cons-ubic', { timeout: 20000 }); await page.waitForTimeout(1800);
  verifica(/Auxiliar K-68\+582 · sin contorno real \(solicitar el trazo a la SRL\)/.test(await page.locator('.cons-ubic-insignia').innerText()), 'auxiliar: rótulo «sin contorno real (solicitar el trazo a la SRL)»');
  await foto('auxiliar');
  await cierraModal();
  verifica(pedidosTrazo <= 1, `el trazo se pidió una sola vez (${pedidosTrazo})`);

  // 13 · Módulo 5 (si está cargado): estructuras repartidas por canal, nunca ×20
  if ((await page.locator('#cons-comp-amb option').count()) > 1) {
    await page.selectOption('#cons-comp-amb', { index: 1 });
    await page.waitForSelector('.pf', { timeout: 120000 }); await page.waitForTimeout(1500);
    const d5 = await page.evaluate(() => ({ ...document.querySelector('.pf').dataset, resumen: document.querySelector('.pf-resumen').innerText }));
    verifica(Number(d5.nEstructuras) > 0 && Number(d5.nEstructuras) <= 1715 && Number(d5.nEdificios) <= 6, `M5: ${d5.nEstructuras} estructuras y ${d5.nEdificios} edificios en el perfil (≤ 1 715 y ≤ 6; nunca 34 300)`);
    verifica(!/34 ?300|34 ?420/.test(await page.locator('body').innerText()), 'M5: no aparece «34 300» ni «34 420» en pantalla');
    const nPistas = await page.locator('.pf-pista').count();
    verifica(nPistas > 5, `M5: un eje por canal (${nPistas})`);
    await page.locator('.cons-comp-recorrido').scrollIntoViewIfNeeded();
    await page.locator('.cons-comp-recorrido').screenshot({ path: `${OUT}${nombre}_m5_perfil.png` });
    // un tramo de M5 se abre nombrando el canal por su inventario
    await page.locator('.pf-banda').first().click({ force: true }); await page.waitForTimeout(300);
    await page.locator('.cons-comp-ubicar').click();
    await page.waitForSelector('.cons-ubic', { timeout: 20000 }); await page.waitForTimeout(1800);
    const tm5 = await page.locator('.cons-ubic-tit').innerText();
    verifica(/inventario \d+/.test(tm5), `M5: la ventana nombra el canal por su inventario («${tm5.replace(/\n/g, ' | ').slice(0, 170)}»)`);
    const ins5 = await page.locator('.cons-ubic-insignia').innerText();
    verifica(/sin contorno real/.test(ins5) && !/Contorno real/.test(ins5), `M5: sin trazo propio, el canal se dibuja como cuerda rotulada «${ins5}»`);
    await foto('m5_modal');
    await cierraModal();
    await page.selectOption('#cons-comp-amb', { index: 0 }); await page.waitForTimeout(800);
  }

  verifica(errores.length === 0, `0 errores de consola (${errores.length}) ${errores.length ? JSON.stringify(errores.slice(0, 4)) : ''}`);
  verifica(red.length === 0, `0 errores de red (${red.length}) ${red.length ? JSON.stringify(red.slice(0, 4)) : ''}`);
  await ctx.close();
}
await browser.close();
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo OK');
process.exit(fallos.length ? 1 : 0);
