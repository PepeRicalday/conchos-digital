
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dumfyrgwnshcgeibffvr.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
    console.log('--- Verificando Estado de Llenado ---');
    
    // 1. Evento Activo
    const { data: event, error: err1 } = await supabase
        .from('sica_eventos_log')
        .select('*')
        .eq('estado', 'ACTIVO')
        .eq('evento_tipo', 'LLENADO')
        .maybeSingle();
    
    if (err1) console.error('Error eventos:', err1);
    console.log('Evento Activo:', event);

    // 2. Lectura Boquilla
    const today = new Date().toISOString().split('T')[0];
    const { data: lecturas, error: err2 } = await supabase
        .from('lecturas_presas')
        .select('*')
        .eq('presa_id', 'PRE-001')
        .eq('fecha', today);
    
    if (err2) console.error('Error lecturas:', err2);
    console.log('Lecturas Boquilla Hoy:', lecturas);

    // 3. Seguimiento Llenado
    if (event) {
        const { data: seguimiento, error: err3 } = await supabase
            .from('sica_llenado_seguimiento')
            .select('*')
            .eq('evento_id', event.id)
            .order('km', { ascending: true });
        
        if (err3) console.error('Error seguimiento:', err3);
        console.log('Seguimiento Llenado (puntos):', seguimiento?.length);
        const confirmados = seguimiento?.filter(p => p.hora_real);
        console.log('Puntos Confirmados:', confirmados?.map(p => ({ km: p.km, nombre: p.punto_nombre, hora: p.hora_real })));
    }
}

check();
