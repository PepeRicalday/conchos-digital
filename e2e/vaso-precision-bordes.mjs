// Precisión del borde del vaso (La Boquilla) POR PERIODO — compara cada polígono guardado en
// vaso_geometria_historico contra una referencia INDEPENDIENTE: la misma fecha de Sentinel-2 L2A pedida
// al WMS de Sentinel Hub a 10 m (NDWI B03/B08, MNDWI B03/B11, nubes SCL), procesada en el navegador (Playwright).
//
//   node e2e/vaso-precision-bordes.mjs                 → todas las escenas vigentes
//   METODO=v1 node e2e/vaso-precision-bordes.mjs        → solo las del método v1 (si la columna existe)
//   OUT=<carpeta> node e2e/vaso-precision-bordes.mjs    → dónde dejar JSON + PNG + HTML (por defecto e2e/out/vaso-bordes/)
//
// Métricas por escena: IoU polígono↔máscara de referencia, área polígono (m² locales) vs área guardada vs curva 2020
// a la cota del día (±2 d, presas_historico_diario), falsos +/− en km², distancia media / p95 del borde (m), vértices, autointersecciones, nubes en el vaso.
// Solo lectura: no escribe en la BD.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const OUT = process.env.OUT || path.join(RAIZ, 'e2e/out/vaso-bordes/');
fs.mkdirSync(OUT, { recursive: true });
const env = fs.readFileSync(RAIZ + '.env', 'utf8');
const leer = (k) => (env.match(new RegExp('^' + k + '="?([^"\\r\\n]+?)"?\\s*$', 'm')) || [])[1]?.trim();
const SB = leer('VITE_SUPABASE_URL'), KEY = leer('VITE_SUPABASE_ANON_KEY');
const INST = leer('VITE_SENTINEL_INSTANCE_ID'), PROV = (leer('VITE_SENTINEL_PROVIDER') || 'classic').toLowerCase();
const WMS = (PROV === 'cdse' ? 'https://sh.dataspace.copernicus.eu/ogc/wms/' : 'https://services.sentinel-hub.com/ogc/wms/') + INST;
const PRESA = 'PRE-001';
const RES_M = 10, MAX_PX = 2400, DIAS_LECTURA = 2;

const rest = async (q) => {
  const r = await fetch(`${SB}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`${q.slice(0, 60)} → ${r.status} ${await r.text()}`);
  return r.json();
};

// ── Datos de la BD ────────────────────────────────────────────────────────────
let filtroMetodo = '';
if (process.env.METODO) filtroMetodo = `&metodo=eq.${process.env.METODO}`;
else {
  try { await rest(`vaso_geometria_historico?select=vigente&limit=1`); filtroMetodo = '&vigente=is.true'; } catch { /* sin versionado aún */ }
}
// ESCENAS_DIR=<carpeta>: mide respuestas locales de la función con {dry_run:true, con_geojson:true} (archivos *.json) sin tocar la BD.
const escenas = process.env.ESCENAS_DIR
  ? fs.readdirSync(process.env.ESCENAS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('resultados'))
      .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(process.env.ESCENAS_DIR, f), 'utf8')); } catch { return null; } })
      .filter((r) => r?.contorno_geojson && r.fecha_escena)
      .map((r) => ({ ...r, id: null }))
      .sort((a, b) => a.fecha_escena.localeCompare(b.fecha_escena))
  : await rest(`vaso_geometria_historico?select=*&presa_id=eq.${PRESA}&es_referencia_historica=is.false${filtroMetodo}&order=fecha_escena.asc`);
const curva = [];
for (let off = 0; ; off += 1000) {
  const pag = await rest(`curvas_capacidad?select=elevacion_msnm,area_ha&presa_id=eq.${PRESA}&area_ha=not.is.null&order=elevacion_msnm.asc&offset=${off}&limit=1000`);
  curva.push(...pag); if (pag.length < 1000) break;
}
const desde = new Date(new Date(escenas[0].fecha_escena).getTime() - 30 * 864e5).toISOString().slice(0, 10);
// Nivel del DÍA de la escena: presas_historico_diario (calidad OK) y, de respaldo, lecturas_presas.
const hist = await rest(`presas_historico_diario?select=fecha,escala_msnm&presa_id=eq.${PRESA}&calidad=eq.OK&escala_msnm=not.is.null&fecha=gte.${desde}&order=fecha.asc&limit=5000`).catch(() => []);
const capt = await rest(`lecturas_presas?select=fecha,escala_msnm&presa_id=eq.${PRESA}&escala_msnm=not.is.null&fecha=gte.${desde}&order=fecha.asc&limit=5000`);
const fechasHist = new Set(hist.map((l) => l.fecha));
const lecturas = [...hist.map((l) => ({ ...l, fuente: 'historico' })), ...capt.filter((l) => !fechasHist.has(l.fecha)).map((l) => ({ ...l, fuente: 'captura' }))];
console.log(`escenas ${escenas.length} · curva ${curva.length} pts · lecturas ${lecturas.length} · WMS ${PROV}`);

const areaCurvaKm2 = (h) => {
  if (!curva.length || h == null) return null;
  if (h <= curva[0].elevacion_msnm) return curva[0].area_ha / 100;
  for (let i = 1; i < curva.length; i++) {
    const a = curva[i - 1], b = curva[i];
    if (h <= b.elevacion_msnm) return (a.area_ha + (b.area_ha - a.area_ha) * (h - a.elevacion_msnm) / (b.elevacion_msnm - a.elevacion_msnm)) / 100;
  }
  return curva.at(-1).area_ha / 100;
};
const lecturaCercana = (fecha) => {
  const t = new Date(fecha).getTime();
  let mejor = null;
  for (const l of lecturas) {
    const d = Math.abs(new Date(l.fecha + 'T12:00:00').getTime() - t) / 864e5;
    if (d <= DIAS_LECTURA && (!mejor || d < mejor.dias)) mejor = { ...l, dias: +d.toFixed(1) };
  }
  return mejor;
};

// ── Geometría del polígono (sin red) ─────────────────────────────────────────
const M_LAT = 110850; // m por grado de latitud a ~27.5°
const mLon = (lat) => 111320 * Math.cos(lat * Math.PI / 180);
const areaAnilloM2 = (r) => { // equirectangular local por vértice (error < 0.1 % a esta escala)
  const lat0 = r.reduce((s, p) => s + p[1], 0) / r.length;
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length];
    s += (x1 * mLon(lat0)) * (y2 * M_LAT) - (x2 * mLon(lat0)) * (y1 * M_LAT);
  }
  return Math.abs(s) / 2;
};
const perimetroM = (r) => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + Math.hypot((q[0] - p[0]) * mLon(p[1]), (q[1] - p[1]) * M_LAT); }, 0);
const cruza = (a, b, c, d) => {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};
const autointersecciones = (anillos) => {
  const segs = anillos.flatMap((r) => r.map((p, i) => [p, r[(i + 1) % r.length]]));
  let n = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 2; j < segs.length; j++) if (cruza(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) n++;
  return n;
};

// ── Encuadre común (unión de polígonos + 1.5 km) ─────────────────────────────
const todos = escenas.flatMap((e) => e.contorno_geojson.coordinates[0]);
let [minLon, minLat, maxLon, maxLat] = [Math.min(...todos.map((p) => p[0])), Math.min(...todos.map((p) => p[1])), Math.max(...todos.map((p) => p[0])), Math.max(...todos.map((p) => p[1]))];
const latC = (minLat + maxLat) / 2, mg = 1500;
minLon -= mg / mLon(latC); maxLon += mg / mLon(latC); minLat -= mg / M_LAT; maxLat += mg / M_LAT;
const W = Math.round((maxLon - minLon) * mLon(latC) / RES_M), H = Math.round((maxLat - minLat) * M_LAT / RES_M);
const nx = Math.ceil(W / MAX_PX), ny = Math.ceil(H / MAX_PX);
console.log(`encuadre ${W}×${H} px a ${RES_M} m (${nx}×${ny} teselas)`);

const EVAL = `//VERSION=3
function setup(){return{input:[{bands:["B03","B08","B11","SCL","dataMask"]}],output:{bands:4,sampleType:"UINT8"}}}
function evaluatePixel(s){var n=(s.B03-s.B08)/(s.B03+s.B08+1e-4),m=(s.B03-s.B11)/(s.B03+s.B11+1e-4);
var c=(s.SCL==3||s.SCL==8||s.SCL==9||s.SCL==10)?255:0;
return [Math.round((Math.max(-1,Math.min(1,n))+1)*127.5),Math.round((Math.max(-1,Math.min(1,m))+1)*127.5),c,s.dataMask*255];}`;
const EVAL_RGB = `//VERSION=3
function setup(){return{input:["B02","B03","B04","dataMask"],output:{bands:4}}}
function evaluatePixel(s){return [2.8*s.B04,2.8*s.B03,2.8*s.B02,s.dataMask];}`;
const b64 = (s) => Buffer.from(s).toString('base64');

async function teselas(fecha, evalscript, escala = 1) {
  const out = [];
  const Wt = Math.round(W / escala), Ht = Math.round(H / escala);
  const tx = Math.ceil(Wt / MAX_PX), ty = Math.ceil(Ht / MAX_PX);
  for (let j = 0; j < ty; j++) for (let i = 0; i < tx; i++) {
    const x0 = Math.floor(i * Wt / tx), x1 = Math.floor((i + 1) * Wt / tx), y0 = Math.floor(j * Ht / ty), y1 = Math.floor((j + 1) * Ht / ty);
    const bb = [minLon + (x0 / Wt) * (maxLon - minLon), maxLat - (y1 / Ht) * (maxLat - minLat), minLon + (x1 / Wt) * (maxLon - minLon), maxLat - (y0 / Ht) * (maxLat - minLat)];
    const q = new URLSearchParams({ SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.1.1', LAYERS: '1_TRUE_COLOR', SRS: 'EPSG:4326', BBOX: bb.join(','), WIDTH: String(x1 - x0), HEIGHT: String(y1 - y0), FORMAT: 'image/png', TIME: `${fecha}/${fecha}`, MAXCC: '100', SHOWLOGO: 'false', TRANSPARENT: 'true', EVALSCRIPT: b64(evalscript) });
    const r = await fetch(`${WMS}?${q}`);
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !ct.includes('image')) throw new Error(`WMS ${r.status} ${ct}: ${(await r.text()).slice(0, 200)}`);
    out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, png: Buffer.from(await r.arrayBuffer()).toString('base64') });
  }
  return { teselas: out, W: Wt, H: Ht };
}

// ── Análisis en el navegador (canvas) ────────────────────────────────────────
const b = await chromium.launch();
const page = await (await b.newContext({ serviceWorkers: 'block' })).newPage();
await page.setContent('<html><body style="margin:0;background:#000"></body></html>');

const resultados = [];
for (const e of escenas) {
  const fecha = (e.fecha_pixeles || e.fecha_escena).slice(0, 10);
  const anillos = e.contorno_geojson.coordinates;
  const ext = anillos[0];
  const areaPolM2 = areaAnilloM2(ext) - anillos.slice(1).reduce((s, r) => s + areaAnilloM2(r), 0);
  const lec = lecturaCercana(e.fecha_escena);
  const fila = {
    id: e.id, fecha, metodo: e.metodo ?? 'v1', resolucion_m: e.resolucion_m,
    area_guardada_km2: +e.area_km2, area_poligono_km2: +(areaPolM2 / 1e6).toFixed(3),
    vertices: anillos.reduce((s, r) => s + r.length, 0), anillos: anillos.length,
    perimetro_guardado_km: +e.perimetro_km,
    perimetro_poligono_km: +(anillos.reduce((s, r) => s + perimetroM(r), 0) / 1000).toFixed(2),
    autointersecciones: autointersecciones(anillos),
    lectura: lec ? `${lec.fecha} · ${lec.escala_msnm} msnm (${lec.dias} d, ${lec.fuente})` : null,
    area_curva_km2: lec ? +areaCurvaKm2(+lec.escala_msnm).toFixed(3) : null,
  };
  try {
    const t = await teselas(fecha, EVAL);
    const anillosPx = anillos.map((r) => r.map(([lon, lat]) => [(lon - minLon) / (maxLon - minLon) * W, (maxLat - lat) / (maxLat - minLat) * H]));
    const rgb = await teselas(fecha, EVAL_RGB, 4).catch(() => null);
    const m = await page.evaluate(analizar, { t, anillosPx, W, H, RES_M, latMin: minLat, latMax: maxLat, rgb });
    Object.assign(fila, m.metricas);
    fs.writeFileSync(path.join(OUT, `${fecha}_${fila.metodo}.png`), Buffer.from(m.png.split(',')[1], 'base64'));
  } catch (err) {
    fila.error = String(err.message || err).slice(0, 240);
  }
  if (fila.area_curva_km2) {
    fila.pct_guardada_vs_curva = +(100 * fila.area_guardada_km2 / fila.area_curva_km2).toFixed(1);
    if (fila.ref_otsu_km2) fila.pct_ref_vs_curva = +(100 * fila.ref_otsu_km2 / fila.area_curva_km2).toFixed(1);
  }
  console.log(JSON.stringify(fila));
  resultados.push(fila);
}
await b.close();

// Se ejecuta DENTRO del navegador.
async function analizar({ t, anillosPx, W, H, RES_M, latMin, latMax, rgb }) {
  const cv = new OffscreenCanvas(W, H), cx = cv.getContext('2d', { willReadFrequently: true });
  for (const s of t.teselas) {
    const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + s.png)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    cx.drawImage(bm, s.x, s.y);
  }
  const d = cx.getImageData(0, 0, W, H).data;
  const N = W * H, ndwi = new Float32Array(N), mndwi = new Float32Array(N), valido = new Uint8Array(N), nube = new Uint8Array(N);
  for (let p = 0; p < N; p++) { ndwi[p] = d[p * 4] / 127.5 - 1; mndwi[p] = d[p * 4 + 1] / 127.5 - 1; nube[p] = d[p * 4 + 2] > 127 ? 1 : 0; valido[p] = d[p * 4 + 3] > 127 && !nube[p] ? 1 : 0; }
  // Polígono rasterizado (evenodd: islas = huecos)
  const pc = new OffscreenCanvas(W, H), px = pc.getContext('2d', { willReadFrequently: true });
  const traza = (c) => { c.beginPath(); for (const r of anillosPx) { r.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); } };
  px.fillStyle = '#fff'; traza(px); px.fill('evenodd');
  const pd = px.getImageData(0, 0, W, H).data, P = new Uint8Array(N);
  for (let p = 0; p < N; p++) P[p] = pd[p * 4] > 127 ? 1 : 0;
  // Región de análisis: polígono dilatado 1.5 km (todo el encuadre ya es unión+1.5 km) → usamos todo el encuadre válido
  // Umbral Otsu sobre NDWI en píxeles válidos
  const otsu = (arr) => {
    const h = new Float64Array(256); let n = 0;
    for (let p = 0; p < N; p++) if (valido[p]) { h[Math.max(0, Math.min(255, Math.round((arr[p] + 1) * 127.5)))]++; n++; }
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * h[i];
    let sB = 0, wB = 0, best = 0, th = 127;
    for (let i = 0; i < 256; i++) { wB += h[i]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += i * h[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; th = i; } }
    return th / 127.5 - 1;
  };
  const tN = Math.max(-0.1, Math.min(0.35, otsu(ndwi))), tM = Math.max(-0.1, Math.min(0.35, otsu(mndwi)));
  // Máscara de referencia: componentes 8-conexas que tocan el polígono
  const refDe = (arr, th) => {
    const A = new Uint8Array(N); for (let p = 0; p < N; p++) A[p] = valido[p] && arr[p] > th ? 1 : 0;
    const R = new Uint8Array(N), pila = new Int32Array(N);
    for (let p0 = 0; p0 < N; p0++) {
      if (!A[p0] || !P[p0] || R[p0]) continue;
      let k = 0; pila[k++] = p0; R[p0] = 1;
      while (k) { const p = pila[--k], x = p % W, y = (p / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const q = yy * W + xx; if (A[q] && !R[q]) { R[q] = 1; pila[k++] = q; } } }
    }
    return R;
  };
  const RN = refDe(ndwi, tN), RM = refDe(mndwi, tM);
  const pxArea = (y) => { const lat = latMax - (y + 0.5) / H * (latMax - latMin); return RES_M * RES_M * Math.cos(lat * Math.PI / 180) / Math.cos(((latMax + latMin) / 2) * Math.PI / 180); };
  const borde = (M) => { const B = new Uint8Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x; if (!M[p]) continue; if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || !M[p - 1] || !M[p + 1] || !M[p - W] || !M[p + W]) B[p] = 1; } return B; };
  const distancia = (B) => { // chamfer 3-4 → metros
    const D = new Float32Array(N).fill(1e9); for (let p = 0; p < N; p++) if (B[p]) D[p] = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x; let v = D[p]; if (x > 0) v = Math.min(v, D[p - 1] + 3); if (y > 0) { v = Math.min(v, D[p - W] + 3); if (x > 0) v = Math.min(v, D[p - W - 1] + 4); if (x < W - 1) v = Math.min(v, D[p - W + 1] + 4); } D[p] = v; }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const p = y * W + x; let v = D[p]; if (x < W - 1) v = Math.min(v, D[p + 1] + 3); if (y < H - 1) { v = Math.min(v, D[p + W] + 3); if (x < W - 1) v = Math.min(v, D[p + W + 1] + 4); if (x > 0) v = Math.min(v, D[p + W - 1] + 4); } D[p] = v; }
    for (let p = 0; p < N; p++) D[p] = D[p] / 3 * RES_M; return D;
  };
  const comparar = (R) => {
    let inter = 0, uni = 0, fp = 0, fn = 0, aP = 0, aR = 0;
    for (let y = 0; y < H; y++) { const a = pxArea(y); for (let x = 0; x < W; x++) { const p = y * W + x; const pi = P[p], ri = R[p];
      if (pi) aP += a; if (ri) aR += a; if (pi && ri) inter += a; if (pi || ri) uni += a; if (pi && !ri && valido[p]) fp += a; if (ri && !pi) fn += a; } }
    const BP = borde(P), BR = borde(R), DR = distancia(BR), DP = distancia(BP);
    const ds = []; for (let p = 0; p < N; p++) if (BP[p]) ds.push(DR[p]); for (let p = 0; p < N; p++) if (BR[p]) ds.push(DP[p]);
    ds.sort((a, b) => a - b);
    return { iou: +(inter / uni).toFixed(4), area_km2: +(aR / 1e6).toFixed(3), area_pol_raster_km2: +(aP / 1e6).toFixed(3), falsos_pos_km2: +(fp / 1e6).toFixed(3), falsos_neg_km2: +(fn / 1e6).toFixed(3),
      dist_media_m: +(ds.reduce((s, v) => s + v, 0) / ds.length).toFixed(1), dist_p95_m: +ds[Math.floor(ds.length * 0.95)].toFixed(1), BR };
  };
  const cN = comparar(RN), cM = comparar(RM);
  let nubVaso = 0, totVaso = 0; for (let p = 0; p < N; p++) if (P[p] || RN[p]) { totVaso++; if (nube[p] || !(d[p * 4 + 3] > 127)) nubVaso++; }
  // Imagen de control: color real (o NDWI gris) + borde referencia (cian) + polígono guardado (rojo)
  const esc = Math.min(1, 1800 / W), oc = new OffscreenCanvas(Math.round(W * esc), Math.round(H * esc)), o = oc.getContext('2d');
  if (rgb) { for (const s of rgb.teselas) { const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + s.png)).blob()); o.drawImage(bm, s.x * (W / rgb.W) * esc, s.y * (H / rgb.H) * esc, s.w * (W / rgb.W) * esc, s.h * (H / rgb.H) * esc); } }
  else { const g = cx.getImageData(0, 0, W, H); for (let p = 0; p < N; p++) { const v = d[p * 4]; g.data[p * 4] = g.data[p * 4 + 1] = g.data[p * 4 + 2] = v; g.data[p * 4 + 3] = 255; } cx.putImageData(g, 0, 0); o.drawImage(cv, 0, 0, oc.width, oc.height); }
  const bi = o.getImageData(0, 0, oc.width, oc.height);
  for (let p = 0; p < N; p++) if (cN.BR[p]) { const x = Math.round((p % W) * esc), y = Math.round(((p / W) | 0) * esc), q = (y * oc.width + x) * 4; bi.data[q] = 0; bi.data[q + 1] = 230; bi.data[q + 2] = 255; }
  o.putImageData(bi, 0, 0);
  o.strokeStyle = '#ff2d2d'; o.lineWidth = 1.2; o.beginPath(); for (const r of anillosPx) { r.forEach(([x, y], i) => (i ? o.lineTo(x * esc, y * esc) : o.moveTo(x * esc, y * esc))); o.closePath(); } o.stroke();
  const blob = await oc.convertToBlob({ type: 'image/png' });
  const png = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
  delete cN.BR; delete cM.BR;
  return { png, metricas: {
    umbral_otsu_ndwi: +tN.toFixed(3), umbral_otsu_mndwi: +tM.toFixed(3), nubes_vaso_pct: +(100 * nubVaso / Math.max(1, totVaso)).toFixed(1),
    ref_otsu_km2: cN.area_km2, iou_ndwi_otsu: cN.iou, fp_km2: cN.falsos_pos_km2, fn_km2: cN.falsos_neg_km2, dist_media_m: cN.dist_media_m, dist_p95_m: cN.dist_p95_m,
    area_pol_raster_km2: cN.area_pol_raster_km2,
    ref_mndwi_km2: cM.area_km2, iou_mndwi_otsu: cM.iou, dist_media_mndwi_m: cM.dist_media_m,
  } };
}

// ── Informe ──────────────────────────────────────────────────────────────────
const etiqueta = process.env.ETIQUETA || new Date().toISOString().slice(0, 16).replace(':', '');
fs.writeFileSync(path.join(OUT, `resultados_${etiqueta}.json`), JSON.stringify({ encuadre: { minLon, minLat, maxLon, maxLat, W, H, RES_M }, resultados }, null, 1));
const cols = ['fecha', 'metodo', 'resolucion_m', 'area_guardada_km2', 'area_poligono_km2', 'ref_otsu_km2', 'ref_mndwi_km2', 'area_curva_km2', 'pct_guardada_vs_curva', 'pct_ref_vs_curva', 'iou_ndwi_otsu', 'iou_mndwi_otsu', 'dist_media_m', 'dist_p95_m', 'fp_km2', 'fn_km2', 'vertices', 'autointersecciones', 'nubes_vaso_pct', 'lectura', 'error'];
const html = `<!doctype html><meta charset="utf-8"><title>Precisión de bordes del vaso</title>
<style>body{font:13px system-ui;background:#0b1220;color:#e5e7eb;margin:16px}table{border-collapse:collapse}td,th{border:1px solid #334155;padding:3px 6px;text-align:right}th{background:#1e293b}img{max-width:100%;border:1px solid #334155;margin:8px 0}</style>
<h1>Precisión de bordes — La Boquilla (${etiqueta})</h1><p>Rojo = polígono guardado · Cian = borde de referencia NDWI 10 m (Otsu, misma fecha). Encuadre ${W}×${H} px a ${RES_M} m.</p>
<table><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>${resultados.map((r) => `<tr>${cols.map((c) => `<td>${r[c] ?? ''}</td>`).join('')}</tr>`).join('')}</table>
${resultados.filter((r) => !r.error).map((r) => `<h3>${r.fecha} (${r.metodo})</h3><img src="${r.fecha}_${r.metodo}.png">`).join('')}`;
fs.writeFileSync(path.join(OUT, `informe_${etiqueta}.html`), html);
console.log('informe →', path.join(OUT, `informe_${etiqueta}.html`));
