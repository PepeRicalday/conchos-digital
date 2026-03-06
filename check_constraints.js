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

async function checkIndex() {
    const { data, error } = await supabase.rpc('get_table_constraints', { table_name: 'resumen_escalas_diario' });
    if (error) {
        // Fallback: try to insert a duplicate and see if it fails
        console.log('Constraints check via RPC failed. Trying manual experiment...');
        const { error: err2 } = await supabase.from('resumen_escalas_diario').insert({
            escala_id: 'ESC-001',
            fecha: '2025-12-15',
            nombre: 'TEST'
        });
        if (err2) console.log('Duplicate insert failed as expected:', err2.message);
        else console.log('Duplicate insert succeeded. No unique constraint on (escala_id, fecha)?');
    } else {
        console.log('Constraints:', data);
    }
}

checkIndex();
