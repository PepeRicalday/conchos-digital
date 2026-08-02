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

async function checkReportes() {
    const { data: reportes, error } = await supabase
        .from('reportes_diarios')
        .select('modulo_id, fecha, volumen_total_mm3');
    
    if (error) {
        console.error(error);
        return;
    }

    console.log(`Found ${reportes.length} reportes_diarios`);
    const countByModulo = {};
    let totalVol = 0;
    reportes.forEach(r => {
        countByModulo[r.modulo_id] = (countByModulo[r.modulo_id] || 0) + 1;
        if(r.fecha >= '2026-03-16' && r.fecha <= '2026-03-22') {
            totalVol += r.volumen_total_mm3 || 0;
        }
    });

    console.log(countByModulo);
    console.log("Total Vol in this week from reportes: ", totalVol);
}

checkReportes();
