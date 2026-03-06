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

async function checkGranja() {
    const puntoId = 'PE-002';

    console.log('--- Mediciones ---');
    const { data: mediciones } = await supabase
        .from('mediciones')
        .select('id, fecha_hora, valor_q, notas, estado_evento')
        .eq('punto_id', puntoId)
        .order('fecha_hora', { ascending: false })
        .limit(5);

    mediciones?.forEach(m => {
        console.log(`FechaHora: ${m.fecha_hora}, Q: ${m.valor_q}, Est: ${m.estado_evento}, Notas: ${m.notas}`);
    });
}

checkGranja();
