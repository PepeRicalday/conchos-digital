// Prueba de la cuenta INVITADO (solo lectura) en un entorno real. NO escribe nada: solo navega y comprueba.
//   Uso:  INVITADO_EMAIL=... INVITADO_PASSWORD=... [BASE_URL=https://conchos-digital.vercel.app] node e2e/invitado.mjs
// Comprueba: login, rutas permitidas cargan sin error de JS/red crítico, rutas prohibidas muestran "Acceso restringido",
// el menú no ofrece secciones de escritura, y no hay botones de captura en Presas / Balance.
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = process.env.BASE_URL || 'https://conchos-digital.vercel.app';
const EMAIL = process.env.INVITADO_EMAIL, PASS = process.env.INVITADO_PASSWORD;
if (!EMAIL || !PASS) { console.error('Faltan INVITADO_EMAIL / INVITADO_PASSWORD'); process.exit(2); }

const PERMITIDAS = ['/', '/monitor-publico', '/escalas', '/canales', '/presas', '/clima', '/geo-monitor', '/analisis-historico', '/balance', '/modelacion-hidraulica'];
const PROHIBIDAS = ['/hidrometria', '/alertas', '/bitacora', '/ciclos', '/infraestructura', '/importar', '/reporte-oficial', '/protocolos', '/inteligencia-hidrica', '/conservacion', '/admin/invitados'];
const MENU_PROHIBIDO = ['Hidrometría', 'Alertas', 'Bitácora', 'Ciclo Agrícola', 'Infraestructura', 'Importar', 'Reporte Oficial', 'Consultoría', 'Protocolos', 'Conservación', 'Cuentas de invitado'];

const fallos = []; const ok = [];
const check = (cond, msg) => { (cond ? ok : fallos).push(msg); console.log(`${cond ? 'OK  ' : 'FALLO'} ${msg}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errsJs = []; const writes = [];
page.on('pageerror', e => errsJs.push(String(e.message).slice(0, 160)));
// Escritura = POST/PATCH/PUT/DELETE a una TABLA de la API. Los /rpc/ son POST pero de lectura (fn_*), se cuentan aparte.
page.on('request', r => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && /rest\/v1/.test(r.url()) && !/rest\/v1\/rpc\//.test(r.url())) writes.push(`${r.method()} ${r.url().slice(0, 100)}`);
});

// ── Login ──
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASS);
await Promise.all([page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => null), page.click('button[type="submit"]')]);
await page.waitForTimeout(2500);
check(!new URL(page.url()).pathname.startsWith('/login'), `login correcto (${new URL(page.url()).pathname})`);

// ── Menú ──
const menuTxt = await page.locator('aside, nav').first().innerText().catch(() => '');
check(/Invitado/i.test(await page.locator('body').innerText()), 'el perfil se muestra como Invitado');
for (const t of MENU_PROHIBIDO) check(!menuTxt.includes(t), `menú sin "${t}"`);

// ── Rutas permitidas ──
for (const r of PERMITIDAS) {
  const antes = errsJs.length;
  await page.goto(`${BASE}${r}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const txt = await page.locator('body').innerText();
  check(!/Acceso restringido/i.test(txt), `${r} accesible`);
  check(!/Algo salió mal|Something went wrong|ErrorBoundary/i.test(txt), `${r} sin pantalla de error`);
  check(errsJs.length === antes, `${r} sin errores de JS`);
  if (r === '/presas') check((await page.getByRole('button', { name: /^\s*Registrar/i }).count()) === 0, '/presas sin botón "Registrar"');
  if (r === '/balance') check(!/Calibración automática de la rugosidad/i.test(txt), '/balance sin calibrador de Manning');
  if (r === '/clima') check((await page.getByRole('button', { name: /Actualizar datos/i }).count()) === 0, '/clima sin "Actualizar datos"');
}

// ── Rutas prohibidas ──
for (const r of PROHIBIDAS) {
  await page.goto(`${BASE}${r}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  const txt = await page.locator('body').innerText();
  check(/Acceso restringido|no está disponible para cuentas de invitado/i.test(txt), `${r} bloqueada`);
}

check(writes.length === 0, `ninguna escritura REST durante la sesión${writes.length ? ': ' + writes.join(' | ') : ''}`);
await browser.close();
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./out/invitado.json', import.meta.url), JSON.stringify({ base: BASE, ok: ok.length, fallos }, null, 2));
console.log(`\n${ok.length} OK · ${fallos.length} fallos`);
process.exit(fallos.length ? 1 : 0);
