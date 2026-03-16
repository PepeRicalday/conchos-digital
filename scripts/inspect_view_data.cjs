
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    try {
        await client.connect();
        
        console.log('--- VIEW DATA FOR ESC-000 ---');
        const resData = await client.query("SELECT escala_id, nombre, fecha, lectura_am, lectura_pm, nivel_actual FROM public.resumen_escalas_diario WHERE escala_id = 'ESC-000' AND fecha = '2026-03-15'");
        console.table(resData.rows);

        const resAll = await client.query("SELECT escala_id, COUNT(*) FROM public.resumen_escalas_diario WHERE fecha = '2026-03-15' GROUP BY escala_id");
        console.log('--- COUNTS BY ESCALA_ID ---');
        console.table(resAll.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
