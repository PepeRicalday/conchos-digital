
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('--- FORZANDO ACTUALIZACIÓN DEL SISTEMA EN LA NUBE ---');
        
        // 1. Dashboard
        await client.query(`
            UPDATE public.app_versions 
            SET 
              version = '1.7.7',
              min_supported_version = '1.7.7',
              actualizado_en = now(),
              release_notes = 'CALIBRACIÓN UNIFICADA v1.7.7: Unificación total de modelos hidráulicos y monitor público.'
            WHERE app_id = 'control-digital';
        `);
        console.log('✅ Dashboard actualizado a 1.7.7');

        // 2. Capture
        await client.query(`
            UPDATE public.app_versions 
            SET 
              version = '1.5.7', 
              min_supported_version = '1.5.7',
              actualizado_en = now(),
              release_notes = 'Sincronización total con Dashboard v1.7.7'
            WHERE app_id = 'capture';
        `);
        console.log('✅ Capture actualizado a 1.5.7');

    } catch (err) {
        console.error('❌ Error en actualización forzada:', err);
    } finally {
        await client.end();
    }
}
main();
