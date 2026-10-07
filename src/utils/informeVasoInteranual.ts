// INFORME DEL VASO — comparativo interanual (capa pura). Mismo día en años anteriores y curvas anuales de volumen.
// Usa la serie NORMALIZADA (curva vigente) para que 2021-2025 sea comparable aunque la curva haya cambiado; no hay superficie interanual.
import { esc, SRL_MARRON } from './informeBase';
import { aniosDisponibles, diaDelAnio, mismaFecha, serieAnio, valorMetrica, type MapaPresa } from './historicoPresas';

export interface FilaInteranual {
    anio: number;
    fecha: string;
    volumen: number | null;
    elevacion: number | null;
    pct: number | null;
    desfaseDias: number;
    /** Volumen del año de referencia menos el de este año (positivo = hoy hay más agua). */
    difVolumen: number | null;
}

export interface Interanual {
    anioRef: number;
    mes: number;
    dia: number;
    volumenHoy: number | null;
    filas: FilaInteranual[];
    /** 1 = el más bajo entre los años con dato en esa fecha (incluye el año de referencia). */
    posicion: { posicion: number; de: number } | null;
    series: { anio: number; valores: (number | null)[] }[];
}

/** `fechaRef` = AAAA-MM-DD de la lectura vigente; `volumenHoy` = volumen oficial de esa lectura. Sin histórico → null. */
export function construirInteranual(mapa: MapaPresa | undefined, fechaRef: string | null, volumenHoy: number | null): Interanual | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaRef ?? '');
    if (!mapa || !m) return null;
    const anioRef = Number(m[1]), mes = Number(m[2]), dia = Number(m[3]);
    const previos = aniosDisponibles({ x: mapa }).filter((a) => a < anioRef).sort((a, b) => b - a);
    const vol = mismaFecha(mapa, mes, dia, previos, 'volumen', 'normalizada');
    const filas: FilaInteranual[] = vol.map((v) => {
        const p = mapa.get(v.fecha);
        return {
            anio: v.anio, fecha: v.fecha, volumen: v.valor, elevacion: valorMetrica(p, 'elevacion', 'normalizada'), pct: valorMetrica(p, 'llenado', 'normalizada'),
            desfaseDias: v.desfaseDias, difVolumen: volumenHoy != null ? volumenHoy - v.valor : null,
        };
    });
    const todos = [...filas.map((f) => f.volumen).filter((v): v is number => v != null), ...(volumenHoy != null ? [volumenHoy] : [])].sort((a, b) => a - b);
    const posicion = volumenHoy != null && todos.length >= 2 ? { posicion: todos.indexOf(volumenHoy) + 1, de: todos.length } : null;
    const series = [...previos, anioRef].map((a) => ({ anio: a, valores: serieAnio(mapa, a, 'volumen', 'normalizada') }))
        .filter((s) => s.valores.some((v) => v != null));
    return { anioRef, mes, dia, volumenHoy, filas, posicion, series };
}

/** Líneas diarias de volumen por año (días 1-366): pasados en gris con rótulo directo, el año de referencia en marrón grueso. */
export function interanualSvg(d: Interanual): string {
    const W = 680, H = 230, PL = 44, PR = 40, PT = 14, PB = 24, pw = W - PL - PR, ph = H - PT - PB;
    const todos = d.series.flatMap((s) => s.valores).filter((v): v is number => v != null);
    if (!todos.length) return '<p class="sd">Sin datos diarios para graficar.</p>';
    const lo = 0, hi = Math.ceil(Math.max(...todos) / 100) * 100;
    const x = (i: number) => PL + (i / 365) * pw;
    const y = (v: number) => PT + ph - ((v - lo) / (hi - lo)) * ph;
    const meses = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
    let fondo = '';
    for (let i = 0; i <= 4; i++) {
        const v = lo + (i / 4) * (hi - lo), yy = y(v);
        fondo += `<line x1="${PL}" y1="${yy.toFixed(1)}" x2="${PL + pw}" y2="${yy.toFixed(1)}" stroke="#dcd9d2" stroke-width="0.6"/><text x="${PL - 5}" y="${(yy + 3).toFixed(1)}" font-size="9" fill="#57606a" text-anchor="end">${v.toFixed(0)}</text>`;
    }
    fondo += meses.map((t, i) => `<text x="${x(diaDelAnio(i + 1, 15)).toFixed(1)}" y="${H - 7}" font-size="9" fill="#57606a" text-anchor="middle">${t}</text>`).join('');
    const marca = x(diaDelAnio(d.mes, d.dia));
    fondo += `<line x1="${marca.toFixed(1)}" y1="${PT}" x2="${marca.toFixed(1)}" y2="${PT + ph}" stroke="#57606a" stroke-dasharray="3 3" stroke-width="0.8"/>`;
    const lineas = d.series.map((s) => {
        const actual = s.anio === d.anioRef;
        let path = '', ultimo: [number, number] | null = null, previo = -99;
        s.valores.forEach((v, i) => {
            if (v == null) return;
            // Un hueco de un solo día (p. ej. el 29-feb de los años no bisiestos) no corta la línea.
            path += `${i - previo <= 2 ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; previo = i; ultimo = [x(i), y(v)];
        });
        const rot = ultimo ? `<text x="${(ultimo[0] + 4).toFixed(1)}" y="${(ultimo[1] + 3).toFixed(1)}" font-size="9" font-weight="${actual ? 700 : 400}" fill="${actual ? SRL_MARRON : '#57606a'}">${s.anio}</text>` : '';
        return `<path d="${path}" fill="none" stroke="${actual ? SRL_MARRON : '#8c959f'}" stroke-width="${actual ? 2.6 : 1.2}" stroke-opacity="${actual ? 1 : 0.75}"/>${rot}`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Volumen almacenado diario por año, ${d.series.map((s) => s.anio).join(', ')}"><rect width="${W}" height="${H}" fill="#fbfaf8"/>${fondo}${lineas}</svg>
<div class="leyenda"><span><i class="l-fill"></i>${esc(String(d.anioRef))} (año en curso)</span><span><i style="border-top:2px solid #8c959f"></i>Años anteriores (serie normalizada, Mm³)</span><span>Línea punteada = fecha de comparación</span></div>`;
}
