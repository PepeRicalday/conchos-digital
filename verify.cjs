require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const today = new Date().toLocaleDateString('en-CA'); // Gets YYYY-MM-DD in local timezone
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');

    console.log('Querying reportes_operacion for yesterday:', yesterday);
    const { data: yData, error: yErr } = await supabase
        .from('reportes_operacion')
        .select('*, puntos_entrega(nombre)')
        .eq('fecha', yesterday);

    console.log('Yesterday error:', yErr);
    console.log('Yesterday closed data (first 3):', yData ? yData.filter(d => d.estado === 'cierre').slice(0, 3) : []);

    console.log('\nQuerying reportes_operacion for today:', today);
    const { data: tData, error: tErr } = await supabase
        .from('reportes_operacion')
        .select('*, puntos_entrega(nombre)')
        .eq('fecha', today);

    console.log('Today error:', tErr);
    console.log('Today data (first 3):', tData ? tData.slice(0, 3) : []);

    console.log('\nCounting records:');
    console.log(`Yesterday (${yesterday}): ${yData ? yData.length : 0} records`);
    console.log(`Today (${today}): ${tData ? tData.length : 0} records`);
}

run();
