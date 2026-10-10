// Infografías de «Comprobación por tramo» (SICA Conservación): pulsa «Infografía del tramo» y «Infografía del concepto»,
// captura cada descarga y valida el PNG (firma, tamaño, no en blanco, colores de origen) y el HTML (sin texto recortado).
//   node e2e/infografia-comprobacion.mjs [carpeta=infografia-comprobacion]      (requiere dev server en :5173)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const carpeta = process.argv[2] || 'infografia-comprobacion';
const OUT = fileURLToPath(new URL(`./out/${carpeta}/`, import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const errs = [];
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, serviceWorkers: 'block' });
// Guarda el HTML que se le entrega a rasterizaHtml (Blob text/html) para auditar el texto recortado.
await ctx.addInitScript(() => {
  window.__htmls = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { try { if (b instanceof Blob && /^text\/html/.test(b.type)) b.text().then((t) => window.__htmls.push(t)); } catch { /* nada */ } return orig(b); };
  try { sessionStorage.clear(); } catch { /* nada */ }
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const IGNORA = /favicon|ResizeObserver|AUTH_BYPASS|WebSocket|realtime|\[vite\]|DevTools|supabase/i;

await page.goto('http://localhost:5173/conservacion?seccion=derivacion', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForSelector('.cons-der-slots', { timeout: 120000 });
await page.getByRole('tab', { name: /Comprobación por tramo/ }).click();
await page.waitForSelector('#cons-comp-con', { timeout: 30000 });
// El perfil llega plegado: la paridad pantalla ↔ infografía mide el perfil completo.
await page.getByRole('button', { name: /Ver perfil completo/ }).click();

const conceptos = await page.locator('#cons-comp-con option').allInnerTexts();
console.log('Conceptos:', conceptos);
const idxConcepto = (re) => conceptos.findIndex((c) => re.test(c));
const elige = async (i) => { await page.selectOption('#cons-comp-con', { index: i }); await page.waitForTimeout(250); };
const eligeFila = async (fila) => { await page.selectOption('#cons-comp-tramo', String(fila)); await page.waitForTimeout(250); };

// Verificadores de un PNG descargado ---------------------------------------------------------------------------
const verPagina = await ctx.newPage();
await verPagina.setContent('<html><body></body></html>');
async function analizaPng(ruta) {
  const b64 = fs.readFileSync(ruta).toString('base64');
  return verPagina.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = `data:image/png;base64,${b64}`; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const cerca = (r, gg, b, R, G, B, t = 28) => Math.abs(r - R) < t && Math.abs(gg - G) < t && Math.abs(b - B) < t;
    let distinto = 0, azul = 0, violeta = 0, ambar = 0, verde = 0, marron = 0;
    const n = c.width * c.height;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      if (!cerca(r, gg, b, 0xFA, 0xF6, 0xEA, 6)) distinto++;
      if (cerca(r, gg, b, 0x1C, 0x5E, 0x95)) azul++;
      if (cerca(r, gg, b, 0x6D, 0x3F, 0xC0)) violeta++;
      if (cerca(r, gg, b, 0xD9, 0x92, 0x0B)) ambar++;
      if (cerca(r, gg, b, 0x1B, 0x8A, 0x5A)) verde++;
      if (cerca(r, gg, b, 0x6B, 0x2D, 0x2D)) marron++;
    }
    return { w: c.width, h: c.height, distintoPct: (100 * distinto) / n, azul, violeta, ambar, verde, marron };
  }, b64);
}

// Texto recortado: carga el HTML en 1080 px y busca desbordes horizontales ------------------------------------
const htmlPagina = await ctx.newPage();
await htmlPagina.setViewportSize({ width: 1080, height: 300 });
async function auditaHtml(html) {
  await htmlPagina.setContent(html, { waitUntil: 'load' });
  return htmlPagina.evaluate(() => {
    const malos = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('svg')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'inline' || cs.display === 'contents' || el.clientWidth === 0) continue;
      if (el.scrollWidth > el.clientWidth + 1 && !el.classList.contains('cinta')) malos.push(`${el.tagName.toLowerCase()}.${el.className} ${el.scrollWidth}>${el.clientWidth} «${(el.textContent || '').slice(0, 40)}»`);
    }
    return { docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, malos: malos.slice(0, 8), texto: document.body.innerText };
  });
}

let contador = 0;
const PROHIBIDAS = ['NaN', 'undefined', 'null', 'correcto', 'aprobado', 'conforme', 'válido'];
async function descarga(boton, nombreRe, etiqueta) {
  const antes = await page.evaluate(() => window.__htmls.length);
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), boton.click()]);
  const nombre = d.suggestedFilename();
  const ruta = `${OUT}${String(++contador).padStart(2, '0')}_${nombre}`;
  await d.saveAs(ruta);
  await page.waitForFunction((n) => window.__htmls.length > n, antes, { timeout: 5000 }).catch(() => {});
  const html = await page.evaluate(() => window.__htmls[window.__htmls.length - 1] ?? '');
  const buf = fs.readFileSync(ruta);
  const alto = buf.readUInt32BE(20), ancho = buf.readUInt32BE(16);
  verifica(nombreRe.test(nombre), `${etiqueta}: nombre ${nombre}`);
  verifica(buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', `${etiqueta}: firma PNG`);
  verifica(ancho === 2160, `${etiqueta}: ancho 2160 (${ancho})`);
  // El iframe de rasterizaHtml mide mínimo 800 px lógicos: un tramo no evaluable (sin dibujo ni ecuación) es corto y sale de 800.
  verifica(alto >= 1600 && alto <= 6000, `${etiqueta}: alto ${alto} px (lógico ${alto / 2})`);
  verifica(buf.length < 4_000_000, `${etiqueta}: peso ${(buf.length / 1048576).toFixed(2)} MB`);
  const a = await analizaPng(ruta);
  verifica(a.distintoPct > 8, `${etiqueta}: no está en blanco (${a.distintoPct.toFixed(1)} % de píxeles distintos del fondo)`);
  verifica(a.marron > 200, `${etiqueta}: marrón SRL presente (${a.marron} px)`);
  const h = await auditaHtml(html);
  verifica(h.docW === 1080, `${etiqueta}: documentElement.scrollWidth = ${h.docW}`);
  verifica(h.malos.length === 0, `${etiqueta}: sin texto recortado ${h.malos.length ? JSON.stringify(h.malos) : ''}`);
  const prohibidas = PROHIBIDAS.filter((p) => h.texto.includes(p));
  verifica(prohibidas.length === 0, `${etiqueta}: sin palabras prohibidas ${prohibidas.join(',')}`);
  // El PNG no sale recortado: su alto (a 2x) es el alto del documento HTML
  verifica(alto / 2 >= h.docH - 4 && (alto / 2 - h.docH <= 4 || alto / 2 === 800), `${etiqueta}: PNG no recortado (alto PNG/2 = ${alto / 2}, documento = ${h.docH})`);
  console.log(`     → ${ruta}`);
  return { a, h, ruta, html, alto };
}

// Casos ----------------------------------------------------------------------------------------------------------
const iDes = idxConcepto(/DESAZOLVE/i);
const iLim = idxConcepto(/LIMPIA/i);
verifica(iDes >= 0 && iLim >= 0, 'existen los conceptos desazolve y limpia');
const btnTramo = () => page.getByRole('button', { name: 'Infografía del tramo' });
const btnConcepto = () => page.getByRole('button', { name: 'Infografía del concepto' });
const mayorEcuacion = async () => {
  const filas = await page.locator('#cons-comp-tramo option').evaluateAll((o) => o.map((x) => x.value));
  let mejor = { fila: filas[0], n: -1 };
  for (const f of filas) { await eligeFila(f); const n = await page.locator('.cons-comp-ficha .cons-ec-dato').count(); if (n > mejor.n) mejor = { fila: f, n }; }
  return mejor;
};

// 1. Desazolve fila 55 (atípico)
await elige(iDes); await eligeFila(55);
const r1 = await descarga(btnTramo(), /^comprobacion-tramo-fila55-\d{4}-\d{2}-\d{2}\.png$/, 'desazolve f55 (atípico)');
verifica(r1.a.ambar > 150 && r1.a.violeta > 150 && r1.a.azul > 150, `desazolve f55: colores de origen/estado presentes (ámbar ${r1.a.ambar}, violeta ${r1.a.violeta}, azul ${r1.a.azul})`);
verifica(/El libro implica/.test(r1.h.texto) && /Conviene confirmarlo/.test(r1.h.texto), 'desazolve f55: dice qué implica el libro y pide confirmar');

// 2. Limpia fila 17 (cuadra)
await elige(iLim); await eligeFila(17);
const r2 = await descarga(btnTramo(), /^comprobacion-tramo-fila17-\d{4}-\d{2}-\d{2}\.png$/, 'limpia f17 (cuadra)');
verifica(r2.a.verde > 150 && r2.a.violeta > 150 && r2.a.azul > 150, `limpia f17: verde ${r2.a.verde}, violeta ${r2.a.violeta}, azul ${r2.a.azul}`);
verifica(!/Conviene confirmarlo/.test(r2.h.texto), 'limpia f17: sin frase de confirmación (cuadra)');

// 3. Caso extremo: el desazolve con más tokens
await elige(iDes);
const ext = await mayorEcuacion();
console.log('Extremo desazolve: fila', ext.fila, 'con', ext.n, 'datos en la ecuación');
await eligeFila(ext.fila);
await descarga(btnTramo(), /^comprobacion-tramo-fila\d+-/, `desazolve extremo f${ext.fila} (${ext.n} datos)`);

// 4. Concepto sin dibujo (buscar entre todas las redes y conceptos)
let sinDibujo = null;
const redes = (await page.locator('#cons-comp-red option').evaluateAll((o) => o.map((x) => x.value))).filter((v) => v !== 'obras');
buscar: for (const red of redes) {
  await page.selectOption('#cons-comp-red', red); await page.waitForTimeout(250);
  const cs = await page.locator('#cons-comp-con option').allInnerTexts();
  for (let i = 0; i < cs.length; i++) {
    await elige(i);
    if (await page.locator('.cons-comp-dibujo .sc-vacio').count() > 0) { sinDibujo = { red, i, nombre: cs[i] }; break buscar; }
  }
}
if (sinDibujo) {
  console.log('Concepto sin dibujo:', sinDibujo);
  await descarga(btnTramo(), /^comprobacion-tramo-fila\d+-/, `sin dibujo (${sinDibujo.nombre})`);
  await descarga(btnConcepto(), /^comprobacion-concepto-.+-\d{4}-\d{2}-\d{2}\.png$/, `concepto sin dibujo (${sinDibujo.nombre})`);
} else console.log('AVISO: ningún concepto sin dibujo en el PacOT cargado');

// 5. Resúmenes de concepto con dibujo
await page.selectOption('#cons-comp-red', redes.includes('distribucion') ? 'distribucion' : redes[0]); await page.waitForTimeout(250);
for (const [i, nombre] of [[iDes, 'desazolve'], [iLim, 'limpia']]) {
  await elige(i);
  const r = await descarga(btnConcepto(), new RegExp(`^comprobacion-concepto-.*${nombre === 'limpia' ? 'limpia' : 'desazolve'}.*-\\d{4}-\\d{2}-\\d{2}\\.png$`), `concepto ${nombre}`);
  verifica(r.a.verde > 150, `concepto ${nombre}: barra/cinta verde presente (${r.a.verde} px)`);
  if (nombre === 'desazolve') verifica(r.a.ambar > 100 && /\+\d+\s+más en la app|!/.test(r.h.texto), `concepto desazolve: atípicos con ámbar y glifo (ámbar ${r.a.ambar})`);
}

// 6. Paridad pantalla ↔ infografía: mismos tramos y mismas obras
await page.selectOption('#cons-comp-red', redes.includes('distribucion') ? 'distribucion' : redes[0]); await page.waitForTimeout(250);
await elige(iLim);
const pant = await page.evaluate(() => ({ ...document.querySelector('.pf').dataset }));
const rc = await descarga(btnConcepto(), /^comprobacion-concepto-/, 'paridad concepto');
const nBandas = (rc.html.match(/<g data-tramo="/g) ?? []).length;
const nObras = [...rc.html.matchAll(/data-obras="(\d+)"/g)].reduce((s, m) => s + Number(m[1]), 0);
const sinLugar = Number(/perfil-card[^>]*data-n-sin-lugar="(\d+)"/.exec(rc.html)?.[1] ?? -1);
verifica(nBandas === Number(pant.nTramos), `paridad: tramos en la infografía ${nBandas} = pantalla ${pant.nTramos}`);
verifica(nObras + sinLugar === Number(pant.nEstructuras) + Number(pant.nEdificios), `paridad: obras dibujadas ${nObras} + sin lugar ${sinLugar} = estructuras ${pant.nEstructuras} + edificios ${pant.nEdificios}`);
verifica(/data-n-estructuras="385"/.test(rc.html) && /<svg[^>]*aria-label="Mini-mapa del canal"/.test(rc.html), 'paridad: la infografía declara 385 estructuras y trae el mini-mapa del canal');
verifica(rc.a.distintoPct > 8 && /perfil-card/.test(rc.html) && !/class="cinta"/.test(rc.html), 'concepto: el perfil reemplaza la cinta duplicada');
// Tramo con mini-mapa
await eligeFila(17);
const rt = await descarga(btnTramo(), /^comprobacion-tramo-fila17-/, 'tramo con mini-mapa');
verifica(/Dónde está el tramo/.test(rt.h.texto) && /Mini-mapa del tramo/.test(rt.html) && /data-obra=/.test(rt.html), 'tramo: trae «Dónde está el tramo» con mini-mapa y obras');
verifica(/La ubicación es la declarada por el PacOT; no acredita la posición física\./.test(rt.h.texto), 'tramo: texto fijo de la ubicación declarada');
// Contorno real incrustado: mini-mapas con el trazo, ≤ 10 KB, sin red ni JS; tramo de meandro (K-56→58) y auxiliar rotulado
const kbSvg = (html, re) => { const m = re.exec(html); return m ? Buffer.byteLength(m[0], 'utf8') : -1; };
const nPts = (svg) => ((svg ?? '').match(/[ML]-?\d/g) ?? []).length;
const svgCanal = /<svg[^>]*aria-label="Mini-mapa del canal"[\s\S]*?<\/svg>/.exec(rt.html)?.[0] ?? '';
verifica(svgCanal.length > 0 && Buffer.byteLength(svgCanal, 'utf8') <= 10240 && nPts(svgCanal) >= 100, `mini-mapa del canal: ${nPts(svgCanal)} puntos del trazo incrustados, ${Buffer.byteLength(svgCanal, 'utf8')} B (≤ 10 240)`);
verifica(/Contorno real/.test(rt.h.texto) || /Contorno real/.test(rt.html), 'tramo: la infografía rotula «Contorno real»');
const opciones56 = await page.locator('#cons-comp-tramo option').evaluateAll((o) => o.map((x) => ({ v: x.value, t: x.textContent.trim() })).filter((x) => /^56\+000 → 58\+000/.test(x.t)));
if (opciones56.length > 0) {
  await eligeFila(opciones56[0].v);
  const r56 = await descarga(btnTramo(), /^comprobacion-tramo-fila\d+-/, 'tramo K-56→58 (meandro)');
  const svgT = /<svg[^>]*aria-label="Mini-mapa del tramo[\s\S]*?<\/svg>/.exec(r56.html)?.[0] ?? '';
  verifica(svgT.length > 0 && Buffer.byteLength(svgT, 'utf8') <= 10240 && nPts(svgT) >= 30, `K-56→58: mini-mapa del tramo con ${nPts(svgT)} puntos, ${Buffer.byteLength(svgT, 'utf8')} B (≤ 10 240)`);
  verifica(/Contorno real · \d+ ancla/.test(r56.h.texto) && !/<script|<use|@import/.test(r56.html), 'K-56→58: insignia de contorno real, sin JS ni <use> ni fuentes web');
  verifica(r56.a.violeta > 300, `K-56→58: el tramo violeta se ve en el PNG (${r56.a.violeta} px)`);
  verifica(r56.a.distintoPct > 8, 'K-56→58: PNG no en blanco');
}

// 7. Caminos de la SRL (T-01): infografías de tramo y de concepto con el dibujo de calzada
await page.selectOption('#cons-comp-red', 'caminos'); await page.waitForTimeout(250);
const cCam = await page.locator('#cons-comp-con option').allInnerTexts();
const iRep = cCam.findIndex((c) => /Reposici/.test(c)), iTer = cCam.findIndex((c) => /Terracer/.test(c)), iConf = cCam.findIndex((c) => /Conformaci/.test(c));
verifica(iRep >= 0 && iTer >= 0 && iConf >= 0, `caminos: existen reposición, terracerías y conformación (${cCam.join(', ')})`);
await elige(iRep); await eligeFila(98);
const c98 = await descarga(btnTramo(), /^comprobacion-tramo-fila98-/, 'camino reposición f98 (150 × 6 × 98.951)');
verifica(/<svg[^>]*aria-label="Sección de calzada, Reposición de revestimiento: ancho 6\.00 m/.test(c98.html), 'camino f98: la infografía trae la sección de calzada con el ancho de IO3');
verifica(c98.a.violeta > 150 && c98.a.azul > 150, `camino f98: cota azul del inventario y violeta del PacOT (azul ${c98.a.azul}, violeta ${c98.a.violeta})`);
verifica(/El 150 es una inferencia; el libro no declara el espesor/.test(c98.h.texto) && /espesor 0\.15 m \(inferencia\)/.test(c98.h.texto + c98.html), 'camino f98: rotula el 150 como inferencia');
verifica(/Dimensiones del camino/.test(c98.h.texto) && !/Dónde está el tramo/.test(c98.h.texto) && !/<script|@import/.test(c98.html), 'camino f98: sin ubicación inventada, sin JS ni fuentes web');
verifica(/no trae medidas de bermas ni cunetas/.test(c98.h.texto), 'camino f98: dice que el libro no trae bermas ni cunetas');
await eligeFila(100);
const c100 = await descarga(btnTramo(), /^comprobacion-tramo-fila100-/, 'camino reposición f100 (terracería, 0)');
verifica(/terracería: no lleva revestimiento/.test(c100.h.texto), 'camino f100: «terracería: no lleva revestimiento»');
await elige(iTer); await eligeFila(100);
const t100 = await descarga(btnTramo(), /^comprobacion-tramo-fila100-/, 'camino terracerías f100 (no evaluable)');
verifica(/unidad sospechosa: el valor equivale a 1·L y 2·L expresados en km/.test(t100.h.texto), 'camino terracerías: dice el motivo (unidad sospechosa) y no convierte');
await elige(iConf); await eligeFila(98);
await descarga(btnTramo(), /^comprobacion-tramo-fila98-/, 'camino conformación f98 (1 × L)');
await elige(iRep);
const cc = await descarga(btnConcepto(), /^comprobacion-concepto-.*reposicion.*\.png$/, 'camino concepto reposición');
verifica(/Recorrido del camino/.test(cc.h.texto) && !/Recorrido del canal/.test(cc.h.texto) && /El 150 es una inferencia/.test(cc.h.texto), 'camino concepto: «Recorrido del camino», grupos por superficie e inferencia');
await elige(iTer);
const ct = await descarga(btnConcepto(), /^comprobacion-concepto-.*terracer.*\.png$/, 'camino concepto terracerías');
verifica(/unidad sospechosa/.test(ct.h.texto), 'camino concepto terracerías: motivo visible');


// 8. Obras puntuales (T-02/T-03): obra civil, compuertas, edificios (SRL) y un dren de M5
await page.selectOption('#cons-comp-red', 'obras'); await page.waitForTimeout(400);
const nomOP = await page.locator('#cons-comp-con option').allInnerTexts();
const selOP = async (re) => { await page.selectOption('#cons-comp-con', { index: nomOP.findIndex((n) => re.test(n)) }); await page.waitForTimeout(350); };
const RE_OBRAS = /^comprobacion-obras-.*\.png$/;
await selOP(/obra civil/i);
const oc = await descarga(btnConcepto(), RE_OBRAS, 'obras: obra civil (concepto)');
verifica(oc.a.azul > 150 && oc.a.violeta > 150 && oc.a.verde > 150, `obra civil: inventario azul ${oc.a.azul}, PacOT violeta ${oc.a.violeta}, coherente verde ${oc.a.verde}`);
for (const x of ['385', '19.25', '163,625', 'Toma y entrega', '149', '21 con nombre ambiguo']) verifica(oc.h.texto.includes(x), `obra civil: la infografía dice «${x}»`);
verifica(!/<script|@import|url\(http/.test(oc.html), 'obra civil: sin JS ni fuentes web');
await page.selectOption('#op-grupo', 'fam:proteccion'); await page.waitForTimeout(300);
const og = await descarga(page.getByRole('button', { name: 'Infografía del grupo' }), /^comprobacion-obras-.*-grupo-.*\.png$/, 'obras: grupo Protección');
verifica(/reparto proporcional/.test(og.h.texto) && /\+\d+ más en la app/.test(og.h.texto) && /Protección y conducción/.test(og.h.texto), 'grupo Protección: reparto rotulado, lista acotada y nombre de la familia');
await selOP(/compuertas/i);
const cp = await descarga(btnConcepto(), RE_OBRAS, 'obras: compuertas (concepto)');
verifica(/no reconstruible por estructura/.test(cp.h.texto) && /no se reparten/.test(cp.h.texto) && cp.a.violeta > 150, 'compuertas: «no reconstruible por estructura», sin reparto');
await selOP(/edificios/i);
const ed = await descarga(btnConcepto(), RE_OBRAS, 'obras: edificios (concepto)');
for (const x of ['O1-SRL', 'CM1-SRL', 'C4-SRL', 'CENTRAL DE MAQUINARIA', 'Área del predio']) verifica(ed.h.texto.includes(x), `edificios: la infografía dice «${x}»`);

// 9. Un dren de M5 (si el Módulo 5 está cargado): infografías de tramo y de concepto
const ambs = await page.locator('#cons-comp-amb option').evaluateAll((o) => o.map((x) => ({ v: x.value, t: x.textContent.trim() })));
const m5 = ambs.find((x) => /^M5$/.test(x.v) || /Módulo 5/.test(x.t));
if (m5) {
  await page.selectOption('#cons-comp-amb', m5.v); await page.waitForTimeout(800);
  await page.selectOption('#cons-comp-red', 'drenaje'); await page.waitForTimeout(400);
  const cd = await page.locator('#cons-comp-con option').allInnerTexts();
  await page.selectOption('#cons-comp-con', { index: cd.findIndex((c) => /TERRACER/i.test(c)) }); await page.waitForTimeout(300);
  await eligeFila(208);
  const dt = await descarga(btnTramo(), /^comprobacion-tramo-fila208-/, 'dren M5 terracerías f208 (2000 × 13.6)');
  verifica(/27,200/.test(dt.h.texto) && /Sección trapecial/.test(dt.html) && /Terracerías \(descopete\)/.test(dt.html + dt.h.texto), 'dren f208: 27,200 m³ y dibujo de sección con terracerías');
  const dc = await descarga(btnConcepto(), /^comprobacion-concepto-/, 'dren M5 terracerías (concepto)');
  verifica(/Recorrido del dren/.test(dc.h.texto) && !/Recorrido del canal/.test(dc.h.texto), 'dren concepto: «Recorrido del dren»');
  await page.selectOption('#cons-comp-amb', ambs.find((x) => x.v !== m5.v)?.v ?? 'SRL'); await page.waitForTimeout(400);
} else console.log('AVISO: Módulo 5 no cargado; se omiten las infografías de drenes');

await page.waitForTimeout(300);
verifica((await page.locator('.scada-action-aviso').count()) === 0, 'sin aviso de error en la página');
await browser.close();
const relevantes = errs.filter((e) => !IGNORA.test(e));
verifica(relevantes.length === 0, `sin errores de consola/JS (${relevantes.length})`);
if (relevantes.length) console.log(relevantes.slice(0, 6));
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo OK');
process.exit(fallos.length ? 1 : 0);
