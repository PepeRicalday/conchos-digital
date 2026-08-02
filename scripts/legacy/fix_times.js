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

async function fixTime() {
    // Delete the wrong ones
    const { error: err1 } = await supabase
        .from('mediciones')
        .delete()
        .eq('fecha_hora', '2026-03-05T00:00:00+00:00')
        .ilike('notas', '%Autom%tico%');

    console.log('Mediciones erróneas borradas:', err1);

    // Delete the wrong reportes directly inserted with 00:00:00
    // wait we don't need to delete reportes, we can UPDATE them to '2026-03-05T06:00:00+00:00' if they had 00:00:00+00
    const { error: err2 } = await supabase
        .from('reportes_operacion')
        .update({ hora_apertura: '2026-03-05T06:00:00+00:00' })
        .eq('hora_apertura', '2026-03-05T00:00:00+00:00');

    console.log('Reportes actualizados:', err2);

    // Oh wait, reportes already had 6:00:00 initially maybe?
    // Wait, earlier the user showed "CONTINUA 100 L/s" was missing.
    // The previous run ran the cron at `06:01:00 UTC` and created reportes.

    // The `midnight_at` calculation: Let's fix the SQL function first
}
fixTime();
