
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

let envContent = '';
try {
    envContent = fs.readFileSync('c:/Users/peper/Downloads/Antigravity/SICA 005/conchos-digital/.env.local', 'utf8');
} catch (e) {
    console.error('Could not read .env.local');
    process.exit(1);
}

const env = {};
envContent.split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    const value = rest.join('=');
    if (key && value) env[key.trim()] = value.trim();
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    console.log('Available keys:', Object.keys(env));
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTables() {
    const { data: aforos, error: aforosError } = await supabase.from('aforos_control').select('*').limit(1);
    if (aforosError) {
        console.error('Error fetching aforos_control:', aforosError);
    } else {
        console.log('aforos_control exists. Columns:', Object.keys(aforos[0] || {}));
        const { data: all } = await supabase.from('aforos_control').select('*');
        console.log('Current records count:', all?.length);
        console.log('Sample record:', all?.[0]);
    }
}

checkTables();
