
const { Client } = require('pg');

async function checkLecturas() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT l.id, l.presa_id, l.fecha, l.extraccion_total_m3s, p.nombre_corto 
            FROM public.lecturas_presas l
            LEFT JOIN public.presas p ON l.presa_id = p.id
            ORDER BY l.fecha DESC, l.creado_en DESC
            LIMIT 10;
        `);
        res.rows.forEach(r => {
            console.log(`ID: ${r.id} | Presa: ${r.nombre_corto} | Fecha: ${r.fecha} | Gasto: ${r.extraccion_total_m3s}`);
        });
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

checkLecturas();
