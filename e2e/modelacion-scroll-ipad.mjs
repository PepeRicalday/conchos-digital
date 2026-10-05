// Prueba el scroll de /modelacion-hidraulica en iPad, horizontal y vertical.
//   node e2e/modelacion-scroll-ipad.mjs [carpeta=scroll-ipad]
// - Chromium con gestos táctiles reales (CDP Input.dispatchTouchEvent): arrastra el dedo sobre
//   cabecera, columna izquierda, centro y derecha y reporta qué contenedor se mueve.
//   (synthesizeScrollGesture NO sirve aquí: no mueve nada ni en una página simple.)
// - WebKit (motor de Safari): solo layout y captura; WebKit móvil no admite rueda ni gestos.
// Solo lectura. Capturas en e2e/out/<carpeta>/.
import { webkit, chromium, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const carpeta = process.argv[2] || 'scroll-ipad';
const OUT = fileURLToPath(new URL(`./out/${carpeta}/`, import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const VP = { horizontal: { width: 1180, height: 820 }, vertical: { width: 820, height: 1180 } };
const SCROLLERS = ['.sim-left', '.sim-center', '.sim-right', '.main-content'];
let fallos = 0;

for (const [motor, tipo] of Object.entries({ webkit, chromium })) {
  const b = await tipo.launch();
  for (const [ori, viewport] of Object.entries(VP)) {
    const ctx = await b.newContext({ ...devices['iPad Pro 11'], viewport });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto('http://localhost:5173/modelacion-hidraulica', { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(5000);

    const medidas = () => page.evaluate(() => {
      const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}@${Math.round(b.top)}`; };
      const m = document.querySelector('.main-content');
      return { header: r('.sim-header'), ctrl: r('.sim-ctrl-bar'), strip: r('.sim-datasource-strip'), body: r('.sim-body'), centro: r('.sim-center'), main: `${m.clientHeight} de ${m.scrollHeight} (${getComputedStyle(m).overflowY})` };
    });
    console.log(`\n=== ${motor} ${ori} ${viewport.width}x${viewport.height} ===`, JSON.stringify(await medidas()));
    await page.screenshot({ path: `${OUT}${motor}_${ori}.png` });

    if (motor === 'chromium') {
      const cdp = await ctx.newCDPSession(page);
      const swipe = async (x, y, dy = 300) => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - (dy * i) / 12 }] }); await page.waitForTimeout(16); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(900);
      };
      const lee = () => page.evaluate(ss => Object.fromEntries(ss.map(s => [s, Math.round(document.querySelector(s).scrollTop)])), SCROLLERS);
      for (const [n, sel] of [['cabecera', '.sim-header'], ['columna izquierda', '.sim-left'], ['centro', '.sim-center'], ['columna derecha', '.sim-right']]) {
        // Punto de toque dentro del viewport (los paneles pueden quedar por debajo del pliegue).
        const pt = await page.evaluate(sel => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(Math.min(innerHeight - 160, Math.max(b.top + 60, 120))) }; }, sel);
        const hit = await page.evaluate(({ x, y, sel }) => !!document.elementFromPoint(x, y)?.closest(sel), { ...pt, sel });
        const antes = await lee(); await swipe(pt.x, pt.y); const desp = await lee();
        const mov = SCROLLERS.filter(k => desp[k] !== antes[k]).map(k => `${k} ${antes[k]}→${desp[k]}`);
        const ok = mov.length > 0;
        if (!ok) fallos++;
        console.log(`  dedo sobre ${n} (${pt.x},${pt.y}${hit ? '' : ' ¡toque fuera del elemento!'}): ${ok ? mov.join(', ') : 'NO MUEVE NADA'}`);
        await page.evaluate(ss => ss.forEach(s => { document.querySelector(s).scrollTop = 0; }), SCROLLERS);
      }
      // ¿Se alcanza el final del contenido? (último elemento de la columna derecha visible tras desplazar la página)
      await page.evaluate(() => { const m = document.querySelector('.main-content'); m.scrollTop = m.scrollHeight; });
      await page.waitForTimeout(300);
      console.log('  tras desplazar la página al final:', JSON.stringify(await medidas()));
      await page.screenshot({ path: `${OUT}${motor}_${ori}_final.png` });
    }
    if (errs.length) console.log('  ERRORES:', errs.join(' | '));
    await ctx.close();
  }
  await b.close();
}
console.log(fallos ? `\n${fallos} zona(s) sin respuesta al dedo` : '\nTodas las zonas responden al dedo');
process.exit(fallos ? 1 : 0);
