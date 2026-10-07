/**
 * infografiaPresasHtml — plantilla HTML autónoma de la infografía "Estado actual de las presas".
 *
 * Se rasteriza a PNG (iframe oculto + <svg><foreignObject> + canvas), por eso: CSS en <style> en línea,
 * imágenes solo como data URI, sin fuentes web, sin JS, sin filter/backdrop-filter ni position:fixed.
 * Regla rectora: S/D nunca cero; jamás se imprime NaN/undefined/null.
 */
import { fmtConSigno, fmtHm3, type DatosInfografia, type DatosPresaInfografia } from './infografiaPresas';
import type { EstadoSemaforo } from './estadisticaHistorica';

export const ANCHO_INFOGRAFIA = 1600;

const esc = (s: unknown): string =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const num = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Semáforo: color de relleno, color de texto sobre fondo claro (AA), glifo y texto (nunca solo color). */
const SEMAFORO: Record<EstadoSemaforo, { relleno: string; tinta: string; fondo: string; glifo: string; texto: string }> = {
    verde: { relleno: '#1B8A5A', tinta: '#0B5A3A', fondo: '#DDF3E6', glifo: '✔', texto: 'VERDE · tercio superior histórico' },
    ambar: { relleno: '#D9920B', tinta: '#7A4A00', fondo: '#FCEBC4', glifo: '▲', texto: 'ÁMBAR · tercio medio' },
    rojo: { relleno: '#C62828', tinta: '#8E1414', fondo: '#FBDADA', glifo: '✖', texto: 'ROJO · tercio inferior' },
    sd: { relleno: '#7A8591', tinta: '#3F4852', fondo: '#E6E9EC', glifo: '?', texto: 'SIN CLASIFICAR (S/D)' },
};

const PROCEDENCIA: Record<string, string> = { CAMPO: 'CAMPO', CILA: 'CILA·CALCULADA', ESTIMADA: 'ESTIMADA' };

const VIGENCIA = {
    ACTUALIZADO: { fondo: '#DDF3E6', tinta: '#0B5A3A', borde: '#1B8A5A', glifo: '●' },
    DESFASADO: { fondo: '#FCEBC4', tinta: '#7A4A00', borde: '#D9920B', glifo: '▲' },
    SD: { fondo: '#E6E9EC', tinta: '#3F4852', borde: '#7A8591', glifo: '?' },
} as const;

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fechaCorta(iso: string): string {
    const m = +iso.slice(5, 7);
    const d = +iso.slice(8, 10);
    return m >= 1 && m <= 12 && d ? `${String(d).padStart(2, '0')} ${MESES_CORTOS[m - 1]}` : 'S/D';
}

function filaCambio(p: DatosPresaInfografia): string {
    const dl = p.delta;
    if (!dl || !num(dl.mm3)) return `<div class="cambio"><span class="flecha eq">=</span><span class="cambio-t">Cambio: S/D</span></div>`;
    const sube = dl.mm3 > 0;
    const baja = dl.mm3 < 0;
    const cls = sube ? 'sube' : baja ? 'baja' : 'eq';
    const flecha = sube ? '▲' : baja ? '▼' : '=';
    const pp = num(dl.puntosPct) ? ` · ${fmtConSigno(dl.puntosPct)} pp` : '';
    const vs = dl.dias > 1 ? ` <span class="vs">vs ${esc(fechaCorta(dl.desde))}</span>` : ` <span class="vs">vs día anterior</span>`;
    return `<div class="cambio"><span class="flecha ${cls}">${flecha}</span><span class="cambio-t ${cls}">${esc(fmtConSigno(dl.mm3))} hm³${esc(pp)}</span>${vs}</div>`;
}

function filaComparativo(p: DatosPresaInfografia): string {
    const a = p.anioPrevio;
    const l1 = a
        ? `Mismo día ${esc(a.anio)}: <b>${esc(fmtHm3(a.valor))} hm³</b> <span class="dif">(${esc(fmtConSigno(a.difMm3))})</span>`
        : `Mismo día año anterior: <b>S/D</b>`;
    const l2 = p.posicionTexto ? esc(p.posicionTexto) : 'Posición histórica: S/D';
    return `<div class="comp"><div>${l1}</div><div class="pos">${l2}</div></div>`;
}

function barra(p: DatosPresaInfografia): string {
    const s = SEMAFORO[p.semaforo] ?? SEMAFORO.sd;
    const ok = num(p.pct);
    const w = ok ? Math.max(0, Math.min(100, p.pct as number)) : 0;
    const etiqueta = ok ? `${fmtHm3(p.pct)} %` : 'S/D';
    // La etiqueta va fuera del relleno (a su derecha) o dentro si hay espacio.
    const dentro = ok && w >= 22;
    return `<div class="barra-bloque">
  <div class="barra"><div class="relleno" style="width:${w.toFixed(3)}%;background:${s.relleno}">${dentro ? `<span class="b-et">${esc(etiqueta)}</span>` : ''}</div>${dentro ? '' : `<span class="b-et-fuera">${esc(etiqueta)}</span>`}</div>
  <div class="escala"><span>0 %</span><span>100 % = capacidad</span></div>
</div>`;
}

function tarjeta(p: DatosPresaInfografia): string {
    const s = SEMAFORO[p.semaforo] ?? SEMAFORO.sd;
    const sub = p.id === 'PRE-002' ? ' <span class="sub">(Las Vírgenes)</span>' : '';
    const proc = p.procedencia ? PROCEDENCIA[p.procedencia] ?? esc(p.procedencia) : null;
    const elev = num(p.elevacion) ? `${fmtHm3(p.elevacion, 2)} msnm` : 'S/D';
    const sal = num(p.salida) ? `${fmtHm3(p.salida, 1)} m³/s` : 'S/D';
    return `<section class="card">
  <div class="card-h">${esc(p.nombre)}${sub}</div>
  <div class="card-b">
    <div class="heroe"><span class="n">${esc(fmtHm3(p.volumen))}</span><span class="u">hm³</span></div>
    <div class="lbl">Almacenamiento actual</div>
    <div class="pctfila"><span class="pct">${esc(num(p.pct) ? `${fmtHm3(p.pct)} %` : 'S/D')}</span><span class="lbl2">de llenado</span></div>
    <div class="pillfila"><span class="pill" style="background:${s.fondo};color:${s.tinta};border-color:${s.relleno}"><span class="pg" style="background:${s.relleno}">${s.glifo}</span>${esc(s.texto)}</span></div>
    ${barra(p)}
    ${filaCambio(p)}
    ${filaComparativo(p)}
    <div class="chica"><span>Elevación: <b>${esc(elev)}</b>${proc && num(p.elevacion) ? ` <i>${esc(proc)}</i>` : ''}</span><span>Salida: <b>${esc(sal)}</b></span></div>
    <div class="cap">Capacidad de referencia: <b>${esc(fmtHm3(p.capacidad))} hm³</b></div>
  </div>
</section>`;
}

export function htmlInfografiaPresas(d: DatosInfografia, logoDataUri: string): string {
    const vg = VIGENCIA[d.vigencia?.estado] ?? VIGENCIA.SD;
    const vtxt = d.vigencia?.estado === 'ACTUALIZADO' ? 'ACTUALIZADO' : d.vigencia?.estado === 'DESFASADO' ? 'DESFASADO' : 'SIN DATO';
    const detalleVig = d.vigencia?.texto && d.vigencia.texto !== 'S/D' ? d.vigencia.texto : 'S/D';
    const corte = d.corte?.texto ? d.corte.texto : 'Corte: S/D';
    const logo = logoDataUri ? `<img class="logo" src="${esc(logoDataUri)}" alt="SRL">` : '<div class="logo-v"></div>';
    const c = d.conjunto;
    const parcial = c?.parcial ? `<span class="parcial">parcial: ${esc(c.presasConDato)} de ${esc(c.presasTotal)} presas</span>` : '';
    const tarjetas = (d.presas ?? []).map(tarjeta).join('');

    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Estado actual de las presas</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{margin:0;background:#FAF6EA}
body{width:${ANCHO_INFOGRAFIA}px;font-family:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif;color:#1B2733;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
.pagina{width:${ANCHO_INFOGRAFIA}px;padding:26px 48px 0 48px;background:#FAF6EA}
.enc{display:flex;align-items:center;justify-content:space-between;height:96px}
.logo,.logo-v{width:150px;height:96px;object-fit:contain;object-position:left center}
.marca{text-align:center;flex:1}
.marca .org{font-size:26px;font-weight:700;letter-spacing:.14em;color:#0B2A4A}
.sello{width:300px;display:flex;justify-content:flex-end}
.sello-i{border:3px solid;border-radius:14px;padding:8px 16px;text-align:center;line-height:1.15}
.sello-i b{display:block;font-size:24px;font-weight:800;letter-spacing:.06em}
.sello-i span{display:block;font-size:20px;font-weight:600}
.filete{height:0;border-top:3px solid #C9A227;margin:10px 0 0}
.filete2{height:0;border-top:1px solid #C9A227;margin:4px 0 0}
h1{font-size:68px;line-height:1.05;font-weight:800;color:#0F5C45;text-align:center;letter-spacing:.01em;margin-top:14px}
.corte{text-align:center;font-size:28px;font-weight:600;color:#0B2A4A;margin:8px 0 18px}
.fila{display:flex;gap:28px}
.card{flex:1;background:#fff;border:3px solid #C9A227;border-radius:18px;overflow:hidden}
.card-h{background:#0F5C45;color:#fff;font-size:40px;font-weight:800;padding:12px 24px;text-align:center;letter-spacing:.01em}
.card-h .sub{font-size:26px;font-weight:600;opacity:.95}
.card-b{padding:12px 28px 14px}
.heroe{display:flex;align-items:baseline;justify-content:center;gap:12px;line-height:1.02}
.heroe .n{font-size:104px;font-weight:800;color:#0B5FB0;letter-spacing:-.01em}
.heroe .u{font-size:44px;font-weight:700;color:#0B5FB0}
.lbl{text-align:center;font-size:26px;font-weight:600;color:#3A4856;margin-bottom:6px}
.pctfila{display:flex;align-items:baseline;justify-content:center;gap:12px;margin:2px 0 4px;white-space:nowrap}
.pillfila{text-align:center;margin:0 0 10px}
.pct{font-size:50px;font-weight:800;color:#0B2A4A}
.lbl2{font-size:24px;font-weight:600;color:#3A4856}
.pill{display:inline-flex;align-items:center;gap:10px;border:2px solid;border-radius:999px;padding:5px 18px 5px 6px;font-size:22px;font-weight:800;white-space:nowrap}
.pg{display:inline-block;width:32px;height:32px;border-radius:50%;color:#fff;text-align:center;line-height:32px;font-size:18px;font-weight:800}
.barra-bloque{margin:0 0 8px}
.barra{position:relative;height:42px;background:#E4E8EC;border:2px solid #0B2A4A;border-radius:10px;overflow:hidden}
.relleno{height:100%;display:flex;align-items:center;justify-content:flex-end}
.b-et{color:#fff;font-weight:800;font-size:22px;padding-right:12px;text-shadow:0 0 3px rgba(0,0,0,.45)}
.b-et-fuera{position:absolute;left:10px;top:0;line-height:38px;font-weight:800;font-size:22px;color:#0B2A4A}
.escala{display:flex;justify-content:space-between;font-size:20px;font-weight:600;color:#4A5663;margin-top:3px}
.cambio{display:flex;align-items:center;gap:10px;font-size:26px;font-weight:700;margin:4px 0}
.flecha{font-size:28px;font-weight:800;width:34px;text-align:center}
.sube{color:#0B5A3A}.baja{color:#8E1414}.eq{color:#3F4852}
.vs{font-size:22px;font-weight:600;color:#3A4856}
.comp{font-size:24px;font-weight:500;color:#1B2733;line-height:1.3;margin:4px 0;padding:6px 0;border-top:1px solid #E1D6AE}
.comp b{font-weight:800}.comp .dif{font-weight:700;color:#3A4856}
.comp .pos{font-weight:700;color:#0B2A4A}
.chica{display:flex;justify-content:space-between;font-size:22px;color:#3A4856;font-weight:500;padding-top:6px;border-top:1px solid #E1D6AE}
.chica b{font-weight:800;color:#1B2733}.chica i{font-style:normal;font-size:20px;font-weight:700;color:#0F5C45;border:1px solid #0F5C45;border-radius:6px;padding:0 6px;margin-left:4px}
.cap{font-size:22px;font-weight:500;color:#3A4856;padding-top:4px;text-align:center}
.cap b{font-weight:800;color:#1B2733}
.conj{margin-top:18px;background:#0B2A4A;color:#fff;border-radius:14px;padding:16px 28px;text-align:center;font-size:44px;font-weight:800;letter-spacing:.02em}
.conj .parcial{display:block;font-size:22px;font-weight:600;color:#F2E3A6;letter-spacing:0;margin-top:2px}
.pie{display:flex;justify-content:space-between;gap:30px;font-size:20px;color:#3A4856;padding:12px 0 18px;line-height:1.3}
.pie div:first-child{flex:1}.pie div:last-child{flex:1;text-align:right}
</style></head>
<body><div class="pagina">
<div class="enc">
  <div style="width:300px">${logo}</div>
  <div class="marca"><div class="org">SRL UNIDAD CONCHOS · DR-005</div></div>
  <div class="sello"><div class="sello-i" style="background:${vg.fondo};color:${vg.tinta};border-color:${vg.borde}"><b>${vg.glifo} ${esc(vtxt)}</b><span>${esc(detalleVig)}</span></div></div>
</div>
<div class="filete"></div><div class="filete2"></div>
<h1>ESTADO ACTUAL DE LAS PRESAS</h1>
<div class="corte">${esc(corte)}</div>
<div class="fila">${tarjetas}</div>
<div class="conj">ALMACENAMIENTO CONJUNTO: ${esc(fmtHm3(c?.totalMm3))} hm³${parcial}</div>
<div class="pie"><div>${esc(d.fuente || 'S/D')}</div><div>${esc(d.limitacion || 'S/D')}</div></div>
</div></body></html>`;
}
