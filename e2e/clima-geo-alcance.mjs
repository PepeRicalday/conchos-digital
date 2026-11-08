// Informe Geoclimático: filtro de alcance (solo distrito / distrito y toda la cuenca).
//   PORT=5182 node e2e/clima-geo-alcance.mjs      (requiere dev server; bypass de login en localhost)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const BASE = `http://localhost:${process.env.PORT || 5173}`;
const OUT = fileURLToPath(new URL('./out/clima-geo-alcance/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };

const navegador = await chromium.launch();
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) errores.push(m.text()); });

async function generar(alcance) {
  await page.goto(`${BASE}/clima`, { waitUntil: 'domcontentloaded' });
  const abrir = page.getByRole('button', { name: /Geoclimático/ });
  await abrir.waitFor({ timeout: 60000 });
  await abrir.click();
  const grupo = page.getByRole('radiogroup', { name: 'Alcance del informe' });
  await grupo.waitFor({ timeout: 15000 });
  verifica(await grupo.getByRole('radio', { name: /Solo distrito/ }).getAttribute('aria-checked') === 'true', `[${alcance}] el alcance «Solo distrito» viene marcado por defecto`);
  if (alcance === 'cuenca') await grupo.getByRole('radio', { name: /toda la cuenca/ }).click();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.getByRole('button', { name: /Generar informe/ }).click()]);
  const ruta = OUT + dl.suggestedFilename();
  await dl.saveAs(ruta);
  return { ruta, nombre: dl.suggestedFilename(), html: fs.readFileSync(ruta, 'utf8') };
}

const d = await generar('distrito');
verifica(/informe-geoclimatico-modulos-/.test(d.nombre), `solo distrito: archivo «${d.nombre}»`);
verifica(!/Cuenca del Conchos/.test(d.html.replace(/<style[\s\S]*?<\/style>/g, '')) && !/geoinf-cuenca/.test(d.html), 'solo distrito: el informe NO trae la sección de la cuenca');

const c = await generar('cuenca');
verifica(/informe-geoclimatico-distrito-y-cuenca-/.test(c.nombre), `distrito y cuenca: archivo «${c.nombre}»`);
verifica(/class="geoinf-cuenca"/.test(c.html) && /<h2 class="geoinf-grupo-titulo">Cuenca del Conchos<\/h2>/.test(c.html), 'distrito y cuenca: trae la sección «Cuenca del Conchos»');
verifica((c.html.match(/id="gcu-[a-z]+-cl"/g) ?? []).length === 3, 'distrito y cuenca: 3 planos (lluvia, temperatura, viento)');
verifica(/JCAS no mide radiación solar/.test(c.html), 'distrito y cuenca: la radiación solar se declara S/D en la cuenca');
verifica(/Detalle por variable/.test(c.html) && c.html.indexOf('Detalle por variable') < c.html.indexOf('geoinf-cuenca'), 'distrito y cuenca: la sección va después del detalle del distrito');
const visible = c.html.slice(c.html.indexOf('class="geoinf-cuenca"')).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').slice(0, 6000);
verifica(!/\b(NaN|undefined|Infinity|null)\b|aquarius/i.test(visible), 'distrito y cuenca: sin NaN/undefined/null en la sección');
verifica(/provisional/i.test(visible), 'distrito y cuenca: rotulado como dato provisional');
verifica(c.html.length > d.html.length, 'el informe con cuenca es más completo que el de solo distrito');

// vista del informe con cuenca
const p2 = await ctx.newPage();
await p2.setContent(c.html, { waitUntil: 'load' });
const sec = p2.locator('section.geoinf-cuenca');
await sec.scrollIntoViewIfNeeded();
await sec.screenshot({ path: OUT + 'seccion-cuenca.png' });
verifica(await sec.locator('svg').count() === 3, 'la sección renderiza 3 SVG');

verifica(errores.length === 0, `sin errores de consola (${errores.slice(0, 2).join(' | ')})`);
await navegador.close();
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo OK');
process.exit(fallos.length ? 1 : 0);
