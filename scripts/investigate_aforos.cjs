
const { Client } = require('pg');
async function main() {
    const client = new Client({ connectionString: 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres' });
    await client.connect();
    
    // Check points/escalas again
    const punto = await client.query("SELECT id FROM escalas WHERE nombre = 'K-44'");
    const puntoId = punto.rows[0]?.id;

    // Check active event
    const event = await client.query("SELECT evento_id FROM sica_llenado_seguimiento ORDER BY created_at DESC LIMIT 1");
    const eventId = event.rows[0]?.evento_id;

    // Check aforos table
    const aforosSample = await client.query("SELECT * FROM aforos LIMIT 1");
    console.log('Aforos columns:', Object.keys(aforosSample.rows[0] || {}));

    if (puntoId && eventId) {
        console.log('Punto ID:', puntoId);
        console.log('Evento ID:', eventId);
        
        // Let's see how aforos is structured
        if (aforosSample.rows.length === 0) {
            const cols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'aforos'");
            console.log('Aforos columns (schema):', cols.rows.map(r => r.column_name));
        }
    }

    await client.end();
}
main();
