/**
 * exportHistoricoInforme — plantillas HTML autocontenidas del Informe Histórico de presas (Básico y Técnico).
 *
 * Regla rectora "S/D nunca cero": todo null se imprime "S/D" (vía formatearNumero); jamás "NaN", "undefined" ni 0 inventado.
 * El HTML no ejecuta JS ni llama a window.print(): el usuario lo abre/imprime (carta vertical).
 */
import { formatearNumero, MESES_CORTO, NOMBRE_PRESA, type Indice } from './historicoPresas';
import {
    METRICAS_INF, ORDEN_SECCIONES, SECCIONES, etiquetaPeriodo, type ConfigInforme, type SeccionId,
} from './informeHistoricoConfig';
import { prepararInforme, type BloqueMetrica, type CoberturaAnio, type DatosInforme, type PresaInforme } from './informeHistoricoDatos';
import {
    COLOR_INSTITUCIONAL, escSvg as esc, svgBandaClimatologia, svgBarrasCierre, svgBarrasDelta, svgLineasComparadas, svgMapaCalor, svgSemaforo, svgTendencia,
} from './informeHistoricoSvg';
import { assetToDataURI } from './assetToDataURI';
import { guardaOComparte } from './descargaArchivo';

/* ───────────────────────── API pública ───────────────────────── */

export async function generarInformeHtml(config: ConfigInforme, idx: Indice): Promise<string> {
    const d = prepararInforme(config, idx);
    const logo = await assetToDataURI('/logos/logo-srl.png');
    return config.modalidad === 'tecnico' ? buildHTMLTecnico(d, logo) : buildHTMLBasico(d, logo);
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function nombreArchivoInforme(config: ConfigInforme): string {
    const presas = config.presas.map(id => {
        const palabras = sinAcentos(NOMBRE_PRESA[id] ?? id).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
        return palabras[palabras.length - 1] || id;
    }).join('-') || 'Presas';
    const p = config.periodo, dos = (n: number) => String(n).padStart(2, '0');
    const per = p.tipo === 'mes' ? `${config.anioBase}-${dos(p.mes)}`
        : p.tipo === 'rangoMeses' ? `${config.anioBase}-${dos(p.mesIni)}a${dos(p.mesFin)}`
        : p.tipo === 'anio' ? `${config.anioBase}`
        : `Ciclo${config.anioBase}-${config.anioBase + 1}`;
    return `Informe_Historico_${presas}_${per}_${config.modalidad === 'tecnico' ? 'Tecnico' : 'Basico'}.html`;
}

export async function descargarInformeHtml(html: string, nombre: string): Promise<void> {
    await guardaOComparte(new Blob([html], { type: 'text/html;charset=utf-8' }), nombre, 'text/html');
}

/* ───────────────────────── Utilidades de formato ───────────────────────── */

const n = (v: number | null | undefined, dec = 1) => esc(formatearNumero(v, dec));
const conUnidad = (v: number | null | undefined, dec: number, u: string) => (v == null || !Number.isFinite(v) ? 'S/D' : `${esc(formatearNumero(v, dec))} ${esc(u)}`);
const firmado = (v: number | null | undefined, dec = 1): string =>
    v == null || !Number.isFinite(v) ? 'S/D' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${esc(formatearNumero(Math.abs(v), dec))}`;
const firmadoU = (v: number | null | undefined, dec: number, u: string) => (v == null || !Number.isFinite(v) ? 'S/D' : `${firmado(v, dec)} ${esc(u)}`);
const pctTxt = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? 'S/D' : `${esc(formatearNumero(v * 100, 0))} %`);

function fecha(iso: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
    return m ? `${Number(m[3])} ${MESES_CORTO[Number(m[2]) - 1].toLowerCase()} ${m[1]}` : 'S/D';
}

function generadoTxt(d: Date): string {
    try { return d.toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Chihuahua' }); } catch { return d.toISOString(); }
}

const principal = (p: PresaInforme): BloqueMetrica | undefined => p.bloques.find(b => b.metrica === 'volumen') ?? p.bloques[0];
const bloqueDe = (p: PresaInforme, m: string) => p.bloques.find(b => b.metrica === m);
const incluida = (d: DatosInforme, s: SeccionId) => d.config.secciones.includes(s);
const seccionesOrdenadas = (d: DatosInforme) => ORDEN_SECCIONES.filter(s => incluida(d, s));
const serieTxt = (d: DatosInforme) => (d.config.serie === 'normalizada' ? 'Normalizada (curva de capacidad vigente)' : 'Como se reportó');
const aniosTxt = (d: DatosInforme) => d.anios.map(a => `${esc(a.etiqueta)}${a.esBase ? ' (base)' : ''}`).join(' · ');
const etiquetaDe = (b: BloqueMetrica, anio: number) => b.cierres.find(c => c.anio === anio)?.etiqueta ?? String(anio);

const lista = (items: string[], clase = '') => (items.length ? `<ul class="${clase}">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '');

function cajaAvisos(avisos: string[], titulo = 'Avisos'): string {
    if (!avisos.length) return '';
    return `<div class="aviso" role="note"><b>${esc(titulo)}</b>${lista(avisos)}</div>`;
}

/* ───────────────────────── CSS y estructura común ───────────────────────── */

const CSS = `
:root{--inst:${COLOR_INSTITUCIONAL};--inst-claro:#f4eaea;--ink:#1f2328;--ink2:#57606a;--linea:#dcd9d2;--fondo:#f6f5f2;--ok:#2E7D32;--amb:#B26A00;--rojo:#B3261E}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:var(--fondo);color:var(--ink);font-family:"Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.45}
.hoja{width:8.5in;max-width:100%;margin:14px auto;background:#fff;padding:12mm 14mm;box-shadow:0 1px 8px rgba(0,0,0,.14)}
h1,h2,h3,h4{font-family:Georgia,"Times New Roman",serif;color:var(--inst);margin:0;font-weight:700;break-after:avoid;page-break-after:avoid}
.cab{display:flex;align-items:center;gap:16px;border-bottom:3px solid var(--inst);padding-bottom:9px;margin-bottom:12px}
.cab img{height:54px;width:auto;display:block}
.marca{font-family:Georgia,serif;color:var(--inst);line-height:1.15}
.marca b{display:block;font-size:15pt;letter-spacing:.32em}.marca span{display:block;font-size:9pt;letter-spacing:.5em;margin-top:2px}
.cab .tit{margin-left:auto;text-align:right}
.cab .tit h1{font-size:15pt;line-height:1.15}.cab .tit p{margin:2px 0 0;color:var(--ink2);font-size:8.5pt}
.meta{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:8.5pt;color:var(--ink2);margin:0 0 10px}
.meta b{color:var(--ink);font-weight:600}
.presa-h{font-size:21pt;margin:2px 0 8px;display:flex;align-items:baseline;gap:10px}
.presa-h small{font:600 9pt "Segoe UI",sans-serif;color:var(--ink2);letter-spacing:.08em;text-transform:uppercase}
.fila{display:flex;gap:14px;align-items:stretch;margin-bottom:10px}
.caja{border:1px solid var(--linea);border-radius:6px;padding:8px 11px;background:#fff;break-inside:avoid;page-break-inside:avoid}
.caja.res{flex:1;border-left:5px solid var(--inst)}
.caja.res h3{font-size:10pt;margin-bottom:3px;text-transform:uppercase;letter-spacing:.07em;font-family:"Segoe UI",sans-serif}
.caja.res ul{margin:0;padding-left:16px}.caja.res li{margin:2px 0;font-size:10.5pt}
.caja.sem{flex:0 0 232px;display:flex;flex-direction:column;justify-content:center;gap:5px}
.caja.sem small{color:var(--ink2);font-size:8pt;line-height:1.3}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-bottom:10px}
.kpi{border:1px solid var(--linea);border-top:4px solid var(--inst);border-radius:6px;padding:7px 10px;break-inside:avoid;page-break-inside:avoid;background:#fff}
.kpi .l{font-size:8pt;text-transform:uppercase;letter-spacing:.07em;color:var(--ink2);font-weight:600}
.kpi .v{font:700 20pt/1.1 Georgia,serif;color:var(--ink);margin-top:2px;font-variant-numeric:tabular-nums}
.kpi .v small{font:500 9pt "Segoe UI",sans-serif;color:var(--ink2)}
.kpi .s{font-size:8.5pt;color:var(--ink2);margin-top:1px}
.fig{border:1px solid var(--linea);border-radius:6px;padding:6px 8px 4px;margin-bottom:10px;break-inside:avoid;page-break-inside:avoid;background:#fff}
.fig h3,.fig h4{font-size:10pt;margin:0 0 3px;font-family:"Segoe UI",sans-serif;color:var(--ink)}
.fig .nota,.nota{font-size:8pt;color:var(--ink2);margin:2px 0 0;line-height:1.3}
.dos{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{border-bottom:1px solid var(--linea);padding:3px 6px;text-align:right;font-size:9.5pt}
th{background:var(--inst-claro);color:var(--inst);font-weight:600;font-size:8.5pt}
th:first-child,td:first-child{text-align:left}
thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}
tr.base td{font-weight:700;background:#faf3f3}
td.sd{color:var(--ink2);font-style:italic}
.aviso{border:1px solid #d9a441;background:#fff8e6;border-left:5px solid #C27A0E;border-radius:4px;padding:6px 10px;margin:8px 0;font-size:9pt;break-inside:avoid;page-break-inside:avoid}
.aviso b{display:block;margin-bottom:2px}.aviso ul{margin:0;padding-left:16px}
.aviso.fuerte{border-color:#B3261E;border-left-color:#B3261E;background:#fdecea}
.pie-doc{margin-top:10px;font-size:7.5pt;color:var(--ink2);border-top:1px solid var(--linea);padding-top:4px}
.pagina{break-after:page;page-break-after:always}
.pagina:last-child,.pagina.ultima{break-after:auto;page-break-after:auto}
@page{size:letter portrait;margin:12mm 14mm;@bottom-left{content:"Informe Histórico de Presas · SRL Unidad Conchos";font:7.5pt "Segoe UI",sans-serif;color:#57606a}@bottom-right{content:"Pág. " counter(page) " de " counter(pages);font:7.5pt "Segoe UI",sans-serif;color:#57606a}}
@media print{body{background:#fff}.hoja{box-shadow:none;margin:0;padding:0;width:auto}}
@media screen and (max-width:720px){.kpis{grid-template-columns:repeat(2,1fr)}.dos{grid-template-columns:1fr}.fila{flex-direction:column}.caja.sem{flex-basis:auto}.hoja{padding:12px}.cab{flex-wrap:wrap}}
`;

const CSS_BASICO = `
body{font-size:10.5pt;line-height:1.38}
.cab{padding-bottom:6px;margin-bottom:8px}.cab img{height:44px}.marca b{font-size:13pt}
.meta{margin-bottom:6px;font-size:8pt}
.presa-h{font-size:19pt;margin:0 0 6px}
.fila{margin-bottom:8px}.caja{padding:6px 10px}
.caja.res li{font-size:9.8pt;margin:1px 0}
.kpis{gap:8px;margin-bottom:8px}.kpi{padding:5px 9px}.kpi .v{font-size:17pt}
.fig{margin-bottom:8px;padding:5px 7px 3px}.fig h3{font-size:9.5pt}
.dos td:not(:first-child),.dos th{white-space:nowrap}
.dos{gap:8px;margin-bottom:8px}.dos .fig{margin-bottom:0}
th,td{font-size:8.8pt;padding:2px 5px}
.aviso{margin:6px 0;padding:4px 9px;font-size:8.5pt}
.pie-doc{margin-top:6px}
`;

const CSS_TECNICO = `
body{font-size:9.5pt;line-height:1.38}
th,td{font-size:8.5pt;padding:2px 5px}
h2{font-size:13pt;border-bottom:1.5px solid var(--inst);padding-bottom:2px;margin:16px 0 7px}
h3.pr{font-size:11pt;margin:10px 0 4px}
h4{font-size:9.5pt;margin:7px 0 3px;font-family:"Segoe UI",sans-serif;color:var(--ink)}
.portada{break-after:page;page-break-after:always}
.portada h1.gran{font-size:25pt;margin:34px 0 4px;line-height:1.1}
.portada .sub{color:var(--ink2);font-size:12pt;margin-bottom:20px}
.filtros th{width:30%;text-align:left;background:var(--inst-claro)}.filtros td{text-align:left;font-size:9.5pt}
.caja.res li{font-size:9.5pt}
.kpis{grid-template-columns:repeat(3,1fr)}.kpi .v{font-size:15pt}
.fn{font-size:7.5pt;color:var(--ink2);border-top:1px solid var(--linea);margin-top:5px;padding-top:3px}
.anexo th,.anexo td{font-size:8pt;padding:1px 5px}
.pct-t{max-width:5in}
`;

function cabecera(logo: string, titulo: string, subtitulo: string): string {
    const marca = logo
        ? `<img src="${esc(logo)}" alt="SRL Unidad Conchos, Delicias">`
        : `<div class="marca"><b>S R L</b><span>UNIDAD CONCHOS</span><span>DELICIAS</span></div>`;
    return `<div class="cab">${marca}<div class="tit"><h1>${esc(titulo)}</h1><p>${esc(subtitulo)}</p></div></div>`;
}

function metaLinea(d: DatosInforme, presas: string): string {
    return `<div class="meta"><span><b>Presa(s):</b> ${esc(presas)}</span><span><b>Periodo:</b> ${esc(d.periodoEtiqueta)}</span><span><b>Años:</b> ${aniosTxt(d)}</span><span><b>Serie:</b> ${esc(serieTxt(d))}</span><span><b>Generado:</b> ${esc(generadoTxt(d.generado))}</span></div>`;
}

function documento(titulo: string, css: string, cuerpo: string): string {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title><style>${CSS}${css}</style></head><body>${cuerpo}</body></html>`;
}

/* ───────────────────────── Piezas compartidas ───────────────────────── */

function tarjetasKpi(p: PresaInforme): string {
    const b = principal(p);
    if (!b) return '';
    const ll = bloqueDe(p, 'llenado');
    const t: string[] = [];
    const k = (l: string, v: string, s: string) => `<div class="kpi"><div class="l">${esc(l)}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    t.push(k(`Cierre · ${b.nombre}`, b.cierreBase ? `${n(b.cierreBase.valor, b.decimales)} <small>${esc(b.unidad)}</small>` : 'S/D', b.cierreBase ? `al ${esc(fecha(b.cierreBase.fecha))}` : 'sin lectura en el periodo'));
    if (ll && ll !== b) t.push(k('Llenado', ll.cierreBase ? `${n(ll.cierreBase.valor, 1)} <small>%</small>` : 'S/D', ll.cierreBase ? 'de la capacidad' : 'sin lectura en el periodo'));
    t.push(k(b.vsPrevio ? `Vs ${b.vsPrevio.etiqueta}` : 'Vs año previo', b.vsPrevio ? `${firmado(b.vsPrevio.abs, b.decimales)} <small>${esc(b.unidad)}</small>` : 'S/D', b.vsPrevio ? (b.vsPrevio.pct != null ? `${firmado(b.vsPrevio.pct)} %` : 'S/D %') : 'sin año previo con dato'));
    t.push(k('Posición histórica', b.posicion ? `${b.posicion.posicion}.º <small>de ${b.posicion.de}</small>` : 'S/D', b.posicion ? 'de menor a mayor, mismo periodo' : 'sin años comparables'));
    return `<div class="kpis">${t.join('')}</div>`;
}

function filaResumenSemaforo(p: PresaInforme, conRes: boolean, conSem: boolean): string {
    if (!conRes && !conSem) return '';
    const b = principal(p);
    const res = conRes ? `<div class="caja res"><h3>Resumen ejecutivo</h3>${lista(p.hallazgos.slice(0, 4))}</div>` : '';
    const sem = conSem ? `<div class="caja sem">${svgSemaforo(b?.semaforo ?? 'sd')}<small>Posición del año base por terciles entre los años con dato en el mismo periodo (${esc(b?.nombre ?? 'métrica')}). El color nunca va solo: se acompaña de texto.</small></div>` : '';
    return `<div class="fila">${res}${sem}</div>`;
}

function tablaComparativa(p: PresaInforme, d: DatosInforme): string {
    if (!p.bloques.length) return '';
    const etBase = esc(d.anios.find(a => a.esBase)?.etiqueta ?? '');
    const etPrev = esc(p.bloques.find(b => b.vsPrevio)?.vsPrevio?.etiqueta ?? 'previo');
    const filas = p.bloques.map(b => {
        const prev = b.vsPrevio ? b.cierres.find(c => c.anio === b.vsPrevio!.anio)?.valor ?? null : null;
        return `<tr><td>${esc(b.nombre)} <small>(${esc(b.unidad)})</small></td><td>${n(b.cierreBase?.valor, b.decimales)}</td><td>${n(prev, b.decimales)}</td><td>${firmado(b.vsPrevio?.abs, b.decimales)}</td><td>${b.vsPrevio ? firmado(b.vsPrevio.pct) : 'S/D'}${b.vsPrevio?.pct != null ? ' %' : ''}</td><td>${b.posicion ? `${b.posicion.posicion}.º de ${b.posicion.de}` : 'S/D'}</td></tr>`;
    }).join('');
    return `<div class="fig"><h3>Comparativo contra el año previo</h3><table><thead><tr><th>Métrica</th><th>${etBase} (base)</th><th>${etPrev}</th><th>Δ</th><th>Δ %</th><th>Posición</th></tr></thead><tbody>${filas}</tbody></table><p class="nota">Cierre = último dato del periodo. Posición de menor a mayor entre los años con cobertura suficiente.</p></div>`;
}

function filasCalidad(p: PresaInforme, tope = 6): string {
    return p.calidad.map((c: CoberturaAnio) => {
        const parcial = c.pct != null && c.pct < 0.5;
        const hu = c.huecos.length
            ? c.huecos.slice(0, tope).map(h => `${esc(fecha(h.desde))}${h.desde === h.hasta ? '' : ` – ${esc(fecha(h.hasta))}`} (${h.dias} d)`).join('; ') + (c.huecos.length > tope ? `; +${c.huecos.length - tope} más` : '')
            : 'sin huecos';
        return `<tr class="${c.esBase ? 'base' : ''}"><td>${esc(c.etiqueta)}${c.esBase ? ' (base)' : ''}${parcial ? ' · <i>parcial</i>' : ''}</td><td>${c.esperados}</td><td>${c.conDato}</td><td>${c.sinDato}${c.sinDato ? ' <small>S/D</small>' : ''}</td><td>${pctTxt(c.pct)}</td><td>${c.atipicos}</td><td style="text-align:left">${hu}</td></tr>`;
    }).join('');
}

/* ───────────────────────── BÁSICO ───────────────────────── */

export function buildHTMLBasico(d: DatosInforme, logo: string): string {
    const nombres = d.presas.map(p => p.nombre).join(' y ');
    const sec = new Set(d.config.secciones);
    const orden = seccionesOrdenadas(d);

    const paginas = d.presas.map((p, i) => {
        const b = principal(p);
        const piezas: string[] = [];
        const hechas = new Set<SeccionId>();
        for (const s of orden) {
            if (hechas.has(s)) continue;
            switch (s) {
                case 'resumen': case 'semaforo': {
                    hechas.add('resumen'); hechas.add('semaforo');
                    piezas.push(filaResumenSemaforo(p, sec.has('resumen'), sec.has('semaforo')));
                    break;
                }
                case 'kpis': piezas.push(tarjetasKpi(p)); break;
                case 'serie': if (b) piezas.push(`<div class="fig"><h3>Serie comparada · ${esc(b.nombre)} (${esc(b.unidad)})</h3>${svgLineasComparadas(b, { ancho: 640, alto: 162 })}</div>`); break;
                case 'cierres': case 'comparativo': {
                    hechas.add('cierres'); hechas.add('comparativo');
                    const c = sec.has('cierres') && b ? `<div class="fig"><h3>Cierre por año · ${esc(b.unidad)}</h3>${svgBarrasCierre(b.cierres, { ancho: 380, alto: 170, decimales: b.decimales, unidad: b.unidad })}</div>` : '';
                    const t = sec.has('comparativo') ? tablaComparativa(p, d) : '';
                    if (c && t) piezas.push(`<div class="dos">${c}${t}</div>`);
                    else piezas.push(c + t);
                    break;
                }
                case 'mapaCalor': if (b) piezas.push(`<div class="fig"><h3>Mapa de calor · ${esc(b.nombre)}</h3>${svgMapaCalor(b.matriz, b)}</div>`); break;
                case 'calidad': {
                    const cob = p.calidad.map(c => `${esc(c.etiqueta)}${c.esBase ? ' (base)' : ''}: <b>${pctTxt(c.pct)}</b>${c.sinDato ? ` (${c.sinDato} d S/D)` : ''}${c.pct != null && c.pct < 0.5 ? ' · parcial' : ''}`).join(' &nbsp;·&nbsp; ');
                    piezas.push(`<p class="nota" style="margin:0 0 6px;font-size:8.8pt"><b>Calidad de datos — cobertura del periodo:</b> ${cob || 'S/D'}</p>`);
                    break;
                }
                default: break;
            }
        }
        const avisosPresa = cajaAvisos(p.advertencias.slice(0, 3), 'Avisos de calidad');
        const avisosGlobal = i === 0 && d.advertencias.length ? `<p class="nota" style="margin:0 0 6px"><b>Avisos:</b> ${d.advertencias.map(esc).join(' ')}</p>` : '';
        return `<section class="hoja pagina${i === d.presas.length - 1 ? ' ultima' : ''}">${cabecera(logo, 'Informe Histórico de Presas', 'Resumen para directivos')}${metaLinea(d, nombres)}<h2 class="presa-h">${esc(p.nombre)}<small>${esc(d.periodoEtiqueta)}</small></h2>${avisosGlobal}${piezas.join('')}${avisosPresa}</section>`;
    });

    const cuerpo = paginas.length ? paginas.join('') : `<section class="hoja">${cabecera(logo, 'Informe Histórico de Presas', 'Resumen para directivos')}${metaLinea(d, 'S/D')}<p>S/D — no se eligió ninguna presa.</p></section>`;
    return documento('Informe Histórico de Presas — Básico', CSS_BASICO, cuerpo);
}

/* ───────────────────────── TÉCNICO ───────────────────────── */

const LIMITACIONES = [
    'No existe extracción diaria ni aportación real para 2021-2025: la serie histórica solo trae almacenamiento (mensual SRL) y no permite cerrar un balance hídrico.',
    'El Δ de almacenamiento entre cierres es aparente: mezcla extracción, aportación, evaporación e infiltración y no debe leerse como consumo ni como entrada.',
    'No hay lluvia comparable en la serie histórica: las diferencias entre años no pueden atribuirse a precipitación con estos datos.',
    'Solo hay 5 años completos de referencia (2021-2025): percentiles, posiciones y tendencia son descriptivos y frágiles; no son predictivos.',
    'El año en curso tiene captura de campo esparcida y la ingesta diaria CILA es reciente; su cobertura puede ser parcial y se rotula en cada gráfica y tabla.',
    'Los cambios de curva de capacidad (La Boquilla, 1-sep-2021; Fco. I. Madero, tabla SRL 8-jul-2021) hacen que la serie reportada no sea comparable entre años; use la normalizada.',
];

type RenderSec = (d: DatosInforme) => string;

function porPresaBloque(d: DatosInforme, fn: (p: PresaInforme, b: BloqueMetrica) => string): string {
    return d.presas.map(p => {
        const partes = p.bloques.map(b => fn(p, b)).filter(Boolean).join('');
        return partes ? `<h3 class="pr">${esc(p.nombre)}</h3>${partes}` : '';
    }).join('');
}
const porPresa = (d: DatosInforme, fn: (p: PresaInforme) => string): string =>
    d.presas.map(p => { const x = fn(p); return x ? `<h3 class="pr">${esc(p.nombre)}</h3>${x}` : ''; }).join('');

const RENDER_TEC: Partial<Record<SeccionId, RenderSec>> = {
    resumen: d => porPresa(d, p => filaResumenSemaforo(p, true, false)),

    semaforo: d => porPresaBloque(d, (_p, b) => `<div class="caja sem" style="margin-bottom:6px;display:inline-flex;margin-right:8px">${svgSemaforo(b.semaforo)}<small>${esc(b.nombre)}</small></div>`)
        + `<p class="nota">Terciles de la posición del año base entre los años con dato; con menos de 3 años no se clasifica (S/D).</p>`,

    kpis: d => porPresaBloque(d, (_p, b) => {
        const k = (l: string, v: string, s = '') => `<div class="kpi"><div class="l">${esc(l)}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
        return `<h4>${esc(b.nombre)} (${esc(b.unidad)})</h4><div class="kpis">`
            + k('Cierre del periodo', conUnidad(b.cierreBase?.valor, b.decimales, b.unidad), b.cierreBase ? `al ${esc(fecha(b.cierreBase.fecha))}` : 'S/D')
            + k('Apertura del periodo', conUnidad(b.aperturaBase?.valor, b.decimales, b.unidad), b.aperturaBase ? `al ${esc(fecha(b.aperturaBase.fecha))}` : 'S/D')
            + k('Variación en el periodo', firmadoU(b.variacionBase, b.decimales, b.unidad), 'cierre − apertura')
            + k(b.vsPrevio ? `Vs ${b.vsPrevio.etiqueta}` : 'Vs año previo', b.vsPrevio ? firmadoU(b.vsPrevio.abs, b.decimales, b.unidad) : 'S/D', b.vsPrevio?.pct != null ? `${firmado(b.vsPrevio.pct)} %` : '')
            + k('Posición histórica', b.posicion ? `${b.posicion.posicion}.º de ${b.posicion.de}` : 'S/D', 'de menor a mayor')
            + k('Anomalía vs promedio', b.anomalia ? firmadoU(b.anomalia.abs, b.decimales, b.unidad) : 'S/D', b.anomalia ? `${b.anomalia.pct != null ? firmado(b.anomalia.pct) + ' % · ' : ''}${b.anomalia.n} años de referencia` : '')
            + '</div>';
    }),

    serie: d => porPresaBloque(d, (_p, b) => {
        const ex = b.extremosBase;
        return `<div class="fig"><h4>${esc(b.nombre)} (${esc(b.unidad)}) — comparación diaria</h4>${svgLineasComparadas(b, { ancho: 680, alto: 250 })}`
            + `<p class="nota">Las lagunas de la línea son S/D (no se interpolan ni se dibujan como cero). Máximo del año base: ${ex ? `${conUnidad(ex.max.valor, b.decimales, b.unidad)} (${esc(fecha(ex.max.fecha))})` : 'S/D'}; mínimo: ${ex ? `${conUnidad(ex.min.valor, b.decimales, b.unidad)} (${esc(fecha(ex.min.fecha))})` : 'S/D'}.</p></div>`;
    }),

    cierres: d => porPresaBloque(d, (_p, b) => `<div class="fig"><h4>Cierre del periodo por año — ${esc(b.nombre)}</h4>${svgBarrasCierre(b.cierres, { ancho: 560, alto: 220, decimales: b.decimales, unidad: b.unidad })}<p class="nota">Barras con trama = año parcial (cobertura &lt; 50 %). Sin barra y rotulado S/D = año sin dato de cierre.</p></div>`),

    mapaCalor: d => porPresaBloque(d, (_p, b) => `<div class="fig"><h4>${esc(b.nombre)} — cierre mensual por año</h4>${svgMapaCalor(b.matriz, b, { ancho: 680 })}</div>`),

    comparativo: d => porPresa(d, p => tablaComparativa(p, d)),

    metodologia: d => `<h4>Fuentes</h4>${lista(d.fuentes)}`
        + `<h4>Criterios</h4>${lista([
            `Serie utilizada: ${serieTxt(d)}. Normalizada = volumen y % recalculados desde la escala medida con la curva vigente; reportada = valores tal como salieron en cada reporte.`,
            `Años con cobertura menor a 50 % de los días esperados se rotulan "parcial" y ${d.config.incluirParciales ? 'se incluyen' : 'se excluyen'} de promedios, percentiles y tendencia (el año base siempre se muestra).`,
            'Cierre del periodo = último dato disponible dentro del periodo; apertura = primer dato. Los días sin lectura son S/D y nunca se rellenan.',
            'Jerarquía de fuentes cuando una fecha tiene varias: CAMPO > CILA > HISTORICO.',
        ])}`
        + d.presas.map(p => `<h4>${esc(p.nombre)}: curvas de capacidad</h4>${lista(p.notasCurva)}`).join(''),

    estadistica: d => porPresaBloque(d, (_p, b) => {
        const s = b.estadisticaBase, a = b.anomalia;
        const sdv = (v: number | null | undefined) => n(v, b.decimales);
        return `<h4>${esc(b.nombre)} (${esc(b.unidad)}) — año base, valores diarios</h4><table class="pct-t"><thead><tr><th>Días con dato</th><th>Media</th><th>Mediana</th><th>Mínimo</th><th>Máximo</th><th>Desv. est.</th></tr></thead><tbody><tr><td>${s ? s.n : 'S/D'}</td><td>${sdv(s?.media)}</td><td>${sdv(s?.mediana)}</td><td>${sdv(s?.min)}</td><td>${sdv(s?.max)}</td><td>${sdv(s?.desv)}</td></tr></tbody></table>`
            + `<table class="pct-t" style="margin-top:4px"><thead><tr><th>Cierre base</th><th>Promedio de referencia</th><th>Anomalía abs.</th><th>Anomalía %</th><th>Años de referencia</th></tr></thead><tbody><tr><td>${sdv(b.cierreBase?.valor)}</td><td>${sdv(a?.promedio)}</td><td>${a ? firmado(a.abs, b.decimales) : 'S/D'}</td><td>${a ? (a.pct != null ? firmado(a.pct) + ' %' : 'S/D') : 'S/D'}</td><td>${a ? a.n : 'S/D'}</td></tr></tbody></table>`
            + `<p class="nota">El promedio de referencia excluye al año base.</p>`;
    }),

    ranking: d => porPresaBloque(d, (_p, b) => {
        const pc = b.percentiles;
        const filas = b.ranking.map((r, i) => {
            const base = r.anio === d.config.anioBase;
            return `<tr class="${base ? 'base' : ''}"><td>${i + 1}.º</td><td>${esc(etiquetaDe(b, r.anio))}${base ? ' (base)' : ''}</td><td>${n(r.valor, b.decimales)}</td><td>${esc(fecha(r.fecha))}</td></tr>`;
        }).join('');
        const aviso = pc?.fragil ? `<div class="aviso fuerte" role="note"><b>Advertencia: percentiles frágiles</b>Se calcularon con solo n = ${pc.n} años (menos de 10). Interprételos únicamente junto con el valor de cada año; no son umbrales estadísticamente robustos.</div>`
            : !pc ? `<div class="aviso" role="note"><b>Percentiles S/D</b>Se requieren al menos 2 años de referencia con dato.</div>` : '';
        const tp = pc ? `<table class="pct-t"><thead><tr><th>P10</th><th>P25</th><th>P50</th><th>P75</th><th>P90</th><th>n</th><th>Cierre base</th></tr></thead><tbody><tr><td>${n(pc.p10, b.decimales)}</td><td>${n(pc.p25, b.decimales)}</td><td>${n(pc.p50, b.decimales)}</td><td>${n(pc.p75, b.decimales)}</td><td>${n(pc.p90, b.decimales)}</td><td>${pc.n}</td><td>${n(b.cierreBase?.valor, b.decimales)}</td></tr></tbody></table>` : '';
        return `<h4>${esc(b.nombre)} (${esc(b.unidad)})</h4>${aviso}<div class="dos"><table><thead><tr><th>Posición</th><th>Año</th><th>Cierre</th><th>Fecha</th></tr></thead><tbody>${filas || '<tr><td colspan="4" class="sd">S/D</td></tr>'}</tbody></table><div>${tp}<p class="nota">Percentiles sobre los años de referencia (sin el año base). Posición 1.º = el valor más bajo.</p></div></div>`;
    }),

    extremos: d => porPresaBloque(d, (_p, b) => {
        const r = (l: string, v: { valor: number; fecha: string } | undefined) => `<tr><td>${esc(l)}</td><td>${n(v?.valor, b.decimales)}</td><td>${v ? esc(fecha(v.fecha)) : 'S/D'}</td></tr>`;
        return `<h4>${esc(b.nombre)} (${esc(b.unidad)})</h4><table class="pct-t"><thead><tr><th>Extremo</th><th>Valor</th><th>Fecha</th></tr></thead><tbody>${r('Máximo del año base (periodo)', b.extremosBase?.max)}${r('Mínimo del año base (periodo)', b.extremosBase?.min)}${r('Máximo de toda la serie', b.extremosHistoricos?.max)}${r('Mínimo de toda la serie', b.extremosHistoricos?.min)}</tbody></table>`;
    }),

    estacionalidad: d => porPresaBloque(d, (_p, b) => `<div class="fig"><h4>${esc(b.nombre)} — estacionalidad del cierre mensual</h4>${svgBandaClimatologia(b.climatologia, { ancho: 680, alto: 260, decimales: b.decimales, unidad: b.unidad, etiquetaBase: b.series.find(s => s.esBase)?.etiqueta })}<p class="nota">La banda resume el cierre de cada mes en los años de referencia (n visible bajo cada mes); un mes con n = S/D no tiene referencia. El año base se dibuja encima.</p></div>`),

    tendencia: d => porPresaBloque(d, (_p, b) => `<div class="fig"><h4>${esc(b.nombre)} — tendencia lineal del cierre anual (descriptiva, no predictiva)</h4>${svgTendencia(b.ranking, b.tendencia, { ancho: 560, alto: 240, decimales: b.decimales, unidad: b.unidad, anioBase: d.config.anioBase })}<p class="nota">Descriptiva, no predictiva: ajuste por mínimos cuadrados sobre ${b.tendencia ? b.tendencia.n : 'S/D'} cierres anuales. Con tan pocos años no extrapolar.</p></div>`),

    deltas: d => `<div class="aviso" role="note" style="margin-top:0"><b>Δ almacenamiento aparente — no es extracción ni aportación</b>Diferencia de volumen entre cierres mensuales consecutivos; incluye extracción, aportaciones, evaporación e infiltración.</div>`
        + d.presas.map(p => {
            if (!p.deltas.length) return '';
            const anios = p.deltas[0].porAnio;
            const filas = p.deltas.map(f => `<tr><td>${esc(f.etiqueta)}</td>${f.porAnio.map(x => `<td class="${x.delta == null ? 'sd' : ''}">${firmado(x.delta, 1)}${x.base === 'primer-dia' ? '†' : ''}</td>`).join('')}</tr>`).join('');
            return `<h3 class="pr">${esc(p.nombre)}</h3><div class="fig"><h4>Δ mensual de volumen (Mm³)</h4>${svgBarrasDelta(p.deltas, { ancho: 680, alto: 260, unidad: 'Mm³' })}</div>`
                + `<table class="pct-t"><thead><tr><th>Mes</th>${anios.map(a => `<th>${esc(a.etiqueta)}</th>`).join('')}</tr></thead><tbody>${filas}</tbody></table><p class="nota">† Δ calculado contra el primer dato del mes (no hay cierre del mes anterior). S/D = sin dato; no equivale a 0.</p>`;
        }).join(''),

    calidad: d => porPresa(d, p => `<table><thead><tr><th>Año</th><th>Días esperados</th><th>Con dato</th><th>Sin dato</th><th>Cobertura</th><th>REVISAR / fuera de rango</th><th>Tramos sin dato</th></tr></thead><tbody>${filasCalidad(p, 5)}</tbody></table>${cajaAvisos(p.advertencias, 'Avisos de calidad')}`),

    limitaciones: () => lista(LIMITACIONES),

    tabla: d => porPresaBloque(d, (_p, b) => {
        // Periodos largos (> 92 días): muestreo semanal (días 1, 8, 15, 22 y fin de mes) para no imprimir cientos de filas.
        const muestreado = b.dias.length > 92;
        const finDeMes = (mes: number) => new Date(Date.UTC(2000, mes, 0)).getUTCDate();
        const filas = b.dias.map((dia, i) => ({ dia, vals: b.series.map(s => s.valores[i]) }))
            .filter(r => (!muestreado || [1, 8, 15, 22].includes(r.dia.dia) || r.dia.dia === finDeMes(r.dia.mes)) && r.vals.some(v => v != null));
        const cab = b.series.map(s => `<th>${esc(s.etiqueta)}${s.esBase ? ' (base)' : ''}${s.parcial ? ' · parcial' : ''}</th>`).join('');
        const cuerpo = filas.map(r => `<tr><td>${esc(r.dia.etiqueta)}</td>${r.vals.map(v => `<td class="${v == null ? 'sd' : ''}">${n(v, b.decimales)}</td>`).join('')}</tr>`).join('');
        return `<h4>${esc(b.nombre)} (${esc(b.unidad)}) — valores ${muestreado ? 'semanales' : 'diarios'}</h4><table class="anexo"><thead><tr><th>Día</th>${cab}</tr></thead><tbody>${cuerpo || `<tr><td colspan="${b.series.length + 1}" class="sd">S/D — sin datos en el periodo</td></tr>`}</tbody></table><p class="nota">${muestreado ? 'Periodo largo: se muestran los días 1, 8, 15, 22 y el último de cada mes; el detalle diario está en la descarga CSV de la página. ' : ''}Se omiten los días sin dato en todas las series. S/D = sin lectura.</p>`;
    }),
};

export function buildHTMLTecnico(d: DatosInforme, logo: string): string {
    const nombres = d.presas.map(p => p.nombre).join(' y ');
    const c = d.config;
    const metricas = c.metricas.map(m => METRICAS_INF.find(x => x.v === m)?.l ?? m).join(', ');
    const secs = seccionesOrdenadas(d);
    const tieneBloques = d.presas.some(p => p.bloques.length > 0);
    const filtros = [
        ['Presa(s)', nombres || 'S/D'],
        ['Periodo', etiquetaPeriodo(c.periodo, c.anioBase)],
        ['Año base', d.anios.find(a => a.esBase)?.etiqueta ?? 'S/D'],
        ['Años de comparación', d.anios.filter(a => !a.esBase).map(a => a.etiqueta).join(', ') || 'ninguno'],
        ['Métricas', metricas || 'S/D'],
        ['Serie', serieTxt(d)],
        ['Años parciales', c.incluirParciales ? 'incluidos en promedios, percentiles y tendencia' : 'excluidos de promedios, percentiles y tendencia (cobertura < 50 %)'],
        ['Secciones', secs.map(s => SECCIONES[s].etiqueta).join(' · ') || 'ninguna'],
        ['Generado', generadoTxt(d.generado)],
    ];
    const portada = `<div class="portada">${cabecera(logo, 'Informe Histórico de Presas', 'Análisis técnico')}<h1 class="gran">${esc(nombres || 'S/D')}</h1><div class="sub">${esc(d.periodoEtiqueta)} · ${aniosTxt(d)}</div>`
        + `<h4>Filtros aplicados</h4><table class="filtros"><tbody>${filtros.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`
        + cajaAvisos(d.advertencias)
        + (secs.includes('calidad') ? '' : cajaAvisos(d.presas.flatMap(p => p.advertencias.map(a => `${p.nombre}: ${a}`)), 'Avisos de calidad'))
        + `<p class="nota" style="margin-top:14px">Regla de lectura: S/D significa "sin dato", nunca cero. Los años parciales se rotulan con su cobertura.</p></div>`;

    let k = 0;
    const cuerpoSecs = secs.map(s => {
        const r = RENDER_TEC[s];
        if (!r) return '';
        // Secciones que dependen de métricas: sin bloques se omiten sin error.
        if (!tieneBloques && !['resumen', 'metodologia', 'calidad', 'limitaciones'].includes(s)) return '';
        let html = '';
        try { html = r(d); } catch { html = ''; }
        if (!html.trim()) return '';
        k++;
        const tabla = s === 'tabla' ? ' class="anexo-sec"' : '';
        return `<section${tabla}><h2>${k}. ${esc(SECCIONES[s].etiqueta)}</h2>${html}</section>`;
    }).join('');

    const pie = `<div class="fn">Informe generado por SICA 005 · SRL Unidad Conchos, Delicias. Los valores corresponden a la serie ${esc(serieTxt(d).toLowerCase())}; S/D = sin dato.</div>`;
    return documento('Informe Histórico de Presas — Técnico', CSS_TECNICO, `<main class="hoja">${portada}${cuerpoSecs}${pie}</main>`);
}
