
const { Client } = require('pg');
async function main() {
    const client = new Client({ connectionString: 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres' });
    await client.connect();
    const readings = await client.query(`
        SELECT id, escala_id, nivel_m, fecha, creado_en 
        FROM lecturas_escalas 
        WHERE escala_id = 'ESC-002'
        ORDER BY creado_en DESC LIMIT 5
    `);
    console.log('Readings for KM 29 (ESC-002):');
    readings.rows.forEach(r => console.log(r));
    await client.end();
}
main();
