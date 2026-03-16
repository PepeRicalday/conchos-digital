
const { Client } = require('pg');
async function main() {
    const client = new Client({ connectionString: 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres' });
    await client.connect();
    const res = await client.query("SELECT id, nombre, km FROM escalas WHERE km IN (23, 29, 34)");
    console.table(res.rows);
    
    const readings = await client.query(`
        SELECT escala_id, nivel_m, creado_en 
        FROM lecturas_escalas 
        WHERE fecha = '2026-03-15' 
        ORDER BY creado_en DESC LIMIT 10
    `);
    console.log('Recent readings for today:');
    console.table(readings.rows);
    
    await client.end();
}
main();
