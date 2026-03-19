const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
function loadEnv() {
    const envPath = path.join(process.cwd(), '.env.local');
    const content = fs.readFileSync(envPath, 'utf8');
    const env = {};
    content.split('\n').forEach(line => {
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
    const { data } = await supabase.from('lecturas_escalas')
        .select('escala_id, gasto_calculado_m3s, fecha, creado_en')
        .eq('escala_id', 'ESC-013')
        .order('creado_en', { ascending: false })
        .limit(5);
    console.log(JSON.stringify(data));
}
run();
