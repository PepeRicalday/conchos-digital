
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const res = await client.query("SELECT definition FROM pg_views WHERE viewname = 'resumen_escalas_diario'");
        process.stdout.write(res.rows[0].definition);
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
