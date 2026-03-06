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

async function checkPoints() {
    const { count, error } = await supabase
        .from('puntos_entrega')
        .select('*', { count: 'exact', head: true });

    if (error) console.error(error);
    else console.log('Total puntos_entrega:', count);

    const { data: scales, error: err2 } = await supabase
        .from('escalas')
        .select('id', { count: 'exact', head: true });

    if (err2) console.error(err2);
    else console.log('Total escalas:', scales ? scales.length : 0);
}

checkPoints();
