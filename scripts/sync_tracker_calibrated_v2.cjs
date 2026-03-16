
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    const eventoId = 'b5262775-99ed-460e-aba2-6d807494474e';

    try {
        await client.connect();

        // 1. Get Event Data
        console.log('--- FETCHING EVENT DATA ---');
        const eventRes = await client.query("SELECT hora_apertura_real, gasto_solicitado_m3s FROM sica_eventos_log WHERE id = $1", [eventoId]);
        const { hora_apertura_real, gasto_solicitado_m3s } = eventRes.rows[0];
        const Q = parseFloat(gasto_solicitado_m3s || 30);
        
        // Ensure Presa is confirmed
        if (hora_apertura_real) {
            await client.query(`UPDATE sica_llenado_seguimiento SET hora_real = $1, estado = 'CONFIRMADO' WHERE evento_id = $2 AND km = '-36' AND hora_real IS NULL`, [hora_apertura_real, eventoId]);
        }

        // 2. Fetch all scales config
        const scalesRes = await client.query("SELECT id, km FROM escalas WHERE activa = true");
        const scaleIdToKm = new Map();
        scalesRes.rows.forEach(s => scaleIdToKm.set(s.id, parseFloat(s.km)));

        // 3. Fetch current tracker state
        const trackerRes = await client.query("SELECT * FROM sica_llenado_seguimiento WHERE evento_id = $1 ORDER BY km ASC", [eventoId]);
        const trackerPoints = trackerRes.rows;

        // 4. SYNC FROM TELEMETRY (SICA Capture)
        console.log('--- SYNCING FROM TELEMETRY ---');
        const readingsRes = await client.query(`
            SELECT escala_id, nivel_m, creado_en 
            FROM lecturas_escalas 
            WHERE fecha = '2026-03-15' AND nivel_m > 0.1
            ORDER BY creado_en ASC
        `);

        for (const r of readingsRes.rows) {
            const readingKm = scaleIdToKm.get(r.escala_id);
            if (readingKm === undefined) continue;

            // Find matching tracker point (within 0.1km tolerance)
            const targetPoint = trackerPoints.find(p => Math.abs(parseFloat(p.km) - readingKm) < 0.1);
            
            if (targetPoint && !targetPoint.hora_real) {
                console.log(`✅ AUTO-CONFIRMING arrival at ${targetPoint.punto_nombre} (KM ${targetPoint.km}) at ${r.creado_en}`);
                await client.query(`
                    UPDATE sica_llenado_seguimiento 
                    SET hora_real = $1, nivel_arribo_m = $2, estado = 'CONFIRMADO' 
                    WHERE id = $3
                `, [r.creado_en, r.nivel_m, targetPoint.id]);
                
                // Update local object to reflect the change for subsequent calculations
                targetPoint.hora_real = r.creado_en;
                targetPoint.estado = 'CONFIRMADO';
            }
        }

        // 5. CALIBRATION OF SPEED
        console.log('--- CALIBRATING VELOCITY ---');
        // Refresh tracker points after auto-confirmation
        const refreshedRes = await client.query("SELECT * FROM sica_llenado_seguimiento WHERE evento_id = $1 ORDER BY km ASC", [eventoId]);
        const points = refreshedRes.rows;
        
        const confirmados = points.filter(p => p.hora_real).sort((a, b) => parseFloat(a.km) - parseFloat(b.km));
        
        let velCalibrada = 1.16; // Default
        let anchorKm = -36;
        let anchorTime = new Date(hora_apertura_real).getTime();

        if (confirmados.length >= 2) {
            // Find the last two points to get the most recent real velocity
            const last = confirmados[confirmados.length - 1];
            const prev = confirmados[confirmados.length - 2];
            
            const dDist = (parseFloat(last.km) - parseFloat(prev.km)) * 1000;
            const dT = (new Date(last.hora_real).getTime() - new Date(prev.hora_real).getTime()) / 1000;
            
            if (dT > 0) {
                velCalibrada = dDist / dT;
                // Clamp speed to realistic values
                velCalibrada = Math.max(0.3, Math.min(2.5, velCalibrada));
            }
            
            anchorKm = parseFloat(last.km);
            anchorTime = new Date(last.hora_real).getTime();
            console.log(`Calibrated Velocity: ${velCalibrada.toFixed(3)} m/s (using ${prev.punto_nombre} -> ${last.punto_nombre})`);
            console.log(`Current Anchor: KM ${anchorKm} reached at ${new Date(anchorTime).toLocaleString()}`);
        }

        // 6. RECALCULATE ETAS
        console.log('--- RECALCULATING ETAS ---');
        for (const p of points) {
            const pKm = parseFloat(p.km);
            if (p.hora_real || pKm <= anchorKm) continue;

            const dist = (pKm - anchorKm) * 1000;
            const tSeconds = dist / velCalibrada;
            
            const etaTime = new Date(anchorTime + tSeconds * 1000);
            
            await client.query(`
                UPDATE sica_llenado_seguimiento 
                SET hora_estimada_actual = $1, estado = 'EN_TRANSITO', 
                    recalculado_desde = $2
                WHERE id = $3
            `, [etaTime.toISOString(), `CALIBRACION REAL (${velCalibrada.toFixed(2)} m/s)`, p.id]);
            
            console.log(`KM ${pKm} -> ETA: ${etaTime.toLocaleString()}`);
        }

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
