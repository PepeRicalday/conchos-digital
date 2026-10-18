// Revisión visual de los 3 niveles del Informe de Pronóstico con y sin alerta de cambio brusco de temperatura.
//   node e2e/clima-cambio-temp.mjs   (requiere `npm run dev` en :5173)
// La alerta se INYECTA solo en el navegador (intercepta la respuesta de registro_alertas): no se escribe nada en la BD.
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('./out/clima-cambio/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const base = 'http://localhost:5173';

const alertaFalsa = (sentido, critica) => ({
  id: '00000000-0000-0000-0000-00000000dead', tipo_riesgo: critica ? 'critical' : 'warning', categoria: 'agroclimatica',
  titulo: `Descenso brusco de temperatura · Red de estaciones (5 coinciden)`.replace('Descenso', sentido === 'descenso' ? 'Descenso' : 'Ascenso'),
  mensaje: `${sentido === 'descenso' ? 'Descenso' : 'Ascenso'} brusco de temperatura (cambio en 24 h, observado o pronóstico 48 h): 13.1 °C (umbral crítico ≥ 12 °C). [ahora: 10.4 · pronóstico: 13.1 °C]. Proteger cultivos.`,
  origen_id: `CLIMA-${sentido}-00000000-0000-0000-0000-000000000000`, fecha_deteccion: new Date().toISOString(),
});

const escenarios = [
  { id: 'sin-alerta', alerta: null },
  { id: 'descenso-critico', alerta: alertaFalsa('descenso', true) },
  { id: 'ascenso-aviso', alerta: { ...alertaFalsa('ascenso', false), mensaje: 'Ascenso brusco de temperatura (cambio en 24 h, observado o pronóstico 48 h): 8.6 °C (umbral de aviso ≥ 8 °C). [ahora: S/D · pronóstico: 8.6 °C]. Anticipar demanda.' } },
];
const niveles = [['ciudadano', 'Básico'], ['operativo', 'Operativo'], ['tecnico', 'Técnico']];

const b = await chromium.launch();
const resumen = [];
for (const esc of escenarios) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errores = [];
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  page.on('pageerror', (e) => errores.push(String(e)));
  if (esc.alerta) {
    await page.route('**/rest/v1/registro_alertas*', async (route) => {
      const resp = await route.fetch();
      let json = [];
      try { json = await resp.json(); } catch { /* sin cuerpo */ }
      await route.fulfill({ response: resp, json: [...(Array.isArray(json) ? json : []), esc.alerta] });
    });
  }
  await page.goto(base + '/clima', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForSelector('button:has-text("Pronóstico")', { timeout: 30000 });
  await page.waitForTimeout(6000);
  for (const [clave, etiqueta] of niveles) {
    await page.click('button:has-text("Pronóstico")');
    await page.waitForSelector('[role="dialog"]');
    await page.click(`[role="dialog"] button:has-text("${etiqueta}")`);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('[role="dialog"] button:has-text("Descargar HTML")')]);
    const ruta = OUT + `${esc.id}-${clave}.html`;
    await dl.saveAs(ruta);
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape').catch(() => {});
    const dialogo = await page.$('[role="dialog"]');
    if (dialogo) await page.click('[role="dialog"] button:has-text("Cancelar")').catch(() => {});

    const vis = await ctx.newPage();
    await vis.setViewportSize({ width: clave === 'ciudadano' ? 900 : 1200, height: 900 });
    await vis.goto('file:///' + ruta.replace(/\\/g, '/'));
    await vis.waitForTimeout(800);
    await vis.screenshot({ path: OUT + `${esc.id}-${clave}.png`, fullPage: true });
    const texto = await vis.evaluate(() => document.body.innerText);
    const desborde = await vis.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    resumen.push({ esc: esc.id, clave, titulares: texto.split('\n').filter((l) => /brusc|Calor intenso|Sin riesgos|helada|Precauci|Atenci|PELIGRO/i.test(l)).slice(0, 6), desborde, chars: texto.length });
    await vis.close();
  }
  if (errores.length) resumen.push({ esc: esc.id, errores: errores.slice(0, 5) });
  await ctx.close();
}
await b.close();
fs.writeFileSync(OUT + 'resumen.json', JSON.stringify(resumen, null, 2));
console.log(JSON.stringify(resumen, null, 2));
