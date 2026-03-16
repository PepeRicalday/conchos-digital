
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT id, evento_tipo, fecha_inicio, esta_activo 
            FROM sica_eventos_log 
            WHERE esta_activo = true 
            ORDER BY fecha_inicio DESC 
            LIMIT 1
        `);
        console.log('--- EVENTO ACTIVO ---');
        console.table(res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
