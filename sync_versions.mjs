/**
 * sync_versions.mjs — Publica en Supabase la versión que acaba de desplegarse.
 *
 * `app_versions` es lo que VersionGuard consulta para decidir si un dispositivo
 * debe actualizarse. Si esta tabla no se actualiza tras el deploy, la red entera
 * se queda en la versión vieja sin enterarse: es el interruptor del refresco
 * forzado, no un registro decorativo.
 *
 * Antes tenía las versiones escritas a mano (quedaron congeladas en 2.5.5/2.5.3
 * mientras producción iba en 2.10.2) y usaba `require` dentro de un .mjs, así
 * que no corría. Ahora lee package.json de cada proyecto: una sola fuente de
 * verdad, la misma que alimenta el build.
 *
 *   node sync_versions.mjs                # sincroniza ambas apps
 *   node sync_versions.mjs control-digital
 *   node sync_versions.mjs --notas "Texto de release"
 *
 * Requiere SUPABASE_SERVICE_KEY (o VITE_SUPABASE_ANON_KEY si RLS lo permite).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://dumfyrgwnshcgeibffvr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_KEY) {
    console.error('✗ Falta SUPABASE_SERVICE_KEY (o VITE_SUPABASE_ANON_KEY) en el entorno.');
    process.exit(1);
}

// app_id en la tabla → package.json que manda su versión.
const APPS = {
    'control-digital': join(aqui, 'package.json'),
    'capture': join(aqui, '..', 'sica-capture', 'package.json'),
};

const args = process.argv.slice(2);
const idxNotas = args.indexOf('--notas');
const notas = idxNotas !== -1 ? args[idxNotas + 1] : null;
const objetivos = args.filter((a, i) => !a.startsWith('--') && i !== idxNotas + 1);
const aSincronizar = objetivos.length > 0 ? objetivos : Object.keys(APPS);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let fallos = 0;

for (const appId of aSincronizar) {
    const rutaPkg = APPS[appId];
    if (!rutaPkg) {
        console.error(`✗ app_id desconocido: ${appId} (válidos: ${Object.keys(APPS).join(', ')})`);
        fallos++;
        continue;
    }

    let version;
    try {
        version = JSON.parse(readFileSync(rutaPkg, 'utf8')).version;
    } catch (e) {
        console.error(`✗ ${appId}: no se pudo leer ${rutaPkg} — ${e.message}`);
        fallos++;
        continue;
    }

    const { data: previo } = await supabase
        .from('app_versions')
        .select('version')
        .eq('app_id', appId)
        .single();

    const cambios = {
        version,
        // Se iguala al de la versión publicada: VersionGuard usa `version` para
        // el refresco normal y reserva `min_supported_version` para bloquear
        // bundles incompatibles. Igualarlos aquí mantiene ese bloqueo alineado
        // con lo que realmente está desplegado.
        min_supported_version: version,
        build_hash: `v${version}`,
        actualizado_en: new Date().toISOString(),
        ...(notas ? { release_notes: notas } : {}),
    };

    // El .select() no es decorativo: bajo RLS, un UPDATE sin permiso NO
    // devuelve error — PostgREST responde 200 afectando cero filas. Sin
    // comprobar las filas devueltas, el script anunciaba "✓ sincronizado"
    // mientras la tabla seguía intacta y la red entera se quedaba sin
    // actualizar. La escritura solo cuenta si vuelve la fila modificada.
    const { data: escrito, error } = await supabase
        .from('app_versions')
        .update(cambios)
        .eq('app_id', appId)
        .select('version');

    if (error) {
        console.error(`✗ ${appId}: ${error.message}`);
        fallos++;
    } else if (!escrito || escrito.length === 0) {
        console.error(`✗ ${appId}: la escritura no afectó ninguna fila (RLS o app_id inexistente).`);
        console.error('  La clave anon no puede escribir en app_versions. Exporta SUPABASE_SERVICE_KEY.');
        fallos++;
    } else {
        const antes = previo?.version ?? '—';
        const flecha = antes === version ? `${version} (sin cambio)` : `${antes} → ${version}`;
        console.log(`✓ ${appId.padEnd(16)} ${flecha}`);
    }
}

if (fallos > 0) {
    console.error(`\n${fallos} app(s) no se sincronizaron. Los dispositivos NO recibirán la actualización.`);
    process.exit(1);
}

console.log('\nVersiones publicadas. Los dispositivos se actualizarán en ≤10 min (o al volver a primer plano).');
