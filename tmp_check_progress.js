
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dumfyrgwnshcgeibffvr.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
    const eventId = 'b5262775-99ed-460e-aba2-6d807494474e';
    const { data: seguimiento, error } = await supabase
        .from('sica_llenado_seguimiento')
        .select('*')
        .eq('evento_id', eventId)
        .order('km', { ascending: true });
    
    if (error) console.error('Error:', error);
    console.log('Seguimiento Llenado:');
    seguimiento?.forEach(p => {
        console.log(`KM: ${p.km.toString().padStart(4)} | Punto: ${p.punto_nombre.padEnd(30)} | Estado: ${p.estado.padEnd(12)} | Hora Real: ${p.hora_real || '---'} | ETA Actual: ${p.hora_estimada_actual || '---'}`);
    });
}

check();
