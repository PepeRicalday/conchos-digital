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

async function checkEscalas() {
    const { data, count, error } = await supabase
        .from('puntos_entrega')
        .select('*', { count: 'exact' })
        .eq('tipo', 'escala');

    if (error) console.error(error);
    else {
        console.log('Total puntos_entrega con tipo=escala:', count);
        if (data && data.length > 0) {
            console.log('Sample escalas:', data.slice(0, 3));
        }
    }
}

checkEscalas();
