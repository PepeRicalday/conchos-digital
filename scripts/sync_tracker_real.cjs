
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    const eventoId = 'b5262775-99ed-460e-aba2-6d807494474e';

    try {
        await client.connect();

        // 1. Get Event Data
        console.log('--- SYNCING EVENT DATA ---');
        const eventRes = await client.query("SELECT hora_apertura_real, gasto_solicitado_m3s FROM sica_eventos_log WHERE id = $1", [eventoId]);
        const { hora_apertura_real, gasto_solicitado_m3s } = eventRes.rows[0];
        const Q = parseFloat(gasto_solicitado_m3s || 30);
        
        if (hora_apertura_real) {
            console.log(`Confirming Presa at ${hora_apertura_real}`);
            await client.query(`
                UPDATE sica_llenado_seguimiento 
                SET hora_real = $1, estado = 'CONFIRMADO' 
                WHERE evento_id = $2 AND km = -36
            `, [hora_apertura_real, eventoId]);
        }

        // 2. Fetch all scales to map KM to escala_id
        const scalesRes = await client.query("SELECT id, km FROM escalas WHERE activa = true");
        const kmToScaleId = new Map();
        scalesRes.rows.forEach(s => kmToScaleId.set(parseFloat(s.km), s.id));

        // 3. Check for real readings today
        console.log('--- CHECKING SCADA READINGS ---');
        const readingsRes = await client.query(`
            SELECT escala_id, nivel_m, hora_lectura, fecha, creado_en 
            FROM lecturas_escalas 
            WHERE fecha = '2026-03-15' AND nivel_m > 0.1
            ORDER BY creado_en ASC
        `);

        for (const r of readingsRes.rows) {
            // Find which KM this scale belongs to
            const km = Array.from(kmToScaleId.entries()).find(([k, id]) => id === r.escala_id)?.[0];
            if (km !== undefined) {
                console.log(`Found reading for KM ${km} at ${r.hora_lectura} (${r.creado_en})`);
                // Confirm arrival in tracker
                await client.query(`
                    UPDATE sica_llenado_seguimiento 
                    SET hora_real = $1, nivel_arribo_m = $2, estado = 'CONFIRMADO' 
                    WHERE evento_id = $3 AND km = $4 AND hora_real IS NULL
                `, [r.creado_en, r.nivel_m, eventoId, km]);
            }
        }

        // 4. Recalculate ETAs (Theoretical + Calibrated)
        // Theoretical speeds
        const DIST_RIO = 36000;
        const VEL_CANAL = 1.16;
        const vRio = 0.5 * Math.pow(Q, 0.4) + 0.5;
        const tRio = DIST_RIO / vRio;

        const pointsRes = await client.query("SELECT * FROM sica_llenado_seguimiento WHERE evento_id = $1 ORDER BY km ASC", [eventoId]);
        const points = pointsRes.rows;

        console.log('--- RECALCULATING ETAS ---');
        // Simple logic: find last confirmed point as Anchor
        let anchorKm = -36;
        let anchorTime = new Date(hora_apertura_real).getTime();
        
        const confirmados = points.filter(p => p.hora_real).sort((a, b) => parseFloat(b.km) - parseFloat(a.km));
        if (confirmados.length > 0) {
            anchorKm = parseFloat(confirmados[0].km);
            anchorTime = new Date(confirmados[0].hora_real).getTime();
            console.log(`Anchor: KM ${anchorKm} at ${new Date(anchorTime).toISOString()}`);
        }

        for (const p of points) {
            const pKm = parseFloat(p.km);
            if (p.hora_real) continue; // Skip already reached

            let segRestante = 0;
            if (anchorKm === -36) {
                if (pKm === 0) segRestante = tRio;
                else segRestante = tRio + (pKm * 1000 / VEL_CANAL);
            } else {
                segRestante = (pKm - anchorKm) * 1000 / VEL_CANAL;
            }

            const newEta = new Date(anchorTime + segRestante * 1000).toISOString();
            await client.query(`
                UPDATE sica_llenado_seguimiento 
                SET hora_estimada_actual = $1, estado = 'EN_TRANSITO'
                WHERE id = $2
            `, [newEta, p.id]);
            console.log(`KM ${pKm} ETA: ${newEta}`);
        }

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
main();
