
const { Client } = require('pg');

async function checkSpecificTables() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const tablesToCheck = ['registros_presas', 'lecturas_presas', 'movimientos_presas', 'presas'];
        for (const table of tablesToCheck) {
            const res = await client.query("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)", [table]);
            console.log(`Table ${table} exists: ${res.rows[0].exists}`);
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

checkSpecificTables();
