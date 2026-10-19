// Consultoría IA (/inteligencia-hidrica) y Protocolos (/protocolos) — verificación funcional con Playwright, solo lectura.
//   node e2e/consultoria.mjs        (requiere `npm run dev` en :5173; localhost tiene bypass de login como SRL)
// El chat real exige un JWT de usuario, así que la capa REST del historial se SIMULA con page.route: se comprueba cómo
// se pintan mensajes guardados (tablas, tarjetas con S/D, fuentes, enlaces seguros), no la respuesta del motor de IA.
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const IGNORE = /AUTH_BYPASS|WebSocket connection|realtime|\[vite\]|DevTools|favicon|adtrafficquality/i;
const fallos = [];
const ok = (cond, msg) => { if (!cond) fallos.push(msg); console.log(`${cond ? '✓' : '✗'} ${msg}`); };

const hoy = new Date().toISOString();
const CONV = '3f2b1c9e-8d4a-4b6e-9a1f-0c2d3e4f5a6b';
const convs = [{ id: CONV, titulo: 'Balance del canal K0→K104', contexto: 'balance', created_at: hoy, updated_at: hoy }];
const msgs = [
    { id: 'm1', conversation_id: CONV, role: 'user', content: 'Haz el balance', metadata: null, created_at: hoy },
    {
        id: 'm2', conversation_id: CONV, role: 'assistant', created_at: hoy,
        content: '## Balance\n\n| Tramo | Q entrada | Estado |\n|---|---|---|\n| K-0 → K-23 | S/D | no aplica |\n\nConsulta [CONAGUA](https://conagua.gob.mx) y [mala](javascript:alert(1)).',
        metadata: {
            proveedor: 'claude', modelo: 'claude-opus-5-5', truncada: true,
            tarjetas: [{ kind: 'presas', titulo: 'Presas', columnas: ['Presa', 'Llenado %', 'Extracción m³/s'], filas: [['Boquilla', 25.66, null]] }],
            fuentes: [{ documento: 'Reglas de operación', similitud: 0.87 }],
        },
    },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errores = [];
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errores.push(m.text()); });
page.on('pageerror', (e) => errores.push(String(e)));
await page.route('**/rest/v1/chat_conversations**', (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(convs) }) : r.continue()));
await page.route('**/rest/v1/chat_messages**', (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(msgs) }) : r.continue()));

// ── Consultoría IA ──
await page.goto(`${BASE}/inteligencia-hidrica`);
await page.waitForSelector('.ci-tabs', { timeout: 15000 });
await page.waitForTimeout(1500);
const textoPagina = await page.locator('.ci-pagina').innerText();
ok(!/Conectado\s*—\s*Datos en tiempo real/.test(textoPagina), 'ya no existe el indicador decorativo "Conectado — Datos en tiempo real"');
ok(await page.locator('.sc-chip').count() >= 3, 'chips de estado reales en la cabecera');
ok((await page.locator('.ci-pagina h1').count()) === 1, 'un solo h1 en la página');
ok(await page.locator('[role=tablist] [role=tab]').count() === 2, 'pestañas con role=tablist/tab');
ok(await page.locator('#ci-texto').evaluate((e) => getComputedStyle(e).fontSize === '16px'), 'campo de texto de 16 px (sin zoom en iOS)');
ok(!/CONAGUA|proyecci/i.test(await page.locator('.ci-sugerencias').innerText()), 'las sugerencias no prometen datos sin base (CONAGUA, proyecciones)');

await page.locator('.ci-conv-abrir').first().click();
await page.waitForSelector('.ci-burbuja');
await page.waitForTimeout(600);
ok(await page.locator('.ci-tarjeta').count() === 1, 'tarjeta de datos estructurada renderizada');
ok(await page.locator('.ci-tarjeta .ci-sd').count() >= 1 && !/\b0\b.*Extracci/.test(await page.locator('.ci-tarjeta').innerText()), 'dato ausente = S/D (nunca 0)');
ok(await page.locator('.ci-burbuja .ci-tabla-wrap table').count() === 1, 'tabla del modelo dentro de un contenedor con scroll');
const enlaces = await page.locator('.ci-burbuja a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
ok(enlaces.length === 1 && enlaces[0] === 'https://conagua.gob.mx', 'el enlace javascript: no es un enlace');
ok(await page.locator('.ci-fuente').count() === 1, 'fuentes del RAG como chips');
ok(await page.getByRole('button', { name: 'Continuar' }).count() === 1, 'respuesta incompleta ofrece "Continuar"');
ok(await page.getByRole('button', { name: 'Copiar la respuesta' }).count() === 1, 'copiar respuesta disponible');
ok(await page.locator('[role=log]').getAttribute('aria-live') === 'polite', 'mensajes con role=log y aria-live');

// borrar con confirmación, visible sin hover
await page.getByRole('button', { name: /Eliminar “Balance/ }).click();
ok(await page.getByRole('alertdialog').count() === 1, 'eliminar pide confirmación (y el botón es visible sin hover)');
await page.getByRole('button', { name: 'Cancelar' }).first().click();

// Base de conocimiento
await page.getByRole('tab', { name: /Base de conocimiento/ }).click();
await page.waitForSelector('.ci-dropzone');
ok(/PDF/.test(await page.locator('.ci-dropzone').innerText()), 'la biblioteca declara que solo acepta PDF');
ok(!/Ready for RAG|Almacenamiento Cifrado|pgvector habilitado/.test(await page.locator('.ci-pagina').innerText()), 'sin textos fijos engañosos en la biblioteca');

// ── Protocolos ──
await page.goto(`${BASE}/protocolos`);
await page.waitForSelector('.pr-grid', { timeout: 15000 });
await page.getByRole('button', { name: /Llenado/ }).first().click();
await page.waitForSelector('[role=dialog]');
const activar = page.locator('.pr-dialogo .sc-btn-primario');
ok(await activar.isDisabled(), 'Llenado vacío: Activar deshabilitado (sin 60 m³/s ocultos por defecto)');
await page.fill('#pr-f-gasto', '75'); await page.fill('#pr-f-ap', '100');
ok(await activar.isDisabled(), 'gasto 75 m³/s (> 60 de diseño): Activar deshabilitado');
await page.fill('#pr-f-gasto', '45');
ok(await activar.isEnabled(), 'gasto 45 m³/s y apertura 100 %: Activar habilitado');
ok(await page.locator('.pr-fondo').evaluate((e) => parseFloat(getComputedStyle(e).left) > 0), 'el diálogo no tapa el menú lateral');
await page.keyboard.press('Escape');
ok(await page.locator('[role=dialog]').count() === 0, 'Escape cierra el diálogo');


ok(errores.length === 0, `sin errores de consola/JS${errores.length ? `: ${errores[0]}` : ''}`);
await browser.close();
console.log(fallos.length ? `\n${fallos.length} fallo(s)` : '\nTodo en orden');
process.exit(fallos.length ? 1 : 0);
