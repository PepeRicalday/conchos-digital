/**
 * informeBase — piezas comunes de los informes institucionales HTML (identidad SRL, hoja Carta, tokens, folio, trazabilidad,
 * bloque de firmas y componentes de hoja compartidos). Lo usan los informes de NDVI, manejo de vaso y conservación.
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

/** Hash corto y estable (FNV-1a de 32 bits, 8 hex) para identificar una configuración o un contenido; no es criptográfico. */
export function hashCorto(texto: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
}

/** Folio con alcance y periodo: PREFIJO-PARTE1-PARTE2-AAAAMMDD-HHMM (las partes se sanean: mayúsculas, sin espacios; se conservan los guiones internos). */
export function folioConPartes(prefijo: string, partes: string[], ahora: Date = new Date()): string {
    const limpias = partes.map((p) => p.toUpperCase().replace(/[^A-Z0-9-]+/g, '').replace(/^-+|-+$/g, '')).filter(Boolean);
    return [prefijo, ...limpias, `${ahora.getFullYear()}${dos(ahora.getMonth() + 1)}${dos(ahora.getDate())}`, `${dos(ahora.getHours())}${dos(ahora.getMinutes())}`].join('-');
}

/** Nombre de archivo con partes (alcance, periodo): minúsculas con guiones y fecha ISO local de emisión. */
export function nombreArchivoConPartes(base: string, partes: string[], ahora: Date = new Date()): string {
    const limpias = partes.map((p) => p.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).filter(Boolean);
    return [base, ...limpias, `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`].join('-') + '.html';
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

/** '2026-09-01' → '1 de septiembre de 2026'; formato inesperado o vacío → 'S/D' (nunca el ISO crudo). */
export function fechaLarga(iso: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
    if (!m || !MESES_LARGO[Number(m[2]) - 1]) return 'S/D';
    return `${Number(m[3])} de ${MESES_LARGO[Number(m[2]) - 1]} de ${m[1]}`;
}

/** Último día incluido de una ventana cuya fecha final es EXCLUSIVA ('2026-10-01' → '2026-09-30'); sin fecha válida → null. */
export function ultimoDiaIncluido(finExclusivo: string | null | undefined): string | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(finExclusivo ?? '');
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 86_400_000);
    return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
}

/** Familia tipográfica de los textos SVG de los informes: se declara una vez en el CSS en vez de repetirla en cada <text>. */
export const FUENTE_SVG = 'Segoe UI, Helvetica, Arial, sans-serif';

/** Quita el atributo font-family de los <text> de los SVG ya armados (la regla `svg text` del CSS lo reemplaza): ≈ 55 bytes por rótulo. */
export function unificaFuenteSvg(html: string): string {
    return html.split(` font-family="${FUENTE_SVG}"`).join('');
}

/** Regla CSS que sustituye al atributo quitado por unificaFuenteSvg: va solo en los informes que lo usan (no en el CSS común). */
export const CSS_FUENTE_SVG = `svg text{font-family:${FUENTE_SVG.split(',').map((f) => f.trim()).map((f) => (f.includes(' ') ? `"${f}"` : f)).join(',')}}`;

/** Quita comentarios y espacios sobrantes del CSS (≈ 15 % menos peso); no cambia ninguna regla. */
export function minificaCss(css: string): string {
    return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '').replace(/\s*([{};,])\s*/g, '$1').replace(/:\s+/g, ':').trim();
}

export interface OpcionesCss { formato?: 'letter' | 'a4' }

/** CSS de hoja institucional: tokens, tipografía en pt (mínimo 7.5 pt), componentes y reglas de impresión. */
export function cssInforme(o: OpcionesCss = {}): string {
    const hoja = o.formato === 'a4' ? 'A4' : 'letter';
    return `
:root{--inst:${SRL_MARRON};--inst-claro:#f4eaea;--ink:#1f2328;--ink2:#57606a;--linea:#dcd9d2;--papel:#fff;--pantalla:#eceae5;--sd:#6a737d;--aviso:#9a6700;--aviso-bg:#fff8e6}
*{box-sizing:border-box}
html{color-scheme:light;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:var(--pantalla);color:var(--ink);font:9.5pt/1.45 "Segoe UI","Helvetica Neue",Arial,sans-serif}
.num,td.n,th.n{font-family:Consolas,"SF Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums;text-align:right}
.sd{color:var(--sd);font-style:italic}
.pagina{position:relative;background:var(--papel);width:100%;max-width:${o.formato === 'a4' ? '210mm' : '215.9mm'};margin:12px auto;padding:12mm;min-height:${o.formato === 'a4' ? '287mm' : '270mm'};display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto 1fr auto;box-shadow:0 1px 8px rgba(0,0,0,.15)}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@page{size:${hoja} portrait;margin:0}
@media print{
  body{background:#fff}
  /* Alto = una hoja; si un contenido la excede NO se recorta (fluye a la siguiente) para no perder datos en silencio. */
  .pagina{margin:0;box-shadow:none;max-width:none;width:100%;min-height:100vh;height:auto;break-after:page;page-break-after:always}
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
/* Componentes de hoja compartidos (corrida, portada, datos clave, frases, columnas, definiciones) */
.run{display:flex;justify-content:space-between;font-size:7.5pt;letter-spacing:.08em;text-transform:uppercase;color:var(--ink2);border-bottom:1px solid var(--linea);padding-bottom:4px;margin-bottom:8px}
.run b{color:var(--inst)}
.cuerpo{min-width:0}
.banda{margin:2mm 0 4mm}
.banda small{display:block;font-size:8pt;color:var(--ink2);margin-bottom:3px}
.banda h1{font-size:20pt}
.banda .sub{font:10pt Georgia,serif;color:var(--ink2);margin-top:2px}
.datos{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:4mm 0 3mm}
.dato{border-top:3px solid var(--inst);padding-top:4px}
.dato b{display:block;font-size:8pt;color:var(--ink2)}
.dato span{font:600 10pt Georgia,serif}
.frase{font:10.5pt/1.4 Georgia,serif;margin:2px 0 6px}
.nota-pie{margin-top:6px;font-size:7.5pt;color:var(--ink2)}
.cols3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;font-size:8.5pt}
.def dt{font-weight:700;color:var(--inst);margin-top:5px}
.def dd{margin:0 0 2px;color:var(--ink)}
/* Bloque de firmas (Elaboró / Revisó / Autorizó) y tabla de trazabilidad */
.firmas{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:14px;break-inside:avoid}
.firma{padding-top:30px}
.firma .linea{border-top:1px solid var(--ink);margin-bottom:3px}
.firma b{display:block;font-size:8.5pt}
.firma span{display:block;font-size:7.5pt;color:var(--ink2)}
table.traza{font-size:8pt} table.traza th{width:34%;text-transform:none;letter-spacing:0;font-size:7.5pt;background:var(--inst-claro);color:var(--inst)}
table.traza td{overflow-wrap:anywhere}
@media screen and (max-width:720px){
  .pagina{padding:12px;min-height:0}
  .kpis{grid-template-columns:1fr 1fr}
  .tabla-wrap{overflow-x:auto}
  .hdr{flex-wrap:wrap}
  .hdr .meta{text-align:left}
  .cols3,.firmas{grid-template-columns:1fr}
  .datos{grid-template-columns:1fr 1fr}
  .banda h1{font-size:16pt}
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

/** Bloque de firmas reutilizable (opcional por informe). `nombres` pone el nombre ya conocido de quien elabora (p. ej. el emisor). */
export function bloqueFirmas(o: { roles?: string[]; nombres?: Record<string, string> } = {}): string {
    const roles = o.roles ?? ['Elaboró', 'Revisó', 'Autorizó'];
    return `<div class="firmas" aria-label="Firmas">${roles.map((r) => `<div class="firma"><div class="linea"></div><b>${esc(r)}</b><span>${esc(o.nombres?.[r] ?? 'Nombre, cargo y firma')}</span></div>`).join('')}</div>`;
}

/** Tabla de trazabilidad (clave/valor) para anexos: folio, corte de datos, método, versión, hash… */
export function tablaTrazabilidad(filas: { k: string; v: string }[]): string {
    return `<table class="traza"><tbody>${filas.map((f) => `<tr><th scope="row">${esc(f.k)}</th><td>${esc(f.v)}</td></tr>`).join('')}</tbody></table>`;
}

export function documentoHtml(o: { titulo: string; css: string; cuerpo: string; metas?: Record<string, string> }): string {
    const metas = Object.entries(o.metas ?? {}).map(([k, v]) => `<meta name="${esc(k)}" content="${esc(v)}">`).join('\n');
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">${metas ? `\n${metas}` : ''}
<title>${esc(o.titulo)}</title>
<style>${o.css}</style>
</head><body>
${o.cuerpo}
<button class="btn-imprimir no-print" type="button" onclick="window.print()">Imprimir / Guardar PDF</button>
</body></html>`;
}
