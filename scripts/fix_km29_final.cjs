
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    const eventoId = 'b5262775-99ed-460e-aba2-6d807494474e';

    try {
        await client.connect();

        console.log('--- CORRIGIENDO HORA K-29 (AJUSTE MANUAL USUARIO) ---');
        
        // 6:09 PM Local = 2026-03-16 00:09 UTC
        const horaK29_UTC = "2026-03-16T00:09:04.504Z";
        // 7:32 PM Local = 2026-03-16 01:32 UTC
        const horaK34_UTC = "2026-03-16T01:32:05.123Z";

        // 1. Forzar actualización de tiempos
        await client.query(`UPDATE sica_llenado_seguimiento SET hora_real = '${horaK29_UTC}', estado = 'CONFIRMADO' WHERE evento_id = '${eventoId}' AND km = '29'`);
        await client.query(`UPDATE sica_llenado_seguimiento SET hora_real = '${horaK34_UTC}', estado = 'CONFIRMADO' WHERE evento_id = '${eventoId}' AND km = '34'`);

        // 2. Recalcular Velocidad entre K-29 y K-34
        const dDist = 5000; // 5 km (KM 29 a KM 34)
        const dT = (new Date(horaK34_UTC).getTime() - new Date(horaK29_UTC).getTime()) / 1000;
        
        const velCalibrada = dDist / dT; 
        const anchorTime = new Date(horaK34_UTC).getTime();

        console.log(`⏱️ Tramos corregidos:`);
        console.log(`K-29 (6:09 PM) -> K-34 (7:32 PM)`);
        console.log(`Velocidad Calibrada: ${velCalibrada.toFixed(3)} m/s (antes 2.5 m/s)`);

        // 3. REPROYECTAR ETAS
        const pointsRes = await client.query(`SELECT * FROM sica_llenado_seguimiento WHERE evento_id = '${eventoId}' AND hora_real IS NULL AND CAST(km AS FLOAT) > 34 ORDER BY CAST(km AS FLOAT) ASC`);
        
        for (const p of pointsRes.rows) {
            const extraDist = (parseFloat(p.km) - 34) * 1000;
            const etaTime = new Date(anchorTime + (extraDist / velCalibrada) * 1000);
            
            await client.query(`UPDATE sica_llenado_seguimiento SET hora_estimada_actual = '${etaTime.toISOString()}', recalculado_desde = 'K-29 USER ADJ' WHERE id = '${p.id}'`);
            console.log(`KM ${p.km} -> ETA: ${etaTime.toLocaleString()}`);
        }

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
