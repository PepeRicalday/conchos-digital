import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length === 2) {
        env[parts[0].trim()] = parts[1].trim().replace(/"/g, '');
    }
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function listTables() {
    // There is no easy table listing in supabase-js, so we'll try to query some known tables
    const tables = ['escalas', 'reportes_operacion', 'puntos_entrega', 'resumen_escalas_diario', 'lecturas_escalas'];
    for (const table of tables) {
        try {
            const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
            if (error) console.log(`Table ${table}: NOT FOUND or Error: ${error.message}`);
            else console.log(`Table ${table}: FOUND with ${count} records.`);
        } catch (e) {
            console.log(`Table ${table}: ERROR ${e.message}`);
        }
    }
}

listTables();
