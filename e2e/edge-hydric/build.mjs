// Empaqueta supabase/functions/hydric-chat/index.ts para ejecutarlo en Node (sin Deno) contra un Supabase simulado.
//   npm i --no-save @anthropic-ai/sdk@0.135.0      (la misma versión que importa la función)
//   node e2e/edge-hydric/build.mjs && node e2e/edge-hydric/escenarios.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sdk = path.join(raiz, 'node_modules/@anthropic-ai/sdk/index.mjs');
if (!fs.existsSync(sdk)) { console.error('Falta el SDK: npm i --no-save @anthropic-ai/sdk@0.135.0'); process.exit(1); }

fs.mkdirSync(path.join(raiz, 'e2e/out'), { recursive: true });
const vacio = path.join(raiz, 'e2e/out/edge-hydric-vacio.mjs');
fs.writeFileSync(vacio, 'export {};\n');
const mapa = {
    'https://esm.sh/@supabase/supabase-js@2.45.4': path.join(raiz, 'e2e/edge-hydric/fake_supabase.mjs'),
    'jsr:@supabase/functions-js/edge-runtime.d.ts': vacio,
    'npm:@anthropic-ai/sdk@0.135.0': sdk,
};

await build({
    stdin: { contents: "import '../../supabase/functions/hydric-chat/index.ts';", resolveDir: path.join(raiz, 'e2e/edge-hydric'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', logLevel: 'error',
    outfile: path.join(raiz, 'e2e/out/edge-hydric-driver.mjs'),
    // Globales del runtime de Edge Functions que la función espera.
    banner: { js: 'globalThis.Deno={env:{get:(k)=>process.env[k]},serve:(h)=>{globalThis.__handler=h}};globalThis.Supabase={ai:{Session:class{async run(){return new Array(384).fill(0.01)}}}};export const handler=()=>globalThis.__handler;' },
    plugins: [{ name: 'deno-shims', setup(b) { b.onResolve({ filter: /^(https:|jsr:|npm:)/ }, (a) => (mapa[a.path] ? { path: mapa[a.path] } : { errors: [{ text: `sin mapa para ${a.path}` }] })); } }],
});
console.log('ok → e2e/out/edge-hydric-driver.mjs');
