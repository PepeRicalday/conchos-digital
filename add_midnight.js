import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length === 2) {
        env[parts[0].trim()] = parts[1].trim().replace(/"/g, '');
    }
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function addMissingMidnight() {
    const puntoId = 'PE-002';

    // Check if we already have it to avoid duplicates
    const { data: checks } = await supabase
        .from('mediciones')
        .select('*')
        .eq('punto_id', puntoId)
        .eq('fecha_hora', '2026-03-05T06:00:00+00:00') // 12am in Chihuahua is 6am UTC

    if (checks && checks.length > 0) {
        console.log('Ya existe:', checks[0]);
        return;
    }

    const { data: lastRep } = await supabase
        .from('reportes_operacion')
        .select('caudal_promedio')
        .eq('punto_id', puntoId)
        .eq('fecha', '2026-03-05')

    const q = (lastRep && lastRep.length > 0) ? lastRep[0].caudal_promedio : 0.1;

    const res = await supabase.from('mediciones').insert({
        punto_id: puntoId,
        valor_q: q,
        fecha_hora: '2026-03-05T06:00:00+00:00', // 12am MST = 6am UTC
        notas: 'Autogenerado (Continuidad de Medianoche)',
        ciclo_id: 'CIC-001',
        estado_evento: 'continua',
        tipo_ubicacion: 'canal'
    });
    console.log('Insert:', res);
}

addMissingMidnight();
