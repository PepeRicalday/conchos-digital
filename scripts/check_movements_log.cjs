
const { Client } = require('pg');

async function checkAllMovements() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT m.id, m.presa_id, m.fecha_hora, m.gasto_m3s, p.nombre_corto 
            FROM public.movimientos_presas m
            LEFT JOIN public.presas p ON m.presa_id = p.id
            ORDER BY m.fecha_hora DESC
            LIMIT 10;
        `);
        res.rows.forEach(r => {
            console.log(`ID: ${r.id} | Presa: ${r.nombre_corto} | Fecha: ${r.fecha_hora} | Gasto: ${r.gasto_m3s}`);
        });
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

checkAllMovements();
