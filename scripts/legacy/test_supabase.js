require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .from('movimientos_presas')
    .select('*')
    .order('fecha_hora', { ascending: false })
    .limit(5);
  console.log("LAST 5 MOVIMIENTOS:");
  console.log(data);
}
run();
