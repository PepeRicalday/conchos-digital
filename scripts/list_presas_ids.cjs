
const { Client } = require('pg');

async function checkPresas() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query("SELECT id, nombre, nombre_corto FROM public.presas");
        console.table(res.rows);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

checkPresas();
