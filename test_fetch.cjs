require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const today = '2026-02-24';
    console.log('Querying reportes_diarios for', today);
    const { data: reportesHoy, error } = await supabase
        .from('reportes_diarios')
        .select('punto_id, modulo_id, volumen_total_mm3, caudal_promedio_lps')
        .eq('fecha', today);

    console.log('reportes_diarios error:', error);
    console.log('reportes_diarios data:', reportesHoy);

    console.log('Querying reportes_operacion for', today);
    const { data: opData, error: opErr } = await supabase
        .from('reportes_operacion')
        .select('punto_id, caudal_promedio, volumen_acumulado, hora_apertura, estado')
        .eq('fecha', today);

    console.log('reportes_operacion error:', opErr);
    console.log('reportes_operacion data:', opData);
}

run();
