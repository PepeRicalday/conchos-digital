/**
 * informeBase — piezas comunes de los informes institucionales HTML (identidad SRL, hoja Carta, tokens, folio).
 * Hoy lo usa el informe de NDVI; los demás informes repiten su propio CSS y podrán migrar sin prisa.
 * Todo es puro (strings): se prueba con vitest sin navegador.
 */
import { COLOR_INSTITUCIONAL, escSvg } from './informeHistoricoSvg';

export const SRL_MARRON = COLOR_INSTITUCIONAL;
/** Escape de texto dinámico para HTML/atributos (nombres de módulo, emisor, avisos). */
export const esc = escSvg;

const dos = (n: number) => String(n).padStart(2, '0');

/** Folio legible y ordenable: PREFIJO-AAAAMMDD-HHMM (hora local de quien emite). */
export function folioInforme(prefijo: string, ahora: Date = new Date()): string {
    return `${prefijo}-${ahora.getFullYear()}${dos(ahora.getMonth() + 1)}${dos(ahora.getDate())}-${dos(ahora.getHours())}${dos(ahora.getMinutes())}`;
}

/** Nombre de archivo en minúsculas con guiones y fecha ISO local. */
export function nombreArchivo(base: string, ahora: Date = new Date()): string {
    return `${base}-${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}.html`;
}

const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** '2026-09' (o '2026-09-01') → 'septiembre 2026' / 'sep 2026'. Formato inesperado → el texto tal cual. */
export function mesLegible(mes: string | null | undefined, corto = false): string {
    const m = /^(\d{4})-(\d{2})/.exec(mes ?? '');
    if (!m) return mes ?? 'S/D';
    const nombre = MESES_LARGO[Number(m[2]) - 1];
    if (!nombre) return mes ?? 'S/D';
    return `${corto ? nombre.slice(0, 3) : nombre} ${m[1]}`;
}

export function fechaHoraLegible(d: Date): string {
    const f = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
    return `${f}, ${dos(d.getHours())}:${dos(d.getMinutes())} h`;
}

export interface OpcionesCss { formato?: 'letter' | 'a4' }

/** CSS de hoja institucional: tokens, tipografía en pt (mínimo 7.5 pt), componentes y reglas de impresión. */
export function cssInforme(o: OpcionesCss = {}): string {
    const hoja = o.formato === 'a4' ? 'A4' : 'letter';
    return `
:root{--inst:${SRL_MARRON};--inst-claro:#f4eaea;--ink:#1f2328;--ink2:#57606a;--linea:#dcd9d2;--papel:#fff;--pantalla:#eceae5;--sd:#8c959f;--aviso:#9a6700;--aviso-bg:#fff8e6}
*{box-sizing:border-box}
html{color-scheme:light;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:var(--pantalla);color:var(--ink);font:9.5pt/1.45 "Segoe UI","Helvetica Neue",Arial,sans-serif}
.num,td.n,th.n{font-family:Consolas,"SF Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums;text-align:right}
.sd{color:var(--sd);font-style:italic}
.pagina{position:relative;background:var(--papel);width:100%;max-width:215.9mm;margin:12px auto;padding:14mm;min-height:250mm;display:flex;flex-direction:column;box-shadow:0 1px 8px rgba(0,0,0,.15)}
.pagina>.cuerpo{flex:1}
@page{size:${hoja} portrait;margin:0}
@media print{
  body{background:#fff}
  .pagina{margin:0;box-shadow:none;max-width:none;width:100%;height:100vh;min-height:0;break-after:page;page-break-after:always;overflow:hidden}
  .pagina:last-child{break-after:auto;page-break-after:auto}
  .no-print{display:none!important}
}
.kpi,.ficha,.fig,.aviso,tr,figure{break-inside:avoid}
h2,h3,caption{break-after:avoid}
thead{display:table-header-group}
/* Cabecera y pie */
.hdr{display:flex;align-items:center;gap:14px;border-bottom:3px solid var(--inst);padding-bottom:10px;margin-bottom:12px}
.hdr img{height:52px;width:auto;object-fit:contain}
.hdr .org{flex:1;min-width:0}
.hdr .org b{display:block;font-family:Georgia,serif;font-size:13pt;letter-spacing:.18em;color:var(--inst)}
.hdr .org span{font-size:8pt;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2)}
.hdr .meta{font-size:7.5pt;color:var(--ink2);text-align:right;line-height:1.5}
.pie-pagina{margin-top:10px;padding-top:6px;border-top:3px solid var(--inst);display:flex;justify-content:space-between;gap:12px;font-size:7.5pt;color:var(--ink2);text-transform:uppercase;letter-spacing:.06em}
/* Secciones */
h1{font:700 18pt/1.15 Georgia,serif;color:var(--inst);margin:0 0 4px}
h2{font:700 13pt/1.2 Georgia,serif;color:var(--inst);margin:0 0 8px;padding-bottom:4px;border-bottom:1.5px solid var(--linea)}
h2 .n{display:inline-block;min-width:1.4em;color:#fff;background:var(--inst);border-radius:3px;text-align:center;font-size:10pt;margin-right:6px;padding:0 4px}
h3{font:700 10.5pt/1.2 "Segoe UI",Arial,sans-serif;color:var(--ink);margin:10px 0 4px}
p{margin:0 0 6px}
.fuente{font-size:7.5pt;color:var(--ink2);margin-top:4px}
/* Tablas */
table{width:100%;border-collapse:collapse;font-size:8.5pt}
th{background:var(--inst);color:#fff;padding:5px 6px;text-align:left;font-size:7.5pt;letter-spacing:.04em;text-transform:uppercase}
td{padding:4px 6px;border-bottom:1px solid var(--linea)}
caption{text-align:left;font-weight:700;color:var(--inst);padding:6px 0 4px;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em}
/* KPI y chips */
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:8px 0}
.kpi{border:1px solid var(--linea);border-top:4px solid var(--inst);border-radius:4px;padding:8px 10px;background:#fff}
.kpi .et{font-size:7.5pt;letter-spacing:.08em;text-transform:uppercase;color:var(--ink2)}
.kpi .v{font:700 20pt/1.1 Georgia,serif;color:var(--ink);margin:2px 0}
.kpi .s{font-size:8pt;color:var(--ink2)}
.chip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--linea);border-radius:999px;padding:1px 8px;font-size:8pt;font-weight:600;color:var(--ink);white-space:nowrap}
.chip i{width:10px;height:10px;border-radius:2px;border:1px solid rgba(0,0,0,.35);display:inline-block}
/* Avisos */
.aviso{border:1px solid #e3c98a;border-left:5px solid #C27A0E;background:var(--aviso-bg);border-radius:3px;padding:7px 10px;font-size:8.5pt;color:#5c3d00;margin:6px 0}
.aviso b{color:#5c3d00}
.btn-imprimir{position:fixed;right:14px;bottom:14px;z-index:10;background:var(--inst);color:#fff;border:0;border-radius:8px;padding:10px 16px;font:600 10pt "Segoe UI",Arial,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);min-height:44px}
@media screen and (max-width:720px){
  .pagina{padding:12px;min-height:0}
  .kpis{grid-template-columns:1fr 1fr}
  .tabla-wrap{overflow-x:auto}
  .hdr{flex-wrap:wrap}
  .hdr .meta{text-align:left}
}
`;
}

export interface MetaCabecera { k: string; v: string }

/** Cabecera institucional: logo SRL (si falló, queda el texto de la marca), bloque de organización y metadatos. */
export function cabeceraInforme(o: { logoSrl: string; logoSica?: string; titulo: string; meta: MetaCabecera[] }): string {
    const img = (src: string | undefined, alt: string) => (src ? `<img src="${esc(src)}" alt="${esc(alt)}">` : '');
    return `<header class="hdr">
  ${img(o.logoSrl, 'S R L Unidad Conchos')}
  <div class="org"><b>S R L&nbsp;&nbsp;Unidad Conchos</b><span>DELICIAS · ${esc(o.titulo)}</span></div>
  ${img(o.logoSica, 'SICA-005')}
  <div class="meta">${o.meta.map((m) => `<div><b>${esc(m.k)}:</b> ${esc(m.v)}</div>`).join('')}</div>
</header>`;
}

export function pieInforme(izq: string, pagina: number, total: number): string {
    return `<footer class="pie-pagina"><span>${esc(izq)}</span><span>Pág. ${pagina} de ${total}</span></footer>`;
}

export function documentoHtml(o: { titulo: string; css: string; cuerpo: string }): string {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(o.titulo)}</title>
<style>${o.css}</style>
</head><body>
${o.cuerpo}
<button class="btn-imprimir no-print" type="button" onclick="window.print()">Imprimir / Guardar PDF</button>
</body></html>`;
}
