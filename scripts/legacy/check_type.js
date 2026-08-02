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

async function checkColTypes() {
    // We can use a trick: try to cast a non-uuid to uuid in a query and see if it errors at DB level
    const { data, error } = await supabase.rpc('get_column_type', { t_name: 'puntos_entrega', c_name: 'id' });
    if (error) {
        // Another trick: select a row and check the type in JS (it won't tell us DB type though)
        // Better: Query information_schema
        const { data: data2, error: err2 } = await supabase
            .from('puntos_entrega')
            .select('id')
            .limit(1);

        console.log('Sample ID:', data2[0].id, 'Type of:', typeof data2[0].id);
    } else {
        console.log('Type reported by RPC:', data);
    }
}

checkColTypes();
