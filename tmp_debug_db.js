
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dumfyrgwnshcgeibffvr.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
    const { data, error } = await supabase.from('sica_eventos_log').select('*').limit(1);
    console.log('Sample Event Record:', data);
    
    // Also check for any LLENADO event
    const { data: llenadoEvents } = await supabase.from('sica_eventos_log').select('*').eq('evento_tipo', 'LLENADO').order('created_at', { ascending: false }).limit(5);
    console.log('Recent LLENADO Events:', llenadoEvents);
}

check();
