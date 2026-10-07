/**
 * informeHistoricoDatos — arma todos los datos que consumen las plantillas del Informe Histórico.
 *
 * Una sola pasada: `prepararInforme(config, indice)` devuelve `DatosInforme` con cada bloque ya calculado.
 * Los `null` se propagan hasta la plantilla (que debe pintarlos como "S/D"); aquí nunca se interpola ni se rellena.
 */
import {
    aniosDisponibles, aperturaMes, cierreMes, claveFecha, diasDelMes, deltaMes, etiquetaMetrica, extremos, formatearNumero,
    matrizMensual, MESES_CORTO, MESES_LARGO, NOMBRE_PRESA, posicionHistorica, valorMetrica,
    type CeldaMatriz, type Extremos, type Indice, type MapaPresa, type Metrica, type PosicionAnual, type PresaId, type TipoSerie, type ValorFechado,
} from './historicoPresas';
import {
    anomaliaVsPromedio, huecos, percentilesHistoricos, resumenSerie, semaforo, tendenciaLineal,
    type Anomalia, type EstadoSemaforo, type Hueco, type PercentilesHistoricos, type ResumenSerie, type Tendencia,
} from './estadisticaHistorica';
import {
    avisosConfig, etiquetaAnio, etiquetaPeriodo, mesesDelPeriodo, ANIO_CAMBIO_CURVA,
    type ConfigInforme, type MesPeriodo,
} from './informeHistoricoConfig';

/** Cobertura mínima (fracción de días esperados con dato) para que un año entre a promedios, percentiles y tendencia. */
export const COBERTURA_MIN = 0.5;

export interface DiaSlot { mes: number; dia: number; etiqueta: string }

export interface SerieAnioInf {
    anio: number;
    etiqueta: string;
    esBase: boolean;
    parcial: boolean;
    cobertura: number | null;
    /** Alineada con `dias` del bloque; null = S/D. */
    valores: (number | null)[];
}

export interface CierreAnio { anio: number; etiqueta: string; valor: number | null; fecha: string | null; esBase: boolean; parcial: boolean; cobertura: number | null }

export interface CoberturaAnio {
    anio: number; etiqueta: string; esBase: boolean;
    esperados: number; conDato: number; sinDato: number; atipicos: number; pct: number | null; huecos: Hueco[];
}

export interface ClimatologiaMes { mes: number; etiqueta: string; media: number | null; min: number | null; max: number | null; n: number; base: number | null }

export interface BloqueMetrica {
    metrica: Metrica;
    nombre: string;
    unidad: string;
    decimales: number;
    dias: DiaSlot[];
    /** Primero el año base, luego los años de comparación. */
    series: SerieAnioInf[];
    /** Cierre del periodo de TODOS los años con registro (base resaltado), de más reciente a más antiguo. */
    cierres: CierreAnio[];
    cierreBase: ValorFechado | null;
    aperturaBase: ValorFechado | null;
    /** cierre − apertura dentro del periodo del año base; null si no hay dos fechas distintas. */
    variacionBase: number | null;
    /** Contra el año de comparación más reciente anterior a la base. */
    vsPrevio: { anio: number; etiqueta: string; abs: number; pct: number | null } | null;
    anomalia: Anomalia | null;
    estadisticaBase: ResumenSerie | null;
    percentiles: PercentilesHistoricos | null;
    posicion: { posicion: number; de: number } | null;
    semaforo: EstadoSemaforo;
    /** Años (ordenados de menor a mayor valor) que entraron al ranking. */
    ranking: PosicionAnual[];
    tendencia: Tendencia | null;
    extremosBase: Extremos | null;
    extremosHistoricos: Extremos | null;
    matriz: { anio: number; celdas: CeldaMatriz[] }[];
    climatologia: ClimatologiaMes[];
}

export interface FilaDelta { mes: number; etiqueta: string; porAnio: { anio: number; etiqueta: string; delta: number | null; base: 'mes-anterior' | 'primer-dia' | null }[] }

export interface PresaInforme {
    id: PresaId;
    nombre: string;
    bloques: BloqueMetrica[];
    /** Δ de almacenamiento entre cierres (aparente: no es extracción ni aportación). */
    deltas: FilaDelta[];
    calidad: CoberturaAnio[];
    hallazgos: string[];
    notasCurva: string[];
    advertencias: string[];
}

export interface DatosInforme {
    config: ConfigInforme;
    generado: Date;
    periodoEtiqueta: string;
    anios: { anio: number; etiqueta: string; esBase: boolean }[];
    fuentes: string[];
    advertencias: string[];
    presas: PresaInforme[];
}

const CAMBIO_BOQUILLA = 'La Boquilla: la tabla de capacidad cambió el 1-sep-2021 (CEAC-2893 → levantamiento 2020, capacidad 2,846.78 Mm³). La serie normalizada recalcula todos los años con la curva vigente.';
const NOTA_MADERO = 'Fco. I. Madero: tabla oficial de la SRL (333.32 Mm³) vigente desde el 8-jul-2021; los datos previos se normalizan con la curva empírica actual.';
const NOTA_2026 = 'El año en curso tiene lecturas esparcidas (captura de campo) y la ingesta diaria CILA desde el 5-oct-2026; su cobertura se informa y puede ser parcial.';

export const FUENTES_INFORME = [
    'Vista v_presas_serie_diaria: histórico mensual SRL 2021-2025 (HISTORICO), lecturas de campo SICA (CAMPO) e ingesta diaria CILA-IBWC (CILA).',
    'Si una fecha tiene varias fuentes prevalece CAMPO > CILA > HISTORICO.',
    'Serie normalizada: volumen y % recalculados desde la escala medida con la curva vigente de cada presa; serie reportada: valores tal como salieron en cada reporte.',
];

/** Slots de eje x: cada mes del periodo con los días de un calendario bisiesto (el 29-feb queda vacío en años no bisiestos). */
function construirSlots(meses: MesPeriodo[]): DiaSlot[] {
    const out: DiaSlot[] = [];
    for (const { mes } of meses) {
        const n = diasDelMes(2000, mes);
        for (let d = 1; d <= n; d++) out.push({ mes, dia: d, etiqueta: `${d} ${MESES_CORTO[mes - 1]}` });
    }
    return out;
}

function cierrePeriodo(mapa: MapaPresa | undefined, anio: number, meses: MesPeriodo[], metrica: Metrica, serie: TipoSerie): ValorFechado | null {
    for (let i = meses.length - 1; i >= 0; i--) {
        const c = cierreMes(mapa, anio + meses[i].desfase, meses[i].mes, metrica, serie);
        if (c) return c;
    }
    return null;
}

function aperturaPeriodo(mapa: MapaPresa | undefined, anio: number, meses: MesPeriodo[], metrica: Metrica, serie: TipoSerie): ValorFechado | null {
    for (const m of meses) {
        const c = aperturaMes(mapa, anio + m.desfase, m.mes, metrica, serie);
        if (c) return c;
    }
    return null;
}

/** Cobertura de un año dentro del periodo. Los días futuros (posteriores a `hoy`) no cuentan como esperados. */
function coberturaPeriodo(mapa: MapaPresa | undefined, anio: number, meses: MesPeriodo[], hoy: string, etiqueta: string, esBase: boolean): CoberturaAnio {
    let esperados = 0, conDato = 0, atipicos = 0;
    const lista: { fecha: string; hayDato: boolean }[] = [];
    for (const { mes, desfase } of meses) {
        const a = anio + desfase;
        for (let d = 1; d <= diasDelMes(a, mes); d++) {
            const fecha = claveFecha(a, mes, d);
            if (fecha > hoy) continue;
            esperados++;
            const p = mapa?.get(fecha);
            const hay = !!p && (p.escala != null || p.alm != null);
            if (hay) conDato++;
            if (p && (p.calidad === 'REVISAR' || p.calidad === 'FUERA_DE_RANGO')) atipicos++;
            lista.push({ fecha, hayDato: hay });
        }
    }
    return { anio, etiqueta, esBase, esperados, conDato, sinDato: esperados - conDato, atipicos, pct: esperados ? conDato / esperados : null, huecos: huecos(lista) };
}

const sd = (v: number | null, dec = 1) => formatearNumero(v, dec);
const signo = (v: number, dec = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatearNumero(Math.abs(v), dec)}`;

function bloqueMetrica(
    mapa: MapaPresa | undefined, c: ConfigInforme, metrica: Metrica, meses: MesPeriodo[], aniosTodos: number[], cobPorAnio: Map<number, CoberturaAnio>,
): BloqueMetrica {
    const { nombre, unidad, decimales } = etiquetaMetrica(metrica);
    const dias = construirSlots(meses);
    const aniosGraf = [c.anioBase, ...c.aniosComparar];
    const parcialDe = (a: number) => { const p = cobPorAnio.get(a)?.pct; return p == null || p < COBERTURA_MIN; };

    const series: SerieAnioInf[] = aniosGraf.map(a => ({
        anio: a, etiqueta: etiquetaAnio(c.periodo, a), esBase: a === c.anioBase, parcial: parcialDe(a), cobertura: cobPorAnio.get(a)?.pct ?? null,
        valores: meses.flatMap(({ mes, desfase }) =>
            Array.from({ length: diasDelMes(2000, mes) }, (_, i) => valorMetrica(mapa?.get(claveFecha(a + desfase, mes, i + 1)), metrica, c.serie))),
    }));

    const cierres: CierreAnio[] = aniosTodos.map(a => {
        const cp = cierrePeriodo(mapa, a, meses, metrica, c.serie);
        return { anio: a, etiqueta: etiquetaAnio(c.periodo, a), valor: cp?.valor ?? null, fecha: cp?.fecha ?? null, esBase: a === c.anioBase, parcial: parcialDe(a), cobertura: cobPorAnio.get(a)?.pct ?? null };
    });

    const cierreBase = cierrePeriodo(mapa, c.anioBase, meses, metrica, c.serie);
    const aperturaBase = aperturaPeriodo(mapa, c.anioBase, meses, metrica, c.serie);
    const variacionBase = cierreBase && aperturaBase && cierreBase.fecha !== aperturaBase.fecha ? cierreBase.valor - aperturaBase.valor : null;

    // Pool de referencia: años con dato y cobertura suficiente (la base siempre entra; los demás solo si cumplen o se pidió incluir parciales).
    const entra = (x: CierreAnio) => x.valor != null && (x.esBase || c.incluirParciales || !x.parcial);
    const ranking: PosicionAnual[] = cierres.filter(entra).map(x => ({ anio: x.anio, valor: x.valor as number, fecha: x.fecha as string })).sort((a, b) => a.valor - b.valor);
    const posicion = posicionHistorica(ranking, c.anioBase);
    const historicos = ranking.filter(x => x.anio !== c.anioBase).map(x => x.valor);

    const previo = cierres.filter(x => x.anio < c.anioBase && x.valor != null).sort((a, b) => b.anio - a.anio)[0];
    const vsPrevio = cierreBase && previo
        ? { anio: previo.anio, etiqueta: previo.etiqueta, abs: cierreBase.valor - (previo.valor as number), pct: previo.valor ? ((cierreBase.valor - (previo.valor as number)) / Math.abs(previo.valor as number)) * 100 : null }
        : null;

    // Estacionalidad: cierre de cada mes calendario sobre los años de referencia (sin la base) y el valor del año base.
    const climatologia: ClimatologiaMes[] = Array.from({ length: 12 }, (_, i) => {
        const mes = i + 1;
        const v = ranking.filter(x => x.anio !== c.anioBase).map(x => cierreMes(mapa, x.anio, mes, metrica, c.serie)?.valor ?? null);
        const r = resumenSerie(v);
        return { mes, etiqueta: MESES_LARGO[i], media: r?.media ?? null, min: r?.min ?? null, max: r?.max ?? null, n: r?.n ?? 0, base: cierreMes(mapa, c.anioBase, mes, metrica, c.serie)?.valor ?? null };
    });

    // Extremos del año base dentro del periodo, con fecha.
    let max: ValorFechado | null = null, min: ValorFechado | null = null;
    for (const { mes, desfase } of meses) {
        for (let d = 1; d <= diasDelMes(c.anioBase + desfase, mes); d++) {
            const fecha = claveFecha(c.anioBase + desfase, mes, d);
            const v = valorMetrica(mapa?.get(fecha), metrica, c.serie);
            if (v == null) continue;
            if (!max || v > max.valor) max = { fecha, valor: v };
            if (!min || v < min.valor) min = { fecha, valor: v };
        }
    }

    return {
        metrica, nombre, unidad, decimales, dias, series, cierres, cierreBase, aperturaBase, variacionBase, vsPrevio,
        anomalia: anomaliaVsPromedio(cierreBase?.valor, historicos),
        estadisticaBase: resumenSerie(series[0].valores),
        percentiles: percentilesHistoricos(historicos),
        posicion,
        semaforo: semaforo(posicion),
        ranking,
        tendencia: tendenciaLineal(ranking.map(x => ({ x: x.anio, y: x.valor }))),
        extremosBase: max && min ? { max, min } : null,
        extremosHistoricos: extremos(mapa, metrica, c.serie),
        matriz: [...matrizMensual(mapa, aniosTodos, metrica, c.serie)].map(([anio, celdas]) => ({ anio, celdas })),
        climatologia,
    };
}

function filasDelta(mapa: MapaPresa | undefined, c: ConfigInforme, meses: MesPeriodo[]): FilaDelta[] {
    const aniosGraf = [c.anioBase, ...c.aniosComparar];
    return meses.map(({ mes, desfase }) => ({
        mes, etiqueta: MESES_LARGO[mes - 1],
        porAnio: aniosGraf.map(a => {
            const d = deltaMes(mapa, a + desfase, mes, 'volumen', c.serie);
            return { anio: a, etiqueta: etiquetaAnio(c.periodo, a), delta: d?.delta ?? null, base: d?.base ?? null };
        }),
    }));
}

export function generarHallazgos(nombre: string, b: BloqueMetrica | undefined, pctBase: ValorFechado | null, cob: CoberturaAnio | undefined, periodo: string): string[] {
    const h: string[] = [];
    if (!b || !b.cierreBase) {
        h.push(`${nombre}: sin dato de ${b?.nombre.toLowerCase() ?? 'la métrica'} en el periodo del año base (S/D); no es posible resumir el estado.`);
        return h;
    }
    const f = new Date(b.cierreBase.fecha + 'T12:00:00');
    const fecha = `${f.getDate()} ${MESES_CORTO[f.getMonth()].toLowerCase()} ${f.getFullYear()}`;
    h.push(`${nombre} cerró ${periodo.toLowerCase()} en ${sd(b.cierreBase.valor, b.decimales)} ${b.unidad}${pctBase ? ` (${sd(pctBase.valor)} % de la capacidad)` : ''}, con dato al ${fecha}.`);
    if (b.vsPrevio) h.push(`Frente a ${b.vsPrevio.etiqueta}: ${signo(b.vsPrevio.abs, b.decimales)} ${b.unidad}${b.vsPrevio.pct != null ? ` (${signo(b.vsPrevio.pct)} %)` : ''}.`);
    if (b.posicion) h.push(`Ocupa el ${b.posicion.posicion}.º lugar de menor a mayor entre ${b.posicion.de} años con dato en el mismo periodo.`);
    if (b.anomalia) h.push(`Respecto al promedio de ${b.anomalia.n} años de referencia (${sd(b.anomalia.promedio, b.decimales)} ${b.unidad}): ${signo(b.anomalia.abs, b.decimales)} ${b.unidad}${b.anomalia.pct != null ? ` (${signo(b.anomalia.pct)} %)` : ''}.`);
    if (b.tendencia) h.push(`Tendencia descriptiva del cierre: ${signo(b.tendencia.pendiente, b.decimales)} ${b.unidad} por año (R² ${formatearNumero(b.tendencia.r2, 2)}, n = ${b.tendencia.n}); con tan pocos años no es predictiva.`);
    if (cob && cob.pct != null && cob.pct < 1) h.push(`Cobertura del año base: ${Math.round(cob.pct * 100)} % de los días esperados (${cob.sinDato} sin dato, S/D).`);
    return h;
}

export function prepararInforme(c: ConfigInforme, idx: Indice, hoy: Date = new Date()): DatosInforme {
    const anios = aniosDisponibles(idx);
    const meses = mesesDelPeriodo(c.periodo);
    const hoyIso = hoy.toISOString().slice(0, 10);
    const periodoEtiqueta = etiquetaPeriodo(c.periodo, c.anioBase);
    const metricasReales = c.metricas.filter((m): m is Metrica => m !== 'deltaAparente');
    const quiereDeltas = c.metricas.includes('deltaAparente') || c.secciones.includes('deltas');
    const aniosGraf = [c.anioBase, ...c.aniosComparar];
    const aniosTodos = [...new Set([...anios, ...aniosGraf])].sort((a, b) => b - a);

    const presas: PresaInforme[] = c.presas.map(id => {
        const mapa = idx[id];
        const nombre = NOMBRE_PRESA[id] ?? id;
        const cobPorAnio = new Map<number, CoberturaAnio>(
            aniosTodos.map(a => [a, coberturaPeriodo(mapa, a, meses, hoyIso, etiquetaAnio(c.periodo, a), a === c.anioBase)] as const),
        );
        const bloques = metricasReales.map(m => bloqueMetrica(mapa, c, m, meses, aniosTodos, cobPorAnio));
        const principal = bloques.find(b => b.metrica === 'volumen') ?? bloques[0];
        const pctBase = cierrePeriodo(mapa, c.anioBase, meses, 'llenado', c.serie);
        const calidad = aniosGraf.map(a => cobPorAnio.get(a) as CoberturaAnio);

        const notasCurva = id === 'PRE-001' ? [CAMBIO_BOQUILLA] : [NOTA_MADERO];
        if (aniosGraf.includes(hoy.getFullYear())) notasCurva.push(NOTA_2026);

        const advertencias: string[] = [];
        for (const k of calidad) {
            if (k.pct != null && k.pct < COBERTURA_MIN) advertencias.push(`${k.etiqueta}: cobertura ${Math.round(k.pct * 100)} % del periodo (parcial); ${c.incluirParciales || k.esBase ? 'se muestra' : 'se excluye de promedios, percentiles y tendencia'}.`);
            else if (k.huecos.length) advertencias.push(`${k.etiqueta}: ${k.huecos.length} tramo(s) sin dato (${k.sinDato} días S/D).`);
            if (k.atipicos) advertencias.push(`${k.etiqueta}: ${k.atipicos} día(s) marcados REVISAR/FUERA DE RANGO.`);
        }
        if (principal?.percentiles?.fragil) advertencias.push(`Percentiles con n = ${principal.percentiles.n} años: frágiles; interprételos junto con el valor de cada año.`);
        if (c.serie === 'reportada' && aniosGraf.some(a => a <= ANIO_CAMBIO_CURVA)) advertencias.push('Serie "como se reportó" con año ≤ 2021: mezcla tablas de capacidad distintas.');

        return {
            id, nombre, bloques,
            deltas: quiereDeltas ? filasDelta(mapa, c, meses) : [],
            calidad,
            hallazgos: generarHallazgos(nombre, principal, pctBase, cobPorAnio.get(c.anioBase), periodoEtiqueta),
            notasCurva, advertencias,
        };
    });

    return {
        config: c, generado: hoy, periodoEtiqueta,
        anios: aniosGraf.map(a => ({ anio: a, etiqueta: etiquetaAnio(c.periodo, a), esBase: a === c.anioBase })),
        fuentes: FUENTES_INFORME,
        advertencias: avisosConfig(c),
        presas,
    };
}
