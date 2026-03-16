
const { Client } = require('pg');

async function checkK0() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({
        connectionString: connectionString,
    });

    try {
        await client.connect();
        const res = await client.query("SELECT * FROM public.escalas WHERE km = 0;");
        console.log('K0 Scale Details:', res.rows[0]);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

checkK0();
