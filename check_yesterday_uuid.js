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

async function checkYesterdayValid() {
    const yesterday = '2026-03-04';
    console.log('Checking OPEN reports with VALID UUID for', yesterday);
    const { data, error } = await supabase
        .from('reportes_operacion')
        .select('punto_id, estado, caudal_promedio')
        .eq('fecha', yesterday);

    if (error) {
        console.error(error);
        return;
    }

    const validUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const openValid = data.filter(r =>
        validUUID.test(r.punto_id) &&
        !['cierre', 'suspension'].includes(r.estado) &&
        r.caudal_promedio > 0
    );

    console.log(`Found ${openValid.length} VALID UUID open reports yesterday.`);
    if (openValid.length > 0) {
        console.log('Sample:', openValid.slice(0, 3));
    } else {
        console.log('All records found yesterday:', data);
    }
}

checkYesterdayValid();
