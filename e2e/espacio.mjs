// Auditoría de ESPACIO en pantalla con Playwright — solo lectura.
//   npm run audit:espacio [-- --rutas=/clima,/alertas] [--disp=ipad,ipadv,desktop] [--sin-fotos]
// Por ruta mide, dentro de .main-content y sobre una retícula de 16 px, qué celdas cubre algún elemento visible
// (texto, imagen/svg/canvas/control, o caja con fondo o borde). Reporta % vacío en la altura útil, el mayor
// rectángulo vacío (y qué fracción de una pantalla representa) y la ocupación de la mitad izquierda/derecha.
// Requiere `npm run dev` (:5173, bypass de login en localhost). Capturas en e2e/out/espacio/.
// Limitación: una tarjeta con fondo cuenta como ocupada aunque esté vacía por dentro; los huecos internos se revisan en la captura.
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DISP = {
  ipad: { viewport: { width: 1280, height: 960 }, isMobile: true, hasTouch: true, userAgent: UA_IPAD },
  ipad11: { viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true, userAgent: UA_IPAD },
  ipadv: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, userAgent: UA_IPAD },
  desktop: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
};
const RUTAS = ['/', '/clima', '/presas', '/escalas', '/hidrometria', '/canales', '/balance', '/modelacion-hidraulica', '/analisis-historico', '/alertas', '/geo-monitor', '/conservacion', '/monitor-publico', '/infraestructura', '/bitacora', '/ciclos', '/reporte-oficial', '/inteligencia-hidrica', '/protocolos', '/importar'];
const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
// Git Bash convierte "/clima" en "C:/Program Files/Git/clima": se recorta ese prefijo.
const rutas = flag('rutas') ? flag('rutas').split(',').map((r) => '/' + r.replace(/^[A-Za-z]:\/.*?\/Git\//, '').replace(/^\//, '')) : RUTAS;
const disps = (flag('disp') ?? 'ipad').split(',');
const sinFotos = args.includes('--sin-fotos');
const OUT = new URL('./out/espacio/', import.meta.url); fs.mkdirSync(OUT, { recursive: true });

const MEDIR=()=>{
  const main=document.querySelector('.main-content'); if(!main) return null;
  const mr=main.getBoundingClientRect(); const sy=main.scrollTop;
  const cs=getComputedStyle(main); const padL=parseFloat(cs.paddingLeft), padR=parseFloat(cs.paddingRight);
  const W=main.clientWidth-padL-padR, X0=mr.left+padL, H=main.scrollHeight;
  const CEL=16, cols=Math.ceil(W/CEL), rows=Math.ceil(H/CEL); const g=new Uint8Array(cols*rows);
  const visible=(s)=>s.display!=='none'&&s.visibility!=='hidden'&&+s.opacity>0.05;
  const tieneFondo=s=>{const m=s.backgroundColor.match(/rgba?\(([^)]+)\)/);const a=m?(m[1].split(',')[3]??'1'):'0';return +a>0.04||s.backgroundImage!=='none'};
  const tieneBorde=s=>['Top','Right','Bottom','Left'].some(k=>parseFloat(s['border'+k+'Width'])>0&&!/rgba\([^)]*,\s*0\)/.test(s['border'+k+'Color']));
  let n=0;
  for(const el of main.querySelectorAll('*')){
    const s=getComputedStyle(el); if(!visible(s)) continue;
    const r=el.getBoundingClientRect(); if(r.width<4||r.height<4) continue;
    // contenedores de página: casi todo el ancho y alto -> no cuentan
    if(r.width>W*0.97&&r.height>H*0.6) continue;
    const hoja=['IMG','SVG','CANVAS','svg','VIDEO','IFRAME','INPUT','SELECT','BUTTON'].includes(el.tagName)||[...el.childNodes].some(c=>c.nodeType===3&&c.textContent.trim());
    if(!(hoja||tieneFondo(s)||tieneBorde(s))) continue;
    n++;
    const x1=Math.max(0,Math.floor((r.left-X0)/CEL)), x2=Math.min(cols,Math.ceil((r.right-X0)/CEL));
    const y1=Math.max(0,Math.floor((r.top-mr.top+sy)/CEL)), y2=Math.min(rows,Math.ceil((r.bottom-mr.top+sy)/CEL));
    for(let y=y1;y<y2;y++) for(let x=x1;x<x2;x++) g[y*cols+x]=1;
  }
  // altura útil = última fila ocupada
  let last=0; for(let y=0;y<rows;y++) for(let x=0;x<cols;x++) if(g[y*cols+x]) last=y;
  const R=last+1; let vac=0; for(let i=0;i<R*cols;i++) if(!g[i]) vac++;
  // mayor rectángulo vacío (histograma)
  const h=new Array(cols).fill(0); let best={a:0};
  for(let y=0;y<R;y++){ for(let x=0;x<cols;x++) h[x]=g[y*cols+x]?0:h[x]+1;
    const st=[]; for(let x=0;x<=cols;x++){const v=x<cols?h[x]:0; let s0=x; while(st.length&&st[st.length-1][1]>=v){const [p,hv]=st.pop(); const a=hv*(x-p); if(a>best.a) best={a,x:p,w:x-p,y:y-hv+1,h:hv}; s0=p;} st.push([s0,v]);} }
  // ocupación por mitad derecha / izquierda en la altura útil
  const half=Math.floor(cols/2); let occL=0,occR=0; for(let y=0;y<R;y++) for(let x=0;x<cols;x++) if(g[y*cols+x]) (x<half?occL++:occR++);
  return {anchoUtil:Math.round(W),altoUtil:R*CEL,elems:n,vacioPct:Math.round(100*vac/(R*cols)),
    mayorHueco:best.a?{x:best.x*CEL,y:best.y*CEL,w:best.w*CEL,h:best.h*CEL,pctPantalla:Math.round(100*best.w*best.h*CEL*CEL/(W*innerHeight))}:null,
    ocupIzq:Math.round(100*occL/(R*half)),ocupDer:Math.round(100*occR/(R*(cols-half)))};
};

const b = await chromium.launch();
const filas = [];
for (const d of disps) {
  const ctx = await b.newContext({ ...DISP[d], deviceScaleFactor: 1 });
  for (const r of rutas) {
    const p = await ctx.newPage();
    try { await p.goto('http://localhost:5173' + r, { waitUntil: 'networkidle', timeout: 45000 }); } catch { /* las páginas con realtime no llegan a networkidle */ }
    await p.waitForTimeout(4000);
    await p.evaluate(async () => { const m = document.querySelector('.main-content'); if (!m) return; for (let y = 0; y < m.scrollHeight; y += 700) { m.scrollTop = y; await new Promise((res) => setTimeout(res, 250)); } m.scrollTop = 0; });
    await p.waitForTimeout(1200);
    const m = await p.evaluate(MEDIR);
    const fila = { disp: d, ruta: r, dev: await p.evaluate(() => document.documentElement.dataset.device), ...m };
    filas.push(fila); console.log(JSON.stringify(fila));
    if (!sinFotos) {
      // Se conserva el viewport (no cambia orientación ni dispositivo) y se libera el scroll interno para la captura completa.
      await p.addStyleTag({ content: 'html,body,#root,.layout-container,.main-content{height:auto!important;max-height:none!important;overflow:visible!important}' });
      await p.waitForTimeout(1500);
      await p.screenshot({ path: fileURLToPath(new URL(`${d}_${(r.slice(1) || 'dashboard').replace(/\//g, '_')}.jpg`, OUT)), type: 'jpeg', quality: 60, fullPage: true });
    }
    await p.close();
  }
  await ctx.close();
}
fs.writeFileSync(fileURLToPath(new URL('resumen.json', OUT)), JSON.stringify(filas, null, 1));
await b.close();
