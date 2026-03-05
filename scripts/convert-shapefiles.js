/**
 * Convierte los Shapefiles (.shp/.dbf) en public/geo/ a archivos GeoJSON.
 * Uso: node scripts/convert-shapefiles.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import shp from 'shpjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GEO_DIR = path.join(__dirname, '..', 'public', 'geo');

function toArrayBuffer(buf) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function convertShapefile(shpFile, outputName) {
    const shpPath = path.join(GEO_DIR, shpFile);

    if (!fs.existsSync(shpPath)) {
        console.log(`⚠️  No encontrado: ${shpFile}`);
        return null;
    }

    console.log(`📂 Leyendo: ${shpFile} (${(fs.statSync(shpPath).size / 1024).toFixed(1)} KB)`);

    const shpBuffer = toArrayBuffer(fs.readFileSync(shpPath));

    // Buscar .dbf con distintas variantes de nombre
    const baseName = shpFile.replace('.shp', '');
    const dbfVariants = [`${baseName}.dbf`, `${baseName}.DBF`];
    let dbfBuffer = null;

    for (const dbfName of dbfVariants) {
        const dbfPath = path.join(GEO_DIR, dbfName);
        if (fs.existsSync(dbfPath)) {
            console.log(`  📋 Atributos: ${dbfName}`);
            dbfBuffer = toArrayBuffer(fs.readFileSync(dbfPath));
            break;
        }
    }

    try {
        // shpjs acepta un objeto { shp, dbf } para parsear archivos separados
        const geojson = await shp({ shp: shpBuffer, dbf: dbfBuffer });

        let featureCollection;
        if (Array.isArray(geojson)) {
            // Múltiples capas — tomar la primera
            featureCollection = geojson[0];
        } else {
            featureCollection = geojson;
        }

        if (!featureCollection || !featureCollection.features) {
            console.error(`  ❌ No se obtuvieron features`);
            return null;
        }

        // Enriquecer con metadatos según el tipo
        if (outputName === 'modulos') {
            const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#ec4899'];
            featureCollection.features.forEach((f, i) => {
                f.properties = {
                    ...f.properties,
                    id: `MOD-${i + 1}`,
                    color: colors[i % colors.length],
                    fill_opacity: 0.18,
                    nombre: f.properties?.NOMBRE || f.properties?.nombre || f.properties?.Name || `Módulo ${i + 1}`,
                    numero_modulo: f.properties?.NUMERO || f.properties?.numero || i + 1,
                };
            });
        } else if (outputName === 'canal_conchos') {
            featureCollection.features.forEach((f, i) => {
                f.properties = {
                    ...f.properties,
                    id: `CANAL-${i + 1}`,
                    nombre: f.properties?.NOMBRE || f.properties?.nombre || 'Canal Principal Conchos',
                    color: '#22d3ee',
                    longitud_km: 104,
                };
            });
        }

        const outputPath = path.join(GEO_DIR, `${outputName}.geojson`);
        fs.writeFileSync(outputPath, JSON.stringify(featureCollection, null, 2));
        console.log(`  ✅ → ${outputName}.geojson (${featureCollection.features.length} features, tipo: ${featureCollection.features[0]?.geometry?.type})\n`);

        // Mostrar campos encontrados
        if (featureCollection.features[0]?.properties) {
            const fields = Object.keys(featureCollection.features[0].properties);
            console.log(`  📋 Campos: ${fields.join(', ')}\n`);
        }

        return featureCollection;
    } catch (err) {
        console.error(`  ❌ Error:`, err.message);
        return null;
    }
}

async function main() {
    console.log('🗺️  Convertidor de Shapefiles → GeoJSON');
    console.log('═'.repeat(50));
    console.log(`📁 Directorio: ${GEO_DIR}\n`);

    // Listar archivos disponibles
    const files = fs.readdirSync(GEO_DIR);
    console.log('📄 Archivos encontrados:');
    files.forEach(f => console.log(`   • ${f}`));
    console.log('');

    // 1. Canal Principal Conchos
    await convertShapefile('Canal principal conchos.shp', 'canal_conchos');

    // 2. Polígonal Módulos
    await convertShapefile('poligonal modulos.shp', 'modulos');

    console.log('═'.repeat(50));

    // Listar archivos generados
    const geojsonFiles = fs.readdirSync(GEO_DIR).filter(f => f.endsWith('.geojson'));
    if (geojsonFiles.length) {
        console.log('📦 GeoJSON generados:');
        geojsonFiles.forEach(f => {
            const size = (fs.statSync(path.join(GEO_DIR, f)).size / 1024).toFixed(1);
            console.log(`   ✅ ${f} (${size} KB)`);
        });
    } else {
        console.log('⚠️  No se generaron archivos GeoJSON');
    }
}

main().catch(console.error);
