const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://dumfyrgwnshcgeibffvr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function crearUsuarios() {
    console.log("Creando Gerente SRL...");
    const { data: gerente, error: errGerente } = await supabase.auth.signUp({
        email: 'gerente@srlconchos.com',
        password: 'Conchos.2026.secure',
        options: {
            data: {
                nombre: 'Gerencia M. SRL Conchos',
            }
        }
    });

    if (errGerente) console.error("Error G:", errGerente);
    else console.log("Gerente Creado:", gerente.user?.id);

    console.log("Creando Aforador SRL...");
    const { data: aforador, error: errAforador } = await supabase.auth.signUp({
        email: 'aforador@srlconchos.com',
        password: 'Conchos.2026.aforo',
        options: {
            data: {
                nombre: 'Ing. Aforador SRL Conchos',
            }
        }
    });

    if (errAforador) console.error("Error A:", errAforador);
    else console.log("Aforador Creado:", aforador.user?.id);
}

crearUsuarios();
