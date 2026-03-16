
const { Client } = require('pg');
async function main() {
    const client = new Client({ connectionString: 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres' });
    await client.connect();
    
    console.log('--- BUSCANDO KM 44 EN ESCALAS ---');
    const resEscalas = await client.query("SELECT id, nombre, km FROM escalas WHERE nombre ILIKE '%44%' OR (km >= 43 AND km <= 45)");
    console.log('Escalas:', resEscalas.rows);

    console.log('--- BUSCANDO EVENTO ACTIVO ---');
    // In SICA 005, 'llenado' might be tracked differently. 
    // Let's look at sica_llenado_seguimiento or check a common table.
    const resEventos = await client.query("SELECT id, evento_tipo, esta_activo FROM sica_llenado_seguimiento WHERE esta_activo = true LIMIT 1");
    console.log('Eventos (Llenado):', resEventos.rows);

    await client.end();
}
main();
