/**
 * Genera public/geo/plano_ndvi_contexto.json: canal y río Conchos y los vecinos del DR-005 (módulos que no son de la SRL),
 * simplificados con Douglas-Peucker en metros y recortados a la caja del hillshade del plano, para el informe NDVI.
 * Uso: npx vite-node scripts/genera_contexto_plano_ndvi.ts   (requiere haber corrido scripts/recorta_hillshade_srl.py)
 */
import fs from 'fs';
import { fileURLToPath } from 'url';
import { simplificarAnillosDP, simplificarLineaDP, type Punto } from '../src/utils/geoSimplifica';
import { esModuloSRL } from '../src/utils/modulosSRL';

const aqui = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const leer = (p: string) => JSON.parse(fs.readFileSync(aqui(p), 'utf-8'));
const meta = leer('../public/dem-distrito-hillshade/hillshade_srl_plano.json');
const [w, s, e, n] = meta.bbox as [number, number, number, number];
const TOL_LINEA_M = 60, TOL_VECINO_M = 120;
const r4 = (p: Punto): Punto => [Number(p[0].toFixed(3)), Number(p[1].toFixed(3))]; // 0.001° ≈ 100 m a esta escala
const dentro = (p: Punto) => p[0] >= w - 0.02 && p[0] <= e + 0.02 && p[1] >= s - 0.02 && p[1] <= n + 0.02;

/** Parte la línea en tramos que están dentro de la caja (con holgura): lo de afuera no se dibuja. */
function tramos(linea: Punto[]): Punto[][] {
    const out: Punto[][] = []; let cur: Punto[] = [];
    for (const p of linea) { if (dentro(p)) cur.push(p); else { if (cur.length > 1) out.push(cur); cur = []; } }
    if (cur.length > 1) out.push(cur);
    return out;
}
const lineas = (fc: GeoJSON.FeatureCollection) => fc.features.flatMap((f) => (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : []) as Punto[][]);
const simplificaLineas = (ls: Punto[][], tol: number) => ls.flatMap(tramos).map((t) => simplificarLineaDP(t, tol)).map((t) => t.map(r4)).filter((t) => t.length > 1);

const canal = simplificaLineas(lineas(leer('../public/geo/canal_conchos.geojson')), TOL_LINEA_M);
const rio = simplificaLineas(lineas(leer('../public/geo/rio_conchos.geojson')), TOL_LINEA_M);
const mods = leer('../public/geo/modulos.geojson') as GeoJSON.FeatureCollection;
const vecinos = mods.features.filter((f) => !esModuloSRL(Number(f.properties?.numero_modulo))).flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.map((p) => p[0]) : []) as Punto[][]);
const vec = simplificarAnillosDP(vecinos, TOL_VECINO_M).map((a) => a.map(r4)).filter((a) => a.length >= 4 && a.some(dentro));

const salida = { bbox: meta.bbox, canal, rio, vecinos: vec, nota: 'Generado por scripts/genera_contexto_plano_ndvi.ts (Douglas-Peucker en metros; canal y río 60 m, vecinos 120 m). Contexto del plano del informe NDVI, no cartografía de precisión.' };
const txt = JSON.stringify(salida);
fs.writeFileSync(aqui('../public/geo/plano_ndvi_contexto.json'), txt);
console.log('plano_ndvi_contexto.json', txt.length, 'bytes', { canal: canal.map((t) => t.length), rio: rio.map((t) => t.length), vecinos: vec.map((t) => t.length) });
