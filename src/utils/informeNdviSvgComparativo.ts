/**
 * informeNdviSvgComparativo — gráficos SVG PUROS de los modos Tendencia y Comparativo del informe NDVI.
 * Para comparar se usa POSICIÓN y LONGITUD (no más tonos): la rampa de color queda exclusiva para la clase de NDVI.
 * Las flechas ▲ ▼ ■ acompañan siempre al color/posición, así que se leen en blanco y negro.
 */
import { NDVI_RANGO, NDVI_TICKS } from './ndviRampa';
import { UMBRAL_SIN_CAMBIO } from './ndviInteranual';
import { escSvg } from './informeHistoricoSvg';
import { mesLegible } from './informeBase';
import { FS_MIN, TRAZO_MODULO, formaDeModulo, formaSvg, rotuloModuloSvg, rotuloSrlSvg, type FormaMarcador } from './informeNdviMarcas';

const INK = '#1f2328', INK2 = '#57606a', GRID = '#e3e1dc';
const f1 = (n: number) => n.toFixed(1);

/** Identificador estable (no un contador global: el HTML generado no cambia según el orden de llamada). */
const idDe = (txt: string): string => { let h = 5381; for (let i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) | 0; return `s${(h >>> 0).toString(36)}`; };

/** Atributos + <title>/<desc> de un SVG: lectores de pantalla y texto alterno de la imagen con las cifras clave (no solo "gráfica"). */
export function cabeceraSvg(titulo: string, desc: string): { attrs: string; tags: string } {
    const id = idDe(`${titulo}|${desc}`);
    return { attrs: `role="img" aria-labelledby="${id}t ${id}d"`, tags: `<title id="${id}t">${escSvg(titulo)}</title><desc id="${id}d">${escSvg(desc)}</desc>` };
}
const num2 = (v: number | null | undefined, d = 2): string => (v == null || !Number.isFinite(v) ? 'S/D' : v.toFixed(d));

/** Etiqueta directa de una línea: muestra del trazo + nombre en tinta oscura (el texto de color claro sobre papel no llega a 4.5:1). */
export function etiquetaLinea(x: number, y: number, texto: string, color: string, fs = FS_MIN, dash = ''): string {
    return `<line x1="${f1(x)}" y1="${f1(y)}" x2="${f1(x + 12)}" y2="${f1(y)}" stroke="${color}" stroke-width="2.4"${dash ? ` stroke-dasharray="${dash}"` : ''}/><text x="${f1(x + 16)}" y="${f1(y + fs * 0.35)}" font-size="${fs}" font-weight="700" fill="${INK}">${escSvg(texto)}</text>`;
}
const fmtN = (v: number, d: number) => v.toFixed(d);

/** ▲ +0.054 · ▼ −0.136 · ■ 0.000 (si |v| es menor que media unidad del último decimal). */
export const signoDelta = (v: number, d: number): string =>
    Math.abs(v) < 0.5 * 10 ** -d ? `■ ${fmtN(0, d)}` : v > 0 ? `▲ +${fmtN(v, d)}` : `▼ −${fmtN(Math.abs(v), d)}`;

/** Separa etiquetas verticalmente (mínimo `paso` px) conservando el orden. */
function separa(ys: { i: number; y: number }[], paso = 11): { i: number; y: number }[] {
    ys.sort((p, q) => p.y - q.y);
    for (let k = 1; k < ys.length; k++) if (ys[k].y - ys[k - 1].y < paso) ys[k].y = ys[k - 1].y + paso;
    return ys;
}

/** Gráfica de pendiente (slope chart): un valor por módulo en A (izquierda) y en B (derecha), unidos por una línea. */
export function svgPendienteSlope(filas: { etiqueta: string; a: number | null; b: number | null }[], etiquetaA: string, etiquetaB: string, w = 600, h = 250): string {
    if (!filas.some((f) => f.a != null || f.b != null)) return '';
    const [lo, hi] = NDVI_RANGO, T = 34, B = 14, xa = 190, xb = w - 190;
    const y = (v: number) => T + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (h - T - B);
    const ladoA = separa(filas.map((f, i) => ({ i, y: f.a != null ? y(f.a) : NaN })).filter((p) => Number.isFinite(p.y)));
    const ladoB = separa(filas.map((f, i) => ({ i, y: f.b != null ? y(f.b) : NaN })).filter((p) => Number.isFinite(p.y)));
    const lineas = filas.map((f) => {
        if (f.a == null || f.b == null) return '';
        const d = f.b - f.a;
        const estilo = Math.abs(d) < UMBRAL_SIN_CAMBIO ? 'stroke="#8c959f" stroke-width="1.2"' : d > 0 ? `stroke="${INK}" stroke-width="2.2"` : `stroke="${INK}" stroke-width="2.2" stroke-dasharray="5 3"`;
        return `<line x1="${xa}" y1="${f1(y(f.a))}" x2="${xb}" y2="${f1(y(f.b))}" ${estilo}/><circle cx="${xa}" cy="${f1(y(f.a))}" r="3" fill="${INK}"/><circle cx="${xb}" cy="${f1(y(f.b))}" r="3" fill="${INK}"/>`;
    }).join('');
    const etA = ladoA.map((p) => `<text x="${xa - 9}" y="${f1(p.y + 3)}" text-anchor="end" font-size="11" fill="${INK}">${escSvg(filas[p.i].etiqueta)} <tspan font-weight="700">${fmtN(filas[p.i].a as number, 2)}</tspan></text>`).join('');
    const etB = ladoB.map((p) => `<text x="${xb + 9}" y="${f1(p.y + 3)}" font-size="11" fill="${INK}"><tspan font-weight="700">${fmtN(filas[p.i].b as number, 2)}</tspan> ${escSvg(filas[p.i].etiqueta)}</text>`).join('');
    const cab = cabeceraSvg(`Comparación de NDVI por módulo entre ${etiquetaA} y ${etiquetaB}`, filas.map((f) => `${f.etiqueta}: ${num2(f.a)} en A y ${num2(f.b)} en B`).join('; '));
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;display:block" ${cab.attrs}>${cab.tags}
<text x="${xa}" y="14" text-anchor="middle" font-size="${FS_MIN}" font-weight="700" fill="${INK2}">A · ${escSvg(etiquetaA)}</text>
<text x="${xb}" y="14" text-anchor="middle" font-size="${FS_MIN}" font-weight="700" fill="${INK2}">B · ${escSvg(etiquetaB)}</text>
<line x1="${xa}" y1="${T - 8}" x2="${xa}" y2="${h - B}" stroke="${GRID}"/><line x1="${xb}" y1="${T - 8}" x2="${xb}" y2="${h - B}" stroke="${GRID}"/>
${lineas}${etA}${etB}</svg>`;
}

/** Barras horizontales divergentes desde cero (derecha = sube, izquierda = baja), con ▲▼■ y el valor. */
export function svgBarrasDelta(items: { etiqueta: string; valor: number | null }[], decimales = 3, w = 700): string {
    const validos = items.filter((i) => i.valor != null);
    if (!validos.length) return '';
    const fila = 18, L = 130, R = 96, h = items.length * fila + 8;
    // Escala proporcional a cada lado: si todo sube o todo baja, las barras usan el ancho completo en vez de la mitad.
    const pos = Math.max(0, ...validos.map((i) => i.valor as number));
    const neg = Math.max(0, ...validos.map((i) => -(i.valor as number)));
    const total = Math.max(pos + neg, 10 ** -decimales);
    const espacio = w - L - R, px = espacio / total;
    const cx = L + neg * px;
    const barras = items.map((it, k) => {
        const yy = 4 + k * fila;
        const etq = `<text x="${L - 8}" y="${yy + 12}" text-anchor="end" font-size="${FS_MIN}" fill="${INK}">${escSvg(it.etiqueta)}</text>`;
        if (it.valor == null) return `${etq}<text x="${f1(cx + 6)}" y="${yy + 12}" font-size="${FS_MIN}" fill="#8c959f" font-style="italic">S/D</text>`;
        const len = Math.abs(it.valor) * px;
        const x = it.valor >= 0 ? cx : cx - len;
        // El valor va del lado libre de la fila: las barras negativas lo llevan a la derecha del eje (nunca sobre los nombres).
        const tx = it.valor >= 0 ? cx + len + 5 : cx + 6;
        return `${etq}<rect x="${f1(x)}" y="${yy + 2}" width="${f1(Math.max(len, 1))}" height="11" fill="${it.valor >= 0 ? '#3d444d' : '#7d8590'}" stroke="${INK}" stroke-width="0.6"/>
<text x="${f1(tx)}" y="${yy + 12}" font-size="${FS_MIN}" font-weight="700" fill="${INK}">${signoDelta(it.valor, decimales)}</text>`;
    }).join('');
    const cab = cabeceraSvg('Diferencias por elemento', items.map((i) => `${i.etiqueta}: ${i.valor == null ? 'S/D' : signoDelta(i.valor, decimales)}`).join('; '));
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;display:block" ${cab.attrs}>${cab.tags}<line x1="${f1(cx)}" y1="0" x2="${f1(cx)}" y2="${h}" stroke="${INK}" stroke-width="1"/>${barras}</svg>`;
}

/** Serie de una gráfica de líneas. `modulo` = identidad por marcador, trazo y monograma (sin color); `marcador` = forma propia (p. ej. un año). */
export interface SerieLinea { etiqueta: string; color: string; vals: (number | null)[]; dash?: string; ancho?: number; modulo?: number; marcador?: FormaMarcador; foco?: boolean }

/** Tinta de un módulo en las gráficas: dos tonos alternos (junto con trazo y marcador distinguen los seis sin color). */
export const tintaDeModulo = (numero: number): string => ([1, 3, 5].includes(numero) ? INK : '#59616b');

/**
 * Líneas por mes con etiqueta directa al final (módulo vs módulo, módulo vs SRL, años).
 * `etiquetasX` reemplaza los rótulos de mes (p. ej. años). Con muchos puntos solo se rotula uno de cada k, para que no se encimen.
 * Los valores null dejan hueco (el trazo se corta): nunca se unen dos puntos separados por un S/D.
 */
export function svgLineasSimples(meses: string[], series: SerieLinea[], w = 700, h = 190, etiquetasX?: string[]): string {
    if (!meses.length || !series.some((s) => s.vals.some((v) => v != null))) return '';
    const L = 40, R = series.some((s) => s.modulo == null && s.etiqueta !== 'SRL') ? 84 : 62, T = 10, B = 28;
    const [lo, hi] = NDVI_RANGO;
    const x = (i: number) => L + (meses.length === 1 ? (w - L - R) / 2 : (i * (w - L - R)) / (meses.length - 1));
    const y = (v: number) => T + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (h - T - B);
    const grid = NDVI_TICKS.map((t) => `<line x1="${L}" y1="${f1(y(t))}" x2="${w - R}" y2="${f1(y(t))}" stroke="${GRID}"/><text x="${L - 6}" y="${f1(y(t) + 3.5)}" text-anchor="end" font-size="${FS_MIN}" fill="${INK2}">${t.toFixed(1)}</text>`).join('');
    const paso = Math.max(1, Math.ceil(meses.length / 10));
    const ejeX = meses.map((m, i) => (i % paso === 0 || i === meses.length - 1 ? `<text x="${f1(x(i))}" y="${h - 8}" text-anchor="middle" font-size="${FS_MIN}" fill="${INK2}">${escSvg(etiquetasX?.[i] ?? mesLegible(m, true))}</text>` : '')).join('');
    const estilo = (s: SerieLinea) => {
        const color = s.modulo != null ? tintaDeModulo(s.modulo) : s.color;
        const dash = s.dash ?? (s.modulo != null ? TRAZO_MODULO[s.modulo] : '');
        const forma: FormaMarcador | null = s.modulo != null ? formaDeModulo(s.modulo) : s.marcador ?? null;
        return { color, dash, forma, ancho: s.ancho ?? (s.modulo != null ? 1.5 : 2) };
    };
    const trazos = series.map((s) => {
        const e = estilo(s);
        let d = '', pen = false;
        s.vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${f1(x(i))} ${f1(y(v))} `; pen = true; });
        const pts = s.vals.map((v, i) => (v == null ? '' : e.forma ? formaSvg(e.forma, x(i), y(v), s.foco ? 4.2 : 3.4, `fill="#fff" stroke="${e.color}" stroke-width="1.3"`) : `<circle cx="${f1(x(i))}" cy="${f1(y(v))}" r="2.6" fill="${e.color}"/>`)).join('');
        return d ? `<path d="${d}" fill="none" stroke="${e.color}" stroke-width="${e.ancho}"${e.dash ? ` stroke-dasharray="${e.dash}"` : ''} stroke-linejoin="round"/>${pts}` : '';
    }).join('');
    const fin = series.map((s, k) => { let i = s.vals.length - 1; while (i >= 0 && s.vals[i] == null) i--; return i < 0 ? null : { k, yy: y(s.vals[i] as number), xx: x(i) }; })
        .filter((s): s is NonNullable<typeof s> => !!s);
    const sep = separa(fin.map((s) => ({ i: s.k, y: s.yy })), 16);
    const etq = sep.map((p) => {
        const s = series[p.i], xx = fin.find((q) => q.k === p.i)?.xx ?? w - R;
        if (s.modulo != null) return rotuloModuloSvg(s.modulo, xx + 8, p.y).svg;
        if (s.etiqueta === 'SRL') return rotuloSrlSvg(xx + 8, p.y).svg;
        const e = estilo(s);
        return etiquetaLinea(xx + 8, p.y, s.etiqueta, e.color, FS_MIN, e.dash);
    }).join('');
    const resumen = series.map((s) => { const v = s.vals.filter((q): q is number => q != null); return v.length ? `${s.etiqueta}: de ${num2(Math.min(...v), 3)} a ${num2(Math.max(...v), 3)}, último ${num2(v[v.length - 1], 3)}` : `${s.etiqueta}: S/D`; }).join('; ');
    const cab = cabeceraSvg('Serie mensual comparada de NDVI', resumen);
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;display:block" ${cab.attrs}>${cab.tags}${grid}${ejeX}${trazos}${etq}</svg>`;
}

/** Barras pareadas: A hacia la izquierda y B hacia la derecha de un eje común, cada indicador en su propia escala. */
export function svgBarrasPareadas(items: { etiqueta: string; a: number | null; b: number | null; max: number; decimales: number }[], nombreA: string, nombreB: string, colorA: string, colorB: string, w = 480): string {
    if (!items.some((i) => i.a != null || i.b != null)) return '';
    const fila = 34, T = 26, h = T + items.length * fila + 4, cx = w / 2, ancho = w / 2 - 44;
    const filas = items.map((it, k) => {
        const yy = T + k * fila;
        const lenA = it.a != null ? Math.min(1, it.a / it.max) * ancho : 0, lenB = it.b != null ? Math.min(1, it.b / it.max) * ancho : 0;
        return `<rect x="${f1(cx - lenA)}" y="${yy + 12}" width="${f1(lenA)}" height="16" fill="${colorA}" opacity="0.85"/><rect x="${f1(cx)}" y="${yy + 12}" width="${f1(lenB)}" height="16" fill="${colorB}" opacity="0.85"/>
<text x="${f1(cx - lenA - 5)}" y="${yy + 25}" text-anchor="end" font-size="11" font-weight="700" fill="${INK}">${it.a != null ? fmtN(it.a, it.decimales) : 'S/D'}</text>
<text x="${f1(cx + lenB + 5)}" y="${yy + 25}" font-size="11" font-weight="700" fill="${INK}">${it.b != null ? fmtN(it.b, it.decimales) : 'S/D'}</text>
<text x="2" y="${yy + 9}" font-size="${FS_MIN}" font-weight="600" fill="${INK2}">${escSvg(it.etiqueta)}</text>`;
    }).join('');
    const cab = cabeceraSvg(`Comparación de indicadores entre ${nombreA} y ${nombreB}`, items.map((i) => `${i.etiqueta}: ${num2(i.a, i.decimales)} en ${nombreA} y ${num2(i.b, i.decimales)} en ${nombreB}`).join('; '));
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;display:block" ${cab.attrs}>${cab.tags}
<text x="${f1(cx - 8)}" y="13" text-anchor="end" font-size="11" font-weight="700" fill="${INK}">◀ ${escSvg(nombreA)}</text><text x="${f1(cx + 8)}" y="13" font-size="11" font-weight="700" fill="${INK}">${escSvg(nombreB)} ▶</text>
<line x1="${cx}" y1="${T - 2}" x2="${cx}" y2="${h}" stroke="${INK}"/>${filas}</svg>`;
}
