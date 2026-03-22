
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanup() {
    console.log('Cleaning up SICA Bot records...');
    const { data, error, count } = await supabase
        .from('lecturas_escalas')
        .delete({ count: 'exact' })
        .eq('responsable', 'SICA Bot');

    if (error) {
        console.error('Error during cleanup:', error);
    } else {
        console.log(`Successfully deleted ${count} records from SICA Bot.`);
    }
}

cleanup();
