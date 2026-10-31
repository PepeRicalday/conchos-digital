// Informe general del sistema (botón "Generar reporte digital" del Dashboard): abre el modal, revisa las 6 hojas Carta
// (sin desborde de hoja, sin NaN/undefined, sin texto bajo 7 pt) y guarda una captura por hoja + el PDF. Requiere `npm run dev` en :5173.
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
const OUT = fileURLToPath(new URL('./out/informe/', import.meta.url)); fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const err = []; page.on('pageerror', (e) => err.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text())) err.push(m.text().slice(0, 160)); });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForSelector('.sc-root .kp-grid', { timeout: 30000 });
await page.waitForTimeout(6000);
await page.click('button[aria-label="Generar reporte digital"]');
await page.waitForSelector('.ndvi-cfg-marco iframe', { timeout: 20000 });
const frame = page.frameLocator('.ndvi-cfg-marco iframe');
await frame.locator('.pagina').first().waitFor({ timeout: 20000 });
await page.waitForTimeout(800);
const handle = await page.$('.ndvi-cfg-marco iframe');
const fr = await handle.contentFrame();
const r = await fr.evaluate(() => {
  const hojas = [...document.querySelectorAll('.pagina')];
  const px = 96 / 25.4; // alto de una hoja Carta útil: 279.4 mm
  const info = hojas.map((h, i) => {
    const cuerpo = h.querySelector('.cuerpo');
    return { hoja: i + 1, alto_mm: Math.round(h.scrollHeight / px), cuerpo_mm: Math.round(cuerpo.scrollHeight / px), desbordaX: h.scrollWidth - h.clientWidth };
  });
  const chicos = [];
  for (const el of document.querySelectorAll('.pagina *')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const pt = parseFloat(getComputedStyle(el).fontSize) * 0.75;
    if (pt < 7) chicos.push(`${el.tagName}.${el.className}:${pt.toFixed(1)}pt`);
  }
  const txt = document.body.innerText;
  return { hojas: hojas.length, info, chicos: [...new Set(chicos)].slice(0, 8), nan: /NaN|undefined|Infinity|\bnull\b/.test(txt), sd: (txt.match(/S\/D/g) || []).length };
});
console.log(JSON.stringify(r));
// PDF real (impresión Carta) del mismo HTML
const html = await fr.content();
const p2 = await (await b.newContext()).newPage();
await p2.setViewportSize({ width: 860, height: 1100 });
await p2.setContent(html, { waitUntil: 'load' });
await p2.addStyleTag({ content: '.btn-imprimir{display:none!important}' });
const hs = await p2.locator('.pagina').all();
for (let i = 0; i < hs.length; i++) await hs[i].screenshot({ path: `${OUT}hoja-${i + 1}.png` });
await p2.pdf({ path: `${OUT}informe-general.pdf`, format: 'Letter', printBackground: true, preferCSSPageSize: true });
const paginasPdf = (fs.readFileSync(`${OUT}informe-general.pdf`).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
console.log('páginas en el PDF:', paginasPdf, err.length ? 'ERRORES: ' + err.join(' | ') : 'sin errores de consola');
const mal = r.hojas !== 6 || r.nan || r.chicos.length || r.info.some((x) => x.desbordaX > 1) || paginasPdf !== 6 || err.length;
console.log(mal ? '\nCon observaciones' : '\nTodo en regla');
await b.close(); process.exit(0);
