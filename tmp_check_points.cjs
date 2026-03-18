const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function loadEnv() {
    const envPath = path.join(__dirname, '.env.local');
    if (!fs.existsSync(envPath)) return {};
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
    });
    return env;
}

const env = loadEnv();
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkModulesWithPoints() {
    const { data: modulos, error } = await supabase
        .from('modulos')
        .select(`
            id, 
            nombre, 
            codigo_corto,
            puntos_entrega (id)
        `);
    
    if (error) {
        console.error(error);
        return;
    }

    console.log('--- Database Check: Modules & Points ---');
    modulos.forEach(m => {
        console.log(`- ${m.codigo_corto} (${m.id}): ${m.nombre} - ${m.puntos_entrega.length} points`);
    });
}

checkModulesWithPoints();
