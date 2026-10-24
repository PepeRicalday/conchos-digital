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
import { mismoCalendario, type ConfigInformeNdvi, type RangoMes } from './informeNdviConfig';

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
const signo = (v: number, d: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;

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
    /** Años de referencia del mes con menos años. */
    minRef: number | null;
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
        minRef, bajaConfianza: motivos.length > 0 || !conRef.length, motivos,
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

/** Años de la evolución del promedio SRL: media de los módulos con ese año completo (anota cuántos aportan). */
function evolucionSrl(porModulo: EvolucionAnual[]): EvolucionAnual {
    const anios = [...new Set(porModulo.flatMap((e) => e.anios.map((a) => a.anio)))].sort((a, b) => a - b);
    return aEvolucion(anios.map((anio): AnioTemporada => {
        const del = porModulo.map((e) => e.anios.find((a) => a.anio === anio)).filter((a): a is AnioTemporada => !!a && a.completo);
        return {
            anio, media: media(del.map((a) => a.media)), pico: media(del.map((a) => a.pico)),
            mesesConDato: del.length ? Math.round(media(del.map((a) => a.mesesConDato)) as number) : 0,
            completo: del.length > 0, pocoConfiable: del.some((a) => a.pocoConfiable), nModulos: del.length,
        };
    }));
}

/** Promedio SRL de la anomalía: por mes, media de los módulos con referencia ese mes (con "n de m" en el resultado). */
function anomaliaSrl(porModulo: AnomaliaPeriodo[]): AnomaliaPeriodo {
    const meses = porModulo[0]?.meses.map((m) => m.mes) ?? [];
    const items: MesAnomalia[] = meses.map((mes, i) => {
        const del = porModulo.map((a) => a.meses[i]).filter((m) => m && m.abs != null);
        if (!del.length) return { mes, valor: null, ref: null, nRef: 0, abs: null, z: null, confiable: true, fueraTemporada: false };
        return {
            mes, valor: media(del.map((m) => m.valor)), ref: media(del.map((m) => m.ref)), nRef: Math.min(...del.map((m) => m.nRef)),
            abs: media(del.map((m) => m.abs)), z: media(del.map((m) => m.z)), confiable: del.every((m) => m.confiable), fueraTemporada: false,
        };
    });
    return resumirAnomalia(items);
}

/** Tendencia por módulo del periodo + el promedio SRL. El año de referencia es el del último mes del periodo. */
export function tendenciasDelPeriodo(filas: FilaAnalisis[], cfg: ConfigInformeNdvi, meses: string[]): TendenciaModulo[] {
    const v2 = aFilasV2(filas);
    const ultimo = meses[meses.length - 1];
    const anioRef = ultimo ? Number(ultimo.slice(0, 4)) : NaN;
    const ids = MODULOS_SRL_IDS.filter((m) => cfg.modulos.includes(m));
    const porModulo = ids.map((m): TendenciaModulo => ({
        id: m, etiqueta: `Módulo ${m}`, color: COLOR_MODULO_SRL[m] ?? '#64748b',
        anomalia: anomaliaDelPeriodo(v2, m, meses),
        evolucion: Number.isFinite(anioRef) ? evolucionInteranual(v2, m, anioRef) : aEvolucion([]),
    }));
    if (ids.length < 2) return porModulo;
    const srlAnom = anomaliaSrl(porModulo.map((t) => t.anomalia));
    return [...porModulo, {
        id: 'srl', etiqueta: 'Promedio SRL', color: '#1f2328', anomalia: srlAnom, evolucion: evolucionSrl(porModulo.map((t) => t.evolucion)),
        nModulos: { n: porModulo.filter((t) => t.anomalia.nConRef > 0).length, total: porModulo.length },
    }];
}

// ─────────────────────────── Lectura en palabras (sin causalidad) ───────────────────────────

/** Frase de la anomalía del periodo para directivos. Describe, no explica. */
export function fraseAnomalia(a: AnomaliaPeriodo, sujeto: string): string {
    if (a.mediaAbs == null || a.mediaValor == null || a.mediaRef == null) {
        return `${sujeto}: sin referencia suficiente para saber si el periodo fue mejor o peor que lo habitual (se necesitan al menos ${MIN_ANIOS_REFERENCIA} otros años con dato en los mismos meses).`;
    }
    const dif = `${a.mediaValor.toFixed(2)} contra ${a.mediaRef.toFixed(2)} habitual, diferencia ${signo(a.mediaAbs, 3)}`;
    const meses = `${a.mesesArriba} meses por encima, ${a.mesesAbajo} por debajo y ${a.mesesSimilar} en línea de ${a.nConRef}`;
    const cuerpo = a.direccion === 'similar'
        ? `${sujeto}: el periodo estuvo en línea con lo habitual de otros años (${dif}; ${meses}).`
        : `${sujeto}: el periodo estuvo ${a.direccion === 'arriba' ? 'por encima' : 'por debajo'} de lo habitual de otros años (${dif}; ${meses})${a.fueraDeLoHabitual ? ', más lejos de lo normal que la variación típica entre años' : ''}.`;
    return a.bajaConfianza ? `${cuerpo} Baja confianza: ${a.motivos.join(' ')}` : cuerpo;
}

/** Frase de la evolución año a año. */
export function fraseEvolucion(e: EvolucionAnual, sujeto: string): string {
    const m = e.media;
    if (m.patron === 'insuficiente') return `${sujeto}: insuficiente (${m.n} ${m.n === 1 ? 'año completo' : 'años completos'}; se necesitan al menos 3) para describir la evolución año a año.`;
    const cambio = `${signo(m.sen as number, 3)} de NDVI medio por año según Theil–Sen, ${signo(m.cambioTotal as number, 2)} de punta a punta en ${m.n} años, R² ${(m.r2 as number).toFixed(2)} contra un mínimo de ${(m.r2Umbral as number).toFixed(2)}`;
    if (m.patron === 'sin-patron') return `${sujeto}: sin patrón claro año a año; la variación observada no alcanza el criterio mínimo para declarar que sube o baja de forma sostenida (${cambio}).`;
    return `${sujeto}: la media de la temporada ${m.patron === 'sube' ? 'ha ido subiendo' : 'ha ido bajando'} año tras año (${cambio}). Es una descripción de ${m.n} años, no una causa.`;
}

// ─────────────────────────── Comparación por periodos ───────────────────────────

export interface FilaComparacion { numero: number; nombre: string; a: number | null; b: number | null; delta: number | null; pct: number | null; nA: number; nB: number }

export interface ComparacionPeriodos {
    kind: 'periodos' | 'mesVsMes';
    etiquetaA: string;
    etiquetaB: string;
    mesesA: string[];
    mesesB: string[];
    filas: FilaComparacion[];
    promA: number | null;
    promB: number | null;
    /** B − A. */
    delta: number | null;
    pct: number | null;
    /** Módulo con mayor diferencia B − A POSITIVA (null si ninguno subió más de UMBRAL_SIN_CAMBIO). */
    mayorAumento: FilaComparacion | null;
    /** Módulo con mayor diferencia B − A NEGATIVA (null si ninguno bajó más de UMBRAL_SIN_CAMBIO). */
    mayorDescenso: FilaComparacion | null;
    /** Los rangos A y B comparten meses. */
    traslapados: boolean;
    /** A y B cubren los mismos meses del año (la diferencia no es estacional). */
    mismoCalendario: boolean;
    /** Módulos que entran al promedio de cada lado. */
    nModulosA: number;
    nModulosB: number;
    avisos: string[];
}

const etq = (r: RangoMes) => (r.desde === r.hasta ? mesLegible(r.desde) : `${mesLegible(r.desde)} a ${mesLegible(r.hasta)}`);
const pct = (a: number | null, d: number | null) => (a == null || d == null || a === 0 ? null : (d / Math.abs(a)) * 100);

export function compararPeriodos(filas: FilaAnalisis[], cfg: ConfigInformeNdvi): ComparacionPeriodos {
    const k = cfg.comparacion;
    const ids = MODULOS_SRL_IDS.filter((m) => cfg.modulos.includes(m));
    const mesesDe = (r: RangoMes) => Array.from(new Set(filas.filter((f) => enRango(f.mes, r)).map((f) => mesDe(f.mes)))).sort();
    const lado = (m: number, r: RangoMes) => {
        const f = filas.filter((x) => x.numero_modulo === m && enRango(x.mes, r));
        return { v: media(f.map((x) => x.ndvi_medio)), n: f.length, nombre: f[0]?.nombre_modulo ?? `Módulo ${m}`, sup: f[0]?.superficie_ha ?? null };
    };
    const filasCmp: FilaComparacion[] = ids.map((m) => {
        const A = lado(m, k.a), B = lado(m, k.b);
        const delta = A.v != null && B.v != null ? B.v - A.v : null;
        return { numero: m, nombre: A.nombre !== `Módulo ${m}` ? A.nombre : B.nombre, a: A.v, b: B.v, delta, pct: pct(A.v, delta), nA: A.n, nB: B.n };
    });
    const pesos = new Map(ids.map((m) => [m, lado(m, k.b).sup ?? lado(m, k.a).sup]));
    const prom = (sel: (f: FilaComparacion) => number | null): number | null => {
        if (cfg.basePromedio === 'ponderado') {
            let num = 0, den = 0;
            for (const f of filasCmp) { const v = sel(f), w = pesos.get(f.numero); if (v != null && w != null && w > 0) { num += v * w; den += w; } }
            return den > 0 ? num / den : null;
        }
        return media(filasCmp.map(sel));
    };
    const promA = prom((f) => f.a), promB = prom((f) => f.b);
    const delta = promA != null && promB != null ? promB - promA : null;
    const conDelta = filasCmp.filter((f) => f.delta != null).sort((x, y) => (y.delta as number) - (x.delta as number));
    const mesesA = mesesDe(k.a), mesesB = mesesDe(k.b);
    const traslapados = mesesA.some((m) => mesesB.includes(m));
    const calOk = mismoCalendario(k.a, k.b);
    const nA = filasCmp.filter((f) => f.a != null).length, nB = filasCmp.filter((f) => f.b != null).length;
    const avisos: string[] = [];
    if (traslapados) avisos.push('Los periodos A y B comparten meses; la diferencia subestima el cambio.');
    if (!calOk) avisos.push('A y B cubren meses del año distintos: parte de la diferencia es estacional (el NDVI sube de marzo a julio sin que cambie nada). Para aislar el cambio entre años compara el mismo periodo de otro año.');
    if (mesesA.length && mesesB.length && mesesA.length !== mesesB.length) avisos.push(`A tiene ${mesesA.length} meses con dato y B ${mesesB.length}: promedian cantidades distintas de meses.`);
    if (nA !== nB && nA > 0 && nB > 0) avisos.push(`El promedio de A incluye ${nA} módulos y el de B ${nB}: no es la misma composición.`);
    const subio = conDelta[0], bajo = conDelta[conDelta.length - 1];
    return {
        kind: k.tipo === 'mesVsMes' ? 'mesVsMes' : 'periodos',
        etiquetaA: etq(k.a), etiquetaB: etq(k.b), mesesA, mesesB, filas: filasCmp, promA, promB, delta, pct: pct(promA, delta),
        mayorAumento: subio && (subio.delta as number) >= UMBRAL_SIN_CAMBIO ? subio : null,
        mayorDescenso: bajo && (bajo.delta as number) <= -UMBRAL_SIN_CAMBIO ? bajo : null,
        traslapados, mismoCalendario: calOk, nModulosA: nA, nModulosB: nB, avisos,
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
}

export function compararModulos(filas: FilaAnalisis[], cfg: ConfigInformeNdvi, meses: string[]): ComparacionModulos {
    const { moduloA, moduloB } = cfg.comparacion;
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
    };
}

// ─────────────────────────── Módulo contra el promedio de los demás ───────────────────────────

export interface ComparacionVsSrl {
    kind: 'vsSRL';
    modulo: { numero: number; nombre: string; color: string };
    meses: string[];
    serie: (number | null)[];
    /** Promedio simple de los OTROS módulos SRL por mes (el módulo no entra en su propia referencia). */
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
}

export function compararVsSrl(filas: FilaAnalisis[], cfg: ConfigInformeNdvi, meses: string[]): ComparacionVsSrl {
    const m = cfg.comparacion.moduloA;
    const idx = new Map<string, number>();
    for (const f of filas) idx.set(`${f.numero_modulo}|${mesDe(f.mes)}`, f.ndvi_medio);
    const otros = MODULOS_SRL_IDS.filter((id) => id !== m);
    const serie = meses.map((mes) => idx.get(`${m}|${mes}`) ?? null);
    const valoresOtros = meses.map((mes) => otros.map((id) => idx.get(`${id}|${mes}`) ?? null));
    const srl = valoresOtros.map((v) => media(v));
    const nOtros = valoresOtros.map((v) => v.filter((x) => x != null).length);
    const dif = meses.map((_, i) => (serie[i] != null && srl[i] != null ? (serie[i] as number) - (srl[i] as number) : null));
    const conDif = dif.filter((d): d is number => d != null);
    const nombre = filas.find((f) => f.numero_modulo === m)?.nombre_modulo ?? `Módulo ${m}`;
    return {
        kind: 'vsSRL', modulo: { numero: m, nombre, color: COLOR_MODULO_SRL[m] ?? '#64748b' },
        meses, serie, srl, nOtros, totalOtros: otros.length, diferencia: dif, difMedia: media(dif),
        mesesPorEncima: conDif.filter((d) => d >= UMBRAL_SIN_CAMBIO).length, mesesComunes: conDif.length,
        composicionVariable: nOtros.some((n, i) => srl[i] != null && n < otros.length),
    };
}

// ─────────────────────────── Orquestación ───────────────────────────

export type ResultadoAnalisis =
    | { modo: 'tendencia'; tendencias: TendenciaModulo[]; meses: string[]; anioRef: number | null }
    | { modo: 'comparativo'; comparacion: ComparacionPeriodos | ComparacionModulos | ComparacionVsSrl; meses: string[] };

export function construirAnalisis(filas: FilaAnalisis[], cfg: ConfigInformeNdvi, meses: string[]): ResultadoAnalisis | null {
    if (cfg.modo === 'tendencia') {
        const ultimo = meses[meses.length - 1];
        return { modo: 'tendencia', tendencias: tendenciasDelPeriodo(filas, cfg, meses), meses, anioRef: ultimo ? Number(ultimo.slice(0, 4)) : null };
    }
    if (cfg.modo !== 'comparativo') return null;
    const t = cfg.comparacion.tipo;
    if (t === 'modulos') return { modo: 'comparativo', comparacion: compararModulos(filas, cfg, meses), meses };
    if (t === 'vsSRL') return { modo: 'comparativo', comparacion: compararVsSrl(filas, cfg, meses), meses };
    return { modo: 'comparativo', comparacion: compararPeriodos(filas, cfg), meses };
}
