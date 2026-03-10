
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

async function main() {
    const { data: escalas, error } = await supabase
        .from('escalas')
        .select('id, nombre, km')
        .order('km', { ascending: true });

    if (error) {
        console.error('Error fetching escalas:', error);
        return;
    }

    console.log('--- ESCALAS (CONTROL POINTS) ---');
    escalas.forEach(e => console.log(`KM ${e.km}: ${e.nombre} (ID: ${e.id})`));
}

main();
