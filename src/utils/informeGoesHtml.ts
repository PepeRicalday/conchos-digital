/**
 * informeGoesHtml — documento HTML autónomo del Informe de estaciones hidrométricas GOES (Básico / Técnico).
 * Una hoja `.pagina` por bloque lógico (Carta o A4) sobre los componentes de informeBase. Sin JS, sin fuentes web, logos como
 * data URI: sirve igual a la vista previa, a la impresión (PDF) y a rasterizaHtml (PNG / PDF en iPad).
 * Regla rectora: S/D nunca es 0; jamás se imprime NaN / undefined / null.
 */
import {
    CSS_FUENTE_SVG, bloqueFirmas, cabeceraInforme, cssInforme, documentoHtml, esc, fechaHoraLegible, folioConPartes, minificaCss,
    nombreArchivoConPartes, pieInforme, tablaTrazabilidad,
} from './informeBase';
import { COBERTURA_MIN_CONFIABLE } from './hidroEstadistica';
import { TZ_SICA, fechaHoraLocal, fmt, fmtDelta, horaLocal, textoEdad, STALE_GOES_MIN, type CeldaEnlace, type Tendencia } from './hidroEstaciones';
import { VARIABLES_INFORME, codigoPeriodoGoes, seccionesGoesDe, type SeccionGoes } from './informeGoesConfig';
import { dirDe, movimiento24h, pasoParaSpan, type DatosEstacionGoes, type DirTendencia, type InformeGoes } from './informeGoesDatos';
import {
    DASHES_ESTACION, svgBarras, svgCajas, svgLineas, svgSemaforoCobertura, svgSpark, svgTiraEnlace, svgVacio,
    type SerieLinea,
} from './informeGoesSvg';

export interface LogosGoes { srl: string; sica: string }
export interface OpcionesHtmlGoes { emitido?: Date; emisor?: string; version?: string }

const SD = 'S/D';
/** Gasto con 2 decimales por debajo de 10 m³/s (un 0.03 real no debe verse como 0.0) y 1 en adelante. */
const decQ = (v: number | null | undefined): number => (v != null && Math.abs(v) < 10 ? 2 : 1);
const fmtQ = (v: number | null | undefined): string => fmt(v, decQ(v));
/** "19 oct 2026 20:21" en hora de Chihuahua. */
const conAnio = (ms: number): string => new Date(ms).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ_SICA }).replace(/\./g, '').replace(',', '');
const TEND: Record<DirTendencia, { glifo: string; txt: string; cls: string }> = {
    sube: { glifo: '▲', txt: 'Sube', cls: 'sube' },
    baja: { glifo: '▼', txt: 'Baja', cls: 'baja' },
    estable: { glifo: '■', txt: 'Estable', cls: 'est' },
    sd: { glifo: '–', txt: SD, cls: 'sdc' },
};

/** Cambio con glifo, palabra y valor: el sentido nunca depende solo del color. */
function celdaCambio(t: Tendencia | null, dec: number, unidad: string): string {
    const k = TEND[dirDe(t)];
    if (!t) return `<span class="sd">${SD}</span>`;
    return `<span class="camb ${k.cls}">${k.glifo} ${k.txt}</span> <span class="num">${esc(fmtDelta(t.delta, dec))} ${esc(unidad)}</span>`;
}

const EXTRA_CSS = minificaCss(`
${CSS_FUENTE_SVG}
.pagina{grid-template-rows:auto 1fr auto}
.run{gap:10px;letter-spacing:normal;text-transform:none;border-bottom:2px solid var(--inst);padding-bottom:5px;margin-bottom:10px}
.run b{color:inherit}
.cuerpo{display:flex;flex-direction:column;gap:10px}
.nota-pie{margin-top:0}
.banda h1{font-size:23pt;letter-spacing:.01em}
.banda .sub{font:11pt Georgia,serif}
.lectura{background:var(--inst-claro);border-left:5px solid var(--inst);border-radius:3px;padding:9px 13px}
.lectura h3{margin:0 0 4px;font:700 8pt "Segoe UI",Arial,sans-serif;letter-spacing:.06em;color:var(--inst)}
.lectura p{margin:0 0 5px;font:10pt/1.42 Georgia,serif}
.lectura p:last-child{margin-bottom:0}
.filas-est{display:flex;flex-direction:column;border-top:1px solid var(--linea)}
.fila-est{display:grid;grid-template-columns:18px minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr) 172px;gap:10px;align-items:center;padding:7px 2px;border-bottom:1px solid var(--linea)}
.fila-est .sw{width:12px;height:12px;border-radius:3px;border:1px solid rgba(0,0,0,.25)}
.fila-est .nom b{display:block;font-size:10pt}
.fila-est .nom span{font-size:7.5pt;color:var(--ink2)}
.fila-est .cifra{font:700 14pt/1.1 Georgia,serif;font-variant-numeric:tabular-nums}
.fila-est .cifra small{font:600 7.5pt "Segoe UI",sans-serif;color:var(--ink2);margin-left:3px}
.fila-est .cifra em{display:block;font:normal 7.5pt "Segoe UI",sans-serif;color:var(--ink2)}
.camb{font-weight:700;white-space:nowrap}
.camb.sube{color:#124a85}.camb.baja{color:#8a4a00}.camb.est{color:#3d4752}.camb.sdc{color:var(--sd)}
.fichas{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.fichae{border:1px solid var(--linea);border-top:4px solid var(--c,var(--inst));border-radius:4px;padding:9px 11px;background:#fff;break-inside:avoid;display:flex;flex-direction:column;gap:6px;min-width:0}
.fichae header{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.fichae header b{display:block;font:700 11pt Georgia,serif}
.fichae header span{font-size:7.5pt;color:var(--ink2)}
.vals{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:8px;align-items:end}
.vals .v{font:700 21pt/1 Georgia,serif;font-variant-numeric:tabular-nums}
.vals .v small{font:600 8pt "Segoe UI",sans-serif;color:var(--ink2);margin-left:3px}
.vals .m{font:700 12pt/1.1 Georgia,serif;font-variant-numeric:tabular-nums}
.vals .m small{font:600 7.5pt "Segoe UI",sans-serif;color:var(--ink2);margin-left:2px}
.vals .e{display:block;font-size:7.5pt;color:var(--ink2);margin-bottom:1px}
.vars{width:100%;font-size:8pt}.vars td,.vars th{padding:3px 5px}.vars th{background:none;color:var(--ink2);border-bottom:1px solid var(--linea);text-transform:none;letter-spacing:0;font-size:7.5pt}
.pie-ficha{font-size:7.5pt;color:var(--ink2)}
.pie-ficha.alerta{color:#7a4b00;font-weight:700}
.chip.ok{background:#e6f3e8;border-color:#9ccaa4;color:#1d5e2b}
.chip.aviso{background:#fff3dc;border-color:#e6c47d;color:#7a4b00}
.chip.mal{background:#fbe6e3;border-color:#e3a39a;color:#8c1d14}
.chip.nd{background:#f1f2f3;color:var(--sd);font-style:italic}
.tabla-wrap{width:100%}
table.tec{font-size:7.8pt}table.tec th{font-size:7pt;padding:4px 4px}table.tec td{padding:3.5px 4px}
th.n{font-family:"Segoe UI",Arial,sans-serif}
.mx{max-width:200px}.mx-tira{max-width:440px}
table.tec tr.est-ini td{border-top:2px solid var(--linea)}
td.est-nom{font-weight:700;white-space:nowrap}
td.est-nom i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;border:1px solid rgba(0,0,0,.3)}
.fig svg{display:block;width:100%;height:auto}
.fig.caja{border:1px solid var(--linea);border-radius:4px;padding:6px 8px;background:#fff}
.fig h3,.fig .tit{margin:0 0 3px;font:700 9pt "Segoe UI",Arial,sans-serif}
.paneles{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.paneles .fig .tit{display:flex;align-items:center;gap:5px;font-size:8.5pt}
.paneles .fig .tit i{width:10px;height:10px;border-radius:2px;display:inline-block}
.leyenda-caja{font-size:7.5pt;color:var(--ink2)}
.def{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:8pt;margin:0}
.def dt{margin:0;font-weight:700;color:var(--inst)}.def dd{margin:0}
ul.notas{margin:0;padding-left:16px;font-size:8.5pt}ul.notas li{margin-bottom:4px}
.metodo p{font-size:8.5pt;margin-bottom:5px}
.aviso.neutro{border-left-color:var(--inst);background:var(--inst-claro);color:var(--ink)}
.firmas{margin-top:18px}
.tira-celda{display:flex;flex-direction:column;gap:2px}
.fig .sub-tit{font-weight:600;font-size:8pt;color:var(--ink2);margin-bottom:0}
@media screen and (max-width:720px){.fila-est{grid-template-columns:14px 1fr 1fr}.fila-est>:nth-child(4),.fila-est>:nth-child(5){grid-column:2 / -1}.fichas,.paneles{grid-template-columns:1fr}.vals{grid-template-columns:1fr 1fr}.vals>:first-child{grid-column:1 / -1}.tabla-wrap{overflow-x:auto}table.tec{min-width:560px}.def{grid-template-columns:1fr}}
@media print{.fichas,.paneles{grid-template-columns:1fr 1fr}.fila-est{grid-template-columns:18px minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr) 172px}.vals{grid-template-columns:1.4fr 1fr 1fr}.def{grid-template-columns:auto 1fr}}
`);

export function folioGoes(d: InformeGoes, emitido: Date): string {
    return folioConPartes('GOES', [d.config.modalidad === 'basico' ? 'BAS' : 'TEC', codigoPeriodoGoes(d.config.periodo, d.ahoraMs)], emitido);
}

/** Nombre de archivo (sin extensión forzada): informe-goes-<modalidad>-<periodo>-AAAA-MM-DD.html (o la extensión pedida). */
export function nombreArchivoGoes(d: InformeGoes, emitido: Date, ext: 'html' | 'pdf' | 'png' = 'html'): string {
    return nombreArchivoConPartes('informe-goes', [d.config.modalidad, codigoPeriodoGoes(d.config.periodo, d.ahoraMs)], emitido).replace(/\.html$/, `.${ext}`);
}

const usa = (d: InformeGoes, v: 'nivel' | 'gasto' | 'velocidad' | 'meteo') => d.config.variables.includes(v);

function chipEnlace(e: DatosEstacionGoes): string {
    const c = e.enlace.clave;
    const cls = c === 'en_linea' ? 'ok' : c === 'retraso' ? 'aviso' : c === 'sin_transmision' ? 'mal' : 'nd';
    const g = c === 'en_linea' ? '●' : c === 'retraso' ? '▲' : c === 'sin_transmision' ? '■' : '–';
    return `<span class="chip ${cls}">${g} ${esc(e.enlace.etiqueta)}</span>`;
}

const numUlt = (u: { v: number; edadMin: number | null } | null, dec: number, unidad: string, etiqueta: string): string =>
    `<span class="e">${esc(etiqueta)}</span>${u ? `<span class="m num">${esc(fmt(u.v, dec))}<small>${esc(unidad)}</small></span>` : `<span class="m sd">${SD}</span>`}`;

// ── Hojas ─────────────────────────────────────────────────────────────────────────

function hojaResumen(d: InformeGoes): string {
    const b = d.config.modalidad === 'basico';
    const ults = d.estaciones.flatMap((e) => [e.ultimoGasto?.t, e.ultimoNivel?.t]).filter((t): t is number => t != null);
    const ultimaGlobal = ults.length ? Math.max(...ults) : null;
    const filas = d.estaciones.map((e) => {
        const m = movimiento24h(e, usa(d, 'gasto'), usa(d, 'nivel'));
        const k = TEND[m?.dir ?? 'sd'];
        const u = usa(d, 'gasto') ? e.ultimoGasto : null;
        const un = usa(d, 'nivel') ? e.ultimoNivel : null;
        return `<div class="fila-est">
  <span class="sw" style="background:${e.color}" aria-hidden="true"></span>
  <div class="nom"><b>${esc(e.nombreCorto)}</b><span>${esc(e.grupoTitulo)} · ${esc(e.id)}</span></div>
  <div class="cifra">${usa(d, 'gasto') ? (u ? `${esc(fmtQ(u.v))}<small>m³/s</small><em>gasto · ${esc(textoEdad(u.edadMin))}</em>` : `<span class="sd">${SD}</span><em>gasto</em>`) : '<span class="sd">—</span>'}</div>
  <div class="cifra">${usa(d, 'nivel') ? (un ? `${esc(fmt(un.v, 2))}<small>m</small><em>nivel · ${esc(textoEdad(un.edadMin))}</em>` : `<span class="sd">${SD}</span><em>nivel</em>`) : '<span class="sd">—</span>'}</div>
  <div>${svgSpark(e.spark, e.color, `Últimas 24 h de ${e.nombreCorto}`, 150, 30)}<span class="camb ${k.cls}" style="font-size:8pt">${k.glifo} ${k.txt} 24 h${m && m.delta != null ? ` · ${esc(fmtDelta(m.delta, m.variable === 'gasto' ? 1 : 2))} ${esc(m.unidad)}` : ''}</span></div>
</div>`;
    }).join('');
    return `<div class="banda"><small>Sala de Control Hidráulico · Telemetría satelital GOES</small><h1>Estaciones hidrométricas</h1>
<div class="sub">Informe ${b ? 'básico' : 'técnico'} · ${esc(d.etiquetaPeriodo)}</div></div>
<div class="datos">
  <div class="dato"><b>Periodo (hora de Chihuahua)</b><span style="font-size:8.5pt">${esc(conAnio(d.desdeMs))}<br>a ${esc(conAnio(d.hastaMs))}</span></div>
  <div class="dato"><b>Estaciones</b><span>${d.estaciones.length} de 4</span></div>
  <div class="dato"><b>Última lectura</b><span style="font-size:9pt">${ultimaGlobal != null ? esc(fechaHoraLocal(ultimaGlobal)) : SD}</span></div>
  <div class="dato"><b>Fuente</b><span style="font-size:9pt">Telemetría GOES / DCP</span></div>
</div>
<div class="lectura"><h3>Lectura del periodo</h3>${d.lectura.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
<h2>Estaciones de un vistazo</h2>
<div class="filas-est">${filas || `<p class="sd">${SD} — no hay estaciones seleccionadas.</p>`}</div>
${d.recortado ? `<div class="aviso"><b>Rango recortado.</b> Las series de telemetría solo llegan a 30 días: el informe empieza el ${esc(fechaHoraLocal(d.desdeMs))}.</div>` : ''}
<p class="nota-pie">Cifras tal como las reporta cada estación; S/D indica ausencia de dato, nunca cero. Provisionales, sujetas a revisión.</p>`;
}

function ficha(d: InformeGoes, e: DatosEstacionGoes): string {
    const vel = usa(d, 'velocidad') && e.id === 'C6300760';
    const fila = (nombre: string, t24: Tendencia | null, t7: Tendencia | null, dec: number, u: string) =>
        `<tr><td>${esc(nombre)}</td><td>${celdaCambio(t24, dec, u)}</td><td>${celdaCambio(t7, dec, u)}</td></tr>`;
    const filas = (usa(d, 'gasto') ? fila('Gasto', e.est.variacionGasto.h24, e.est.variacionGasto.d7, 1, 'm³/s') : '')
        + (usa(d, 'nivel') ? fila('Nivel', e.est.variacionNivel.h24, e.est.variacionNivel.d7, 2, 'm') : '');
    const viejo = (e.ultimoGasto ?? e.ultimoNivel)?.edadMin;
    const obsoleto = viejo != null && viejo > STALE_GOES_MIN;
    const ult = e.ultimoGasto ?? e.ultimoNivel;
    const pg = usa(d, 'gasto');
    const principal = pg ? e.ultimoGasto : e.ultimoNivel;
    const prim = `<span class="e">${pg ? 'Gasto' : 'Nivel'}</span>${principal ? `<span class="v num">${esc(pg ? fmtQ(principal.v) : fmt(principal.v, 2))}<small>${pg ? 'm³/s' : 'm'}</small></span>` : `<span class="v sd">${SD}</span>`}`;
    const secs: string[] = [];
    if (pg && usa(d, 'nivel')) secs.push(numUlt(e.ultimoNivel, 2, 'm', 'Nivel'));
    if (vel) secs.push(numUlt(e.ultimaVelocidad, 2, 'm/s', 'Velocidad'));
    return `<article class="fichae" style="--c:${e.color}">
  <header><div><b>${esc(e.nombreCorto)}</b><span>${esc(e.grupoTitulo)} · ${esc(e.id)} · cada ${e.intervaloMin} min</span></div>${chipEnlace(e)}</header>
  <div class="vals">
    <div>${prim}</div>${secs.map((x) => `<div>${x}</div>`).join('')}
  </div>
  <div class="fig"><div class="tit sub-tit">${pg ? 'Gasto (m³/s)' : 'Nivel (m)'} · últimas 24 h, promedio horario</div>${svgSpark(e.spark, e.color, `Últimas 24 h de ${e.nombreCorto}`, 330, 96, { ejes: true, decimales: pg ? decQ(principal?.v) : 2 })}</div>
  <table class="vars"><thead><tr><th>Variación</th><th>24 h</th><th>7 d</th></tr></thead><tbody>${filas || `<tr><td colspan="3" class="sd">${SD}</td></tr>`}</tbody></table>
  <div class="pie-ficha${obsoleto ? ' alerta' : ''}">${ult ? `Última lectura: ${esc(fechaHoraLocal(ult.t))} (${esc(textoEdad(ult.edadMin))})${obsoleto ? ' · dato no actual' : ''}` : `Sin lecturas en la base (${SD})`}${e.ceroReciente ? ` · la última lectura de gasto (0.00) se excluyó por sospechosa` : ''}</div>
</article>`;
}

function hojaEstado(d: InformeGoes): string {
    return `<h2><span class="n">{{N}}</span>Estado actual por estación</h2>
<p class="fuente">Última lectura de cada estación al momento de emitir; la tira bajo la cifra muestra las últimas 24 h. El enlace es la salud de los mensajes satelitales.</p>
<div class="fichas">${d.estaciones.map((e) => ficha(d, e)).join('')}</div>`;
}

function hojaTendencia(d: InformeGoes): string {
    const filas = d.estaciones.map((e) => {
        const vs: { n: string; h24: Tendencia | null; d7: Tendencia | null; dec: number; u: string }[] = [];
        if (usa(d, 'gasto')) vs.push({ n: 'Gasto', h24: e.est.variacionGasto.h24, d7: e.est.variacionGasto.d7, dec: 1, u: 'm³/s' });
        if (usa(d, 'nivel')) vs.push({ n: 'Nivel', h24: e.est.variacionNivel.h24, d7: e.est.variacionNivel.d7, dec: 2, u: 'm' });
        return vs.map((v, i) => `<tr class="${i === 0 ? 'est-ini' : ''}">${i === 0 ? `<td class="est-nom" rowspan="${vs.length}"><i style="background:${e.color}"></i>${esc(e.nombreCorto)}</td>` : ''}<td>${v.n}</td><td>${celdaCambio(v.h24, v.dec, v.u)}</td><td>${celdaCambio(v.d7, v.dec, v.u)}</td></tr>`).join('');
    }).join('');
    const sparks = d.estaciones.map((e) => `<div class="fig caja"><div class="tit"><span class="chip" style="border-color:${e.color}"><i style="background:${e.color}"></i>${esc(e.nombreCorto)}</span></div>${svgLineas([{ id: e.id, etiqueta: e.nombreCorto, color: e.color, dash: '', pts: usa(d, 'gasto') ? e.serieGasto : e.serieNivel }], { desde: d.desdeMs, hasta: d.hastaMs, unidad: usa(d, 'gasto') ? 'm³/s' : 'm', decimales: usa(d, 'gasto') ? 1 : 2, titulo: `Tendencia de ${e.nombreCorto}`, ancho: 350, alto: 215, desdeCero: usa(d, 'gasto'), banda: false, pasoMin: 60, compacto: true })}</div>`).join('');
    return `<h2><span class="n">{{N}}</span>Tendencia a 24 horas y 7 días</h2>
<div class="tabla-wrap"><table class="tec"><thead><tr><th>Estación</th><th>Variable</th><th>Cambio a 24 h</th><th>Cambio a 7 d</th></tr></thead><tbody>${filas || `<tr><td colspan="4" class="sd">${SD}</td></tr>`}</tbody></table></div>
<p class="fuente">Cambio = última lectura menos la lectura más cercana a 24 h (o 7 d) antes. «Estable» = variación menor a 0.02 m en nivel o 1 m³/s en gasto. S/D = no hay lectura comparable en esa antigüedad.</p>
<div class="paneles">${sparks}</div>`;
}

function hojaGrafica(d: InformeGoes): string {
    const gasto: SerieLinea[] = d.estaciones.map((e, i) => ({ id: e.id, etiqueta: e.nombreCorto, color: e.color, dash: DASHES_ESTACION[i % 4], pts: e.serieGasto }));
    const paso = pasoParaSpan(d.hastaMs - d.desdeMs);
    const gastoSvg = usa(d, 'gasto')
        ? svgLineas(gasto, { desde: d.desdeMs, hasta: d.hastaMs, unidad: 'm³/s', decimales: 1, titulo: 'Gasto de las estaciones seleccionadas en el periodo', alto: 270, desdeCero: true, pasoMin: paso })
        : svgVacio(720, 90, 'Gasto', 'S/D — el gasto no se incluyó entre las variables');
    const nivel = d.estaciones.map((e) => `<div class="fig caja"><div class="tit"><i style="background:${e.color}"></i>${esc(e.nombreCorto)} · nivel (m)</div>${svgLineas([{ id: e.id, etiqueta: e.nombreCorto, color: e.color, dash: '', pts: e.serieNivel }], { desde: d.desdeMs, hasta: d.hastaMs, unidad: 'm', decimales: 2, titulo: `Nivel de ${e.nombreCorto} en el periodo`, ancho: 350, alto: 175, banda: true, pasoMin: paso, compacto: true })}</div>`).join('');
    return `<h2><span class="n">{{N}}</span>Gasto y nivel del periodo</h2>
<div class="fig caja"><div class="tit">Gasto (m³/s) · una sola escala para todas las estaciones</div>${gastoSvg}</div>
${usa(d, 'nivel') ? `<div class="fig"><div class="tit">Nivel (m) · cada panel con su propia escala</div></div><div class="paneles">${nivel}</div>` : ''}
<p class="fuente">La línea se interrumpe donde la estación no transmitió (S/D, no cero). En Babisas no se grafican las lecturas de gasto 0.00 con nivel alto (probable corte de la curva de gasto, sin confirmar).</p>`;
}

const tMm = (t: number) => esc(fechaHoraLocal(t));

function hojaEstadistica(d: InformeGoes): string {
    const filaR = (e: DatosEstacionGoes, nom: string, r: DatosEstacionGoes['est']['gasto'], dec0: number, ini: boolean, extra: string, span: number) => { const dec = dec0 === 1 && r && r.media < 10 ? 2 : dec0; return r
        ? `<tr class="${ini ? 'est-ini' : ''}">${ini ? `<td class="est-nom" rowspan="${span}"><i style="background:${e.color}"></i>${esc(e.nombreCorto)}</td>` : ''}<td>${nom}</td><td class="n">${r.n}</td><td class="n">${esc(fmt(r.media, dec))}</td><td class="n">${esc(fmt(r.mediana, dec))}</td><td class="n">${esc(fmt(r.min, dec))}<br><small>${tMm(r.tMin)}</small></td><td class="n">${esc(fmt(r.max, dec))}<br><small>${tMm(r.tMax)}</small></td><td class="n">${esc(fmt(r.p10, dec))}</td><td class="n">${esc(fmt(r.p90, dec))}</td><td class="n">${esc(fmt(r.desv, dec))}</td><td class="n">${extra}</td></tr>`
        : `<tr class="${ini ? 'est-ini' : ''}">${ini ? `<td class="est-nom" rowspan="${span}"><i style="background:${e.color}"></i>${esc(e.nombreCorto)}</td>` : ''}<td>${nom}</td><td colspan="9" class="sd">${SD} — sin lecturas en el periodo</td></tr>`; };
    const cuerpo = d.estaciones.map((e) => {
        const rs: [string, DatosEstacionGoes['est']['gasto'], number, string][] = [];
        if (usa(d, 'nivel')) rs.push(['Nivel (m)', e.est.nivel, 2, '']);
        if (usa(d, 'gasto')) rs.push([`Gasto (m³/s)${e.est.gastoRepresentativo ? '' : ' †'}`, e.est.gasto, 1, e.est.pendienteGastoDia != null ? esc(fmtDelta(e.est.pendienteGastoDia, 2)) : SD]);
        if (usa(d, 'velocidad') && e.id === 'C6300760') rs.push(['Velocidad (m/s)', e.est.velocidad, 2, '']);
        return rs.map((r, i) => filaR(e, r[0], r[1], r[2], i === 0, r[3] === '' ? '' : r[3], rs.length)).join('');
    }).join('');
    const cajas = svgCajas(d.estaciones.map((e) => ({ etiqueta: e.nombreCorto, color: e.color, min: e.est.gasto?.min ?? null, p10: e.est.gasto?.p10 ?? null, mediana: e.est.gasto?.mediana ?? null, media: e.est.gasto?.media ?? null, p90: e.est.gasto?.p90 ?? null, max: e.est.gasto?.max ?? null })), { unidad: 'm³/s', decimales: 1, titulo: 'Distribución del gasto por estación' });
    return `<h2><span class="n">{{N}}</span>Tabla estadística del periodo</h2>
<div class="tabla-wrap"><table class="tec"><thead><tr><th>Estación</th><th>Variable</th><th class="n">n</th><th class="n">Media</th><th class="n">Mediana</th><th class="n">Mínimo y hora</th><th class="n">Máximo y hora</th><th class="n">p10</th><th class="n">p90</th><th class="n">Desv.</th><th class="n">Pend./día</th></tr></thead><tbody>${cuerpo || `<tr><td colspan="11" class="sd">${SD}</td></tr>`}</tbody></table></div>
<p class="fuente">n = lecturas usadas. p10/p90 = percentiles 10 y 90. Desv. = desviación estándar. Pend./día = cambio del gasto por día (Theil-Sen, robusto a huecos), m³/s por día. Gasto sin lecturas 0.00 sospechosas.${d.estaciones.some((e) => !e.est.gastoRepresentativo) ? ' † Más de la mitad de las lecturas de gasto se excluyó (cero sospechoso): media, percentiles y volumen describen solo el tiempo con lectura válida, no todo el periodo.' : ''}</p>
${usa(d, 'gasto') ? `<div class="fig caja"><div class="tit">Distribución del gasto (m³/s)</div>${cajas}<div class="leyenda-caja">Bigote = mínimo–máximo · caja = percentil 10–90 · raya = mediana · rombo = media. Misma escala para todas las estaciones.</div></div>` : ''}`;
}

function hojaVolumen(d: InformeGoes, conComparacion: boolean): string {
    const barras = svgBarras(d.estaciones.map((e) => ({ etiqueta: e.nombreCorto, color: e.color, valor: e.est.volumen?.mm3 ?? null, nota: e.est.volumen ? `${fmt(e.est.volumen.pctIntegrado, 0)} % del tiempo integrado${e.est.gastoRepresentativo ? '' : ' †'}` : 'sin tramos continuos' })), { unidad: 'Mm³', decimales: 2, titulo: 'Volumen estimado por estación' });
    const filas = d.estaciones.map((e) => `<tr><td class="est-nom"><i style="background:${e.color}"></i>${esc(e.nombreCorto)}</td><td class="n">${esc(fmt(e.est.volumen?.mm3, 3))}</td><td class="n">${esc(fmt(e.est.volumen?.pctIntegrado, 0))} %</td><td class="n">${esc(fmt(e.est.volumen?.gastoMedio, 1))}</td><td class="n">${e.est.excluidas}</td></tr>`).join('');
    const c = d.comparacion;
    const comp = conComparacion ? `<h2><span class="n">{{N}}</span>Comparación presa ↔ río (orientativa)</h2>${c.sustentable
        ? `<div class="tabla-wrap"><table class="tec"><thead><tr><th>Estación de presa</th><th class="n">Gasto medio presa (m³/s)</th><th class="n">Gasto medio Ojinaga (m³/s)</th><th class="n">Río − presa (m³/s)</th><th class="n">Diferencia</th></tr></thead><tbody>${c.filas.map((f) => `<tr><td class="est-nom">${esc(f.nombre)}</td><td class="n">${esc(fmtQ(f.c.gastoPresa))}</td><td class="n">${esc(fmtQ(f.c.gastoRio))}</td><td class="n">${esc(fmtDelta(f.c.diferencia, 1))}</td><td class="n">${f.c.pct == null || f.c.gastoPresa < 5 ? '—' : esc(fmtDelta(f.c.pct, 0)) + ' %'}</td></tr>`).join('')}</tbody></table></div>
<div class="aviso neutro"><b>Orientativa, no es un balance.</b> Compara medias del periodo sin desfase de tránsito y sin medir tomas, aportes ni pérdidas entre la presa y Ojinaga; la diferencia puede deberse a cualquiera de ellos. El porcentaje (—) no se calcula con gasto de presa menor a 5 m³/s.</div>`
        : `<div class="aviso"><b>No se publica la comparación.</b> ${esc(c.motivo ?? 'Sin base para sustentarla.')}</div>`}` : '';
    return `<h2><span class="n">{{N}}</span>Volumen estimado en el periodo</h2>
<div class="fig caja"><div class="tit">Volumen (millones de m³)</div>${barras}</div>
<div class="tabla-wrap"><table class="tec"><thead><tr><th>Estación</th><th class="n">Volumen (Mm³)</th><th class="n">Tiempo integrado</th><th class="n">Gasto medio integrado (m³/s)</th><th class="n">Lecturas excluidas</th></tr></thead><tbody>${filas || `<tr><td colspan="5" class="sd">${SD}</td></tr>`}</tbody></table></div>
<p class="fuente">Volumen = integral trapezoidal del gasto entre lecturas vecinas separadas 45 min o menos; un hueco mayor no se integra (no se inventa caudal). «Tiempo integrado» es el % del periodo realmente cubierto: el volumen reportado es el de ese tiempo, no el de todo el periodo. Lecturas excluidas = gasto 0.00 sospechoso (Babisas).${d.estaciones.some((e) => !e.est.gastoRepresentativo) ? ' † Más de la mitad de las lecturas se excluyó: el volumen es solo el del tiempo integrado y subestima el del periodo completo.' : ''}</p>
${comp}`;
}

function hojaEnlace(d: InformeGoes): string {
    const filas = d.estaciones.map((e) => {
        const c = e.est.cobertura;
        return `<tr class="est-ini"><td class="est-nom"><i style="background:${e.color}"></i>${esc(e.nombreCorto)}</td><td><div class="mx">${svgSemaforoCobertura(c?.pct ?? null, COBERTURA_MIN_CONFIABLE, `Cobertura de ${e.nombreCorto}`)}</div><small>${c ? `${fmt(c.pct, 0)} % · ${c.recibidas} de ${c.esperadas}` : SD}</small></td><td class="n">${e.intervaloMin} min</td><td>${chipEnlace(e)}<br><small>${e.salud.ultimoMsMs != null ? `mensaje ${esc(fechaHoraLocal(e.salud.ultimoMsMs))}` : 'sin mensajes en 48 h'}</small></td><td class="n">${esc(fmt(e.salud.senalDbm, 0))}${e.salud.senalDbm == null ? '' : ' dBm'}</td><td class="n">${e.salud.total ? `${e.salud.buenos} / ${e.salud.conFalla}` : SD}${e.salud.pctBuenos != null ? `<br><small>${esc(fmt(e.salud.pctBuenos, 0))} % buenos</small>` : ''}</td></tr>
<tr><td></td><td colspan="5"><div class="tira-celda mx-tira">${svgTiraEnlace(e.tira as CeldaEnlace[], `Mensajes de las últimas 24 h de ${e.nombreCorto}`, 420)}</div></td></tr>`;
    }).join('');
    return `<h2><span class="n">{{N}}</span>Cobertura y salud del enlace</h2>
<div class="tabla-wrap"><table class="tec"><thead><tr><th>Estación</th><th>Cobertura del periodo</th><th class="n">Intervalo</th><th>Estado del enlace</th><th class="n">Señal (dBm)</th><th class="n">Mensajes 24 h<br>buenos / con falla</th></tr></thead><tbody>${filas || `<tr><td colspan="6" class="sd">${SD}</td></tr>`}</tbody></table></div>
<p class="fuente">Cobertura = lecturas recibidas entre las esperadas según el intervalo de la estación; la marca vertical es el ${COBERTURA_MIN_CONFIABLE} % de confiabilidad. La tira marca cada hora de las últimas 24 h antes de emitir: lleno = hubo mensaje bueno, con × = solo mensajes con falla, punteado = ninguno. Los mensajes se conservan 48 h. La señal es el valor que trae el mensaje satelital, tal cual; no se interpreta.</p>`;
}

function hojaMeteo(d: InformeGoes): string {
    const par = (r: { media: number; min: number; max: number } | null | undefined, dec: number) => (r ? `${esc(fmt(r.media, dec))} <small>(${esc(fmt(r.min, dec))} – ${esc(fmt(r.max, dec))})</small>` : `<span class="sd">${SD}</span>`);
    const filas = d.estaciones.map((e) => {
        if (e.id === 'C6300760') return `<tr class="est-ini"><td class="est-nom"><i style="background:${e.color}"></i>${esc(e.nombreCorto)}</td><td colspan="5" class="sd">${SD} — estación de río sin sensores meteorológicos</td></tr>`;
        const m = e.meteo;
        const rad = e.id === 'C6301AC4' ? '<span class="sd">No confiable (no se publica)</span>' : par(m?.rad, 0);
        return `<tr class="est-ini"><td class="est-nom"><i style="background:${e.color}"></i>${esc(e.nombreCorto)}</td><td class="n">${par(m?.temp, 1)}</td><td class="n">${m?.viento ? `${esc(fmt(m.viento.media, 1))} <small>(máx ${esc(fmt(m.viento.max, 1))})</small>` : `<span class="sd">${SD}</span>`}</td><td class="n">${par(m?.hr, 0)}</td><td class="n">${m?.presion ? esc(fmt(m.presion.media, 0)) : `<span class="sd">${SD}</span>`}</td><td class="n">${rad}</td></tr>`;
    }).join('');
    const conMeteo = d.estaciones.filter((e) => e.meteo);
    const paso = pasoParaSpan(d.hastaMs - d.desdeMs);
    const lineas = (campo: 'serieTemp' | 'serieViento', unidad: string, dec: number, cero: boolean, titulo: string) => svgLineas(
        conMeteo.map((e, i) => ({ id: e.id, etiqueta: e.nombreCorto, color: e.color, dash: DASHES_ESTACION[d.estaciones.indexOf(e) % 4] || DASHES_ESTACION[i % 4], pts: e.meteo![campo] })),
        { desde: d.desdeMs, hasta: d.hastaMs, unidad, decimales: dec, titulo, alto: 215, desdeCero: cero, pasoMin: paso });
    const graficas = conMeteo.length
        ? `<div class="fig caja"><div class="tit">Temperatura (°C)</div>${lineas('serieTemp', '°C', 1, false, 'Temperatura de las estaciones en el periodo')}</div>
<div class="fig caja"><div class="tit">Viento (m/s)</div>${lineas('serieViento', 'm/s', 1, true, 'Viento de las estaciones en el periodo')}</div>`
        : '';
    return `<h2><span class="n">{{N}}</span>Meteorología en las estaciones</h2>
<div class="tabla-wrap"><table class="tec"><thead><tr><th>Estación</th><th class="n">Temperatura °C<br>media (mín – máx)</th><th class="n">Viento m/s<br>medio (máximo)</th><th class="n">Humedad rel. %<br>media (mín – máx)</th><th class="n">Presión hPa<br>media</th><th class="n">Radiación W/m²<br>media (mín – máx)</th></tr></thead><tbody>${filas || `<tr><td colspan="6" class="sd">${SD}</td></tr>`}</tbody></table></div>
<p class="fuente">Medias aritméticas de las lecturas del periodo; la humedad, la presión y la radiación se transmiten una vez por hora. La radiación de Madero–Vírgenes no es confiable y no se publica; Ojinaga no mide meteorología.</p>
${graficas}`;
}

function hojaCalidadMetodo(d: InformeGoes, calidad: boolean, metodo: boolean): string {
    const notas = `<h2><span class="n">{{N}}</span>Notas de calidad de los datos</h2>
<ul class="notas">${d.notasCalidad.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
    const met = `<h2 style="margin-top:6px"><span class="n">{{N}}</span>Metodología</h2>
<div class="metodo">
<p><b>Fuente.</b> Telemetría satelital GOES de los registradores (DCP) de cada estación, recibida por el monitor Sutron; cada estación transmite un mensaje por hora con 3–4 lecturas. Hora de Chihuahua (UTC−6).</p>
<p><b>Estadística.</b> Se calculan sobre las lecturas del periodo elegido. Media y mediana aritméticas; p10/p90 por interpolación; desviación estándar muestral. Las lecturas de gasto 0.00 con nivel alto en Babisas se excluyen de promedios, estadística y volumen.</p>
<p><b>Tendencia.</b> Última lectura menos la más cercana a 24 h o 7 d antes (tolerancia del 40 % del salto); «estable» si el cambio es menor a 0.02 m (nivel) o 1 m³/s (gasto). La pendiente por día usa Theil-Sen sobre promedios horarios.</p>
<p><b>Volumen.</b> Integral trapezoidal del gasto entre lecturas separadas 45 min o menos. No se interpola sobre huecos.</p>
<p><b>Cobertura.</b> Lecturas recibidas entre las esperadas por el intervalo de la estación (15 min Ojinaga, 20 min las demás); confiable desde ${COBERTURA_MIN_CONFIABLE} %.</p>
<p><b>Límites.</b> Cifras provisionales de telemetría, sin validación de campo. La curva de gasto de cada sensor es de la estación; este informe no la corrige.</p>
</div>`;
    return `${calidad ? notas : ''}${metodo ? met : ''}`;
}

function hojaTrazabilidad(d: InformeGoes, folio: string, emitido: Date, o: OpcionesHtmlGoes): string {
    const ult = d.estaciones.flatMap((e) => [e.ultimoGasto?.t, e.ultimoNivel?.t]).filter((t): t is number => t != null);
    const vars = VARIABLES_INFORME.filter((v) => d.config.variables.includes(v.id)).map((v) => v.etiqueta).join(', ');
    return `<h2><span class="n">{{N}}</span>Trazabilidad y firmas</h2>
${tablaTrazabilidad([
        { k: 'Folio', v: folio },
        { k: 'Fecha y hora de generación', v: fechaHoraLegible(emitido) },
        { k: 'Emitió', v: o.emisor ?? 'SICA 005' },
        { k: 'Periodo', v: d.etiquetaPeriodo },
        { k: 'Rango consultado (hora de Chihuahua)', v: `${conAnio(d.desdeMs)} a ${conAnio(d.hastaMs)}` },
        { k: 'Última lectura incluida', v: ult.length ? conAnio(Math.max(...ult)) : SD },
        { k: 'Estaciones', v: d.estaciones.map((e) => `${e.nombre} (${e.id})`).join('; ') || SD },
        { k: 'Variables', v: vars || SD },
        { k: 'Modalidad y hoja', v: `${d.config.modalidad === 'basico' ? 'Básico' : 'Técnico'} · ${d.config.formato === 'a4' ? 'A4' : 'Carta'}` },
        { k: 'Fuente de datos', v: 'Telemetría GOES / DCP vía monitor Sutron, 1 mensaje por hora, almacenada en SICA 005' },
        { k: 'Versión del sistema', v: o.version ?? 'SICA 005' },
    ])}
<p class="fuente">Documento generado automáticamente por SICA 005 a partir de telemetría; no sustituye los informes oficiales.</p>
${bloqueFirmas()}`;
}

// ── Documento ─────────────────────────────────────────────────────────────────────

export function htmlInformeGoes(d: InformeGoes, logos: LogosGoes, o: OpcionesHtmlGoes = {}): string {
    const emitido = o.emitido ?? new Date(d.ahoraMs);
    const folio = folioGoes(d, emitido);
    const sel = new Set<SeccionGoes>(d.config.secciones);
    const permitidas = new Set(seccionesGoesDe(d.config.modalidad).map((s) => s.id));
    const on = (s: SeccionGoes) => sel.has(s) && permitidas.has(s);
    const bloques: { id: string; html: string }[] = [];
    if (on('resumen')) bloques.push({ id: 'resumen', html: hojaResumen(d) });
    if (on('estado')) bloques.push({ id: 'estado', html: hojaEstado(d) });
    if (on('tendencia')) bloques.push({ id: 'tendencia', html: hojaTendencia(d) });
    if (on('grafica')) bloques.push({ id: 'grafica', html: hojaGrafica(d) });
    if (on('estadistica')) bloques.push({ id: 'estadistica', html: hojaEstadistica(d) });
    if (on('volumen') || on('comparacion')) bloques.push({ id: 'volumen', html: hojaVolumen(d, on('comparacion')) });
    if (on('enlace')) bloques.push({ id: 'enlace', html: hojaEnlace(d) });
    if (on('meteo')) bloques.push({ id: 'meteo', html: hojaMeteo(d) });
    if (on('calidad') || on('metodologia')) bloques.push({ id: 'calidad', html: hojaCalidadMetodo(d, on('calidad'), on('metodologia')) });
    if (on('trazabilidad')) bloques.push({ id: 'trazabilidad', html: hojaTrazabilidad(d, folio, emitido, o) });
    const total = bloques.length;
    const titulo = `Informe de estaciones hidrométricas GOES — ${d.etiquetaPeriodo}`;
    const hojas = bloques.map((b, i) => {
        const cab = i === 0
            ? cabeceraInforme({ logoSrl: logos.srl, logoSica: logos.sica, titulo: 'Estaciones hidrométricas GOES', meta: [
                { k: 'Folio', v: folio }, { k: 'Emisión', v: fechaHoraLegible(emitido) }, { k: 'Periodo', v: d.etiquetaPeriodo }, { k: 'Modalidad', v: d.config.modalidad === 'basico' ? 'Básico' : 'Técnico' }] })
            : `<div class="run"><span><b>S R L Unidad Conchos</b> · Estaciones hidrométricas GOES</span><span>${esc(folio)} · ${esc(horaLocal(emitido.getTime()))} h</span></div>`;
        return `<section class="pagina" data-bloque="${b.id}">${cab}<div class="cuerpo">${b.html}</div>${pieInforme(`Folio ${folio} · SICA 005`, i + 1, total)}</section>`;
    });
    let k = 0;
    const cuerpo = hojas.join('\n').replace(/\{\{N\}\}/g, () => String(++k)) || `<section class="pagina"><div class="cuerpo"><h2>Informe de estaciones GOES</h2><p class="sd">${SD} — no se eligió ninguna sección.</p></div></section>`;
    // Sin botón propio: la vista previa vive en un iframe y su botón flotante duplicaría al de la ventana (y no imprime en iOS).
    return documentoHtml({ titulo, css: cssInforme({ formato: d.config.formato }) + EXTRA_CSS, cuerpo, metas: { generator: 'SICA 005', folio } })
        .replace(/<button class="btn-imprimir[\s\S]*?<\/button>\s*/, '');
}
