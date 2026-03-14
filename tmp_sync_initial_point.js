
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dumfyrgwnshcgeibffvr.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function sync() {
    console.log('--- Sincronizando Punto Inicial de Llenado ---');
    
    const eventId = 'b5262775-99ed-460e-aba2-6d807494474e';
    const horaApertura = '2026-03-14T16:21:00+00:00';

    // Actualizar el punto KM -36
    const { data, error } = await supabase
        .from('sica_llenado_seguimiento')
        .update({
            estado: 'CONFIRMADO',
            hora_real: horaApertura,
            updated_at: new Date().toISOString()
        })
        .eq('evento_id', eventId)
        .eq('km', -36);
    
    if (error) {
        console.error('Error al actualizar punto inicial:', error);
    } else {
        console.log('Punto inicial (Presa) confirmado con éxito.');
    }

    // Opcional: Calcular ETAs iniciales si no están
    // Esto dispararía lo que useLlenadoTracker hace en el frontend, 
    // pero podemos hacerlo aquí para asegurar consistencia inmediata.
}

sync();
