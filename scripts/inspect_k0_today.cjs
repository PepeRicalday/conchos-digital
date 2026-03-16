
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const res = await client.query(`
            SELECT id, escala_id, nivel_m, turno, radiales_json, hora_lectura 
            FROM public.lecturas_escalas 
            WHERE fecha = '2026-03-15' AND escala_id = 'ESC-000'
        `);
        console.table(res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
