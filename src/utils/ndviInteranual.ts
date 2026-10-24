/**
 * ndviInteranual — comparación de NDVI mensual entre años (serie homogénea v2: SCL + mediana)
 * y cruce con superficie/volumen anual por módulo (ACUM_INF).
 *
 * Regla "S/D nunca cero": un mes sin píxeles válidos llega con ndvi_mediana = null y se queda en null;
 * un año sin informe de superficie/volumen devuelve null, no 0.
 */
import { anomaliaVsPromedio, percentil, resumenSerie, tendenciaLineal, type Anomalia, type Tendencia } from './estadisticaHistorica';

export interface FilaNdviV2 {
    numero_modulo: number;
    mes: string; // 'YYYY-MM'
    ndvi_mediana: number | null;
    ndvi_p10: number | null;
    ndvi_p90: number | null;
    fraccion_cobertura_activa: number | null;
    n_escenas: number | null;
    pct_pixeles_validos: number | null;
    superficie_ha: number | null;
}

export interface FilaSupVol {
    anio: number;
    numero_modulo: number;
    cultivo: string;
    superficie_ha: number | null;
    volumen_miles_m3: number | null;
    atipico: boolean;
}

/** Temporada comparada: marzo a septiembre (mismo corte que el informe ACUM_INF). */
export const MESES_TEMPORADA = ['03', '04', '05', '06', '07', '08', '09'] as const;
export const ETIQUETA_MES: Record<string, string> = {
    '03': 'Mar', '04': 'Abr', '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Ago', '09': 'Sep',
};

/** Mes con pocas observaciones: se dibuja pero se advierte (no se descarta). */
export const MIN_ESCENAS_CONFIABLE = 2;
export const MIN_PCT_VALIDOS_CONFIABLE = 0.5;

export function esMesConfiable(f: Pick<FilaNdviV2, 'n_escenas' | 'pct_pixeles_validos'> | undefined): boolean {
    if (!f) return false;
    if (f.n_escenas != null && f.n_escenas < MIN_ESCENAS_CONFIABLE) return false;
    if (f.pct_pixeles_validos != null && f.pct_pixeles_validos < MIN_PCT_VALIDOS_CONFIABLE) return false;
    return true;
}

export const anioDeMes = (mes: string): number => Number(mes.slice(0, 4));

/** Años con al menos una fila de temporada para el módulo. */
export function aniosDisponibles(filas: FilaNdviV2[], modulo: number): number[] {
    const s = new Set<number>();
    for (const f of filas) {
        if (f.numero_modulo === modulo && (MESES_TEMPORADA as readonly string[]).includes(f.mes.slice(5))) s.add(anioDeMes(f.mes));
    }
    return [...s].sort((a, b) => a - b);
}

/** NDVI (mediana) por mes de temporada para un año: 7 posiciones, null = sin dato. */
export function serieAnio(filas: FilaNdviV2[], modulo: number, anio: number): (number | null)[] {
    const porMes = new Map(filas.filter(f => f.numero_modulo === modulo).map(f => [f.mes, f]));
    return MESES_TEMPORADA.map(m => porMes.get(`${anio}-${m}`)?.ndvi_mediana ?? null);
}

/** Meses de la temporada cuya fila existe pero es poco confiable (para marcarlos en la gráfica). */
export function mesesPocoConfiables(filas: FilaNdviV2[], modulo: number, anio: number): string[] {
    const porMes = new Map(filas.filter(f => f.numero_modulo === modulo).map(f => [f.mes, f]));
    return MESES_TEMPORADA.filter(m => {
        const f = porMes.get(`${anio}-${m}`);
        return f?.ndvi_mediana != null && !esMesConfiable(f);
    }).map(m => ETIQUETA_MES[m]);
}

export interface ResumenAnio {
    anio: number;
    mesesConDato: number;
    media: number | null;
    pico: number | null;
    mesPico: string | null;
    pocoConfiables: string[];
}

export function resumenAnio(filas: FilaNdviV2[], modulo: number, anio: number): ResumenAnio {
    const serie = serieAnio(filas, modulo, anio);
    const r = resumenSerie(serie);
    let mesPico: string | null = null;
    if (r) mesPico = ETIQUETA_MES[MESES_TEMPORADA[serie.findIndex(v => v === r.max)]] ?? null;
    return {
        anio,
        mesesConDato: r?.n ?? 0,
        media: r?.media ?? null,
        pico: r?.max ?? null,
        mesPico,
        pocoConfiables: mesesPocoConfiables(filas, modulo, anio),
    };
}

export interface ClimatologiaMes { mes: string; media: number | null; p10: number | null; p90: number | null; n: number }

/** Promedio y banda p10–p90 de cada mes entre los años de referencia (excluye `excluirAnio`). */
export function climatologiaMensual(filas: FilaNdviV2[], modulo: number, excluirAnio?: number): ClimatologiaMes[] {
    const anios = aniosDisponibles(filas, modulo).filter(a => a !== excluirAnio);
    return MESES_TEMPORADA.map((m, i) => {
        const vals = anios.map(a => serieAnio(filas, modulo, a)[i]).filter((v): v is number => v != null);
        // Con menos de 3 años no se da banda: p10/p90 de 2 puntos no dicen nada.
        return {
            mes: ETIQUETA_MES[m],
            media: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
            p10: vals.length >= 3 ? percentil(vals, 10) : null,
            p90: vals.length >= 3 ? percentil(vals, 90) : null,
            n: vals.length,
        };
    });
}

/** Temporada con menos meses que esto es "incompleta": su pico/media no son comparables con los de un año entero. */
export const MIN_MESES_ANIO_COMPLETO = 6;

export interface AnomaliaPareada extends Anomalia { meses: string[] }

/**
 * Anomalía para una temporada incompleta (p. ej. a mitad de año): media de los meses con dato del año contra la media
 * de ESOS MISMOS meses en cada otro año (solo los años que tienen todos esos meses). Evita comparar un pico parcial con
 * picos de temporada completa, que daba un "por debajo" falso.
 */
export function anomaliaPareada(filas: FilaNdviV2[], modulo: number, anio: number): AnomaliaPareada | null {
    const foco = serieAnio(filas, modulo, anio);
    const idx = foco.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return null;
    const media = (vals: number[]) => vals.reduce((a, b) => a + b, 0) / vals.length;
    const otros: number[] = [];
    for (const a of aniosDisponibles(filas, modulo).filter((x) => x !== anio)) {
        const s = serieAnio(filas, modulo, a);
        if (idx.every((i) => s[i] != null)) otros.push(media(idx.map((i) => s[i] as number)));
    }
    const an = anomaliaVsPromedio(media(idx.map((i) => foco[i] as number)), otros);
    return an ? { ...an, meses: idx.map((i) => ETIQUETA_MES[MESES_TEMPORADA[i]]) } : null;
}

/**
 * Anomalía de un año contra los demás años del módulo: pico contra picos si la temporada está completa
 * (≥ MIN_MESES_ANIO_COMPLETO meses); si no, media de los mismos meses (anomaliaPareada).
 */
export function anomaliaPico(filas: FilaNdviV2[], modulo: number, anio: number): Anomalia | null {
    const r = resumenAnio(filas, modulo, anio);
    if (r.mesesConDato > 0 && r.mesesConDato < MIN_MESES_ANIO_COMPLETO) return anomaliaPareada(filas, modulo, anio);
    const anios = aniosDisponibles(filas, modulo);
    const otros = anios.filter(a => a !== anio).map(a => resumenAnio(filas, modulo, a).pico);
    return anomaliaVsPromedio(r.pico, otros);
}

/** Tendencia del pico anual a lo largo de los años (descriptiva; exige ≥3 años). */
export function tendenciaPico(filas: FilaNdviV2[], modulo: number): Tendencia | null {
    return tendenciaLineal(aniosDisponibles(filas, modulo).map(a => ({ x: a, y: resumenAnio(filas, modulo, a).pico })));
}

export interface CruceAnio {
    anio: number;
    superficieHa: number | null;
    volumenHm3: number | null;
    /** m³ por hectárea. */
    laminaM3Ha: number | null;
    /** Hectáreas por hm³ (eficiencia hídrica productiva). */
    haPorHm3: number | null;
    picoNdvi: number | null;
    mediaNdvi: number | null;
    atipicos: number;
}

/**
 * Cruza superficie/volumen anual de un módulo con el NDVI de ese año.
 * Un año sin filas de superficie/volumen (p. ej. 2025) queda con null — no con 0.
 * Los renglones atípicos se SUMAN (no se corrigen) y se cuentan para advertirlo.
 */
export function cruceAnual(filasNdvi: FilaNdviV2[], supVol: FilaSupVol[], modulo: number, anio: number): CruceAnio {
    const delAnio = supVol.filter(s => s.numero_modulo === modulo && s.anio === anio);
    const conDato = delAnio.length > 0;
    // Suma solo lo que tiene valor; si TODAS las filas son nulas el resultado es null (S/D), nunca 0.
    const suma = (vals: (number | null)[]): number | null => {
        const v = vals.filter((x): x is number => x != null && Number.isFinite(x));
        return v.length ? v.reduce((a, b) => a + b, 0) : null;
    };
    const sup = conDato ? suma(delAnio.map((s) => s.superficie_ha)) : null;
    const volMiles = conDato ? suma(delAnio.map((s) => s.volumen_miles_m3)) : null;
    const hm3 = volMiles != null ? volMiles / 1000 : null;
    const r = resumenAnio(filasNdvi, modulo, anio);
    return {
        anio,
        superficieHa: sup,
        volumenHm3: hm3,
        laminaM3Ha: sup != null && sup > 0 && volMiles != null ? (volMiles * 1000) / sup : null,
        haPorHm3: sup != null && hm3 != null && hm3 > 0 ? sup / hm3 : null,
        picoNdvi: r.pico,
        mediaNdvi: r.media,
        atipicos: delAnio.filter(s => s.atipico).length,
    };
}

/** Rampa de años (fría/clara → cálida): el año foco usa COLOR_ANIO_FOCO; los previos, tonos de un solo matiz. */
export const COLOR_ANIO_FOCO = '#fbbf24';
export const COLORES_ANIO_PREVIO = ['#4d6f99', '#5f86b5', '#78a0cc', '#98bae0', '#b9d3ef'];

/** Color de un año previo: los más antiguos más apagados, los más cercanos más claros (orden estable por posición). */
export function colorAnioPrevio(indice: number, total: number): string {
    const n = COLORES_ANIO_PREVIO.length;
    if (total <= 1) return COLORES_ANIO_PREVIO[n - 1];
    const k = Math.round((indice / (total - 1)) * (n - 1));
    return COLORES_ANIO_PREVIO[Math.min(n - 1, Math.max(0, k))];
}

const signo = (v: number, d: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;

export interface LecturaAnio {
    /** Frase en lenguaje claro; nunca inventa: sin referencia lo dice. */
    texto: string;
    /** 'arriba' | 'abajo' | 'similar' | null (sin referencia). */
    direccion: 'arriba' | 'abajo' | 'similar' | null;
    anomalia: Anomalia | null;
}

/**
 * Umbral ÚNICO de "sin cambio / en línea" para diferencias de NDVI (año contra año, periodo A contra B, módulo contra
 * promedio). Justificación (serie v2, 2021–2026, 6 módulos): la desviación estándar entre años de la media de temporada
 * va de 0.033 a 0.057 (≈ 0.046) y la de cada mes de 0.046 a 0.063; 0.02 ≈ media desviación entre años: por debajo de
 * eso la diferencia es indistinguible de la variación normal de un año a otro.
 */
export const UMBRAL_SIN_CAMBIO = 0.02;
export const UMBRAL_SIMILAR = UMBRAL_SIN_CAMBIO;

/** "2026 va X por encima/debajo del promedio de los otros años" para un módulo. */
export function lecturaAnio(filas: FilaNdviV2[], modulo: number, anio: number): LecturaAnio {
    const r = resumenAnio(filas, modulo, anio);
    if (r.pico == null) return { texto: `El Módulo ${modulo} no tiene NDVI en ${anio} (S/D).`, direccion: null, anomalia: null };
    const incompleta = r.mesesConDato < MIN_MESES_ANIO_COMPLETO;
    const an = anomaliaPico(filas, modulo, anio);
    if (!an) return { texto: `En ${anio} el pico del Módulo ${modulo} fue ${r.pico.toFixed(3)} (${r.mesPico}); no hay otros años con dato para compararlo.`, direccion: null, anomalia: null };
    const dir = Math.abs(an.abs) < UMBRAL_SIN_CAMBIO ? 'similar' : an.abs > 0 ? 'arriba' : 'abajo';
    const pct = an.pct != null ? ` (${signo(an.pct, 0)} %)` : '';
    // Temporada incompleta: se compara la media de los meses disponibles contra esos mismos meses de otros años.
    const medida = incompleta ? 'promedio de los mismos meses' : 'promedio de pico';
    const cuerpo = dir === 'similar'
        ? `queda en línea con el ${medida} de los otros ${an.n} años (${an.promedio.toFixed(3)}; diferencia ${signo(an.abs, 3)})`
        : `va ${Math.abs(an.abs).toFixed(3)}${pct} ${dir === 'arriba' ? 'por encima' : 'por debajo'} del ${medida} de los otros ${an.n} años (${an.promedio.toFixed(3)})`;
    const cola = incompleta
        ? `; temporada incompleta (${r.mesesConDato} de ${MESES_TEMPORADA.length} meses con dato), el pico parcial fue ${r.pico.toFixed(3)} en ${r.mesPico}.`
        : `; su pico fue ${r.pico.toFixed(3)} en ${r.mesPico}.`;
    return { texto: `En ${anio} el Módulo ${modulo} ${cuerpo}${cola}`, direccion: dir, anomalia: an };
}
