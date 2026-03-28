import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://dumfyrgwnshcgeibffvr.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY');

async function checkVersions() {
    const { data } = await supabase.from('app_versions').select('*');
    data.forEach(v => {
        console.log(`- ${v.app_id}: v${v.version} (${v.is_critical ? 'CRITICAL' : 'Normal'})`);
    });
}

checkVersions();
