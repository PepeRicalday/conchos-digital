
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTable() {
    const { data, error } = await supabase
        .from('sica_llenado_seguimiento')
        .select('*')
        .limit(1);
    
    if (error) {
        console.error('Error selecting from sica_llenado_seguimiento:', error);
    } else {
        console.log('Success selecting from sica_llenado_seguimiento. Columns:', data.length > 0 ? Object.keys(data[0]) : 'No data');
    }

    // Try to get column list from information_schema via RPC if possible, 
    // but usually select * is enough to see if it fails.
}

checkTable();
