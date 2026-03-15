const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'c:/Users/peper/Downloads/Antigravity/SICA 005/conchos-digital/.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function checkReadings() {
    console.log("--- RECENT SCALE READINGS ---");
    const { data: readings, error: rError } = await supabase
        .from('sica_mediciones_escalas')
        .select('*, escalas(nombre, km)')
        .order('created_at', { ascending: false })
        .limit(10);
    
    if (rError) console.error(rError);
    else console.table(readings.map(r => ({
        id: r.id,
        escala: r.escalas?.nombre,
        km: r.escalas?.km,
        nivel: r.nivel_m,
        apertura: r.apertura_radiales_m,
        fecha: r.fecha,
        hora: r.hora_lectura
    })));

    console.log("\n--- ACTIVE LLENADO TRACKING ---");
    const { data: events } = await supabase.from('sica_eventos_hidrologicos').select('*').eq('estado', 'ACTIVO').single();
    if (events) {
        console.log("Active Event:", events.nombre, "Started:", events.hora_apertura_real);
        const { data: track } = await supabase
            .from('sica_llenado_seguimiento')
            .select('*')
            .eq('evento_id', events.id)
            .order('km', { ascending: true });
        console.table(track);
    }
}

checkReadings();
