
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const res = await client.query(`
            SELECT tablename, policyname, cmd, qual, with_check 
            FROM pg_policies 
            WHERE tablename = 'lecturas_escalas'
        `);
        console.table(res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
