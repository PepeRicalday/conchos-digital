
const { Client } = require('pg');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('--- CORRIGIENDO HORA DE LLEGADA KM 44 (Ajuste TZ) ---');

        // El usuario quiere 11:30 PM del 15 de Marzo (CST).
        // CST = UTC-6. Entonces 23:30 CST = 05:30 UTC del 16 de Marzo.
        const correctTimestamp = '2026-03-16 05:30:00+00';

        // 1. Corregir en sica_llenado_seguimiento
        const updateLlenado = await client.query(`
            UPDATE sica_llenado_seguimiento 
            SET 
                hora_real = $1,
                notas = 'Arribo reportado: 15/Marzo 23:30 CST (Sincronizado)'
            WHERE km = 44 OR punto_nombre ILIKE '%44%';
        `, [correctTimestamp]);
        
        console.log('✅ Seguimiento llenado corregido:', updateLlenado.rowCount, 'filas.');

        // 2. Verificar lecturas_escalas
        // El campo 'fecha' es DATE (solo día). 'hora_lectura' es TIME (23:30:00).
        // Eso ya está correcto para el 15/Marzo.
        
        const check = await client.query("SELECT hora_real FROM sica_llenado_seguimiento WHERE km = 44");
        console.log('Nueva hora_real (UTC):', check.rows[0].hora_real);

    } catch (err) {
        console.error('❌ Error en corrección:', err);
    } finally {
        await client.end();
    }
}
main();
