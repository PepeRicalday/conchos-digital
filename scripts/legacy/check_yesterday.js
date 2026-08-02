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

async function checkYesterday() {
    const yesterday = '2026-03-04';
    console.log('Checking reportes_operacion for', yesterday);
    const { data: repData, error: repErr } = await supabase
        .from('reportes_operacion')
        .select('punto_id, estado, caudal_promedio')
        .eq('fecha', yesterday);

    if (repErr) {
        console.error('Error:', repErr);
        return;
    }

    console.log(`Found ${repData.length} records for yesterday.`);
    const open = repData.filter(r => !['cierre', 'suspension'].includes(r.estado) && r.caudal_promedio > 0);
    console.log(`Found ${open.length} OPEN records for yesterday with flow > 0.`);

    if (open.length > 0) {
        console.log('Sample open records:', open.slice(0, 5));
    }
}

checkYesterday();
