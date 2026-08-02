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

async function checkResumen() {
    const today = '2026-03-05';
    console.log('Checking resumen_escalas_diario for', today);
    const { data, error } = await supabase
        .from('resumen_escalas_diario')
        .select('*')
        .eq('fecha', today);

    if (error) console.error(error);
    else console.log(`Found ${data.length} resumen records for today.`);

    if (data && data.length > 0) {
        console.log('Sample:', data[0]);
    }
}

checkResumen();
