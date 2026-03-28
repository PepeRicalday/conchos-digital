const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://dumfyrgwnshcgeibffvr.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY');

async function sync() {
    console.log('Force updating app_versions...');
    
    const { error: e1, count: c1 } = await s.from('app_versions')
        .update({ 
            version: '2.5.5', 
            min_supported_version: '2.5.5',
            build_hash: 'v2.5.5-audit-p2'
        })
        .eq('app_id', 'control-digital');
    
    const { error: e2, count: c2 } = await s.from('app_versions')
        .update({ 
            version: '2.5.3', 
            min_supported_version: '2.5.3',
            build_hash: 'v2.5.3-audit-p2'
        })
        .eq('app_id', 'capture');

    console.log('Control Digital:', { error: e1, updated: c1 });
    console.log('Capture:', { error: e2, updated: c2 });
}

sync();
