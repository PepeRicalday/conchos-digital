/**
 * ndviGrafica — datos y opción de ECharts de la gráfica principal del panel NDVI (sin React, con pruebas).
 *
 * Reglas: S/D nunca 0 (mes sin dato = null = hueco, connectNulls:false); los meses POSTERIORES a la última lectura de la
 * serie no son S/D sino "aún sin medir" y se sombrean aparte; promedio SRL = promedio simple de los módulos con dato
 * ("n de m"); NDVI de la frontera del módulo (sirve para comparar años, no es NDVI de parcela).
 */
import { CLASES_NDVI, NDVI_RANGO } from './ndviRampa';
import { COLOR_MODULO_SRL } from './modulosSRL';
import { COLOR_ANIO_FOCO, MESES_TEMPORADA, colorAnioPrevio, type FilaNdviV2 } from './ndviInteranual';
import { anomaliaDelPeriodo, type AnomaliaPeriodo } from './informeNdviAnalisis';
import { promedioSrl, valorIndice, type FilaIndice, type PromedioSrl } from './ndviSerie';
import { percentil } from './estadisticaHistorica';

export const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'] as const;
export const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] as const;
/** Temporada de riego marzo–septiembre: índices 2..8 del eje enero–diciembre. */
export const TEMPORADA_IDX: [number, number] = [2, 8];
export const UMBRAL_COBERTURA_ACTIVA = 0.3;

/** Eje de meses: en pantallas angostas se rotula uno de cada dos (Ene, Mar, May…) para que las etiquetas no se salten al azar. */
export function ejeMeses(angosto: boolean): Record<string, unknown> {
    return {
        type: 'category', data: [...MESES_CORTOS], boundaryGap: false, axisLine: { lineStyle: { color: '#475569' } },
        axisLabel: { color: '#cbd5e1', fontSize: 12, interval: angosto ? 1 : 0 },
    };
}

/** Símbolo propio de cada módulo: la identidad no depende solo del color (verde/rojo se confunden con daltonismo). */
export const SIMBOLO_MODULO: Record<number, string> = { 1: 'circle', 2: 'rect', 3: 'triangle', 4: 'diamond', 5: 'arrow', 12: 'pin' };
/** Años previos: forma propia además de la rampa de azules (los tonos cercanos se confunden). */
export const SIMBOLOS_ANIO = ['circle', 'rect', 'triangle', 'diamond', 'arrow', 'pin'];
export const MODULOS_GRAFICA = [1, 2, 3, 4, 5, 12] as const;

export type FilaMensual = { numero_modulo: number; mes: string; ndvi_medio: number };

export const anioDe = (mes: string): number => Number(mes.slice(0, 4));
export const aniosDeMeses = (meses: string[]): number[] => [...new Set(meses.map(anioDe))].sort((a, b) => a - b);

/** NDVI de un módulo en los 12 meses de un año: null = S/D (o aún sin medir). */
export function serieAnio12(filas: FilaMensual[], modulo: number, anio: number): (number | null)[] {
    const por = new Map(filas.filter((f) => f.numero_modulo === modulo).map((f) => [f.mes, f.ndvi_medio]));
    return MESES_CORTOS.map((_, i) => por.get(`${anio}-${String(i + 1).padStart(2, '0')}`) ?? null);
}

/** Mínimo de otros años para dar banda p10–p90 (con 2 puntos no dice nada). */
export const MIN_ANIOS_BANDA = 3;

export interface BandaMes { media: number | null; p10: number | null; p90: number | null; n: number }

/** Promedio y banda p10–p90 de cada mes (12) del módulo entre los años distintos de `excluirAnio`. Sin ≥3 años, sin banda. */
export function bandaMensual12(filas: FilaMensual[], modulo: number, anios: number[], excluirAnio: number): BandaMes[] {
    const otros = anios.filter((a) => a !== excluirAnio).map((a) => serieAnio12(filas, modulo, a));
    return MESES_CORTOS.map((_, i) => {
        const v = otros.map((s) => s[i]).filter((x): x is number => x != null);
        return {
            media: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null,
            p10: v.length >= MIN_ANIOS_BANDA ? percentil(v, 10) : null,
            p90: v.length >= MIN_ANIOS_BANDA ? percentil(v, 90) : null,
            n: v.length,
        };
    });
}

/** ICV o IHR de un módulo en los 12 meses de un año (null = S/D: sin fila del mes o sin insumo del índice). */
export function serieIndice12(filas: (FilaIndice & { mes: string })[], clave: 'icv' | 'ihr', anio: number): (number | null)[] {
    const por = new Map(filas.map((f) => [f.mes, f]));
    return MESES_CORTOS.map((_, i) => valorIndice(clave, por.get(`${anio}-${String(i + 1).padStart(2, '0')}`)));
}

/** Promedio simple de los módulos con dato en cada mes del año, con su "n de m". */
export function promedioSrlAnio(filas: FilaMensual[], modulos: readonly number[], anio: number): PromedioSrl[] {
    const series = modulos.map((m) => serieAnio12(filas, m, anio));
    return MESES_CORTOS.map((_, i) => promedioSrl(series.map((s) => s[i])));
}

/** Índice (0–11) del último mes con lectura posible en `anio`, o -1 si el año es posterior a la serie. Lo que sigue es "aún sin medir". */
export function ultimoIdxMedido(anio: number, ultimoMesSerie: string): number {
    if (anioDe(ultimoMesSerie) > anio) return 11;
    if (anioDe(ultimoMesSerie) < anio) return -1;
    return Number(ultimoMesSerie.slice(5, 7)) - 1;
}

const fmt3 = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(3) : 'S/D');

export interface ParamsGrafica {
    vista: 'anio' | 'comparar';
    anio: number;
    /** Solo en vista 'comparar': módulo a seguir en cada año (0 = promedio SRL). */
    modulo: number;
    filas: FilaMensual[];
    aniosDisponibles: number[];
    ultimoMesSerie: string;
    angosto: boolean;
    reducirMovimiento: boolean;
    /** Alto del gráfico en px (para separar etiquetas finales); sin dato se asume 380. */
    altoPx?: number;
}

export interface SerieTabla { nombre: string; valores: (number | null)[] }

/** Series (con nombre) que alimentan tanto la gráfica como su tabla alternativa. */
export function seriesDeGrafica(p: ParamsGrafica): SerieTabla[] {
    if (p.vista === 'anio') {
        const out: SerieTabla[] = MODULOS_GRAFICA.map((m) => ({ nombre: `Módulo ${m}`, valores: serieAnio12(p.filas, m, p.anio) }));
        out.push({ nombre: 'Promedio SRL', valores: promedioSrlAnio(p.filas, MODULOS_GRAFICA, p.anio).map((x) => x.valor) });
        return out;
    }
    return p.aniosDisponibles.map((a) => ({
        nombre: String(a),
        valores: p.modulo === 0 ? promedioSrlAnio(p.filas, MODULOS_GRAFICA, a).map((x) => x.valor) : serieAnio12(p.filas, p.modulo, a),
    }));
}

/** Meses medidos en que el promedio SRL no cuenta con los 6 módulos (para avisarlo bajo la gráfica). */
export function mesesPromedioIncompleto(filas: FilaMensual[], anio: number, hastaIdx: number): { mes: string; n: number; total: number }[] {
    return promedioSrlAnio(filas, MODULOS_GRAFICA, anio)
        .map((p, i) => ({ mes: MESES_CORTOS[i], n: p.n, total: p.total, i }))
        .filter((x) => x.i <= hastaIdx && x.n < x.total && x.n > 0)
        .map(({ mes, n, total }) => ({ mes, n, total }));
}

/** Titular descriptivo del año contra los demás años, módulo por módulo (nunca afirma causa). */
export interface TitularAnio {
    anio: number;
    abajo: number; arriba: number; similar: number; conReferencia: number;
    /** Promedio de las diferencias de NDVI medio de la temporada (mes a mes contra los otros años) de los módulos con referencia. */
    promedioAbs: number | null;
    texto: string;
}

export function titularAnio(v2: FilaNdviV2[], modulos: readonly number[], anio: number): TitularAnio | null {
    // Misma anomalía que el informe de tendencia: cada mes de marzo–septiembre del año contra ese mismo mes en los otros años.
    const mesesTemporada = MESES_TEMPORADA.map((m) => `${anio}-${m}`);
    return titularDeAnomalias(String(anio), anio, modulos.map((m) => anomaliaDelPeriodo(v2, m, mesesTemporada)));
}

/** Titular a partir de las anomalías del periodo de cada módulo (la misma pieza sirve al panel y al informe de tendencia). */
export function titularDeAnomalias(
    sujeto: string, anio: number, todas: Pick<AnomaliaPeriodo, 'mediaAbs' | 'direccion'>[],
    /** Promedio SRL ya calculado con la base elegida (simple/ponderado); sin él, promedio simple de las diferencias de los módulos. */
    opciones: { promedioAbs?: number | null; base?: 'simple' | 'ponderado' } = {},
): TitularAnio | null {
    const anoms = todas.filter((a) => a.mediaAbs != null && a.direccion != null);
    if (!anoms.length) return null;
    let abajo = 0, arriba = 0, similar = 0;
    for (const a of anoms) { if (a.direccion === 'abajo') abajo++; else if (a.direccion === 'arriba') arriba++; else similar++; }
    const prom = opciones.promedioAbs ?? anoms.reduce((s, a) => s + (a.mediaAbs as number), 0) / anoms.length;
    const n = anoms.length;
    const cifra = `${prom >= 0 ? '+' : '−'}${Math.abs(prom).toFixed(3)} promedio SRL${opciones.base === 'ponderado' ? ' ponderado por superficie' : ''}`;
    let cuerpo: string;
    if (abajo === n) cuerpo = `${sujeto} por debajo de lo habitual en los ${n} módulos`;
    else if (arriba === n) cuerpo = `${sujeto} por encima de lo habitual en los ${n} módulos`;
    else if (similar === n) cuerpo = `${sujeto} en línea con lo habitual en los ${n} módulos`;
    else cuerpo = `${sujeto} frente a lo habitual: ${abajo} por debajo, ${arriba} por encima y ${similar} en línea (de ${n} módulos)`;
    const texto = `${cuerpo} (${cifra})`;
    return { anio, abajo, arriba, similar, conReferencia: n, promedioAbs: prom, texto: texto.charAt(0).toUpperCase() + texto.slice(1) };
}

/** Cautela obligatoria junto al titular: describe, no explica. */
export const CAUTELA_TITULAR =
    'Lectura descriptiva de la vegetación en la frontera del módulo: no se explica solo por el volumen entregado y puede reflejar la programación del riego, el cierre del ciclo el 29 de septiembre o más pasos de satélite.';

/**
 * Desplazamiento vertical (px, + = hacia abajo) de cada etiqueta final para que no se pisen.
 * El `moveOverlap` de ECharts no separa etiquetas de series distintas cuando los valores casi coinciden
 * (en la vista de años 2021 y 2024 terminaban a 0.42 y se encimaban). Aquí cada valor se pasa a píxeles,
 * se ordena y se empuja hasta dejar `gapPx` entre vecinas, repartiendo el empuje a ambos lados.
 * `null` (serie sin dato) no ocupa lugar y recibe 0.
 */
export function separarEtiquetasFinales(ultimos: (number | null)[], rango: readonly [number, number], altoPlotPx: number, gapPx = 15): number[] {
    const [lo, hi] = rango;
    const aPx = (v: number) => ((hi - v) / (hi - lo)) * altoPlotPx;
    const items = ultimos.map((v, i) => ({ i, y: v == null || !Number.isFinite(v) ? null : aPx(v) })).filter((x): x is { i: number; y: number } => x.y != null).sort((a, b) => a.y - b.y);
    const pos = items.map((x) => x.y);
    for (let k = 1; k < pos.length; k++) if (pos[k] - pos[k - 1] < gapPx) pos[k] = pos[k - 1] + gapPx;
    // Si el empuje hacia abajo desplazó a todo el grupo, se recentra sobre su posición original (sin salirse del plot).
    if (pos.length) {
        const deriva = pos.reduce((a, y, k) => a + (y - items[k].y), 0) / pos.length;
        let corr = -deriva;
        if (pos[pos.length - 1] + corr > altoPlotPx) corr = altoPlotPx - pos[pos.length - 1];
        if (pos[0] + corr < 0) corr = -pos[0]; // si el grupo no cabe, manda el borde superior
        for (let k = 0; k < pos.length; k++) pos[k] += corr;
    }
    const out = ultimos.map(() => 0);
    items.forEach((x, k) => { out[x.i] = pos[k] - x.y; });
    return out;
}

const ultimoValido = (v: (number | null)[]): number | null => {
    for (let i = v.length - 1; i >= 0; i--) if (v[i] != null) return v[i];
    return null;
};

/** Opción de ECharts de la gráfica principal. */
export function opcionGraficaPrincipal(p: ParamsGrafica): Record<string, unknown> {
    const texto = '#cbd5e1';
    const hasta = ultimoIdxMedido(p.anio, p.ultimoMesSerie);
    const tabla = seriesDeGrafica(p);
    const previos = p.aniosDisponibles.filter((a) => a !== p.anio);
    // Alto útil del área de trazado (alto del gráfico menos márgenes superior e inferior del grid).
    const altoPlot = Math.max(120, (p.altoPx ?? 380) - (p.angosto ? 78 : 44) - 30);
    const dy = separarEtiquetasFinales(tabla.map((s) => ultimoValido(s.valores)), NDVI_RANGO, altoPlot);

    const series: Record<string, unknown>[] = tabla.map((s, idx) => {
        if (p.vista === 'anio') {
            const esProm = s.nombre === 'Promedio SRL';
            const m = esProm ? 0 : Number(s.nombre.replace('Módulo ', ''));
            const color = esProm ? '#f1f5f9' : COLOR_MODULO_SRL[m];
            return {
                name: s.nombre, type: 'line', connectNulls: false, data: s.valores,
                symbol: esProm ? 'none' : SIMBOLO_MODULO[m], symbolSize: esProm ? 0 : 8,
                lineStyle: { width: 2, color, type: esProm ? 'dashed' : 'solid' }, itemStyle: { color },
                z: esProm ? 6 : 3,
                endLabel: p.angosto ? { show: false } : { show: true, formatter: esProm ? 'SRL' : `M${m}`, color: texto, fontSize: 12, fontWeight: 700, offset: [0, dy[idx]] },
                labelLayout: { moveOverlap: 'shiftY' },
            };
        }
        const a = Number(s.nombre);
        const foco = a === p.anio;
        const color = foco ? COLOR_ANIO_FOCO : colorAnioPrevio(previos.indexOf(a), previos.length);
        return {
            name: s.nombre, type: 'line', connectNulls: false, data: s.valores, symbol: foco ? 'circle' : SIMBOLOS_ANIO[(previos.indexOf(a) + 1) % SIMBOLOS_ANIO.length], symbolSize: foco ? 9 : 7,
            lineStyle: { width: foco ? 4 : 1.8, color }, itemStyle: { color, borderColor: foco ? '#0f172a' : undefined, borderWidth: foco ? 2 : 0 },
            z: foco ? 6 : 3,
            endLabel: p.angosto ? { show: false } : { show: true, formatter: '{a}', color: foco ? COLOR_ANIO_FOCO : texto, fontSize: 12, fontWeight: foco ? 700 : 400, offset: [0, dy[idx]] },
            labelLayout: { moveOverlap: 'shiftY' },
        };
    });

    // Serie auxiliar (sin datos, sin leyenda ni tooltip): lleva las bandas de vigor, la línea de 0.30 y la temporada.
    const bandas = CLASES_NDVI.map((c) => [
        { yAxis: c.desde === -Infinity ? NDVI_RANGO[0] : c.desde, itemStyle: { color: c.color, opacity: 0.1 } },
        { yAxis: c.hasta === Infinity ? NDVI_RANGO[1] : Math.min(NDVI_RANGO[1], c.hasta) },
    ]);
    const marcas: Record<string, unknown> = {
        name: '_marcas', type: 'line', data: [], silent: true, tooltip: { show: false }, z: 0,
        markArea: {
            silent: true, data: [
                ...bandas,
                [{ xAxis: MESES_CORTOS[TEMPORADA_IDX[0]], itemStyle: { color: 'rgba(148,163,184,0.07)' } }, { xAxis: MESES_CORTOS[TEMPORADA_IDX[1]] }],
                ...(hasta >= 0 && hasta < 11 ? [[{ xAxis: MESES_CORTOS[hasta + 1], itemStyle: { color: 'rgba(15,23,42,0.55)' }, label: { show: true, formatter: 'aún sin medir', color: '#94a3b8', fontSize: 12, position: 'insideTop' } }, { xAxis: MESES_CORTOS[11] }]] : []),
            ],
        },
        markLine: {
            silent: true, symbol: 'none', animation: false,
            lineStyle: { color: '#fbbf24', type: 'dashed', width: 1.2 },
            label: { show: !p.angosto, formatter: '0.30 cobertura activa', position: 'insideStartTop', color: '#fbbf24', fontSize: 12 },
            data: [{ yAxis: UMBRAL_COBERTURA_ACTIVA }],
        },
    };
    series.push(marcas);

    const resumen = p.vista === 'anio'
        ? `NDVI mensual de ${p.anio} de los seis módulos y su promedio SRL, de enero a diciembre.`
        : `NDVI mensual de ${p.modulo === 0 ? 'el promedio SRL' : `el Módulo ${p.modulo}`} en ${p.aniosDisponibles.length} años, uno sobre otro; ${p.anio} destacado.`;

    return {
        backgroundColor: 'transparent', animation: !p.reducirMovimiento,
        aria: { enabled: true, label: { description: resumen } },
        grid: { left: 46, right: p.angosto ? 14 : 58, top: p.angosto ? 78 : 44, bottom: 30 },
        legend: { type: p.angosto ? 'plain' : 'scroll', top: 0, data: tabla.map((s) => s.nombre), textStyle: { color: texto, fontSize: 12 }, pageIconColor: '#cbd5e1', pageTextStyle: { color: texto }, itemWidth: 22 },
        tooltip: {
            trigger: 'axis', confine: true, backgroundColor: '#0f172a', borderColor: '#334155', textStyle: { color: '#f1f5f9', fontSize: 13 },
            valueFormatter: fmt3,
        },
        xAxis: ejeMeses(p.angosto),
        yAxis: {
            type: 'value', min: NDVI_RANGO[0], max: NDVI_RANGO[1], interval: 0.2,
            axisLabel: { color: texto, fontSize: 12, formatter: (v: number) => v.toFixed(1) }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)' } },
        },
        series,
    };
}
