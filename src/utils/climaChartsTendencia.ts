// ═══════════════════════════════════════════════════════════════════════════
// Gráfica de tendencia dentro de un periodo — SICA-005
// ---------------------------------------------------------------------------
// Misma identidad visual que `graficaEvolucionMensual` (climaCharts.ts: paleta
// VIZ.serie, leyenda de hasta 3 por fila, huecos sin interpolar) pero con un eje
// X arbitrario (día, semana u hora). SVG puro: el informe es un HTML autónomo.
// ═══════════════════════════════════════════════════════════════════════════
import { VIZ } from './climaCharts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Tendencia de una variable por estación.
 *
 *  · 'barras' — magnitudes discretas por periodo (lluvia del día o de la semana).
 *  · 'linea'  — trayectorias continuas (temperatura, viento, radiación,
 *    acumulado de lluvia, intensidad horaria).
 *
 * `etiquetas` trae un texto por punto (vacío = sin rótulo; el llamador ya
 * ralea el eje) y cada serie el mismo nº de valores (null = S/D: barra ausente
 * o corte de la línea, nunca 0 ni interpolación). `picos` rotula con su valor
 * una barra concreta (día de mayor lluvia por estación).
 *
 * El color de cada estación es su posición en `series`: el llamador debe pasar
 * SIEMPRE todas las estaciones en el mismo orden para que una estación conserve
 * su color entre gráficas.
 */
export function graficaTendencia(o: {
    titulo: string;
    unidad: string;
    etiquetas: string[];
    series: { nombre: string; valores: (number | null)[] }[];
    forma: 'linea' | 'barras';
    pisoEnCero?: boolean;
    picos?: { serie: string; indice: number; texto: string }[];
}): string {
    const { titulo, unidad, etiquetas, series, forma, pisoEnCero = false, picos = [] } = o;
    const N = etiquetas.length;
    const conDato = series.map((s, idx) => ({ ...s, idx })).filter(s => s.valores.some(v => v != null));
    if (N < 2 || !conDato.length) return '';

    const filasLeyenda = Math.ceil(conDato.length / 3);
    const H_LEYENDA = 18 * filasLeyenda + 6;
    const W = 720, H = 200 + H_LEYENDA, ML = 42, MR = 16, MT = 20, MB = 26;
    const iw = W - ML - MR, ih = H - MT - MB - H_LEYENDA;
    const todos = conDato.flatMap(s => s.valores).filter((v): v is number => v != null);
    const minReal = Math.min(...todos), maxReal = Math.max(...todos);
    const margen = Math.max((maxReal - minReal) * 0.18, maxReal * 0.03, 0.5);
    // Barras: el piso es SIEMPRE 0 (la longitud codifica magnitud). Línea: rango
    // ajustado a los datos, salvo variables que nunca son negativas.
    const lo = forma === 'barras' ? 0
        : pisoEnCero ? Math.max(0, Math.floor((minReal - margen) * 10) / 10)
            : Math.floor((minReal - margen) * 10) / 10;
    const hi = forma === 'barras' ? (Math.ceil((maxReal * 1.18) * 10) / 10 || 1)
        : (Math.ceil((maxReal + margen) * 10) / 10 || 1);
    const y = (v: number) => MT + ih - ((v - lo) / Math.max(1e-6, hi - lo)) * ih;
    const anchoGrupo = iw / N;
    const x = (i: number) => forma === 'barras' ? ML + (i + 0.5) * anchoGrupo : ML + (i / (N - 1)) * iw;

    const ticksY = [lo, (lo + hi) / 2, hi].map(v =>
        `<line x1="${ML}" y1="${y(v).toFixed(1)}" x2="${W - MR}" y2="${y(v).toFixed(1)}" stroke="${VIZ.grid}" stroke-width="1"/>
         <text x="${ML - 7}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="9"
               fill="${VIZ.inkMuted}" font-family="system-ui">${v.toFixed(v % 1 === 0 ? 0 : 1)}</text>`).join('');

    const ejeX = etiquetas.map((t, i) => t
        ? `<line x1="${x(i).toFixed(1)}" y1="${(MT + ih).toFixed(1)}" x2="${x(i).toFixed(1)}" y2="${(MT + ih + 3).toFixed(1)}" stroke="${VIZ.axis}" stroke-width="1"/>
           <text x="${x(i).toFixed(1)}" y="${H - H_LEYENDA - 8}" text-anchor="middle" font-size="9"
                 fill="${VIZ.inkMuted}" font-family="system-ui">${esc(t)}</text>`
        : '').join('');

    const anchoEntrada = Math.min(160, iw / Math.min(3, conDato.length));
    const leyenda = conDato.map((s, k) => {
        const col = VIZ.serie[s.idx % VIZ.serie.length];
        const fila = Math.floor(k / 3), colI = k % 3;
        const nEnFila = Math.min(3, conDato.length - fila * 3);
        const lx = (W - nEnFila * anchoEntrada) / 2 + colI * anchoEntrada;
        const ly = H - H_LEYENDA + 12 + fila * 18;
        const clave = forma === 'barras'
            ? `<rect x="${lx}" y="${(ly - 7).toFixed(1)}" width="12" height="9" rx="2" fill="${col}"/>`
            : `<line x1="${lx}" y1="${(ly - 3).toFixed(1)}" x2="${lx + 14}" y2="${(ly - 3).toFixed(1)}" stroke="${col}" stroke-width="2.5" stroke-linecap="round"/>`;
        return `${clave}<text x="${lx + 19}" y="${ly.toFixed(1)}" font-size="9" font-weight="600"
                      fill="${VIZ.inkSecondary}" font-family="system-ui">${esc(s.nombre)}</text>`;
    }).join('');

    const cabecera = `<text x="${ML - 7}" y="${MT - 8}" text-anchor="end" font-size="8" fill="${VIZ.inkMuted}" font-family="system-ui">${esc(unidad)}</text>`;
    const etiquetaAria = `${esc(titulo)}: tendencia por estación, en ${esc(unidad)}`;

    if (forma === 'barras') {
        const GAP = 1;
        const anchoBarra = Math.max(1.5, Math.min(24, (anchoGrupo * 0.84 - GAP * (conDato.length - 1)) / conDato.length));
        const anchoUsado = anchoBarra * conDato.length + GAP * (conDato.length - 1);
        const offset = new Map<number, number>();   // idx de serie → desplazamiento dentro del grupo
        conDato.forEach((s, k) => offset.set(s.idx, k * (anchoBarra + GAP)));
        const barras = Array.from({ length: N }, (_, i) => {
            const inicio = ML + i * anchoGrupo + (anchoGrupo - anchoUsado) / 2;
            return conDato.map(s => {
                const v = s.valores[i];
                if (v == null) return '';
                const col = VIZ.serie[s.idx % VIZ.serie.length];
                const bx = inicio + offset.get(s.idx)!;
                const by = y(v), h = y(0) - by;
                if (h < 0.6) return '';
                const r = Math.min(3, h, anchoBarra / 2);
                return `<path d="M${bx.toFixed(1)},${(by + h).toFixed(1)} L${bx.toFixed(1)},${(by + r).toFixed(1)}
                         Q${bx.toFixed(1)},${by.toFixed(1)} ${(bx + r).toFixed(1)},${by.toFixed(1)}
                         L${(bx + anchoBarra - r).toFixed(1)},${by.toFixed(1)}
                         Q${(bx + anchoBarra).toFixed(1)},${by.toFixed(1)} ${(bx + anchoBarra).toFixed(1)},${(by + r).toFixed(1)}
                         L${(bx + anchoBarra).toFixed(1)},${(by + h).toFixed(1)} Z" fill="${col}"/>`;
            }).join('');
        }).join('');

        // Picos: anillo + valor sobre la barra; alternan altura para que dos
        // picos de barras vecinas no se pisen.
        const marcas = picos.map((p, n) => {
            const s = conDato.find(c => c.nombre === p.serie);
            const v = s?.valores[p.indice];
            if (!s || v == null) return '';
            const col = VIZ.serie[s.idx % VIZ.serie.length];
            const inicio = ML + p.indice * anchoGrupo + (anchoGrupo - anchoUsado) / 2;
            const cx = inicio + offset.get(s.idx)! + anchoBarra / 2;
            const ty = Math.max(MT - 2, y(v) - 7 - (n % 2) * 9);
            return `<circle cx="${cx.toFixed(1)}" cy="${(y(v) - 3).toFixed(1)}" r="2.6" fill="${VIZ.surface}" stroke="${col}" stroke-width="1.6"/>
                    <text x="${cx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700"
                          fill="${VIZ.inkPrimary}" font-family="system-ui">${esc(p.texto)}</text>`;
        }).join('');

        return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${etiquetaAria}">
            ${ticksY}${cabecera}${barras}
            <line x1="${ML}" y1="${y(0).toFixed(1)}" x2="${W - MR}" y2="${y(0).toFixed(1)}" stroke="${VIZ.axis}" stroke-width="1"/>
            ${marcas}${ejeX}${leyenda}
        </svg>`;
    }

    // Línea: segmentos continuos (un hueco corta la línea). Con muchos puntos
    // (la vista horaria tiene 72) se omiten los círculos para no saturar.
    const conPuntos = N <= 31;
    const lineas = conDato.map(s => {
        const col = VIZ.serie[s.idx % VIZ.serie.length];
        const segmentos: string[] = [];
        let actual = '';
        s.valores.forEach((v, i) => {
            if (v == null) { if (actual) segmentos.push(actual); actual = ''; return; }
            actual += `${actual ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
        });
        if (actual) segmentos.push(actual);
        const trazo = segmentos.map(d => `<path d="${d}" fill="none" stroke="${col}" stroke-width="2"
                stroke-linejoin="round" stroke-linecap="round"/>`).join('');
        const puntos = conPuntos ? s.valores.map((v, i) => v == null ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}"
                r="3" fill="${col}" stroke="${VIZ.surface}" stroke-width="1.3"/>`).join('') : '';
        return `${trazo}${puntos}`;
    }).join('');

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${etiquetaAria}">
        ${ticksY}${cabecera}${lineas}${ejeX}${leyenda}
    </svg>`;
}

const MES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const diaCorto = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MES_C[m - 1]}`; };
const hh = (h: number) => String(h).padStart(2, '0');

/**
 * Lluvia por bloque horario de la RED (promedio de las estaciones que leyeron,
 * mm/h) + tira de totales por estación. Una barra de un solo tono por bloque
 * (seis líneas casi iguales eran ilegibles); el bloque pico lleva contorno y
 * rótulo; un rombo marca la estación más intensa de cada bloque; un bloque sin
 * lectura es una franja gris con trama — nunca una barra en 0. Abajo, barras
 * horizontales por estación, ordenadas, con su nombre pegado (sin leyenda).
 */
export function graficaIntensidadBloques(ep: {
    anchoH: number;
    bloques: { dia: string; hora: number; red: number | null; max: { nombre: string; mmh: number } | null }[];
    indicePico: number;
    totales: { nombre: string; mm: number }[];
}, colorDe: (nombre: string) => string): string {
    const { bloques, anchoH, indicePico, totales } = ep;
    if (!bloques.length) return '';
    const W = 720, ML = 42, MR = 16, MT = 26, ih = 150, MB = 30;
    const iw = W - ML - MR, n = bloques.length;
    const maxV = Math.max(0.5, ...bloques.map(b => Math.max(b.red ?? 0, b.max?.mmh ?? 0)));
    const hi = Math.ceil(maxV * 1.15 * 10) / 10 || 1;
    const y = (v: number) => MT + ih - (v / hi) * ih;
    const gw = iw / n, bw = Math.min(46, gw * 0.78);
    const xc = (i: number) => ML + (i + 0.5) * gw;

    const ticks = [0, hi / 2, hi].map(v => `<line x1="${ML}" y1="${y(v).toFixed(1)}" x2="${W - MR}" y2="${y(v).toFixed(1)}" stroke="${VIZ.grid}" stroke-width="1"/>
        <text x="${ML - 7}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="${VIZ.inkMuted}" font-family="system-ui">${v.toFixed(v % 1 === 0 ? 0 : 1)}</text>`).join('');

    const barras = bloques.map((b, i) => {
        const x0 = xc(i) - bw / 2;
        if (b.red == null) {
            return `<rect x="${x0.toFixed(1)}" y="${MT}" width="${bw.toFixed(1)}" height="${ih}" fill="url(#sinlec)" opacity="0.9"/>`;
        }
        const h = Math.max(b.red > 0 ? 1.5 : 0, y(0) - y(b.red));
        const pico = i === indicePico && b.red > 0;
        return `<rect x="${x0.toFixed(1)}" y="${(y(0) - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3"
                      fill="${VIZ.serie[0]}" ${pico ? `stroke="${VIZ.inkPrimary}" stroke-width="2"` : ''}/>`;
    }).join('');

    const rombos = bloques.map((b, i) => {
        if (!b.max || b.max.mmh <= 0 || b.red == null || b.max.mmh <= b.red * 1.05) return '';
        const cx = xc(i), cy = y(b.max.mmh);
        return `<path d="M${cx.toFixed(1)},${(cy - 4.5).toFixed(1)} L${(cx + 4.5).toFixed(1)},${cy.toFixed(1)} L${cx.toFixed(1)},${(cy + 4.5).toFixed(1)} L${(cx - 4.5).toFixed(1)},${cy.toFixed(1)} Z"
                      fill="${VIZ.surface}" stroke="${VIZ.inkPrimary}" stroke-width="1.4"/>`;
    }).join('');

    const pb = bloques[indicePico];
    let anotacion = '';
    if (pb && pb.red != null && pb.red > 0) {
        const px = xc(indicePico);
        const top = y(Math.max(pb.red, pb.max?.mmh ?? 0));
        const txt = `Pico ${hh(pb.hora)}:00–${hh((pb.hora + anchoH) % 24)}:00 · ${pb.max ? `${esc(pb.max.nombre)} ${pb.max.mmh.toFixed(1)} mm/h` : `${pb.red.toFixed(1)} mm/h`}`;
        const anchor = px > W * 0.62 ? 'end' : px < W * 0.38 ? 'start' : 'middle';
        const tx = anchor === 'end' ? px + 10 : anchor === 'start' ? px - 10 : px;
        anotacion = `<text x="${tx.toFixed(1)}" y="${Math.max(11, top - 11).toFixed(1)}" text-anchor="${anchor}" font-size="9.5" font-weight="700"
                       fill="${VIZ.inkPrimary}" font-family="system-ui">${txt}</text>`;
    }

    const ejeX = bloques.map((b, i) => {
        const nuevoDia = i === 0 || b.dia !== bloques[i - 1].dia;
        const rotula = nuevoDia || n <= 14 || b.hora % (anchoH * 2) === 0 && n <= 28 || b.hora % 6 === 0;
        if (!rotula) return '';
        return `<text x="${xc(i).toFixed(1)}" y="${MT + ih + 13}" text-anchor="middle" font-size="9" fill="${VIZ.inkMuted}" font-family="system-ui">${hh(b.hora)}h</text>
                ${nuevoDia ? `<text x="${xc(i).toFixed(1)}" y="${MT + ih + 25}" text-anchor="middle" font-size="9" font-weight="700" fill="${VIZ.inkSecondary}" font-family="system-ui">${diaCorto(b.dia)}</text>` : ''}`;
    }).join('');

    // Tira de totales por estación (orden descendente, etiqueta directa).
    const FILA = 17, y0 = MT + ih + MB + 14;
    const maxT = Math.max(0.1, ...totales.map(t => t.mm));
    const ancho0 = ML + 96, anchoMax = W - MR - ancho0 - 56;
    const tira = totales.map((t, k) => {
        const yy = y0 + k * FILA;
        const w = Math.max(t.mm > 0 ? 2 : 0, (t.mm / maxT) * anchoMax);
        return `<text x="${ancho0 - 8}" y="${(yy + 10).toFixed(1)}" text-anchor="end" font-size="9.5" font-weight="600" fill="${VIZ.inkSecondary}" font-family="system-ui">${esc(t.nombre)}</text>
                <rect x="${ancho0}" y="${yy.toFixed(1)}" width="${w.toFixed(1)}" height="12" rx="3" fill="${colorDe(t.nombre)}"/>
                <text x="${(ancho0 + w + 6).toFixed(1)}" y="${(yy + 10).toFixed(1)}" font-size="9.5" font-weight="700" fill="${VIZ.inkPrimary}" font-family="system-ui">${t.mm.toFixed(1)} mm</text>`;
    }).join('');
    const H = y0 + totales.length * FILA + 8;

    const resumen = pb && pb.red != null ? `Pico ${hh(pb.hora)} horas, promedio de la red ${pb.red.toFixed(1)} mm por hora.` : 'Sin lluvia en el episodio.';
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Lluvia por bloque de ${anchoH} horas. ${esc(resumen)}">
        <defs><pattern id="sinlec" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="${VIZ.plane}"/><line x1="0" y1="0" x2="0" y2="6" stroke="${VIZ.axis}" stroke-width="2"/></pattern></defs>
        ${ticks}
        <text x="${ML - 7}" y="${MT - 12}" text-anchor="end" font-size="8" fill="${VIZ.inkMuted}" font-family="system-ui">mm/h</text>
        ${barras}${rombos}${anotacion}
        <line x1="${ML}" y1="${y(0).toFixed(1)}" x2="${W - MR}" y2="${y(0).toFixed(1)}" stroke="${VIZ.axis}" stroke-width="1"/>
        ${ejeX}
        <text x="${ML}" y="${y0 - 6}" font-size="8.5" font-weight="700" fill="${VIZ.inkMuted}" font-family="system-ui" letter-spacing="0.06em">LLUVIA TOTAL DEL EPISODIO POR ESTACIÓN</text>
        ${tira}
    </svg>`;
}
