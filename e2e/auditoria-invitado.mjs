// Auditoría COMPLETA de la cuenta INVITADO contra un entorno real. No escribe nada.
//   INVITADO_EMAIL=... INVITADO_PASSWORD=... [BASE_URL=...] node e2e/auditoria-invitado.mjs
// A) Navegador: cada ruta permitida (errores JS/red, desbordes, NaN/undefined, imágenes rotas), pestañas seguras,
//    generación de informes + marca "Vista de invitado" al imprimir, y rutas prohibidas.
// B) API de datos con el token del invitado: tablas sensibles = 0 filas, operativas > 0, vistas por módulo = 0.
// C) Edge functions con el token del invitado: lo esperado en cada una (solo las que NO escriben sin guard).
// D) Sesión: contraseña incorrecta rechazada, cierre de sesión.
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = process.env.BASE_URL || 'https://conchos-digital.vercel.app';
const API = 'https://dumfyrgwnshcgeibffvr.supabase.co';
const ANON = 'sb_publishable_CAsgbryMOz9iA6Bm6Dr60A_W2UqDgih';
const EMAIL = process.env.INVITADO_EMAIL, PASS = process.env.INVITADO_PASSWORD;
if (!EMAIL || !PASS) { console.error('Faltan INVITADO_EMAIL / INVITADO_PASSWORD'); process.exit(2); }

const PERMITIDAS = ['/', '/monitor-publico', '/escalas', '/canales', '/presas', '/clima', '/geo-monitor', '/analisis-historico', '/balance', '/modelacion-hidraulica'];
const PROHIBIDAS = ['/hidrometria', '/alertas', '/bitacora', '/ciclos', '/infraestructura', '/importar', '/reporte-oficial', '/protocolos', '/inteligencia-hidrica', '/conservacion', '/admin/invitados'];
const IGNORA_RED = /favicon|\.map$|realtime|websocket|ERR_ABORTED|tile|basemap|carto|arcgis|openstreetmap|googleapis|gstatic|sentinel-hub|copernicus|windy/i;
const IGNORA_CONSOLA = /Download the React DevTools|favicon|realtime|WebSocket|\[vite\]|Failed to load resource.*(tile|carto|arcgis)/i;
const NO_CLIC = /guardar|eliminar|borrar|enviar|crear|nuevo|importar|subir|delete|save|reset|limpiar|sincroniz|actualizar|aplicar|ejecutar|atender|cerrar sesi|salir|registrar|firmar|autorizar|publicar|desactivar|activar|editar|modificar/i;

const R = { ok: [], fallo: [], aviso: [] };
const reg = (tipo, msg) => { R[tipo].push(msg); console.log(`${{ ok: 'OK   ', fallo: 'FALLO', aviso: 'AVISO' }[tipo]} ${msg}`); };
const check = (c, m) => reg(c ? 'ok' : 'fallo', m);

// ───────────── Sesión (token) para B y C ─────────────
async function login(email, pass) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// ───────────── D) Sesión: credenciales malas ─────────────
const mala = await login(EMAIL, PASS + 'x');
check(mala.status === 400 || mala.status === 401, `D. contraseña incorrecta rechazada (HTTP ${mala.status})`);
const buena = await login(EMAIL, PASS);
check(buena.status === 200 && !!buena.body.access_token, 'D. credenciales correctas aceptadas');
const TOKEN = buena.body.access_token;
if (!TOKEN) { console.error('Sin token: no se puede seguir'); process.exit(1); }
const H = { apikey: ANON, Authorization: `Bearer ${TOKEN}` };

// ───────────── B) API de datos ─────────────
const cuenta = async (t) => {
  const r = await fetch(`${API}/rest/v1/${t}?select=*&limit=1`, { headers: { ...H, Prefer: 'count=exact' } });
  if (!r.ok) return { err: r.status };
  const m = (r.headers.get('content-range') || '').match(/\/(\d+|\*)$/);
  return { n: m && m[1] !== '*' ? Number(m[1]) : (await r.json()).length };
};
const SENSIBLES = ['entregas_modulo', 'autorizaciones_ciclo', 'solicitudes_riego_semanal', 'aforos', 'aforos_control', 'aforos_principales_diarios', 'mediciones', 'modulos_ciclos',
  'superficie_volumen_anual_modulo', 'volumen_modulo_mensual_provisional', 'balance_volumen_modulo', 'volumen_ciclo_modulo', 'volumenes_zona_diarios', 'resumen_ciclo', 'vw_pronostico_agotamiento_modulos',
  'perfiles_usuario_otros', 'hydric_documents', 'chat_conversations', 'chat_messages', 'cron_secretos', 'hydric_uso'];
for (const t of SENSIBLES) {
  if (t === 'perfiles_usuario_otros') continue;
  const c = await cuenta(t);
  if (c.err) reg(c.err === 401 || c.err === 403 || c.err === 404 ? 'ok' : 'aviso', `B. ${t}: sin acceso (HTTP ${c.err})`);
  else check(c.n === 0, `B. ${t}: ${c.n} filas visibles (esperado 0)`);
}
const OPERATIVAS = ['presas', 'lecturas_presas', 'lecturas_escalas', 'escalas', 'puntos_entrega', 'clima_estacion_lecturas', 'clima_pronostico_horario', 'ndvi_modulo_mensual_v2', 'hidro_estaciones', 'v_balance_hidrico_tramos', 'movimientos_presas'];
for (const t of OPERATIVAS) { const c = await cuenta(t); check(!c.err && c.n > 0, `B. ${t}: ${c.err ? 'HTTP ' + c.err : c.n + ' filas'} (esperado >0)`); }
{ // perfiles_usuario: solo su propia fila
  const r = await fetch(`${API}/rest/v1/perfiles_usuario?select=id,rol`, { headers: H }); const j = await r.json();
  check(Array.isArray(j) && j.length === 1 && j[0].rol === 'INVITADO', `B. perfiles_usuario: ve solo su fila (${Array.isArray(j) ? j.length : 'err'}, rol ${j?.[0]?.rol})`);
}
{ // RPC de lectura que usa el frontend
  for (const fn of ['fn_monitor_snapshot', 'fn_balance_hidrico_tramos', 'auth_cuenta_vigente']) {
    const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}' });
    check(r.ok, `B. rpc ${fn} responde (HTTP ${r.status})`);
  }
  const r = await fetch(`${API}/rest/v1/rpc/fn_invitados_expirar`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}' });
  check(!r.ok, `B. rpc fn_invitados_expirar NO ejecutable por el invitado (HTTP ${r.status})`);
}

// ───────────── C) Edge functions con el token del invitado ─────────────
const llama = async (fn, body = {}) => (await fetch(`${API}/functions/v1/${fn}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status;
const DEBE_403 = ['admin-invitados', 'weatherlink-sync', 'clima-pronostico-sync', 'clima-pronostico-alterno-sync', 'clima-historico-satelital-sync', 'presas-cila-sync', 'dem-boquilla-sync',
  'recalibra-curva-batimetrica', 'sentinel-truecolor-terreno-sync', 'extract-aforo-imagen', 'sentinel-ndvi-modulo-sync-v2', 'sentinel-ndvi-modulo-raster', 'sentinel-ndwi-vaso-sync', 'goes-dcp-sync', 'hydric-chat'];
for (const fn of DEBE_403) { const s = await llama(fn); check(s === 403 || s === 401, `C. ${fn}: HTTP ${s} (esperado 401/403)`); }
check((await llama('process-hydric-doc', { document_id: '00000000-0000-0000-0000-000000000000' })) >= 401, 'C. process-hydric-doc rechaza al invitado');
for (const fn of ['sentinel-status']) { const s = await llama(fn); check(s === 200, `C. ${fn} (consulta usada por Geo-Monitor): HTTP ${s} (esperado 200)`); }
reg('aviso', 'C. NO probadas por escribir y no tener guard de rol (revisar en código): generate-daily-report, sentinel-ndvi-modulo-sync (v1), hydraulic-engine (solo lectura, verify_jwt=false).');

// ───────────── A) Navegador ─────────────
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' }); // el SW recarga la página al activarse en un navegador nuevo y cierra los modales
const page = await ctx.newPage();
let errsJs = [], redMala = [], consola = [], escrituras = [];
page.on('pageerror', e => errsJs.push(String(e.message).slice(0, 150)));
page.on('console', m => { if (m.type() === 'error' && !IGNORA_CONSOLA.test(m.text())) consola.push(m.text().slice(0, 150)); });
page.on('response', r => { if (r.status() >= 400 && !IGNORA_RED.test(r.url())) redMala.push(`${r.status()} ${r.url().replace(API, '').slice(0, 90)}`); });
page.on('request', r => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && /rest\/v1\/(?!rpc\/)/.test(r.url())) escrituras.push(`${r.method()} ${r.url().slice(0, 90)}`); });

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[type="email"]', EMAIL); await page.fill('input[type="password"]', PASS);
await Promise.all([page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => null), page.click('button[type="submit"]')]);
await page.waitForTimeout(2500);
check(!new URL(page.url()).pathname.startsWith('/login'), 'A. login en navegador');

for (const ruta of PERMITIDAS) {
  errsJs = []; redMala = []; consola = [];
  await page.goto(`${BASE}${ruta}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const txt = await page.locator('body').innerText();
  check(!/Acceso restringido/i.test(txt) && txt.length > 200, `A. ${ruta}: carga con contenido (${txt.length} caracteres)`);
  check(!/\bNaN\b|\bundefined\b|\[object Object\]/.test(txt), `A. ${ruta}: sin NaN/undefined en pantalla`);
  check(errsJs.length === 0, `A. ${ruta}: sin errores de JS${errsJs.length ? ' → ' + errsJs[0] : ''}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 4, `A. ${ruta}: sin desborde horizontal (${overflow}px)`);
  const rotas = await page.evaluate(() => [...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.src && !/tile|carto/.test(i.src)).length);
  check(rotas === 0, `A. ${ruta}: sin imágenes rotas (${rotas})`);
  const rm = [...new Set(redMala)];
  if (rm.length) reg('aviso', `A. ${ruta}: respuestas HTTP ≥400 → ${rm.slice(0, 4).join(' | ')}`);
  // Pestañas seguras
  const tabs = page.locator('[role="tab"]:visible');
  const nt = Math.min(await tabs.count(), 6);
  for (let i = 0; i < nt; i++) { const t = tabs.nth(i); const lab = (await t.innerText().catch(() => '')).trim(); if (!lab || NO_CLIC.test(lab)) continue; await t.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(700); }
  if (nt) check(errsJs.length === 0, `A. ${ruta}: ${nt} pestañas recorridas sin errores de JS`);
  // Informes / infografías: abrir y comprobar la marca al imprimir
  const bots = page.locator('button:visible').filter({ hasText: /informe|infograf|reporte ejecutivo/i });
  const nb = Math.min(await bots.count(), 3);
  for (let i = 0; i < nb; i++) {
    const b = bots.nth(i); const lab = (await b.innerText().catch(() => '')).trim().replace(/\s+/g, ' ').slice(0, 40);
    if (NO_CLIC.test(lab)) continue;
    errsJs = [];
    await b.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(3500);
    // Muchos informes abren primero un asistente: se avanza con "Vista previa" / "Generar" (solo lectura).
    const sig = page.locator('button:visible').filter({ hasText: /^\s*(vista previa|ver informe|generar informe|previsualizar)\s*$/i }).first();
    if (await sig.count()) { await sig.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(6000); }
    const iframe = page.locator('iframe:visible').first();
    if (await iframe.count()) {
      const imp = page.locator('button:visible').filter({ hasText: /imprimir|pdf/i }).first();
      if (await imp.count()) {
        await imp.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(1500);
        const marca = await iframe.evaluate(el => !!el.contentDocument?.getElementById('sica-marca-invitado')).catch(() => false);
        check(marca, `A. ${ruta} · "${lab}": el informe impreso lleva la marca "Vista de invitado"`);
      } else reg('aviso', `A. ${ruta} · "${lab}": se abrió la vista previa, sin botón Imprimir/PDF visible`);
    } else reg('aviso', `A. ${ruta} · "${lab}": no abrió vista previa en iframe (puede ser PNG/otra salida)`);
    check(errsJs.length === 0, `A. ${ruta} · "${lab}": sin errores de JS al generarlo`);
    await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(500);
  }
  fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL(`./out/invitado_${ruta.replace(/\//g, '_') || 'home'}.png`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: false }).catch(() => {});
}
for (const r of PROHIBIDAS) {
  await page.goto(`${BASE}${r}`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500);
  check(/Acceso restringido|no está disponible para cuentas de invitado/i.test(await page.locator('body').innerText()), `A. ${r}: bloqueada`);
}
check(escrituras.length === 0, `A. ninguna escritura a tablas durante toda la sesión${escrituras.length ? ' → ' + escrituras.join(' | ') : ''}`);

// Cierre de sesión
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
const salir = page.getByRole('button', { name: /cerrar sesi|salir/i }).first();
if (await salir.count()) { await salir.click().catch(() => {}); await page.waitForTimeout(2000); check(new URL(page.url()).pathname.startsWith('/login'), 'D. cerrar sesión lleva a /login'); }
else reg('aviso', 'D. no se encontró botón de cerrar sesión visible');
await page.goto(`${BASE}/presas`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2000);
check(new URL(page.url()).pathname.startsWith('/login'), 'D. tras cerrar sesión, una ruta protegida redirige a /login');
await browser.close();

fs.writeFileSync(new URL('./out/auditoria-invitado.json', import.meta.url), JSON.stringify({ base: BASE, fecha: new Date().toISOString(), ok: R.ok.length, fallos: R.fallo, avisos: R.aviso }, null, 2));
console.log(`\n=== ${R.ok.length} OK · ${R.fallo.length} FALLOS · ${R.aviso.length} AVISOS ===`);
process.exit(R.fallo.length ? 1 : 0);
