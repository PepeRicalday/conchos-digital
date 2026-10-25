/**
 * informeNivelTendenciaHtml — plantilla HTML autónoma (sin JS ni fuentes web, logos como data URI) del informe-infografía
 * "Nivel y Tendencia de Presas". Una sola plantilla sirve a la vista previa, al PDF (impresión) y al PNG (rasterizaHtml).
 * Diseño: hoja vertical de 980 px (una por presa), jerarquía "ficha ejecutiva": cifra héroe → tendencia → contexto histórico.
 * Regla rectora: S/D nunca es cero; jamás se imprime NaN/undefined/null.
 */
import { COLOR_INSTITUCIONAL } from './informeHistoricoSvg';
import { COTAS_OFICIALES } from './cotasPresas';
import { MESES_LARGO, formatearNumero } from './historicoPresas';
import { esc, fechaHoraLegible, fechaLarga, folioConPartes, pieInforme, cabeceraInforme, minificaCss } from './informeBase';
import {
    COLOR_AGUA, svgAreaMes, svgCalor, svgCierres, svgCurvasAnios, svgMovimientoBarras, svgPosicionHistorica,
} from './informeNivelTendenciaSvg';
import type { DatosNivelTendencia, DatosPresaNT, EstadoTendencia } from './informeNivelTendenciaDatos';
import type { EstadoSemaforo } from './estadisticaHistorica';

export const ANCHO_INFORME_NT = 980;
export type ModoInformeNT = 'pantalla' | 'png';
export interface LogosNT { srl: string; sica: string }

const n = formatearNumero;
const conSigno = (v: number | null, d: number): string => (v == null ? 'S/D' : (v > 0 ? '+' : v < 0 ? '−' : '') + formatearNumero(Math.abs(v), d));
const flecha = (v: number | null) => (v == null ? '' : v > 0 ? '▲' : v < 0 ? '▼' : '■');

const FUENTE: Record<string, string> = { CAMPO: 'Lectura de campo (SICA)', CILA: 'CILA / USIBWC', HISTORICO: 'Histórico SRL' };

const SEM: Record<EstadoSemaforo, { cls: string; glifo: string; txt: string }> = {
    verde: { cls: 'alto', glifo: '▲', txt: 'Por encima de lo habitual para esta fecha' },
    ambar: { cls: 'medio', glifo: '●', txt: 'Dentro de lo habitual para esta fecha' },
    rojo: { cls: 'bajo', glifo: '▼', txt: 'Por debajo de lo habitual para esta fecha' },
    sd: { cls: 'sd', glifo: '–', txt: 'Sin años suficientes para clasificar (se requieren 3)' },
};
const TEND: Record<EstadoTendencia, { cls: string; glifo: string; txt: string }> = {
    sube: { cls: 'sube', glifo: '▲', txt: 'Subiendo' },
    baja: { cls: 'baja', glifo: '▼', txt: 'Bajando' },
    estable: { cls: 'est', glifo: '■', txt: 'Estable' },
    sd: { cls: 'sd', glifo: '–', txt: 'S/D' },
};

const CSS = minificaCss(`
:root{--inst:${COLOR_INSTITUCIONAL};--inst2:#f4eaea;--agua:${COLOR_AGUA};--ink:#1b2430;--ink2:#56616e;--linea:#e4e1da;--fondo:#f5f3ee;--papel:#fff;--sd:#6a737d}
*{box-sizing:border-box}
html{color-scheme:light;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:var(--fondo);color:var(--ink);font:14px/1.45 "Segoe UI","Helvetica Neue",Arial,sans-serif}
body.png{background:#fff}
.hoja{width:${ANCHO_INFORME_NT}px;margin:14px auto;background:var(--papel);padding:30px 36px 22px;border-radius:6px;box-shadow:0 1px 10px rgba(0,0,0,.14);position:relative}
body.png .hoja{margin:0;box-shadow:none;border-radius:0}
.hdr{display:flex;align-items:center;gap:16px;border-bottom:4px solid var(--inst);padding-bottom:12px;margin-bottom:18px}
.hdr img{height:60px;width:auto}
.hdr .org{flex:1;min-width:0}
.hdr .org b{display:block;font:700 17px Georgia,serif;letter-spacing:.2em;color:var(--inst)}
.hdr .org span{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2)}
.hdr .meta{font-size:11px;color:var(--ink2);text-align:right;line-height:1.55}
.titulo{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:14px}
.titulo small{display:block;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink2);margin-bottom:2px}
.titulo h1{margin:0;font:700 32px/1.05 Georgia,serif;color:var(--inst)}
.titulo .periodo{font:600 15px Georgia,serif;color:var(--ink2);text-align:right}
.hero{display:grid;grid-template-columns:1.25fr 1fr 1fr;gap:12px;margin-bottom:6px}
.card{border:1px solid var(--linea);border-radius:10px;padding:14px 16px;background:#fff;min-width:0}
.card.nivel{background:linear-gradient(160deg,#6B2D2D,#4a1f1f);color:#fff;border:0}
.card.nivel .et{color:#e9cfcf}
.et{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2);font-weight:700}
.big{font:700 46px/1 Georgia,serif;font-variant-numeric:tabular-nums;margin:6px 0 2px}
.big small{font:600 15px "Segoe UI",sans-serif;margin-left:5px;opacity:.8}
.mid{font:700 30px/1.05 Georgia,serif;font-variant-numeric:tabular-nums;margin:6px 0 2px}
.mid small{font:600 13px "Segoe UI",sans-serif;margin-left:4px;color:var(--ink2)}
.sub{font-size:12px;color:var(--ink2)}
.card.nivel .sub{color:#e9cfcf}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.chip{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:2px 10px;font-size:11.5px;font-weight:700;border:1px solid var(--linea);background:#fff;color:var(--ink);max-width:100%;line-height:1.3}
.card.nivel .chip{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.3);color:#fff}
.chip.alto{background:#e6f3e8;border-color:#9ccaa4;color:#1d5e2b}
.chip.medio{background:#fff3dc;border-color:#e6c47d;color:#7a4b00}
.chip.bajo{background:#fbe6e3;border-color:#e3a39a;color:#8c1d14}
.chip.sd{background:#f1f2f3;color:var(--sd);font-style:italic}
.chip.sube{background:#e3eefa;border-color:#9ebfe3;color:#124a85}
.chip.baja{background:#fdeedd;border-color:#e8bf8c;color:#8a4a00}
.chip.est{background:#eef0f2;color:#3d4752}
.barra{height:10px;border-radius:6px;background:#e9edf2;margin:10px 0 4px;position:relative;overflow:hidden}
.barra i{display:block;height:100%;background:linear-gradient(90deg,#5aa6dc,var(--agua));border-radius:6px}
.escala{display:flex;justify-content:space-between;font-size:10.5px;color:var(--ink2)}
.regla{margin-top:10px}
h2{font:700 19px Georgia,serif;color:var(--inst);margin:22px 0 4px;display:flex;align-items:baseline;gap:10px}
h2 span{font:400 12.5px "Segoe UI",sans-serif;color:var(--ink2)}
.sec{border-top:2px solid var(--linea);margin-top:20px;padding-top:2px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:8px}
.graf{border:1px solid var(--linea);border-radius:10px;padding:10px 12px 8px;min-width:0}
.graf h3{margin:0 0 2px;font:700 13px "Segoe UI",sans-serif;color:var(--ink);display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.graf h3 em{font-style:normal;font-weight:700;font-size:12px}
.graf h3 em.sube{color:#124a85}.graf h3 em.baja{color:#8a4a00}.graf h3 em.est,.graf h3 em.sd{color:var(--ink2)}
.graf .nota{font-size:11px;color:var(--ink2);margin-top:2px}
.lectura{background:var(--inst2);border-left:5px solid var(--inst);border-radius:6px;padding:10px 14px;margin-top:12px}
.lectura b{display:block;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--inst);margin-bottom:3px}
.lectura p{margin:2px 0;font:14px/1.4 Georgia,serif}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:var(--inst);color:#fff;padding:6px 8px;text-align:left;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase}
th.n,td.n{text-align:right;font-variant-numeric:tabular-nums}
td{padding:6px 8px;border-bottom:1px solid var(--linea)}
td.anio{font-weight:700}
.sube{color:#124a85}.baja{color:#8a4a00}
tr.hoy td{background:var(--inst2);font-weight:700}
.sd{color:var(--sd);font-style:italic}
.pie-pagina{margin-top:18px;padding-top:8px;border-top:4px solid var(--inst);display:flex;justify-content:space-between;gap:14px;font-size:10.5px;color:var(--ink2);text-transform:uppercase;letter-spacing:.05em}
.fuentes{font-size:11px;color:var(--ink2);margin-top:12px;line-height:1.5}
.aviso{border:1px solid #e3c98a;border-left:5px solid #C27A0E;background:#fff8e6;border-radius:5px;padding:7px 12px;font-size:12.5px;color:#5c3d00;margin:8px 0}
.btn-imprimir{position:fixed;right:14px;bottom:14px;z-index:10;background:var(--inst);color:#fff;border:0;border-radius:8px;padding:10px 16px;font:600 14px "Segoe UI",Arial,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);min-height:44px}
@page{size:letter portrait;margin:6mm}
@media print{
  body{background:#fff}
  .hoja{margin:0 auto;box-shadow:none;border-radius:0;zoom:.72;break-after:page;page-break-after:always}
  .hoja:last-of-type{break-after:auto;page-break-after:auto}
  .btn-imprimir{display:none!important}
}
.card,.graf,.lectura,tr,table{break-inside:avoid}
`);

/** Regla vertical-compacta (horizontal) fondo → NAME con NAMO y nivel actual. Solo si hay cotas oficiales y elevación. */
function reglaNivel(id: string, escala: number | null): string {
    const cfg = COTAS_OFICIALES[id];
    if (!cfg || escala == null) return '';
    const namo = cfg.cotas.find(c => c.label === 'NAMO'), name = cfg.cotas.find(c => c.label === 'NAME');
    const top = (name ?? namo)?.elev;
    if (top == null) return '';
    const W = 300, ml = 4, pw = W - 8, lo = cfg.fondo, hi = top;
    const x = (v: number) => ml + Math.min(1, Math.max(0, (v - lo) / (hi - lo))) * pw;
    let g = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 52" width="100%" role="img" aria-label="Posición del nivel entre el fondo y el NAME" style="display:block">`
        + `<rect x="${ml}" y="26" width="${pw}" height="9" rx="4.5" fill="rgba(255,255,255,.22)"/>`
        + `<rect x="${ml}" y="26" width="${(x(escala) - ml).toFixed(1)}" height="9" rx="4.5" fill="#7fc0ee"/>`;
    for (const c of cfg.cotas.filter(k => k.label === 'NAMO' || k.label === 'NAME')) {
        g += `<line x1="${x(c.elev).toFixed(1)}" x2="${x(c.elev).toFixed(1)}" y1="22" y2="39" stroke="${c.label === 'NAME' ? '#ff9b8e' : '#ffd37a'}" stroke-width="2"/>`
            + `<text x="${(x(c.elev) - (c.label === 'NAMO' ? 3 : 0)).toFixed(1)}" y="${c.label === 'NAME' ? 49 : 17}" text-anchor="end" font-size="9.5" font-weight="700" fill="#fff">${c.label} ${n(c.elev, 2)}</text>`;
    }
    g += `<circle cx="${x(escala).toFixed(1)}" cy="30.5" r="6" fill="#fff" stroke="#7fc0ee" stroke-width="2.5"/></svg>`;
    return `<div class="regla">${g}</div>`;
}

function hero(p: DatosPresaNT): string {
    const c = p.corte;
    if (!c) return `<div class="aviso"><b>Sin datos.</b> ${esc(p.nombre)} no tiene nivel ni volumen registrados hasta el periodo elegido (S/D).</div>`;
    const t = TEND[p.tendencia.estado];
    const sem = SEM[p.semaforo];
    const rotulo = c.esActual ? 'Nivel oficial actual' : 'Nivel al corte del periodo';
    const llen = c.pct;
    const frescura = c.diasDesdeCorte === 0 ? 'dato de hoy' : c.diasDesdeCorte === 1 ? 'dato de ayer' : `dato de hace ${c.diasDesdeCorte} días`;
    const dV = p.tendencia.deltaVolumen, dE = p.tendencia.deltaEscala;
    return `<div class="hero">
  <div class="card nivel">
    <div class="et">${rotulo}</div>
    <div class="big">${esc(n(c.escala, 2))}<small>msnm</small></div>
    <div class="sub">${esc(fechaLarga(c.fecha))} · ${esc(frescura)}</div>
    ${reglaNivel(p.id, c.escala)}
    <div class="chips"><span class="chip">${esc(FUENTE[c.fuente] ?? c.fuente)}</span>${c.escala == null ? '<span class="chip">Elevación S/D</span>' : ''}</div>
  </div>
  <div class="card">
    <div class="et">Volumen almacenado</div>
    <div class="mid">${esc(n(c.volumen, 1))}<small>Mm³</small></div>
    <div class="sub">${llen != null ? `${esc(n(llen, 1))} % del volumen de conservación` : 'Llenado S/D'}</div>
    <div class="barra" role="img" aria-label="Llenado ${llen != null ? n(llen, 1) + ' por ciento' : 'sin dato'}"><i style="width:${llen != null ? Math.min(100, Math.max(0, llen)).toFixed(1) : 0}%"></i></div>
    <div class="escala"><span>0 %</span><span>50 %</span><span>100 %</span></div>
  </div>
  <div class="card">
    <div class="et">Tendencia de ${esc(p.tendencia.nombreMes.toLowerCase())}</div>
    <div class="mid ${t.cls}">${t.glifo} ${t.txt}</div>
    <div class="sub">${dE ? `${esc(conSigno(dE.delta, 2))} m` : 'Δ nivel S/D'} · ${dV ? `${esc(conSigno(dV.delta, 1))} Mm³` : 'Δ volumen S/D'}</div>
    <div class="chips"><span class="chip ${sem.cls}" title="${esc(sem.txt)}">${sem.glifo} ${esc(sem.txt)}</span></div>
  </div></div>`;
}

function tendenciaSec(p: DatosPresaNT): string {
    const t = p.tendencia, tn = TEND[t.estado];
    const dE = t.deltaEscala, dV = t.deltaVolumen;
    const base = (d: typeof dE) => (d ? (d.base === 'mes-anterior' ? 'vs cierre del mes anterior' : 'vs primer dato del mes') : '');
    const rango = (mn: typeof t.minEscala, mx: typeof t.maxEscala, dec: number, u: string) => (mn && mx ? `Mín ${n(mn.valor, dec)} · Máx ${n(mx.valor, dec)} ${u}` : 'Rango S/D');
    return `<section class="sec"><h2>Tendencia de ${esc(t.nombreMes.toLowerCase())} ${t.anio}<span>${t.diasConDato} de ${t.diasMes} días con dato${t.atipicos ? ` · ${t.atipicos} por revisar` : ''}</span></h2>
  <div class="g2">
    <div class="graf"><h3>Escala (elevación)<em class="${tn.cls}">${dE ? `${flecha(dE.delta)} ${esc(conSigno(dE.delta, 2))} m` : 'S/D'}</em></h3>
      ${svgAreaMes(t.escala, { unidad: 'msnm', decimales: 2, titulo: `Elevación diaria de ${p.nombre}, ${t.nombreMes} ${t.anio}`, color: COLOR_AGUA })}
      <div class="nota">${esc(rango(t.minEscala, t.maxEscala, 2, 'msnm'))}${t.ritmoCmDia != null ? ` · ritmo ${esc(conSigno(t.ritmoCmDia, 1))} cm/día` : ''}${dE ? ` · ${esc(base(dE))}` : ''}</div></div>
    <div class="graf"><h3>Volumen almacenado<em class="${tn.cls}">${dV ? `${flecha(dV.delta)} ${esc(conSigno(dV.delta, 1))} Mm³` : 'S/D'}</em></h3>
      ${svgAreaMes(t.volumen, { unidad: 'Mm³', decimales: 1, titulo: `Volumen diario de ${p.nombre}, ${t.nombreMes} ${t.anio}`, color: '#13866F' })}
      <div class="nota">${esc(rango(t.minVolumen, t.maxVolumen, 1, 'Mm³'))}${dV ? ` · ${esc(base(dV))}` : ''}</div></div>
  </div>
  <div class="lectura"><b>Lectura ejecutiva</b>${p.lectura.map(l => `<p>${esc(l)}</p>`).join('')}</div></section>`;
}

const celdaDelta = (v: number | null, d: number): string =>
    `<td class="n ${v == null ? 'sd' : v >= 0 ? 'sube' : 'baja'}">${v == null ? 'S/D' : `${flecha(v)} ${esc(conSigno(v, d))}`}</td>`;

function movimientoSec(p: DatosPresaNT): string {
    const mv = p.movimiento;
    const base = mv.anios.find(a => a.esBase);
    if (!base || mv.anios.every(a => a.deltaEscala == null && a.deltaVolumen == null)) {
        return `<section class="sec"><h2>Movimiento del periodo<span>${esc(mv.etiquetaPeriodo)}</span></h2><div class="aviso">S/D — no hay datos suficientes en este periodo para medir cuánto se movió la presa.</div></section>`;
    }
    const orden = [...mv.anios].reverse(); // más reciente primero
    const ext = (x: { valor: number } | null, d: number) => (x ? esc(n(x.valor, d)) : '<span class="sd">S/D</span>');
    const resumen = orden.map(a => `<tr class="${a.esBase ? 'hoy' : ''}"><td class="anio">${esc(a.etiqueta)}${a.parcial ? '<span class="sd"> parcial</span>' : ''}</td>`
        + `<td class="n">${ext(a.escalaIni, 2)}</td><td class="n">${ext(a.escalaFin, 2)}</td>${celdaDelta(a.deltaEscala, 2)}`
        + `<td class="n">${ext(a.volumenIni, 1)}</td><td class="n">${ext(a.volumenFin, 1)}</td>${celdaDelta(a.deltaVolumen, 1)}`
        + `<td class="n ${a.ritmoCmDia == null ? 'sd' : ''}">${a.ritmoCmDia == null ? 'S/D' : esc(conSigno(a.ritmoCmDia, 1))}</td></tr>`).join('');
    const pc = mv.promedioComp;
    const filaProm = pc ? `<tr><td class="anio">Promedio de ${pc.n} ${pc.n === 1 ? 'periodo' : 'periodos'}</td><td class="n" colspan="2"></td>${celdaDelta(pc.deltaEscala, 2)}<td class="n" colspan="2"></td>${celdaDelta(pc.deltaVolumen, 1)}<td class="n"></td></tr>` : '';
    const tabla = (campo: 'deltaEscala' | 'deltaVolumen', unidad: string, d: number) => {
        const filas = mv.meses.map((m, i) => `<tr><td class="anio">${MESES_LARGO[m - 1].slice(0, 3)}</td>${orden.map(a => celdaDelta(a.meses[i]?.[campo] ?? null, d)).join('')}</tr>`).join('');
        const total = `<tr class="hoy"><td class="anio">Total</td>${orden.map(a => celdaDelta(a[campo], d)).join('')}</tr>`;
        return `<div class="graf"><h3>Cambio mensual de ${unidad === 'm' ? 'nivel' : 'volumen'} <em class="est">${unidad}</em></h3><table><thead><tr><th>Mes</th>${orden.map(a => `<th class="n">${esc(a.etiqueta)}</th>`).join('')}</tr></thead><tbody>${filas}${total}</tbody></table></div>`;
    };
    const nota = base.parcial ? ' · periodo en curso: el total llega al último dato disponible' : '';
    return `<section class="sec"><h2>Movimiento del periodo<span>${esc(mv.etiquetaPeriodo)} · Δ = final menos inicial${esc(nota)}</span></h2>
  <div class="graf" style="margin-top:8px"><table><thead><tr><th>Periodo</th><th class="n">Nivel inicial</th><th class="n">Nivel final</th><th class="n">Δ nivel (m)</th><th class="n">Vol. inicial</th><th class="n">Vol. final</th><th class="n">Δ vol. (Mm³)</th><th class="n">cm/día</th></tr></thead><tbody>${resumen}${filaProm}</tbody></table></div>
  <div class="g2">${tabla('deltaEscala', 'm', 2)}${tabla('deltaVolumen', 'Mm³', 1)}</div>
  <div class="graf" style="margin-top:12px"><h3>Cambio mensual de volumen por año <em class="est">Mm³ · arriba sube, abajo baja</em></h3>${svgMovimientoBarras(mv.anios, mv.meses, 'volumen', { unidad: 'Mm³', decimales: 1, titulo: `Cambio mensual de volumen de ${p.nombre} por año` })}</div>
  <div class="graf" style="margin-top:12px"><h3>Cambio mensual de nivel por año <em class="est">m · arriba sube, abajo baja</em></h3>${svgMovimientoBarras(mv.anios, mv.meses, 'escala', { unidad: 'm', decimales: 2, titulo: `Cambio mensual de nivel de ${p.nombre} por año`, alto: 210 })}</div>
  <div class="lectura"><b>Lectura del periodo</b>${mv.lectura.map(l => `<p>${esc(l)}</p>`).join('')}</div></section>`;
}

function mismoDiaSec(p: DatosPresaNT): string {
    const c = p.corte;
    if (!c) return '';
    const dia = `${+c.fecha.slice(8, 10)} de ${MESES_LARGO[+c.fecha.slice(5, 7) - 1].toLowerCase()}`;
    if (p.mismoDia.length === 0) return `<section class="sec"><h2>El ${esc(dia)} en años anteriores</h2><div class="aviso">S/D — no hay años de comparación con dato para esta fecha.</div></section>`;
    const filas = p.mismoDia.map(r => `<tr><td class="anio">${r.anio}${r.desfaseDias ? `<span class="sd"> ${r.desfaseDias > 0 ? '+' : '−'}${Math.abs(r.desfaseDias)} d</span>` : ''}</td>`
        + `<td class="n">${r.volumen == null ? '<span class="sd">S/D</span>' : esc(n(r.volumen, 1))}</td>`
        + `<td class="n">${r.escala == null ? '<span class="sd">S/D</span>' : esc(n(r.escala, 2))}</td>`
        + `<td class="n ${r.deltaVolumen == null ? 'sd' : r.deltaVolumen >= 0 ? 'sube' : 'baja'}">${r.deltaVolumen == null ? 'S/D' : `${flecha(r.deltaVolumen)} ${esc(conSigno(r.deltaVolumen, 1))}`}</td></tr>`).join('');
    const sem = SEM[p.semaforo];
    const prom = p.promedioMismoDia;
    return `<section class="sec"><h2>El ${esc(dia)} en años anteriores<span>Δ = hoy menos ese año (Mm³)</span></h2>
  <div class="g2">
    <div class="graf"><table><thead><tr><th>Año</th><th class="n">Volumen Mm³</th><th class="n">Nivel msnm</th><th class="n">Hoy vs ese año</th></tr></thead><tbody>
      <tr class="hoy"><td class="anio">${p.tendencia.anio}</td><td class="n">${esc(n(c.volumen, 1))}</td><td class="n">${esc(n(c.escala, 2))}</td><td class="n">referencia</td></tr>${filas}</tbody></table></div>
    <div class="graf"><h3>Dónde está hoy frente al histórico</h3>
      ${svgPosicionHistorica(p.mismoDia, { anio: p.tendencia.anio, volumen: c.volumen }, { titulo: `Posición de ${p.nombre} frente a los mismos días de otros años` })}
      <div class="chips"><span class="chip ${sem.cls}">${sem.glifo} ${esc(sem.txt)}</span></div>
      <div class="nota">${prom ? `Promedio de ${prom.n} ${prom.n === 1 ? 'año' : 'años'}: ${esc(n(prom.promedio, 1))} Mm³ · hoy ${esc(conSigno(prom.abs, 1))} Mm³${prom.pct != null ? ` (${esc(conSigno(prom.pct, 0))} %)` : ''}` : 'Promedio S/D'}${p.posicion ? ` · lugar ${p.posicion.posicion} de ${p.posicion.de} (de menor a mayor)` : ''}</div></div>
  </div></section>`;
}

function curvasSec(p: DatosPresaNT): string {
    const t = p.tendencia;
    return `<section class="sec"><h2>${esc(t.nombreMes)}, año contra año<span>año base en marrón, trazo grueso</span></h2>
  <div class="g2">
    <div class="graf"><h3>Volumen (Mm³)</h3>${svgCurvasAnios(p.series, 'volumen', { unidad: 'Mm³', decimales: 1, titulo: `Volumen de ${p.nombre} en ${t.nombreMes}, comparación por año` })}</div>
    <div class="graf"><h3>Escala (msnm)</h3>${svgCurvasAnios(p.series, 'escala', { unidad: 'msnm', decimales: 2, titulo: `Elevación de ${p.nombre} en ${t.nombreMes}, comparación por año` })}</div>
  </div></section>`;
}

function cierresSec(p: DatosPresaNT): string {
    const t = p.tendencia;
    return `<section class="sec"><h2>Cierre de ${esc(t.nombreMes.toLowerCase())} por año<span>último dato disponible de cada mes · Mm³</span></h2>
  <div class="graf" style="margin-top:8px">${svgCierres(p.cierres, { unidad: 'Mm³', titulo: `Volumen al cierre de ${t.nombreMes} por año, ${p.nombre}`, ancho: 908, alto: 220 })}</div></section>`;
}

function calorSec(p: DatosPresaNT): string {
    return `<section class="sec"><h2>Historial completo<span>volumen al cierre de cada mes (Mm³) · más oscuro = más agua · S/D = sin dato</span></h2>
  <div class="graf" style="margin-top:8px">${svgCalor(p.calor, { titulo: `Mapa de calor de volumen mensual de ${p.nombre}`, baseAnio: p.tendencia.anio, mesResaltado: p.tendencia.mes })}</div></section>`;
}

export function htmlNivelTendencia(d: DatosNivelTendencia, logos: LogosNT, modo: ModoInformeNT = 'pantalla'): string {
    const { config: c } = d;
    const mesTxt = `${MESES_LARGO[c.mes - 1]} ${c.anioBase}`;
    const total = d.presas.length;
    const folio = folioConPartes('NT', [...c.presas.map(id => (id === 'PRE-001' ? 'BOQ' : 'MAD')), `${c.anioBase}${String(c.mes).padStart(2, '0')}`], d.emitido);
    const comp = d.aniosComparacion.length ? `${d.aniosComparacion[0]}–${d.aniosComparacion[d.aniosComparacion.length - 1]} (${d.aniosComparacion.length} ${d.aniosComparacion.length === 1 ? 'año' : 'años'})` : 'sin comparación';
    const hojas = d.presas.map((p, i) => {
        const sec = new Set(c.secciones);
        return `<article class="hoja">
${cabeceraInforme({ logoSrl: logos.srl, logoSica: logos.sica, titulo: 'Nivel y tendencia de presas', meta: [{ k: 'Folio', v: folio }, { k: 'Emitido', v: fechaHoraLegible(d.emitido) }, { k: 'Serie', v: c.serie === 'normalizada' ? 'Normalizada (curva vigente)' : 'Reportada' }] })}
<div class="titulo"><div><small>Sala de Control Hidráulico · Presa</small><h1>${esc(p.nombre)}</h1></div><div class="periodo">${esc(mesTxt)}<br><span style="font:12px 'Segoe UI',sans-serif">Comparado con ${esc(comp)}</span></div></div>
${p.corte?.fueraDelMes ? `<div class="aviso"><b>Sin datos en ${esc(mesTxt)}.</b> Se muestra el último dato disponible (${esc(fechaLarga(p.corte.fecha))}).</div>` : ''}
${hero(p)}
${p.corte || p.tendencia.diasConDato ? tendenciaSec(p) : ''}
${sec.has('movimiento') ? movimientoSec(p) : ''}
${sec.has('mismoDia') ? mismoDiaSec(p) : ''}
${sec.has('curvas') && p.series.length > 1 ? curvasSec(p) : ''}
${sec.has('cierres') && p.cierres.length > 1 ? cierresSec(p) : ''}
${sec.has('calor') ? calorSec(p) : ''}
<p class="fuentes"><b>Fuentes:</b> serie diaria SICA (lecturas de campo y reporte CILA/USIBWC) e histórico SRL ${d.anioMin ?? 'S/D'}–${d.anioMax ?? 'S/D'}. Cifras provisionales sujetas a revisión; S/D indica ausencia de dato, no cero. Las líneas se interrumpen donde no hay lectura.</p>
${pieInforme(`SICA 005 · SRL Unidad Conchos · ${folio}`, i + 1, total)}
</article>`;
    }).join('\n');
    // Sin botón propio: la vista previa vive en un iframe y su botón flotante duplicaba al de la ventana (y no imprime en iOS).
    const boton = '';
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=${ANCHO_INFORME_NT}"><meta name="color-scheme" content="light">
<title>${esc(`Nivel y tendencia de presas — ${mesTxt}`)}</title><style>${CSS}</style></head><body class="${modo === 'png' ? 'png' : ''}">
${hojas}
${boton}
</body></html>`;
}
