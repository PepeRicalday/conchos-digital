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
    const today = '2026-03-18';

    console.log('--- REVISIÓN DE REGISTROS PARA PE-113 y PE-123 ---');

    for (const pid of points) {
        console.log(`\n>>> Punto: ${pid}`);
        
        const { data: med } = await supabase.from('mediciones').select('id, fecha_hora, valor_q').eq('punto_id', pid);
        console.log(`Mediciones: ${med?.length || 0} registros`);
        med?.forEach(m => console.log(`  - ${m.fecha_hora} | Q: ${m.valor_q}`));

        const { data: rd } = await supabase.from('reportes_diarios').select('id, fecha, volumen_total_mm3').eq('punto_id', pid);
        console.log(`Reportes Diarios: ${rd?.length || 0} registros`);
        rd?.forEach(r => console.log(`  - ${r.fecha} | Vol: ${r.volumen_total_mm3}`));

        const { data: ro } = await supabase.from('reportes_operacion').select('id, fecha, estado').eq('punto_id', pid);
        console.log(`Reportes Operación: ${ro?.length || 0} registros`);
        ro?.forEach(r => console.log(`  - ${r.fecha} | Estado: ${r.estado}`));
    }
}
run();
