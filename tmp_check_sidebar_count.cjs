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
    // Check all open tomas in points_entrega with latest measurement q > 0
    const { data: pe } = await supabase.from('puntos_entrega').select('id, nombre, mediciones(valor_q, fecha_hora)');
    let openPoints = [];
    pe.forEach(p => {
        const meds = (p.mediciones || []).sort((a,b) => new Date(b.fecha_hora) - new Date(a.fecha_hora));
        if (meds.length > 0 && meds[0].valor_q > 0) {
            openPoints.push({id: p.id, name: p.nombre, q: meds[0].valor_q});
        }
    });

    console.log(`DB Count: ${openPoints.length} tomas abiertas.`);
    console.log('List of open tomas:');
    openPoints.forEach(op => console.log(`- ${op.name} (${op.id}): ${op.q} m3/s`));

    // Specific check for the ones I deleted
    const { data: med113 } = await supabase.from('mediciones').select('*').eq('punto_id', 'PE-113');
    const { data: med123 } = await supabase.from('mediciones').select('*').eq('punto_id', 'PE-123');
    console.log('\nVerification of deleted IDs:');
    console.log('PE-113 records:', med113.length);
    console.log('PE-123 records:', med123.length);
}
run();
