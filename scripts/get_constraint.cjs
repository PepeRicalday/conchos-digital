const { Client } = require('pg');
const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';

async function run() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const res = await client.query(`
            SELECT pg_get_constraintdef(c.oid) as constraint_def
            FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            WHERE t.relname = 'puntos_entrega' AND c.conname = 'delivery_points_type_check'
        `);
        console.log(JSON.stringify(res.rows[0], null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
}
run();
