import XLSX from 'xlsx';
import fs from 'fs';

const filePath = 'c:\\Users\\peper\\Downloads\\Antigravity\\SICA 005\\conchos-digital\\public\\datos\\puntos_entrega_rows validado.xlsx';
const outputSql = 'c:\\Users\\peper\\Downloads\\Antigravity\\SICA 005\\conchos-digital\\supabase\\migrations\\20260320212000_actualizacion_puntos_entrega.sql';

try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    if (rows.length < 2) {
        console.error('No data found in sheet');
        process.exit(1);
    }

    const headers = rows[0].map(h => (h || '').toString().trim());
    const dataRows = rows.slice(1);

    const getCol = (name) => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());

    const idxId = getCol('id');
    const idxModulo = getCol('modulo_id');
    const idxNombre = getCol('nombre');
    const idxKm = getCol('km');
    const idxTipo = getCol('tipo');
    const idxCapMax = getCol('capacidad_max');
    const idxX = getCol('coords_x');
    const idxY = getCol('coords_y');
    const idxSeccion = getCol('seccion_id');
    const idxZona = getCol('zona') !== -1 ? getCol('zona') : getCol('capacidad_max_lps'); // Fallback to capacidad_max_lps if zona missing

    let sql = `-- Actualización de Puntos de Entrega (Tomas / Laterales)\n`;
    sql += `-- Generado automáticamente desde Excel el ${new Date().toISOString()}\n\n`;
    
    // Using ON CONFLICT to update existing points
    sql += `INSERT INTO public.puntos_entrega (
        id, modulo_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, seccion_id, zona
    ) VALUES \n`;

    const valuesMap = new Map();

    dataRows.forEach((row, i) => {
        if (!row[idxId] && !row[idxNombre]) return; // Skip truly empty rows

        const id = (row[idxId] || `PE-AUTO-${i}`).toString().replace(/'/g, "''").trim();
        const m_id = (row[idxModulo] || 'MOD-001').toString().replace(/'/g, "''").trim();
        const name = (row[idxNombre] || 'Punto de Entrega').toString().replace(/'/g, "''").trim();
        const km = parseFloat(row[idxKm]) || 0;
        
        let rawTipo = (row[idxTipo] || 'toma').toString().toLowerCase().trim();
        let tipo = 'toma'; // default
        if (rawTipo.includes('lateral')) tipo = 'lateral';
        else if (rawTipo.includes('carcamo')) tipo = 'carcamo';
        else if (rawTipo.includes('bombeo')) tipo = 'toma';
        else if (rawTipo.includes('represa')) tipo = 'toma';
        else if (rawTipo.includes('toma')) tipo = 'toma';

        const cap = parseFloat(row[idxCapMax]) || 0;
        const x = parseFloat(row[idxX]) || null;
        const y = parseFloat(row[idxY]) || null;
        const sec = (row[idxSeccion] || null);
        const zona = (row[idxZona] || null);

        const val = `('${id}', '${m_id}', '${name}', ${km}, '${tipo}', ${cap}, ${x !== null ? x : 'NULL'}, ${y !== null ? y : 'NULL'}, ${sec !== null ? `'${sec}'` : 'NULL'}, ${zona !== null ? `'${zona}'` : 'NULL'})`;
        valuesMap.set(id, val);
    });

    const uniqueValues = Array.from(valuesMap.values());
    sql += uniqueValues.join(',\n') + '\n';
    sql += `ON CONFLICT (id) DO UPDATE SET
        modulo_id = EXCLUDED.modulo_id,
        nombre = EXCLUDED.nombre,
        km = EXCLUDED.km,
        tipo = EXCLUDED.tipo,
        capacidad_max = EXCLUDED.capacidad_max,
        coords_x = EXCLUDED.coords_x,
        coords_y = EXCLUDED.coords_y,
        seccion_id = EXCLUDED.seccion_id,
        zona = EXCLUDED.zona;\n`;

    fs.writeFileSync(outputSql, sql);
    console.log(`Generated migration: ${outputSql} with ${uniqueValues.length} delivery points.`);
} catch (error) {
    console.error('Error synchronizing puntos_entrega:', error);
}
