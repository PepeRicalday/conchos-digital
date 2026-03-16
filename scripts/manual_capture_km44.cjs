
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        
        // 1. Find the point for KM 44
        const puntoRes = await client.query("SELECT id, nombre, km FROM puntos_monitoreo WHERE nombre ILIKE '%44%' OR km = 44");
        console.log('Punto KM 44:', puntoRes.rows);
        const puntoId = puntoRes.rows[0]?.id;

        // 2. Find active event
        const eventRes = await client.query("SELECT id FROM eventos_canal WHERE esta_activo = true LIMIT 1");
        console.log('Active Event:', eventRes.rows);
        const eventId = eventRes.rows[0]?.id;

        // 3. Find a user ID to associate with (using a known management ID if possible, or the last one)
        const userRes = await client.query("SELECT id, email FROM auth.users LIMIT 1");
        // Wait, auth schema might be restricted. Let's look at last medicion.
        const lastMedRes = await client.query("SELECT creado_por FROM mediciones ORDER BY fecha_captura DESC LIMIT 1");
        const userId = lastMedRes.rows[0]?.creado_por;

        if (puntoId && eventId && userId) {
            const fecha = '2026-03-15 23:30:00';
            const escalaArriba = 0.50;
            const escalaAbajo = 0.50;
            const radial = 0.80; // 80cm

            // Insert measurement
            const insertQuery = `
                INSERT INTO mediciones (
                    punto_id, 
                    evento_id, 
                    escala_arriba, 
                    escala_abajo, 
                    radial_1, 
                    fecha_captura, 
                    creado_por,
                    fuente,
                    verificado
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id;
            `;
            
            const values = [puntoId, eventId, escalaArriba, escalaAbajo, radial, fecha, userId, 'MANUAL_SQL', true];
            const res = await client.query(insertQuery, values);
            console.log('✅ Medición insertada con ID:', res.rows[0].id);
        } else {
            console.error('❌ Missing data:', { puntoId, eventId, userId });
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}
main();
