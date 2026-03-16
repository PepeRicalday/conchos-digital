
const { Client } = require('pg');

async function checkLatestGasto() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT gasto_m3s 
            FROM public.movimientos_presas 
            ORDER BY fecha_hora DESC 
            LIMIT 1;
        `);
        if (res.rows.length > 0) {
            console.log(`LATEST_GASTO:${res.rows[0].gasto_m3s}`);
        } else {
            console.log('NO_MOVEMENTS');
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

checkLatestGasto();
