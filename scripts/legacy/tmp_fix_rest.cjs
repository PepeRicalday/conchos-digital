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
    console.log("Fetching rollover records for today...");
    const { data: records, error: fetchError } = await supabase
        .from('mediciones')
        .select('*')
        .eq('notas', 'Evento automático: Continuidad de medianoche (Rollover)')
        .order('fecha_hora', { ascending: false });

    if (fetchError) {
        console.error("Error fetching records:", fetchError);
        return;
    }

    console.log(`Found ${records?.length || 0} records to fix.`);
    
    for (const record of (records || [])) {
        // Adjust to local midnight (e.g. 2026-03-18 06:00 UTC)
        // Note: We need to know the correct UTC offset. Assuming UTC-6 (Mountain Standard Time / Chihuahua)
        const datePart = new Date(record.fecha_hora).toISOString().split('T')[0];
        const localMidnightUTC = `${datePart}T06:00:00Z`; 

        const { error: updateError } = await supabase
            .from('mediciones')
            .update({
                estado_evento: 'continua',
                fecha_hora: localMidnightUTC,
                notas: 'Evento corregido: Continuidad de medianoche (FIX Label & Time)'
            })
            .eq('id', record.id);

        if (updateError) {
            console.error(`Error updating record ${record.id}:`, updateError);
        } else {
            console.log(`Fixed record ${record.id} for point ${record.punto_id}`);
        }
    }
}
run();
