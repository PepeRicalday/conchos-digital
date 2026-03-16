
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();

        console.log('--- VERIFICANDO ÚLTIMA LECTURA KM 0 (ESC-000) ---');
        const res = await client.query(`
            SELECT escala_id, nivel_m, creado_en 
            FROM lecturas_escalas 
            WHERE escala_id = 'ESC-000' 
            ORDER BY creado_en DESC LIMIT 1
        `);
        
        if (res.rows.length > 0) {
            console.log('Última lectura encontrada:', res.rows[0]);
        } else {
            console.log('No se encontraron lecturas para ESC-000');
        }

        console.log('--- VERIFICANDO ESTADO EN TRACKER ---');
        const trackerRes = await client.query(`
            SELECT km, nivel_arribo_m, hora_real 
            FROM sica_llenado_seguimiento 
            WHERE evento_id = 'b5262775-99ed-460e-aba2-6d807494474e' AND km = '0'
        `);
        console.log('Estado actual en tracker:', trackerRes.rows[0]);

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
