
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('--- EXECUTING NUCLEAR FORCE UPDATE v2.0.2 ---');
        
        // Dashboard
        await client.query(`
            UPDATE public.app_versions 
            SET 
              version = '2.0.2',
              min_supported_version = '2.0.2',
              actualizado_en = now(),
              release_notes = 'GENERACIÓN 2.0.2: UNIFICACIÓN TOTAL 0.7m/s. Esta es una actualización obligatoria.'
            WHERE app_id = 'control-digital';
        `);
        console.log('✅ Dashboard target: v2.0.2 (BLOCKING)');

        // Capture
        await client.query(`
            UPDATE public.app_versions 
            SET 
              version = '2.0.2', 
              min_supported_version = '2.0.2',
              actualizado_en = now(),
              release_notes = 'SICA CAPTURE v2.0.2: Sincronía con Mando Central.'
            WHERE app_id = 'capture';
        `);
        console.log('✅ Capture target: v2.0.2 (BLOCKING)');

    } catch (err) {
        console.error('❌ Error in force update:', err);
    } finally {
        await client.end();
    }
}
main();
