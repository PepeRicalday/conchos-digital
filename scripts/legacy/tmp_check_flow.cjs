const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function loadEnv() {
    const envPath = path.join(__dirname, '.env.local');
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
    });
    return env;
}

const env = loadEnv();
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function checkFlow() {
    console.log('Today:', new Date().toISOString().split('T')[0]);
    
    const { data: mediciones } = await supabase
        .from('mediciones')
        .select('punto_id, valor_q, valor_vol, fecha_hora')
        .order('fecha_hora', { ascending: false });

    // Group to latest per punto
    const latest = {};
    mediciones.forEach(m => {
        if (!latest[m.punto_id]) {
            latest[m.punto_id] = m;
        }
    });

    let q = 0;
    for (const [id, m] of Object.entries(latest)) {
        if (m.valor_q > 0) {
            console.log(`Punto ${id}: Q=${m.valor_q}, Vol=${m.valor_vol}, date=${m.fecha_hora}`);
            q += Number(m.valor_q);
        }
    }
    console.log("Total Flow (m3/s):", q);
}

checkFlow();
