
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    const eventoId = 'b5262775-99ed-460e-aba2-6d807494474e';

    try {
        await client.connect();
        const res = await client.query(`
            SELECT km, hora_real 
            FROM sica_llenado_seguimiento 
            WHERE evento_id = '${eventoId}' 
            AND hora_real IS NOT NULL 
            ORDER BY CAST(km AS FLOAT) DESC
        `);
        console.log('--- ANCLAS CONFIRMADAS ---');
        console.table(res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
