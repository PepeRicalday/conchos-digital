
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dumfyrgwnshcgeibffvr.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function force() {
    console.log('Forzando actualización en base de datos...');
    
    // Actualizar versión para conchos-digital
    const { error: err1 } = await supabase
        .from('app_versions')
        .update({ version: '1.6.3', actualizado_en: new Date().toISOString() })
        .eq('app_id', 'control_digital');
    
    if (err1) console.error('Error actualizando control_digital:', err1);
    else console.log('OK: control_digital -> 1.6.3');

    // Actualizar versión para sica-capture
    const { error: err2 } = await supabase
        .from('app_versions')
        .update({ version: '1.4.7', actualizado_en: new Date().toISOString() })
        .eq('app_id', 'capture');

    if (err2) console.error('Error actualizando capture:', err2);
    else console.log('OK: capture -> 1.4.7');
}

force();
