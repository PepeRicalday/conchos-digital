const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

async function run() {
    try {
        const envFile = fs.readFileSync('.env.local', 'utf8');
        const env = {};
        envFile.split('\n').filter(line => line.includes('=')).forEach(line => {
            const parts = line.split('=');
            if (parts.length >= 2) {
                const key = parts[0].trim();
                const value = parts.slice(1).join('=').trim().replace(/"/g, '').replace(/'/g, '');
                env[key] = value;
            }
        });

        const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
        const today = '2026-03-20';
        console.log('Checking for date:', today);
        
        const { data, error } = await supabase
            .from('lecturas_escalas')
            .select('*')
            .eq('fecha', today)
            .order('hora', { ascending: false })
            .limit(50);

        if (error) {
            console.error('Supabase error:', error);
            // Try last readings from any date
            const { data: anyData } = await supabase.from('lecturas_escalas').select('*').order('created_at', { ascending: false }).limit(5);
            console.log('Last readings (any date):', JSON.stringify(anyData, null, 2));
            return;
        }

        console.log('Results for today:', JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Global error:', e);
    }
}

run();
