#!/usr/bin/env node
/**
 * Genera public/geo/cuenca_dem_grid.json: elevación (m) sobre una malla regular de 0.1° dentro de la cuenca del Conchos
 * y la elevación DEM de las estaciones JCAS. Fuente: API de elevación de Open-Meteo (Copernicus GLO-90, ~90 m).
 *   node scripts/cuenca_dem_grid.mjs
 * Uso: elevación real de cada estación (la de JCAS no es confiable: Balleza 2,902 m vs 1,577 m del DEM), ajuste lluvia~altitud
 * y relieve grueso. Fuera de línea: el resultado se commitea; no se llama a la API desde la app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASO = 0.1;
const poli = JSON.parse(fs.readFileSync(path.join(raiz, 'public/geo/cuenca_conchos.geojson'), 'utf8')).features[0].geometry.coordinates;
const est = JSON.parse(fs.readFileSync(path.join(raiz, 'supabase/functions/jcas-sync/fixtures/estaciones.json'), 'utf8'));

const dentro = (a, x, y) => { let c = false; for (let i = 0, j = a.length - 1; i < a.length; j = i++) { const [xi, yi] = a[i], [xj, yj] = a[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
let minLo = Infinity, maxLo = -Infinity, minLa = Infinity, maxLa = -Infinity;
for (const p of poli) for (const [x, y] of p[0]) { minLo = Math.min(minLo, x); maxLo = Math.max(maxLo, x); minLa = Math.min(minLa, y); maxLa = Math.max(maxLa, y); }

// Malla alineada a múltiplos de PASO (centros de celda), para que el cliente indexe por [fila][columna] sin interpolar posiciones.
const lon0 = Math.floor(minLo / PASO) * PASO + PASO / 2, lat1 = Math.ceil(maxLa / PASO) * PASO - PASO / 2;
const nx = Math.ceil((maxLo - lon0) / PASO) + 1, ny = Math.ceil((lat1 - minLa) / PASO) + 1;
const celdas = [];
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const lon = +(lon0 + i * PASO).toFixed(4), lat = +(lat1 - j * PASO).toFixed(4);
    if (poli.some((p) => dentro(p[0], lon, lat))) celdas.push({ i, j, lon, lat });
}
console.log(`Malla ${nx}×${ny}, ${celdas.length} celdas dentro de la cuenca`);

async function elevaciones(puntos) {
    const out = [];
    for (let k = 0; k < puntos.length; k += 100) {
        const lote = puntos.slice(k, k + 100);
        const url = `https://api.open-meteo.com/v1/elevation?latitude=${lote.map((p) => p.lat).join(',')}&longitude=${lote.map((p) => p.lon).join(',')}`;
        let r;
        for (let intento = 0; intento < 6; intento++) {
            r = await fetch(url, { headers: { 'User-Agent': 'SICA005-conchos (malla de elevacion, una sola vez)' } });
            if (r.ok) break;
            await new Promise((s) => setTimeout(s, 15000 * (intento + 1)));
        }
        if (!r.ok) throw new Error(`Open-Meteo elevation HTTP ${r.status}`);
        const j = await r.json();
        if (!Array.isArray(j.elevation) || j.elevation.length !== lote.length) throw new Error('respuesta de elevación inesperada');
        out.push(...j.elevation);
        await new Promise((s) => setTimeout(s, 4000));
    }
    return out;
}

const elevCeldas = await elevaciones(celdas);
const estaciones = est.map((e) => ({ id: e.id, nombre: e.nombre, lat: +e.latitud, lon: +e.longitud, altitud_jcas: e.altitud === '' ? null : +e.altitud }));
const elevEst = await elevaciones(estaciones);

const valores = Array.from({ length: ny }, () => Array(nx).fill(null));
celdas.forEach((c, n) => { valores[c.j][c.i] = Math.round(elevCeldas[n]); });
const discrepantes = estaciones.map((e, n) => ({ ...e, elevacion_dem: Math.round(elevEst[n]) }))
    .map((e) => ({ ...e, dif: e.altitud_jcas == null ? null : e.altitud_jcas - e.elevacion_dem }));

const salida = {
    fuente: 'Open-Meteo Elevation API (Copernicus GLO-90)', generado: new Date().toISOString().slice(0, 10), paso_grados: PASO,
    lon0: +lon0.toFixed(4), lat1: +lat1.toFixed(4), nx, ny, unidad: 'm',
    nota: 'valores[j][i]: j de norte a sur, i de oeste a este; null fuera de la cuenca',
    valores,
    estaciones_jcas: discrepantes.map(({ id, nombre, altitud_jcas, elevacion_dem, dif }) => ({ id, nombre, altitud_jcas, elevacion_dem, dif })),
};
fs.writeFileSync(path.join(raiz, 'public/geo/cuenca_dem_grid.json'), JSON.stringify(salida));
const kb = (fs.statSync(path.join(raiz, 'public/geo/cuenca_dem_grid.json')).size / 1024).toFixed(0);
const vals = celdas.map((_, n) => elevCeldas[n]);
console.log(`Escrito cuenca_dem_grid.json (${kb} KB) · elevación ${Math.min(...vals)}–${Math.max(...vals)} m`);
console.log('Estaciones con altitud JCAS discrepante (> 300 m) o ausente:');
for (const e of discrepantes.filter((x) => x.dif == null || Math.abs(x.dif) > 300).filter((x) => [2,3,4,5,6,7,8,9,13,18,19,25,28,30,31,33,38,44].includes(x.id))) {
    console.log(`  ${e.nombre}: JCAS ${e.altitud_jcas ?? 'S/D'} · DEM ${e.elevacion_dem}`);
}
