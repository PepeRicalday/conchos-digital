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
    const { data } = await supabase.from('mediciones').select('id, fecha_hora, valor_q, estado_evento').eq('punto_id', 'PE-005').order('fecha_hora', {ascending: false}).limit(5);
    console.log('--- RECENT MEASUREMENTS PE-005 ---');
    data.forEach(m => {
        console.log(`${m.fecha_hora} | Q: ${m.valor_q} | Estado: ${m.estado_evento}`);
    });
}
run();
