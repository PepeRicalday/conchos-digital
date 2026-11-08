#!/usr/bin/env node
/**
 * Genera public/geo/cuenca_conchos.geojson (contorno) y public/geo/cuenca_conchos_subcuencas.geojson (28 subcuencas)
 * a partir de la capa oficial de subcuencas hidrográficas de México (INEGI-CONAGUA, difundida por CONABIO: redsub84gw.zip).
 *
 *   node scripts/cuenca_a_geojson.mjs <ruta/redsub84gw.zip> [tolerancia_m=300]
 *
 * Cuenca del Conchos = cuencas J, K, L, M y N de la región hidrológica RH24 Bravo-Conchos:
 *   J Conchos-Ojinaga · K Conchos-P. El Granero · L Conchos-P. de la Boquilla · M Río Florido · N Río San Pedro.
 * El .prj de la capa es WGS84 geográfico (EPSG:4326): no hace falta reproyectar. El script aborta si las coordenadas salen de rango.
 * Licencia de la capa: CONABIO, CC BY-NC 2.5 MX (uso no comercial; citar INEGI/CONAGUA/CONABIO).
 */
globalThis.self = globalThis; // shpjs asume entorno de navegador
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shp = (await import(pathToFileURL(path.join(raiz, 'node_modules', 'shpjs', 'lib', 'index.js')).href)).default;

const [, , zipRuta, tolArg] = process.argv;
if (!zipRuta) { console.error('Uso: node scripts/cuenca_a_geojson.mjs <redsub84gw.zip> [tolerancia_m]'); process.exit(1); }
const TOL_M = Number(tolArg ?? 300);
const CUENCAS = new Set(['J', 'K', 'L', 'M', 'N']);
const AREA_OFICIAL_KM2 = 68387; // INEGI 2013, RH24 cuenca del Conchos

const buf = fs.readFileSync(zipRuta);
const fc0 = await shp(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const fc = Array.isArray(fc0) ? fc0[0] : fc0;
const sub = fc.features.filter((f) => f.properties.CVE_RH === 'RH24' && CUENCAS.has(f.properties.CVE_CUE));
if (sub.length !== 28) { console.error(`Se esperaban 28 subcuencas y hay ${sub.length}: la capa cambió, revisar.`); process.exit(1); }
// Guarda de datum: shpjs no reproyecta. Si las coordenadas no son grados WGS84 de Chihuahua/Durango, se aborta.
for (const f of sub) for (const [x, y] of (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).flat(2)) {
    if (x < -109 || x > -103 || y < 25 || y > 31) { console.error(`Coordenada fuera de rango (${x}, ${y}): el .prj no es WGS84 geográfico, reproyectar antes.`); process.exit(1); }
}

// ---- utilidades geométricas (grados → metros con aproximación local; suficiente para 28°N)
const M_LAT = 111_195, rad = Math.PI / 180;
const anillos = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flat();
const areaAnilloKm2 = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * Math.cos(28 * rad) * M_LAT) * (r[i][1] * M_LAT) - (r[i][0] * Math.cos(28 * rad) * M_LAT) * (r[j][1] * M_LAT); return a / 2 / 1e6; };
const dentro = (r, [x, y]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
function dp(pts, tolM) {
    if (pts.length < 3) return pts;
    const d2 = (p, a, b) => { const kx = Math.cos(a[1] * rad) * M_LAT, ky = M_LAT; const x = (p[0] - a[0]) * kx, y = (p[1] - a[1]) * ky, bx = (b[0] - a[0]) * kx, by = (b[1] - a[1]) * ky; const L = bx * bx + by * by; const t = L ? Math.max(0, Math.min(1, (x * bx + y * by) / L)) : 0; const dx = x - t * bx, dy = y - t * by; return dx * dx + dy * dy; };
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const pila = [[0, pts.length - 1]];
    while (pila.length) { const [i, j] = pila.pop(); let mx = 0, k = -1; for (let n = i + 1; n < j; n++) { const d = d2(pts[n], pts[i], pts[j]); if (d > mx) { mx = d; k = n; } } if (k > 0 && mx > tolM * tolM) { keep[k] = 1; pila.push([i, k], [k, j]); } }
    return pts.filter((_, n) => keep[n]);
}
const simplificaAnillo = (r) => { const a = r.slice(0, -1); const s = dp([...a, a[0]], TOL_M); s.pop(); return s.length >= 3 ? [...s, s[0]] : r; };

// ---- disolver: se eliminan las aristas compartidas entre subcuencas vecinas (se cancelan en sentido opuesto)
const K = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
const aristas = new Map(); // "a>b" → [p, q]
let nVert = 0;
for (const f of sub) for (const r of anillos(f.geometry)) for (let i = 0; i < r.length - 1; i++) {
    nVert++;
    const a = K(r[i]), b = K(r[i + 1]);
    if (a === b) continue;
    if (aristas.has(`${b}>${a}`)) aristas.delete(`${b}>${a}`); else aristas.set(`${a}>${b}`, [r[i], r[i + 1]]);
}
const sal = new Map(); // vértice → aristas salientes
for (const [k, [p, q]] of aristas) { const a = K(p); (sal.get(a) ?? sal.set(a, []).get(a)).push({ k, p, q }); }
const usadas = new Set(), anillosExt = [];
for (const [, lista] of sal) for (const e0 of lista) {
    if (usadas.has(e0.k)) continue;
    const ring = [e0.p]; let e = e0;
    while (e && !usadas.has(e.k)) { usadas.add(e.k); ring.push(e.q); e = (sal.get(K(e.q)) ?? []).find((x) => !usadas.has(x.k)); }
    if (ring.length > 3 && K(ring[0]) === K(ring[ring.length - 1])) anillosExt.push(ring);
}
anillosExt.sort((a, b) => Math.abs(areaAnilloKm2(b)) - Math.abs(areaAnilloKm2(a)));
const exteriores = [], huecos = [];
for (const r of anillosExt) (exteriores.length && exteriores.some((o) => dentro(o, r[0])) ? huecos : exteriores).push(r);
const poligonos = exteriores.map((o) => [o, ...huecos.filter((h) => dentro(o, h[0]))]);

const areaTotal = (polis) => polis.reduce((s, p) => s + Math.abs(areaAnilloKm2(p[0])) - p.slice(1).reduce((t, h) => t + Math.abs(areaAnilloKm2(h)), 0), 0);
const areaSub = sub.reduce((s, f) => s + f.properties.AREA_KM2, 0);
const areaContorno = areaTotal(poligonos);

// ---- simplificar y escribir
const contorno = poligonos.map((p) => p.map(simplificaAnillo));
const sumaNeta = areaTotal(contorno);
const meta = { fuente: 'INEGI-CONAGUA (subcuencas hidrográficas, RH24), difundida por CONABIO', licencia: 'CC BY-NC 2.5 MX', cuencas: 'RH24 J,K,L,M,N', tolerancia_m: TOL_M, area_km2: Math.round(sumaNeta), area_subcuencas_oficial_km2: Math.round(areaSub), area_referencia_km2: AREA_OFICIAL_KM2, generado: new Date().toISOString().slice(0, 10) };
const r5 = (r) => r.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
const salida = {
    type: 'FeatureCollection', properties: meta,
    features: [{ type: 'Feature', properties: { nombre: 'Cuenca del río Conchos', ...meta }, geometry: { type: 'MultiPolygon', coordinates: contorno.map((p) => p.map(r5)) } }],
};
const subFc = {
    type: 'FeatureCollection', properties: meta,
    features: sub.map((f) => ({ type: 'Feature', properties: { clave: f.properties.CVE_SUBCUE, cuenca: f.properties.CUENCA, subcuenca: f.properties.SUBCUENCA, area_km2: f.properties.AREA_KM2 }, geometry: { type: 'MultiPolygon', coordinates: (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((p) => p.map((r) => r5(simplificaAnillo(r)))) } })),
};
fs.mkdirSync(path.join(raiz, 'public', 'geo'), { recursive: true });
fs.writeFileSync(path.join(raiz, 'public', 'geo', 'cuenca_conchos.geojson'), JSON.stringify(salida));
fs.writeFileSync(path.join(raiz, 'public', 'geo', 'cuenca_conchos_subcuencas.geojson'), JSON.stringify(subFc));

const kb = (f) => (fs.statSync(path.join(raiz, 'public', 'geo', f)).size / 1024).toFixed(0);
console.log(`Subcuencas: ${sub.length} · vértices originales: ${nVert}`);
console.log(`Contorno: ${exteriores.length} exterior(es), ${huecos.length} hueco(s) · área disuelta ${areaContorno.toFixed(0)} km² (suma oficial de subcuencas ${areaSub.toFixed(0)}) · simplificada ${sumaNeta.toFixed(0)} km²`);
console.log(`Referencia INEGI RH24 Conchos: ${AREA_OFICIAL_KM2} km² → diferencia ${(((sumaNeta - AREA_OFICIAL_KM2) / AREA_OFICIAL_KM2) * 100).toFixed(1)} %`);
console.log(`Archivos: cuenca_conchos.geojson ${kb('cuenca_conchos.geojson')} KB · cuenca_conchos_subcuencas.geojson ${kb('cuenca_conchos_subcuencas.geojson')} KB`);
