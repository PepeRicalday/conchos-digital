
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    const eventoId = 'b5262775-99ed-460e-aba2-6d807494474e';
    try {
        await client.connect();
        const res = await client.query(`
            SELECT id, punto_nombre, km, hora_real, hora_estimada_actual, estado 
            FROM public.sica_llenado_seguimiento 
            WHERE evento_id = $1 
            ORDER BY km ASC
        `, [eventoId]);
        res.rows.forEach(r => console.log(r));
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
