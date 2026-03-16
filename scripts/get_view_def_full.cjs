
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const res = await client.query("SELECT view_definition FROM information_schema.views WHERE table_name = 'resumen_escalas_diario'");
        console.log(res.rows[0].view_definition);
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
