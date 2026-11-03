// Auditoría de solapes y textos cortados en las tarjetas del Dashboard, con emulación real (WebKit + táctil) de iPad y iPhone.
// Requiere `npm run dev` en :5173.
//   node e2e/dashboard-solapes.mjs            → todos los dispositivos
//   node e2e/dashboard-solapes.mjs ipad       → los que empiezan por "ipad"
// Detecta, por tarjeta (.kp-tile y el panel .kc-ahora): (1) SOLAPES entre cajas de texto/gráfico que se intersectan,
// (2) TEXTO CORTADO (elipsis o line-clamp con contenido oculto), (3) CONTENIDO RECORTADO por el borde de la tarjeta.
// Capturas en e2e/out/solapes/. Salida con código 1 si hay solapes o recortes.
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
const OUT = fileURLToPath(new URL('./out/solapes/', import.meta.url)); fs.mkdirSync(OUT, { recursive: true });

const casos = [
  { n: 'desktop-1500x1000', motor: chromium, ctx: { viewport: { width: 1500, height: 1000 } } },
  { n: 'ipad-h-1366x1024', motor: webkit, ctx: { ...devices['iPad Pro 11 landscape'], viewport: { width: 1366, height: 1024 } } },
  { n: 'ipad-h-1180x820', motor: webkit, ctx: { ...devices['iPad Pro 11 landscape'] } },
  { n: 'ipad-v-1024x1366', motor: webkit, ctx: { ...devices['iPad Pro 11'], viewport: { width: 1024, height: 1366 } } },
  { n: 'ipad-v-820x1180', motor: webkit, ctx: { ...devices['iPad Pro 11'], viewport: { width: 820, height: 1180 } } },
  { n: 'iphone-430x932', motor: webkit, ctx: { ...devices['iPhone 15 Pro Max'] } },
  { n: 'iphone-390x844', motor: webkit, ctx: { ...devices['iPhone 14'] } },
];
const filtro = process.argv[2];
let fallos = 0;

/** Se ejecuta en la página: devuelve los defectos por tarjeta. */
function auditar() {
    const tiene = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
    const etq = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''}`;
    const txt = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48);
    const sr = (el) => !!el.closest('.kp-sr, .kp-sr-tabla') || (() => { for (let e = el; e && e !== document.body; e = e.parentElement) { const c = getComputedStyle(e); if (/rect\(0(px)?,? ?0(px)?,? ?0(px)?,? ?0(px)?\)/.test(c.clip) || (e.getBoundingClientRect().width <= 1.5 && c.overflow !== 'visible')) return true; } return false; })();
    const enScroll = (el) => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const c = getComputedStyle(e); if ((c.overflowX === 'auto' || c.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 1) return true; } return false; };
    const enClamp = (el) => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { if (getComputedStyle(e).webkitLineClamp !== 'none') return true; } return false; };
    const rectVisible = (el, raiz) => {
        const r = el.getBoundingClientRect(); let L = r.left, T = r.top, R = r.right, B = r.bottom;
        for (let e = el.parentElement; e; e = e.parentElement) {
            const c = getComputedStyle(e);
            if (c.overflowX !== 'visible' || c.overflowY !== 'visible') { const q = e.getBoundingClientRect(); L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom); }
            if (e === raiz) break;
        }
        return { left: L, top: T, right: R, bottom: B };
    };
    const raices = [...document.querySelectorAll('.kp-tile, .kc-ahora')];
    const res = [];
    for (const raiz of raices) {
        const id = raiz.id || (raiz.classList.contains('kc-ahora') ? 'kc-ahora' : etq(raiz));
        const rr = raiz.getBoundingClientRect();
        const solapes = [], cortados = [], recortes = [];
        // Cajas "hoja": elementos con texto propio, svg y img (no contenedores).
        const hojas = [...raiz.querySelectorAll('*')].filter((el) => visible(el) && (tiene(el) || el.tagName === 'svg' || el.tagName === 'IMG') && !sr(el) && getComputedStyle(el).position !== 'absolute');
        for (let i = 0; i < hojas.length; i++) {
            for (let j = i + 1; j < hojas.length; j++) {
                const a = hojas[i], b = hojas[j];
                if (a.contains(b) || b.contains(a)) continue;
                if (getComputedStyle(a).display === 'inline' && getComputedStyle(b).display === 'inline') continue;   // tramos de un mismo párrafo: sus cajas se solapan al partir línea
                const ra = rectVisible(a, raiz), rb = rectVisible(b, raiz);
                const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
                if (w > 3 && h > 3) solapes.push(`${etq(a)}«${txt(a)}» × ${etq(b)}«${txt(b)}» (${Math.round(w)}×${Math.round(h)} px)`);
            }
        }
        for (const el of raiz.querySelectorAll('*')) {
            if (!visible(el) || !tiene(el) || sr(el)) continue;
            const cs = getComputedStyle(el);
            const hor = el.scrollWidth > el.clientWidth + 1 && (cs.textOverflow === 'ellipsis' || cs.overflow !== 'visible');
            const ver = el.scrollHeight > el.clientHeight + 1 && cs.overflow !== 'visible' && cs.webkitLineClamp === 'none';
            if ((hor || ver) && !el.closest('.kp-sr')) cortados.push(`${etq(el)}«${txt(el)}»${el.title || el.getAttribute('aria-label') ? ' [con title]' : ''}`);
            const r = el.getBoundingClientRect();
            if ((r.bottom > rr.bottom + 1 || r.right > rr.right + 1) && !enScroll(el) && !enClamp(el)) recortes.push(`${etq(el)}«${txt(el)}» sobresale ${Math.round(Math.max(r.bottom - rr.bottom, r.right - rr.right))} px`);
        }
        if (solapes.length || cortados.length || recortes.length) res.push({ id, solapes: [...new Set(solapes)], cortados: [...new Set(cortados)], recortes: [...new Set(recortes)] });
    }
    return res;
}

for (const c of casos) {
    if (filtro && !c.n.startsWith(filtro)) continue;
    const b = await c.motor.launch(); const page = await (await b.newContext(c.ctx)).newPage();
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.kp-grid', { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(7000);
    const dev = await page.evaluate(() => document.documentElement.dataset.device);
    const r = await page.evaluate(auditar);
    await page.screenshot({ path: OUT + `${c.n}.png` });
    const malos = r.filter((t) => t.solapes.length || t.recortes.length);
    if (malos.length) fallos++;
    console.log(`\n${malos.length ? 'FALLA' : r.length ? 'AVISO' : 'OK   '} ${c.n} (device=${dev})`);
    for (const t of r) {
        for (const s of t.solapes) console.log(`   SOLAPE   ${t.id}: ${s}`);
        for (const s of t.recortes) console.log(`   RECORTE  ${t.id}: ${s}`);
        for (const s of t.cortados) console.log(`   CORTADO  ${t.id}: ${s}`);
    }
    await b.close();
}
console.log(fallos ? `\n${fallos} dispositivo(s) con solapes o recortes` : '\nSin solapes ni recortes');
process.exit(fallos ? 1 : 0);
