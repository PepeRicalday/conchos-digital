
const { Client } = require('pg');
async function main() {
    const client = new Client({ connectionString: 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres' });
    await client.connect();
    
    const res = await client.query("SELECT * FROM sica_llenado_seguimiento LIMIT 1");
    console.log('Columns Llenado:', Object.keys(res.rows[0] || {}));

    const resM = await client.query("SELECT * FROM mediciones LIMIT 1");
    console.log('Columns Mediciones:', Object.keys(resM.rows[0] || {}));

    await client.end();
}
main();
