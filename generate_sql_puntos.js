import XLSX from 'xlsx';
import fs from 'fs';

const filePath = './public/datos/puntos_entrega_rows validado.xlsx';
const outputSql = './insert_puntos_entrega_v2.sql';

function getSeccionId(km) {
    if (km < 47.640) return 'SEC-001';
    if (km < 67.320) return 'SEC-002';
    if (km < 71.912) return 'SEC-003';
    return 'SEC-004';
}

function normalizeTipo(tipo) {
    if (!tipo) return 'toma';
    const t = tipo.toLowerCase().trim();
    if (t === 'lateral') return 'lateral';
    if (t === 'bombeo' || t === 'carcamo') return 'carcamo';
    return 'toma';
}

function sqlVal(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
    return val;
}

async function generate() {
    try {
        console.log('Reading Excel file...');
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const excelRows = XLSX.utils.sheet_to_json(worksheet);

        console.log(`Processing ${excelRows.length} rows...`);

        let sql = '-- SICA 005: Actualización de Puntos de Entrega desde Excel\n';
        sql += '-- Generado el: ' + new Date().toLocaleString() + '\n\n';

        sql += 'BEGIN;\n\n';

        // Opcional: Si el usuario quiere "sustituir" todo, podríamos borrar primero.
        // Pero es más seguro hacer upsert y luego borrar lo sobrante.
        // sql += 'DELETE FROM public.puntos_entrega WHERE true; -- Cuidado con esto si hay mediciones\n\n';

        const excelIds = [];

        excelRows.forEach(row => {
            const km = parseFloat(row.km) || 0;
            // Sanitización de valores numéricos para SQL
            const rawCapacidad = parseFloat(row.capacidad_max);
            const capacidad = !isNaN(rawCapacidad) ? (rawCapacidad / 1000) : 0;
            
            const rawX = parseFloat(row.coords_x);
            const x = !isNaN(rawX) ? rawX : null;
            
            const rawY = parseFloat(row.coords_y);
            const y = !isNaN(rawY) ? rawY : null;

            const tipo = normalizeTipo(row.tipo);
            const seccionId = getSeccionId(km);
            const id = row.id || `PE-${Math.random().toString(36).substr(2, 5)}`; 
            excelIds.push(id);

            sql += `INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES (${sqlVal(id)}, ${sqlVal(row.modulo_id)}, ${sqlVal(seccionId)}, ${sqlVal(row.nombre)}, ${km}, ${sqlVal(tipo)}, ${capacidad}, ${sqlVal(x)}, ${sqlVal(y)}, ${sqlVal(row.zona)}, ${sqlVal(row.seccion_texto)})
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;\n`;
        });

        sql += '\n-- Eliminar registros que NO están en el Excel (Sustitución)\n';
        sql += `-- DELETE FROM public.puntos_entrega WHERE id NOT IN (${excelIds.map(id => `'${id}'`).join(', ')});\n`;
        sql += '-- Nota: El DELETE está comentado por seguridad. Si estás seguro, descoméntalo antes de ejecutar.\n\n';

        sql += 'COMMIT;';

        fs.writeFileSync(outputSql, sql, 'utf8');
        console.log(`SQL generated to ${outputSql}`);
        console.log(`Total rows processed: ${excelRows.length}`);
    } catch (error) {
        console.error('Generation failed:', error);
    }
}

generate();
