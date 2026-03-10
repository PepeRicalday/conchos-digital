import XLSX from 'xlsx';
import fs from 'fs';

const filePath = 'c:\\Users\\peper\\Downloads\\Antigravity\\SICA 005\\conchos-digital\\public\\datos\\Canal Conchos.xlsx';
const outputSql = 'c:\\Users\\peper\\Downloads\\Antigravity\\SICA 005\\conchos-digital\\supabase\\migrations\\20260309191000_actualizacion_canal_conchos.sql';

function parseKM(val) {
    if (val === undefined || val === null) return null;
    let s = val.toString().trim().toUpperCase().replace(/,/g, '');
    if (s.startsWith('K-')) s = s.substring(2);
    if (s.includes('+')) {
        const parts = s.split('+');
        return parseFloat(parts[0] || 0) + parseFloat(parts[1] || 0) / 1000;
    }
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
}

try {
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // 1. Find Header Index
    let headerIdx = -1;
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].some(c => c && c.toString().includes('INICIAL KM'))) {
            headerIdx = i;
            break;
        }
    }

    if (headerIdx === -1) {
        console.error('Could not find header row');
        process.exit(1);
    }

    const headers = rows[headerIdx].map(h => (h || '').toString().trim());
    const dataRows = rows.slice(headerIdx + 1);

    const getCol = (name) => headers.findIndex(h => h.toUpperCase().includes(name.toUpperCase()));

    const idxInicio = getCol('INICIAL KM');
    const idxFin = getCol('FINAL KM');
    const idxName = getCol('NOMBRE DE LA OBRA');
    const idxQ = getCol('GASTO');
    const idxB = getCol('ANCHO DE PLANTILLA');
    const idxS = getCol('PENDIENTES');
    const idxD = getCol('TIRANTE NORMAL');
    const idxZ = getCol('TALUDES');
    const idxC = getCol('ANCHO DE CORONA');
    const idxLB = getCol('LIBRE BORDO');
    const idxV = getCol('VELOCIDAD');

    let sql = `-- Actualización de Perfil Hidráulico del Canal Principal Conchos\n`;
    sql += `-- Generado automáticamente el ${new Date().toISOString()}\n\n`;
    sql += `DELETE FROM public.perfil_hidraulico_canal;\n\n`;

    dataRows.forEach((row, i) => {
        if (i < 5) console.log(`Raw KM[${i}]:`, row[idxInicio], typeof row[idxInicio]);
        const km_inicio = parseKM(row[idxInicio]);
        const km_fin = parseKM(row[idxFin]);

        if (km_inicio === null) return; // Skip empty/invalid rows

        const name = (row[idxName] || 'Tramo Canal').toString().replace(/'/g, "''").trim();
        const q = parseFloat(row[idxQ]) || 0;
        const b = parseFloat(row[idxB]) || 0;
        const s = parseFloat(row[idxS]) || 0;
        const d = parseFloat(row[idxD]) || 0;
        const z = parseFloat(row[idxZ]) || 0;
        const c = parseFloat(row[idxC]) || 0;
        const lb = parseFloat(row[idxLB]) || 0;
        const v = parseFloat(row[idxV]) || 0;

        sql += `INSERT INTO public.perfil_hidraulico_canal (
            km_inicio, km_fin, nombre_tramo, capacidad_diseno_m3s, plantilla_m, 
            pendiente_s0, tirante_diseno_m, talud_z, ancho_corona_m, bordo_libre_m, 
            velocidad_diseno_ms
        ) VALUES (
            ${km_inicio}, ${km_fin || 'NULL'}, '${name}', ${q}, ${b}, 
            ${s}, ${d}, ${z}, ${c}, ${lb}, ${v}
        );\n`;
    });

    fs.writeFileSync(outputSql, sql);
    console.log(`Generated migration: ${outputSql} with ${dataRows.length} rows.`);
} catch (error) {
    console.error('Error:', error);
}
