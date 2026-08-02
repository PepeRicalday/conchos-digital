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

async function checkGranja() {
    // Buscar punto de entrega
    const { data: puntos } = await supabase
        .from('puntos_entrega')
        .select('id, nombre')
        .ilike('nombre', '%Granja%');

    console.log('Puntos encontrados:', puntos);

    if (puntos && puntos.length > 0) {
        const puntoId = puntos[0].id;

        // Ver mediciones
        const { data: mediciones } = await supabase
            .from('mediciones')
            .select('*')
            .eq('punto_id', puntoId)
            .order('fecha_hora', { ascending: false })
            .limit(10);

        console.log('\nÚltimas 10 mediciones de', puntos[0].nombre, ':');
        console.log(mediciones);

        // Ver reportes_operacion
        const { data: reportes } = await supabase
            .from('reportes_operacion')
            .select('*')
            .eq('punto_id', puntoId)
            .order('fecha', { ascending: false })
            .limit(5);

        console.log('\nÚltimos 5 reportes de operación:', reportes);
    }
}

checkGranja();
