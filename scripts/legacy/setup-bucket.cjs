const fs = require('fs');

async function main() {
    const env = fs.readFileSync('.env.local', 'utf8');
    const urlMatches = env.match(/VITE_SUPABASE_URL="([^"]+)"/);
    const keyMatches = env.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/);

    if (!urlMatches || !keyMatches) {
        console.error("No se encontraron las variables en .env.local");
        return;
    }

    const SUPABASE_URL = urlMatches[1];
    const SUPABASE_SERVICE_ROLE_KEY = keyMatches[1];

    console.log("Conectando a Supabase:", SUPABASE_URL);

    // 1. Crear el bucket
    const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            id: 'hydric-knowledge',
            name: 'hydric-knowledge',
            public: false
        })
    });

    const data = await res.json();
    console.log("Bucket creation response:", data);

    // 2. Aplicar políticas SQL vía la API REST de Postgres Functions si estuviera disponible, o le dejamos eso al GUI.
    // La forma manual de crear buckets via API REST suele fallar si RLS policies de Storage fallan. 
    // Wait, la API Storage bypassa el SQL editor permission constraints porque se corre como Service Role.
}

main().catch(console.error);
