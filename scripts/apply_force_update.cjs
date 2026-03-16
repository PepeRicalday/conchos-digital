
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
    const connectionString = 'postgresql://postgres:TEW77%3FSeqw-gi3p@db.dumfyrgwnshcgeibffvr.supabase.co:5432/postgres';
    const client = new Client({ connectionString });
    const migrationPath = 'c:\\Users\\peper\\Downloads\\Antigravity\\SICA 005\\conchos-digital\\supabase\\migrations\\20260315172000_force_critical_fix.sql';
    
    try {
        await client.connect();
        const sql = fs.readFileSync(migrationPath, 'utf8');
        console.log('--- EXECUTING FORCE UPDATE MIGRATION ---');
        await client.query(sql);
        console.log('✅ Migration applied successfully.');
    } catch (err) {
        console.error('❌ Error applying migration:', err);
    } finally {
        await client.end();
    }
}
main();
