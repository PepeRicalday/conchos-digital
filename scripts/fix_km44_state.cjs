
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('--- ACTUALIZANDO ESTADO KM 44 A "CONFIRMADO" ---');

        // El frontend espera 'CONFIRMADO', no 'LLEGÓ'
        const res = await client.query(`
            UPDATE sica_llenado_seguimiento 
            SET 
                estado = 'CONFIRMADO',
                notas = 'Arribo real 15/Marzo 23:30 (Estado corregido para UI)'
            WHERE km = 44 OR punto_nombre ILIKE '%44%';
        `);
        
        console.log('✅ Estado actualizado:', res.rowCount, 'filas.');

        // Verificar
        const check = await client.query("SELECT estado, hora_real FROM sica_llenado_seguimiento WHERE km = 44");
        console.log('Datos actuales:', check.rows[0]);

    } catch (err) {
        console.error('❌ Error:', err);
    } finally {
        await client.end();
    }
}
main();
