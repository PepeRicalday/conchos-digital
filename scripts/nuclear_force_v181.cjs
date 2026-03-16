
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('--- EXECUTING NUCLEAR FORCE UPDATE v1.8.1 ---');
        
        // Dashboard
        await client.query(`
            UPDATE public.app_versions 
            SET 
              version = '1.8.1',
              min_supported_version = '1.8.1',
              actualizado_en = now(),
              release_notes = 'FORCED REFRESH v1.8.1: Unificación Hidráulica Final.'
            WHERE app_id = 'control-digital';
        `);
        console.log('✅ Dashboard target: v1.8.1 (BLOCKING)');

        // Capture
        await client.query(`
            UPDATE public.app_versions 
            SET 
              version = '1.6.1', 
              min_supported_version = '1.6.1',
              actualizado_en = now(),
              release_notes = 'FORCED REFRESH v1.6.1'
            WHERE app_id = 'capture';
        `);
        console.log('✅ Capture target: v1.6.1 (BLOCKING)');

    } catch (err) {
        console.error('❌ Error in force update:', err);
    } finally {
        await client.end();
    }
}
main();
