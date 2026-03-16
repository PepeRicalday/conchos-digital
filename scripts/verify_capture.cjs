
const { Client } = require('pg');
async function main() {
    // Correcting hostname: removed 'p' from 'dumpfyr...'
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    await client.connect();
    
    const res = await client.query("SELECT * FROM lecturas_escalas WHERE id = 'LE-00071'");
    console.log('Registro Insertado:', JSON.stringify(res.rows[0], null, 2));

    const res2 = await client.query("SELECT * FROM sica_llenado_seguimiento WHERE km = 44");
    console.log('Seguimiento KM 44:', JSON.stringify(res2.rows[0], null, 2));

    await client.end();
}
main();
