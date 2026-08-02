const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkModulos() {
    const { data, error } = await supabase.from('modulos').select('*');
    if (error) {
        console.error(error);
        return;
    }
    console.log('Modulos found:', data.length);
    console.log(JSON.stringify(data, null, 2));
}

checkModulos();
