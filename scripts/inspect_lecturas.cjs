
const { Client } = require('pg');
async function main() {
    const client = new Client({ connectionString: 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres' });
    await client.connect();
    
    console.log('--- COLUMNAS LECTURAS_ESCALAS ---');
    const res = await client.query("SELECT * FROM lecturas_escalas LIMIT 1");
    console.log('Cols:', Object.keys(res.rows[0] || {}));
    if (res.rows.length === 0) {
        const cols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'lecturas_escalas'");
        console.log('Schema:', cols.rows.map(r => r.column_name));
    }

    await client.end();
}
main();
