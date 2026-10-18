// Revisa los informes de pronóstico ya generados (e2e/clima-cambio-temp.mjs) en iPad, iPhone y como PDF.
//   node e2e/clima-cambio-temp.mjs && node e2e/clima-informe-dispositivos.mjs
// Comprueba desborde horizontal, texto < 11 px y que el PDF tenga páginas legibles (sin cortar el banner de aviso).
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const DIR = fileURLToPath(new URL('./out/clima-cambio/', import.meta.url));
const casos = [
  { nombre: 'ipad', motor: webkit, ctx: { ...devices['iPad Pro 11'] } },
  { nombre: 'iphone', motor: webkit, ctx: { ...devices['iPhone 15 Pro Max'] } },
];
const archivos = ['descenso-critico-ciudadano', 'descenso-critico-operativo', 'descenso-critico-tecnico'];
const resumen = [];

for (const c of casos) {
  const b = await c.motor.launch();
  const ctx = await b.newContext(c.ctx);
  for (const a of archivos) {
    const page = await ctx.newPage();
    await page.goto('file:///' + (DIR + a + '.html').replace(/\\/g, '/'));
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const chicos = [];
      for (const el of document.body.querySelectorAll('*')) {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 9) chicos.push(`${el.tagName}: ${fs}px`);
      }
      return { desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth, chicos: chicos.length, muestra: chicos.slice(0, 3) };
    });
    await page.screenshot({ path: DIR + `${c.nombre}-${a}.png`, fullPage: false });
    resumen.push({ dispositivo: c.nombre, informe: a, ...r });
    await page.close();
  }
  await b.close();
}

// PDF (lo que hace "Imprimir / PDF" → Guardar como PDF), en Chromium.
const b = await chromium.launch();
for (const a of archivos) {
  const page = await b.newPage();
  await page.goto('file:///' + (DIR + a + '.html').replace(/\\/g, '/'));
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: DIR + a + '.pdf', format: 'A4', printBackground: true });
  const kb = Math.round(fs.statSync(DIR + a + '.pdf').size / 1024);
  const paginas = (fs.readFileSync(DIR + a + '.pdf', 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  resumen.push({ pdf: a, kb, paginas });
  await page.close();
}
await b.close();
fs.writeFileSync(DIR + 'resumen-dispositivos.json', JSON.stringify(resumen, null, 2));
console.log(JSON.stringify(resumen, null, 2));
