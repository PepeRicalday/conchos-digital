
const { Client } = require('pg');

async function checkTables() {
    const client = new Client({ connectionString: 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres' });
    try {
        await client.connect();
        const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        console.log('Tables in public schema:', res.rows.map(r => r.table_name).join(', '));
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
checkTables();
