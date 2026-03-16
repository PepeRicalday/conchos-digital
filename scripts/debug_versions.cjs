
const { Client } = require('pg');
async function main() {
    const client = new Client({ connectionString: 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres' });
    await client.connect();
    const res = await client.query('SELECT app_id, version, min_supported_version FROM app_versions');
    console.log(JSON.stringify(res.rows, null, 2));
    await client.end();
}
main();
