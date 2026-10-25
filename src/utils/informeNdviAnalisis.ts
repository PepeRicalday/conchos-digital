/**
 * informeNdviAnalisis — tendencia y comparaciones PURAS del informe NDVI (sin React ni red), sobre la serie v2
 * (mediana mensual con máscara de nubes, 2021–2026).
 *
 * Reglas:
 *  - S/D nunca es 0: un mes sin fila entra como null y se descarta del cálculo, sin interpolar ni rellenar.
 *  - Toda cifra lleva su n. Con ~6 años de datos todo es DESCRIPTIVO: nunca se afirma causalidad ni significancia fuerte.
 *  - "Tendencia" NO es una pendiente dentro del ciclo: de marzo a septiembre el NDVI sube por fenología (siembra →
 *    vigor máximo) aunque el año sea malo, así que casi siempre diría "sube". Se mide de dos maneras que sí son honestas:
 *      1) ANOMALÍA: el periodo elegido contra el mismo mes de los demás años (climatología mensual del módulo).
 *      2) EVOLUCIÓN AÑO A AÑO: un valor por año (media y pico de la temporada mar–sep), con Theil–Sen y regresión.
 */
import { resumenSerie, tendenciaLineal, theilSen, r2CriticoAlfa05 } from './estadisticaHistorica';
import { media, mesDe } from './estadisticaBasica';
import { calcIHR } from './indicesSrl';
import { MODULOS_SRL_IDS, COLOR_MODULO_SRL } from './modulosSRL';
import { mesLegible } from './informeBase';
import {
    MESES_TEMPORADA, MIN_MESES_ANIO_COMPLETO, UMBRAL_SIN_CAMBIO, aniosDisponibles, esMesConfiable, resumenAnio, serieAnio, type FilaNdviV2,
} from './ndviInteranual';
import { aniosDeFilas, aniosDeReferencia, resolverContraste, type ConfigInformeNdvi, type RangoMes } from './informeNdviConfig';
import { promedioConBase, pesosSuperficie, type BasePromedio, type ParPeso } from './ndviPromedio';

/** Lo mínimo que se necesita de una fila de la serie v2 ya adaptada (FilaNdviSerie / FilaNdviInforme la cumplen). */
export interface FilaAnalisis {
    numero_modulo: number;
    nombre_modulo: string;
    mes: string;
    /** NDVI representativo del mes = mediana v2. */
    ndvi_medio: number;
    ndvi_desv: number | null;
    kc_estimado: number | null;
    superficie_ha: number | null;
    fraccion_cobertura_activa: number | null;
    /** Calidad del mes; si faltan, el mes no se marca como poco confiable. */
    n_escenas?: number | null;
    pct_pixeles_validos?: number | null;
}

const enRango = (mes: string, r: RangoMes) => mesDe(mes) >= r.desde && mesDe(mes) <= r.hasta;
/** Un valor que redondea a cero va sin signo («0.000»): «+0.000» sugiere un aumento que no existe. */
const signo = (v: number, d: number) => (Math.abs(v) < 0.5 * 10 ** -d ? (0).toFixed(d) : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`);

/** Adapta las filas del informe al formato de ndviInteranual (para reutilizar serieAnio, resumenAnio, esMesConfiable). */
export function aFilasV2(filas: FilaAnalisis[]): FilaNdviV2[] {
    return filas.map((f) => ({
        numero_modulo: f.numero_modulo, mes: mesDe(f.mes), ndvi_mediana: f.ndvi_medio, ndvi_p10: null, ndvi_p90: null,
        fraccion_cobertura_activa: f.fraccion_cobertura_activa, n_escenas: f.n_escenas ?? null, pct_pixeles_validos: f.pct_pixeles_validos ?? null,
        superficie_ha: f.superficie_ha,
    }));
}

// ─────────────────────────── Tendencia: anomalía contra la climatología ───────────────────────────

/**
 * Umbrales (documentados; con 6 años de serie son criterios de lectura, no pruebas de hipótesis):
 *  - MIN_ANIOS_REFERENCIA: un mes solo se compara si hay ≥ 3 OTROS años con dato en ese mismo mes (con 2 no hay dispersión).
 *  - MIN_ANIOS_REF_CONFIABLE: con menos de 4 años de referencia la anomalía se marca de baja confianza.
 *  - Z_INUSUAL: una anomalía media de ≥ 1.5 desviaciones de los otros años se describe como "fuera de lo habitual".
 *    Con 5 años de referencia la desviación es ella misma incierta (±35 %), por eso solo se dice "más lejos de lo habitual".
 *  - "Sin cambio" usa UMBRAL_SIN_CAMBIO (ndviInteranual.ts), el mismo para todo el informe.
 */
export const MIN_ANIOS_REFERENCIA = 3;
export const MIN_ANIOS_REF_CONFIABLE = 4;
export const Z_INUSUAL = 1.5;
/** Años completos mínimos para describir la evolución año a año (lo exige tendenciaLineal). */
export const MIN_ANIOS_TENDENCIA = 3;

export type DireccionAnomalia = 'arriba' | 'abajo' | 'similar' | null;

export interface MesAnomalia {
    mes: string;
    /** NDVI del módulo ese mes (null = S/D). */
    valor: number | null;
    /** Media de ese mismo mes en los demás años (null = sin referencia suficiente). */
    ref: number | null;
    /** Otros años con dato ese mes. */
    nRef: number;
    abs: number | null;
    /** abs / desviación de los otros años; null si no hay dispersión que medir. */
    z: number | null;
    /** false = el mes tiene pocas escenas limpias o pocos píxeles válidos. */
    confiable: boolean;
    /** El mes no pertenece a la temporada mar–sep, que es la única con climatología. */
    fueraTemporada: boolean;
}

export interface AnomaliaPeriodo {
    meses: MesAnomalia[];
    /** Meses con referencia (los que entran al resumen) y meses del periodo. */
    nConRef: number;
    nPeriodo: number;
    /** NDVI medio del periodo y su referencia, calculados sobre los MISMOS meses (con referencia). */
    mediaValor: number | null;
    mediaRef: number | null;
    mediaAbs: number | null;
    pct: number | null;
    zMedio: number | null;
    mesesArriba: number;
    mesesAbajo: number;
    mesesSimilar: number;
    direccion: DireccionAnomalia;
    fueraDeLoHabitual: boolean;
    /** Años de referencia del mes con menos años (y con más): la certeza de "lo habitual" depende de ellos. */
    minRef: number | null;
    maxRef: number | null;
    bajaConfianza: boolean;
    motivos: string[];
}

function resumirAnomalia(items: MesAnomalia[], motivosExtra: string[] = []): AnomaliaPeriodo {
    const conRef = items.filter((m) => m.abs != null && m.valor != null && m.ref != null);
    const mediaAbs = media(conRef.map((m) => m.abs));
    const mediaRef = media(conRef.map((m) => m.ref));
    const zMedio = media(conRef.map((m) => m.z));
    const direccion: DireccionAnomalia = mediaAbs == null ? null : Math.abs(mediaAbs) < UMBRAL_SIN_CAMBIO ? 'similar' : mediaAbs > 0 ? 'arriba' : 'abajo';
    const motivos = [...motivosExtra];
    const enTemporada = items.filter((m) => !m.fueraTemporada);
    const conValor = enTemporada.filter((m) => m.valor != null);
    const minRef = conRef.length ? Math.min(...conRef.map((m) => m.nRef)) : null;
    const maxRef = conRef.length ? Math.max(...conRef.map((m) => m.nRef)) : null;
    if (!conRef.length) motivos.push(`Sin referencia suficiente: se necesitan al menos ${MIN_ANIOS_REFERENCIA} otros años con dato en el mismo mes.`);
    else {
        if (conRef.length < conValor.length) motivos.push(`${conValor.length - conRef.length} de ${conValor.length} meses con dato no tienen ${MIN_ANIOS_REFERENCIA} años de referencia.`);
        if (minRef != null && minRef < MIN_ANIOS_REF_CONFIABLE) motivos.push(`La referencia tiene solo ${minRef} años en algún mes.`);
    }
    const pocos = conRef.filter((m) => !m.confiable).length;
    if (pocos) motivos.push(`${pocos} ${pocos === 1 ? 'mes tiene' : 'meses tienen'} pocas observaciones limpias del satélite.`);
    const sinDato = enTemporada.length - conValor.length;
    if (sinDato > 0) motivos.push(`${sinDato} ${sinDato === 1 ? 'mes del periodo no tiene' : 'meses del periodo no tienen'} dato (S/D).`);
    return {
        meses: items, nConRef: conRef.length, nPeriodo: items.length,
        mediaValor: media(conRef.map((m) => m.valor)), mediaRef, mediaAbs,
        pct: mediaAbs != null && mediaRef != null && mediaRef !== 0 ? (mediaAbs / Math.abs(mediaRef)) * 100 : null,
        zMedio,
        mesesArriba: conRef.filter((m) => (m.abs as number) >= UMBRAL_SIN_CAMBIO).length,
        mesesAbajo: conRef.filter((m) => (m.abs as number) <= -UMBRAL_SIN_CAMBIO).length,
        mesesSimilar: conRef.filter((m) => Math.abs(m.abs as number) < UMBRAL_SIN_CAMBIO).length,
        direccion, fueraDeLoHabitual: zMedio != null && Math.abs(zMedio) >= Z_INUSUAL,
        minRef, maxRef, bajaConfianza: motivos.length > 0 || !conRef.length, motivos,
    };
}

/** Anomalía de un módulo en los `meses` del periodo contra los demás años, mes por mes (la climatología excluye el año de cada mes). */
export function anomaliaDelPeriodo(v2: FilaNdviV2[], modulo: number, meses: string[]): AnomaliaPeriodo {
    const porMes = new Map(v2.filter((f) => f.numero_modulo === modulo).map((f) => [f.mes, f]));
    const anios = aniosDisponibles(v2, modulo);
    const items: MesAnomalia[] = meses.map((mes) => {
        const idx = MESES_TEMPORADA.indexOf(mes.slice(5, 7) as (typeof MESES_TEMPORADA)[number]);
        const fila = porMes.get(mes);
        const valor = fila?.ndvi_mediana ?? null;
        const base: MesAnomalia = { mes, valor, ref: null, nRef: 0, abs: null, z: null, confiable: fila ? esMesConfiable(fila) : true, fueraTemporada: idx < 0 };
        if (idx < 0) return base;
        const anio = Number(mes.slice(0, 4));
        const refs = anios.filter((a) => a !== anio).map((a) => serieAnio(v2, modulo, a)[idx]).filter((x): x is number => x != null);
        const r = resumenSerie(refs);
        if (valor == null || !r || r.n < MIN_ANIOS_REFERENCIA) return { ...base, nRef: refs.length };
        const abs = valor - r.media;
        return { ...base, ref: r.media, nRef: r.n, abs, z: r.desv > 0 ? abs / r.desv : null };
    });
    const fuera = items.filter((m) => m.fueraTemporada).length;
    return resumirAnomalia(items.filter((m) => !m.fueraTemporada), fuera ? [`${fuera} ${fuera === 1 ? 'mes del periodo cae' : 'meses del periodo caen'} fuera de marzo–septiembre y no se comparan.`] : []);
}

// ─────────────────────────── Tendencia: evolución año a año ───────────────────────────

export type PatronAnual = 'sube' | 'baja' | 'sin-patron' | 'insuficiente';

export interface AnioTemporada {
    anio: number;
    media: number | null;
    pico: number | null;
    mesesConDato: number;
    /** ≥ MIN_MESES_ANIO_COMPLETO meses: solo los años completos entran a la tendencia. */
    completo: boolean;
    pocoConfiable: boolean;
    /** Solo en el promedio SRL: cuántos módulos aportan ese año. */
    nModulos?: number;
}

export interface TendenciaAnual {
    /** Años completos usados. */
    n: number;
    /** Regresión por mínimos cuadrados, NDVI por año. */
    pendiente: number | null;
    /** Theil–Sen (mediana de pendientes por pares): robusta a un año atípico. */
    sen: number | null;
    r2: number | null;
    /** R² mínimo para significancia al 5 % con n puntos. */
    r2Umbral: number | null;
    /** Theil–Sen × años que abarca la serie: cuánto cambió de punta a punta. */
    cambioTotal: number | null;
    patron: PatronAnual;
}

/**
 * Patrón año a año. Se declara "sube"/"baja" solo si se cumplen LAS TRES: (a) R² ≥ valor crítico al 5 % para ese n
 * (≈ 0.66 con 6 años, 0.77 con 5, 0.90 con 4); (b) Theil–Sen y regresión con el mismo signo; (c) cambio de punta a punta ≥
 * UMBRAL_SIN_CAMBIO. Con menos de 3 años: "insuficiente". Aun así es descriptivo: 6 puntos no prueban una causa.
 */
export function patronAnual(pts: { x: number; y: number | null }[]): TendenciaAnual {
    const v = pts.filter((p): p is { x: number; y: number } => p.y != null && Number.isFinite(p.y));
    const vacio: TendenciaAnual = { n: v.length, pendiente: null, sen: null, r2: null, r2Umbral: null, cambioTotal: null, patron: 'insuficiente' };
    const t = tendenciaLineal(v);
    const sen = theilSen(v);
    if (!t || sen == null) return vacio;
    const span = Math.max(...v.map((p) => p.x)) - Math.min(...v.map((p) => p.x));
    const cambioTotal = sen * span;
    const r2Umbral = r2CriticoAlfa05(v.length);
    const claro = t.r2 >= r2Umbral && Math.sign(sen) === Math.sign(t.pendiente) && Math.abs(cambioTotal) >= UMBRAL_SIN_CAMBIO;
    return { n: v.length, pendiente: t.pendiente, sen, r2: t.r2, r2Umbral, cambioTotal, patron: claro ? (sen > 0 ? 'sube' : 'baja') : 'sin-patron' };
}

export interface EvolucionAnual {
    anios: AnioTemporada[];
    media: TendenciaAnual;
    pico: TendenciaAnual;
}

const aEvolucion = (anios: AnioTemporada[]): EvolucionAnual => {
    const usados = anios.filter((a) => a.completo);
    return {
        anios,
        media: patronAnual(usados.map((a) => ({ x: a.anio, y: a.media }))),
        pico: patronAnual(usados.map((a) => ({ x: a.anio, y: a.pico }))),
    };
};

/** Media y pico de temporada por año del módulo, hasta `anioHasta` (inclusive). */
export function evolucionInteranual(v2: FilaNdviV2[], modulo: number, anioHasta: number): EvolucionAnual {
    const anios = aniosDisponibles(v2, modulo).filter((a) => a <= anioHasta).map((anio): AnioTemporada => {
        const r = resumenAnio(v2, modulo, anio);
        return { anio, media: r.media, pico: r.pico, mesesConDato: r.mesesConDato, completo: r.mesesConDato >= MIN_MESES_ANIO_COMPLETO, pocoConfiable: r.pocoConfiables.length > 0 };
    });
    return aEvolucion(anios);
}

export interface TendenciaModulo {
    id: number | 'srl';
    etiqueta: string;
    color: string;
    anomalia: AnomaliaPeriodo;
    evolucion: EvolucionAnual;
    /** Solo SRL: módulos que entran al promedio ("n de m"). */
    nModulos?: { n: number; total: number };
}

/** Años de la evolución del promedio SRL: promedio (según la base elegida) de los módulos con ese año completo; anota cuántos aportan. */
function evolucionSrl(porModulo: { id: number; evolucion: EvolucionAnual }[], pesos: Map<number, number>, base: BasePromedio): EvolucionAnual {
    const anios = [...new Set(porModulo.flatMap((t) => t.evolucion.anios.map((a) => a.anio)))].sort((a, b) => a - b);
    const prom = (pares: ParPeso[]) => promedioConBase(base, pares);
    return aEvolucion(anios.map((anio): AnioTemporada => {
        const del = porModulo.map((t) => ({ id: t.id, a: t.evolucion.anios.find((x) => x.anio === anio) })).filter((x): x is { id: number; a: AnioTemporada } => !!x.a && x.a.completo);
        const w = (id: number) => pesos.get(id) ?? null;
        return {
            anio, media: prom(del.map((x) => ({ valor: x.a.media, peso: w(x.id) }))), pico: prom(del.map((x) => ({ valor: x.a.pico, peso: w(x.id) }))),
            mesesConDato: del.length ? Math.round(media(del.map((x) => x.a.mesesConDato)) as number) : 0,
            completo: del.length > 0, pocoConfiable: del.some((x) => x.a.pocoConfiable), nModulos: del.length,
        };
    }));
}

/** Promedio SRL de la anomalía: por mes, promedio (según la base elegida) de los módulos con referencia ese mes (con "n de m" en el resultado). */
function anomaliaSrl(porModulo: { id: number; anomalia: AnomaliaPeriodo }[], pesos: Map<number, number>, base: BasePromedio): AnomaliaPeriodo {
    const meses = porModulo[0]?.anomalia.meses.map((m) => m.mes) ?? [];
    const items: MesAnomalia[] = meses.map((mes, i) => {
        const del = porModulo.map((t) => ({ id: t.id, m: t.anomalia.meses[i] })).filter((x) => x.m && x.m.abs != null);
        if (!del.length) return { mes, valor: null, ref: null, nRef: 0, abs: null, z: null, confiable: true, fueraTemporada: false };
        const prom = (sel: (m: MesAnomalia) => number | null) => promedioConBase(base, del.map((x) => ({ valor: sel(x.m), peso: pesos.get(x.id) ?? null })));
        return {
            mes, valor: prom((m) => m.valor), ref: prom((m) => m.ref), nRef: Math.min(...del.map((x) => x.m.nRef)),
            abs: prom((m) => m.abs), z: media(del.map((x) => x.m.z)), confiable: del.every((x) => x.m.confiable), fueraTemporada: false,
        };
    });
    return resumirAnomalia(items);
}

/** Años de la referencia y pesos de superficie con los que se calculan "lo habitual" y los promedios SRL del informe. */
function contextoReferencia(filas: FilaAnalisis[], cfg: ConfigInformeNdvi) {
    const aniosRef = aniosDeReferencia(cfg, aniosDeFilas(filas));
    const v2 = aFilasV2(filas).filter((f) => aniosRef.includes(Number(f.mes.slice(0, 4))));
    return { aniosRef, v2, pesos: pesosSuperficie(filas) };
}

/** Tendencia por módulo del periodo + el promedio SRL (con la base elegida). El año de referencia es el del último mes del periodo. */
export function tendenciasDelPeriodo(filas: FilaAnalisis[], cfg: ConfigInformeNdvi, meses: string[]): TendenciaModulo[] {
    const { v2, pesos } = contextoReferencia(filas, cfg);
    const ultimo = meses[meses.length - 1];
    const anioRef = ultimo ? Number(ultimo.slice(0, 4)) : NaN;
    const ids = MODULOS_SRL_IDS.filter((m) => cfg.modulos.includes(m));
    const porModulo = ids.map((m): TendenciaModulo => ({
        id: m, etiqueta: `Módulo ${m}`, color: COLOR_MODULO_SRL[m] ?? '#64748b',
        anomalia: anomaliaDelPeriodo(v2, m, meses),
        evolucion: Number.isFinite(anioRef) ? evolucionInteranual(v2, m, anioRef) : aEvolucion([]),
    }));
    if (ids.length < 2) return porModulo;
    const srlAnom = anomaliaSrl(porModulo.map((t) => ({ id: t.id as number, anomalia: t.anomalia })), pesos, cfg.basePromedio);
    return [...porModulo, {
        id: 'srl', etiqueta: 'Promedio SRL', color: '#1f2328', anomalia: srlAnom,
        evolucion: evolucionSrl(porModulo.map((t) => ({ id: t.id as number, evolucion: t.evolucion })), pesos, cfg.basePromedio),
        nModulos: { n: porModulo.filter((t) => t.anomalia.nConRef > 0).length, total: porModulo.length },
    }];
}

// ─────────────────────────── Lectura en palabras (sin causalidad) ───────────────────────────

/** "referencia de 5 años" / "referencia de 4 a 5 años": de cuántos años sale lo habitual (la certeza depende de ello). */
export function textoReferencia(a: Pick<AnomaliaPeriodo, 'minRef' | 'maxRef'>): string {
    if (a.minRef == null || a.maxRef == null) return '';
    return a.minRef === a.maxRef ? `referencia de ${a.minRef} años` : `referencia de ${a.minRef} a ${a.maxRef} años`;
}

/** Frase de la anomalía del periodo para directivos. Describe, no explica; dice con cuántos años se compara. */
export function fraseAnomalia(a: AnomaliaPeriodo, sujeto: string): string {
    if (a.mediaAbs == null || a.mediaValor == null || a.mediaRef == null) {
        return `${sujeto}: sin referencia suficiente para saber si el periodo fue mayor o menor que lo habitual (se necesitan al menos ${MIN_ANIOS_REFERENCIA} otros años con dato en los mismos meses).`;
    }
    const dif = `${a.mediaValor.toFixed(2)} contra ${a.mediaRef.toFixed(2)} habitual, diferencia ${signo(a.mediaAbs, 3)}`;
    const meses = `${a.mesesArriba} meses por encima, ${a.mesesAbajo} por debajo y ${a.mesesSimilar} en línea de ${a.nConRef}`;
    const ref = textoReferencia(a);
    const lejos = a.fueraDeLoHabitual ? `, a ${Z_INUSUAL} o más desviaciones de lo que varían los otros años entre sí (lectura descriptiva${ref ? `, ${ref}` : ''})` : '';
    const cuerpo = a.direccion === 'similar'
        ? `${sujeto}: el periodo estuvo en línea con lo habitual de otros años (${dif}; ${meses}; ${ref || 'sin años de referencia'}).`
        : `${sujeto}: el periodo estuvo ${a.direccion === 'arriba' ? 'por encima' : 'por debajo'} de lo habitual de otros años (${dif}; ${meses}${a.fueraDeLoHabitual ? '' : `; ${ref}`})${lejos}.`;
    return a.bajaConfianza ? `${cuerpo} Baja confianza: ${a.motivos.join(' ')}` : cuerpo;
}

/** Frase de la evolución año a año. */
export function fraseEvolucion(e: EvolucionAnual, sujeto: string): string {
    const m = e.media;
    if (m.patron === 'insuficiente') return `${sujeto}: insuficiente (${m.n} ${m.n === 1 ? 'año completo' : 'años completos'}; se necesitan al menos ${MIN_ANIOS_TENDENCIA}) para describir la evolución año a año.`;
    const cambio = `${signo(m.sen as number, 3)} de NDVI medio por año según Theil–Sen, ${signo(m.cambioTotal as number, 2)} de punta a punta en ${m.n} años, R² ${(m.r2 as number).toFixed(2)} contra un mínimo de ${(m.r2Umbral as number).toFixed(2)}`;
    if (m.patron === 'sin-patron') return `${sujeto}: sin patrón claro año a año; la variación observada no alcanza el criterio mínimo para declarar que sube o baja de forma sostenida (${cambio}).`;
    return `${sujeto}: la media de la temporada ${m.patron === 'sube' ? 'ha ido subiendo' : 'ha ido bajando'} año tras año (${cambio}). Es una descripción de ${m.n} años, no una causa.`;
}

// ─────────────────────────── Contraste: periodo contra el mismo periodo de otro año ───────────────────────────

/** Diferencia contra lo habitual de un lado de la comparación (lo mínimo que se imprime). */
export interface VsHabitual { abs: number | null; direccion: DireccionAnomalia; nRef: number | null }
const vsHabitualDe = (a: AnomaliaPeriodo): VsHabitual => ({ abs: a.mediaAbs, direccion: a.direccion, nRef: a.maxRef });

export interface FilaComparacion {
    numero: number; nombre: string; a: number | null; b: number | null; delta: number | null; pct: number | null; nA: number; nB: number;
    /** Cada lado contra lo habitual de su mismo mes en los demás años (todo comparativo se lee también contra lo habitual). */
    habA: VsHabitual; habB: VsHabitual;
}

export interface ComparacionPeriodos {
    kind: 'periodos';
    etiquetaA: string;
    etiquetaB: string;
    anioA: number;
    anioB: number;
    mesesA: string[];
    mesesB: string[];
    filas: FilaComparacion[];
    promA: number | null;
    promB: number | null;
    /** B − A. */
    delta: number | null;
    pct: number | null;
    /** Promedio SRL de cada lado contra lo habitual. */
    habA: number | null;
    habB: number | null;
    /** Módulo con mayor diferencia B − A POSITIVA (null si ninguno subió más de UMBRAL_SIN_CAMBIO). */
    mayorAumento: FilaComparacion | null;
    /** Módulo con mayor diferencia B − A NEGATIVA (null si ninguno bajó más de UMBRAL_SIN_CAMBIO). */
    mayorDescenso: FilaComparacion | null;
    /** Módulos que entran al promedio de cada lado. */
    nModulosA: number;
    nModulosB: number;
    base: BasePromedio;
    avisos: string[];
}

const etq = (r: RangoMes) => (r.desde === r.hasta ? mesLegible(r.desde) : `${mesLegible(r.desde)} a ${mesLegible(r.hasta)}`);
const pct = (a: number | null, d: number | null) => (a == null || d == null || a === 0 ? null : (d / Math.abs(a)) * 100);

/** Periodo B (el del informe) contra el mismo periodo A de otro año, con la base de promedio elegida. A y B comparten calendario: la diferencia no es estacional. */
export function compararPeriodos(filas: FilaAnalisis[], cfg: ConfigInformeNdvi, a: RangoMes, b: RangoMes): ComparacionPeriodos {
    const { v2, pesos } = contextoReferencia(filas, cfg);
    const ids = MODULOS_SRL_IDS.filter((m) => cfg.modulos.includes(m));
    const mesesDe = (r: RangoMes) => Array.from(new Set(filas.filter((f) => enRango(f.mes, r)).map((f) => mesDe(f.mes)))).sort();
    const mesesA = mesesDe(a), mesesB = mesesDe(b);
    const lado = (m: number, r: RangoMes) => {
        const f = filas.filter((x) => x.numero_modulo === m && enRango(x.mes, r));
        const delModulo = [...new Set(f.map((x) => mesDe(x.mes)))].sort();
        return { v: media(f.map((x) => x.ndvi_medio)), n: f.length, nombre: f[0]?.nombre_modulo ?? `Módulo ${m}`, hab: vsHabitualDe(anomaliaDelPeriodo(v2, m, delModulo)) };
    };
    const filasCmp: FilaComparacion[] = ids.map((m) => {
        const A = lado(m, a), B = lado(m, b);
        const delta = A.v != null && B.v != null ? B.v - A.v : null;
        return { numero: m, nombre: A.nombre !== `Módulo ${m}` ? A.nombre : B.nombre, a: A.v, b: B.v, delta, pct: pct(A.v, delta), nA: A.n, nB: B.n, habA: A.hab, habB: B.hab };
    });
    const prom = (sel: (f: FilaComparacion) => number | null): number | null => promedioConBase(cfg.basePromedio, filasCmp.map((f) => ({ valor: sel(f), peso: pesos.get(f.numero) ?? null })));
    const promA = prom((f) => f.a), promB = prom((f) => f.b);
    const delta = promA != null && promB != null ? promB - promA : null;
    const conDelta = filasCmp.filter((f) => f.delta != null).sort((x, y) => (y.delta as number) - (x.delta as number));
    const nA = filasCmp.filter((f) => f.a != null).length, nB = filasCmp.filter((f) => f.b != null).length;
    const avisos: string[] = [];
    if (mesesA.length && mesesB.length && mesesA.length !== mesesB.length) avisos.push(`A tiene ${mesesA.length} meses con dato y B ${mesesB.length}: promedian cantidades distintas de meses.`);
    if (nA !== nB && nA > 0 && nB > 0) avisos.push(`El promedio de A incluye ${nA} módulos y el de B ${nB}: no es la misma composición.`);
    const subio = conDelta[0], bajo = conDelta[conDelta.length - 1];
    return {
        kind: 'periodos', etiquetaA: etq(a), etiquetaB: etq(b), anioA: Number(a.hasta.slice(0, 4)), anioB: Number(b.hasta.slice(0, 4)), mesesA, mesesB, filas: filasCmp,
        promA, promB, delta, pct: pct(promA, delta),
        habA: prom((f) => f.habA.abs), habB: prom((f) => f.habB.abs),
        mayorAumento: subio && (subio.delta as number) >= UMBRAL_SIN_CAMBIO ? subio : null,
        mayorDescenso: bajo && (bajo.delta as number) <= -UMBRAL_SIN_CAMBIO ? bajo : null,
        nModulosA: nA, nModulosB: nB, base: cfg.basePromedio, avisos,
    };
}

// ─────────────────────────── Módulo contra módulo ───────────────────────────

export interface IndicadorPar { clave: 'ndvi' | 'ihr'; etiqueta: string; a: number | null; b: number | null; max: number; decimales: number }

export interface ComparacionModulos {
    kind: 'modulos';
    A: { numero: number; nombre: string; color: string };
    B: { numero: number; nombre: string; color: string };
    meses: string[];
    serieA: (number | null)[];
    serieB: (number | null)[];
    /**
     * Solo NDVI e IHR: el Kc y el ICV son transformaciones lineales del NDVI (dicen lo mismo con otra escala), así que
     * mostrarlos como indicadores independientes inflaría la comparación. El IHR sí aporta algo distinto (dispersión).
     */
    indicadores: IndicadorPar[];
    /** B − A del NDVI medio del periodo. */
    delta: number | null;
    /** Meses (con dato en ambos) en que A supera a B. */
    mesesAMayor: number;
    mesesComunes: number;
    /** Cada módulo contra lo habitual de sus mismos meses. */
    habA: VsHabitual;
    habB: VsHabitual;
}

export function compararModulos(filas: FilaAnalisis[], cfg: ConfigInformeNdvi, meses: string[]): ComparacionModulos | null {
    if (!cfg.compModulos) return null;
    const { moduloA, moduloB } = cfg.compModulos;
    const { v2 } = contextoReferencia(filas, cfg);
    const sel = (m: number) => filas.filter((f) => f.numero_modulo === m && meses.includes(mesDe(f.mes)));
    const fA = sel(moduloA), fB = sel(moduloB);
    const serie = (f: FilaAnalisis[]) => meses.map((mes) => f.find((x) => mesDe(x.mes) === mes)?.ndvi_medio ?? null);
    const entrada = (f: FilaAnalisis) => ({ numeroModulo: f.numero_modulo, nombreModulo: f.nombre_modulo, ndviMedio: f.ndvi_medio, ndviDesv: f.ndvi_desv, fraccionCoberturaActiva: f.fraccion_cobertura_activa, superficieHa: f.superficie_ha, volumenAcumuladoHm3: null });
    const par = (clave: IndicadorPar['clave'], etiqueta: string, max: number, decimales: number, fn: (f: FilaAnalisis) => number | null): IndicadorPar =>
        ({ clave, etiqueta, a: media(fA.map(fn)), b: media(fB.map(fn)), max, decimales });
    const sA = serie(fA), sB = serie(fB);
    const comunes = meses.map((_, i) => (sA[i] != null && sB[i] != null ? i : -1)).filter((i) => i >= 0);
    const nombre = (m: number, f: FilaAnalisis[]) => f[0]?.nombre_modulo ?? `Módulo ${m}`;
    const nA = media(fA.map((f) => f.ndvi_medio)), nB = media(fB.map((f) => f.ndvi_medio));
    return {
        kind: 'modulos',
        A: { numero: moduloA, nombre: nombre(moduloA, fA), color: COLOR_MODULO_SRL[moduloA] ?? '#64748b' },
        B: { numero: moduloB, nombre: nombre(moduloB, fB), color: COLOR_MODULO_SRL[moduloB] ?? '#64748b' },
        meses, serieA: sA, serieB: sB,
        indicadores: [
            par('ndvi', 'NDVI', 0.8, 2, (f) => f.ndvi_medio),
            par('ihr', 'IHR (0–100)', 100, 0, (f) => calcIHR(entrada(f)).valor),
        ],
        delta: nA != null && nB != null ? nB - nA : null,
        mesesAMayor: comunes.filter((i) => (sA[i] as number) > (sB[i] as number)).length,
        mesesComunes: comunes.length,
        habA: vsHabitualDe(anomaliaDelPeriodo(v2, moduloA, meses)), habB: vsHabitualDe(anomaliaDelPeriodo(v2, moduloB, meses)),
    };
}

// ─────────────────────────── Módulo contra el promedio de los demás ───────────────────────────

export interface ComparacionVsSrl {
    kind: 'vsSRL';
    modulo: { numero: number; nombre: string; color: string };
    meses: string[];
    serie: (number | null)[];
    /** Promedio de los OTROS módulos SRL por mes con la base elegida (el módulo no entra en su propia referencia). */
    srl: (number | null)[];
    /** Cuántos de los otros módulos tienen dato cada mes (la composición del promedio cambia mes a mes). */
    nOtros: number[];
    totalOtros: number;
    diferencia: (number | null)[];
    difMedia: number | null;
    mesesPorEncima: number;
    mesesComunes: number;
    /** Hay meses cuyo promedio se calculó con menos módulos que el total. */
    composicionVariable: boolean;
    base: BasePromedio;
    /** El módulo contra lo habitual de sus mismos meses. */
    hab: VsHabitual;
}

export function compararVsSrl(filas: FilaAnalisis[], cfg: ConfigInformeNdvi, meses: string[]): ComparacionVsSrl | null {
    if (!cfg.compModulos) return null;
    const m = cfg.compModulos.moduloA;
    const { v2, pesos } = contextoReferencia(filas, cfg);
    const idx = new Map<string, number>();
    for (const f of filas) idx.set(`${f.numero_modulo}|${mesDe(f.mes)}`, f.ndvi_medio);
    const otros = MODULOS_SRL_IDS.filter((id) => id !== m);
    const serie = meses.map((mes) => idx.get(`${m}|${mes}`) ?? null);
    const valoresOtros = meses.map((mes) => otros.map((id) => idx.get(`${id}|${mes}`) ?? null));
    const srl = valoresOtros.map((v) => promedioConBase(cfg.basePromedio, v.map((valor, k) => ({ valor, peso: pesos.get(otros[k]) ?? null }))));
    const nOtros = valoresOtros.map((v) => v.filter((x) => x != null).length);
    const dif = meses.map((_, i) => (serie[i] != null && srl[i] != null ? (serie[i] as number) - (srl[i] as number) : null));
    const conDif = dif.filter((d): d is number => d != null);
    const nombre = filas.find((f) => f.numero_modulo === m)?.nombre_modulo ?? `Módulo ${m}`;
    return {
        kind: 'vsSRL', modulo: { numero: m, nombre, color: COLOR_MODULO_SRL[m] ?? '#64748b' },
        meses, serie, srl, nOtros, totalOtros: otros.length, diferencia: dif, difMedia: media(dif),
        mesesPorEncima: conDif.filter((d) => d >= UMBRAL_SIN_CAMBIO).length, mesesComunes: conDif.length,
        composicionVariable: nOtros.some((n, i) => srl[i] != null && n < otros.length),
        base: cfg.basePromedio, hab: vsHabitualDe(anomaliaDelPeriodo(v2, m, meses)),
    };
}

// ─────────────────────────── Orquestación ───────────────────────────

/** Todo el análisis del documento: tendencia (siempre), contraste contra otro año y comparación entre módulos (si se pidieron). */
export interface AnalisisIntegrado {
    tendencias: TendenciaModulo[];
    meses: string[];
    anioRef: number | null;
    /** Años de la referencia de "lo habitual" (la lista única del informe). */
    aniosReferencia: number[];
    contraste: ComparacionPeriodos | null;
    compModulos: ComparacionModulos | ComparacionVsSrl | null;
}

export function construirAnalisis(filas: FilaAnalisis[], cfg: ConfigInformeNdvi, meses: string[]): AnalisisIntegrado {
    const ultimo = meses[meses.length - 1];
    const k = resolverContraste(cfg, filas);
    const comp = cfg.compModulos ? (cfg.compModulos.tipo === 'modulos' ? compararModulos(filas, cfg, meses) : compararVsSrl(filas, cfg, meses)) : null;
    return {
        tendencias: tendenciasDelPeriodo(filas, cfg, meses), meses, anioRef: ultimo ? Number(ultimo.slice(0, 4)) : null,
        aniosReferencia: contextoReferencia(filas, cfg).aniosRef,
        contraste: k ? compararPeriodos(filas, cfg, k.a, k.b) : null,
        compModulos: comp,
    };
}
