
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    const eventoId = 'b5262775-99ed-460e-aba2-6d807494474e';

    try {
        await client.connect();
        
        // 1. Update KM 0 to the latest reading (3.48)
        await client.query(`UPDATE sica_llenado_seguimiento SET nivel_arribo_m = 3.48 WHERE evento_id = '${eventoId}' AND km = '0'`);
        
        console.log('✅ KM 0+000 sincronizado con SICA Capture (3.48 m)');

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
