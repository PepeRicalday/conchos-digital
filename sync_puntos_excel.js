import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://dumfyrgwnshcgeibffvr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const filePath = './public/datos/puntos_entrega_rows validado.xlsx';

function getSeccionId(km) {
    if (km < 47.640) return 'SEC-001';
    if (km < 67.320) return 'SEC-002';
    if (km < 71.912) return 'SEC-003';
    return 'SEC-004';
}

async function sync() {
    try {
        console.log('Reading Excel file...');
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const excelRows = XLSX.utils.sheet_to_json(worksheet);

        console.log(`Processing ${excelRows.length} rows from Excel...`);

        const rowsToUpsert = excelRows.map(row => {
            const km = parseFloat(row.km);
            // Capacidad en el Excel parece estar en LPS, convertimos a m3/s dividiendo por 1000
            const capacidad = row.capacidad_max ? (parseFloat(row.capacidad_max) / 1000) : 0;

            return {
                id: row.id,
                modulo_id: row.modulo_id, // Usamos el modulo_id del Excel (e.g. MOD-001, MOD-005)
                nombre: row.nombre,
                km: km,
                tipo: row.tipo ? row.tipo.toLowerCase() : 'toma',
                capacidad_max: capacidad,
                coords_x: row.coords_x || null,
                coords_y: row.coords_y || null,
                zona: row.zona || null,
                seccion_texto: row.seccion_texto || null,
                seccion_id: getSeccionId(km)
            };
        });

        console.log('Upserting to Supabase...');
        const { data, error } = await supabase
            .from('puntos_entrega')
            .upsert(rowsToUpsert, { onConflict: 'id' });

        if (error) {
            console.error('Error in upsert:', error);
            return;
        }

        console.log(`Successfully upserted ${rowsToUpsert.length} rows.`);

        // Opcional: Eliminar puntos que no están en el Excel (Sustitución completa)
        console.log('Checking for rows to remove (not in Excel)...');
        const excelIds = rowsToUpsert.map(r => r.id);

        // Obtenemos todos los IDs actuales para comparar
        const { data: currentRows, error: fetchError } = await supabase
            .from('puntos_entrega')
            .select('id');

        if (fetchError) {
            console.error('Error fetching current rows:', fetchError);
        } else {
            const idsToRemove = currentRows
                .map(r => r.id)
                .filter(id => !excelIds.includes(id));

            if (idsToRemove.length > 0) {
                console.log(`Removing ${idsToRemove.length} rows not present in Excel...`);
                // Nota: Podría fallar si hay mediciones vinculadas a estos IDs.
                const { error: deleteError } = await supabase
                    .from('puntos_entrega')
                    .delete()
                    .in('id', idsToRemove);

                if (deleteError) {
                    console.error('Error deleting old rows:', deleteError);
                    console.log('Some rows could not be deleted, likely due to foreign key constraints (existing measurements).');
                } else {
                    console.log(`Successfully removed ${idsToRemove.length} obsolete rows.`);
                }
            } else {
                console.log('No obsolete rows to remove.');
            }
        }

        console.log('Sync process completed.');
    } catch (error) {
        console.error('Sync failed:', error);
    }
}

sync();
