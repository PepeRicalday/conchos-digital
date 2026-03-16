
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('--- EXECUTING NUCLEAR FORCE UPDATE v1.8.0 ---');
        
        // Ensure the app_id is exactly what the code expects
        // Dashboard
        await client.query(`
            UPDATE public.app_versions 
            SET 
              version = '1.8.0',
              min_supported_version = '1.8.0',
              actualizado_en = now(),
              release_notes = 'MANTENIMIENTO CRÍTICO: UNIFICACIÓN HIDRÁULICA 0.7m/s. Actualización obligatoria para sincronía de datos.'
            WHERE app_id = 'control-digital';
        `);
        console.log('✅ Dashboard target: v1.8.0 (BLOCKING)');

        // Capture
        await client.query(`
            UPDATE public.app_versions 
            SET 
              version = '1.6.0', 
              min_supported_version = '1.6.0',
              actualizado_en = now(),
              release_notes = 'ACTUALIZACIÓN OBLIGATORIA: Por favor actualice para sincronizar con el Mando Central.'
            WHERE app_id = 'capture';
        `);
        console.log('✅ Capture target: v1.6.0 (BLOCKING)');

    } catch (err) {
        console.error('❌ Error in force update:', err);
    } finally {
        await client.end();
    }
}
main();
