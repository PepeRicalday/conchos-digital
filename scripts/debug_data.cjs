const { createClient } = require('@supabase/supabase-js');

const supabase = createClient('https://dumfyrgwnshcgeibffvr.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY');

async function check() {
    console.log("--- Resumen para hoy 2026-03-16 ---");
    const { data: res, error: err } = await supabase
        .from('resumen_escalas_diario')
        .select('*')
        .eq('fecha', '2026-03-16');

    if (err) console.error(err);
    else console.log(JSON.stringify(res, null, 2));

    console.log("\n--- Ultimas lecturas escalas ---");
    const { data: lect, error: err2 } = await supabase
        .from('lecturas_escalas')
        .select('escala_id, nivel_m, fecha, hora_lectura, creado_en')
        .order('creado_en', { ascending: false })
        .limit(5);

    if (err2) console.error(err2);
    else console.log(JSON.stringify(lect, null, 2));
}

check();
