// Informe Histórico de presas: abre el modal, genera Básico y Técnico con datos reales y valida el HTML.
//   node e2e/historico-informe.mjs [carpeta=historico-informe]      (requiere dev server en :5173)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const carpeta = process.argv[2] || 'historico-informe';
const OUT = fileURLToPath(new URL(`./out/${carpeta}/`, import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const errs = [];
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1400, height: 950 } });
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto('http://localhost:5173/analisis-historico', { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForSelector('.ah-paneles', { timeout: 30000 });

async function generar(modalidad, preset) {
  await page.getByRole('button', { name: /informe/i }).first().click();
  const dlg = page.getByRole('dialog').first();
  await dlg.waitFor({ timeout: 10000 });
  if (preset) await dlg.getByRole('button', { name: preset }).click();
  await dlg.getByText(modalidad, { exact: false }).first().click();
  await dlg.getByRole('button', { name: /generar vista previa/i }).click();
  const frame = page.locator('iframe').first();
  await frame.waitFor({ timeout: 20000 });
  await page.waitForFunction(() => {
    const f = document.querySelector('iframe');
    return f && (f.contentDocument?.body?.innerText?.length ?? 0) > 200;
  }, null, { timeout: 20000 });
  const html = await frame.evaluate(f => f.contentDocument.documentElement.outerHTML);
  const texto = await frame.evaluate(f => f.contentDocument.body.innerText);
  return { html, texto };
}

async function cerrar() {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

// Básico
{
  const { html, texto } = await generar('Básico', 'Ambas presas hoy');
  await page.screenshot({ path: `${OUT}basico_vista_previa.png` });
  fs.writeFileSync(`${OUT}basico.html`, html);
  verifica(!/NaN|undefined|>null</.test(html), 'Básico sin NaN/undefined/null');
  verifica(/Boquilla/.test(texto) && /Madero/.test(texto), 'Básico incluye ambas presas');
  verifica((html.match(/class="hoja pagina/g) || []).length >= 2, 'Básico: una página por presa (≥2 bloques .hoja.pagina)');
  console.log('Básico – extracto:', texto.replace(/\s+/g, ' ').slice(0, 400));
  await cerrar();
}

// Técnico
{
  const { html, texto } = await generar('Técnico', 'Año completo comparado');
  await page.screenshot({ path: `${OUT}tecnico_vista_previa.png` });
  fs.writeFileSync(`${OUT}tecnico.html`, html);
  verifica(!/NaN|undefined|>null</.test(html), 'Técnico sin NaN/undefined/null');
  verifica(/Metodolog/i.test(texto), 'Técnico incluye metodología');
  verifica(/frágil|fragil/i.test(texto), 'Técnico advierte percentiles frágiles');
  verifica(/no es extracción ni aportación/i.test(texto), 'Técnico rotula Δ aparente');
  await cerrar();
}

// PDF Carta de cada modalidad (HTML ya guardado) para contar páginas
for (const m of ['basico', 'tecnico']) {
  const p2 = await b.newPage();
  await p2.setContent(fs.readFileSync(`${OUT}${m}.html`, 'utf8'), { waitUntil: 'load' });
  await p2.pdf({ path: `${OUT}${m}.pdf`, format: 'Letter', printBackground: true, preferCSSPageSize: true });
  await p2.close();
  console.log(`PDF ${m}: ${OUT}${m}.pdf`);
}

await b.close();
const relevantes = errs.filter(e => !/favicon|ResizeObserver/i.test(e));
verifica(relevantes.length === 0, `sin errores de consola/JS (${relevantes.length})`);
if (relevantes.length) console.log(relevantes.slice(0, 5));
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo OK');
process.exit(fallos.length ? 1 : 0);
