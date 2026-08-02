import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Helper to read .env.local manually since we don't have dotenv
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

async function checkData() {
    const today = '2026-03-05';
    console.log('Checking reportes_operacion for', today);
    const { data: repData, error: repErr } = await supabase
        .from('reportes_operacion')
        .select('id, punto_id, fecha, estado, caudal_promedio')
        .eq('fecha', today);

    if (repErr) console.error('Error fetching reportes_operacion:', repErr);
    else console.log(`Found ${repData.length} reports for today.`);

    console.log('\nChecking lecturas_escalas for', today);
    const { data: escData, error: escErr } = await supabase
        .from('lecturas_escalas')
        .select('id, escala_id, fecha, nivel_m')
        .eq('fecha', today);

    if (escErr) console.error('Error fetching lecturas_escalas:', escErr);
    else console.log(`Found ${escData.length} scale readings for today.`);

    if (repData && repData.length > 0) {
        console.log('\nSample reports:', repData.slice(0, 3));
    }
}

checkData();
