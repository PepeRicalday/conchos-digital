/**
 * informeHistoricoSvg — gráficas SVG inline (strings) para el Informe Histórico de presas.
 *
 * Funciones puras, sin dependencias de DOM/React, viewBox fijo, fuentes del sistema, sin JS.
 * Reglas (skill dataviz):
 *  - Paleta categórica validada (validate_palette.js, modo claro): azul/ocre/verde-azulado con L 0.43–0.77,
 *    CVD ΔE ≥ 10 entre adyacentes; el año base usa el marrón institucional #6B2D2D (excepción deliberada de marca,
 *    reforzada con trazo más grueso). Cada serie lleva además un trazo distinto (sólido/discontinuo/punteado)
 *    como codificación secundaria → legible en blanco y negro.
 *  - Secuencial: un solo tono (azul) de claro a oscuro. Divergente: azul (aumento) vs rojo-ocre (disminución).
 *  - REGLA RECTORA: S/D nunca es cero. Los null rompen líneas, no se dibujan barras, se rotulan "S/D".
 *  - El estado nunca depende solo del color (semáforo con texto y glifo).
 */
import type { BloqueMetrica, CierreAnio, ClimatologiaMes, FilaDelta } from './informeHistoricoDatos';
import type { EstadoSemaforo, Tendencia } from './estadisticaHistorica';
import type { PosicionAnual, CeldaMatriz } from './historicoPresas';
import { MESES_CORTO, formatearNumero } from './historicoPresas';

export const COLOR_INSTITUCIONAL = '#6B2D2D';
/** Orden fijo: base, comparación 1, 2, 3. */
export const PALETA_SERIES = [COLOR_INSTITUCIONAL, '#2A6FB5', '#C27A0E', '#13866F'];
const DASHES = ['', '7 4', '2 3', '9 3 2 3'];
const INK = '#1f2328';
const INK2 = '#57606a';
const GRID = '#e3e1dc';
const AXIS = '#8c959f';
const SLATE = '#8A9BB0';
const FONT = `font-family="Segoe UI, Helvetica, Arial, sans-serif"`;

export const escSvg = (s: unknown): string =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const e = escSvg;
const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
const num = (v: number | null | undefined, d = 1) => formatearNumero(v, d);

let uid = 0;
const nuevoId = (p: string) => `${p}${++uid}`;

export interface OpcionesSvg { ancho?: number; alto?: number; decimales?: number; unidad?: string }

function abrir(w: number, h: number, titulo: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${e(titulo)}" ${FONT} style="display:block;max-width:100%;height:auto"><title>${e(titulo)}</title>`;
}

function vacio(w: number, h: number, titulo: string, msg = 'S/D — sin datos para esta gráfica'): string {
    return `${abrir(w, h, titulo)}<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="#f6f5f2" stroke="${GRID}" stroke-dasharray="4 3"/><text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="13" fill="${INK2}">${e(msg)}</text></svg>`;
}

/** Marcas "agradables" para un eje. */
function ticksNice(min: number, max: number, n = 5): { ticks: number[]; lo: number; hi: number; paso: number } {
    if (!(max > min)) { const p = Math.abs(min) * 0.05 || 1; min -= p; max += p; }
    const crudo = (max - min) / n;
    const mag = Math.pow(10, Math.floor(Math.log10(crudo)));
    const r = crudo / mag;
    const paso = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
    const lo = Math.floor(min / paso) * paso, hi = Math.ceil(max / paso) * paso;
    const ticks: number[] = [];
    for (let v = lo; v <= hi + paso / 2; v += paso) ticks.push(Math.round(v / paso) * paso);
    return { ticks, lo, hi, paso };
}
const decTick = (paso: number) => (paso >= 1 ? 0 : paso >= 0.1 ? 1 : 2);

const finito = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/* ───────────────────────── 1. Líneas comparadas ───────────────────────── */

export function svgLineasComparadas(b: BloqueMetrica, o: OpcionesSvg = {}): string {
    const W = o.ancho ?? 640, H = o.alto ?? 260;
    const titulo = `${b.nombre} (${b.unidad}) por día, comparación de años`;
    const todos = b.series.flatMap(s => s.valores).filter(finito);
    if (!todos.length || !b.dias.length) return vacio(W, H, titulo);

    const ml = 56, mr = 14, mt = 24, mb = 52;
    const pw = W - ml - mr, ph = H - mt - mb;
    const { ticks, lo, hi, paso } = ticksNice(Math.min(...todos), Math.max(...todos));
    const dec = decTick(paso);
    const n = b.dias.length;
    const x = (i: number) => ml + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
    const y = (v: number) => mt + ph - ((v - lo) / (hi - lo)) * ph;

    let g = abrir(W, H, titulo);
    g += `<text x="${ml - 46}" y="14" font-size="10" fill="${INK2}">${e(b.nombre)} · ${e(b.unidad)}</text>`;
    for (const t of ticks) {
        g += `<line x1="${ml}" x2="${W - mr}" y1="${f1(y(t))}" y2="${f1(y(t))}" stroke="${GRID}" stroke-width="1"/>`;
        g += `<text x="${ml - 6}" y="${f1(y(t) + 3.5)}" text-anchor="end" font-size="10" fill="${INK2}">${e(num(t, dec))}</text>`;
    }
    g += `<line x1="${ml}" x2="${W - mr}" y1="${mt + ph}" y2="${mt + ph}" stroke="${AXIS}"/>`;

    // Eje x: meses (si hay varios) o días.
    const meses = new Set(b.dias.map(d => d.mes));
    if (meses.size > 1) {
        b.dias.forEach((d, i) => {
            if (d.dia !== 1) return;
            g += `<line x1="${f1(x(i))}" x2="${f1(x(i))}" y1="${mt + ph}" y2="${mt + ph + 4}" stroke="${AXIS}"/>`;
            g += `<text x="${f1(x(i) + 2)}" y="${mt + ph + 15}" font-size="10" fill="${INK2}">${e(MESES_CORTO[d.mes - 1])}</text>`;
        });
    } else {
        b.dias.forEach((d, i) => {
            if (!(d.dia === 1 || d.dia % 5 === 0 || i === n - 1)) return;
            g += `<line x1="${f1(x(i))}" x2="${f1(x(i))}" y1="${mt + ph}" y2="${mt + ph + 4}" stroke="${AXIS}"/>`;
            g += `<text x="${f1(x(i))}" y="${mt + ph + 15}" text-anchor="middle" font-size="10" fill="${INK2}">${d.dia}</text>`;
        });
        g += `<text x="${ml + pw / 2}" y="${mt + ph + 27}" text-anchor="middle" font-size="9" fill="${INK2}">día de ${e(MESES_CORTO[b.dias[0].mes - 1].toLowerCase())}</text>`;
    }

    // Series: primero las de comparación (debajo), la base al final (encima).
    const orden = b.series.map((s, i) => ({ s, i })).sort((a, c) => Number(a.s.esBase) - Number(c.s.esBase));
    let k = 0;
    const estilo = new Map<number, { color: string; dash: string; w: number }>();
    for (const s of b.series) {
        if (s.esBase) estilo.set(s.anio, { color: PALETA_SERIES[0], dash: DASHES[0], w: 3 });
        else { k = Math.min(k + 1, 3); estilo.set(s.anio, { color: PALETA_SERIES[k], dash: DASHES[k], w: 1.7 }); }
    }
    for (const { s } of orden) {
        const st = estilo.get(s.anio)!;
        let seg: string[] = [];
        const cierra = () => {
            if (seg.length === 1) { const [px, py] = seg[0].split(','); g += `<circle cx="${px}" cy="${py}" r="${st.w + 0.8}" fill="${st.color}" stroke="#fff" stroke-width="1"/>`; }
            else if (seg.length > 1) g += `<polyline points="${seg.join(' ')}" fill="none" stroke="${st.color}" stroke-width="${st.w}" ${st.dash ? `stroke-dasharray="${st.dash}"` : ''} stroke-linejoin="round" stroke-linecap="${st.dash ? 'butt' : 'round'}"/>`;
            seg = [];
        };
        s.valores.forEach((v, i) => { if (finito(v)) seg.push(`${f1(x(i))},${f1(y(v))}`); else cierra(); });
        cierra();
    }

    // Leyenda (una fila).
    const ly = H - 12, cw = pw / Math.max(1, b.series.length);
    b.series.forEach((s, i) => {
        const st = estilo.get(s.anio)!;
        const lx = ml + i * cw;
        const txt = `${s.etiqueta}${s.esBase ? ' (base)' : ''}${s.parcial ? ` · parcial${s.cobertura != null ? ` ${Math.round(s.cobertura * 100)} %` : ' S/D'}` : ''}`;
        g += `<line x1="${f1(lx)}" x2="${f1(lx + 26)}" y1="${ly - 3.5}" y2="${ly - 3.5}" stroke="${st.color}" stroke-width="${st.w}" ${st.dash ? `stroke-dasharray="${st.dash}"` : ''}/>`;
        g += `<text x="${f1(lx + 32)}" y="${ly}" font-size="10" fill="${INK}">${e(txt)}</text>`;
    });
    return g + '</svg>';
}

/* ───────────────────────── 2. Barras de cierre ───────────────────────── */

export function svgBarrasCierre(cierres: CierreAnio[], o: OpcionesSvg = {}): string {
    const W = o.ancho ?? 420, H = o.alto ?? 220, dec = o.decimales ?? 1;
    const titulo = `Cierre del periodo por año${o.unidad ? ` (${o.unidad})` : ''}`;
    if (!cierres.length) return vacio(W, H, titulo);
    const orden = [...cierres].sort((a, b) => a.anio - b.anio);
    const vals = orden.map(c => c.valor).filter(finito);
    if (!vals.length) return vacio(W, H, titulo, 'S/D — ningún año tiene cierre');

    const ml = 46, mr = 10, mt = 22, mb = 44;
    const pw = W - ml - mr, ph = H - mt - mb;
    const { ticks, hi, paso } = ticksNice(0, Math.max(...vals, 0.0001));
    const dt = decTick(paso);
    const y = (v: number) => mt + ph - (v / hi) * ph;
    const slot = pw / orden.length, bw = Math.min(46, slot * 0.62);
    const idB = nuevoId('hb'), idO = nuevoId('ho');

    let g = abrir(W, H, titulo);
    g += `<defs>
<pattern id="${idB}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#ead9d9"/><line x1="0" y1="0" x2="0" y2="6" stroke="${COLOR_INSTITUCIONAL}" stroke-width="2.4"/></pattern>
<pattern id="${idO}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#e6ebf1"/><line x1="0" y1="0" x2="0" y2="6" stroke="${SLATE}" stroke-width="2.4"/></pattern></defs>`;
    if (o.unidad) g += `<text x="4" y="13" font-size="10" fill="${INK2}">${e(o.unidad)}</text>`;
    for (const t of ticks) {
        g += `<line x1="${ml}" x2="${W - mr}" y1="${f1(y(t))}" y2="${f1(y(t))}" stroke="${GRID}"/>`;
        g += `<text x="${ml - 5}" y="${f1(y(t) + 3.5)}" text-anchor="end" font-size="10" fill="${INK2}">${e(num(t, dt))}</text>`;
    }
    g += `<line x1="${ml}" x2="${W - mr}" y1="${y(0)}" y2="${y(0)}" stroke="${AXIS}"/>`;
    orden.forEach((c, i) => {
        const cx = ml + slot * i + slot / 2, x0 = cx - bw / 2;
        const col = c.esBase ? COLOR_INSTITUCIONAL : SLATE;
        if (finito(c.valor)) {
            const top = y(Math.max(c.valor, 0));
            const fill = c.parcial ? `url(#${c.esBase ? idB : idO})` : col;
            g += `<path d="M${f1(x0)},${f1(y(0))} V${f1(top + 3)} Q${f1(x0)},${f1(top)} ${f1(x0 + 3)},${f1(top)} H${f1(x0 + bw - 3)} Q${f1(x0 + bw)},${f1(top)} ${f1(x0 + bw)},${f1(top + 3)} V${f1(y(0))} Z" fill="${fill}" stroke="${col}" stroke-width="${c.parcial ? 1.2 : 0}"/>`;
            g += `<text x="${f1(cx)}" y="${f1(top - 4)}" text-anchor="middle" font-size="10" font-weight="${c.esBase ? 700 : 500}" fill="${INK}">${e(num(c.valor, dec))}</text>`;
        } else {
            g += `<rect x="${f1(x0)}" y="${f1(y(0) - 18)}" width="${f1(bw)}" height="18" fill="none" stroke="${AXIS}" stroke-dasharray="3 2"/>`;
            g += `<text x="${f1(cx)}" y="${f1(y(0) - 6)}" text-anchor="middle" font-size="10" font-weight="600" fill="${INK2}">S/D</text>`;
        }
        g += `<text x="${f1(cx)}" y="${mt + ph + 14}" text-anchor="middle" font-size="10" font-weight="${c.esBase ? 700 : 400}" fill="${INK}">${e(c.etiqueta)}</text>`;
        if (c.esBase) g += `<text x="${f1(cx)}" y="${mt + ph + 25}" text-anchor="middle" font-size="8.5" fill="${COLOR_INSTITUCIONAL}">base</text>`;
        else if (c.parcial) g += `<text x="${f1(cx)}" y="${mt + ph + 25}" text-anchor="middle" font-size="8.5" fill="${INK2}">parcial${c.cobertura != null ? ` ${Math.round(c.cobertura * 100)} %` : ''}</text>`;
        if (c.esBase && c.parcial) g += `<text x="${f1(cx)}" y="${mt + ph + 35}" text-anchor="middle" font-size="8.5" fill="${INK2}">parcial${c.cobertura != null ? ` ${Math.round(c.cobertura * 100)} %` : ''}</text>`;
    });
    return g + '</svg>';
}

/* ───────────────────────── 3. Mapa de calor ───────────────────────── */

const RAMPA: [number, number, number][] = [[0xea, 0xf1, 0xf8], [0x5b, 0x93, 0xc9], [0x0f, 0x3e, 0x73]];
function colorRampa(t: number): string {
    const x = Math.min(1, Math.max(0, t)) * 2;
    const i = Math.min(1, Math.floor(x)), f = x - i;
    const a = RAMPA[i], c = RAMPA[i + 1];
    return `rgb(${a.map((v, k) => Math.round(v + (c[k] - v) * f)).join(',')})`;
}

export function svgMapaCalor(matriz: { anio: number; celdas: CeldaMatriz[] }[], b: Pick<BloqueMetrica, 'nombre' | 'unidad' | 'decimales' | 'cierres'>, o: OpcionesSvg = {}): string {
    const W = o.ancho ?? 640;
    const titulo = `Mapa de calor ${b.nombre} (${b.unidad}) año por mes`;
    const vals = matriz.flatMap(r => r.celdas.map(c => c.valor)).filter(finito);
    if (!matriz.length || !vals.length) return vacio(W, o.alto ?? 120, titulo);
    const ml = 78, mr = 8, mt = 30, rh = 26, leg = 40;
    const H = mt + matriz.length * rh + leg;
    const cw = (W - ml - mr) / 12;
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const etq = new Map(b.cierres.map(c => [c.anio, c.etiqueta]));
    const id = nuevoId('hs');
    let g = abrir(W, H, titulo);
    g += `<defs><pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f4f3f0"/><line x1="0" y1="0" x2="0" y2="6" stroke="#c9c7c1" stroke-width="1.6"/></pattern></defs>`;
    MESES_CORTO.forEach((m, i) => { g += `<text x="${f1(ml + cw * i + cw / 2)}" y="${mt - 8}" text-anchor="middle" font-size="10" font-weight="600" fill="${INK2}">${e(m)}</text>`; });
    let hayParcial = false;
    matriz.forEach((r, ri) => {
        const ry = mt + ri * rh;
        g += `<text x="${ml - 8}" y="${ry + rh / 2 + 3.5}" text-anchor="end" font-size="10.5" font-weight="600" fill="${INK}">${e(etq.get(r.anio) ?? r.anio)}</text>`;
        r.celdas.forEach((c, ci) => {
            const cx = ml + cw * ci;
            if (!finito(c.valor)) {
                g += `<rect x="${f1(cx + 1)}" y="${ry + 1}" width="${f1(cw - 2)}" height="${rh - 2}" rx="2" fill="url(#${id})" stroke="#d3d1cb" stroke-width="0.8"/>`;
                g += `<text x="${f1(cx + cw / 2)}" y="${ry + rh / 2 + 3}" text-anchor="middle" font-size="8.5" fill="${INK2}">S/D</text>`;
                return;
            }
            const t = mx > mn ? (c.valor - mn) / (mx - mn) : 0.5;
            const parcial = c.dias < c.diasMes;
            if (parcial) hayParcial = true;
            g += `<rect x="${f1(cx + 1)}" y="${ry + 1}" width="${f1(cw - 2)}" height="${rh - 2}" rx="2" fill="${colorRampa(t)}"/>`;
            g += `<text x="${f1(cx + cw / 2)}" y="${ry + rh / 2 + 3}" text-anchor="middle" font-size="8.5" fill="${t > 0.55 ? '#ffffff' : INK}">${e(num(c.valor, b.decimales))}${parcial ? '*' : ''}</text>`;
        });
    });
    // Leyenda de la escala.
    const gy = mt + matriz.length * rh + 12, gid = nuevoId('hg');
    g += `<defs><linearGradient id="${gid}" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${colorRampa(0)}"/><stop offset="0.5" stop-color="${colorRampa(0.5)}"/><stop offset="1" stop-color="${colorRampa(1)}"/></linearGradient></defs>`;
    g += `<rect x="${ml}" y="${gy}" width="160" height="9" fill="url(#${gid})" stroke="${AXIS}" stroke-width="0.5"/>`;
    g += `<text x="${ml}" y="${gy + 21}" font-size="9.5" fill="${INK2}">${e(num(mn, b.decimales))}</text><text x="${ml + 160}" y="${gy + 21}" text-anchor="end" font-size="9.5" fill="${INK2}">${e(num(mx, b.decimales))} ${e(b.unidad)}</text>`;
    g += `<text x="${ml + 176}" y="${gy + 8}" font-size="9.5" fill="${INK2}">Cierre de cada mes.${hayParcial ? ' * mes con datos incompletos.' : ''} Rayado = S/D.</text>`;
    return g + '</svg>';
}

/* ───────────────────────── 4. Banda de climatología ───────────────────────── */

export function svgBandaClimatologia(clim: ClimatologiaMes[], o: OpcionesSvg & { etiquetaBase?: string } = {}): string {
    const W = o.ancho ?? 640, H = o.alto ?? 270, dec = o.decimales ?? 1;
    const titulo = `Estacionalidad${o.unidad ? ` (${o.unidad})` : ''}: banda mín–máx de años de referencia, media y año base`;
    const v = clim.flatMap(c => [c.min, c.max, c.media, c.base]).filter(finito);
    if (!clim.length || !v.length) return vacio(W, H, titulo);
    const ml = 56, mr = 14, mt = 24, mb = 62;
    const pw = W - ml - mr, ph = H - mt - mb;
    const { ticks, lo, hi, paso } = ticksNice(Math.min(...v), Math.max(...v));
    const dt = decTick(paso);
    const x = (m: number) => ml + ((m - 1) / 11) * pw;
    const y = (val: number) => mt + ph - ((val - lo) / (hi - lo)) * ph;
    let g = abrir(W, H, titulo);
    if (o.unidad) g += `<text x="10" y="14" font-size="10" fill="${INK2}">${e(o.unidad)}</text>`;
    for (const t of ticks) {
        g += `<line x1="${ml}" x2="${W - mr}" y1="${f1(y(t))}" y2="${f1(y(t))}" stroke="${GRID}"/>`;
        g += `<text x="${ml - 6}" y="${f1(y(t) + 3.5)}" text-anchor="end" font-size="10" fill="${INK2}">${e(num(t, dt))}</text>`;
    }
    g += `<line x1="${ml}" x2="${W - mr}" y1="${mt + ph}" y2="${mt + ph}" stroke="${AXIS}"/>`;
    clim.forEach(c => {
        g += `<text x="${f1(x(c.mes))}" y="${mt + ph + 14}" text-anchor="middle" font-size="10" fill="${INK}">${e(MESES_CORTO[c.mes - 1])}</text>`;
        g += `<text x="${f1(x(c.mes))}" y="${mt + ph + 26}" text-anchor="middle" font-size="8.5" fill="${INK2}">${c.n > 0 ? `n=${c.n}` : 'S/D'}</text>`;
    });
    // Banda por tramos contiguos con mín y máx.
    const tramos: ClimatologiaMes[][] = [];
    let cur: ClimatologiaMes[] = [];
    for (const c of clim) { if (finito(c.min) && finito(c.max)) cur.push(c); else { if (cur.length) tramos.push(cur); cur = []; } }
    if (cur.length) tramos.push(cur);
    for (const t of tramos) {
        if (t.length === 1) {
            const c = t[0];
            g += `<rect x="${f1(x(c.mes) - 5)}" y="${f1(y(c.max as number))}" width="10" height="${f1(Math.max(1.5, y(c.min as number) - y(c.max as number)))}" fill="#9CBBDD" fill-opacity="0.55" stroke="#5B93C9" stroke-width="0.8"/>`;
        } else {
            const arriba = t.map(c => `${f1(x(c.mes))},${f1(y(c.max as number))}`);
            const abajo = [...t].reverse().map(c => `${f1(x(c.mes))},${f1(y(c.min as number))}`);
            g += `<polygon points="${[...arriba, ...abajo].join(' ')}" fill="#9CBBDD" fill-opacity="0.5" stroke="#5B93C9" stroke-width="0.8"/>`;
        }
    }
    // Media (discontinua) y base (gruesa, encima), rompiendo en null.
    const linea = (get: (c: ClimatologiaMes) => number | null, color: string, w: number, dash: string, marcas: boolean) => {
        let seg: string[] = [];
        const cierra = () => {
            if (seg.length > 1) g += `<polyline points="${seg.join(' ')}" fill="none" stroke="${color}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linejoin="round"/>`;
            seg = [];
        };
        for (const c of clim) { const val = get(c); if (finito(val)) seg.push(`${f1(x(c.mes))},${f1(y(val))}`); else cierra(); }
        cierra();
        if (marcas) for (const c of clim) { const val = get(c); if (finito(val)) g += `<circle cx="${f1(x(c.mes))}" cy="${f1(y(val))}" r="3.4" fill="${color}" stroke="#fff" stroke-width="1.2"/>`; }
    };
    linea(c => c.media, '#3d4650', 1.6, '6 3', false);
    linea(c => c.base, COLOR_INSTITUCIONAL, 2.8, '', true);
    // Leyenda.
    const ly = H - 12;
    g += `<rect x="${ml}" y="${ly - 9}" width="22" height="10" fill="#9CBBDD" fill-opacity="0.5" stroke="#5B93C9" stroke-width="0.8"/><text x="${ml + 28}" y="${ly}" font-size="10" fill="${INK}">Mín–máx años de referencia</text>`;
    g += `<line x1="${ml + 190}" x2="${ml + 216}" y1="${ly - 4}" y2="${ly - 4}" stroke="#3d4650" stroke-width="1.6" stroke-dasharray="6 3"/><text x="${ml + 222}" y="${ly}" font-size="10" fill="${INK}">Media</text>`;
    g += `<line x1="${ml + 275}" x2="${ml + 301}" y1="${ly - 4}" y2="${ly - 4}" stroke="${COLOR_INSTITUCIONAL}" stroke-width="2.8"/><circle cx="${ml + 288}" cy="${ly - 4}" r="3.2" fill="${COLOR_INSTITUCIONAL}" stroke="#fff"/><text x="${ml + 307}" y="${ly}" font-size="10" fill="${INK}">${e(o.etiquetaBase ? `Año base ${o.etiquetaBase}` : 'Año base')}</text>`;
    g += `<text x="${W - mr}" y="${ly}" text-anchor="end" font-size="9" fill="${INK2}">n = años de referencia por mes · valor con ${dec} dec.</text>`;
    return g + '</svg>';
}

/* ───────────────────────── 5. Barras Δ (divergente) ───────────────────────── */

const COLOR_POS = '#2A6FB5';
const COLOR_NEG = '#B8431F';

export function svgBarrasDelta(filas: FilaDelta[], o: OpcionesSvg = {}): string {
    const W = o.ancho ?? 640, H = o.alto ?? 270, dec = o.decimales ?? 1;
    const titulo = `Δ de almacenamiento aparente por mes${o.unidad ? ` (${o.unidad})` : ''}`;
    const vals = filas.flatMap(f => f.porAnio.map(p => p.delta)).filter(finito);
    if (!filas.length || !vals.length) return vacio(W, H, titulo, 'S/D — sin Δ calculable en el periodo');
    const ml = 56, mr = 12, mt = 24, mb = 50;
    const pw = W - ml - mr, ph = H - mt - mb;
    const { ticks, lo, hi, paso } = ticksNice(Math.min(0, ...vals), Math.max(0, ...vals));
    const dt = decTick(paso);
    const y = (v: number) => mt + ph - ((v - lo) / (hi - lo)) * ph;
    const y0 = y(0);
    const slot = pw / filas.length;
    const ny = Math.max(1, ...filas.map(f => f.porAnio.length));
    const bw = Math.max(4, Math.min(16, (slot * 0.8) / ny));
    const opac = [1, 0.7, 0.5, 0.35];
    let g = abrir(W, H, titulo);
    if (o.unidad) g += `<text x="10" y="14" font-size="10" fill="${INK2}">${e(o.unidad)}</text>`;
    for (const t of ticks) {
        g += `<line x1="${ml}" x2="${W - mr}" y1="${f1(y(t))}" y2="${f1(y(t))}" stroke="${GRID}"/>`;
        g += `<text x="${ml - 6}" y="${f1(y(t) + 3.5)}" text-anchor="end" font-size="10" fill="${INK2}">${e(num(t, dt))}</text>`;
    }
    g += `<line x1="${ml}" x2="${W - mr}" y1="${f1(y0)}" y2="${f1(y0)}" stroke="${INK}" stroke-width="1.2"/>`;
    filas.forEach((f, fi) => {
        const cx = ml + slot * fi + slot / 2;
        const gw = bw * f.porAnio.length;
        g += `<text x="${f1(cx)}" y="${mt + ph + 14}" text-anchor="middle" font-size="10" fill="${INK}">${e(MESES_CORTO[f.mes - 1] ?? f.etiqueta)}</text>`;
        f.porAnio.forEach((p, pi) => {
            const bx = cx - gw / 2 + pi * bw + 0.5, w = bw - 1;
            if (!finito(p.delta)) {
                g += `<rect x="${f1(bx)}" y="${f1(y0 - 9)}" width="${f1(w)}" height="9" fill="#f4f3f0" stroke="${AXIS}" stroke-width="0.8" stroke-dasharray="2 1.5"/>`;
                g += `<text transform="translate(${f1(bx + w / 2 + 2.3)},${f1(y0 - 11)}) rotate(-90)" font-size="6.5" fill="${INK2}">S/D</text>`;
            } else if (p.delta === 0) {
                g += `<rect x="${f1(bx)}" y="${f1(y0 - 1.2)}" width="${f1(w)}" height="2.4" fill="${INK}"/>`;
            } else {
                const yy = y(p.delta), top = Math.min(yy, y0), h = Math.abs(yy - y0);
                g += `<rect x="${f1(bx)}" y="${f1(top)}" width="${f1(w)}" height="${f1(Math.max(1.2, h))}" fill="${p.delta > 0 ? COLOR_POS : COLOR_NEG}" fill-opacity="${opac[Math.min(pi, 3)]}"${pi === 0 ? ` stroke="${COLOR_INSTITUCIONAL}" stroke-width="1"` : ''}/>`;
            }
        });
    });
    // Leyenda.
    const ly = H - 12;
    const anios = filas[0]?.porAnio ?? [];
    let lx = ml;
    anios.forEach((p, i) => {
        g += `<rect x="${lx}" y="${ly - 9}" width="12" height="10" fill="#6b7480" fill-opacity="${opac[Math.min(i, 3)]}"${i === 0 ? ` stroke="${COLOR_INSTITUCIONAL}"` : ''}/><text x="${lx + 16}" y="${ly}" font-size="10" fill="${INK}">${e(p.etiqueta)}${i === 0 ? ' (base)' : ''}</text>`;
        lx += 24 + 6.2 * (p.etiqueta.length + (i === 0 ? 7 : 0)) + 8;
    });
    g += `<rect x="${f1(lx)}" y="${ly - 9}" width="10" height="10" fill="${COLOR_POS}"/><text x="${f1(lx + 14)}" y="${ly}" font-size="10" fill="${INK}">Aumento</text>`;
    g += `<rect x="${f1(lx + 66)}" y="${ly - 9}" width="10" height="10" fill="${COLOR_NEG}"/><text x="${f1(lx + 80)}" y="${ly}" font-size="10" fill="${INK}">Disminución</text>`;
    g += `<rect x="${f1(lx + 152)}" y="${ly - 9}" width="10" height="10" fill="#f4f3f0" stroke="${AXIS}" stroke-dasharray="2 1.5"/><text x="${f1(lx + 166)}" y="${ly}" font-size="10" fill="${INK}">S/D</text>`;
    g += `<line x1="${f1(lx + 196)}" x2="${f1(lx + 208)}" y1="${ly - 4}" y2="${ly - 4}" stroke="${INK}" stroke-width="2.4"/><text x="${f1(lx + 212)}" y="${ly}" font-size="10" fill="${INK}">= 0 (${e(num(0, dec))})</text>`;
    return g + '</svg>';
}

/* ───────────────────────── 6. Tendencia ───────────────────────── */

export function svgTendencia(ranking: PosicionAnual[], t: Tendencia | null, o: OpcionesSvg & { anioBase?: number } = {}): string {
    const W = o.ancho ?? 520, H = o.alto ?? 250, dec = o.decimales ?? 1;
    const titulo = `Tendencia lineal del cierre por año${o.unidad ? ` (${o.unidad})` : ''} — descriptiva, no predictiva`;
    if (!ranking.length) return vacio(W, H, titulo);
    const pts = [...ranking].sort((a, b) => a.anio - b.anio);
    const ml = 56, mr = 16, mt = 34, mb = 36;
    const pw = W - ml - mr, ph = H - mt - mb;
    const ys = pts.map(p => p.valor);
    const xmin = pts[0].anio - 0.5, xmax = pts[pts.length - 1].anio + 0.5;
    const { ticks, lo, hi, paso } = ticksNice(Math.min(...ys), Math.max(...ys));
    const dt = decTick(paso);
    const x = (a: number) => ml + ((a - xmin) / (xmax - xmin || 1)) * pw;
    const y = (v: number) => mt + ph - ((v - lo) / (hi - lo)) * ph;
    let g = abrir(W, H, titulo);
    if (o.unidad) g += `<text x="10" y="14" font-size="10" fill="${INK2}">${e(o.unidad)}</text>`;
    for (const tk of ticks) {
        g += `<line x1="${ml}" x2="${W - mr}" y1="${f1(y(tk))}" y2="${f1(y(tk))}" stroke="${GRID}"/>`;
        g += `<text x="${ml - 6}" y="${f1(y(tk) + 3.5)}" text-anchor="end" font-size="10" fill="${INK2}">${e(num(tk, dt))}</text>`;
    }
    g += `<line x1="${ml}" x2="${W - mr}" y1="${mt + ph}" y2="${mt + ph}" stroke="${AXIS}"/>`;
    pts.forEach(p => { g += `<text x="${f1(x(p.anio))}" y="${mt + ph + 15}" text-anchor="middle" font-size="10" fill="${INK}">${p.anio}</text>`; });
    if (t) {
        const a = pts[0].anio, z = pts[pts.length - 1].anio;
        g += `<line x1="${f1(x(a))}" y1="${f1(y(t.intercepto + t.pendiente * a))}" x2="${f1(x(z))}" y2="${f1(y(t.intercepto + t.pendiente * z))}" stroke="#3d4650" stroke-width="1.6" stroke-dasharray="6 3"/>`;
        const s = `${t.pendiente > 0 ? '+' : t.pendiente < 0 ? '−' : ''}${num(Math.abs(t.pendiente), dec)}`;
        g += `<text x="${W - mr}" y="14" text-anchor="end" font-size="10.5" font-weight="600" fill="${INK}">Pendiente ${e(s)}${o.unidad ? ' ' + e(o.unidad) : ''}/año · R² ${e(num(t.r2, 2))} · n = ${t.n}</text>`;
        g += `<text x="${W - mr}" y="27" text-anchor="end" font-size="9" fill="${INK2}">Descriptiva, no predictiva</text>`;
    } else {
        g += `<text x="${W - mr}" y="14" text-anchor="end" font-size="10.5" fill="${INK2}">Tendencia S/D (se requieren al menos 3 años con dato)</text>`;
    }
    pts.forEach(p => {
        const base = p.anio === o.anioBase;
        g += `<circle cx="${f1(x(p.anio))}" cy="${f1(y(p.valor))}" r="${base ? 5.5 : 4}" fill="${base ? COLOR_INSTITUCIONAL : SLATE}" stroke="#fff" stroke-width="1.5"/>`;
        g += `<text x="${f1(x(p.anio))}" y="${f1(y(p.valor) - 9)}" text-anchor="middle" font-size="9.5" font-weight="${base ? 700 : 400}" fill="${INK}">${e(num(p.valor, dec))}</text>`;
    });
    return g + '</svg>';
}

/* ───────────────────────── 7. Semáforo ───────────────────────── */

const SEMAFORO: Record<EstadoSemaforo, { color: string; glifo: string; etiqueta: string; detalle: string }> = {
    verde: { color: '#2E7D32', glifo: '✓', etiqueta: 'VERDE', detalle: 'Tercio superior histórico' },
    ambar: { color: '#B26A00', glifo: '!', etiqueta: 'ÁMBAR', detalle: 'Tercio medio histórico' },
    rojo: { color: '#B3261E', glifo: '✕', etiqueta: 'ROJO', detalle: 'Tercio inferior histórico' },
    sd: { color: '#6b7480', glifo: '?', etiqueta: 'S/D', detalle: 'Sin base comparable (< 3 años)' },
};

export function svgSemaforo(estado: EstadoSemaforo, o: OpcionesSvg = {}): string {
    const W = o.ancho ?? 250, H = o.alto ?? 50;
    const s = SEMAFORO[estado] ?? SEMAFORO.sd;
    const titulo = `Semáforo: ${s.etiqueta} — ${s.detalle}`;
    return `${abrir(W, H, titulo)}<circle cx="25" cy="25" r="19" fill="${s.color}"/><circle cx="25" cy="25" r="22.5" fill="none" stroke="${s.color}" stroke-width="1.2" opacity="0.45"/>`
        + `<text x="25" y="31.5" text-anchor="middle" font-size="19" font-weight="700" fill="#fff">${e(s.glifo)}</text>`
        + `<text x="56" y="22" font-size="15" font-weight="700" fill="${INK}" letter-spacing="0.6">${e(s.etiqueta)}</text>`
        + `<text x="56" y="38" font-size="10.5" fill="${INK2}">${e(s.detalle)}</text></svg>`;
}
