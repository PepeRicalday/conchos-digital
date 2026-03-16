
const { Client } = require('pg');

async function checkMovementsFull() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT m.id, m.presa_id, m.fecha_hora, m.gasto_m3s, p.nombre_corto, m.fuente_dato
            FROM public.movimientos_presas m
            LEFT JOIN public.presas p ON m.presa_id = p.id
            ORDER BY m.fecha_hora DESC
            LIMIT 10;
        `);
        console.log('--- MOVIMIENTOS RECIENTES ---');
        res.rows.forEach(r => {
            console.log(`[${r.fecha_hora.toISOString()}] Gasto: ${r.gasto_m3s} | Presa: ${r.nombre_corto} | Fuente: ${r.fuente_dato} | ID: ${r.id}`);
        });

        console.log('\n--- LECTURAS DIARIAS (lecturas_presas) ---');
        const resL = await client.query(`
            SELECT l.fecha, l.presa_id, l.extraccion_total_m3s, p.nombre_corto
            FROM public.lecturas_presas l
            LEFT JOIN public.presas p ON l.presa_id = p.id
            ORDER BY l.fecha DESC, l.creado_en DESC
            LIMIT 5;
        `);
        resL.rows.forEach(r => {
            console.log(`[${r.fecha}] Gasto: ${r.extraccion_total_m3s} | Presa: ${r.nombre_corto}`);
        });

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

checkMovementsFull();
