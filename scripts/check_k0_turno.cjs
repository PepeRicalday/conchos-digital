
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const res = await client.query("SELECT hora_lectura, turno FROM public.lecturas_escalas WHERE escala_id = 'ESC-000' AND fecha = '2026-03-15' ORDER BY hora_lectura DESC");
        console.table(res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
