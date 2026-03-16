
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const res = await client.query(`
            SELECT l.escala_id, l.nivel_m, l.hora_lectura, e.km 
            FROM public.lecturas_escalas l 
            JOIN public.escalas e ON l.escala_id = e.id 
            WHERE l.fecha = '2026-03-15' AND l.nivel_m > 0 
            ORDER BY e.km::float DESC LIMIT 10
        `);
        console.table(res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
