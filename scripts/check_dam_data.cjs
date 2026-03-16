
const { Client } = require('pg');

async function checkLatestMovements() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({
        connectionString: connectionString,
    });

    try {
        await client.connect();
        
        console.log('--- Ultimos Movimientos Presas ---');
        const resM = await client.query(`
            SELECT m.*, p.nombre_corto 
            FROM public.movimientos_presas m
            LEFT JOIN public.presas p ON m.presa_id = p.id
            ORDER BY m.fecha_hora DESC
            LIMIT 5;
        `);
        console.table(resM.rows);

        console.log('\n--- Ultimos Registros Presas (Lecturas Diarias) ---');
        const resR = await client.query(`
            SELECT r.*, p.nombre_corto 
            FROM public.registros_presas r
            LEFT JOIN public.presas p ON r.presa_id = p.id
            ORDER BY r.fecha DESC, r.creado_en DESC
            LIMIT 5;
        `);
        console.table(resR.rows);

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

checkLatestMovements();
