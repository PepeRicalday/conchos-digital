
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    const eventoId = 'b5262775-99ed-460e-aba2-6d807494474e';

    try {
        await client.connect();

        // 1. Get Event Data
        const eventRes = await client.query("SELECT hora_apertura_real FROM sica_eventos_log WHERE id = $1", [eventoId]);
        const { hora_apertura_real } = eventRes.rows[0];
        
        // 2. Clear previous confirmations to re-process with corrected logic
        // Only clear those that came from auto-sync
        console.log('--- RECLAMING TIME: CORREGIR HORA K-29 ---');
        
        // REGLA: El dato "creado_en" de Supabase está en UTC. 
        // 2026-03-16T01:09 UTC es 2026-03-15 19:09 Local (UTC-6) -> 7:09 PM.
        // Si el usuario dice que fue a las 6:09 PM Local, significa que en UTC debe ser 2026-03-16T00:09.
        
        const horaK29_Local = "2026-03-15 18:09:00"; // 6:09 PM
        const horaK29_UTC = new Date("2026-03-16T00:09:04.504Z").toISOString();
        
        const horaK34_UTC = new Date("2026-03-16T01:32:05.123Z").toISOString(); // 7:32 PM Local

        // 3. Forzar actualización de tiempos confirmados con corrección de desfase UTC si es necesario
        // Pero primero vamos a recalcular basándonos en la declaración del usuario: K-29 = 18:09 PM
        
        await client.query(`
            UPDATE sica_llenado_seguimiento 
            SET hora_real = $1, estado = 'CONFIRMADO' 
            WHERE evento_id = $2 AND km = '29'
        `, [horaK29_UTC, eventoId]);

        await client.query(`
            UPDATE sica_llenado_seguimiento 
            SET hora_real = $3, estado = 'CONFIRMADO' 
            WHERE evento_id = $2 AND km = '34'
        `, [eventoId, '34', horaK34_UTC]);

        // 4. CALIBRATION
        const pointsRes = await client.query("SELECT * FROM sica_llenado_seguimiento WHERE evento_id = $1 ORDER BY km ASC", [eventoId]);
        const points = pointsRes.rows;
        const confirmados = points.filter(p => p.hora_real).sort((a, b) => parseFloat(a.km) - parseFloat(b.km));
        
        const last = confirmados[confirmados.length - 1]; // K-34
        const prev = confirmados[confirmados.length - 2]; // K-29
        
        const dDist = (parseFloat(last.km) - parseFloat(prev.km)) * 1000;
        const dT = (new Date(last.hora_real).getTime() - new Date(prev.hora_real).getTime()) / 1000;
        
        const velCalibrada = Math.max(0.3, Math.min(2.5, dDist / dT));
        const anchorKm = parseFloat(last.km);
        const anchorTime = new Date(last.hora_real).getTime();

        console.log(`Nueva Calibración:`);
        console.log(`K-29: ${new Date(new Date(prev.hora_real).getTime() - 6*3600000).toLocaleString()} (Corregido)`);
        console.log(`K-34: ${new Date(new Date(last.hora_real).getTime() - 6*3600000).toLocaleString()}`);
        console.log(`Velocidad Calculada: ${velCalibrada.toFixed(3)} m/s`);

        // 5. RECALCULATE ETAS
        for (const p of points) {
            const pKm = parseFloat(p.km);
            if (p.hora_real || pKm <= anchorKm) continue;

            const dist = (pKm - anchorKm) * 1000;
            const tSeconds = dist / velCalibrada;
            const etaTime = new Date(anchorTime + tSeconds * 1000);
            
            await client.query(`
                UPDATE sica_llenado_seguimiento 
                SET hora_estimada_actual = $1, estado = 'EN_TRANSITO', 
                    recalculado_desde = 'K-29 ADJUSTED'
                WHERE id = $2
            `, [etaTime.toISOString(), p.id]);
        }

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
