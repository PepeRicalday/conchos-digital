/**
 * informeGeneralHtml — "Informe general del sistema" (botón "Generar reporte digital" del Dashboard).
 *
 * Documento HTML institucional, autónomo y PURO (strings): 6 hojas Carta con las mismas cifras que la pantalla, porque
 * parte del mismo `ModeloKpis`. Reglas: S/D nunca 0, el estado nunca va solo en color (símbolo + texto), el gasto solo
 * sale de mediciones vigentes (lo viejo se rotula "último aforo"), lo provisional se rotula, sin JS ni fuentes web.
 */
import type { ModeloKpis } from '../components/dashboard/PanelKpis';
import type { AlertaSistema } from './dashboardKpis';
import type { EstadoKpi, TipoEstado } from './dashboardKpisEjecutivos';
import type { EstadoNivel } from './controlEscalas';
import type { EscalaCanalKpi } from './perfilCanal';
import type { BandaHistorica } from './suficiencia';
import {
    bloqueFirmas, cabeceraInforme, cssInforme, documentoHtml, esc, fechaHoraLegible, folioInforme, pieInforme, tablaTrazabilidad, minificaCss,
} from './informeBase';
import { etiquetaEficiencia } from './conduccion';
import type { LogosData } from './logosInforme';

export interface ClimaInforme { tempMax: number | null; tempMin: number | null; vientoMax: number | null; estacionesValidas: number; estacionesTotal: number; excluidas: string[] }

export interface EntradaInformeGeneral {
    m: ModeloKpis;
    alertas: AlertaSistema[];
    veredicto: EstadoKpi;
    detalleVeredicto: string;
    protocolo: EstadoKpi | null;
    /** AAAA-MM-DD de la fecha elegida en el Dashboard. */
    fechaCorteISO: string;
    fechaCorteTexto: string;
    clima: ClimaInforme;
    /** Extracción total medida en presas (m³/s); null = S/D. */
    extraccionM3s: number | null;
    erroresPagina: string[];
    ahoraMs: number;
    emitido: Date;
    version?: string;
}

export const ANCHO_INFORME_GENERAL = 816;
export const HOJAS_INFORME_GENERAL = 6;

// ── Formato (S/D nunca 0) ────────────────────────────────────────────────────
const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const SD = '<span class="sd">S/D</span>';
const num = (v: number | null | undefined, d = 1): string => (fin(v) ? v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }) : SD);
const con = (v: number | null | undefined, d: number, u: string): string => (fin(v) ? `${num(v, d)}&nbsp;${u}` : SD);
const edad = (min: number | null | undefined): string => {
    if (!fin(min)) return 'S/D';
    if (min < 1) return 'ahora';
    if (min < 60) return `hace ${Math.round(min)} min`;
    if (min < 1440) { const h = Math.floor(min / 60); const r = Math.round(min - h * 60); return r ? `hace ${h} h ${r} min` : `hace ${h} h`; }
    return `hace ${Math.floor(min / 1440)} d`;
};
const hora = (iso: string | null | undefined): string => {
    const t = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(t)) return 'S/D';
    const d = new Date(t);
    return `${d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: 'America/Chihuahua' })} ${d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Chihuahua' })} h`;
};

const SIMBOLO: Record<TipoEstado, string> = { ok: '●', warn: '▲', crit: '■', info: '◆', sd: '○' };
/** Chip de estado: símbolo + texto (nunca solo color). */
const chip = (e: EstadoKpi): string => `<span class="chip e-${e.tipo}"><b aria-hidden="true">${SIMBOLO[e.tipo]}</b>${esc(e.texto)}</span>`;

const ESTADO_ESCALA: Record<EstadoNivel, { t: string; tipo: TipoEstado }> = {
    en_rango: { t: 'En rango', tipo: 'ok' }, bajo: { t: 'Bajo', tipo: 'warn' }, alto: { t: 'Alto', tipo: 'warn' }, vaciado: { t: 'Vaciado', tipo: 'info' },
    referencia: { t: 'Referencia', tipo: 'info' }, arrastre: { t: 'Arrastre', tipo: 'sd' }, stale: { t: 'Vencida', tipo: 'sd' }, sd: { t: 'Sin dato', tipo: 'sd' },
};
const GOES_TXT: Record<string, EstadoKpi> = {
    en_linea: { tipo: 'ok', texto: 'En línea' }, retraso: { tipo: 'warn', texto: 'Con retraso' }, sin_transmision: { tipo: 'crit', texto: 'Sin transmisión' }, sd: { tipo: 'sd', texto: 'Sin dato' },
};
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mesTexto = (m: string | null | undefined): string => (m && /^\d{4}-\d{2}/.test(m) ? `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : 'S/D');

// ── SVG ──────────────────────────────────────────────────────────────────────
/** Trazo con cortes en los huecos (null): un hueco nunca se une ni se vuelve 0. */
function trazo(valores: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
    let d = ''; let abierto = false;
    valores.forEach((v, i) => {
        if (!fin(v)) { abierto = false; return; }
        d += `${abierto ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; abierto = true;
    });
    return d;
}

function svgSerie(valores: (number | null)[], etiquetas: string[], unidad: string, color: string): string {
    const con = valores.filter(fin);
    if (con.length < 2) return `<div class="vacio-fig">Sin serie suficiente (${con.length} de ${valores.length} días con lectura)</div>`;
    const W = 330, H = 150, pl = 40, pr = 22, pt = 18, pb = 22;
    const lo = Math.min(...con), hi = Math.max(...con), pad = (hi - lo || Math.abs(hi) * 0.02 || 1) * 0.15;
    const mn = lo - pad, mx = hi + pad;
    const x = (i: number) => pl + (i / Math.max(1, valores.length - 1)) * (W - pl - pr);
    const y = (v: number) => pt + (1 - (v - mn) / (mx - mn)) * (H - pt - pb);
    const pts = valores.map((v, i) => (fin(v) ? `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6" fill="${color}"/>` : '')).join('');
    const ticks = [mn + pad, (mn + mx) / 2, mx - pad].map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#e5e2db" stroke-width=".6"/><text x="${pl - 4}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#57606a">${Math.round(v)}</text>`).join('');
    const xs = valores.map((_, i) => (i % Math.ceil(valores.length / 7) === 0 || i === valores.length - 1 ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === valores.length - 1 ? 'end' : 'middle'}" font-size="9.5" fill="#57606a">${esc(etiquetas[i] ?? '')}</text>` : '')).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Serie de ${esc(unidad)} de los últimos ${valores.length} días"><text x="2" y="8" font-size="9.5" fill="#57606a">${esc(unidad)}</text>${ticks}<path d="${trazo(valores, x, y)}" fill="none" stroke="${color}" stroke-width="1.8"/>${pts}${xs}</svg>`;
}

function svgBanda(b: BandaHistorica): string {
    const n = b.actual.length;
    const todos = [...b.min, ...b.max, ...b.mediana, ...b.actual].filter(fin);
    if (n < 2 || !todos.length) return '<div class="vacio-fig">Sin base histórica suficiente</div>';
    const W = 330, H = 165, pl = 36, pr = 10, pt = 18, pb = 20;
    const mx = Math.max(...todos) * 1.05, mn = Math.min(0, ...todos);
    const x = (i: number) => pl + (i / (n - 1)) * (W - pl - pr);
    const y = (v: number) => pt + (1 - (v - mn) / (mx - mn)) * (H - pt - pb);
    const area: string[] = []; const rev: string[] = [];
    for (let i = 0; i < n; i++) if (fin(b.min[i]) && fin(b.max[i])) { area.push(`${x(i).toFixed(1)},${y(b.max[i] as number).toFixed(1)}`); rev.unshift(`${x(i).toFixed(1)},${y(b.min[i] as number).toFixed(1)}`); }
    const hoy = Math.min(n - 1, Math.max(0, b.diaHoy));
    const ticks = [0, 0.5, 1].map((f) => { const v = mn + (mx - mn) * f; return `<line x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#e5e2db" stroke-width=".6"/><text x="${pl - 4}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#57606a">${Math.round(v)}</text>`; }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Almacenamiento del ciclo frente a ${b.ciclosUsados} ciclos anteriores"><text x="2" y="8" font-size="9.5" fill="#57606a">Mm³</text>${ticks}<polygon points="${[...area, ...rev].join(' ')}" fill="#efe3e3" stroke="none"/><path d="${trazo(b.mediana, x, y)}" fill="none" stroke="#9a8585" stroke-width="1.2" stroke-dasharray="4 3"/><path d="${trazo(b.actual, x, y)}" fill="none" stroke="#0B3170" stroke-width="2"/><line x1="${x(hoy).toFixed(1)}" x2="${x(hoy).toFixed(1)}" y1="${pt}" y2="${H - pb}" stroke="#1f2328" stroke-width=".8" stroke-dasharray="2 2"/><text x="${x(hoy).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="9.5" fill="#1f2328">hoy</text>${hoy > n * 0.12 ? `<text x="${pl}" y="${H - 6}" font-size="9.5" fill="#57606a">1-oct</text>` : ''}<text x="${W - pr}" y="${H - 6}" text-anchor="end" font-size="9.5" fill="#57606a">30-sep</text></svg>`;
}

/** Perfil del canal: una marca por escala sobre K-0 → K-104; el estado se lee por la FORMA (no solo por color). */
function svgPerfilCanal(esc14: EscalaCanalKpi[]): string {
    const W = 680, H = 118, pl = 30, pr = 30, base = 94;
    const x = (km: number) => pl + (km / 104) * (W - pl - pr);
    const y = (u: number) => 18 + (1 - Math.max(-0.2, Math.min(1.2, u))) * 52; // 0 = mínimo operativo, 1 = máximo
    const marcas = esc14.map((e) => {
        const cx = x(e.km);
        const rot = `<text x="${cx.toFixed(1)}" y="${base + 14}" text-anchor="middle" font-size="10">${Math.round(e.km)}</text>`;
        if (e.origen === 'campo' && e.u != null) {
            const f = e.vigente ? '#0B3170' : '#fff';
            return `<circle cx="${cx.toFixed(1)}" cy="${y(e.u).toFixed(1)}" r="4.6" fill="${f}" stroke="#0B3170" stroke-width="1.6"/>${e.vigente ? '' : `<line x1="${(cx - 3).toFixed(1)}" x2="${(cx + 3).toFixed(1)}" y1="${y(e.u).toFixed(1)}" y2="${y(e.u).toFixed(1)}" stroke="#0B3170" stroke-width="1.2"/>`}<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${(y(e.u) + 5).toFixed(1)}" y2="${base}" stroke="#d6d1c7" stroke-width=".6" stroke-dasharray="2 2"/>${rot}`;
        }
        const ref = e.referencia ? `<rect x="${(cx - 4).toFixed(1)}" y="${base - 4}" width="8" height="8" fill="none" stroke="#57606a" stroke-width="1.2"/>` : `<path d="M${(cx - 4).toFixed(1)} ${base - 4}l8 8m0-8l-8 8" stroke="#6a737d" stroke-width="1.4"/>`;
        return `${ref}${rot}`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Perfil del canal: posición del nivel de cada escala dentro de su rango operativo"><rect x="${pl}" y="${y(1).toFixed(1)}" width="${W - pl - pr}" height="${(y(0) - y(1)).toFixed(1)}" fill="#E6EEF8" stroke="#e6d3d3"/><text x="${pl + 4}" y="${(y(1) + 9).toFixed(1)}" font-size="10" fill="#0B3170">máx. operativo</text><text x="${pl + 4}" y="${(y(0) - 3).toFixed(1)}" font-size="10" fill="#0B3170">mín. operativo</text><line x1="${pl}" x2="${W - pr}" y1="${base}" y2="${base}" stroke="#57606a" stroke-width="1"/>${marcas}<text x="${pl - 4}" y="${base + 14}" text-anchor="end" font-size="10" fill="#57606a">km</text></svg>`;
}

function svgDemanda(horas: { etoMm: number | null; lluviaMm: number | null }[]): string {
    if (!horas.length) return '<div class="vacio-fig">Sin pronóstico horario</div>';
    const W = 330, H = 135, pl = 30, pr = 6, pt = 18, pb = 18;
    const mx = Math.max(0.1, ...horas.map((h) => Math.max(h.etoMm ?? 0, h.lluviaMm ?? 0))) * 1.1;
    const bw = (W - pl - pr) / horas.length;
    const y = (v: number) => pt + (1 - v / mx) * (H - pt - pb);
    const bars = horas.map((h, i) => {
        const e = fin(h.etoMm) ? `<rect x="${(pl + i * bw + 0.5).toFixed(1)}" y="${y(h.etoMm).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${(H - pb - y(h.etoMm)).toFixed(1)}" fill="#b98a2e"/>` : '';
        const l = fin(h.lluviaMm) && h.lluviaMm > 0 ? `<rect x="${(pl + i * bw + 0.5).toFixed(1)}" y="${y(h.lluviaMm).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${(H - pb - y(h.lluviaMm)).toFixed(1)}" fill="#2d6cb0" opacity=".85"/>` : '';
        return e + l;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="ETo y lluvia previstas por hora, próximas 24 horas"><text x="2" y="8" font-size="9.5" fill="#57606a">mm/h</text><line x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}" stroke="#57606a" stroke-width=".8"/><text x="${pl - 3}" y="${pt + 6}" text-anchor="end" font-size="9.5" fill="#57606a">${mx.toFixed(1)}</text>${bars}<text x="${pl}" y="${H - 4}" font-size="9.5" fill="#57606a">ahora</text><text x="${W - pr}" y="${H - 4}" text-anchor="end" font-size="9.5" fill="#57606a">+24 h</text></svg>`;
}

function svgNdvi(serie: (number | null)[], mesFin: string | null): string {
    const v = serie.filter(fin);
    if (v.length < 2) return '<div class="vacio-fig">Sin serie mensual suficiente</div>';
    const W = 330, H = 135, pl = 32, pr = 10, pt = 18, pb = 20;
    const mn = 0, mx = Math.max(0.8, ...v);
    const x = (i: number) => pl + (i / (serie.length - 1)) * (W - pl - pr);
    const y = (n: number) => pt + (1 - (n - mn) / (mx - mn)) * (H - pt - pb);
    const pts = serie.map((s, i) => (fin(s) ? `<circle cx="${x(i).toFixed(1)}" cy="${y(s).toFixed(1)}" r="2.4" fill="#4d7a3a"/>` : '')).join('');
    const ticks = [0, 0.4, 0.8].map((t) => `<line x1="${pl}" x2="${W - pr}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="#e5e2db" stroke-width=".6"/><text x="${pl - 4}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#57606a">${t.toFixed(1)}</text>`).join('');
    const ini = mesFin ? (() => { const i = Number(mesFin.slice(0, 4)) * 12 + Number(mesFin.slice(5, 7)) - 1 - (serie.length - 1); return `${MESES[((i % 12) + 12) % 12]} ${Math.floor(i / 12)}`; })() : '';
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="NDVI promedio mensual, últimos ${serie.length} meses"><text x="2" y="8" font-size="9.5" fill="#57606a">NDVI</text>${ticks}<path d="${trazo(serie, x, y)}" fill="none" stroke="#4d7a3a" stroke-width="1.8"/>${pts}<text x="${pl}" y="${H - 5}" font-size="9.5" fill="#57606a">${esc(ini)}</text><text x="${W - pr}" y="${H - 5}" text-anchor="end" font-size="9.5" fill="#57606a">${esc(mesTexto(mesFin))}</text></svg>`;
}

// ── Hojas ────────────────────────────────────────────────────────────────────
const kpi = (et: string, v: string, s: string, e?: EstadoKpi): string =>
    `<div class="kpi"><div class="et">${esc(et)}</div><div class="v">${v}</div><div class="s">${s}</div>${e ? `<div class="k-est">${chip(e)}</div>` : ''}</div>`;

const bloque = (titulo: string, cuerpo: string, nota?: string): string =>
    `<section class="bl"><h3>${esc(titulo)}</h3>${cuerpo}${nota ? `<p class="fuente">${nota}</p>` : ''}</section>`;

const dl = (filas: [string, string][]): string => `<dl class="dl">${filas.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;

const recorta = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const SEV: Record<string, { t: string; tipo: TipoEstado }> = { critical: { t: 'Crítica', tipo: 'crit' }, warning: { t: 'Aviso', tipo: 'warn' }, info: { t: 'Informativa', tipo: 'info' } };

function alertasVisibles(a: AlertaSistema[]): AlertaSistema[] {
    const peso = (x: AlertaSistema) => (x.type === 'critical' ? 0 : x.type === 'warning' ? 1 : 2) + (x.antigua ? 3 : 0);
    return a.filter((x) => x.id !== 'ok').sort((p, q) => peso(p) - peso(q));
}

function hojaResumen(d: EntradaInformeGeneral): string {
    const { m } = d;
    const cm = m.canal.modelo;
    const sf = m.suficiencia;
    const cv = m.confianza;
    const d24 = m.demanda.d24;
    const nd = m.ndvi.r && m.ndvi.r.mes ? m.ndvi.r : null;
    const enLinea = m.goes.estaciones.filter((g) => g.clave === 'en_linea' || g.clave === 'retraso').length;
    const al = m.alertas.resumen;
    const eficiencia = cm.conduccion.eficienciaPct;
    const estCanal: EstadoKpi = eficiencia != null ? { tipo: etiquetaEficiencia(eficiencia) === 'Óptima' ? 'ok' : etiquetaEficiencia(eficiencia) === 'Aceptable' ? 'warn' : 'crit', texto: `Eficiencia ${etiquetaEficiencia(eficiencia)}` }
        : cm.conMedicion === 0 ? { tipo: 'sd', texto: 'Sin medición vigente' } : { tipo: 'info', texto: 'Eficiencia S/D' };
    const estAl: EstadoKpi = al.criticas > 0 ? { tipo: 'crit', texto: `${al.criticas} crítica${al.criticas === 1 ? '' : 's'}` } : al.avisos > 0 ? { tipo: 'warn', texto: 'Con avisos' } : { tipo: 'ok', texto: 'Sin alertas' };
    const estGoes: EstadoKpi = !m.goes.cargado || m.goes.error ? { tipo: 'sd', texto: 'Sin lectura' } : enLinea === 0 ? { tipo: 'crit', texto: 'Sin transmisión' } : enLinea < m.goes.estaciones.length ? { tipo: 'warn', texto: 'Parcial' } : { tipo: 'ok', texto: 'En línea' };
    const estDem: EstadoKpi = d24 && d24.netaMm != null && !d24.viejo ? { tipo: d24.netaMm < 2 ? 'ok' : d24.netaMm <= 5 ? 'info' : 'warn', texto: d24.netaMm < 2 ? 'Baja' : d24.netaMm <= 5 ? 'Media' : 'Alta' } : { tipo: 'sd', texto: d24?.viejo ? 'Pronóstico vencido' : 'S/D' };

    const atencion = alertasVisibles(d.alertas).filter((a) => a.type !== 'info' && !a.antigua).slice(0, 4);
    const lista = atencion.length
        ? `<ul class="atn">${atencion.map((a) => `<li>${chip({ tipo: SEV[a.type].tipo, texto: SEV[a.type].t })} <b>${esc(a.title)}</b> <span>${esc(recorta(a.message, 120))}</span></li>`).join('')}</ul>${alertasVisibles(d.alertas).filter((a) => a.type !== 'info' && !a.antigua).length > 4 ? `<p class="fuente">Más alertas en la hoja 4.</p>` : ''}`
        : '<p>Sin alertas críticas ni avisos vigentes.</p>';

    const fuentes = cv.fuentes.map((f) => `<li>${chip(f.ok === null ? { tipo: 'sd', texto: 'Consultando' } : f.ok ? { tipo: 'ok', texto: 'Vigente' } : { tipo: 'crit', texto: 'Sin dato vigente' })} <b>${esc(f.nombre)}</b></li>`).join('');

    const frase = [
        m.presas.pct != null ? `Las presas están al <b>${num(m.presas.pct)} %</b> de su capacidad${sf.utilTotalMm3 != null ? `, con <b>${num(sf.utilTotalMm3, 0)} Mm³</b> útiles` : ''}.` : 'El almacenamiento de las presas es S/D.',
        m.ciclo.entregadoPct != null ? `El ciclo ${esc(m.ciclo.avance.etiqueta ?? '')} entregó el <b>${num(m.ciclo.entregadoPct)} %</b> del volumen autorizado${m.ciclo.avance.concluido ? ' (ciclo concluido)' : ''}.` : '',
        `El canal tiene <b>${cm.conMedicion} de ${cm.total}</b> escalas con medición vigente.`,
        `Confianza de los datos: <b>${cv.pct != null ? `${num(cv.pct, 0)} %` : 'S/D'}</b>${cv.caidas.length ? ` (sin dato vigente: ${esc(cv.caidas.join(', '))})` : ''}.`,
    ].filter(Boolean).join(' ');

    return `<div class="banda"><small>Centro de control · corte ${esc(d.fechaCorteTexto)}${d.m.enVivoFuera ? ' (fecha histórica: Canal, Clima y Alertas son de ahora)' : ''}</small>
<h1>Informe general del sistema</h1><div class="sub">Distrito de Riego 005 Delicias · S R L Unidad Conchos</div></div>
<div class="veredicto">${chip(d.veredicto)}<span>${esc(d.detalleVeredicto)}</span>${d.protocolo ? `<span class="prot">${chip(d.protocolo)}</span>` : ''}</div>
<p class="frase">${frase}</p>
<div class="kpis">
${kpi('Presas', `${num(m.presas.pct)}<small> %</small>`, `${m.presas.almacenadoMm3 != null ? `${num(m.presas.almacenadoMm3, 0)} / ${num(m.presas.capacidadMm3, 0)} Mm³` : 'Sin lectura'}`, m.presas.estado)}
${kpi(sf.modo === 'preciclo' ? 'Suficiencia · útil' : 'Suficiencia · alcance', sf.modo === 'preciclo' ? `${num(sf.utilTotalMm3, 0)}<small> Mm³</small>` : `${num(sf.diasAlcance, 0)}<small> d</small>`, sf.cobertura != null ? `cobertura ${num(sf.cobertura, 1)}× (ref. provisional)` : 'sin cobertura calculable', sf.estado)}
${kpi(`Ciclo ${m.ciclo.avance.etiqueta ?? ''}`.trim(), `${num(m.ciclo.entregadoPct)}<small> %</small>`, m.ciclo.autMm3 != null && m.ciclo.acumMm3 != null ? `${num(m.ciclo.acumMm3, 0)} de ${num(m.ciclo.autMm3, 0)} Mm³` : 'sin volumen autorizado', m.ciclo.brecha.estado)}
${kpi('Canal K-0 → K-104', `${cm.conMedicion}<small> de ${cm.total}</small>`, eficiencia != null ? `eficiencia ${num(eficiencia, 1)} %` : 'escalas con medición vigente', estCanal)}
${kpi('Alertas', `${al.accionables}`, `${al.criticas} críticas · ${al.avisos} avisos · ${al.informativas} info`, estAl)}
${kpi('Demanda 24 h', `${num(d24 && !d24.viejo ? d24.netaMm : null, 1)}<small> mm</small>`, d24 && !d24.viejo && d24.eto24Mm != null ? `ETo ${num(d24.eto24Mm, 1)} − lluvia ef. ${num(d24.lluviaEfectivaMm, 1)}` : 'sin pronóstico vigente', estDem)}
${kpi('Vegetación NDVI', `${num(nd?.valor, 3)}`, nd ? `${mesTexto(nd.mes)} · anomalía ${nd.anomalia != null ? `${nd.anomalia >= 0 ? '+' : ''}${num(nd.anomalia, 3)}` : 'S/D'}` : 'sin lectura', m.ndvi.error ? { tipo: 'sd', texto: 'Sin lectura' } : nd?.anomalia == null ? { tipo: 'sd', texto: 'Sin referencia' } : nd.anomalia < -0.05 ? { tipo: 'warn', texto: 'Bajo lo normal' } : nd.anomalia > 0.05 ? { tipo: 'ok', texto: 'Sobre lo normal' } : { tipo: 'ok', texto: 'Normal' })}
${kpi('Telemetría GOES', `${enLinea}<small> de ${m.goes.estaciones.length}</small>`, 'estaciones transmitiendo', estGoes)}
</div>
<div class="cols"><section class="bl"><h3>Lo que requiere atención</h3>${lista}</section>
<section class="bl"><h3>Confianza de los datos · ${cv.pct != null ? `${num(cv.pct, 0)} %` : 'S/D'}</h3><ul class="fuentes">${fuentes}</ul><p class="fuente">${cv.vigentes} de ${cv.total} fuentes con dato vigente.</p></section></div>`;
}

function hojaAgua(d: EntradaInformeGeneral): string {
    const { m } = d;
    const sf = m.suficiencia;
    const pctDe = (nombre: string) => m.presas.items.find((i) => i.nombre === nombre)?.pct ?? null;
    const filas = sf.presas.map((p) => `<tr><td>${esc(p.nombre)}</td><td class="n">${num(p.almacenadoMm3, 1)}</td><td class="n">${num(p.capacidadMm3, 0)}</td><td class="n">${num(pctDe(p.nombre), 1)}</td><td class="n">${num(p.muertoMm3, 1)}${p.muertoMm3 != null && !p.muertoOficial ? ' <em>est.</em>' : ''}</td><td class="n"><b>${num(p.utilMm3, 1)}</b></td></tr>`).join('');
    const tot = `<tr class="tot"><td>Total</td><td class="n">${num(sf.almacenadoTotalMm3, 1)}</td><td class="n">${num(m.presas.capacidadMm3, 0)}</td><td class="n">${num(m.presas.pct, 1)}</td><td class="n">${num(sf.muertoTotalMm3, 1)}</td><td class="n"><b>${num(sf.utilTotalMm3, 1)}</b></td></tr>`;
    const hoy = d.fechaCorteISO;
    const etiquetas = m.presas.serie.map((_, i) => { const t = Date.parse(`${hoy}T12:00:00Z`) - (m.presas.serie.length - 1 - i) * 86_400_000; const f = new Date(t); return `${f.getUTCDate()} ${MESES[f.getUTCMonth()]}`; });
    const b = sf.banda;
    const posTxt = b?.posicion ? `${b.posicion.posicion}.º más bajo de ${b.posicion.de} años` : 'sin posición histórica';
    return `<div class="titulo-h"><h2><span class="n">1</span>Agua: presas y suficiencia</h2></div>
${bloque('Almacenamiento por presa (Mm³)', `<table><thead><tr><th>Presa</th><th class="n">Almacenado</th><th class="n">Capacidad</th><th class="n">Llenado %</th><th class="n">V. muerto</th><th class="n">Útil</th></tr></thead><tbody>${filas}${tot}</tbody></table>`,
        `Útil = almacenado − volumen muerto. ${m.presas.conDato} de ${m.presas.total} presas con lectura${m.presas.frescura ? ` · ${esc(m.presas.frescura)}` : ''}${m.presas.stale ? ' · <b>lectura vencida</b>' : ''}. “est.” = piso de la curva, no es un muerto oficial. Un total con una presa sin lectura se muestra S/D, nunca como suma parcial.`)}
<div class="cols">
${bloque('Almacenamiento total, últimos 7 días', svgSerie(m.presas.serie, etiquetas, 'Mm³', '#0B3170'), `${esc(m.presas.tendencia.texto)}.`)}
${bloque(`Ciclo actual frente a ${b?.ciclosUsados ?? 0} ciclos anteriores`, b ? svgBanda(b) : '<div class="vacio-fig">Sin base histórica suficiente</div>', 'Banda = mínimo–máximo histórico; línea punteada = mediana; línea continua = ciclo actual.')}
</div>
${bloque('Suficiencia', dl([
        ['Volumen útil total', con(sf.utilTotalMm3, 1, 'Mm³')],
        ['Posición histórica', b?.posicion ? esc(posTxt) : SD],
        ['Frente a la mediana', b?.vsMedianaPct != null ? `${num(b.vsMedianaPct, 0)} %` : SD],
        ['Demanda de referencia', `${con(sf.demanda.mm3, 0, 'Mm³')}${sf.demanda.provisional ? ' <em>(provisional)</em>' : ''}`],
        ['Cobertura (útil / demanda)', sf.cobertura != null ? `${num(sf.cobertura, 2)}× <em>(umbrales provisionales: ≥1.5 suficiente, <1.0 crítico)</em>` : SD],
        ['Extracción medida', con(d.extraccionM3s, 1, 'm³/s')],
        ...(sf.modo === 'temporada' ? [['Días que alcanza / que faltan', `${num(sf.diasAlcance, 0)} / ${num(sf.diasRestantes, 0)}`] as [string, string]] : []),
    ]) + `<div class="est-lin">${chip(sf.estado)}</div>${sf.aviso.length ? `<ul class="avisos">${sf.aviso.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}`)}`;
}

function hojaCanal(d: EntradaInformeGeneral): string {
    const { m } = d;
    const cm = m.canal.modelo;
    const c = cm.conduccion;
    const filas = cm.escalas.map((e) => {
        const es = ESTADO_ESCALA[e.estado];
        const nivel = e.nivelM != null ? `${num(e.nivelM, 2)}` : e.nivelArrastreM != null ? `<span class="sd">${num(e.nivelArrastreM, 2)} (arr.)</span>` : SD;
        const rango = e.rangoMin != null && e.rangoMax != null ? `${num(e.rangoMin, 2)}–${num(e.rangoMax, 2)}` : SD;
        const gasto = e.referencia ? '<span class="sd">referencia</span>' : e.gastoM3s != null ? (e.vigente ? num(e.gastoM3s, 2) : `<span class="sd">${num(e.gastoM3s, 2)} (viejo)</span>`) : SD;
        return `<tr><td>${esc(e.nombre)}</td><td class="n">${e.km.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}</td><td class="n">${nivel}</td><td class="n">${rango}</td><td>${chip({ tipo: es.tipo, texto: es.t })}</td><td>${e.medicionMs != null ? edad(e.edadMin) : 'S/D'}</td><td class="n">${gasto}</td></tr>`;
    }).join('');
    const ext = (titulo: string, x: typeof cm.k0) => `<div class="kpi"><div class="et">${esc(titulo)}</div><div class="v">${x.gasto != null ? `${num(x.gasto, 2)}<small> m³/s</small>` : SD}</div><div class="s">${x.gasto != null ? 'medición vigente' : x.ultimoAforoM3s != null ? `último aforo ${num(x.ultimoAforoM3s, 2)} m³/s · ${edad(x.ultimoAforoMs != null ? (d.ahoraMs - x.ultimoAforoMs) / 60000 : null)}` : 'sin aforo en la ventana'}</div></div>`;
    const efi = c.eficienciaPct != null && !c.incoherente ? `${num(c.eficienciaPct, 1)}<small> %</small>` : SD;
    return `<div class="titulo-h"><h2><span class="n">2</span>Canal: niveles, gastos y eficiencia</h2></div>
${cm.vaciado ? '<p class="aviso"><b>Protocolo de vaciado activo:</b> el rango operativo de riego no aplica; no se califican niveles “fuera de rango”.</p>' : ''}
<div class="kpis kpis3">${ext('Gasto K-0+000 (entrada)', cm.k0)}${ext('Gasto K-104 (salida)', cm.k104)}${kpi('Eficiencia de conducción', efi, c.perdidaM3s != null && !c.incoherente ? `pérdida ${num(c.perdidaM3s, 2)} m³/s (${num(c.perdidaPct, 1)} %)` : c.incoherente ? 'salida > entrada: revisar aforos' : 'requiere K-0 y K-104 vigentes', { tipo: c.eficienciaPct == null ? 'sd' : etiquetaEficiencia(c.eficienciaPct) === 'Óptima' ? 'ok' : etiquetaEficiencia(c.eficienciaPct) === 'Aceptable' ? 'warn' : 'crit', texto: c.eficienciaPct == null ? 'S/D' : etiquetaEficiencia(c.eficienciaPct) })}</div>
${bloque('Perfil longitudinal K-0 → K-104', svgPerfilCanal(cm.escalas), '● medición vigente (≤ 4 h) · ◐ medición vencida · ✕ sin medición de campo · □ escala de referencia. Altura = posición del nivel dentro de su rango operativo.')}
${bloque(`Escalas del canal · ${cm.conMedicion} de ${cm.total} con medición vigente`, `<table class="compacta"><thead><tr><th>Escala</th><th class="n">km</th><th class="n">Nivel (m)</th><th class="n">Rango op. (m)</th><th>Estado</th><th>Medición</th><th class="n">Gasto m³/s</th></tr></thead><tbody>${filas}</tbody></table>`,
        'Estado por medición de campo; el arrastre de continuidad no cuenta como medición. K-64 y K-94+200 son escalas de referencia: sin compuertas ni gasto.')}`;
}

/** Hoja de distribución: módulos, ciclo agrícola y alertas. */
function hojaDistribucion(d: EntradaInformeGeneral): string {
    const { m } = d;
    const mods = m.modulos.map((x) => `<tr><td>${esc(x.nombre)}</td><td class="n">${num(x.pct, 1)}</td><td><div class="barra"><i style="width:${x.pct == null ? 0 : Math.max(0, Math.min(100, x.pct))}%"></i></div></td><td>${chip(x.estado)}</td></tr>`).join('');
    const ci = m.ciclo;
    return `<div class="titulo-h"><h2><span class="n">3</span>Distribución, ciclo y alertas</h2></div>
<div class="cols">
${bloque(`Cumplimiento por módulo · ciclo ${esc(ci.avance.etiqueta ?? '')}`, `<table class="compacta"><thead><tr><th>Módulo</th><th class="n">Entregado %</th><th>Avance</th><th>Estado</th></tr></thead><tbody>${mods}</tbody></table>`)}
${bloque('Ciclo agrícola', dl([
        ['Volumen entregado', ci.acumMm3 != null ? con(ci.acumMm3, 1, 'Mm³') : SD],
        ['Volumen autorizado', con(ci.autMm3, 1, 'Mm³')],
        ['Entregado / autorizado', ci.entregadoPct != null ? `${num(ci.entregadoPct, 1)} %` : SD],
        ['Avance del calendario', ci.avance.pct != null ? `${num(ci.avance.pct, 0)} %${ci.avance.concluido ? ' (concluido)' : ''}` : SD],
        ['Brecha vs calendario', ci.brecha.brechaPP != null ? `${ci.brecha.brechaPP >= 0 ? '+' : ''}${num(ci.brecha.brechaPP, 1)} pp` : '<span class="sd">no aplica</span>'],
    ]) + `<div class="est-lin">${chip(ci.brecha.estado)}</div>`)}
</div>
${alertasBloque(d)}`;
}

function hojaClima(d: EntradaInformeGeneral): string {
    const { m } = d;
    const d24 = m.demanda.d24;
    const med = m.demanda.medido;
    const nd = m.ndvi.r && m.ndvi.r.mes ? m.ndvi.r : null;
    const dem = d24 && !d24.viejo ? dl([
        ['Demanda neta prevista', `<b>${con(d24.netaMm, 1, 'mm')}</b>${d24.rangoMm ? ` <span class="sd">(${num(d24.rangoMm.min, 1)}–${num(d24.rangoMm.max, 1)})</span>` : ''}`],
        ['ETo prevista 24 h', con(d24.eto24Mm, 1, 'mm')],
        ['Lluvia prevista / efectiva', `${con(d24.lluvia24Mm, 1, 'mm')} / ${con(d24.lluviaEfectivaMm, 1, 'mm')}`],
        ['Prob. máx. de lluvia', d24.probMaxPct != null ? `${num(d24.probMaxPct, 0)} %` : SD],
        ['Ventana libre de viento', d24.ventanaLibreHoras != null ? `${num(d24.ventanaLibreHoras, 0)} h de 24` : SD],
        ['Estaciones usadas', `${d24.estacionesUsadas} de ${d24.estacionesTotal}`],
        ['Corrida del pronóstico', `${hora(d24.corridaEn)} · ${edad(d24.edadMin)}`],
    ]) : `<p class="aviso">${d24?.viejo ? `El pronóstico tiene ${edad(d24.edadMin)} y ya no se afirma.` : 'Sin pronóstico horario disponible.'}</p>`;
    const goes = m.goes.estaciones.length
        ? `<table class="compacta"><thead><tr><th>Estación</th><th>Estado del enlace</th><th>Última señal</th></tr></thead><tbody>${m.goes.estaciones.map((g) => `<tr><td>${esc(g.nombre.split(' - ')[0])}</td><td>${chip(GOES_TXT[g.clave] ?? GOES_TXT.sd)}</td><td>${edad(g.edadMin)}</td></tr>`).join('')}</tbody></table>`
        : `<p class="aviso">${m.goes.error ? `No se pudo leer la telemetría: ${esc(m.goes.error)}` : 'Sin estaciones registradas o aún consultando.'}</p>`;
    return `<div class="titulo-h"><h2><span class="n">4</span>Clima, cultivos y sensores</h2></div>
<div class="cols">
${bloque('Demanda de riego · próximas 24 h', dem + (d24 && !d24.viejo ? svgDemanda(d24.horas) : ''), 'Neta = ETo prevista − lluvia efectiva (la lluvia cuenta solo con probabilidad ≥ 60 %). Umbrales de clasificación provisionales.')}
<div>
${bloque('Clima medido (red de estaciones)', dl([
        ['Estaciones válidas', `${d.clima.estacionesValidas} de ${d.clima.estacionesTotal}`],
        ['Temp. máx. / mín.', `${con(d.clima.tempMax, 1, '°C')} / ${con(d.clima.tempMin, 1, '°C')}`],
        ['Viento máximo', con(d.clima.vientoMax, 1, 'm/s')],
        ['ETo / lluvia del día', `${con(med.etoMm, 1, 'mm')} / ${con(med.lluviaMm, 1, 'mm')}`],
        ['Demanda neta medida', con(med.d.netaMm, 1, 'mm')],
        ['Última observación', hora(med.ultimaObs)],
    ]), d.clima.excluidas.length ? `Excluidas por sospechosas o sin señal: ${esc(d.clima.excluidas.join(', '))}.` : undefined)}
</div></div>
<div class="cols">
${bloque(`Vegetación · NDVI ${nd ? mesTexto(nd.mes) : ''}`, (nd ? dl([
        ['NDVI promedio', `<b>${num(nd.valor, 3)}</b> (${nd.nModulos} módulos con dato)`],
        ['Anomalía vs años anteriores', nd.anomalia != null ? `${nd.anomalia >= 0 ? '+' : ''}${num(nd.anomalia, 3)} (${nd.aniosRef} años de referencia)` : SD],
        ['Módulo más bajo / más alto', `${nd.peor ? `M${nd.peor.modulo} ${num(nd.peor.valor, 3)}` : 'S/D'} / ${nd.mejor ? `M${nd.mejor.modulo} ${num(nd.mejor.valor, 3)}` : 'S/D'}`],
    ]) : '<p class="aviso">Sin lectura de NDVI.</p>') + (nd ? svgNdvi(nd.serieMensual, nd.mes) : ''), 'Sentinel-2, promedio de módulos por mes.')}
${bloque(`Telemetría GOES · ${m.goes.estaciones.filter((g) => g.clave === 'en_linea' || g.clave === 'retraso').length} de ${m.goes.estaciones.length} transmitiendo`, goes, 'Sin transmisión ≠ gasto cero: sus gastos se muestran S/D hasta que vuelva la señal.')}
</div>`;
}

/** Tabla de alertas vigentes (las más severas primero). */
function alertasBloque(d: EntradaInformeGeneral): string {
    const todas = alertasVisibles(d.alertas);
    const MAX = 6;
    const vistas = todas.slice(0, MAX);
    const filas = vistas.map((a) => `<tr class="${a.antigua ? 'ant' : ''}"><td>${chip({ tipo: SEV[a.type].tipo, texto: SEV[a.type].t })}${a.antigua ? '<br><em>antigua</em>' : ''}</td><td><b>${esc(a.title)}</b><br><span>${esc(recorta(a.message, 130))}</span>${a.accion ? `<br><em>Acción: ${esc(a.accion)}</em>` : ''}</td><td>${esc(a.categoria ?? '—')}</td><td>${esc(hora(a.detectadaEn ?? a.timestamp))}</td></tr>`).join('');
    const al = d.m.alertas.resumen;
    const tabla = todas.length
        ? `<table class="compacta alertas"><thead><tr><th>Severidad</th><th>Alerta</th><th>Categoría</th><th>Detectada</th></tr></thead><tbody>${filas}</tbody></table>${todas.length > MAX ? `<p class="fuente">Se muestran ${MAX} de ${todas.length} alertas, ordenadas por severidad; el resto está en la pantalla Alertas.</p>` : ''}`
        : '<p>Sin alertas registradas.</p>';
    return bloque(`Alertas · ${al.criticas} críticas · ${al.avisos} avisos · ${al.informativas} informativas${al.antiguas ? ` · ${al.antiguas} antiguas` : ''}`, tabla);
}

/** Anexo: trazabilidad, límites del informe y firmas. */
function hojaAnexo(d: EntradaInformeGeneral, folio: string): string {
    return `<div class="titulo-h"><h2><span class="n">5</span>Anexo: trazabilidad y límites</h2></div>
${bloque('Trazabilidad y límites del informe', tablaTrazabilidad([
        { k: 'Folio', v: folio },
        { k: 'Emisión', v: fechaHoraLegible(d.emitido) },
        { k: 'Fecha de corte', v: `${d.fechaCorteTexto}${d.m.enVivoFuera ? ' (histórica)' : ' (en vivo)'}` },
        { k: 'Versión del sistema', v: d.version ? `SICA 005 v${d.version}` : 'S/D' },
        { k: 'Fuentes', v: 'Presas (lecturas_presas, curva de capacidad), escalas (lecturas de campo), ciclo (ciclos_agricolas, entregas), clima (WeatherLink, pronóstico), GOES (Sutron DCP), NDVI (Sentinel-2).' },
        { k: 'Ventanas de frescura', v: 'Escalas: medición ≤ 240 min · Clima: ≤ 3 h · Pronóstico: según edad de la corrida · GOES: por enlace.' },
        { k: 'Cifras provisionales', v: 'Demanda de referencia (506 Mm³), umbrales de cobertura (1.0 / 1.5), de demanda 24 h (2 / 5 mm), ritmo de ciclo (±10 pp) y anomalía NDVI (±0.05): pendientes de validación por operación.' },
        { k: 'Lecturas con error', v: d.erroresPagina.length ? d.erroresPagina.join(' · ') : 'Ninguna' },
    ]))}
${bloqueFirmas()}`;
}

const CSS_EXTRA = `
.titulo-h{margin-bottom:6px}
.veredicto{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid var(--linea);border-left:5px solid var(--inst);border-radius:4px;padding:8px 12px;background:#fbfaf8;margin:0 0 8px}
.veredicto>span{font-size:9pt;color:var(--ink2)} .veredicto .prot{margin-left:auto}
.kpis{grid-template-columns:repeat(4,1fr)} .kpis3{grid-template-columns:repeat(3,1fr)}
.kpi .v small{font:600 9pt "Segoe UI",Arial,sans-serif;color:var(--ink2)}
.kpi .k-est{margin-top:5px}
.chip{font-size:7.5pt;padding:1px 7px} .chip b{font-size:7.5pt;line-height:1}
.e-ok{background:#e8f3ea;border-color:#9fcaa7;color:#1d5a2b} .e-warn{background:#fff3d6;border-color:#e3c98a;color:#7a4e00}
.e-crit{background:#fbe5e3;border-color:#e3a39d;color:#8f1d14} .e-info{background:#e7eef8;border-color:#a9c0df;color:#1e4a82} .e-sd{background:#f1f0ed;border-color:#d4d1c9;color:#57606a}
.bl{margin:0 0 9px;break-inside:avoid} .bl h3{margin:0 0 4px;font-size:9.5pt;color:var(--inst);text-transform:uppercase;letter-spacing:.04em}
.bl svg{display:block;width:100%;height:auto}
.vacio-fig{border:1px dashed var(--linea);padding:14px;text-align:center;color:var(--sd);font-size:8.5pt}
.cols{align-items:start} .cols>div{min-width:0}
.dl{display:grid;grid-template-columns:44% 56%;gap:0;margin:0;font-size:8.5pt} .dl dt{color:var(--ink2);padding:3px 6px 3px 0;border-bottom:1px solid var(--linea)} .dl dd{margin:0;padding:3px 0;border-bottom:1px solid var(--linea);font-variant-numeric:tabular-nums}
.dl em,td em{color:var(--ink2);font-size:7.5pt}
table.compacta{font-size:8pt} table.compacta td{padding:3px 5px} table.compacta th{padding:4px 5px}
table .tot td{border-top:2px solid var(--inst);font-weight:700;background:#faf6f6}
td span,.atn span{color:var(--ink2)} tr.ant{opacity:.7}
.barra{height:8px;background:#eceae5;border-radius:2px;overflow:hidden;min-width:60px} .barra i{display:block;height:100%;background:var(--inst)}
.atn{list-style:none;margin:0;padding:0;font-size:8.5pt} .atn li{padding:4px 0;border-bottom:1px solid var(--linea)}
.fuentes{list-style:none;margin:0;padding:0;font-size:8.5pt} .fuentes li{padding:3px 0;border-bottom:1px solid var(--linea)}
.avisos{margin:4px 0 0;padding-left:16px;font-size:8pt;color:var(--aviso)}
.est-lin{margin-top:6px}
.frase{font:10pt/1.45 Georgia,serif;margin:0 0 8px}
table.alertas td{vertical-align:top} table.alertas td span{font-size:7.5pt}
@media screen and (max-width:720px){.kpis{grid-template-columns:1fr 1fr}.kpis3,.cols{grid-template-columns:1fr}.dl{grid-template-columns:1fr 1fr}}
`;

/** Documento completo: 6 hojas Carta (resumen, agua, canal, distribución y alertas, clima y sensores, anexo). */
export function construirHtmlInformeGeneral(d: EntradaInformeGeneral, logos: LogosData): string {
    const folio = folioInforme('IGS', d.emitido);
    const pie = (i: number) => pieInforme(`Folio ${folio}${d.version ? ` · SICA 005 v${d.version}` : ''}`, i, HOJAS_INFORME_GENERAL);
    const cab = cabeceraInforme({
        logoSrl: logos.srl, logoSica: logos.sica, titulo: 'Informe general del sistema',
        meta: [{ k: 'Folio', v: folio }, { k: 'Emisión', v: fechaHoraLegible(d.emitido) }, { k: 'Corte', v: d.fechaCorteTexto }],
    });
    const corrida = (tema: string) => `<div class="run"><span><b>S R L Unidad Conchos</b> · ${esc(tema)}</span><span>${esc(folio)}</span></div>`;
    const hojas = [
        `<section class="pagina">${cab}<div class="cuerpo">${hojaResumen(d)}</div>${pie(1)}</section>`,
        `<section class="pagina">${corrida('Informe general del sistema')}<div class="cuerpo">${hojaAgua(d)}</div>${pie(2)}</section>`,
        `<section class="pagina">${corrida('Informe general del sistema')}<div class="cuerpo">${hojaCanal(d)}</div>${pie(3)}</section>`,
        `<section class="pagina">${corrida('Informe general del sistema')}<div class="cuerpo">${hojaDistribucion(d)}</div>${pie(4)}</section>`,
        `<section class="pagina">${corrida('Informe general del sistema')}<div class="cuerpo">${hojaClima(d)}</div>${pie(5)}</section>`,
        `<section class="pagina">${corrida('Informe general del sistema')}<div class="cuerpo">${hojaAnexo(d, folio)}</div>${pie(6)}</section>`,
    ].join('\n');
    return documentoHtml({
        titulo: `Informe general del sistema · ${d.fechaCorteTexto}`,
        css: minificaCss(cssInforme() + CSS_EXTRA),
        cuerpo: hojas,
        metas: { author: 'S R L Unidad Conchos · SICA 005', description: 'Informe general del sistema (Centro de control)' },
    });
}

export function nombreArchivoInformeGeneral(emitido: Date): string {
    const dos = (n: number) => String(n).padStart(2, '0');
    return `informe-general-${emitido.getFullYear()}-${dos(emitido.getMonth() + 1)}-${dos(emitido.getDate())}`;
}
