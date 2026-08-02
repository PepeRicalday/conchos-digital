
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://dumfyrgwnshcgeibffvr.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY');

async function checkModulos() {
    const { data, error } = await supabase.from('modulos').select('*').order('id');
    if (error) {
        console.error(error);
        return;
    }
    console.table(data.map(m => ({ id: m.id, nombre: m.nombre, codigo: m.codigo_corto })));
}

checkModulos();
