// Control de Niveles (/escalas) — verificación funcional con Playwright, solo lectura.
//   node e2e/escalas.mjs        (requiere `npm run dev` en :5173; localhost tiene bypass de login)
// Comprueba: S/D nunca como 0 ni como alerta, filtros, modal accesible por teclado, sin tormenta de peticiones,
// sin errores de consola.
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const IGNORE = /AUTH_BYPASS|WebSocket connection|realtime|\[vite\]|DevTools|favicon/i;
const fallos = [];
const ok = (cond, msg) => { if (!cond) fallos.push(msg); console.log(`${cond ? '✓' : '✗'} ${msg}`); };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errores = [];
let peticiones = 0;
page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errores.push(m.text()); });
page.on('pageerror', e => errores.push(String(e)));
page.on('request', r => { if (/supabase\.co\/rest\/v1\/(lecturas_escalas|resumen_escalas_diario)/.test(r.url())) peticiones++; });

await page.goto(`${BASE}/escalas`);
await page.waitForSelector('.ce-escala', { timeout: 15000 });
await page.waitForTimeout(1500);

const total = await page.locator('.ce-escala').count();
ok(total === 14, `14 escalas dibujadas (hay ${total})`);

const textoPagina = await page.locator('.ce-pagina').innerText();
ok(!/NaN|undefined|Infinity/.test(textoPagina), 'sin NaN/undefined/Infinity en pantalla');

// Una escala sin dato jamás se muestra como 0.00 ni como alerta
const sinDato = await page.evaluate(() => [...document.querySelectorAll('.ce-escala')].filter(e => e.querySelector('.ce-nivel-num')?.textContent === 'S/D')
    .map(e => ({ alerta: e.classList.contains('ce-escala-alerta'), num: e.querySelector('.ce-nivel-num').textContent })));
ok(sinDato.every(s => !s.alerta), `escalas S/D (${sinDato.length}) sin estilo de alerta`);
const ceros = await page.evaluate(() => [...document.querySelectorAll('.ce-nivel-num')].filter(e => e.textContent === '0.00').length);
ok(ceros === 0, 'ningún nivel se muestra como 0.00 por falta de dato');

// Filtros
await page.getByRole('button', { name: 'Solo alertas' }).click();
const conAlerta = await page.locator('.ce-escala').count();
const alertasMarcadas = await page.locator('.ce-escala-alerta').count();
ok(conAlerta === alertasMarcadas, `filtro "Solo alertas" muestra solo escalas en alerta (${conAlerta})`);
await page.getByRole('button', { name: 'Solo represos' }).click();
ok((await page.locator('.ce-escala').count()) === (await page.locator('.ce-escala .ce-btn-calculo').count()), 'filtro "Solo represos" solo escalas con compuertas');
await page.getByRole('button', { name: 'Todas' }).click();

// Modal por teclado
const btn = page.locator('.ce-btn-calculo').first();
await btn.focus();
await page.keyboard.press('Enter');
await page.waitForSelector('[role=dialog]');
ok(await page.evaluate(() => document.querySelector('[role=dialog]').getAttribute('aria-modal') === 'true'), 'modal con role=dialog y aria-modal');
const izq = await page.evaluate(() => document.querySelector('.ce-modal-fondo').getBoundingClientRect().left);
ok(izq > 0, `el modal no tapa el menú lateral (left=${Math.round(izq)})`);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
ok(await page.evaluate(() => !document.querySelector('[role=dialog]')), 'Escape cierra el modal');
ok(await page.evaluate(() => document.activeElement?.classList.contains('ce-btn-calculo')), 'el foco vuelve al botón que abrió el modal');


// Perfil longitudinal: un punto por escala, navegable por teclado hasta su tarjeta
const puntos = await page.locator('.ce-perfil-punto').count();
ok(puntos === 14, `perfil longitudinal con 14 puntos (hay ${puntos})`);
await page.locator('.ce-perfil-punto').nth(5).focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
ok(await page.evaluate(() => document.activeElement?.id?.startsWith('ce-esc-')), 'Enter en un punto del perfil lleva el foco a su tarjeta');
// Series: nunca una línea con menos de 2 mediciones de campo
const sparksMal = await page.evaluate(() => [...document.querySelectorAll('.ce-spark svg')].filter(s => s.querySelectorAll('circle').length < 2).length);
ok(sparksMal === 0, 'sparklines solo con 2+ lecturas de campo');

// Sin tormenta de peticiones: 2 tablas × (1 carga × 2 por StrictMode en dev) = 4; el evento de vaciado NO debe relanzar la carga
ok(peticiones <= 4, `peticiones de lecturas/resumen en la carga inicial (${peticiones}, máx. 4)`);
ok(errores.length === 0, `sin errores de consola/JS${errores.length ? `: ${errores[0]}` : ''}`);

await browser.close();
console.log(fallos.length ? `\n${fallos.length} fallo(s)` : '\nTodo en orden');
process.exit(fallos.length ? 1 : 0);
