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

async function checkMarch3() {
    const day = '2026-03-03';
    console.log('Checking reportes_operacion for', day);
    const { data: repData, error: repErr } = await supabase
        .from('reportes_operacion')
        .select('punto_id, estado, caudal_promedio')
        .eq('fecha', day);

    if (repErr) {
        console.error('Error:', repErr);
        return;
    }

    console.log(`Found ${repData.length} records for ${day}.`);
}

checkMarch3();
