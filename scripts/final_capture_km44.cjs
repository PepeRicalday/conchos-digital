
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('--- INICIANDO CAPTURA MANUAL KM 44 ---');

        const puntoId = 'ESC-004'; // K-44
        const fecha = '2026-03-15';
        const hora = '23:30:00';
        const timestamp = '2026-03-15 23:30:00';
        const escalaArr = 0.50;
        const escalaAbj = 0.50;
        const radial = 0.80;

        // 1. Insertar en lecturas_escalas
        const insertLectura = await client.query(`
            INSERT INTO lecturas_escalas (
                escala_id, 
                fecha, 
                hora_lectura, 
                nivel_m, 
                nivel_abajo_m, 
                apertura_radiales_m, 
                responsable, 
                notas
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id;
        `, [puntoId, fecha, hora, escalaArr, escalaAbj, radial, 'ADMIN_MANUAL', 'Captura de cierre de día 15/Marzo - 23:30']);
        
        console.log('✅ Lectura insertada ID:', insertLectura.rows[0].id);

        // 2. Actualizar sica_llenado_seguimiento
        const updateLlenado = await client.query(`
            UPDATE sica_llenado_seguimiento 
            SET 
                hora_real = $1, 
                estado = 'LLEGÓ', 
                nivel_arribo_m = $2,
                notas = 'Arribo reportado manual v2.1.0'
            WHERE km = 44 OR punto_nombre ILIKE '%44%';
        `, [timestamp, escalaArr]);
        
        console.log('✅ Seguimiento llenado actualizado:', updateLlenado.rowCount, 'filas.');

        // 3. Opcional: Actualizar sica_canal_status si existe
        await client.query(`
            UPDATE sica_canal_status 
            SET 
                last_km_reached = 44,
                last_update = now()
            WHERE id = (SELECT id FROM sica_canal_status LIMIT 1);
        `).catch(e => console.log('Sica status update skipped (optional)'));

    } catch (err) {
        console.error('❌ Error en captura manual:', err);
    } finally {
        await client.end();
    }
}
main();
