// Comprueba que el dock del Monitor Público quede centrado/dentro de la pantalla en dos rutas de entrada:
//   A) directo a /monitor-publico   B) pasando antes por /geo-monitor (su CSS global se queda cargado).
//   node e2e/monitor-dock-posicion.mjs
import { chromium } from 'playwright';
const b = await chromium.launch();
let fallos = 0;
for (const [w, h] of [[1600, 900], [1366, 768], [1920, 1080]]) {
  for (const ruta of ['directo', 'tras-geo']) {
    const page = await b.newPage({ viewport: { width: w, height: h } });
    if (ruta === 'tras-geo') {
      await page.goto('http://localhost:5173/geo-monitor', { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(3000);
      await page.click('a[href="/monitor-publico"]');
    } else {
      await page.goto('http://localhost:5173/monitor-publico', { waitUntil: 'networkidle' }).catch(() => {});
    }
    await page.waitForSelector('.info-cards-dock', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500); // la animación de entrada dura 0.4 s de retraso + 0.5 s
    const m = await page.evaluate(() => {
      const d = document.querySelector('.info-cards-dock'); if (!d) return null;
      const r = d.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth, transform: getComputedStyle(d).transform, animName: getComputedStyle(d).animationName };
    });
    const fuera = !m || m.right > m.vw + 2;
    if (fuera) fallos++;
    console.log(`${w}x${h} ${ruta}: ${JSON.stringify(m)} ${fuera ? '← FUERA DE PANTALLA' : 'ok'}`);
    await page.close();
  }
}
await b.close();
process.exit(fallos ? 1 : 0);
