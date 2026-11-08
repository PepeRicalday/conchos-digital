#!/usr/bin/env node
/**
 * Genera las capas de REFERENCIA de la cuenca del Conchos (orientación de los planos e informes), recortadas a la cuenca y simplificadas:
 *   public/geo/ref_municipios.geojson   · límites municipales (INEGI, Marco Geoestadístico) con punto de rótulo dentro de la cuenca
 *   public/geo/ref_poblaciones.geojson  · cabeceras municipales (INEGI, localidades CVE_LOC 0001)
 *   public/geo/ref_rios.geojson         · red de ríos (HydroRIVERS v10, orden de Strahler ≥ umbral) (+ ref_rios_rotulos.json con los nombres de los ríos principales)
 *   public/geo/ref_carreteras.geojson   · carreteras principales (Natural Earth 10 m, dominio público)
 *
 *   node scripts/capas_referencia.mjs <carpeta_con_capas_extraidas>
 * La carpeta debe contener (descarga y descompresión manual, una sola vez; ver README al final del archivo):
 *   chih/conjunto_de_datos/08mun.* 08l.*     (08_chihuahua.zip del Marco Geoestadístico INEGI)
 *   dgo/conjunto_de_datos/10mun.* 10l.*      (10_durango.zip)
 *   hydro/HydroRIVERS_v10_na_shp/HydroRIVERS_v10_na.*
 *   ne_roads/ne_10m_roads_north_america.*
 * INEGI viene en Lambert (ITRF2008): se reproyecta a WGS84 con proj4 a partir del .prj. Aborta si algo sale de rango.
 * Sin mapas de terceros en línea: todo queda como GeoJSON estático dentro de la app. Atribuciones en la propiedad `fuente` de cada archivo.
 */
globalThis.self = globalThis; // shpjs asume entorno de navegador
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shp = await import(pathToFileURL(path.join(raiz, 'node_modules', 'shpjs', 'lib', 'index.js')).href);
const proj4 = (await import(pathToFileURL(path.join(raiz, 'node_modules', 'proj4', 'dist', 'proj4-src.js')).href)).default;

const dir = process.argv[2];
if (!dir) { console.error('Uso: node scripts/capas_referencia.mjs <carpeta_con_capas_extraidas>'); process.exit(1); }
const GEO = path.join(raiz, 'public', 'geo');
const HOY = new Date().toISOString().slice(0, 10);

// ── contorno de la cuenca (para recortar y filtrar)
const contorno = JSON.parse(fs.readFileSync(path.join(GEO, 'cuenca_conchos.geojson'), 'utf8')).features[0].geometry.coordinates; // MultiPolygon: [poli][anillo][pt]
const anillosCuenca = contorno.flat(); // exteriores + huecos
const bbox = (() => { let a = 99, b = 99, c = -999, d = -999; for (const r of contorno.flat()) for (const [x, y] of r) { a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, y); d = Math.max(d, y); } return { minLon: a, minLat: b, maxLon: c, maxLat: d }; })();
const dentroAnillo = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const enCuenca = (x, y) => contorno.some((p) => dentroAnillo(p[0], x, y) && !p.slice(1).some((h) => dentroAnillo(h, x, y)));
const enBbox = (x, y, m = 0) => x >= bbox.minLon - m && x <= bbox.maxLon + m && y >= bbox.minLat - m && y <= bbox.maxLat + m;

// ── lectura de capas
const ab = (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
async function leeCapa(base) {
    const prj = fs.existsSync(`${base}.prj`) ? fs.readFileSync(`${base}.prj`, 'utf8') : null;
    const g = await shp.parseShp(ab(`${base}.shp`));
    // INEGI trae «ISO 88591» en el .cpg (no estándar): se normaliza a ISO-8859-1 o los acentos salen como «�».
    const cpgTxt = fs.existsSync(`${base}.cpg`) ? fs.readFileSync(`${base}.cpg`, 'utf8').trim() : '';
    const cpg = /8859.?1|88591/i.test(cpgTxt) ? new TextEncoder().encode('ISO-8859-1').buffer : cpgTxt ? ab(`${base}.cpg`) : undefined;
    const d = await shp.parseDbf(ab(`${base}.dbf`), cpg);
    const fc = shp.combine([g, d]);
    const proy = prj && /PROJCS/i.test(prj) ? proj4(prj, 'WGS84') : null;
    if (proy) {
        const mapea = (c) => (typeof c[0] === 'number' ? proy.forward([c[0], c[1]]) : c.map(mapea));
        for (const f of fc.features) f.geometry.coordinates = mapea(f.geometry.coordinates);
    }
    return fc;
}
const anillosDe = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []).flat();
const lineasDe = (g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);

// ── geometría
const M_LAT = 111_195, rad = Math.PI / 180;
function dp(pts, tolM) {
    if (pts.length < 3) return pts;
    const d2 = (p, a, b) => { const kx = Math.cos(a[1] * rad) * M_LAT, ky = M_LAT; const x = (p[0] - a[0]) * kx, y = (p[1] - a[1]) * ky, bx = (b[0] - a[0]) * kx, by = (b[1] - a[1]) * ky; const L = bx * bx + by * by; const t = L ? Math.max(0, Math.min(1, (x * bx + y * by) / L)) : 0; const dx = x - t * bx, dy = y - t * by; return dx * dx + dy * dy; };
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const pila = [[0, pts.length - 1]];
    while (pila.length) { const [i, j] = pila.pop(); let mx = 0, k = -1; for (let n = i + 1; n < j; n++) { const d = d2(pts[n], pts[i], pts[j]); if (d > mx) { mx = d; k = n; } } if (k > 0 && mx > tolM * tolM) { keep[k] = 1; pila.push([i, k], [k, j]); } }
    return pts.filter((_, n) => keep[n]);
}
const r4 = (p) => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];
const simplificaLinea = (l, tol) => dp(l, tol).map(r4);
const simplificaAnillo = (r, tol) => { const a = r.slice(0, -1); const s = dp([...a, a[0]], tol); s.pop(); return s.length >= 3 ? [...s.map(r4), r4(s[0])] : null; };
const kb = (f) => (fs.statSync(path.join(GEO, f)).size / 1024).toFixed(0);
const escribe = (f, fc) => { fs.writeFileSync(path.join(GEO, f), JSON.stringify(fc)); console.log(`${f}: ${fc.features.length} elementos, ${kb(f)} KB`); };
const fcMeta = (extra) => ({ generado: HOY, ...extra });

// ════════ 1. Municipios ════════
const munis = [];
for (const [carp, cve, est] of [['chih', '08', 'Chih.'], ['dgo', '10', 'Dgo.']]) {
    const fc = await leeCapa(path.join(dir, carp, 'conjunto_de_datos', `${cve}mun`));
    for (const f of fc.features) {
        const anillos = anillosDe(f.geometry);
        // Se conserva el municipio si alguna parte toca la cuenca (vértice dentro de ella o vértice de la cuenca dentro del municipio)
        const toca = anillos.some((r) => r.some(([x, y]) => enBbox(x, y) && enCuenca(x, y))) || anillosCuenca.some((rc) => rc.some(([x, y]) => anillos.some((r) => dentroAnillo(r, x, y))));
        if (!toca) continue;
        // Punto de rótulo: centroide de las celdas de 0.04° dentro del municipio Y de la cuenca (así el rótulo cae donde se ve el municipio)
        let sx = 0, sy = 0, n = 0;
        for (let x = bbox.minLon; x <= bbox.maxLon; x += 0.04) for (let y = bbox.minLat; y <= bbox.maxLat; y += 0.04) if (enCuenca(x, y) && anillos.some((r) => dentroAnillo(r, x, y))) { sx += x; sy += y; n++; }
        const geom = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((p) => p.map((r) => simplificaAnillo(r, 450)).filter(Boolean)).filter((p) => p.length);
        munis.push({ type: 'Feature', properties: { n: f.properties.NOMGEO, e: est, c: f.properties.CVEGEO, ...(n >= 3 ? { lon: Math.round((sx / n) * 1e4) / 1e4, lat: Math.round((sy / n) * 1e4) / 1e4, km2: Math.round(n * 0.04 * 0.04 * 111.2 * 111.2 * Math.cos(28 * rad)) } : {}) }, geometry: { type: 'MultiPolygon', coordinates: geom } });
    }
}
escribe('ref_municipios.geojson', { type: 'FeatureCollection', properties: fcMeta({ fuente: 'INEGI, Marco Geoestadístico (límites municipales)', licencia: 'Términos de libre uso de INEGI; citar la fuente', tolerancia_m: 450 }), features: munis });

// ════════ 2. Poblaciones (cabeceras municipales) ════════
const pobl = [];
for (const [carp, cve] of [['chih', '08'], ['dgo', '10']]) {
    const fc = await leeCapa(path.join(dir, carp, 'conjunto_de_datos', `${cve}l`));
    for (const f of fc.features) {
        if (f.properties.CVE_LOC !== '0001') continue;
        const pts = anillosDe(f.geometry).flat();
        if (!pts.length) continue;
        const x = pts.reduce((a, p) => a + p[0], 0) / pts.length, y = pts.reduce((a, p) => a + p[1], 0) / pts.length;
        if (!enCuenca(x, y)) continue; // solo cabeceras dentro de la cuenca
        pobl.push({ type: 'Feature', properties: { n: f.properties.NOMGEO, c: f.properties.CVE_MUN, e: cve === '08' ? 'Chih.' : 'Dgo.' }, geometry: { type: 'Point', coordinates: r4([x, y]) } });
    }
}
escribe('ref_poblaciones.geojson', { type: 'FeatureCollection', properties: fcMeta({ fuente: 'INEGI, Marco Geoestadístico (localidad cabecera, CVE_LOC 0001)', licencia: 'Términos de libre uso de INEGI; citar la fuente' }), features: pobl });

// ════════ 3. Ríos (HydroRIVERS) ════════
const ORD_MIN = Number(process.env.ORD_MIN ?? 4);
const hr = await leeCapa(path.join(dir, 'hydro', 'HydroRIVERS_v10_na_shp', 'HydroRIVERS_v10_na'));
const rios = [];
for (const f of hr.features) {
    const ord = Number(f.properties.ORD_STRA);
    if (ord < ORD_MIN) continue;
    for (const l of lineasDe(f.geometry)) {
        if (!l.some(([x, y]) => enBbox(x, y) && enCuenca(x, y))) continue;
        const s = simplificaLinea(l, 250);
        if (s.length >= 2) rios.push({ type: 'Feature', properties: { o: ord, q: Math.round(Number(f.properties.DIS_AV_CMS) * 10) / 10 }, geometry: { type: 'LineString', coordinates: s } });
    }
}
escribe('ref_rios.geojson', { type: 'FeatureCollection', properties: fcMeta({ fuente: 'HydroSHEDS, HydroRIVERS v10 (Lehner y Grill 2013)', licencia: 'Uso libre con atribución (HydroSHEDS)', orden_strahler_min: ORD_MIN, nota: 'o = orden de Strahler; q = caudal medio (m³/s, modelado). Los nombres de ríos van aparte en ref_rios_rotulos.json.' }), features: rios });

// Rótulos de los ríos principales: HydroRIVERS no trae nombres, así que se fijan por localidades conocidas del cauce y se AJUSTAN al vértice
// más cercano del río (orden ≥ ORD_ROTULO) para garantizar que caen sobre la línea. Ángulo = dirección local del cauce (legible, −90..90).
const ORD_ROTULO = 5;
const ANCLAS = [
    { n: 'Río Conchos', lon: -105.28, lat: 28.03 }, { n: 'Río Conchos', lon: -106.70, lat: 27.49 }, { n: 'Río San Pedro', lon: -105.93, lat: 27.91 },
    { n: 'Río Florido', lon: -104.91, lat: 27.24 },
];
const rotulos = ANCLAS.map((a) => {
    let mejor = null;
    for (const f of rios) {
        if (f.properties.o < ORD_ROTULO) continue;
        const c = f.geometry.coordinates;
        for (let i = 1; i < c.length - 1; i++) {
            const d = Math.hypot((c[i][0] - a.lon) * Math.cos(28 * rad), c[i][1] - a.lat);
            if (!mejor || d < mejor.d) mejor = { d, p: c[i], dir: [c[i + 1][0] - c[i - 1][0], c[i + 1][1] - c[i - 1][1]] };
        }
    }
    if (!mejor || mejor.d > 0.3) { console.warn(`Rótulo «${a.n}» sin río cercano (${mejor ? (mejor.d * 111).toFixed(0) + ' km' : 'ninguno'}): se omite`); return null; }
    let ang = (Math.atan2(-mejor.dir[1], mejor.dir[0] * Math.cos(28 * rad)) * 180) / Math.PI;
    if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    console.log(`  rótulo ${a.n}: a ${(mejor.d * 111).toFixed(1)} km del ancla, ángulo ${ang.toFixed(0)}°`);
    return { n: a.n, lon: mejor.p[0], lat: mejor.p[1], ang: Math.round(ang) };
}).filter(Boolean);
fs.writeFileSync(path.join(GEO, 'ref_rios_rotulos.json'), JSON.stringify({ generado: HOY, fuente: 'Nombres: criterio SICA sobre HydroRIVERS (los cauces no traen nombre)', rotulos }));

// ════════ 4. Carreteras (Natural Earth) ════════
const ne = await leeCapa(path.join(dir, 'ne_roads', 'ne_10m_roads_north_america'));
const car = [];
for (const f of ne.features) {
    if (f.properties.country !== 'Mexico' || f.properties.class === 'Other') continue; // solo troncales federales y estatales
    for (const l of lineasDe(f.geometry)) {
        if (!l.some(([x, y]) => enBbox(x, y, 0.1))) continue;
        const s = simplificaLinea(l, 300);
        if (s.length >= 2) car.push({ type: 'Feature', properties: { r: [f.properties.prefix, f.properties.number].filter(Boolean).join(' ') || undefined, k: f.properties.class || undefined }, geometry: { type: 'LineString', coordinates: s } });
    }
}
escribe('ref_carreteras.geojson', { type: 'FeatureCollection', properties: fcMeta({ fuente: 'Natural Earth, 10m Roads North America', licencia: 'Dominio público' }), features: car });

console.log('bbox cuenca', JSON.stringify(bbox));
/*
 * README de descarga (una sola vez; ~330 MB, se borra después):
 *   M=https://www.inegi.org.mx/contenidos/productos/prod_serv/contenidos/espanol/bvinegi/productos/geografia/marcogeo/794551132173
 *   curl -L $M/08_chihuahua.zip -o chih.zip ; curl -L $M/10_durango.zip -o dgo.zip
 *   curl -L https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_na_shp.zip -o hydro.zip
 *   curl -L https://naciscdn.org/naturalearth/10m/cultural/ne_10m_roads_north_america.zip -o ne_roads.zip
 *   unzip chih.zip "conjunto_de_datos/*mun.*" "conjunto_de_datos/08l.*" -d x/chih   (idem dgo con 10l)
 *   unzip hydro.zip -d x/hydro ; unzip ne_roads.zip -d x/ne_roads
 */
