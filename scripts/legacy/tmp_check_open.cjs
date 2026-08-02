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
    const { data: pe } = await supabase.from('puntos_entrega').select('id, nombre, mediciones(valor_q, fecha_hora)');
    let openPoints = [];
    pe.forEach(p => {
        const meds = (p.mediciones || []).sort((a,b) => new Date(b.fecha_hora) - new Date(a.fecha_hora));
        if (meds.length > 0 && Number(meds[0].valor_q) > 0) {
            openPoints.push({id: p.id, name: p.nombre, q: meds[0].valor_q, date: meds[0].fecha_hora});
        }
    });

    console.log(`Total Open: ${openPoints.length}`);
    openPoints.forEach(p => {
        console.log(`${p.id} | ${p.name.padEnd(25)} | Q: ${p.q} | Date: ${p.date}`);
    });
}
run();
