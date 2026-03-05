
import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

// Configuración de entorno
const envContent = fs.readFileSync('c:/Users/peper/Downloads/Antigravity/SICA 005/conchos-digital/.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    const value = rest.join('=');
    if (key && value) env[key.trim()] = value.trim().replace(/^"|"$/g, '');
});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

const EXCEL_PATH = 'c:/Users/peper/Downloads/Antigravity/SICA 005/conchos-digital/documentos/Canal Conchos.xlsx';

async function importExcel() {
    if (!fs.existsSync(EXCEL_PATH)) {
        console.error(`Error: No se encontró el archivo en ${EXCEL_PATH}`);
        console.log('Generando archivo de ejemplo...');
        generateExampleExcel();
        return;
    }

    console.log('Leyendo Excel...');
    const workbook = XLSX.readFile(EXCEL_PATH);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    console.log(`Procesando ${data.length} tramos...`);

    const formattedData = data.map(item => {
        // Extraer KM de strings como "K-0+000" o " K-2+000"
        const parseKm = (val) => {
            if (typeof val === 'number') return val;
            if (typeof val !== 'string') return 0;
            const matches = val.match(/K-(\d+)\+(\d+)/);
            if (matches) return parseFloat(matches[1]) + (parseFloat(matches[2]) / 1000);
            return parseFloat(val.replace(/[^\d.]/g, '')) || 0;
        };

        return {
            km_inicio: parseKm(item["INICIAL KM"]),
            km_fin: parseKm(item["FINAL KM"]),
            nombre_tramo: item["NOMBRE  DE  LA  OBRA"] || 'Sin Nombre',
            plantilla_m: parseFloat(item["ANCHO DE PLANTILLA  (b)"]),
            talud_z: parseFloat(item["TALUDES"]),
            rugosidad_n: 0.015, // Por defecto si no viene
            pendiente_s0: parseFloat(item["PENDIENTES ( s )"]),
            tirante_diseno_m: parseFloat(item["TIRANTE NORMAL (d)   "]),
            capacidad_diseno_m3s: parseFloat(item["GASTO (Q) max"]),
            ancho_corona_m: parseFloat(item["ANCHO DE CORONA (C)  "]),
            bordo_libre_m: parseFloat(item["LIBRE BORDO    (l.b.)"]),
            velocidad_diseno_ms: parseFloat(item["VELOCIDAD MEDIA (V)                       "])
        };
    });

    console.log('Limpiando base de datos anterior...');
    await supabase.from('perfil_hidraulico_canal').delete().neq('km_inicio', -1);

    console.log('Subiendo nuevos datos...');
    const { error } = await supabase.from('perfil_hidraulico_canal').insert(formattedData);

    if (error) {
        console.error('Error al subir:', error.message);
    } else {
        console.log('¡Sincronización exitosa!');
    }
}

function generateExampleExcel() {
    const dir = path.dirname(EXCEL_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const ws_data = [
        [
            "km_inicio", "km_fin", "nombre_tramo", "plantilla_m", "talud_z",
            "rugosidad_n", "pendiente_s0", "tirante_diseno_m", "capacidad_diseno_m3s",
            "ancho_corona_m", "bordo_libre_m", "velocidad_diseno_ms"
        ],
        [0, 23.5, "Tramo Inicial - Boquilla", 12.0, 1.5, 0.015, 0.0003, 3.5, 60.0, 4.0, 0.8, 1.2],
        [23.5, 45.2, "Tramo Medio", 10.0, 1.25, 0.015, 0.0004, 3.2, 55.0, 4.0, 0.8, 1.1]
    ];
    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Canal_Perfil");
    XLSX.writeFile(wb, EXCEL_PATH);
    console.log(`Archivo de ejemplo creado en: ${EXCEL_PATH}`);
}

importExcel();
