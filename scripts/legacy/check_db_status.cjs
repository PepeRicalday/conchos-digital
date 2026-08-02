const { createClient } = require('@supabase/supabase-js');

const supabase = createClient('https://dumfyrgwnshcgeibffvr.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY');

async function checkReadings() {
    console.log("--- RECENT SCALE READINGS ---");
    const { data: readings, error: rError } = await supabase
        .from('sica_mediciones_escalas')
        .select('*, escalas(nombre, km)')
        .order('created_at', { ascending: false })
        .limit(10);
    
    if (rError) {
        console.error(rError);
        return;
    }
    
    console.table(readings.map(r => ({
        id: r.id,
        escala: r.escalas?.nombre,
        km: r.escalas?.km,
        nivel: r.nivel_m,
        apertura: r.apertura_radiales_m,
        fecha: r.fecha,
        hora: r.hora_lectura,
        timestamp: r.created_at
    })));

    console.log("\n--- ACTIVE LLENADO TRACKING ---");
    const { data: events } = await supabase.from('sica_eventos_hidrologicos').select('*').eq('estado', 'ACTIVO').maybeSingle();
    if (events) {
        console.log("Active Event:", events.nombre, "Started:", events.hora_apertura_real);
        const { data: track } = await supabase
            .from('sica_llenado_seguimiento')
            .select('*')
            .eq('evento_id', events.id)
            .order('km', { ascending: true });
        console.table(track);
    } else {
        console.log("No active event found.");
    }
}

checkReadings();
