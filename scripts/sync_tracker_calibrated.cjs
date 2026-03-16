
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    const eventoId = 'b5262775-99ed-460e-aba2-6d807494474e';

    try {
        await client.connect();

        // 1. Get Event Data
        const eventRes = await client.query("SELECT hora_apertura_real, gasto_solicitado_m3s FROM sica_eventos_log WHERE id = $1", [eventoId]);
        const { hora_apertura_real, gasto_solicitado_m3s } = eventRes.rows[0];
        const Q = parseFloat(gasto_solicitado_m3s || 30);
        
        // Ensure Presa is confirmed
        if (hora_apertura_real) {
            await client.query(`UPDATE sica_llenado_seguimiento SET hora_real = $1, estado = 'CONFIRMADO' WHERE evento_id = $2 AND km = -36 AND hora_real IS NULL`, [hora_apertura_real, eventoId]);
        }

        // 2. Fetch all scales to map KM to escala_id
        const scalesRes = await client.query("SELECT id, km FROM escalas WHERE activa = true");
        const kmToScaleId = new Map();
        scalesRes.rows.forEach(s => kmToScaleId.set(parseFloat(s.km), s.id));

        // 3. Sync from SCADA (lecturas_escalas)
        console.log('--- SYNCING FROM TELEMETRY ---');
        const readingsRes = await client.query(`
            SELECT escala_id, nivel_m, hora_lectura, fecha, creado_en 
            FROM lecturas_escalas 
            WHERE fecha = '2026-03-15' AND nivel_m > 0.1
            ORDER BY creado_en ASC
        `);

        for (const r of readingsRes.rows) {
            const km = Array.from(kmToScaleId.entries()).find(([k, id]) => id === r.escala_id)?.[0];
            if (km !== undefined) {
                // Determine actual arrival (the first time it went over 0.1m)
                await client.query(`
                    UPDATE sica_llenado_seguimiento 
                    SET hora_real = $1, nivel_arribo_m = $2, estado = 'CONFIRMADO' 
                    WHERE evento_id = $3 AND km = $4 AND hora_real IS NULL
                `, [r.creado_en, r.nivel_m, eventoId, km]);
            }
        }

        // 4. CALIBRATION OF SPEED
        console.log('--- CALIBRATING VELOCITY ---');
        const pointsRes = await client.query("SELECT * FROM sica_llenado_seguimiento WHERE evento_id = $1 ORDER BY km ASC", [eventoId]);
        const points = pointsRes.rows;
        
        const confirmados = points.filter(p => p.hora_real).sort((a, b) => parseFloat(a.km) - parseFloat(b.km));
        
        let velCalibrada = 1.16; // Default canal speed
        let anchorKm = -36;
        let anchorTime = new Date(hora_apertura_real).getTime();

        if (confirmados.length >= 2) {
            // Calculate velocity between the last two confirmed points
            const last = confirmados[confirmados.length - 1];
            const prev = confirmados[confirmados.length - 2];
            
            const dDist = (parseFloat(last.km) - parseFloat(prev.km)) * 1000;
            const dT = (new Date(last.hora_real).getTime() - new Date(prev.hora_real).getTime()) / 1000;
            
            if (dT > 0) {
                velCalibrada = dDist / dT;
                // Clamp to reasonable values (0.3 to 2.5 m/s)
                velCalibrada = Math.max(0.3, Math.min(2.5, velCalibrada));
            }
            
            anchorKm = parseFloat(last.km);
            anchorTime = new Date(last.hora_real).getTime();
            console.log(`Calibrated Velocity: ${velCalibrada.toFixed(2)} m/s (using KM ${prev.km} to KM ${last.km})`);
            console.log(`Current Anchor: KM ${anchorKm} at ${new Date(anchorTime).toLocaleString()}`);
        } else if (confirmados.length === 1) {
            anchorKm = parseFloat(confirmados[0].km);
            anchorTime = new Date(confirmados[0].hora_real).getTime();
            console.log(`Simple Anchor: KM ${anchorKm} (no calibration possible yet)`);
        }

        // 5. RECALCULATE ETAS
        console.log('--- RECALCULATING ETAS ---');
        for (const p of points) {
            const pKm = parseFloat(p.km);
            if (p.hora_real || pKm <= anchorKm) continue;

            const dist = (pKm - anchorKm) * 1000;
            const tSeconds = dist / velCalibrada;
            
            // ETA must be in the FUTURE relative to anchorTime
            const etaTime = new Date(anchorTime + tSeconds * 1000);
            
            await client.query(`
                UPDATE sica_llenado_seguimiento 
                SET hora_estimada_actual = $1, estado = 'EN_TRANSITO', 
                    recalculado_desde = $2
                WHERE id = $3
            `, [etaTime.toISOString(), (confirmados.length >= 2 ? 'CALIBRACION REAL' : 'MODELO TEORICO'), p.id]);
            
            console.log(`KM ${pKm} -> ETA: ${etaTime.toLocaleString()}`);
        }

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
