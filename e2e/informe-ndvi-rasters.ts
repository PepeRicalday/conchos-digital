// Fixture de la auditoría: un raster NDVI SINTÉTICO por módulo (PNG RGBA de clases discretas, ≈ 33 m/px) con el contrato de la función
// sentinel-ndvi-modulo-raster. Lo consume e2e/ndvi-tendencia-comparacion.mjs para simular el éxito de la función con page.route.
//   npx vite-node e2e/informe-ndvi-rasters.ts
import fs from 'fs';
import { fileURLToPath } from 'url';
import { contornosAAnillos } from '../src/utils/informeNdviSvg';
import { bboxDe, pngRgba, rasterSinteticoRgba } from './_raster_sintetico';

const aqui = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const fc = JSON.parse(fs.readFileSync(aqui('../public/geo/modulos.geojson'), 'utf-8')) as GeoJSON.FeatureCollection;
const contornos = contornosAAnillos(fc);
const NDVI: Record<number, number> = { 1: 0.33, 2: 0.36, 3: 0.51, 4: 0.21, 5: 0.22, 12: 0.55 };
const salida: Record<number, unknown> = {};
for (const m of Object.keys(NDVI).map(Number)) {
    const bbox = bboxDe(contornos[m]);
    const img = rasterSinteticoRgba(bbox, NDVI[m], m);
    salida[m] = { png_base64: Buffer.from(pngRgba(img)).toString('base64'), bbox, ancho: img.ancho, alto: img.alto, n_escenas: 4 + (m % 5), pct_pixeles_validos: 0.8 + (m % 4) * 0.05, resolucion_m: 33 };
}
const destino = aqui('./out/informe-ndvi/rasters_sinteticos.json');
fs.mkdirSync(aqui('./out/informe-ndvi/'), { recursive: true });
fs.writeFileSync(destino, JSON.stringify(salida));
console.log('fixture', destino, `${(fs.statSync(destino).size / 1024).toFixed(0)} KiB`);
