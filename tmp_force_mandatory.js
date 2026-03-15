
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dumfyrgwnshcgeibffvr.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function forceUpdate() {
    console.log('Forzando actualización global (Jerarquía v1.6.4 / v1.4.8)...');
    
    // 1. Control Digital
    const { error: err1 } = await supabase
        .from('app_versions')
        .update({ 
            version: '1.6.4', 
            min_supported_version: '1.6.4',
            actualizado_en: new Date().toISOString(),
            release_notes: 'OBLIGATORIO: Protocolo Llenado v3.2 - Regla 12h y Sincronía Hidro-Digital.'
        })
        .eq('app_id', 'control-digital');
    
    if (err1) console.error('Error control-digital:', err1);
    else console.log('OK: control-digital forzado a v1.6.4');

    // 2. SICA Capture
    const { error: err2 } = await supabase
        .from('app_versions')
        .update({ 
            version: '1.4.8', 
            min_supported_version: '1.4.8',
            actualizado_en: new Date().toISOString(),
            release_notes: 'OBLIGATORIO: Sincronización con Protocolo de Llenado DR005.'
        })
        .eq('app_id', 'capture');

    if (err2) console.error('Error capture:', err2);
    else console.log('OK: capture forzado a v1.4.8');
}

forceUpdate();
