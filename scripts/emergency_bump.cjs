
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('--- EXECUTING EMERGENCY VERSION BUMP v2.1.0 ---');
        
        // Dashboard
        await client.query(`
            UPDATE public.app_versions 
            SET 
              version = '2.1.0',
              min_supported_version = '2.1.0',
              actualizado_en = now(),
              release_notes = 'BORRADO DE CACHÉ REQUERIDO: Por favor vaya a /nuke.html o use herramientas de navegador.'
            WHERE app_id = 'control-digital';
        `);
        console.log('✅ Dashboard target: v2.1.0');

        // Capture
        await client.query(`
            UPDATE public.app_versions 
            SET 
              version = '2.1.0', 
              min_supported_version = '2.1.0',
              actualizado_en = now(),
              release_notes = 'BORRADO DE CACHÉ REQUERIDO: Por favor vaya a /nuke'
            WHERE app_id = 'capture';
        `);
        console.log('✅ Capture target: v2.1.0');

    } catch (err) {
        console.error('❌ Error in force update:', err);
    } finally {
        await client.end();
    }
}
main();
