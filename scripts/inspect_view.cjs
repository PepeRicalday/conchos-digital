
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    try {
        await client.connect();
        
        console.log('--- VIEW DATA ---');
        const resData = await client.query("SELECT * FROM public.resumen_escalas_diario WHERE fecha = '2026-03-15'");
        console.table(resData.rows);

        const res = await client.query("SELECT definition FROM pg_views WHERE viewname = 'resumen_escalas_diario'");
        if (res.rows.length > 0) {
            console.log('--- VIEW DEFINITION ---');
            console.log(res.rows[0].definition);
        } else {
            console.log('View not found in pg_views');
        }
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
