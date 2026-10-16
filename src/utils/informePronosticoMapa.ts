// ═══════════════════════════════════════════════════════════════════════════
// Informe de Pronóstico básico — mapa de módulos y tira hora por hora — SICA-005
// ---------------------------------------------------------------------------
// SVG puro (el informe es un HTML autónomo que se imprime y se rasteriza a PNG).
//   · mapaProbabilidadSvg: polígonos de los 6 módulos coloreados por la
//     probabilidad de lluvia (rampa de UN solo tono azul), con el logo de cada
//     módulo y su porcentaje impreso — el color nunca es el único canal.
//   · tiraHorariaModulosSvg: una fila por módulo y una celda por hora, siempre
//     las 24/48 h completas aunque el último día quede cortado.
//
// La probabilidad de un módulo sin estación propia (2, 4 y 12) es ESTIMADA con la
// estación más cercana; se marca con asterisco y se explica en el informe.
// ═══════════════════════════════════════════════════════════════════════════
import { VIZ } from './climaCharts';
import { COLOR_MODULO, MODULOS_SRL } from './geoDistrito';
import { fmtDia, fmtHora, type ResumenModulo } from './informePronosticoDatos';
import { esNoche, horaLocal } from './informePronosticoSvg';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Rampa secuencial de un solo tono azul: más oscuro = más probable. `null` = sin dato (trama gris). */
export const RAMPA_PROB: { max: number; color: string; texto: string }[] = [
    { max: 20, color: '#eff6ff', texto: 'Menos de 20' },
    { max: 50, color: '#bfdbfe', texto: '20 a 49' },
    { max: 80, color: '#60a5fa', texto: '50 a 79' },
    { max: 101, color: '#1d4ed8', texto: '80 o más' },
];
export const colorProb = (p: number | null): string => (p == null ? '#e2e8f0' : (RAMPA_PROB.find(r => p < r.max) ?? RAMPA_PROB[3]).color);
const pct = (p: number | null) => (p == null ? 'sin dato' : `${Math.round(p)} %`);
const esEstimado = (m: ResumenModulo) => !m.propia && !m.sinEstacion;

/** Cabecera de logo de módulo: círculo recortado con la imagen, o solo el número si el logo no cargó. */
function logoCirculo(id: string, cx: number, cy: number, r: number, num: number, uri: string | undefined): string {
    if (!uri) {
        return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="#fff" stroke="${COLOR_MODULO[num] ?? VIZ.axis}" stroke-width="2.5"/>
                <text x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-size="${Math.round(r * 0.9)}" font-weight="800" fill="${VIZ.inkPrimary}" font-family="system-ui">${num}</text>`;
    }
    return `<clipPath id="${id}"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}"/></clipPath>
            <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r + 2}" fill="#fff" stroke="${COLOR_MODULO[num] ?? VIZ.axis}" stroke-width="2.5"/>
            <image href="${uri}" x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${r * 2}" height="${r * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`;
}

/** Mapa de los módulos, coloreado por probabilidad máxima de lluvia del horizonte, con logo y % en cada uno. */
export function mapaProbabilidadSvg(modulos: ResumenModulo[], logos: Map<number, string>, idPrefijo = 'mp'): string {
    const items = modulos.map(m => ({ m, anillo: MODULOS_SRL[m.numero] })).filter(x => x.anillo?.length);
    if (!items.length) return '';
    const lons = items.flatMap(x => x.anillo.map(p => p[0])), lats = items.flatMap(x => x.anillo.map(p => p[1]));
    const minLon = Math.min(...lons), maxLon = Math.max(...lons), minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const W = 360, HMAPA = 470, H = HMAPA + 64, pad = 22;
    const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const escala = Math.min((W - 2 * pad) / ((maxLon - minLon) * k), (HMAPA - 2 * pad) / (maxLat - minLat));
    const ox = (W - (maxLon - minLon) * k * escala) / 2, oy = (HMAPA - (maxLat - minLat) * escala) / 2;
    const px = (lon: number) => ox + (lon - minLon) * k * escala;
    const py = (lat: number) => HMAPA - oy - (lat - minLat) * escala;

    // Etiquetas (logo + cápsula) con anti-solape vertical: M2, M3 y M12 quedan muy juntos.
    const etq = items.map(({ m, anillo }) => ({
        m, cx: anillo.reduce((s, p) => s + px(p[0]), 0) / anillo.length, cy: anillo.reduce((s, p) => s + py(p[1]), 0) / anillo.length,
        ex: 0, ey: 0,
    }));
    etq.forEach(e => { e.ex = e.cx; e.ey = e.cy; });
    const ALTO = 50, ANCHO = 58;
    const ordenadas = [...etq].sort((a, b) => a.ey - b.ey);
    for (let it = 0; it < 12; it++) {
        let movido = false;
        for (let i = 0; i < ordenadas.length; i++) for (let j = 0; j < i; j++) {
            const a = ordenadas[i], b = ordenadas[j];
            if (Math.abs(a.ex - b.ex) < ANCHO && Math.abs(a.ey - b.ey) < ALTO) { a.ey = b.ey + ALTO; movido = true; }
        }
        if (!movido) break;
    }
    etq.forEach(e => { e.ey = Math.min(Math.max(e.ey, 30), HMAPA - 34); });

    const poligonos = items.map(({ m, anillo }) => {
        const pts = anillo.map(p => `${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join(' ');
        return `<polygon points="${pts}" fill="${colorProb(m.probMaxPct)}" stroke="#fff" stroke-width="5.5" stroke-linejoin="round"/><polygon points="${pts}" fill="none" stroke="${COLOR_MODULO[m.numero] ?? VIZ.axis}" stroke-width="2.2" stroke-linejoin="round"/>`;
    }).join('');

    const etiquetas = etq.map(e => {
        const m = e.m, desplazada = Math.hypot(e.ex - e.cx, e.ey - e.cy) > 8;
        const txt = `${m.probMaxPct == null ? 'S/D' : Math.round(m.probMaxPct) + ' %'}${esEstimado(m) ? '*' : ''}`;
        return `${desplazada ? `<line x1="${e.cx.toFixed(1)}" y1="${e.cy.toFixed(1)}" x2="${e.ex.toFixed(1)}" y2="${e.ey.toFixed(1)}" stroke="${VIZ.inkSecondary}" stroke-width="1.2"/><circle cx="${e.cx.toFixed(1)}" cy="${e.cy.toFixed(1)}" r="2.5" fill="${VIZ.inkSecondary}"/>` : ''}
            ${logoCirculo(`${idPrefijo}-lg${m.numero}`, e.ex, e.ey - 8, 15, m.numero, logos.get(m.numero))}
            <rect x="${(e.ex - 25).toFixed(1)}" y="${(e.ey + 9).toFixed(1)}" width="50" height="19" rx="9.5" fill="#fff" stroke="${COLOR_MODULO[m.numero] ?? VIZ.axis}" stroke-width="1.6"/>
            <text x="${e.ex.toFixed(1)}" y="${(e.ey + 22.5).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="800" fill="${VIZ.inkPrimary}" font-family="system-ui">${esc(txt)}</text>`;
    }).join('');

    // Leyenda de la rampa (con texto: el color solo no basta).
    const ly = HMAPA + 14, ancho = (W - 2 * 16) / RAMPA_PROB.length;
    const leyenda = `<text x="${W / 2}" y="${ly}" text-anchor="middle" font-size="12.5" font-weight="700" fill="${VIZ.inkPrimary}" font-family="system-ui">Probabilidad de lluvia (la más alta de las próximas horas)</text>`
        + RAMPA_PROB.map((r, i) => `<rect x="${16 + i * ancho}" y="${ly + 8}" width="${ancho - 4}" height="12" rx="3" fill="${r.color}" stroke="${VIZ.axis}"/>
            <text x="${16 + i * ancho + (ancho - 4) / 2}" y="${ly + 34}" text-anchor="middle" font-size="12" fill="${VIZ.inkPrimary}" font-family="system-ui">${r.texto} %</text>`).join('');

    const resumen = modulos.map(m => `Módulo ${m.numero}: ${pct(m.probMaxPct)}`).join('; ');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Mapa de módulos con la probabilidad de lluvia. ${esc(resumen)}">
        <rect width="${W}" height="${HMAPA}" rx="14" fill="#f8fafc"/>
        ${poligonos}${etiquetas}${leyenda}
    </svg>`;
}

/**
 * Tira hora por hora: una fila por módulo, una celda por hora del horizonte completo, color por probabilidad de
 * lluvia de esa hora. Un punto blanco marca las horas con lluvia apreciable (≥ 2.5 mm). Celdas sin pronóstico
 * llevan trama (no son 0 %). `ancho` 720 (normal) o ~480 (imagen compartible).
 */
export function tiraHorariaModulosSvg(modulos: ResumenModulo[], ejeHoras: number[], logos: Map<number, string>, ancho = 720, idPrefijo = 'th'): string {
    if (!modulos.length || ejeHoras.length < 2) return '';
    const ML = ancho < 600 ? 62 : 78, MR = ancho < 600 ? 6 : 96, FILA = 26, MT = 32, MB = 36;
    const W = ancho, iw = W - ML - MR, n = ejeHoras.length, cw = iw / n;
    const H = MT + modulos.length * FILA + MB;

    // Franja día/noche arriba de las filas.
    const franja = ejeHoras.map((ts, i) => `<rect x="${(ML + i * cw).toFixed(1)}" y="${MT - 10}" width="${(cw + 0.4).toFixed(1)}" height="7" fill="${esNoche(ts) ? '#475569' : '#fde68a'}"/>`).join('');

    const filas = modulos.map((m, r) => {
        const yy = MT + r * FILA;
        const porTs = new Map(m.horas.map(h => [h.ts, h]));
        let pico: { i: number; p: number } | null = null;
        const celdas = ejeHoras.map((ts, i) => {
            const h = porTs.get(ts);
            const x = ML + i * cw;
            if (!h || h.probPct == null) return `<rect x="${x.toFixed(1)}" y="${yy + 2}" width="${(cw - 0.8).toFixed(1)}" height="${FILA - 6}" fill="url(#${idPrefijo}-sin)"/>`;
            if (!pico || h.probPct > pico.p) pico = { i, p: h.probPct };
            const punto = (h.precipMm ?? 0) >= 2.5 ? `<circle cx="${(x + (cw - 0.8) / 2).toFixed(1)}" cy="${yy + (FILA - 4) / 2 + 2}" r="${Math.min(2.6, cw / 3).toFixed(1)}" fill="#fff" stroke="#1e3a8a" stroke-width="0.8"/>` : '';
            return `<rect x="${x.toFixed(1)}" y="${yy + 2}" width="${(cw - 0.8).toFixed(1)}" height="${FILA - 6}" fill="${colorProb(h.probPct)}"/>${punto}`;
        }).join('');
        const marca = pico && (pico as { i: number; p: number }).p >= 20
            ? (() => {
                const pk = pico as { i: number; p: number };
                const x = ML + pk.i * cw;
                const horaPk = fmtHora(ejeHoras[pk.i]).slice(0, 5);
                return `<rect x="${x.toFixed(1)}" y="${yy + 1}" width="${(cw - 0.8).toFixed(1)}" height="${FILA - 4}" fill="none" stroke="${VIZ.inkPrimary}" stroke-width="1.8"/>
                        ${ancho >= 600 ? `<text x="${W - MR + 6}" y="${yy + 16}" font-size="11" font-weight="700" fill="${VIZ.inkPrimary}" font-family="system-ui">pico ${Math.round(pk.p)} % · ${esc(horaPk)} h</text>` : ''}`;
            })() : '';
        return `${logoCirculo(`${idPrefijo}-lg${m.numero}`, 18, yy + 13, 10, m.numero, logos.get(m.numero))}
                <text x="34" y="${yy + 17}" font-size="12" font-weight="800" fill="${VIZ.inkPrimary}" font-family="system-ui">M${m.numero}${esEstimado(m) ? '*' : ''}</text>
                ${celdas}${marca}`;
    }).join('');

    // Eje: hora cada 6 h y el día en la medianoche (y en la primera columna).
    const eje = ejeHoras.map((ts, i) => {
        const h = horaLocal(ts);
        if (h % 6 !== 0 && !(i === 0 && (6 - (h % 6)) % 6 >= 3)) return '';
        const x = ML + (i + 0.5) * cw;
        const dia = h === 0 || i === 0 ? `<text x="${x.toFixed(1)}" y="${MT + modulos.length * FILA + 28}" text-anchor="middle" font-size="11.5" font-weight="800" fill="${VIZ.inkPrimary}" font-family="system-ui">${esc(fmtDia(ts))}</text>` : '';
        return `<text x="${x.toFixed(1)}" y="${MT + modulos.length * FILA + 15}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${VIZ.inkSecondary}" font-family="system-ui">${String(h).padStart(2, '0')}:00</text>${dia}`;
    }).join('');

    const ahora = `<line x1="${ML}" y1="${MT - 12}" x2="${ML}" y2="${MT + modulos.length * FILA}" stroke="${VIZ.inkPrimary}" stroke-width="1.5" stroke-dasharray="3 3"/>
        <rect x="${ML + 2}" y="${MT - 25}" width="44" height="13" rx="3" fill="#fff" stroke="${VIZ.inkPrimary}"/><text x="${ML + 24}" y="${MT - 15}" text-anchor="middle" font-size="10" font-weight="800" fill="${VIZ.inkPrimary}" font-family="system-ui">AHORA</text>`;

    const resumen = modulos.map(m => {
        const ps = m.horas.map(h => h.probPct).filter((v): v is number => v != null);
        return `Módulo ${m.numero}: ${ps.length ? `hasta ${Math.round(Math.max(...ps))} %` : 'sin dato'}`;
    }).join('; ');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Probabilidad de lluvia hora por hora para cada módulo. ${esc(resumen)}">
        <defs><pattern id="${idPrefijo}-sin" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#f8fafc"/><line x1="0" y1="0" x2="0" y2="5" stroke="${VIZ.axis}" stroke-width="1.5"/></pattern></defs>
        ${franja}${filas}${ahora}${eje}
    </svg>`;
}
