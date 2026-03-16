
const { Client } = require('pg');

async function checkMovementsToday() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Chihuahua' });
        console.log('--- Movimientos del Día (sv-SE) ---');
        const res = await client.query(`
            SELECT m.*, p.nombre_corto 
            FROM public.movimientos_presas m
            LEFT JOIN public.presas p ON m.presa_id = p.id
            WHERE CAST(m.fecha_hora AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chihuahua' AS DATE) = $1
            ORDER BY m.fecha_hora DESC;
        `, [today]);
        console.table(res.rows);

        console.log('\n--- Analizando lecturas_presas ---');
        const resL = await client.query(`
            SELECT l.*, p.nombre_corto
            FROM public.lecturas_presas l
            LEFT JOIN public.presas p ON l.presa_id = p.id
            WHERE l.fecha = $1
            ORDER BY l.creado_en DESC;
        `, [today]);
        console.table(resL.rows);

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

checkMovementsToday();
