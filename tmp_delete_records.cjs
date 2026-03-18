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
    const points = ['PE-113', 'PE-123'];
    
    for (const pid of points) {
        console.log(`Borrando información para ${pid}...`);
        
        const { error: medError } = await supabase.from('mediciones').delete().eq('punto_id', pid);
        if (medError) console.error(`Error en mediciones (${pid}):`, medError);
        else console.log(`- Mediciones de ${pid} eliminadas.`);

        const { error: rdError } = await supabase.from('reportes_diarios').delete().eq('punto_id', pid);
        const { error: roError } = await supabase.from('reportes_operacion').delete().eq('punto_id', pid);
        
        console.log(`- Limpieza de reportes para ${pid} completada.`);
    }
}
run();
