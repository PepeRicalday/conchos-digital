
const { Client } = require('pg');

async function checkAllMovements() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT m.*, p.nombre_corto 
            FROM public.movimientos_presas m
            LEFT JOIN public.presas p ON m.presa_id = p.id
            ORDER BY m.fecha_hora DESC
            LIMIT 10;
        `);
        console.table(res.rows);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

checkAllMovements();
