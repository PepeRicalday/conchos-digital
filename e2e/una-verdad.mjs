// Vuelca las líneas con cifras clave por pantalla para compararlas a ojo (una sola verdad). Solo lectura.
import { chromium } from 'playwright';
const rutas = ['/', '/monitor-publico', '/presas', '/canales', '/escalas', '/hidrometria', '/balance', '/clima', '/alertas', '/geo-monitor'];
const re = /K-?0\b|K-?104|Boquilla|Madero|ETo|Eficiencia|alertas? activas|Extracci|Almacen|Llenado/i;
const b = await chromium.launch();
for (const r of rutas) {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto('http://localhost:5173' + r, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(5000);
  const L = (await p.evaluate(() => document.body.innerText)).split('\n').map(s => s.trim()).filter(Boolean);
  console.log('\n## ' + r);
  L.forEach((l, i) => { if (re.test(l) && l.length < 60) console.log('  ' + l + '  →  ' + L.slice(i + 1, i + 3).join(' | ').slice(0, 60)); });
  await p.context().close();
}
await b.close();
