// Informe Nivel y Tendencia — botones de la vista previa: Volver, Descargar PNG, Imprimir/PDF.
// Escritorio (Chromium): "Imprimir / PDF" llama a print() del iframe. iPad (WebKit con UA iOS): genera y entrega un PDF.
//   node e2e/informe-nivel-tendencia-pdf.mjs      (requiere dev server en :5173)
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('./out/informe-nivel-tendencia-pdf/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };

async function abrirVistaPrevia(page) {
  await page.goto('http://localhost:5173/presas', { waitUntil: 'networkidle' }).catch(() => {});
  await page.getByRole('button', { name: /informe nivel y tendencia/i }).first().click();
  await page.waitForFunction(() => { const x = [...document.querySelectorAll('button')].find(e => /vista previa/i.test(e.textContent || '')); return x && !x.disabled; }, null, { timeout: 30000 });
  await page.getByRole('button', { name: /vista previa/i }).first().click();
  const marco = page.locator('iframe[title^="Vista previa"]'); await marco.waitFor();
  const fr = await (await marco.elementHandle()).contentFrame(); await fr.waitForSelector('.hoja');
  return fr;
}

// 1) Escritorio
{
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const fr = await abrirVistaPrevia(page);
  await fr.evaluate(() => { window.__p = 0; window.print = () => { window.__p++; }; });
  verifica(await fr.locator('button').count() === 0, 'sin botón duplicado dentro de la hoja');
  await page.getByRole('button', { name: /imprimir \/ pdf/i }).click();
  verifica(await fr.evaluate(() => window.__p) === 1, 'escritorio: Imprimir/PDF invoca print() del informe');
  await page.getByRole('button', { name: /volver a filtros/i }).click();
  verifica(await page.getByRole('button', { name: /vista previa/i }).first().isVisible(), 'Volver a filtros regresa a la configuración');
  await b.close();
}

// 2) iPad (WebKit + user-agent iOS): PDF
{
  const b = await webkit.launch();
  const ctx = await b.newContext({ ...devices['iPad Pro 11'], acceptDownloads: true });
  const page = await ctx.newPage();
  await abrirVistaPrevia(page);
  const [d] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.getByRole('button', { name: /imprimir \/ pdf/i }).click(),
  ]);
  const nombre = d.suggestedFilename(); await d.saveAs(`${OUT}${nombre}`);
  const buf = fs.readFileSync(`${OUT}${nombre}`);
  const txt = buf.toString('latin1');
  verifica(/\.pdf$/.test(nombre), `iPad: archivo PDF (${nombre})`);
  verifica(buf.subarray(0, 5).toString() === '%PDF-' && txt.trimEnd().endsWith('%%EOF'), 'iPad: PDF bien formado');
  verifica((txt.match(/\/Type \/Page /g) || []).length === 2, 'iPad: una página por presa (2)');
  verifica(buf.length > 200_000 && buf.length < 12_000_000, `iPad: peso razonable ${(buf.length / 1048576).toFixed(2)} MB`);
  await page.waitForTimeout(500);
  verifica(await page.getByRole('button', { name: /imprimir \/ pdf/i }).isEnabled(), 'iPad: el botón vuelve a habilitarse');
  verifica(await page.getByRole('alert').count() === 0, 'iPad: sin mensaje de error');
  await b.close();
}
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo OK');
process.exit(fallos.length ? 1 : 0);
