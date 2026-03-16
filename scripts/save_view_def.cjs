
const { Client } = require('pg');
const fs = require('fs');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const res = await client.query("SELECT view_definition FROM information_schema.views WHERE table_name = 'resumen_escalas_diario'");
        fs.writeFileSync('scripts/view_definition.sql', res.rows[0].view_definition);
        console.log('Saved to scripts/view_definition.sql');
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
