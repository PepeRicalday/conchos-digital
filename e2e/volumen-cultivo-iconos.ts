// Hoja de íconos de «Agua entregada por cultivo»: catálogo completo a 64/20/16 px en oscuro y claro, y tira de comparación de cultivos de silueta parecida.
//   npx vite-node e2e/volumen-cultivo-iconos.ts <iteracion>
import { chromium } from 'playwright';
import { CATALOGO_CULTIVOS, CULTIVO_OTROS, iconoCultivoSvg } from '../src/utils/cultivos';

const iter = process.argv[2] || '12';
const OUT = new URL(`../../ciclo_2025_2026/auditoria/volumen_cultivo/iter${iter}/`, import.meta.url);
const todos = [...CATALOGO_CULTIVOS, CULTIVO_OTROS];
const svg = (i: (typeof todos)[number], px: number, claro: boolean) => iconoCultivoSvg(i.nombre, px, claro ? i.colorClaro : i.color);
const ficha = (i: (typeof todos)[number], px: number, claro: boolean) => `<div class="f ${claro ? 'c' : 'o'}">${svg(i, px, claro)}<span>${i.nombre}</span></div>`;
const comp = ['Trigo', 'Avena', 'Maíz', 'Algodón', 'Sorgo'].map((n) => todos.find((x) => x.nombre === n)!);
const fila = (lista: typeof todos, px: number, claro: boolean) => `<div class="r ${claro ? 'c' : 'o'}">${lista.map((i) => ficha(i, px, claro)).join('')}</div>`;
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:14px;background:#0a1020;font:12px system-ui;color:#e2e8f0;width:1500px}
.r{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px;padding:8px;border-radius:12px}.o{background:#101a2e}.c{background:#fff;color:#0f172a}
.f{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:90px}h3{margin:12px 0 4px;font-size:13px;color:#94a3b8}
</style>
<h3>Comparación Trigo · Avena · Maíz · Algodón · Sorgo (96 px, 48 px, 20 px, 16 px)</h3>
${[96, 48, 20, 16].map((px) => fila(comp, px, false)).join('')}${[96, 48, 20, 16].map((px) => fila(comp, px, true)).join('')}
<h3>Catálogo completo 64 px</h3>${fila(todos, 64, false)}${fila(todos, 64, true)}
<h3>20 px</h3>${fila(todos, 20, false)}${fila(todos, 20, true)}
<h3>16 px</h3>${fila(todos, 16, false)}${fila(todos, 16, true)}`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1530, height: 800 }, deviceScaleFactor: 2 });
await p.setContent(html);
await p.screenshot({ path: new URL('hoja_iconos.png', OUT).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' '), fullPage: true });
await b.close();
