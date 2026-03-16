
const { Client } = require('pg');

async function checkK0Readings() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({
        connectionString: connectionString,
    });

    try {
        await client.connect();
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Chihuahua' });
        const res = await client.query(`
            SELECT l.*, e.nombre, e.km 
            FROM public.lecturas_escalas l
            JOIN public.escalas e ON l.escala_id = e.id
            WHERE e.km = 0 AND l.fecha = $1
            ORDER BY l.hora_lectura DESC;
        `, [today]);
        console.log('Today K0 Readings:', res.rows);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

checkK0Readings();
