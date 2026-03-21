const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function executeMigration() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({
        connectionString: connectionString,
    });

    const migrationFile = 'supabase/migrations/20260320212000_actualizacion_puntos_entrega.sql';

    try {
        await client.connect();
        console.log('--- Conectado a Supabase PostgreSQL ---');
        
        const sql = fs.readFileSync(migrationFile, 'utf8');
        console.log(`Ejecutando actualización de Puntos de Entrega (${migrationFile})...`);

        await client.query(sql);
        console.log('✅ Puntos de Entrega actualizados y aplicados en la base de datos.');

    } catch (err) {
        console.error('❌ Error aplicando los puntos de entrega:', err.message);
    } finally {
        await client.end();
    }
}

executeMigration();
