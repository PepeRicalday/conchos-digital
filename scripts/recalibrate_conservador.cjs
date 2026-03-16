
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    const eventoId = 'b5262775-99ed-460e-aba2-6d807494474e';

    try {
        await client.connect();

        console.log('--- RECALIBRANDO MODELO EN CASCADA (V_CONSERVADORA: 0.7 m/s) ---');
        
        const anchorKm = 34;
        const anchorTimeUTC = "2026-03-16T01:32:05.123Z"; // 7:32 PM Local
        const velConservadora = 0.7; // m/s (~2.5 km/h)

        // 1. Obtener puntos pendientes
        const res = await client.query(`
            SELECT id, km FROM sica_llenado_seguimiento 
            WHERE evento_id = '${eventoId}' AND hora_real IS NULL AND CAST(km AS FLOAT) > ${anchorKm}
            ORDER BY CAST(km AS FLOAT) ASC
        `);

        for (const p of res.rows) {
            const dist = (parseFloat(p.km) - anchorKm) * 1000;
            const tSeconds = dist / velConservadora;
            const etaTime = new Date(new Date(anchorTimeUTC).getTime() + tSeconds * 1000);
            
            await client.query(`
                UPDATE sica_llenado_seguimiento 
                SET hora_estimada_actual = '${etaTime.toISOString()}',
                    recalculado_desde = 'K-34 CALIBRATION V_FIX'
                WHERE id = '${p.id}'
            `);
            console.log(`KM ${p.km} -> Nueva ETA: ${etaTime.toLocaleString()}`);
        }

        console.log('✅ Inteligencia Hídrica sincronizada con modelo conservador.');

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
