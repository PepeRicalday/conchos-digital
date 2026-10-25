// Prueba funcional de la edge function sentinel-ndvi-modulo-raster (correr TRAS desplegarla).
//   node e2e/ndvi-raster-prueba.mjs [AAAA-MM] [modulo] [--dry]
// Requiere en el entorno (no se guardan en el repo):
//   SUPABASE_URL                 (p. ej. https://xxxx.supabase.co)
//   NDVI_SYNC_SECRET             valor de public.cron_secretos.nombre='ndvi_sync_v2' (cabecera x-cron-secret)
//     o bien SUPABASE_USER_JWT   (JWT de un usuario con rol SRL)
// Escribe e2e/_salida/ndvi-raster-M{n}-{mes}.png (+ .json con los metadatos) y verifica el contrato.
// Con --dry solo valida autorización/mes/módulo (no gasta cuota de CDSE).
// Pasos recomendados: 1) --dry, 2) un módulo real (llamada fría), 3) repetir (debe volver cache:'hit').
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dry = process.argv.includes('--dry');
const hoy = new Date();
const mesDefecto = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const mes = args[0] ?? mesDefecto;
const modulo = Number(args[1] ?? 1);

const { SUPABASE_URL, NDVI_SYNC_SECRET, SUPABASE_USER_JWT } = process.env;
if (!SUPABASE_URL || !(NDVI_SYNC_SECRET || SUPABASE_USER_JWT)) {
    console.error('Faltan SUPABASE_URL y NDVI_SYNC_SECRET (o SUPABASE_USER_JWT) en el entorno.');
    process.exit(2);
}
const fallos = [];
const ok = (c, m) => { if (!c) fallos.push(m); console.log(`${c ? '✓' : '✗'} ${m}`); };

const url = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/sentinel-ndvi-modulo-raster`;
const cabeceras = { 'Content-Type': 'application/json', ...(NDVI_SYNC_SECRET ? { 'x-cron-secret': NDVI_SYNC_SECRET } : { Authorization: `Bearer ${SUPABASE_USER_JWT}` }) };
const llama = async (body, h = cabeceras) => {
    const t0 = Date.now();
    const r = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    return { status: r.status, j, ms: Date.now() - t0 };
};

// Seguridad y validación (no gastan cuota)
ok((await llama({ mes, numero_modulo: modulo }, { 'Content-Type': 'application/json' })).status === 401, 'sin credenciales → 401');
ok((await llama({ mes: '2099-01', numero_modulo: modulo })).status === 400, 'mes futuro → 400');
ok((await llama({ mes: hoy.toISOString().slice(0, 7), numero_modulo: modulo })).status === 400, 'mes en curso → 400');
ok((await llama({ mes, numero_modulo: 99 })).status === 400, 'módulo inexistente → 400');
const d = await llama({ mes, numero_modulo: modulo, dry_run: true });
ok(d.status === 200 && d.j?.dry_run === true && d.j?.ancho > 0, `dry_run → 200 (${d.j?.ancho}x${d.j?.alto} px a ${d.j?.resolucion_m} m)`);
if (dry) { console.log(JSON.stringify(d.j, null, 2)); process.exit(fallos.length ? 1 : 0); }

const r = await llama({ mes, numero_modulo: modulo });
console.log(`respuesta ${r.status} en ${r.ms} ms, cache=${r.j?.cache}`);
if (r.status !== 200) { console.error(JSON.stringify(r.j)); process.exit(1); }
const j = r.j;
if (j.sin_datos) {
    ok(j.png_base64 === null, 'mes sin datos válidos → png_base64 null (hueco explícito)');
} else {
    ok(typeof j.png_base64 === 'string' && j.png_base64.length > 100, 'png_base64 presente');
    const png = Buffer.from(j.png_base64, 'base64');
    ok(png.subarray(1, 4).toString() === 'PNG', 'es un PNG');
    ok(png.readUInt32BE(16) === j.ancho && png.readUInt32BE(20) === j.alto, `tamaño PNG = ancho/alto declarados (${j.ancho}x${j.alto})`);
    ok(png[25] === 6, 'PNG RGBA (con transparencia)');
    mkdirSync(new URL('./_salida/', import.meta.url), { recursive: true });
    const base = `ndvi-raster-M${modulo}-${mes}`;
    writeFileSync(new URL(`./_salida/${base}.png`, import.meta.url), png);
    const { png_base64, ...meta } = j;
    writeFileSync(new URL(`./_salida/${base}.json`, import.meta.url), JSON.stringify(meta, null, 2));
    console.log(`PNG guardado: e2e/_salida/${base}.png (${(png.length / 1024).toFixed(0)} KB)`);
}
ok(Array.isArray(j.bbox) && j.bbox.length === 4 && j.bbox[0] < j.bbox[2] && j.bbox[1] < j.bbox[3], `bbox CRS84 válido ${JSON.stringify(j.bbox)}`);
ok(j.metodo === 'scl-mediana-v1', 'método scl-mediana-v1');
ok(j.resolucion_m >= 20, `resolución efectiva ≥ 20 m (${j.resolucion_m})`);
ok(j.n_escenas === null || j.n_escenas >= 0, `n_escenas = ${j.n_escenas}`);
ok(j.pct_pixeles_validos === null || (j.pct_pixeles_validos >= 0 && j.pct_pixeles_validos <= 1), `pct_pixeles_validos = ${j.pct_pixeles_validos}`);
ok(/no es NDVI de parcela/i.test(j.nota ?? ''), 'nota declara que no es NDVI de parcela');
if (r.j.cache === 'miss') {
    const r2 = await llama({ mes, numero_modulo: modulo });
    ok(r2.j?.cache === 'hit', `segunda llamada sale de la caché (${r2.ms} ms vs ${r.ms} ms)`);
}
console.log(fallos.length ? `\n${fallos.length} fallo(s)` : '\nTodo en orden');
process.exit(fallos.length ? 1 : 0);
