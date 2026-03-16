
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const res = await client.query(`
            SELECT radiales_json 
            FROM public.lecturas_escalas 
            WHERE escala_id = 'ESC-000' AND fecha = '2026-03-15' AND nivel_m = 3.6
            LIMIT 1
        `);
        console.log('RAW radiales_json:');
        console.log(JSON.stringify(res.rows[0].radiales_json));
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
