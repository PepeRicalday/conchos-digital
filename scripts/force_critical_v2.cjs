
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('--- FORZANDO ACTUALIZACIÓN CRÍTICA (MANUAL FORCED) ---');
        
        // 1. Dashboard
        await client.query(`
            UPDATE public.app_versions 
            SET 
              version = '1.8.0',
              min_supported_version = '1.8.0',
              actualizado_en = now(),
              release_notes = 'FORCE UPDATE CRITICAL: Unificación Hidráulica v1.8.0. Por favor actualice inmediatamente.'
            WHERE app_id = 'control-digital';
        `);
        console.log('✅ Dashboard actualizado a 1.8.0');

        // 2. Capture
        await client.query(`
            UPDATE public.app_versions 
            SET 
              version = '1.6.0', 
              min_supported_version = '1.6.0',
              actualizado_en = now(),
              release_notes = 'FORCE UPDATE CRITICAL: Sincronía v1.6.0'
            WHERE app_id = 'capture';
        `);
        console.log('✅ Capture actualizado a 1.6.0');

    } catch (err) {
        console.error('❌ Error en actualización forzada:', err);
    } finally {
        await client.end();
    }
}
main();
