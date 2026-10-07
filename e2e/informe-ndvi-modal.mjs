// Revisión de la ventana "Configurar informe institucional NDVI" y de su vista previa (escritorio e iPhone). Solo lectura.
//   node e2e/informe-ndvi-modal.mjs   (con `npm run dev` en :5173)
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('./out/informe-modal/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const casos = [
  { nombre: 'escritorio', motor: chromium, ctx: { viewport: { width: 1600, height: 900 } } },
  { nombre: 'iphone', motor: webkit, ctx: { ...devices['iPhone 15 Pro Max'] } },
];
for (const c of casos) {
  const b = await c.motor.launch();
  const page = await (await b.newContext(c.ctx)).newPage();
  const err = [];
  page.on('pageerror', (e) => err.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|tile/i.test(m.text())) err.push(m.text().slice(0, 200)); });
  await page.goto('http://localhost:5173/geo-monitor', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /Ver NDVI mensual por módulo/ }).click({ timeout: 20000 }).catch((e) => err.push('no abrió panel: ' + e.message.slice(0, 80)));
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: /Informe institucional/ }).click({ timeout: 10000 }).catch((e) => err.push('no abrió modal: ' + e.message.slice(0, 80)));
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    const d = document.querySelector('.ndvi-cfg');
    const r = d?.getBoundingClientRect();
    const sb = document.querySelector('.sidebar, aside.sidebar, nav.sidebar')?.getBoundingClientRect();
    return { abierto: !!d, ancho: r && Math.round(r.width), alto: r && Math.round(r.height), izq: r && Math.round(r.left), sidebarDer: sb && Math.round(sb.right),
      resumen: document.querySelector('.ndvi-cfg-resumen')?.textContent, hojas: document.querySelector('.ndvi-cfg-cuenta')?.textContent,
      chipsModulo: document.querySelectorAll('.ndvi-cfg-chip[style*="--c"]').length };
  });
  console.log(c.nombre, 'modal:', JSON.stringify(info));
  await page.screenshot({ path: `${OUT}${c.nombre}_modal.png` });
  // Cambia filtros (selectores acotados a la ventana: el panel de fondo también tiene botones 'Módulo N')
  const d = page.locator('.ndvi-cfg');
  await d.getByRole('radio', { name: /Mes de referencia/ }).click().catch((e) => err.push('preset: ' + e.message.slice(0, 60)));
  for (const m of [4, 5, 12]) await d.getByRole('button', { name: new RegExp('^Módulo ' + m) }).click().catch((e) => err.push('mod ' + m + ': ' + e.message.slice(0, 60)));
  await d.getByRole('button', { name: 'Kc', exact: true }).click().catch((e) => err.push('kc: ' + e.message.slice(0, 60)));
  await d.getByRole('radio', { name: /Ponderado/ }).click().catch((e) => err.push('pond: ' + e.message.slice(0, 60)));
  await page.waitForTimeout(400);
  console.log(c.nombre, 'tras filtros:', await page.evaluate(() => document.querySelector('.ndvi-cfg-resumen')?.textContent));
  await page.screenshot({ path: `${OUT}${c.nombre}_modal_filtrado.png` });
  await page.getByRole('button', { name: /Vista previa/ }).click().catch((e) => err.push('sin vista previa: ' + e.message.slice(0, 80)));
  await page.waitForSelector('.ndvi-cfg-marco iframe', { timeout: 20000 }).catch(() => err.push('no cargó el iframe'));
  await page.waitForTimeout(1500);
  const marco = page.frameLocator('.ndvi-cfg-marco iframe');
  console.log(c.nombre, 'hojas en vista previa:', await marco.locator('.pagina').count().catch(() => -1));
  await page.screenshot({ path: `${OUT}${c.nombre}_previa.png` });
  console.log(c.nombre, 'errores:', err.length ? err.slice(0, 4) : 'ninguno');
  await b.close();
}
