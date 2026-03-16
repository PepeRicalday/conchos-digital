
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const res = await client.query(`
            SELECT id, nivel_m, nivel_abajo_m, apertura_radiales_m, radiales_json, gasto_calculado_m3s, hora_lectura 
            FROM public.lecturas_escalas 
            WHERE escala_id = 'ESC-000' AND fecha = '2026-03-15'
            ORDER BY hora_lectura DESC
        `);
        console.log('--- READINGS FOR K-0+000 TODAY ---');
        res.rows.forEach(r => {
            console.log(`Hora: ${r.hora_lectura}, Nivel: ${r.nivel_m}, Abajo: ${r.nivel_abajo_m}, Gasto: ${r.gasto_calculado_m3s}`);
            console.log(`Radiales: ${r.radiales_json ? (Array.isArray(r.radiales_json) ? r.radiales_json.filter(x => x.apertura_m > 0).length : 'Not array') : 'null'} open`);
            console.log('-----------------------------------');
        });
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
