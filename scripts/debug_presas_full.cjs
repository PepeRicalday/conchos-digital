
const { Client } = require('pg');

async function debugPresas() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        
        console.log('--- ALL LECTURAS PRESAS ---');
        const res = await client.query(`
            SELECT l.id, l.presa_id, l.fecha, l.extraccion_total_m3s, p.nombre, p.nombre_corto 
            FROM public.lecturas_presas l
            JOIN public.presas p ON l.presa_id = p.id
            ORDER BY l.fecha DESC, l.creado_en DESC;
        `);
        res.rows.forEach(r => {
            console.log(`[${r.fecha.toISOString().split('T')[0]}] ${r.nombre_corto} (${r.nombre}): ${r.extraccion_total_m3s} m3/s | ID: ${r.id}`);
        });

        console.log('\n--- ALL MOVIMIENTOS PRESAS ---');
        const resM = await client.query(`
            SELECT m.id, m.presa_id, m.fecha_hora, m.gasto_m3s, p.nombre_corto, m.fuente_dato
            FROM public.movimientos_presas m
            JOIN public.presas p ON m.presa_id = p.id
            ORDER BY m.fecha_hora DESC;
        `);
        resM.rows.forEach(r => {
            console.log(`[${r.fecha_hora.toISOString()}] ${r.nombre_corto}: ${r.gasto_m3s} m3/s | Source: ${r.fuente_dato}`);
        });

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

debugPresas();
