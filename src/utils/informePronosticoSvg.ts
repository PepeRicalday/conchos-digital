// ═══════════════════════════════════════════════════════════════════════════
// Informe de Pronóstico — gráficas SVG — SICA-005
// ---------------------------------------------------------------------------
// SVG puro (el informe es un HTML autónomo que debe abrir sin conexión e
// imprimir). Misma identidad visual que climaCharts.ts: tokens VIZ, rejilla
// recesiva de 1 px, etiquetas selectivas, el texto en tinta (no en el color de
// la serie) y los estados siempre con forma + texto, no solo color.
// ═══════════════════════════════════════════════════════════════════════════
import { VIZ } from './climaCharts';
import { COLOR_MODULO, MODULOS_SRL } from './geoDistrito';
import type { BandaHoraria, FilaLineaTiempo, NivelRiesgo, ResumenModulo } from './informePronosticoDatos';
import { fmtDia, fmtHora } from './informePronosticoDatos';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const COLOR_NIVEL: Record<NivelRiesgo, string> = {
    normal: VIZ.estado.bueno, aviso: VIZ.estado.aviso, critico: VIZ.estado.critico,
};
export const FONDO_NIVEL: Record<NivelRiesgo, string> = {
    normal: '#e8f6e8', aviso: '#fdf0d8', critico: '#fbe3e3',
};
export const ROTULO_NIVEL: Record<NivelRiesgo, string> = {
    normal: '● NORMAL', aviso: '▲ AVISO', critico: '■ CRÍTICO',
};

export const horaLocal = (ts: number) => Number(fmtHora(ts).slice(0, 2));
export const esNoche = (ts: number) => { const h = horaLocal(ts); return h >= 20 || h < 7; };

interface UmbralLinea { valor: number; etiqueta: string; color: string }

/**
 * Serie horaria de la red: línea (o barras) con la media entre estaciones y una
 * banda mín–máx. Franja gris = noche (20:00–07:00). Línea punteada vertical =
 * "ahora". Los umbrales de aviso/crítico se dibujan si caen dentro del eje.
 */
export function graficaHoraria(o: {
    titulo: string; unidad: string; bandas: BandaHoraria[]; forma: 'linea' | 'barras';
    umbrales?: UmbralLinea[]; pisoEnCero?: boolean; decimales?: number; etiquetaPico?: string;
}): string {
    const { titulo, unidad, bandas, forma, pisoEnCero = false, decimales = 1 } = o;
    const conDato = bandas.filter(b => b.media != null);
    if (conDato.length < 2) return '';
    // Un umbral lejano a los datos (p. ej. calor 36 °C con máximas de 15 °C) aplastaría la
    // curva: solo se dibuja si queda cerca del rango real; si no, se declara fuera de escala.
    const dMin = Math.min(...conDato.map(b => b.min as number)), dMax = Math.max(...conDato.map(b => b.max as number));
    const holgura = Math.max(3, (dMax - dMin) * 0.6);
    const umbrales = (o.umbrales ?? []).filter(u => u.valor >= dMin - holgura && u.valor <= dMax + holgura);
    const fuera = (o.umbrales ?? []).filter(u => !umbrales.includes(u));
    const W = 720, H = 190, ML = 42, MR = 70, MT = 18, MB = 28;
    const iw = W - ML - MR, ih = H - MT - MB, n = bandas.length;
    const maxes = conDato.map(b => b.max as number), mins = conDato.map(b => b.min as number);
    let hi = Math.max(...maxes), lo = forma === 'barras' ? 0 : Math.min(...mins);
    for (const u of umbrales) { hi = Math.max(hi, u.valor); if (forma !== 'barras') lo = Math.min(lo, u.valor); }
    const margen = Math.max((hi - lo) * 0.12, 0.4);
    hi = Math.ceil((hi + margen) * 10) / 10;
    lo = forma === 'barras' || pisoEnCero ? Math.max(0, forma === 'barras' ? 0 : Math.floor((lo - margen) * 10) / 10) : Math.floor((lo - margen) * 10) / 10;
    const y = (v: number) => MT + ih - ((v - lo) / Math.max(1e-6, hi - lo)) * ih;
    const gw = iw / n;
    const x = (i: number) => forma === 'barras' ? ML + (i + 0.5) * gw : ML + (i / (n - 1)) * iw;

    // Franjas de noche.
    const noche = bandas.map((b, i) => {
        if (!esNoche(b.ts)) return '';
        const x0 = forma === 'barras' ? ML + i * gw : x(i) - iw / (n - 1) / 2;
        const w = forma === 'barras' ? gw : iw / (n - 1);
        return `<rect x="${Math.max(ML, x0).toFixed(1)}" y="${MT}" width="${w.toFixed(1)}" height="${ih}" fill="#eef2f7"/>`;
    }).join('');

    const ticks = [lo, (lo + hi) / 2, hi].map(v =>
        `<line x1="${ML}" y1="${y(v).toFixed(1)}" x2="${W - MR}" y2="${y(v).toFixed(1)}" stroke="${VIZ.grid}" stroke-width="1"/>
         <text x="${ML - 7}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="${VIZ.inkMuted}" font-family="system-ui">${v.toFixed(v % 1 === 0 ? 0 : decimales)}</text>`).join('');

    const lineasUmbral = umbrales.filter(u => u.valor >= lo && u.valor <= hi).map(u =>
        `<line x1="${ML}" y1="${y(u.valor).toFixed(1)}" x2="${W - MR}" y2="${y(u.valor).toFixed(1)}" stroke="${u.color}" stroke-width="1.2" stroke-dasharray="5 3"/>
         <text x="${W - MR + 5}" y="${(y(u.valor) + 3).toFixed(1)}" font-size="8.5" font-weight="700" fill="${VIZ.inkSecondary}" font-family="system-ui">${esc(u.etiqueta)}</text>`).join('');

    // Eje X: etiqueta cada 6 h; a medianoche, el día.
    const ejeX = bandas.map((b, i) => {
        const h = horaLocal(b.ts);
        if (h % 6 !== 0 && i !== 0) return '';
        const dia = h === 0 || i === 0 ? `<text x="${x(i).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="8.5" font-weight="700" fill="${VIZ.inkSecondary}" font-family="system-ui">${esc(fmtDia(b.ts))}</text>` : '';
        return `<text x="${x(i).toFixed(1)}" y="${H - 15}" text-anchor="middle" font-size="9" fill="${VIZ.inkMuted}" font-family="system-ui">${String(h).padStart(2, '0')}h</text>${dia}`;
    }).join('');

    const ahora = `<line x1="${x(0).toFixed(1)}" y1="${MT}" x2="${x(0).toFixed(1)}" y2="${MT + ih}" stroke="${VIZ.inkSecondary}" stroke-width="1" stroke-dasharray="2 3"/>
        <text x="${(x(0) + 4).toFixed(1)}" y="${MT - 6}" font-size="8.5" font-weight="700" fill="${VIZ.inkSecondary}" font-family="system-ui">ahora</text>`;

    let marcas = '';
    if (forma === 'barras') {
        const bw = Math.max(1.5, gw * 0.78);
        marcas = bandas.map((b, i) => {
            if (b.max == null || b.media == null) return '';
            const bx = x(i) - bw / 2;
            const hMax = Math.max(0, y(0) - y(b.max)), hMed = Math.max(0, y(0) - y(b.media));
            return `${hMax > 0.4 ? `<rect x="${bx.toFixed(1)}" y="${(y(0) - hMax).toFixed(1)}" width="${bw.toFixed(1)}" height="${hMax.toFixed(1)}" rx="2" fill="${VIZ.nube[0]}"/>` : ''}
                    ${hMed > 0.4 ? `<rect x="${(bx + bw * 0.18).toFixed(1)}" y="${(y(0) - hMed).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${hMed.toFixed(1)}" rx="2" fill="${VIZ.lluvia}"/>` : ''}`;
        }).join('');
        // Rótulo del pico de la estación más lluviosa.
        const iPico = bandas.reduce((m, b, i) => ((b.max ?? 0) > (bandas[m].max ?? 0) ? i : m), 0);
        const pk = bandas[iPico];
        if ((pk.max ?? 0) >= 0.2) {
            const px = x(iPico), anc = px > W * 0.7 ? 'end' : px < W * 0.22 ? 'start' : 'middle';
            marcas += `<text x="${(anc === 'end' ? px + 6 : anc === 'start' ? px - 4 : px).toFixed(1)}" y="${Math.max(MT + 8, y(pk.max!) - 5).toFixed(1)}" text-anchor="${anc}" font-size="9.5" font-weight="700" fill="${VIZ.inkPrimary}" font-family="system-ui">${pk.max!.toFixed(1)} mm/h · ${esc(fmtHora(pk.ts))}</text>`;
        }
    } else {
        const poly = (() => {
            const arriba = bandas.map((b, i) => (b.max == null ? null : `${x(i).toFixed(1)},${y(b.max).toFixed(1)}`));
            const abajo = bandas.map((b, i) => (b.min == null ? null : `${x(i).toFixed(1)},${y(b.min).toFixed(1)}`));
            if (arriba.some(p => p == null) || abajo.some(p => p == null)) return '';
            return `<polygon points="${[...arriba, ...abajo.reverse()].join(' ')}" fill="${VIZ.serie[0]}" opacity="0.16"/>`;
        })();
        const segs: string[] = []; let act = '';
        bandas.forEach((b, i) => {
            if (b.media == null) { if (act) segs.push(act); act = ''; return; }
            act += `${act ? 'L' : 'M'}${x(i).toFixed(1)},${y(b.media).toFixed(1)} `;
        });
        if (act) segs.push(act);
        const linea = segs.map(d => `<path d="${d}" fill="none" stroke="${VIZ.serie[0]}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`).join('');
        // Extremos rotulados (máx. y mín. de la banda).
        const iMax = bandas.reduce((m, b, i) => ((b.max ?? -Infinity) > (bandas[m].max ?? -Infinity) ? i : m), 0);
        const iMin = bandas.reduce((m, b, i) => ((b.min ?? Infinity) < (bandas[m].min ?? Infinity) ? i : m), 0);
        const etq = (i: number, v: number, arriba: boolean) => {
            const px = x(i), anc = px > W * 0.8 ? 'end' : px < W * 0.15 ? 'start' : 'middle';
            return `<circle cx="${px.toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.2" fill="${VIZ.surface}" stroke="${VIZ.inkPrimary}" stroke-width="1.4"/>
                    <text x="${px.toFixed(1)}" y="${(y(v) + (arriba || y(v) + 13 > MT + ih - 2 ? -7 : 13)).toFixed(1)}" text-anchor="${anc}" font-size="9.5" font-weight="700" fill="${VIZ.inkPrimary}" font-family="system-ui">${v.toFixed(decimales)} ${esc(unidad)} · ${esc(fmtHora(bandas[i].ts))}</text>`;
        };
        marcas = `${poly}${linea}${etq(iMax, bandas[iMax].max!, true)}${iMin !== iMax ? etq(iMin, bandas[iMin].min!, false) : ''}`;
    }

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(titulo)}, ${bandas.length} horas, en ${esc(unidad)}${o.etiquetaPico ? '. ' + esc(o.etiquetaPico) : ''}">
        ${noche}${ticks}
        <text x="${ML - 7}" y="${MT - 6}" text-anchor="end" font-size="8" fill="${VIZ.inkMuted}" font-family="system-ui">${esc(unidad)}</text>
        ${lineasUmbral}${marcas}
        <line x1="${ML}" y1="${y(lo).toFixed(1)}" x2="${W - MR}" y2="${y(lo).toFixed(1)}" stroke="${VIZ.axis}" stroke-width="1"/>
        ${ahora}${ejeX}
        ${fuera.length ? `<text x="${W - MR}" y="${MT - 6}" text-anchor="end" font-size="8.5" fill="${VIZ.inkMuted}" font-family="system-ui">${esc(fuera.map(u => u.etiqueta).join(' · '))} (fuera de escala, sin alcanzar)</text>` : ''}
    </svg>`;
}

/** Línea de tiempo de ventanas de riesgo: una fila por variable, una celda por hora. */
export function lineaTiempoSvg(filas: FilaLineaTiempo[], ejeHoras: number[]): string {
    if (!filas.length || ejeHoras.length < 2) return '';
    const W = 720, ML = 92, MR = 14, FILA = 24, MT = 8, n = ejeHoras.length;
    const iw = W - ML - MR, cw = iw / n;
    const H = MT + filas.length * FILA + 34;
    const COL_LLUVIA = [VIZ.grid, '#cfe0f7', VIZ.nube[1], VIZ.nube[3]];

    const noche = ejeHoras.map((ts, i) => esNoche(ts)
        ? `<rect x="${(ML + i * cw).toFixed(1)}" y="${MT}" width="${cw.toFixed(1)}" height="${filas.length * FILA}" fill="#eef2f7"/>` : '').join('');
    const cuerpo = filas.map((f, r) => {
        const yy = MT + r * FILA + 3;
        const celdas = f.celdas.map((c, i) => {
            const cx = ML + i * cw + 0.6;
            if (c == null) return `<rect x="${cx.toFixed(1)}" y="${yy}" width="${(cw - 1.2).toFixed(1)}" height="${FILA - 6}" fill="url(#sinpron)"/>`;
            if ('lluvia' in c) return c.lluvia === 0 ? '' : `<rect x="${cx.toFixed(1)}" y="${yy}" width="${(cw - 1.2).toFixed(1)}" height="${FILA - 6}" rx="2" fill="${COL_LLUVIA[c.lluvia]}"/>`;
            return c.nivel === 'normal' ? '' : `<rect x="${cx.toFixed(1)}" y="${yy}" width="${(cw - 1.2).toFixed(1)}" height="${FILA - 6}" rx="2" fill="${COLOR_NIVEL[c.nivel]}"/>`;
        }).join('');
        return `<text x="${ML - 8}" y="${yy + 12}" text-anchor="end" font-size="10" font-weight="700" fill="${VIZ.inkSecondary}" font-family="system-ui">${esc(f.etiqueta)}</text>${celdas}`;
    }).join('');
    const ejeX = ejeHoras.map((ts, i) => {
        const h = horaLocal(ts);
        if (h % 6 !== 0 && i !== 0) return '';
        const dia = h === 0 || i === 0 ? `<text x="${(ML + (i + 0.5) * cw).toFixed(1)}" y="${MT + filas.length * FILA + 24}" text-anchor="middle" font-size="8.5" font-weight="700" fill="${VIZ.inkSecondary}" font-family="system-ui">${esc(fmtDia(ts))}</text>` : '';
        return `<text x="${(ML + (i + 0.5) * cw).toFixed(1)}" y="${MT + filas.length * FILA + 12}" text-anchor="middle" font-size="9" fill="${VIZ.inkMuted}" font-family="system-ui">${String(h).padStart(2, '0')}h</text>${dia}`;
    }).join('');

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Línea de tiempo de ventanas de riesgo por hora">
        <defs><pattern id="sinpron" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="${VIZ.plane}"/><line x1="0" y1="0" x2="0" y2="5" stroke="${VIZ.axis}" stroke-width="1.5"/></pattern></defs>
        ${noche}${cuerpo}
        <line x1="${ML}" y1="${MT + filas.length * FILA}" x2="${W - MR}" y2="${MT + filas.length * FILA}" stroke="${VIZ.axis}" stroke-width="1"/>
        ${ejeX}
    </svg>`;
}

/** Mapa esquemático de módulos, coloreado por el nivel de decisión (forma + texto, no solo color). */
export function mapaDecisionSvg(modulos: ResumenModulo[]): string {
    const anillos = modulos.map(m => ({ m, anillo: MODULOS_SRL[m.numero] })).filter(x => x.anillo?.length);
    if (!anillos.length) return '';
    const lons = anillos.flatMap(x => x.anillo.map(p => p[0])), lats = anillos.flatMap(x => x.anillo.map(p => p[1]));
    const minLon = Math.min(...lons), maxLon = Math.max(...lons), minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const W = 330, H = 460, pad = 14;
    const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const escala = Math.min((W - 2 * pad) / ((maxLon - minLon) * k), (H - 2 * pad) / (maxLat - minLat));
    const ox = (W - (maxLon - minLon) * k * escala) / 2, oy = (H - (maxLat - minLat) * escala) / 2;
    const px = (lon: number) => ox + (lon - minLon) * k * escala;
    const py = (lat: number) => H - oy - (lat - minLat) * escala;
    const SIMB: Record<NivelRiesgo, string> = { normal: '●', aviso: '▲', critico: '■' };

    const cuerpo = anillos.map(({ m, anillo }) => {
        const pts = anillo.map(p => `${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join(' ');
        const cx = anillo.reduce((s, p) => s + px(p[0]), 0) / anillo.length;
        const cy = anillo.reduce((s, p) => s + py(p[1]), 0) / anillo.length;
        const nivel = m.decision.nivel;
        return `<polygon points="${pts}" fill="${FONDO_NIVEL[nivel]}" stroke="${COLOR_MODULO[m.numero] ?? VIZ.axis}" stroke-width="2"/>
            <text x="${cx.toFixed(1)}" y="${(cy - 2).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="800" fill="${VIZ.inkPrimary}" font-family="system-ui">M${m.numero}</text>
            <text x="${cx.toFixed(1)}" y="${(cy + 11).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${COLOR_NIVEL[nivel]}" font-family="system-ui">${SIMB[nivel]} ${nivel === 'normal' ? 'normal' : nivel === 'aviso' ? 'aviso' : 'crítico'}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Mapa de módulos con el nivel de decisión operativa de las próximas horas">${cuerpo}</svg>`;
}

