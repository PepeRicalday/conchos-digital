
const { Client } = require('pg');
const fs = require('fs');

async function executeMigration() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({
        connectionString: connectionString,
    });

    try {
        await client.connect();
        console.log('Conectado a Supabase PostgreSQL con éxito.');

        const sql = fs.readFileSync('supabase/migrations/20260309210000_mejor_2_micro_balances.sql', 'utf8');
        console.log('Ejecutando Mejora 2: Micro-Balances...');

        await client.query(sql);
        console.log('✅ Migración aplicada correctamente mediante PG Client.');

    } catch (err) {
        console.error('❌ Error ejecutando la migración:', err.message);
    } finally {
        await client.end();
    }
}

executeMigration();
