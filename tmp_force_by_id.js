
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dumfyrgwnshcgeibffvr.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function forceUpdate() {
    console.log('Forzando actualización global por ID (v1.6.4 / v1.4.8)...');
    
    // 1. Control Digital
    const { data: d1, error: err1 } = await supabase
        .from('app_versions')
        .update({ 
            version: '1.6.5', 
            min_supported_version: '1.6.5',
            actualizado_en: new Date().toISOString(),
            release_notes: 'OBLIGATORIO: Monitor Público Optimizado - Máxima Visibilidad de Plano y Escalas.'
        })
        .eq('id', 'ef43acfc-5017-4a63-8b06-f5391c06f091')
        .select();
    
    if (err1) console.error('Error control-digital:', err1);
    else console.log('OK: control-digital actualizado:', d1);

    // 2. SICA Capture
    const { data: d2, error: err2 } = await supabase
        .from('app_versions')
        .update({ 
            version: '1.4.8', 
            min_supported_version: '1.4.8',
            actualizado_en: new Date().toISOString(),
            release_notes: 'OBLIGATORIO: Sincronización con Protocolo de Llenado DR005.'
        })
        .eq('id', 'b754d93a-c562-4ed8-b075-63fbdcce90bd')
        .select();

    if (err2) console.error('Error capture:', err2);
    else console.log('OK: capture actualizado:', d2);
}

forceUpdate();
