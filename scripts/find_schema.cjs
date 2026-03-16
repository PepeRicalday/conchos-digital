
const { Client } = require('pg');
async function main() {
    const client = new Client({ connectionString: 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres' });
    await client.connect();
    
    console.log('--- BUSCANDO EVENTO ID ---');
    const res = await client.query("SELECT evento_id FROM sica_llenado_seguimiento WHERE esta_activo = true LIMIT 1");
    console.log('Evento ID:', res.rows[0]?.evento_id);

    // Get mediciones columns to be sure
    const cols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'mediciones'");
    console.log('Columnas Mediciones:', cols.rows.map(r => r.column_name));

    await client.end();
}
main();
