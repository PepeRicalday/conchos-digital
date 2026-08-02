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

async function checkReportesSemana() {
    const { data: reportes, error } = await supabase
        .from('reportes_diarios')
        .select('modulo_id, fecha, volumen_total_mm3')
        .gte('fecha', '2026-03-16')
        .lte('fecha', '2026-03-22');
    
    if (error) {
        console.error(error);
        return;
    }

    console.log("Reportes de esta semana:", reportes.length);
    console.log(reportes);
}

checkReportesSemana();
