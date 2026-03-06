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

async function checkIds() {
    const { data, error } = await supabase
        .from('lecturas_escalas')
        .select('id')
        .order('id', { ascending: false })
        .limit(20);

    if (error) console.error(error);
    else console.log('Top IDs:', data.map(d => d.id));
}

checkIds();
