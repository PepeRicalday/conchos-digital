// Renderiza el informe NDVI generado por informe-ndvi-genera.ts: PDF Carta + captura de cada página + iPhone.
//   npx vite-node e2e/informe-ndvi-genera.ts && node e2e/informe-ndvi-revision.mjs
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('./out/informe-ndvi/', import.meta.url));
const b = await chromium.launch();
for (const nombre of ['informe', 'informe_con_faltantes', 'tendencia', 'cmp_periodos', 'cmp_mes', 'cmp_modulos', 'cmp_vs_srl']) {
  const page = await b.newPage({ viewport: { width: 900, height: 1200 } });
  const err = [];
  page.on('pageerror', (e) => err.push(String(e)));
  await page.goto('file:///' + OUT.replace(/\\/g, '/') + nombre + '.html');
  await page.waitForTimeout(500);
  await page.pdf({ path: `${OUT}${nombre}.pdf`, format: 'Letter', printBackground: true, preferCSSPageSize: true });
  const n = (await page.evaluate(() => document.querySelectorAll('.pagina').length));
  // paginas del PDF
  const pdf = fs.readFileSync(`${OUT}${nombre}.pdf`).toString('latin1');
  const paginasPdf = (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  const desborde = await page.evaluate(() => [...document.querySelectorAll('.pagina')].map((p, i) => ({ i: i + 1, sobra: p.scrollHeight - p.clientHeight })).filter((x) => x.sobra > 2));
  console.log(nombre, 'secciones:', n, 'paginas PDF:', paginasPdf, 'sin desborde' , desborde.length ? JSON.stringify(desborde) : 'OK', err.length ? err : '');
  if (nombre !== 'informe_con_faltantes') {
    // Captura de cada página en modo impresión (emulación) para ver la hoja tal como sale
    await page.emulateMedia({ media: 'print' });
    const paginas = await page.$$('.pagina');
    for (let i = 0; i < paginas.length; i++) await paginas[i].screenshot({ path: `${OUT}${nombre === 'informe' ? '' : nombre + '_'}p${i + 1}.png` });
  }
  await page.close();
}
await b.close();

const w = await webkit.launch();
const ph = await (await w.newContext({ ...devices['iPhone 15 Pro Max'] })).newPage();
await ph.goto('file:///' + OUT.replace(/\\/g, '/') + 'informe.html');
await ph.waitForTimeout(500);
console.log('iphone desborde horizontal:', await ph.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth));
await ph.screenshot({ path: `${OUT}iphone.png`, fullPage: false });
await w.close();
