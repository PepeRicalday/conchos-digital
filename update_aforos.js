
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import crypto from 'crypto';

const envContent = fs.readFileSync('c:/Users/peper/Downloads/Antigravity/SICA 005/conchos-digital/.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    const value = rest.join('=');
    if (key && value) env[key.trim()] = value.trim().replace(/^"|"$/g, '');
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const newPoints = [
    { nombre_punto: 'K-0+603', latitud: 27.672117, longitud: -105.207161 },
    { nombre_punto: 'K-1+000', latitud: 27.676056, longitud: -105.204117 },
    { nombre_punto: 'K-2+476', latitud: 27.688214, longitud: -105.200753 },
    { nombre_punto: 'K-48+410', latitud: 28.011992, longitud: -105.324069 },
    { nombre_punto: 'K-48+430', latitud: 28.012244, longitud: -105.324386 },
    { nombre_punto: 'K-68+245', latitud: 28.130531, longitud: -105.397508 },
    { nombre_punto: 'K-0+110 DEL K-68', latitud: 28.134058, longitud: -105.398722 },
    { nombre_punto: 'K-72+008', latitud: 28.129872, longitud: -105.433289 },
    { nombre_punto: 'K-99+610', latitud: 28.158914, longitud: -105.618308 }
].map(p => ({
    ...p,
    id: crypto.randomUUID(),
    fecha: new Date().toISOString().split('T')[0]
}));

async function updateAforos() {
    try {
        console.log('Attempting to delete old records...');
        const { error: delError } = await supabase.from('aforos_control').delete().neq('id', '00000000-0000-0000-0000-000000000000');

        if (delError) {
            console.error('Delete error:', JSON.stringify(delError));
        } else {
            console.log('Old records deleted.');
        }

        console.log('Inserting new records...');
        const { data: insData, error: insError } = await supabase.from('aforos_control').insert(newPoints);

        if (insError) {
            console.error('Insert error:', JSON.stringify(insError));
        } else {
            console.log('Success! New points inserted:', newPoints.length);
        }
    } catch (err) {
        console.error('Catch error:', err.message);
    }
}

updateAforos();
