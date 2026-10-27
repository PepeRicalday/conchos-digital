/**
 * informeGoesSvg — gráficas SVG (strings) del Informe de estaciones GOES. Puras, sin DOM ni JS, viewBox fijo.
 * Reglas (dataviz): ejes con unidad, una sola escala por gráfica, el hueco corta la línea (S/D nunca es 0), rejilla recesiva,
 * etiquetas directas al final de cada serie + leyenda, el estado nunca depende solo del color (trazo, glifo, texto).
 * El color de cada estación lo da `colorEstacion` (fijo por entidad); los textos van en tinta neutra.
 */
import { COLOR_INSTITUCIONAL, escSvg } from './informeHistoricoSvg';
import { fmt, TZ_SICA, type CeldaEnlace } from './hidroEstaciones';
import { OFFSET_CHIHUAHUA_MS } from './informeGoesConfig';
import type { PuntoBanda } from './informeGoesDatos';

const e = escSvg;
const INK = '#1f2328', INK2 = '#57606a', GRID = '#e7e4de', AXIS = '#9aa3ac', SD = '#6a737d';
export const COLOR_OK = '#1a7f4b', COLOR_AVISO = '#b45309', COLOR_MAL = '#b42318';
const HORA = 3600000;
const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

function abrir(w: number, h: number, titulo: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${e(titulo)}" style="display:block;max-width:100%;height:auto"><title>${e(titulo)}</title>`;
}
export function svgVacio(w: number, h: number, titulo: string, msg = 'S/D — sin lecturas en el periodo'): string {
    return `${abrir(w, h, titulo)}<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="4" fill="#f7f6f3" stroke="${GRID}" stroke-dasharray="4 3"/><text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="${INK2}">${e(msg)}</text></svg>`;
}

/** Marcas "agradables" para un eje. */
export function ticksNice(min: number, max: number, n = 4): { t: number[]; lo: number; hi: number; dec: number } {
    if (!(max > min)) { const p = Math.abs(min) * 0.05 || 1; min -= p; max += p; }
    const crudo = (max - min) / n, mag = Math.pow(10, Math.floor(Math.log10(crudo))), r = crudo / mag;
    const paso = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
    const lo = Math.floor(min / paso + 1e-9) * paso, hi = Math.ceil(max / paso - 1e-9) * paso;
    const t: number[] = [];
    for (let v = lo; v <= hi + paso / 2; v += paso) t.push(Math.round(v / paso) * paso);
    return { t, lo, hi, dec: paso >= 1 ? 0 : paso >= 0.1 ? 1 : paso >= 0.01 ? 2 : 3 };
}

const horaTxt = (ms: number) => new Date(ms).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ_SICA });
const diaTxt = (ms: number) => new Date(ms).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: TZ_SICA }).replace('.', '');

/** Marcas de tiempo alineadas a la hora local: paso limpio con ~5-7 marcas. */
export function ticksTiempo(desde: number, hasta: number): { t: number; hora: string; dia: string | null }[] {
    const spanH = (hasta - desde) / HORA;
    const paso = [1, 2, 3, 4, 6, 12, 24, 48, 72, 120, 168].find((p) => p >= spanH / 6) ?? 168;
    const out: { t: number; hora: string; dia: string | null }[] = [];
    const base = Math.ceil((desde + OFFSET_CHIHUAHUA_MS) / (paso * HORA)) * paso * HORA - OFFSET_CHIHUAHUA_MS;
    for (let t = base; t <= hasta + 1; t += paso * HORA) {
        const local = new Date(t + OFFSET_CHIHUAHUA_MS);
        const medianoche = local.getUTCHours() === 0 && local.getUTCMinutes() === 0;
        out.push({ t, hora: paso >= 24 ? diaTxt(t) : horaTxt(t), dia: paso < 24 && (medianoche || out.length === 0) ? diaTxt(t) : null });
    }
    return out;
}

function segmentos(pts: PuntoBanda[], gapMs: number): PuntoBanda[][] {
    const out: PuntoBanda[][] = [];
    let cur: PuntoBanda[] = [];
    for (const p of pts) {
        if (!fin(p.v)) continue;
        if (cur.length && p.t - cur[cur.length - 1].t > gapMs) { out.push(cur); cur = []; }
        cur.push(p);
    }
    if (cur.length) out.push(cur);
    return out;
}

export interface SerieLinea { id: string; etiqueta: string; color: string; dash: string; pts: PuntoBanda[] }
export const DASHES_ESTACION = ['', '7 3', '2 3', '9 3 2 3'];

export interface OpcionesLineas {
    desde: number; hasta: number; unidad: string; decimales: number; titulo: string;
    ancho?: number; alto?: number; desdeCero?: boolean; banda?: boolean; pasoMin: number;
    /** Sin etiquetas directas ni leyenda (panel pequeño de una sola serie). */
    compacto?: boolean;
}

/** Gráfica de líneas con eje de tiempo local, banda mín–máx, huecos que cortan la línea y etiquetas directas. */
export function svgLineas(series: SerieLinea[], o: OpcionesLineas): string {
    const W = o.ancho ?? 720, H = o.alto ?? 250;
    const con = series.filter((s) => s.pts.some((p) => fin(p.v)));
    if (!con.length) return svgVacio(W, H, o.titulo);
    const compacto = !!o.compacto;
    const ml = 50, mr = compacto ? 12 : 104, mt = compacto ? 26 : series.length > 1 ? 40 : 28, mb = 40;
    const pw = W - ml - mr, ph = H - mt - mb;
    const gap = Math.max(o.pasoMin * 60000 * 2.5, 100 * 60000);
    let mn = Infinity, mx = -Infinity;
    for (const s of con) for (const p of s.pts) {
        const a = o.banda === false ? p.v : p.min, b = o.banda === false ? p.v : p.max;
        if (a < mn) mn = a;
        if (b > mx) mx = b;
    }
    if (o.desdeCero) mn = Math.min(0, mn);
    const tk = ticksNice(mn, mx);
    const lo = o.desdeCero ? Math.min(0, tk.lo) : tk.lo, hi = tk.hi;
    const x = (t: number) => ml + ((t - o.desde) / (o.hasta - o.desde)) * pw;
    const y = (v: number) => mt + ph - ((v - lo) / (hi - lo)) * ph;

    let g = abrir(W, H, o.titulo);
    // Rejilla y eje Y
    for (const v of tk.t) {
        if (v < lo - 1e-9 || v > hi + 1e-9) continue;
        g += `<line x1="${ml}" x2="${ml + pw}" y1="${f1(y(v))}" y2="${f1(y(v))}" stroke="${GRID}"/>`
            + `<text x="${ml - 6}" y="${f1(y(v) + 3.5)}" text-anchor="end" font-size="10.5" fill="${INK2}">${e(fmt(v, tk.dec))}</text>`;
    }
    g += `<text x="${ml - 6}" y="${mt - 12}" text-anchor="end" font-size="10.5" font-weight="700" fill="${INK}">${e(o.unidad)}</text>`;
    // Eje X
    const by = mt + ph;
    g += `<line x1="${ml}" x2="${ml + pw}" y1="${by}" y2="${by}" stroke="${AXIS}"/>`;
    for (const k of ticksTiempo(o.desde, o.hasta)) {
        const xx = x(k.t);
        if (xx < ml - 1 || xx > ml + pw + 1) continue;
        g += `<line x1="${f1(xx)}" x2="${f1(xx)}" y1="${by}" y2="${by + 4}" stroke="${AXIS}"/>`
            + `<text x="${f1(xx)}" y="${by + 16}" text-anchor="middle" font-size="10.5" fill="${INK2}">${e(k.hora)}</text>`
            + (k.dia ? `<text x="${f1(xx)}" y="${by + 29}" text-anchor="middle" font-size="10" fill="${SD}">${e(k.dia)}</text>` : '');
    }
    // Bandas, líneas
    const etiquetas: { y: number; txt: string; color: string }[] = [];
    for (const s of con) {
        const segs = segmentos(s.pts, gap);
        if (o.banda !== false) {
            for (const sg of segs) {
                if (sg.length < 2) continue;
                const arriba = sg.map((p) => `${f1(x(p.t))},${f1(y(p.max))}`);
                const abajo = sg.slice().reverse().map((p) => `${f1(x(p.t))},${f1(y(p.min))}`);
                g += `<polygon points="${arriba.concat(abajo).join(' ')}" fill="${s.color}" fill-opacity="0.13"/>`;
            }
        }
        for (const sg of segs) {
            if (sg.length === 1) g += `<circle cx="${f1(x(sg[0].t))}" cy="${f1(y(sg[0].v))}" r="2.6" fill="${s.color}" stroke="#fff" stroke-width="1"/>`;
            else g += `<polyline points="${sg.map((p) => `${f1(x(p.t))},${f1(y(p.v))}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`;
        }
        const ult = s.pts[s.pts.length - 1];
        if (ult && !compacto) etiquetas.push({ y: y(ult.v), txt: s.etiqueta, color: s.color });
    }
    // Etiquetas directas sin encimarse
    etiquetas.sort((a, b) => a.y - b.y);
    for (let i = 1; i < etiquetas.length; i++) if (etiquetas[i].y - etiquetas[i - 1].y < 13) etiquetas[i].y = etiquetas[i - 1].y + 13;
    for (const l of etiquetas) g += `<rect x="${ml + pw + 6}" y="${f1(l.y - 5)}" width="8" height="8" rx="2" fill="${l.color}"/><text x="${ml + pw + 18}" y="${f1(l.y + 4)}" font-size="10.5" font-weight="600" fill="${INK}">${e(l.txt)}</text>`;
    // Leyenda (≥ 2 series): muestra del trazo + nombre; marca las series sin dato
    if (!compacto && series.length > 1) {
        let lx = ml;
        for (const s of series) {
            const sd = !s.pts.length;
            g += `<line x1="${lx}" x2="${lx + 20}" y1="12" y2="12" stroke="${s.color}" stroke-width="2.4"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}${sd ? ' opacity="0.4"' : ''}/>`
                + `<text x="${lx + 25}" y="16" font-size="10.5" fill="${sd ? SD : INK}">${e(s.etiqueta + (sd ? ' (S/D)' : ''))}</text>`;
            lx += 25 + (s.etiqueta.length + (sd ? 6 : 0)) * 6 + 16;
        }
    }
    if (o.banda !== false && !compacto) g += `<text x="${ml + pw}" y="${H - 3}" text-anchor="end" font-size="10" fill="${SD}">Banda sombreada: mínimo–máximo de cada intervalo · hora de Chihuahua</text>`;
    return g + '</svg>';
}

export interface OpcionesSpark { ejes?: boolean; decimales?: number }

/** Línea de 24 h con punto final; con `ejes` rotula máximo, mínimo y tiempo. Sin 2 puntos → S/D. */
export function svgSpark(pts: PuntoBanda[], color: string, titulo: string, w = 150, h = 34, o: OpcionesSpark = {}): string {
    const v = pts.filter((p) => fin(p.v));
    if (v.length < 2) return `${abrir(w, h, titulo)}<line x1="2" x2="${w - 2}" y1="${h / 2}" y2="${h / 2}" stroke="${AXIS}" stroke-dasharray="3 3"/><text x="${w / 2}" y="${h / 2 - 4}" text-anchor="middle" font-size="10.5" fill="${SD}">S/D</text></svg>`;
    const mn = Math.min(...v.map((p) => p.v)), mx = Math.max(...v.map((p) => p.v));
    const t0 = v[0].t, t1 = v[v.length - 1].t;
    const ejes = !!o.ejes, dec = o.decimales ?? 1;
    const x0 = ejes ? 44 : 3, x1 = w - 6, y0 = ejes ? 8 : 4, y1 = ejes ? h - 18 : h - 4;
    const x = (t: number) => x0 + ((t - t0) / Math.max(1, t1 - t0)) * (x1 - x0);
    const y = (val: number) => (mx > mn ? y1 - ((val - mn) / (mx - mn)) * (y1 - y0) : (y0 + y1) / 2);
    const segs = segmentos(v, 3 * HORA);
    let g = abrir(w, h, titulo);
    if (ejes) {
        g += `<line x1="${x0}" x2="${x1}" y1="${y1 + 4}" y2="${y1 + 4}" stroke="${GRID}"/>`
            + `<text x="${x0 - 5}" y="${f1(y(mx) + 4)}" text-anchor="end" font-size="10.5" fill="${INK2}">${e(fmt(mx, dec))}</text>`
            + `<text x="${x0 - 5}" y="${f1(y(mn) + 4)}" text-anchor="end" font-size="10.5" fill="${INK2}">${e(fmt(mn, dec))}</text>`
            + `<text x="${x0}" y="${h - 3}" font-size="10" fill="${SD}">−24 h</text><text x="${x1}" y="${h - 3}" text-anchor="end" font-size="10" fill="${SD}">último dato</text>`;
    }
    for (const sg of segs) if (sg.length > 1) g += `<polyline points="${sg.map((p) => `${f1(x(p.t))},${f1(y(p.v))}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${ejes ? 2 : 1.8}" stroke-linejoin="round"/>`;
    const u = v[v.length - 1];
    return g + `<circle cx="${f1(x(u.t))}" cy="${f1(y(u.v))}" r="3" fill="${color}" stroke="#fff" stroke-width="1.2"/></svg>`;
}

export interface FilaCaja { etiqueta: string; color: string; min: number | null; p10: number | null; mediana: number | null; media: number | null; p90: number | null; max: number | null }

/** Distribución por estación en una misma escala: bigote mín–máx, caja p10–p90, raya = mediana, rombo = media. */
export function svgCajas(filas: FilaCaja[], o: { unidad: string; decimales: number; titulo: string; ancho?: number }): string {
    const W = o.ancho ?? 720, rowH = 34, mt = 8, mb = 40, ml = 128, mr = 24;
    const H = mt + filas.length * rowH + mb;
    const con = filas.filter((f) => fin(f.min) && fin(f.max));
    if (!con.length) return svgVacio(W, 90, o.titulo, 'S/D — sin lecturas para describir la distribución');
    const mx = Math.max(...con.map((f) => f.max!)), mn = Math.min(0, ...con.map((f) => f.min!));
    const tk = ticksNice(mn, mx, 5);
    const pw = W - ml - mr;
    const x = (v: number) => ml + ((v - tk.lo) / (tk.hi - tk.lo)) * pw;
    let g = abrir(W, H, o.titulo);
    for (const v of tk.t) g += `<line x1="${f1(x(v))}" x2="${f1(x(v))}" y1="${mt}" y2="${H - mb}" stroke="${GRID}"/><text x="${f1(x(v))}" y="${H - mb + 14}" text-anchor="middle" font-size="10.5" fill="${INK2}">${e(fmt(v, tk.dec))}</text>`;
    g += `<line x1="${ml}" x2="${ml + pw}" y1="${H - mb}" y2="${H - mb}" stroke="${AXIS}"/><text x="${ml + pw}" y="${H - 6}" text-anchor="end" font-size="10.5" font-weight="700" fill="${INK}">${e(o.unidad)}</text>`;
    filas.forEach((f, i) => {
        const cy = mt + i * rowH + rowH / 2;
        g += `<rect x="4" y="${f1(cy - 5)}" width="9" height="9" rx="2" fill="${f.color}"/><text x="18" y="${f1(cy + 4)}" font-size="11" font-weight="600" fill="${INK}">${e(f.etiqueta)}</text>`;
        if (!fin(f.min) || !fin(f.max)) { g += `<text x="${ml + 6}" y="${f1(cy + 4)}" font-size="11" fill="${SD}" font-style="italic">S/D</text>`; return; }
        g += `<line x1="${f1(x(f.min))}" x2="${f1(x(f.max))}" y1="${cy}" y2="${cy}" stroke="${f.color}" stroke-width="1.6"/>`
            + `<line x1="${f1(x(f.min))}" x2="${f1(x(f.min))}" y1="${cy - 5}" y2="${cy + 5}" stroke="${f.color}" stroke-width="1.6"/><line x1="${f1(x(f.max))}" x2="${f1(x(f.max))}" y1="${cy - 5}" y2="${cy + 5}" stroke="${f.color}" stroke-width="1.6"/>`;
        if (fin(f.p10) && fin(f.p90)) g += `<rect x="${f1(x(f.p10))}" y="${cy - 8}" width="${f1(Math.max(2, x(f.p90) - x(f.p10)))}" height="16" rx="2" fill="${f.color}" fill-opacity="0.22" stroke="${f.color}" stroke-width="1.4"/>`;
        if (fin(f.mediana)) g += `<line x1="${f1(x(f.mediana))}" x2="${f1(x(f.mediana))}" y1="${cy - 8}" y2="${cy + 8}" stroke="${INK}" stroke-width="2.2"/>`;
        if (fin(f.media)) g += `<path d="M${f1(x(f.media))} ${cy - 4.5} l4.5 4.5 l-4.5 4.5 l-4.5 -4.5 z" fill="#fff" stroke="${INK}" stroke-width="1.4"/>`;
    });
    return g + '</svg>';
}

export interface FilaBarra { etiqueta: string; color: string; valor: number | null; nota: string }

/** Barras horizontales (magnitud) con extremo redondeado en el dato; S/D se rotula y no dibuja barra. */
export function svgBarras(filas: FilaBarra[], o: { unidad: string; decimales: number; titulo: string; ancho?: number }): string {
    const W = o.ancho ?? 720, rowH = 36, mt = 6, ml = 128, mr = 220;
    const H = mt + filas.length * rowH + 22;
    const mx = Math.max(0, ...filas.map((f) => (fin(f.valor) ? f.valor : 0)));
    if (!filas.some((f) => fin(f.valor))) return svgVacio(W, 90, o.titulo, 'S/D — no hay tramos con lectura continua para integrar volumen');
    const pw = W - ml - mr;
    const x = (v: number) => ml + (mx > 0 ? (v / mx) * pw : 0);
    let g = abrir(W, H, o.titulo) + `<line x1="${ml}" x2="${ml}" y1="${mt}" y2="${H - 22}" stroke="${AXIS}"/>`;
    filas.forEach((f, i) => {
        const cy = mt + i * rowH + rowH / 2;
        g += `<rect x="4" y="${f1(cy - 5)}" width="9" height="9" rx="2" fill="${f.color}"/><text x="18" y="${f1(cy + 4)}" font-size="11" font-weight="600" fill="${INK}">${e(f.etiqueta)}</text>`;
        if (!fin(f.valor)) { g += `<text x="${ml + 8}" y="${f1(cy + 4)}" font-size="11" fill="${SD}" font-style="italic">S/D</text>`; return; }
        const w = Math.max(3, x(f.valor) - ml);
        g += `<path d="M${ml} ${cy - 9} h${f1(Math.max(0, w - 4))} a4 4 0 0 1 4 4 v10 a4 4 0 0 1 -4 4 h-${f1(Math.max(0, w - 4))} z" fill="${f.color}"/>`
            + `<text x="${f1(ml + w + 8)}" y="${f1(cy + 4)}" font-size="11" font-weight="700" fill="${INK}">${e(fmt(f.valor, o.decimales))} ${e(o.unidad)}</text>`
            + `<text x="${f1(ml + w + 8)}" y="${f1(cy + 16)}" font-size="10" fill="${INK2}">${e(f.nota)}</text>`;
    });
    return g + `<text x="${ml}" y="${H - 6}" font-size="10" fill="${SD}">Escala desde 0 · una sola unidad (${e(o.unidad)})</text></svg>`;
}

/** Tira de 24 horas del enlace: cuadrado lleno = mensaje bueno, con × = solo mensajes con falla, vacío punteado = ninguno. */
export function svgTiraEnlace(celdas: CeldaEnlace[], titulo: string, w = 300): string {
    const n = celdas.length || 24, gap = 2, cw = (w - gap * (n - 1)) / n, h = 40;
    let g = abrir(w, h, titulo);
    celdas.forEach((c, i) => {
        const cx = i * (cw + gap);
        if (c === 'bueno') g += `<rect x="${f1(cx)}" y="2" width="${f1(cw)}" height="16" rx="2" fill="${COLOR_OK}"/>`;
        else if (c === 'falla') g += `<rect x="${f1(cx)}" y="2" width="${f1(cw)}" height="16" rx="2" fill="${COLOR_AVISO}"/><path d="M${f1(cx + 2)} 5 L${f1(cx + cw - 2)} 15 M${f1(cx + cw - 2)} 5 L${f1(cx + 2)} 15" stroke="#fff" stroke-width="1.4"/>`;
        else g += `<rect x="${f1(cx + 0.5)}" y="2.5" width="${f1(cw - 1)}" height="15" rx="2" fill="#fff" stroke="${AXIS}" stroke-dasharray="2 2"/>`;
    });
    for (const [i, t] of [[0, '−24 h'], [6, '−18 h'], [12, '−12 h'], [18, '−6 h']] as [number, string][]) g += `<text x="${f1(i * (cw + gap))}" y="33" font-size="10" fill="${INK2}">${t}</text>`;
    return g + `<text x="${w}" y="33" text-anchor="end" font-size="10" fill="${INK2}">ahora</text></svg>`;
}

/** Barra de cobertura 0–100 % con la marca del umbral de confiabilidad y glifo de estado (no depende solo del color). */
export function svgSemaforoCobertura(pct: number | null, umbral: number, titulo: string, w = 170): string {
    const h = 20;
    if (!fin(pct)) return `${abrir(w, h, titulo)}<text x="2" y="14" font-size="11" fill="${SD}" font-style="italic">S/D</text></svg>`;
    const ok = pct >= umbral, parcial = !ok && pct >= 50;
    const color = ok ? COLOR_OK : parcial ? COLOR_AVISO : COLOR_MAL;
    const bw = w - 78, glifo = ok ? '●' : parcial ? '▲' : '■';
    const txt = ok ? 'Confiable' : parcial ? 'Parcial' : 'Insuficiente';
    return `${abrir(w, h, titulo)}<rect x="0" y="6" width="${bw}" height="8" rx="4" fill="#ece9e2"/><rect x="0" y="6" width="${f1((Math.min(100, Math.max(0, pct)) / 100) * bw)}" height="8" rx="4" fill="${color}"/>`
        + `<line x1="${f1((umbral / 100) * bw)}" x2="${f1((umbral / 100) * bw)}" y1="2" y2="18" stroke="${INK}" stroke-width="1.2"/>`
        + `<text x="${bw + 6}" y="14" font-size="10.5" font-weight="700" fill="${color}">${glifo} ${txt}</text></svg>`;
}

export { COLOR_INSTITUCIONAL };
