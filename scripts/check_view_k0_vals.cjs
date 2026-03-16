
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const res = await client.query("SELECT escala_id, nombre, fecha, lectura_am, lectura_pm, nivel_actual FROM public.resumen_escalas_diario WHERE escala_id = 'ESC-000' AND fecha = '2026-03-15'");
        console.log(res.rows[0]);
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
