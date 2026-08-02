const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
function loadEnv() {
    const envPath = path.join(process.cwd(), '.env.local');
    if (!fs.existsSync(envPath)) return {};
    const content = fs.readFileSync(envPath, 'utf8');
    const env = {};
    content.split('\n').map(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
            const key = parts[0].trim();
            let value = parts.slice(1).join('=').trim();
            if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
            env[key] = value;
        }
    }); return env;
}
const env = loadEnv();
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
async function run() {
    const { data: pe } = await supabase.from('puntos_entrega').select('id, nombre').ilike('nombre', '%41+912%');
    console.log("Punto de entrega 41+912:", pe);
    if (pe && pe.length > 0) {
        const pid = pe[0].id;
        const { data: rd } = await supabase.from('reportes_diarios').select('*').eq('punto_id', pid);
        console.log("reportes_diarios para 41+912:", rd);
        const { data: ro } = await supabase.from('reportes_operacion').select('*').eq('punto_id', pid);
        console.log("reportes_operacion para 41+912:", ro);
    }
}
run();
