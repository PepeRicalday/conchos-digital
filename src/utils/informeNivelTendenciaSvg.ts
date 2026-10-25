/**
 * informeNivelTendenciaSvg — gráficas SVG (strings) del informe "Nivel y Tendencia de Presas".
 * Puras, sin DOM ni JS, viewBox fijo. Regla rectora: S/D nunca es cero — los null cortan la línea,
 * no se dibujan barras ni celdas con valor y se rotulan "S/D". El estado no depende solo del color
 * (año base con trazo grueso; comparaciones con trazo distinto y rótulo directo del año).
 */
import { COLOR_INSTITUCIONAL, escSvg } from './informeHistoricoSvg';
import { MESES_CORTO, formatearNumero } from './historicoPresas';
import type { BarraCierre, FilaCalor, FilaMismoDia, SerieAnioNT } from './informeNivelTendenciaDatos';

export const COLOR_AGUA = '#1F6FB2';
const PALETA_COMP = ['#2A6FB5', '#C27A0E', '#13866F', '#7A5AA6', '#B5476B', '#6B7B8C'];
const DASHES = ['', '7 4', '2 3', '9 3 2 3', '5 3', '1 3'];
const INK = '#1f2328', INK2 = '#57606a', GRID = '#e7e4de', AXIS = '#9aa3ac';
const e = escSvg;
const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
let uid = 0;

function abrir(w: number, h: number, titulo: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${e(titulo)}" style="display:block;max-width:100%;height:auto"><title>${e(titulo)}</title>`;
}
function vacio(w: number, h: number, titulo: string, msg = 'S/D — sin datos en este periodo'): string {
    return `${abrir(w, h, titulo)}<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="8" fill="#f7f6f3" stroke="${GRID}" stroke-dasharray="4 3"/><text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="13" fill="${INK2}">${e(msg)}</text></svg>`;
}

/** Marcas "agradables" para un eje. */
function ticks(min: number, max: number, n = 4): { t: number[]; lo: number; hi: number; dec: number } {
    if (!(max > min)) { const p = Math.abs(min) * 0.02 || 1; min -= p; max += p; }
    const crudo = (max - min) / n, mag = Math.pow(10, Math.floor(Math.log10(crudo))), r = crudo / mag;
    const paso = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
    const lo = Math.floor(min / paso) * paso, hi = Math.ceil(max / paso) * paso;
    const t: number[] = [];
    for (let v = lo; v <= hi + paso / 2; v += paso) t.push(Math.round(v / paso) * paso);
    return { t, lo, hi, dec: paso >= 1 ? 0 : paso >= 0.1 ? 1 : 2 };
}

/** Segmentos contiguos (sin nulls) de una serie, como listas de puntos [x,y]. */
function segmentos(vals: (number | null)[], x: (i: number) => number, y: (v: number) => number): [number, number][][] {
    const out: [number, number][][] = [];
    let cur: [number, number][] = [];
    vals.forEach((v, i) => { if (fin(v)) cur.push([x(i), y(v)]); else if (cur.length) { out.push(cur); cur = []; } });
    if (cur.length) out.push(cur);
    return out;
}
const pts = (s: [number, number][]) => s.map(([a, b]) => `${f1(a)},${f1(b)}`).join(' ');

function ejeX(dias: number, x: (i: number) => number, base: number, h: number): string {
    let g = `<line x1="${x(0)}" x2="${x(dias - 1)}" y1="${base}" y2="${base}" stroke="${AXIS}"/>`;
    for (let i = 0; i < dias; i++) {
        const d = i + 1;
        if (!(d === 1 || d % 5 === 0 || d === dias)) continue;
        if (d === dias && d % 5 !== 0 && dias - Math.floor(dias / 5) * 5 < 3) continue; // evita "3031"
        g += `<line x1="${f1(x(i))}" x2="${f1(x(i))}" y1="${base}" y2="${base + 4}" stroke="${AXIS}"/><text x="${f1(x(i))}" y="${base + 16}" text-anchor="middle" font-size="10.5" fill="${INK2}">${d}</text>`;
    }
    return g + `<text x="${f1((x(0) + x(dias - 1)) / 2)}" y="${h - 2}" text-anchor="middle" font-size="10" fill="${INK2}">día del mes</text>`;
}

/* ─────────────── 1. Área del mes (escala o volumen) ─────────────── */

export interface OpcionesArea { ancho?: number; alto?: number; unidad: string; decimales: number; color?: string; titulo: string }

export function svgAreaMes(vals: (number | null)[], o: OpcionesArea): string {
    const W = o.ancho ?? 440, H = o.alto ?? 210;
    const ok = vals.filter(fin);
    if (!ok.length) return vacio(W, H, o.titulo);
    const color = o.color ?? COLOR_AGUA;
    const ml = 52, mr = 16, mt = 18, mb = 34, pw = W - ml - mr, ph = H - mt - mb;
    const { t, lo, hi, dec } = ticks(Math.min(...ok), Math.max(...ok));
    const n = vals.length;
    const x = (i: number) => ml + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
    const y = (v: number) => mt + ph - ((v - lo) / (hi - lo)) * ph;
    const id = `ntg${++uid}`;
    let g = abrir(W, H, o.titulo);
    g += `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".30"/><stop offset="1" stop-color="${color}" stop-opacity=".02"/></linearGradient></defs>`;
    for (const v of t) {
        g += `<line x1="${ml}" x2="${W - mr}" y1="${f1(y(v))}" y2="${f1(y(v))}" stroke="${GRID}"/>`
            + `<text x="${ml - 7}" y="${f1(y(v) + 3.5)}" text-anchor="end" font-size="10.5" fill="${INK2}">${e(formatearNumero(v, dec))}</text>`;
    }
    g += ejeX(n, x, mt + ph, H);
    const segs = segmentos(vals, x, y);
    for (const s of segs) {
        if (s.length > 1) {
            g += `<polygon points="${pts(s)} ${f1(s[s.length - 1][0])},${mt + ph} ${f1(s[0][0])},${mt + ph}" fill="url(#${id})"/>`;
            g += `<polyline points="${pts(s)}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
        } else g += `<circle cx="${f1(s[0][0])}" cy="${f1(s[0][1])}" r="3" fill="${color}"/>`;
    }
    // Extremos y último dato.
    const iMax = vals.findIndex(v => v === Math.max(...ok)), iMin = vals.findIndex(v => v === Math.min(...ok));
    const ult = vals.map((v, i) => (fin(v) ? i : -1)).filter(i => i >= 0).pop() as number;
    const marca = (i: number, txt: string, arriba: boolean, relleno: boolean) => {
        const px = x(i), py = y(vals[i] as number);
        const ancla = px > W - 70 ? 'end' : px < ml + 40 ? 'start' : 'middle';
        return `<circle cx="${f1(px)}" cy="${f1(py)}" r="${relleno ? 4.5 : 3.4}" fill="${relleno ? color : '#fff'}" stroke="${relleno ? '#fff' : color}" stroke-width="2"/>`
            + `<text x="${f1(px)}" y="${f1(py + (arriba ? -9 : 15))}" text-anchor="${ancla}" font-size="10.5" font-weight="700" fill="${INK}">${e(txt)}</text>`;
    };
    const val = (v: number) => formatearNumero(v, o.decimales);
    if (ok.length > 2 && iMax !== ult && iMax !== iMin && vals[iMax] !== vals[ult]) g += marca(iMax, val(Math.max(...ok)), true, false);
    if (ok.length > 2 && iMin !== ult && iMin !== iMax && vals[iMin] !== vals[ult]) g += marca(iMin, val(Math.min(...ok)), false, false);
    g += marca(ult, val(vals[ult] as number), iMax !== ult || ok.length < 3, true);
    g += `<text x="${ml - 46}" y="11" font-size="10" fill="${INK2}">${e(o.unidad)}</text>`;
    return g + '</svg>';
}

/* ─────────────── 2. Curvas del mes, año contra año ─────────────── */

export interface OpcionesCurvas { ancho?: number; alto?: number; unidad: string; decimales: number; titulo: string }

export function svgCurvasAnios(series: SerieAnioNT[], metrica: 'volumen' | 'escala', o: OpcionesCurvas): string {
    const W = o.ancho ?? 440, H = o.alto ?? 240;
    const todos = series.flatMap(s => s[metrica]).filter(fin);
    const n = series[0]?.[metrica].length ?? 0;
    if (!todos.length || !n) return vacio(W, H, o.titulo);
    const ml = 52, mr = 40, mt = 16, mb = 34, pw = W - ml - mr, ph = H - mt - mb;
    const { t, lo, hi, dec } = ticks(Math.min(...todos), Math.max(...todos));
    const x = (i: number) => ml + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
    const y = (v: number) => mt + ph - ((v - lo) / (hi - lo)) * ph;
    let g = abrir(W, H, o.titulo);
    for (const v of t) {
        g += `<line x1="${ml}" x2="${W - mr}" y1="${f1(y(v))}" y2="${f1(y(v))}" stroke="${GRID}"/>`
            + `<text x="${ml - 7}" y="${f1(y(v) + 3.5)}" text-anchor="end" font-size="10.5" fill="${INK2}">${e(formatearNumero(v, dec))}</text>`;
    }
    g += ejeX(n, x, mt + ph, H);
    // Estilo por serie: comparaciones en orden de año, base al final (encima).
    const comp = series.filter(s => !s.esBase);
    const estilo = new Map<number, { c: string; d: string; w: number }>();
    comp.forEach((s, k) => estilo.set(s.anio, { c: PALETA_COMP[k % PALETA_COMP.length], d: DASHES[k % DASHES.length], w: 1.6 }));
    for (const s of series) if (s.esBase) estilo.set(s.anio, { c: COLOR_INSTITUCIONAL, d: '', w: 3.2 });
    const etiquetas: { y: number; txt: string; c: string; base: boolean }[] = [];
    for (const s of [...comp, ...series.filter(q => q.esBase)]) {
        const st = estilo.get(s.anio)!;
        const vals = s[metrica];
        for (const seg of segmentos(vals, x, y)) {
            if (seg.length === 1) g += `<circle cx="${f1(seg[0][0])}" cy="${f1(seg[0][1])}" r="${st.w + 0.8}" fill="${st.c}"/>`;
            else g += `<polyline points="${pts(seg)}" fill="none" stroke="${st.c}" stroke-width="${st.w}" ${st.d ? `stroke-dasharray="${st.d}"` : ''} stroke-linejoin="round" stroke-linecap="${st.d ? 'butt' : 'round'}"/>`;
        }
        const ult = vals.map((v, i) => (fin(v) ? i : -1)).filter(i => i >= 0).pop();
        if (ult != null) etiquetas.push({ y: y(vals[ult] as number), txt: String(s.anio), c: st.c, base: s.esBase });
    }
    // Rótulo directo del año al final de cada línea, separando los que chocan (≥ 11 px).
    etiquetas.sort((a, b) => a.y - b.y);
    for (let i = 1; i < etiquetas.length; i++) if (etiquetas[i].y - etiquetas[i - 1].y < 11) etiquetas[i].y = etiquetas[i - 1].y + 11;
    for (const l of etiquetas) g += `<text x="${W - mr + 5}" y="${f1(l.y + 3.5)}" font-size="${l.base ? 11 : 10}" font-weight="${l.base ? 800 : 600}" fill="${l.c}">${l.txt}</text>`;
    g += `<text x="${ml - 46}" y="11" font-size="10" fill="${INK2}">${e(o.unidad)}</text>`;
    return g + '</svg>';
}

/* ─────────────── 3. Hoy frente a los mismos días de otros años ─────────────── */

export function svgPosicionHistorica(filas: FilaMismoDia[], hoy: { anio: number; volumen: number | null }, o: { ancho?: number; titulo: string }): string {
    const W = o.ancho ?? 440, H = 118;
    const pares = [...filas.filter(f => fin(f.volumen)).map(f => ({ anio: f.anio, v: f.volumen as number, hoy: false })),
        ...(fin(hoy.volumen) ? [{ anio: hoy.anio, v: hoy.volumen, hoy: true }] : [])];
    if (pares.length < 2 || !pares.some(p => p.hoy)) return vacio(W, H, o.titulo, 'S/D — faltan años para comparar');
    const ml = 20, mr = 20, pw = W - ml - mr, yL = 62;
    const min = Math.min(...pares.map(p => p.v)), max = Math.max(...pares.map(p => p.v));
    const { lo, hi } = ticks(min, max, 3);
    const x = (v: number) => ml + ((v - lo) / (hi - lo)) * pw;
    let g = abrir(W, H, o.titulo);
    g += `<rect x="${f1(x(min))}" y="${yL - 7}" width="${f1(Math.max(2, x(max) - x(min)))}" height="14" rx="7" fill="#dfe9f3"/>`;
    g += `<line x1="${ml}" x2="${W - mr}" y1="${yL + 22}" y2="${yL + 22}" stroke="${AXIS}"/>`;
    g += `<text x="${ml}" y="${yL + 36}" font-size="10.5" fill="${INK2}">${e(formatearNumero(lo, 0))}</text><text x="${W - mr}" y="${yL + 36}" text-anchor="end" font-size="10.5" fill="${INK2}">${e(formatearNumero(hi, 0))} Mm³</text>`;
    // Puntos de años anteriores (rótulo alternado arriba/abajo para no encimarse) y el de hoy.
    const ord = pares.filter(p => !p.hoy).sort((a, b) => a.v - b.v);
    ord.forEach((p, i) => {
        g += `<circle cx="${f1(x(p.v))}" cy="${yL}" r="5" fill="#fff" stroke="${COLOR_AGUA}" stroke-width="2"/>`
            + `<text x="${f1(x(p.v))}" y="${i % 2 ? yL + 19 : yL - 12}" text-anchor="middle" font-size="10" fill="${INK2}">${p.anio}</text>`;
    });
    const h = pares.find(p => p.hoy)!;
    g += `<line x1="${f1(x(h.v))}" x2="${f1(x(h.v))}" y1="${yL - 26}" y2="${yL + 8}" stroke="${COLOR_INSTITUCIONAL}" stroke-width="2"/>`
        + `<circle cx="${f1(x(h.v))}" cy="${yL}" r="7" fill="${COLOR_INSTITUCIONAL}" stroke="#fff" stroke-width="2.5"/>`
        + `<text x="${f1(Math.min(W - 40, Math.max(40, x(h.v))))}" y="${yL - 31}" text-anchor="middle" font-size="11.5" font-weight="800" fill="${COLOR_INSTITUCIONAL}">${h.anio} · ${e(formatearNumero(h.v, 1))}</text>`;
    return g + '</svg>';
}

/* ─────────────── 4. Cierre del mes por año ─────────────── */

export function svgCierres(barras: BarraCierre[], o: { ancho?: number; alto?: number; unidad: string; titulo: string }): string {
    const W = o.ancho ?? 440, H = o.alto ?? 210;
    const ok = barras.filter(b => fin(b.valor));
    if (!ok.length) return vacio(W, H, o.titulo);
    const ml = 52, mr = 12, mt = 22, mb = 30, pw = W - ml - mr, ph = H - mt - mb;
    const { t, hi } = ticks(0, Math.max(...ok.map(b => b.valor as number)), 4);
    const y = (v: number) => mt + ph - (v / hi) * ph;
    const bw = Math.min(46, (pw / barras.length) * 0.62), paso = pw / barras.length;
    let g = abrir(W, H, o.titulo);
    for (const v of t) g += `<line x1="${ml}" x2="${W - mr}" y1="${f1(y(v))}" y2="${f1(y(v))}" stroke="${GRID}"/><text x="${ml - 7}" y="${f1(y(v) + 3.5)}" text-anchor="end" font-size="10.5" fill="${INK2}">${e(formatearNumero(v, 0))}</text>`;
    barras.forEach((b, i) => {
        const cx = ml + paso * i + paso / 2;
        if (!fin(b.valor)) {
            g += `<text x="${f1(cx)}" y="${mt + ph - 8}" text-anchor="middle" font-size="10.5" fill="${INK2}" font-style="italic">S/D</text>`;
        } else {
            g += `<rect x="${f1(cx - bw / 2)}" y="${f1(y(b.valor))}" width="${f1(bw)}" height="${f1(mt + ph - y(b.valor))}" rx="3" fill="${b.esBase ? COLOR_INSTITUCIONAL : '#9db8d3'}"/>`
                + `<text x="${f1(cx)}" y="${f1(y(b.valor) - 6)}" text-anchor="middle" font-size="10.5" font-weight="${b.esBase ? 800 : 600}" fill="${INK}">${e(formatearNumero(b.valor, 0))}</text>`;
        }
        g += `<text x="${f1(cx)}" y="${mt + ph + 16}" text-anchor="middle" font-size="11" font-weight="${b.esBase ? 800 : 500}" fill="${b.esBase ? COLOR_INSTITUCIONAL : INK2}">${b.anio}</text>`;
    });
    g += `<line x1="${ml}" x2="${W - mr}" y1="${mt + ph}" y2="${mt + ph}" stroke="${AXIS}"/><text x="${ml - 46}" y="12" font-size="10" fill="${INK2}">${e(o.unidad)}</text>`;
    return g + '</svg>';
}

/* ─────────────── 5. Mapa de calor año × mes ─────────────── */

/** Tono azul secuencial (claro → oscuro) para t en [0,1]. */
const tono = (t: number) => {
    const a = [226, 238, 248], b = [14, 64, 120];
    return `rgb(${a.map((c, i) => Math.round(c + (b[i] - c) * t)).join(',')})`;
};

export function svgCalor(filas: FilaCalor[], o: { ancho?: number; titulo: string; baseAnio: number; mesResaltado: number }): string {
    const W = o.ancho ?? 908;
    const vals = filas.flatMap(f => f.celdas.map(c => c.valor)).filter(fin);
    if (!vals.length) return vacio(W, 90, o.titulo);
    const min = Math.min(...vals), max = Math.max(...vals);
    const ml = 46, mt = 22, ch = 26, cw = (W - ml - 4) / 12, H = mt + filas.length * ch + 6;
    let g = abrir(W, H, o.titulo);
    MESES_CORTO.forEach((m, j) => {
        g += `<text x="${f1(ml + cw * j + cw / 2)}" y="14" text-anchor="middle" font-size="10.5" font-weight="${j + 1 === o.mesResaltado ? 800 : 500}" fill="${j + 1 === o.mesResaltado ? COLOR_INSTITUCIONAL : INK2}">${m}</text>`;
    });
    filas.forEach((f, i) => {
        const yy = mt + i * ch;
        g += `<text x="${ml - 8}" y="${yy + ch / 2 + 4}" text-anchor="end" font-size="11" font-weight="${f.anio === o.baseAnio ? 800 : 500}" fill="${f.anio === o.baseAnio ? COLOR_INSTITUCIONAL : INK2}">${f.anio}</text>`;
        f.celdas.forEach((c, j) => {
            const cx = ml + cw * j;
            if (!fin(c.valor)) {
                g += `<rect x="${f1(cx + 1)}" y="${yy + 1}" width="${f1(cw - 2)}" height="${ch - 2}" rx="3" fill="#f4f3f0"/><text x="${f1(cx + cw / 2)}" y="${yy + ch / 2 + 3.5}" text-anchor="middle" font-size="9" fill="#9aa3ac">S/D</text>`;
                return;
            }
            const tt = max > min ? (c.valor - min) / (max - min) : 0.5;
            g += `<rect x="${f1(cx + 1)}" y="${yy + 1}" width="${f1(cw - 2)}" height="${ch - 2}" rx="3" fill="${tono(tt)}"${f.anio === o.baseAnio && j + 1 === o.mesResaltado ? ` stroke="${COLOR_INSTITUCIONAL}" stroke-width="2"` : ''}/>`
                + `<text x="${f1(cx + cw / 2)}" y="${yy + ch / 2 + 3.5}" text-anchor="middle" font-size="10" font-weight="600" fill="${tt > 0.5 ? '#fff' : INK}">${e(formatearNumero(c.valor, 0))}</text>`;
        });
    });
    return g + '</svg>';
}
