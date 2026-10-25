// "Imprimir / PDF" de los informes con vista previa en iframe, en iPad (WebKit + UA iOS): debe entregar un PDF.
//   Histórico: por la interfaz.  Conservación / NDVI / Vaso comparten htmlAPdf: se prueba con HTML de varias hojas y de una hoja larguísima.
//   node e2e/informes-pdf-ipad.mjs      (requiere dev server en :5173)
import { webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('./out/informes-pdf-ipad/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };
const paginasPdf = (buf) => (buf.toString('latin1').match(/\/Type \/Page /g) || []).length;

const b = await webkit.launch();
const ctx = await b.newContext({ ...devices['iPad Pro 11'], acceptDownloads: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));

// 1) Informe Histórico por la interfaz
await page.goto('http://localhost:5173/analisis-historico', { waitUntil: 'networkidle' }).catch(() => {});
const btnInforme = page.getByRole('button', { name: /^\s*informe\s*$/i }).first();
await page.waitForFunction(() => [...document.querySelectorAll('button')].some(x => /^\s*Informe\s*$/.test(x.textContent || '') && !x.disabled), null, { timeout: 60000 });
await btnInforme.click();
await page.getByRole('button', { name: /generar vista previa/i }).click();
await page.locator('iframe[title^="Vista previa del informe"]').waitFor({ timeout: 60000 });
const [d1] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.getByRole('button', { name: /imprimir \/ pdf/i }).click()]);
const n1 = d1.suggestedFilename(); await d1.saveAs(`${OUT}${n1}`);
const buf1 = fs.readFileSync(`${OUT}${n1}`);
verifica(/\.pdf$/.test(n1) && buf1.subarray(0, 5).toString() === '%PDF-', `Histórico: PDF entregado (${n1})`);
verifica(paginasPdf(buf1) >= 1, `Histórico: ${paginasPdf(buf1)} página(s), ${(buf1.length / 1048576).toFixed(2)} MB`);
verifica(await page.getByRole('button', { name: /imprimir \/ pdf/i }).isEnabled(), 'Histórico: el botón vuelve a habilitarse');
verifica(await page.getByRole('alert').count() === 0, 'Histórico: sin mensaje de error');

// 2) htmlAPdf con HTML sintético (mismo motor que Conservación, NDVI y Vaso)
const html3 = (n) => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#eceae5;font:14px sans-serif}.pagina{background:#fff;max-width:215.9mm;margin:12px auto;padding:12mm;min-height:270mm}@page{size:letter portrait}</style></head><body>${Array.from({ length: n }, (_, i) => `<section class="pagina"><h1>Hoja ${i + 1}</h1><p>Contenido de prueba ${i + 1}</p></section>`).join('')}<button class="btn-imprimir" onclick="window.print()">Imprimir</button></body></html>`;
const hojaLarga = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:14px sans-serif}.hoja{width:8.5in;margin:14px auto;padding:12mm}</style></head><body><div class="hoja">${Array.from({ length: 160 }, (_, i) => `<p style="margin:0 0 14px">Párrafo ${i + 1} — texto del informe técnico largo.</p>`).join('')}</div></body></html>`;
const r = await page.evaluate(async ({ h3, larga }) => {
  const m = await import('/src/utils/imprimirInforme.ts');
  const aBytes = async (blob) => new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));
  const t0 = await aBytes(await m.htmlAPdf(h3));
  const t1 = await aBytes(await m.htmlAPdf(larga));
  const cuenta = (t) => (t.match(/\/Type \/Page /g) || []).length;
  return { tres: cuenta(t0), mediaTres: /MediaBox \[0 0 612 [\d.]+\]/.test(t0), larga: cuenta(t1), hojas: m.htmlPorHoja(h3).htmls.length, a4: m.htmlPorHoja('<style>@page{size:A4 portrait}</style><section class="pagina"></section>').ancho };
}, { h3: html3(3), larga: hojaLarga });
verifica(r.hojas === 3 && r.tres === 3, `Sintético: 3 hojas .pagina → 3 páginas PDF (${r.tres})`);
verifica(r.mediaTres, 'Sintético: MediaBox válido, ancho 612 pt');
verifica(r.larga >= 2, `Hoja larguísima se trocea en páginas carta (${r.larga})`);
verifica(r.a4 === 794, 'A4 usa 794 px de ancho');

const rel = errs.filter(e => !/favicon|ResizeObserver/i.test(e));
verifica(rel.length === 0, `sin errores JS (${rel.length})`); if (rel.length) console.log(rel.slice(0, 4));
await b.close();
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo OK');
process.exit(fallos.length ? 1 : 0);
