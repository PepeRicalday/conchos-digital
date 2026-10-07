/**
 * informeNdviSvgComparativo — gráficos SVG PUROS de los modos Tendencia y Comparativo del informe NDVI.
 * Para comparar se usa POSICIÓN y LONGITUD (no más tonos): la rampa de color queda exclusiva para la clase de NDVI.
 * Las flechas ▲ ▼ ■ acompañan siempre al color/posición, así que se leen en blanco y negro.
 */
import { NDVI_RANGO } from './ndviRampa';
import { escSvg } from './informeHistoricoSvg';
import { mesLegible } from './informeBase';

const INK = '#1f2328', INK2 = '#57606a', GRID = '#e3e1dc';
const FONT = 'font-family="Segoe UI, Helvetica, Arial, sans-serif"';
const f1 = (n: number) => n.toFixed(1);
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
        const estilo = Math.abs(d) < 0.005 ? 'stroke="#8c959f" stroke-width="1.2"' : d > 0 ? `stroke="${INK}" stroke-width="2.2"` : `stroke="${INK}" stroke-width="2.2" stroke-dasharray="5 3"`;
        return `<line x1="${xa}" y1="${f1(y(f.a))}" x2="${xb}" y2="${f1(y(f.b))}" ${estilo}/><circle cx="${xa}" cy="${f1(y(f.a))}" r="3" fill="${INK}"/><circle cx="${xb}" cy="${f1(y(f.b))}" r="3" fill="${INK}"/>`;
    }).join('');
    const etA = ladoA.map((p) => `<text x="${xa - 9}" y="${f1(p.y + 3)}" text-anchor="end" font-size="9.5" fill="${INK}" ${FONT}>${escSvg(filas[p.i].etiqueta)} <tspan font-weight="700">${fmtN(filas[p.i].a as number, 2)}</tspan></text>`).join('');
    const etB = ladoB.map((p) => `<text x="${xb + 9}" y="${f1(p.y + 3)}" font-size="9.5" fill="${INK}" ${FONT}><tspan font-weight="700">${fmtN(filas[p.i].b as number, 2)}</tspan> ${escSvg(filas[p.i].etiqueta)}</text>`).join('');
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Comparación de NDVI por módulo entre ${escSvg(etiquetaA)} y ${escSvg(etiquetaB)}">
<text x="${xa}" y="14" text-anchor="middle" font-size="10" font-weight="700" fill="${INK2}" ${FONT}>A · ${escSvg(etiquetaA)}</text>
<text x="${xb}" y="14" text-anchor="middle" font-size="10" font-weight="700" fill="${INK2}" ${FONT}>B · ${escSvg(etiquetaB)}</text>
<line x1="${xa}" y1="${T - 8}" x2="${xa}" y2="${h - B}" stroke="${GRID}"/><line x1="${xb}" y1="${T - 8}" x2="${xb}" y2="${h - B}" stroke="${GRID}"/>
${lineas}${etA}${etB}</svg>`;
}

/** Barras horizontales divergentes desde cero (derecha = sube, izquierda = baja), con ▲▼■ y el valor. */
export function svgBarrasDelta(items: { etiqueta: string; valor: number | null }[], decimales = 3, w = 560): string {
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
        const etq = `<text x="${L - 8}" y="${yy + 12}" text-anchor="end" font-size="9.5" fill="${INK}" ${FONT}>${escSvg(it.etiqueta)}</text>`;
        if (it.valor == null) return `${etq}<text x="${f1(cx + 6)}" y="${yy + 12}" font-size="9.5" fill="#8c959f" font-style="italic" ${FONT}>S/D</text>`;
        const len = Math.abs(it.valor) * px;
        const x = it.valor >= 0 ? cx : cx - len;
        // El valor va del lado libre de la fila: las barras negativas lo llevan a la derecha del eje (nunca sobre los nombres).
        const tx = it.valor >= 0 ? cx + len + 5 : cx + 6;
        return `${etq}<rect x="${f1(x)}" y="${yy + 2}" width="${f1(Math.max(len, 1))}" height="11" fill="${it.valor >= 0 ? '#57606a' : '#a8afb7'}"/>
<text x="${f1(tx)}" y="${yy + 12}" font-size="9.5" font-weight="700" fill="${INK}" ${FONT}>${signoDelta(it.valor, decimales)}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Diferencias por elemento"><line x1="${f1(cx)}" y1="0" x2="${f1(cx)}" y2="${h}" stroke="${INK}" stroke-width="1"/>${barras}</svg>`;
}

/** Líneas genéricas por mes con etiqueta directa al final (módulo vs módulo, módulo vs SRL). */
export function svgLineasSimples(meses: string[], series: { etiqueta: string; color: string; vals: (number | null)[]; dash?: string; ancho?: number }[], w = 620, h = 190): string {
    if (!meses.length || !series.some((s) => s.vals.some((v) => v != null))) return '';
    const L = 38, R = 110, T = 10, B = 26;
    const [lo, hi] = NDVI_RANGO;
    const x = (i: number) => L + (meses.length === 1 ? (w - L - R) / 2 : (i * (w - L - R)) / (meses.length - 1));
    const y = (v: number) => T + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (h - T - B);
    const grid = [0, 0.2, 0.4, 0.6, 0.8].map((t) => `<line x1="${L}" y1="${f1(y(t))}" x2="${w - R}" y2="${f1(y(t))}" stroke="${GRID}"/><text x="${L - 6}" y="${f1(y(t) + 3)}" text-anchor="end" font-size="9" fill="${INK2}" ${FONT}>${t.toFixed(1)}</text>`).join('');
    const ejeX = meses.map((m, i) => `<text x="${f1(x(i))}" y="${h - 8}" text-anchor="middle" font-size="9" fill="${INK2}" ${FONT}>${escSvg(mesLegible(m, true))}</text>`).join('');
    const trazos = series.map((s) => {
        let d = '', pen = false;
        s.vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${f1(x(i))} ${f1(y(v))} `; pen = true; });
        const pts = s.vals.map((v, i) => (v == null ? '' : `<circle cx="${f1(x(i))}" cy="${f1(y(v))}" r="2.4" fill="${s.color}"/>`)).join('');
        return d ? `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.ancho ?? 2}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round"/>${pts}` : '';
    }).join('');
    const fin = series.map((s, k) => { let i = s.vals.length - 1; while (i >= 0 && s.vals[i] == null) i--; return i < 0 ? null : { k, yy: y(s.vals[i] as number), xx: x(i) }; })
        .filter((s): s is NonNullable<typeof s> => !!s);
    const sep = separa(fin.map((s) => ({ i: s.k, y: s.yy })));
    const etq = sep.map((p) => {
        const s = series[p.i], xx = fin.find((q) => q.k === p.i)?.xx ?? w - R;
        return `<text x="${f1(xx + 7)}" y="${f1(p.y + 3)}" font-size="9.5" font-weight="700" fill="${s.color}" ${FONT}>${escSvg(s.etiqueta)}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Serie mensual comparada de NDVI">${grid}${ejeX}${trazos}${etq}</svg>`;
}

/** Barras pareadas: A hacia la izquierda y B hacia la derecha de un eje común, cada indicador en su propia escala. */
export function svgBarrasPareadas(items: { etiqueta: string; a: number | null; b: number | null; max: number; decimales: number }[], nombreA: string, nombreB: string, colorA: string, colorB: string, w = 560): string {
    if (!items.some((i) => i.a != null || i.b != null)) return '';
    const fila = 28, T = 24, h = T + items.length * fila + 4, cx = w / 2, ancho = w / 2 - 60;
    const filas = items.map((it, k) => {
        const yy = T + k * fila;
        const lenA = it.a != null ? Math.min(1, it.a / it.max) * ancho : 0, lenB = it.b != null ? Math.min(1, it.b / it.max) * ancho : 0;
        return `<rect x="${f1(cx - lenA)}" y="${yy + 6}" width="${f1(lenA)}" height="14" fill="${colorA}" opacity="0.85"/><rect x="${f1(cx)}" y="${yy + 6}" width="${f1(lenB)}" height="14" fill="${colorB}" opacity="0.85"/>
<text x="${f1(cx - lenA - 5)}" y="${yy + 17}" text-anchor="end" font-size="9.5" font-weight="700" fill="${INK}" ${FONT}>${it.a != null ? fmtN(it.a, it.decimales) : 'S/D'}</text>
<text x="${f1(cx + lenB + 5)}" y="${yy + 17}" font-size="9.5" font-weight="700" fill="${INK}" ${FONT}>${it.b != null ? fmtN(it.b, it.decimales) : 'S/D'}</text>
<text x="4" y="${yy + 16}" font-size="9" font-weight="600" fill="${INK2}" ${FONT}>${escSvg(it.etiqueta)}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Comparación de indicadores entre ${escSvg(nombreA)} y ${escSvg(nombreB)}">
<text x="${f1(cx - 8)}" y="13" text-anchor="end" font-size="10" font-weight="700" fill="${INK}" ${FONT}>◀ ${escSvg(nombreA)}</text><text x="${f1(cx + 8)}" y="13" font-size="10" font-weight="700" fill="${INK}" ${FONT}>${escSvg(nombreB)} ▶</text>
<line x1="${cx}" y1="${T - 2}" x2="${cx}" y2="${h}" stroke="${INK}"/>${filas}</svg>`;
}
