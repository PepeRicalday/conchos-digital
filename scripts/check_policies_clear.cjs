
const { Client } = require('pg');

async function checkPolicies() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT tablename, policyname, cmd, qual
            FROM pg_policies 
            WHERE tablename IN ('lecturas_presas', 'movimientos_presas');
        `);
        res.rows.forEach(r => {
            console.log(`Table: ${r.tablename} | Policy: ${r.policyname} | CMD: ${r.cmd} | Qual: ${r.qual}`);
        });
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

checkPolicies();
