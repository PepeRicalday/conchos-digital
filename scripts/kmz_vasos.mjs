// Convierte los KMZ de vasos de presa (un Placemark con un Polygon cada uno) en:
//   1) public/geo/ref_presas_vasos.geojson  — huellas simplificadas para los mapas (capa «presas»).
//   2) una migración semilla de public.cuerpos_agua_geometria — polígono a resolución completa.
//
// Los KMZ son contornos a nivel máximo (NAME / diseño), NO el espejo de hoy: sirven de huella tope del NDWI.
//
// Uso (desde conchos-digital/):
//   node scripts/kmz_vasos.mjs "<carpeta con subcarpetas de KMZ>" [--sql <ruta.sql>] [--geojson <ruta.geojson>] [--solo-validar]
// Ejemplo:
//   node scripts/kmz_vasos.mjs "../SICA CUENCA/SICA Presas" --sql supabase/migrations/20261111110000_cuerpos_agua_geometria_seed.sql
//
// Sin dependencias: lector ZIP mínimo sobre node:zlib (cada KMZ trae un solo doc.kml).
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Clave del inventario (primeros 4 dígitos del nombre del KMZ) → cuerpo de agua del catálogo. */
export const CUERPOS_POR_CLAVE = {
  '0750': { id: 'CA-LBQCH', nombre: 'La Boquilla', presaId: 'PRE-001' },
  '0813': { id: 'CA-FIMCH', nombre: 'Francisco I. Madero', presaId: 'PRE-002' },
  '0825': { id: 'CA-LLNCH', nombre: 'Luis L. León', presaId: null },
  '1035': { id: 'CA-SGBDR', nombre: 'San Gabriel, Dgo.', presaId: null },
  '0867': { id: 'CA-PAGCH', nombre: 'Pico del Águila', presaId: null },
  '0777': { id: 'CA-CHUCH', nombre: 'Chihuahua', presaId: null },
  '0881': { id: 'CA-ERECH', nombre: 'El Rejón', presaId: null },
  '4297': { id: 'CA-PAZCH', nombre: 'Piedras Azules', presaId: null },
  '0783': { id: 'CA-COLINA', nombre: 'La Colina', presaId: null },
};

// ── ZIP mínimo ────────────────────────────────────────────────────────────────────────────────────────────────────
/** Devuelve el contenido del primer .kml del KMZ (directorio central → cabecera local → inflate). */
export function kmlDeKmz(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 65557; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no es un ZIP (sin fin de directorio central)');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('directorio central dañado');
    const metodo = buf.readUInt16LE(p + 10);
    const comp = buf.readUInt32LE(p + 20);
    const lenNombre = buf.readUInt16LE(p + 28), lenExtra = buf.readUInt16LE(p + 30), lenCom = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + lenNombre);
    if (/\.kml$/i.test(nombre)) {
      const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const datos = buf.subarray(ini, ini + comp);
      if (metodo === 0) return datos.toString('utf8');
      if (metodo === 8) return inflateRawSync(datos).toString('utf8');
      throw new Error(`método de compresión ${metodo} no soportado`);
    }
    p += 46 + lenNombre + lenExtra + lenCom;
  }
  throw new Error('el KMZ no trae ningún .kml');
}

// ── KML ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const sinEntidades = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();

/** Extrae el único polígono del KML: { nombre, descripcion, anillo: [[lon, lat], …] }. Falla si hay huecos o varios polígonos. */
export function poligonoDeKml(kml) {
  const placemarks = kml.match(/<Placemark[\s\S]*?<\/Placemark>/g) ?? [];
  if (placemarks.length !== 1) throw new Error(`se esperaba 1 Placemark y hay ${placemarks.length}`);
  const pm = placemarks[0];
  if ((pm.match(/<Polygon/g) ?? []).length !== 1) throw new Error('se esperaba 1 Polygon');
  if (/<innerBoundaryIs/.test(pm)) throw new Error('el polígono trae huecos (islas): este script no los conserva');
  const coords = pm.match(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/)?.[1];
  if (!coords) throw new Error('sin <coordinates> en el anillo exterior');
  const anillo = coords.trim().split(/\s+/).map((t) => {
    const [lon, lat] = t.split(',').map(Number);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error(`coordenada ilegible: «${t}»`);
    return [lon, lat];
  });
  return {
    nombre: sinEntidades(pm.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? ''),
    descripcion: sinEntidades(pm.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? ''),
    anillo,
  };
}

// ── Geometría ─────────────────────────────────────────────────────────────────────────────────────────────────────
const R_KM = 6371.0088;
/** Un lazo menor a 0.2 ha no es una isla: es un nudo del trazo. */
const AREA_MIN_ISLA_KM2 = 0.002;
const rad = (g) => (g * Math.PI) / 180;

/** Proyección equirectangular local (km) centrada en la latitud media del anillo. */
function aPlano(anillo) {
  const lat0 = anillo.reduce((s, c) => s + c[1], 0) / anillo.length;
  const lon0 = anillo.reduce((s, c) => s + c[0], 0) / anillo.length;
  const kx = R_KM * Math.cos(rad(lat0)) * (Math.PI / 180), ky = R_KM * (Math.PI / 180);
  return { pts: anillo.map(([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky]), lon0, lat0, kx, ky };
}

/** Área con signo (km², >0 = antihorario), perímetro (km) y centroide de área (lon, lat). */
export function medidas(anillo) {
  const { pts, lon0, lat0, kx, ky } = aPlano(anillo);
  let a2 = 0, cx = 0, cy = 0, per = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const f = x1 * y2 - x2 * y1;
    a2 += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
    per += Math.hypot(x2 - x1, y2 - y1);
  }
  const area = a2 / 2;
  return { areaSignada: area, perimetroKm: per, centroide: [lon0 + cx / (6 * area) / kx, lat0 + cy / (6 * area) / ky] };
}

const cruz = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
/** Cruce propio de dos segmentos (los que solo se tocan en un extremo no cuentan). */
const seCruzan = (a, b, c, d) => {
  const d1 = cruz(c, d, a), d2 = cruz(c, d, b), d3 = cruz(a, b, c), d4 = cruz(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};

/** Número de autointersecciones del anillo (O(n²); los vasos tienen ≤ ~2,200 vértices). */
export function autointersecciones(anillo) {
  const { pts } = aPlano(anillo);
  const n = pts.length - 1;
  let k = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // segmentos contiguos por el cierre
      if (seCruzan(pts[i], pts[i + 1], pts[j], pts[j + 1])) k++;
    }
  }
  return k;
}

/**
 * Separa los lazos de un anillo que se cruza a sí mismo. En estos KMZ un cruce es casi siempre una ISLA dibujada «en
 * ojo de cerradura»: el trazo entra desde la orilla, rodea la isla y regresa por el mismo sitio. Se corta siempre el
 * lazo de menor número de vértices, hasta que el anillo restante queda simple.
 * Devuelve { exterior, lazos } (cada lazo es un anillo cerrado, sin orientar).
 */
export function separarLazos(anillo, maxPasadas = 500) {
  let a = anillo.map((c) => [...c]);
  const lazos = [];
  for (let pasada = 0; pasada < maxPasadas; pasada++) {
    const { pts } = aPlano(a);
    const n = pts.length - 1;
    let mejor = null;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (mejor && j - i >= mejor[1] - mejor[0]) break; // solo interesa un lazo más corto
        if (seCruzan(pts[i], pts[i + 1], pts[j], pts[j + 1])) { mejor = [i, j]; break; }
      }
    }
    if (!mejor) return { exterior: a, lazos };
    const [i, j] = mejor;
    lazos.push([...a.slice(i + 1, j + 1), [...a[i + 1]]]);
    a = [...a.slice(0, i + 1), ...a.slice(j + 1)];
  }
  throw new Error(`no se pudieron separar los cruces en ${maxPasadas} pasadas`);
}

/** Punto en polígono (anillo exterior, regla par-impar). */
export function dentro([x, y], anillo) {
  let d = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
  }
  return d;
}

/** Douglas-Peucker sobre el plano local; tolerancia en metros. Conserva el cierre. */
export function simplificar(anillo, tolM) {
  const { pts } = aPlano(anillo);
  const tol = tolM / 1000, n = pts.length;
  const keep = new Uint8Array(n); keep[0] = 1; keep[n - 1] = 1;
  // Un anillo cerrado tiene extremos coincidentes: se parte por el vértice más lejano al inicio para no colapsarlo.
  let lejos = 0, dl = -1;
  for (let i = 1; i < n - 1; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > dl) { dl = d; lejos = i; } }
  keep[lejos] = 1;
  const pila = [[0, lejos], [lejos, n - 1]];
  while (pila.length) {
    const [a, b] = pila.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const L = Math.hypot(bx - ax, by - ay) || 1e-12;
    let im = -1, dm = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
      if (d > dm) { dm = d; im = i; }
    }
    if (im > 0) { keep[im] = 1; pila.push([a, im], [im, b]); }
  }
  return anillo.filter((_, i) => keep[i]);
}

const r = (v, d) => Number(v.toFixed(d));

/**
 * Codifica un anillo como polilínea de deltas (algoritmo de Google, precisión 1e-5 ≈ 1 m) sobre un alfabeto sin
 * caracteres especiales, para que la semilla quepa en una migración aplicable por MCP. La decodifica en la base
 * public.fn_anillo_decodifica (misma migración). Orden lat, lon en el flujo; el resultado es [lon, lat].
 */
export const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function codificarAnillo(anillo) {
  let out = '', pLat = 0, pLon = 0;
  const emite = (delta) => {
    let v = delta < 0 ? ~(delta << 1) : delta << 1;
    while (v >= 0x20) { out += ALFABETO[0x20 | (v & 0x1f)]; v >>>= 5; }
    out += ALFABETO[v];
  };
  for (const [lon, lat] of anillo) {
    const iLat = Math.round(lat * 1e5), iLon = Math.round(lon * 1e5);
    emite(iLat - pLat); emite(iLon - pLon);
    pLat = iLat; pLon = iLon;
  }
  return out;
}
export function decodificarAnillo(txt) {
  const out = []; let i = 0, lat = 0, lon = 0;
  const lee = () => { let res = 0, shift = 0, b; do { b = ALFABETO.indexOf(txt[i++]); res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20); return res & 1 ? ~(res >> 1) : res >> 1; };
  while (i < txt.length) { lat += lee(); lon += lee(); out.push([lon / 1e5, lat / 1e5]); }
  return out;
}

/** Normaliza (cierra, quita duplicados consecutivos, orienta antihorario RFC 7946) y valida. Devuelve el anillo y sus medidas. */
export function prepararAnillo(crudo) {
  let a = crudo.filter((c, i) => i === 0 || c[0] !== crudo[i - 1][0] || c[1] !== crudo[i - 1][1]);
  const [p0, pn] = [a[0], a[a.length - 1]];
  if (p0[0] !== pn[0] || p0[1] !== pn[1]) a = [...a, [...p0]];
  if (a.length < 4) throw new Error(`anillo con ${a.length} vértices (mínimo 4)`);
  let m = medidas(a);
  if (m.areaSignada < 0) { a = a.slice().reverse(); m = medidas(a); }
  // Cruces = islas en ojo de cerradura (o lazos de digitalización): se separan como huecos del polígono.
  const cruces = autointersecciones(a);
  const huecos = [];
  let reparacion = null;
  if (cruces > 0) {
    const s = separarLazos(a);
    a = s.exterior; m = medidas(a);
    if (m.areaSignada < 0) { a = a.slice().reverse(); m = medidas(a); }
    const descartados = [];
    for (const lazo of s.lazos) {
      const ml = medidas(lazo);
      const area = Math.abs(ml.areaSignada);
      if (lazo.length < 4 || area < AREA_MIN_ISLA_KM2) { descartados.push(area); continue; } // ida y vuelta sin superficie
      const dentroTodos = lazo.every((p) => dentro(p, a));
      if (!dentroTodos) {
        // Lazo hacia fuera de la orilla: es un nudo del trazo, no una isla. Solo se tolera si es despreciable.
        if (area > 0.1) throw new Error(`lazo exterior de ${area.toFixed(3)} km²: revisar el KMZ a mano`);
        descartados.push(area); continue;
      }
      huecos.push({ anillo: ml.areaSignada > 0 ? lazo.slice().reverse() : lazo, areaKm2: area, perimetroKm: ml.perimetroKm }); // huecos en horario
    }
    if (autointersecciones(a) > 0) throw new Error('quedan cruces en el contorno exterior tras separar los lazos');
    reparacion = { cruces, islas: huecos.map((h) => h.areaKm2), descartados };
  }
  const areaIslas = huecos.reduce((s, h) => s + h.areaKm2, 0);
  if (!dentro(m.centroide, a) && m.areaSignada < 0.5) throw new Error('centroide fuera de un polígono diminuto: geometría sospechosa');
  const lons = a.map((c) => c[0]), lats = a.map((c) => c[1]);
  return {
    anillo: a,
    huecos: huecos.map((h) => h.anillo),
    areaExteriorKm2: m.areaSignada,
    areaIslasKm2: areaIslas,
    areaKm2: m.areaSignada - areaIslas,
    perimetroKm: m.perimetroKm + huecos.reduce((s, h) => s + h.perimetroKm, 0),
    centroide: m.centroide,
    bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    reparacion,
  };
}

// ── Principal ─────────────────────────────────────────────────────────────────────────────────────────────────────
function listarKmz(carpeta) {
  const out = [];
  for (const e of readdirSync(carpeta)) {
    const p = join(carpeta, e);
    if (statSync(p).isDirectory()) out.push(...listarKmz(p));
    else if (/\.kmz$/i.test(e)) out.push(p);
  }
  return out;
}

function anilloCuenca() {
  const fc = JSON.parse(readFileSync(join(RAIZ, 'public/geo/cuenca_conchos.geojson'), 'utf8'));
  const g = fc.features[0].geometry;
  const polis = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  return polis.map((p) => p[0]);
}

const q = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

function principal() {
  const args = process.argv.slice(2);
  const carpeta = args.find((a) => !a.startsWith('--'));
  if (!carpeta) { console.error('Uso: node scripts/kmz_vasos.mjs "<carpeta de KMZ>" [--sql ruta] [--geojson ruta] [--solo-validar]'); process.exit(2); }
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const soloValidar = args.includes('--solo-validar');
  const rutaGeo = opt('--geojson') ?? join(RAIZ, 'public/geo/ref_presas_vasos.geojson');
  const rutaSql = opt('--sql');
  const cuenca = anilloCuenca();
  const hoy = new Date().toISOString().slice(0, 10);

  const vasos = [];
  for (const ruta of listarKmz(carpeta).sort()) {
    const archivo = basename(ruta);
    const clave = archivo.slice(0, 4);
    const cuerpo = CUERPOS_POR_CLAVE[clave];
    if (!cuerpo) { console.error(`✗ ${archivo}: clave ${clave} no está en CUERPOS_POR_CLAVE (agrégala al catálogo del script)`); process.exitCode = 1; continue; }
    try {
      const buf = readFileSync(ruta);
      const { descripcion, anillo: crudo } = poligonoDeKml(kmlDeKmz(buf));
      const g = prepararAnillo(crudo);
      const enCuenca = cuenca.some((c) => dentro(g.centroide, c));
      if (!enCuenca) throw new Error(`centroide ${g.centroide.map((v) => v.toFixed(4))} fuera del contorno de la cuenca del Conchos`);
      vasos.push({ ...cuerpo, clave, archivo, descripcion, sha256: createHash('sha256').update(buf).digest('hex'), ...g });
      console.error(`✓ ${cuerpo.id.padEnd(10)} ${archivo}  ${String(g.anillo.length).padStart(5)} vért.  ${g.areaKm2.toFixed(2).padStart(7)} km²  perím. ${g.perimetroKm.toFixed(1).padStart(6)} km  «${descripcion}»`);
      if (g.reparacion) console.error(`    ↳ ${g.reparacion.cruces} cruce(s): ${g.reparacion.islas.length} isla(s) [${g.reparacion.islas.map((x) => x.toFixed(3)).join(', ')} km²], ${g.reparacion.descartados.length} nudo(s) descartado(s); contorno exterior ${g.areaExteriorKm2.toFixed(2)} km² − islas ${g.areaIslasKm2.toFixed(2)} km²`);
    } catch (e) {
      console.error(`✗ ${archivo}: ${e.message}`); process.exitCode = 1;
    }
  }
  const repetidos = vasos.map((v) => v.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (repetidos.length) { console.error(`✗ cuerpos con más de un KMZ: ${repetidos.join(', ')}`); process.exitCode = 1; }
  if (process.exitCode || soloValidar) return;
  vasos.sort((a, b) => b.areaKm2 - a.areaKm2);

  // 1) GeoJSON de referencia para los mapas (simplificado a ~25 m, 5 decimales ≈ 1 m).
  const geo = {
    type: 'FeatureCollection',
    properties: {
      generado: hoy,
      fuente: 'Huellas: polígonos KMZ del inventario de presas (SRL Conchos). Espejo: contorno NDWI Sentinel-2 de La Boquilla (tabla vaso_geometria_historico).',
      nota: 'Huella máxima = nivel de diseño / NAME, NO el espejo de agua de hoy. Simplificado a 25 m. Regenerar: node scripts/kmz_vasos.mjs',
    },
    features: vasos.map((v) => ({
      type: 'Feature',
      properties: {
        id: v.id, presa_id: v.presaId, nombre: v.nombre, clave: v.clave, fuente: 'kmz_huella_maxima',
        area_km2: r(v.areaKm2, 2), islas: v.huecos.length, centroide: v.centroide.map((c) => r(c, 5)),
        nota: 'Huella máxima del vaso (referencia de extensión; no es el nivel de hoy)',
      },
      geometry: { type: 'Polygon', coordinates: [v.anillo, ...v.huecos].map((an) => simplificar(an, 25).map(([x, y]) => [r(x, 5), r(y, 5)])) },
    })),
  };
  // Conserva lo que NO es huella (p. ej. el espejo NDWI de La Boquilla, fuente sentinel2_ndwi) y lo pone primero: la capa de mapa lo dibuja encima.
  if (existsSync(rutaGeo)) {
    const previo = JSON.parse(readFileSync(rutaGeo, 'utf8'));
    const otros = (previo.features ?? []).filter((f) => f?.properties?.fuente !== 'kmz_huella_maxima');
    geo.features = [...otros, ...geo.features];
    if (previo.properties?.fuente_ndwi) geo.properties.fuente_ndwi = previo.properties.fuente_ndwi;
  }
  writeFileSync(rutaGeo, JSON.stringify(geo));
  console.error(`→ ${rutaGeo} (${vasos.length} vasos, ${(JSON.stringify(geo).length / 1024).toFixed(0)} KB)`);

  // 2) Semilla de cuerpos_agua_geometria: simplificada a 10 m (un píxel de Sentinel-2) y codificada.
  if (rutaSql) {
    const TOL_BD_M = 10;
    const md5 = (t) => createHash('md5').update(t).digest('hex');
    const filas = vasos.map((v) => {
      const anillosBd = [v.anillo, ...v.huecos].map((an) => simplificar(an, TOL_BD_M));
      const cod = anillosBd.map(codificarAnillo).join('.');
      // Comprobación de ida y vuelta: lo que la base decodificará es lo que se midió.
      const ida = cod.split('.').map(decodificarAnillo);
      if (ida.some((an, k) => an.length !== anillosBd[k].length)) throw new Error(`${v.id}: la codificación no es reversible`);
      return { v, cod, vertices: anillosBd.reduce((t, an) => t + an.length, 0) };
    });
    const sql = `-- Huellas máximas de los vasos (generado por scripts/kmz_vasos.mjs el ${hoy}).
-- Fuente: KMZ de «SICA CUENCA/SICA Presas». Contorno a nivel de diseño (NAME), no el espejo de hoy.
-- Polígonos simplificados a ${TOL_BD_M} m y codificados (polilínea de deltas, 1e-5°); área y perímetro medidos sobre
-- el KMZ a resolución completa. md5 = suma de control del texto codificado (la fila no entra si no coincide).

CREATE OR REPLACE FUNCTION public.fn_anillo_decodifica(p text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $fn$
DECLARE
  alfabeto constant text := '${ALFABETO}';
  i int := 1; n int := length(p); lat bigint := 0; lon bigint := 0;
  b int; shift int; res bigint; k int; pts text[] := '{}';
BEGIN
  WHILE i <= n LOOP
    FOR k IN 1..2 LOOP
      shift := 0; res := 0;
      LOOP
        b := strpos(alfabeto, substr(p, i, 1)) - 1;
        IF b < 0 THEN RAISE EXCEPTION 'carácter inválido en la posición %', i; END IF;
        i := i + 1;
        res := res | ((b & 31)::bigint << shift);
        shift := shift + 5;
        EXIT WHEN b < 32;
      END LOOP;
      IF (res & 1) = 1 THEN res := ~(res >> 1); ELSE res := res >> 1; END IF;
      IF k = 1 THEN lat := lat + res; ELSE lon := lon + res; END IF;
    END LOOP;
    pts := pts || format('[%s,%s]', round(lon / 100000.0, 5), round(lat / 100000.0, 5));
  END LOOP;
  RETURN ('[' || array_to_string(pts, ',') || ']')::jsonb;
END $fn$;
COMMENT ON FUNCTION public.fn_anillo_decodifica(text) IS 'Decodifica un anillo (polilínea de deltas 1e-5°, alfabeto URL-seguro) a un arreglo GeoJSON [[lon,lat],…]. Lo usa la semilla de cuerpos_agua_geometria.';

-- Una sola huella vigente por cuerpo: si el KMZ cambió (otro sha256), la anterior deja de ser vigente.
UPDATE public.cuerpos_agua_geometria g SET vigente = false
WHERE g.tipo = 'huella_maxima' AND g.vigente
  AND EXISTS (SELECT 1 FROM (VALUES ${filas.map(({ v }) => `(${q(v.id)}, ${q(v.sha256)})`).join(', ')}) AS n(cuerpo_id, sha256)
              WHERE n.cuerpo_id = g.cuerpo_id AND n.sha256 <> g.sha256);

INSERT INTO public.cuerpos_agua_geometria
  (cuerpo_id, tipo, fuente, archivo, sha256, descripcion_origen, geojson, area_km2, perimetro_km, vertices, num_islas, area_islas_km2, bbox, centroide_lon, centroide_lat)
SELECT s.cuerpo_id, 'huella_maxima', 'KMZ inventario de presas', s.archivo, s.sha256, s.descripcion,
       jsonb_build_object('type', 'Polygon', 'coordinates',
         (SELECT jsonb_agg(public.fn_anillo_decodifica(a.t) ORDER BY a.ord) FROM unnest(string_to_array(s.cod, '.')) WITH ORDINALITY AS a(t, ord))),
       s.area_km2, s.perimetro_km, s.vertices, s.num_islas, s.area_islas_km2, s.bbox::jsonb, s.clon, s.clat
FROM (VALUES
${filas.map(({ v, cod, vertices }) => `(${q(v.id)}, ${q(v.archivo)}, ${q(v.sha256)}, ${q(v.descripcion)}, ${r(v.areaKm2, 3)}, ${r(v.perimetroKm, 2)}, ${vertices}, ${v.huecos.length}, ${r(v.areaIslasKm2, 3)}, ${q(JSON.stringify(v.bbox.map((c) => r(c, 5))))}, ${r(v.centroide[0], 5)}, ${r(v.centroide[1], 5)}, ${q(md5(cod))},\n ${q(cod)})`).join(',\n')}
) AS s(cuerpo_id, archivo, sha256, descripcion, area_km2, perimetro_km, vertices, num_islas, area_islas_km2, bbox, clon, clat, md5, cod)
WHERE md5(s.cod) = s.md5
ON CONFLICT (cuerpo_id, tipo, sha256) DO NOTHING;
`;
    writeFileSync(rutaSql, sql);
    console.error(`→ ${rutaSql} (${(sql.length / 1024).toFixed(0)} KB)`);
    for (const { v, cod, vertices } of filas) console.error(`   ${v.id.padEnd(10)} ${String(vertices).padStart(5)} vért.  ${String(cod.length).padStart(6)} car.  md5 ${md5(cod)}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) principal();
