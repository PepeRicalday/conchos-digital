// ═══════════════════════════════════════════════════════════════════════════
// Gráficas SVG del Centro de Inteligencia Agroclimática — SICA-005
// ---------------------------------------------------------------------------
// SVG puro, sin dependencias: el informe es un HTML autónomo que debe abrirse
// sin conexión y sobrevivir a la exportación a PDF.
//
// Reglas de visualización aplicadas (validadas con el validador de paleta):
//   · Nubosidad usa una rampa SECUENCIAL de un solo hue (más nubes = más oscuro).
//   · Nubosidad y precipitación NUNCA comparten eje: son magnitudes distintas y
//     se dibujan como gráficas separadas, nunca con doble eje Y.
//   · Marcas finas: línea 2px, barras ≤24px con extremo redondeado 4px,
//     rejilla de 1px recesiva, puntos ≥8px con anillo del color de superficie.
//   · Etiquetas selectivas (extremos y fin de serie), nunca un número por punto.
//   · El texto usa tokens de tinta, jamás el color de la serie.
// ═══════════════════════════════════════════════════════════════════════════

// ── Tokens de color (paleta institucional validada) ─────────────────────────
export const VIZ = {
    surface: '#ffffff',
    plane: '#f8fafc',
    inkPrimary: '#0f172a',
    inkSecondary: '#475569',
    inkMuted: '#94a3b8',
    grid: '#e8edf3',
    axis: '#cbd5e1',
    // Rampa secuencial de nubosidad (ordinal, validada: L monótona, extremo claro 2.11:1)
    nube: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'],
    // Categóricos (orden validado, CVD ΔE 37.7)
    serie: ['#2a78d6', '#1baf7a', '#eda100', '#e34948', '#4a3aa7', '#eb6834'],
    // Estado / calidad (orden validado, CVD ΔE 15.1) — siempre con icono + texto
    estado: { bueno: '#0ca30c', aviso: '#d98704', serio: '#ec835a', critico: '#d03b3b' },
    lluvia: '#2a78d6',
    srl: '#6B2D2D',
};

/** Color de la rampa de nubosidad para una cobertura 0-100. */
export function colorNubosidad(pct: number | null | undefined): string {
    if (pct == null) return VIZ.inkMuted;
    const i = Math.min(4, Math.floor(Math.max(0, Math.min(100, pct)) / 20.01));
    return VIZ.nube[i];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Medidor de cobertura nubosa (arco) ──────────────────────────────────────
// Un ratio contra un límite se lee mejor como medidor que como tarta de 2 gajos.
export function medidorNubosidad(pct: number | null, etiqueta: string, subtitulo: string): string {
    const W = 190, H = 128, cx = W / 2, cy = 96, r = 62;
    const arco = (desde: number, hasta: number, color: string, ancho: number) => {
        const a0 = Math.PI * (1 + desde / 100), a1 = Math.PI * (1 + hasta / 100);
        const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
        const largo = hasta - desde > 50 ? 1 : 0;
        return `<path d="M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${largo},1 ${x1.toFixed(1)},${y1.toFixed(1)}"
                 fill="none" stroke="${color}" stroke-width="${ancho}" stroke-linecap="round"/>`;
    };
    const pista = arco(0, 100, VIZ.grid, 13);
    if (pct == null) {
        return `<svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="${esc(etiqueta)}: sin dato">
            ${pista}
            <text x="${cx}" y="${cy - 12}" text-anchor="middle" font-size="15" font-weight="700"
                  fill="${VIZ.estado.aviso}" font-family="system-ui">S/D</text>
            <text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="8.5"
                  fill="${VIZ.inkMuted}" font-family="system-ui">sin fuente</text>
            <text x="${cx}" y="${cy + 26}" text-anchor="middle" font-size="9.5" font-weight="600"
                  fill="${VIZ.inkSecondary}" font-family="system-ui">${esc(etiqueta)}</text>
        </svg>`;
    }
    const v = Math.max(0, Math.min(100, pct));
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="${esc(etiqueta)}: ${v.toFixed(0)} por ciento">
        ${pista}
        ${arco(0, v, colorNubosidad(v), 13)}
        <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="30" font-weight="700"
              fill="${VIZ.inkPrimary}" font-family="system-ui">${v.toFixed(0)}<tspan font-size="14">%</tspan></text>
        <text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="9"
              fill="${VIZ.inkSecondary}" font-family="system-ui">${esc(subtitulo)}</text>
        <text x="${cx}" y="${cy + 28}" text-anchor="middle" font-size="9.5" font-weight="600"
              fill="${VIZ.inkSecondary}" font-family="system-ui">${esc(etiqueta)}</text>
        <text x="${cx - r}" y="${cy + 15}" text-anchor="middle" font-size="7.5" fill="${VIZ.inkMuted}" font-family="system-ui">0</text>
        <text x="${cx + r}" y="${cy + 15}" text-anchor="middle" font-size="7.5" fill="${VIZ.inkMuted}" font-family="system-ui">100</text>
    </svg>`;
}

// ── Medidor circular de índice (anillo completo) ────────────────────────────
/**
 * Anillo 0-100 para los índices agroclimáticos del tablero ejecutivo.
 * Sin dato muestra "S/D" y el anillo queda en la pista gris: nunca un 0, que se
 * leería como "riesgo nulo" o "demanda nula" en vez de "no medido".
 */
export function medidorIndice(
    valor: number | null, clave: string, subtitulo: string,
    etiqueta: string, color: string, implicacion = '',
): string {
    // cy=58 y r=42 dejan aire entre el borde inferior del anillo y el rótulo.
    const W = 132, H = implicacion ? 166 : 150, cx = W / 2, cy = 58, r = 42, grosor = 9;
    const circ = 2 * Math.PI * r;
    const pista = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${VIZ.grid}" stroke-width="${grosor}"/>`;
    const arco = valor != null
        ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${grosor}"
                   stroke-linecap="round" stroke-dasharray="${(circ * valor / 100).toFixed(1)} ${circ.toFixed(1)}"
                   transform="rotate(-90 ${cx} ${cy})"/>` : '';
    const centro = valor != null
        ? `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="27" font-weight="700"
                 fill="${VIZ.inkPrimary}" font-family="system-ui">${valor}</text>
           <text x="${cx}" y="${cy + 19}" text-anchor="middle" font-size="8"
                 fill="${VIZ.inkMuted}" font-family="system-ui">/100</text>`
        : `<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="17" font-weight="700"
                 fill="${VIZ.estado.aviso}" font-family="system-ui">S/D</text>`;
    // La implicación traduce el número a acción: un "46" no dice nada por sí solo
    // a quien no conoce la escala; "riego según programa" sí.
    // La etiqueta ocupa hasta `base - 7`; el separador va DEBAJO de esa línea de
    // base, no a una altura fija que la cruzaría.
    const base = implicacion ? H - 20 : H;
    const implSVG = implicacion
        ? `<line x1="20" y1="${base - 1}" x2="${W - 20}" y2="${base - 1}" stroke="${VIZ.grid}" stroke-width="1"/>
           <text x="${cx}" y="${base + 13}" text-anchor="middle" font-size="8"
                 fill="${VIZ.inkSecondary}" font-family="system-ui">${esc(implicacion)}</text>` : '';
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
                 aria-label="${esc(clave)}: ${valor != null ? valor + ' de 100, ' + etiqueta : 'sin dato'}${implicacion ? '. ' + esc(implicacion) : ''}">
        ${pista}${arco}${centro}
        <text x="${cx}" y="${base - 34}" text-anchor="middle" font-size="11" font-weight="800"
              fill="${VIZ.inkPrimary}" font-family="system-ui">${esc(clave)}</text>
        <text x="${cx}" y="${base - 22}" text-anchor="middle" font-size="7.4"
              fill="${VIZ.inkMuted}" font-family="system-ui">${esc(subtitulo)}</text>
        <text x="${cx}" y="${base - 7}" text-anchor="middle" font-size="9.5" font-weight="700"
              fill="${color}" font-family="system-ui">${esc(etiqueta)}</text>
        ${implSVG}
    </svg>`;
}

// ── Barra de progreso segmentada (nivel de demanda) ─────────────────────────
/** Barra de 12 segmentos para el nivel de demanda respecto del máximo histórico. */
export function barraNivel(pct: number | null, color: string): string {
    const N = 12, W = 260, H = 16, gap = 3;
    const w = (W - gap * (N - 1)) / N;
    const llenos = pct != null ? Math.round((clampPct(pct) / 100) * N) : 0;
    const segs = Array.from({ length: N }, (_, i) =>
        `<rect x="${(i * (w + gap)).toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}" rx="3"
               fill="${i < llenos ? color : VIZ.grid}"/>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
                 aria-label="Nivel de demanda: ${pct != null ? pct + ' por ciento' : 'sin dato'}">${segs}</svg>`;
}

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

// ── Serie 24 h de nubosidad por capas + precipitación ───────────────────────
export interface PuntoSerie {
    hora: string;          // etiqueta local "14:00"
    horizonte: number;
    total: number | null;
    baja: number | null;
    media: number | null;
    alta: number | null;
    prob: number | null;
    mm: number | null;
    temp: number | null;
}

/**
 * Evolución de la nubosidad a 24 h.
 * Una sola magnitud (% de cobertura) en un solo eje. La precipitación va en su
 * propia gráfica: mezclarlas en un eje doble sería engañoso.
 */
export function graficaNubosidad24h(serie: PuntoSerie[]): string {
    const pts = serie.filter(p => p.total != null);
    if (pts.length < 2) return '';
    const W = 860, H = 240, ML = 40, MR = 16, MT = 18, MB = 34;
    const iw = W - ML - MR, ih = H - MT - MB;
    const x = (i: number) => ML + (i / (pts.length - 1)) * iw;
    const y = (v: number) => MT + ih - (Math.max(0, Math.min(100, v)) / 100) * ih;

    // Rejilla horizontal recesiva, 1px sólida
    const grid = [0, 25, 50, 75, 100].map(v =>
        `<line x1="${ML}" y1="${y(v).toFixed(1)}" x2="${W - MR}" y2="${y(v).toFixed(1)}"
               stroke="${VIZ.grid}" stroke-width="1"/>
         <text x="${ML - 7}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="9"
               fill="${VIZ.inkMuted}" font-family="system-ui">${v}</text>`).join('');

    // Área de cobertura total: lavado al 10 %, nunca un bloque saturado
    const linea = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.total!).toFixed(1)}`).join(' ');
    const area = `${linea} L${x(pts.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;

    // Tramos donde el punto siguiente NO es la hora consecutiva (hueco real:
    // ninguna estación reportó ese horizonte) se dibujan punteados y en gris,
    // para no sugerir una transición observada donde en realidad se interpola
    // sobre datos ausentes.
    const huecos = pts.slice(1).map((p, k) => {
        const prev = pts[k];
        if (p.horizonte - prev.horizonte <= 1) return '';
        return `<line x1="${x(k).toFixed(1)}" y1="${y(prev.total!).toFixed(1)}"
                      x2="${x(k + 1).toFixed(1)}" y2="${y(p.total!).toFixed(1)}"
                      stroke="${VIZ.inkMuted}" stroke-width="2" stroke-dasharray="3,3"/>`;
    }).join('');

    // Capas baja/media/alta como líneas finas de apoyo
    const capa = (campo: 'baja' | 'media' | 'alta', color: string, dash: string) => {
        const vs = pts.map((p, i) => ({ i, v: p[campo] }));
        if (!vs.some(o => o.v != null)) return '';
        return `<path d="${vs.filter(o => o.v != null).map((o, k) => `${k ? 'L' : 'M'}${x(o.i).toFixed(1)},${y(o.v!).toFixed(1)}`).join(' ')}"
                 fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="${dash}"
                 stroke-linejoin="round" opacity="0.75"/>`;
    };

    // Etiquetas SELECTIVAS: máximo, mínimo y final. Nunca una por punto.
    // La etiqueta se ancla dentro del lienzo: si el punto está cerca de un borde,
    // el texto se coloca hacia dentro y se desplaza en X para no salirse.
    const iMax = pts.reduce((m, p, i) => (p.total! > pts[m].total! ? i : m), 0);
    const iMin = pts.reduce((m, p, i) => (p.total! < pts[m].total! ? i : m), 0);
    const marcas = [...new Set([iMax, iMin, pts.length - 1])].map(i => {
        const p = pts[i], px = x(i), py = y(p.total!);
        // Vertical: arriba salvo que no quepa; abajo salvo que se salga del eje.
        const cabeArriba = py - 11 > MT + 4;
        const ty = cabeArriba ? py - 11 : Math.min(py + 16, MT + ih - 3);
        // Horizontal: pega el ancla al borde en los extremos
        const anchor = px < ML + 22 ? 'start' : px > W - MR - 22 ? 'end' : 'middle';
        const tx = anchor === 'start' ? px - 4 : anchor === 'end' ? px + 4 : px;
        return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.5" fill="${VIZ.nube[3]}"
                        stroke="${VIZ.surface}" stroke-width="2"/>
                <text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}"
                      font-size="10" font-weight="700" fill="${VIZ.inkPrimary}" font-family="system-ui"
                      paint-order="stroke" stroke="${VIZ.surface}" stroke-width="3">${p.total!.toFixed(0)}%</text>`;
    }).join('');

    // Eje X: una etiqueta cada ~4 h para no saturar
    const paso = Math.max(1, Math.round(pts.length / 7));
    const ejeX = pts.map((p, i) => i % paso === 0
        ? `<text x="${x(i).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="9"
                 fill="${VIZ.inkMuted}" font-family="system-ui">${esc(p.hora)}</text>` : '').join('');

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
                 aria-label="Cobertura nubosa prevista por el modelo en las próximas 24 horas">
        ${grid}
        <path d="${area}" fill="${VIZ.nube[2]}" opacity="0.10"/>
        ${capa('alta', VIZ.nube[0], '9,4')}
        ${capa('media', VIZ.nube[1], '4,4')}
        ${capa('baja', VIZ.nube[4], '1,3')}
        <path d="${linea}" fill="none" stroke="${VIZ.nube[3]}" stroke-width="2"
              stroke-linejoin="round" stroke-linecap="round"/>
        ${huecos}
        ${marcas}
        <line x1="${ML}" y1="${y(0).toFixed(1)}" x2="${W - MR}" y2="${y(0).toFixed(1)}"
              stroke="${VIZ.axis}" stroke-width="1"/>
        ${ejeX}
        <text x="${ML - 7}" y="${MT - 6}" text-anchor="end" font-size="8"
              fill="${VIZ.inkMuted}" font-family="system-ui">%</text>
    </svg>`;
}

/**
 * Probabilidad y cantidad de precipitación a 24 h.
 * Gráfica SEPARADA de la nubosidad — escalas independientes, sin doble eje.
 */
export function graficaPrecipitacion24h(serie: PuntoSerie[]): string {
    const pts = serie.filter(p => p.prob != null);
    if (pts.length < 2) return '';
    const W = 860, H = 190, ML = 40, MR = 16, MT = 16, MB = 32;
    const iw = W - ML - MR, ih = H - MT - MB;
    const ancho = Math.min(24, (iw / pts.length) - 2);   // ≤24px, 2px de aire
    const x = (i: number) => ML + (i + 0.5) * (iw / pts.length);
    const y = (v: number) => MT + ih - (Math.max(0, Math.min(100, v)) / 100) * ih;

    const grid = [0, 25, 50, 75, 100].map(v =>
        `<line x1="${ML}" y1="${y(v).toFixed(1)}" x2="${W - MR}" y2="${y(v).toFixed(1)}"
               stroke="${VIZ.grid}" stroke-width="1"/>
         <text x="${ML - 7}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="9"
               fill="${VIZ.inkMuted}" font-family="system-ui">${v}</text>`).join('');

    // Columnas con extremo superior redondeado 4px y base cuadrada
    const barras = pts.map((p, i) => {
        const h = y(0) - y(p.prob!);
        if (h < 0.6) return '';
        const bx = x(i) - ancho / 2, by = y(p.prob!), r = Math.min(4, h);
        return `<path d="M${bx.toFixed(1)},${(by + h).toFixed(1)} L${bx.toFixed(1)},${(by + r).toFixed(1)}
                 Q${bx.toFixed(1)},${by.toFixed(1)} ${(bx + r).toFixed(1)},${by.toFixed(1)}
                 L${(bx + ancho - r).toFixed(1)},${by.toFixed(1)}
                 Q${(bx + ancho).toFixed(1)},${by.toFixed(1)} ${(bx + ancho).toFixed(1)},${(by + r).toFixed(1)}
                 L${(bx + ancho).toFixed(1)},${(by + h).toFixed(1)} Z"
                 fill="${VIZ.lluvia}" opacity="${p.prob! >= 50 ? 1 : 0.55}"/>`;
    }).join('');

    // Etiqueta solo del máximo — el resto lo cuentan el eje y la tabla
    const iMax = pts.reduce((m, p, i) => (p.prob! > pts[m].prob! ? i : m), 0);
    const pMax = pts[iMax];
    const etiqMax = pMax.prob! > 0
        ? `<text x="${x(iMax).toFixed(1)}" y="${(y(pMax.prob!) - 7).toFixed(1)}" text-anchor="middle"
                 font-size="10" font-weight="700" fill="${VIZ.inkPrimary}" font-family="system-ui"
                 paint-order="stroke" stroke="${VIZ.surface}" stroke-width="3">${pMax.prob!.toFixed(0)}%</text>` : '';

    const paso = Math.max(1, Math.round(pts.length / 7));
    const ejeX = pts.map((p, i) => i % paso === 0
        ? `<text x="${x(i).toFixed(1)}" y="${H - 11}" text-anchor="middle" font-size="9"
                 fill="${VIZ.inkMuted}" font-family="system-ui">${esc(p.hora)}</text>` : '').join('');

    // Umbral operativo del 50 %
    const umbral = `<line x1="${ML}" y1="${y(50).toFixed(1)}" x2="${W - MR}" y2="${y(50).toFixed(1)}"
                          stroke="${VIZ.estado.aviso}" stroke-width="1" stroke-dasharray="4,3" opacity="0.7"/>
                    <text x="${W - MR - 2}" y="${(y(50) - 4).toFixed(1)}" text-anchor="end" font-size="8"
                          fill="${VIZ.estado.aviso}" font-family="system-ui" font-weight="600">umbral 50 %</text>`;

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
                 aria-label="Probabilidad de precipitación por hora en las próximas 24 horas">
        ${grid}${umbral}${barras}${etiqMax}
        <line x1="${ML}" y1="${y(0).toFixed(1)}" x2="${W - MR}" y2="${y(0).toFixed(1)}"
              stroke="${VIZ.axis}" stroke-width="1"/>
        ${ejeX}
        <text x="${ML - 7}" y="${MT - 5}" text-anchor="end" font-size="8"
              fill="${VIZ.inkMuted}" font-family="system-ui">%</text>
    </svg>`;
}

/**
 * Marcha térmica prevista a 24 h (línea única, sin leyenda: el título la nombra).
 */
export function graficaTemperatura24h(serie: PuntoSerie[]): string {
    const pts = serie.filter(p => p.temp != null);
    if (pts.length < 2) return '';
    const W = 860, H = 170, ML = 40, MR = 16, MT = 18, MB = 30;
    const iw = W - ML - MR, ih = H - MT - MB;
    const vs = pts.map(p => p.temp!);
    const lo = Math.floor(Math.min(...vs) - 2), hi = Math.ceil(Math.max(...vs) + 2);
    const x = (i: number) => ML + (i / (pts.length - 1)) * iw;
    const y = (v: number) => MT + ih - ((v - lo) / Math.max(1e-6, hi - lo)) * ih;

    const ticks = [lo, (lo + hi) / 2, hi].map(v =>
        `<line x1="${ML}" y1="${y(v).toFixed(1)}" x2="${W - MR}" y2="${y(v).toFixed(1)}"
               stroke="${VIZ.grid}" stroke-width="1"/>
         <text x="${ML - 7}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="9"
               fill="${VIZ.inkMuted}" font-family="system-ui">${v.toFixed(0)}°</text>`).join('');

    const linea = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.temp!).toFixed(1)}`).join(' ');
    const iMax = vs.indexOf(Math.max(...vs)), iMin = vs.indexOf(Math.min(...vs));
    const marca = (i: number, txt: string) => {
        const px = x(i), py = y(pts[i].temp!);
        return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.5" fill="${VIZ.serie[3]}"
                        stroke="${VIZ.surface}" stroke-width="2"/>
                <text x="${px.toFixed(1)}" y="${(py > MT + 24 ? py - 10 : py + 15).toFixed(1)}" text-anchor="middle"
                      font-size="10" font-weight="700" fill="${VIZ.inkPrimary}" font-family="system-ui"
                      paint-order="stroke" stroke="${VIZ.surface}" stroke-width="3">${txt}</text>`;
    };

    const paso = Math.max(1, Math.round(pts.length / 7));
    const ejeX = pts.map((p, i) => i % paso === 0
        ? `<text x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="9"
                 fill="${VIZ.inkMuted}" font-family="system-ui">${esc(p.hora)}</text>` : '').join('');

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
                 aria-label="Marcha térmica prevista para las próximas 24 horas">
        ${ticks}
        <path d="${linea}" fill="none" stroke="${VIZ.serie[3]}" stroke-width="2"
              stroke-linejoin="round" stroke-linecap="round"/>
        ${marca(iMax, `máx ${vs[iMax].toFixed(0)}°`)}
        ${marca(iMin, `mín ${vs[iMin].toFixed(0)}°`)}
        ${ejeX}
    </svg>`;
}

/**
 * Comparativa de ETₒ por estación (barras horizontales, magnitud → secuencial).
 * Etiqueta directa al extremo de cada barra: resuelve el aviso de contraste.
 */
export function graficaEtoEstaciones(datos: { nombre: string; eto: number | null }[]): string {
    const d = datos.filter(x => x.eto != null) as { nombre: string; eto: number }[];
    if (!d.length) return '';
    const W = 420, filaH = 30, MT = 8, ML = 104, MR = 54;
    const H = MT + d.length * filaH + 8;
    const max = Math.max(...d.map(x => x.eto), 0.1);
    const iw = W - ML - MR;
    const alto = Math.min(18, filaH - 12);

    const barras = d.map((x, i) => {
        const w = Math.max(2, (x.eto / max) * iw);
        const by = MT + i * filaH + (filaH - alto) / 2;
        const r = Math.min(4, w);
        // Extremo redondeado 4px al final del dato, cuadrado en la línea base
        return `<path d="M${ML},${by.toFixed(1)} L${(ML + w - r).toFixed(1)},${by.toFixed(1)}
                 Q${(ML + w).toFixed(1)},${by.toFixed(1)} ${(ML + w).toFixed(1)},${(by + r).toFixed(1)}
                 L${(ML + w).toFixed(1)},${(by + alto - r).toFixed(1)}
                 Q${(ML + w).toFixed(1)},${(by + alto).toFixed(1)} ${(ML + w - r).toFixed(1)},${(by + alto).toFixed(1)}
                 L${ML},${(by + alto).toFixed(1)} Z" fill="${VIZ.nube[2]}"/>
                <text x="${ML - 8}" y="${(by + alto / 2 + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5"
                      font-weight="600" fill="${VIZ.inkSecondary}" font-family="system-ui">${esc(x.nombre)}</text>
                <text x="${(ML + w + 7).toFixed(1)}" y="${(by + alto / 2 + 3.5).toFixed(1)}" font-size="9.5"
                      font-weight="700" fill="${VIZ.inkPrimary}" font-family="system-ui"
                      style="font-variant-numeric:tabular-nums">${x.eto.toFixed(2)} mm</text>`;
    }).join('');

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
                 aria-label="Evapotranspiración de referencia por estación">
        <line x1="${ML}" y1="${MT}" x2="${ML}" y2="${H - 8}" stroke="${VIZ.axis}" stroke-width="1"/>
        ${barras}
    </svg>`;
}

/**
 * Franja de calidad por estación: barra apilada horizontal de la edad del dato.
 * Cada tramo lleva icono + texto, así el estado nunca depende solo del color.
 */
export function franjaCalidad(
    datos: { nombre: string; edadMin: number | null; status: string }[],
): string {
    if (!datos.length) return '';
    const W = 420, filaH = 26, MT = 6, ML = 104, MR = 8;
    const H = MT + datos.length * filaH + 4;
    const iw = W - ML - MR;
    const TOPE = 120;                                  // minutos que ocupan el ancho total

    const filas = datos.map((x, i) => {
        const by = MT + i * filaH + 6;
        const col = x.status === 'valid' ? VIZ.estado.bueno
            : x.status === 'stale' ? VIZ.estado.aviso
                : x.status === 'suspect' ? VIZ.estado.serio : VIZ.estado.critico;
        const icono = x.status === 'valid' ? '●' : x.status === 'expired' ? '▲' : '◆';
        const edad = x.edadMin ?? TOPE;
        const w = Math.max(3, Math.min(1, edad / TOPE) * iw);
        const txt = x.edadMin == null ? 's/d'
            : x.edadMin < 60 ? `${Math.round(x.edadMin)} min` : `${(x.edadMin / 60).toFixed(1)} h`;
        // El valor va DENTRO de la barra solo si cabe con holgura; si no, fuera,
        // en tinta secundaria. Nunca se recorta ni se desborda del riel.
        const anchoTxt = txt.length * 4.6 + 10;
        const dentro = w >= anchoTxt;
        const etiqueta = dentro
            ? `<text x="${(ML + w - 5).toFixed(1)}" y="${by + 9.5}" text-anchor="end" font-size="8"
                     font-weight="700" fill="${VIZ.surface}" font-family="system-ui">${txt}</text>`
            : `<text x="${(ML + w + 5).toFixed(1)}" y="${by + 9.5}" font-size="8"
                     font-weight="700" fill="${VIZ.inkSecondary}" font-family="system-ui">${txt}</text>`;
        return `<rect x="${ML}" y="${by}" width="${iw}" height="12" rx="3" fill="${VIZ.grid}"/>
                <rect x="${ML}" y="${by}" width="${w.toFixed(1)}" height="12" rx="3" fill="${col}"/>
                <text x="${ML - 8}" y="${by + 9.5}" text-anchor="end" font-size="9.5" font-weight="600"
                      fill="${VIZ.inkSecondary}" font-family="system-ui">${esc(x.nombre)}</text>
                <text x="${(ML + iw + 4).toFixed(1)}" y="${by + 9.5}" font-size="8.5" font-weight="700"
                      fill="${col}" font-family="system-ui">${icono}</text>
                ${etiqueta}`;
    }).join('');

    // Referencias de los umbrales de frescura (20 y 60 min)
    const ref = [20, 60].map(m => {
        const rx = ML + (m / TOPE) * iw;
        return `<line x1="${rx.toFixed(1)}" y1="${MT}" x2="${rx.toFixed(1)}" y2="${H - 6}"
                      stroke="${VIZ.axis}" stroke-width="1" stroke-dasharray="2,3"/>
                <text x="${rx.toFixed(1)}" y="${H - 0.5}" text-anchor="middle" font-size="7"
                      fill="${VIZ.inkMuted}" font-family="system-ui">${m}′</text>`;
    }).join('');

    return `<svg viewBox="0 0 ${W} ${H + 4}" width="100%" role="img"
                 aria-label="Edad del dato por estación frente a los umbrales de frescura">
        ${ref}${filas}
    </svg>`;
}
