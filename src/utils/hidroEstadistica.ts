/**
 * hidroEstadistica — estadística PURA de las estaciones hidrométricas GOES (sin React ni red).
 * Base común de la pantalla "Estaciones GOES" y del Informe GOES: resumen (media, mín/máx, p10/p90), cobertura de lecturas,
 * variación 24 h / 7 d, pendiente (Theil-Sen) y volumen estimado por integración trapezoidal.
 * Regla de veracidad del proyecto: sin dato = null (S/D), nunca 0; los ceros sospechosos de Babisas (corte de curva de gasto)
 * NO entran a promedios ni al volumen: se cuentan aparte para declararlo.
 */
import { percentil, resumenSerie, theilSen } from './estadisticaHistorica';
import {
    ceroSospechoso, STALE_GOES_MIN, tendencia, VENTANAS,
    type PuntoHidro, type Tendencia, type VentanaHidro,
} from './hidroEstaciones';

/** Un hueco mayor a esto no se integra (la estación no midió: no se inventa caudal). */
export const MAX_HUECO_VOLUMEN_MIN = 45;
/** Cobertura menor a esto = resultado con aviso de confiabilidad. */
export const COBERTURA_MIN_CONFIABLE = 80;

/** El último mensaje llega ~30 min después de la hora y trae lecturas anteriores: la cola reciente no cuenta como "faltante". */
export const LATENCIA_COBERTURA_MIN = 60;
/** Tolerancia para hallar el punto base de la variación 24 h / 7 d (fracción de la antigüedad pedida). */
export const TOLERANCIA_VARIACION = 0.1;

const HORA = 3600000;
const DIA = 24 * HORA;

export interface SeriesEstadistica {
    nivel_m?: PuntoHidro[];
    gasto_m3s?: PuntoHidro[];
    velocidad_ms?: PuntoHidro[];
}

export interface ResumenEstacion {
    n: number;
    media: number;
    mediana: number;
    min: number;
    max: number;
    /** Hora (ms) del mínimo y del máximo. */
    tMin: number;
    tMax: number;
    p10: number | null;
    p90: number | null;
    desv: number;
}

export interface Cobertura {
    esperadas: number;
    recibidas: number;
    pct: number;
    confiable: boolean;
}

export interface Volumen {
    /** Millones de m³ integrados sobre los tramos con lectura continua. */
    mm3: number;
    /** % de la ventana realmente integrado (el resto fueron huecos o exclusiones). */
    pctIntegrado: number;
    /** Gasto medio sobre el tiempo integrado, m³/s. */
    gastoMedio: number | null;
}

export interface Variacion { h24: Tendencia | null; d7: Tendencia | null }

export interface EstadisticaEstacion {
    id: string;
    ventana: VentanaHidro;
    desde: number;
    hasta: number;
    nivel: ResumenEstacion | null;
    gasto: ResumenEstacion | null;
    velocidad: ResumenEstacion | null;
    cobertura: Cobertura | null;
    volumen: Volumen | null;
    /** Lecturas de gasto 0 descartadas por sospechosas (Babisas); no entran a gasto ni volumen. */
    excluidas: number;
    /** Lecturas de gasto recibidas (con las excluidas) y % excluido: si es alto, media/p90/volumen son condicionados. */
    gastoRecibidas: number;
    pctExcluidas: number | null;
    /** false cuando más de la mitad de las lecturas de gasto fueron excluidas: la cifra no representa el periodo. */
    gastoRepresentativo: boolean;
    variacionNivel: Variacion;
    variacionGasto: Variacion;
    /** Cambio del gasto en m³/s por día (Theil-Sen, robusto a huecos y picos); null con pocos datos. */
    pendienteGastoDia: number | null;
}

/** Quita el gasto 0 que la estación reporta con nivel alto (corte de curva). Empareja por hora de lectura (±10 min). */
export function sinCerosSospechosos(
    estacionId: string, gasto: PuntoHidro[], nivel: PuntoHidro[],
): { validos: PuntoHidro[]; excluidas: number; tExcluidos: Set<number> } {
    const nivelPorT = new Map(nivel.map(p => [p.t, p.v]));
    const cerca = (t: number): number | null => {
        for (const d of [0, -300000, 300000, -600000, 600000]) {
            const v = nivelPorT.get(t + d);
            if (v != null) return v;
        }
        return null;
    };
    const validos: PuntoHidro[] = [];
    const tExcluidos = new Set<number>();
    for (const p of gasto) {
        if (p.v === 0 && ceroSospechoso(estacionId, 0, cerca(p.t))) tExcluidos.add(p.t);
        else validos.push(p);
    }
    return { validos, excluidas: tExcluidos.size, tExcluidos };
}

/** Recorta una serie a [desde, hasta]. */
export function enVentana(serie: PuntoHidro[] | undefined, desde: number, hasta: number): PuntoHidro[] {
    return (serie ?? []).filter(p => Number.isFinite(p.t) && Number.isFinite(p.v) && p.t >= desde && p.t <= hasta);
}

export function resumenEstacion(serie: PuntoHidro[]): ResumenEstacion | null {
    const r = resumenSerie(serie.map(p => p.v));
    if (!r) return null;
    let pMin = serie[0];
    let pMax = serie[0];
    for (const p of serie) {
        if (p.v < pMin.v) pMin = p;
        if (p.v > pMax.v) pMax = p;
    }
    return {
        n: r.n, media: r.media, mediana: r.mediana, min: r.min, max: r.max, desv: r.desv,
        tMin: pMin.t, tMax: pMax.t,
        p10: percentil(serie.map(p => p.v), 10), p90: percentil(serie.map(p => p.v), 90),
    };
}

/** Lecturas recibidas frente a las esperadas por `intervaloMin` en la ventana. */
export function cobertura(serie: PuntoHidro[], intervaloMin: number, desde: number, hasta: number): Cobertura | null {
    if (!(intervaloMin > 0) || !(hasta > desde)) return null;
    const esperadas = Math.max(1, Math.floor((hasta - desde) / (intervaloMin * 60000)));
    const recibidas = new Set(enVentana(serie, desde, hasta).map(p => p.t)).size;
    const pct = Math.min(100, (recibidas / esperadas) * 100);
    return { esperadas, recibidas, pct, confiable: pct >= COBERTURA_MIN_CONFIABLE };
}

/**
 * Volumen estimado (Mm³) = Σ (q_i + q_{i+1})/2 · Δt, solo entre lecturas vecinas separadas ≤ `maxHuecoMin`.
 * `excluidosT`: horas de lecturas descartadas que permanecen en la serie para cortar el tramo (no se puentean).
 * null si no hay ningún tramo integrable (nunca 0 inventado).
 */
export function volumenMm3(
    gasto: PuntoHidro[], desde: number, hasta: number, maxHuecoMin = MAX_HUECO_VOLUMEN_MIN, excluidosT?: Set<number>,
): Volumen | null {
    const s = enVentana(gasto, desde, hasta).sort((a, b) => a.t - b.t);
    if (s.length < 2 || !(hasta > desde)) return null;
    let m3 = 0;
    let msIntegrado = 0;
    for (let i = 1; i < s.length; i++) {
        const dt = s[i].t - s[i - 1].t;
        if (dt <= 0 || dt > maxHuecoMin * 60000) continue;
        // Un tramo con un extremo excluido (cero sospechoso) no se integra: interpolar entre sus vecinos fabricaría gasto.
        if (excluidosT && (excluidosT.has(s[i].t) || excluidosT.has(s[i - 1].t))) continue;
        m3 += ((s[i].v + s[i - 1].v) / 2) * (dt / 1000);
        msIntegrado += dt;
    }
    if (msIntegrado === 0) return null;
    return {
        mm3: m3 / 1e6,
        pctIntegrado: Math.min(100, (msIntegrado / (hasta - desde)) * 100),
        gastoMedio: m3 / (msIntegrado / 1000),
    };
}

/** Pendiente robusta (Theil-Sen) en unidades por día, sobre promedios horarios. null con < 6 puntos. */
export function pendientePorDia(serie: PuntoHidro[]): number | null {
    if (serie.length < 6) return null;
    const horarios = new Map<number, { s: number; n: number }>();
    for (const p of serie) {
        const k = Math.floor(p.t / HORA);
        const a = horarios.get(k);
        if (a) { a.s += p.v; a.n++; } else horarios.set(k, { s: p.v, n: 1 });
    }
    const pts = [...horarios.entries()].sort((a, b) => a[0] - b[0]).map(([k, a]) => ({ x: (k * HORA) / DIA, y: a.s / a.n }));
    return pts.length < 6 ? null : theilSen(pts);
}

/** Variación a 24 h y 7 d (el último punto contra el más cercano a esa antigüedad). */
export function variacion(serie: PuntoHidro[], epsilon: number, ahoraMs?: number): Variacion {
    // Con la estación apagada (último dato más viejo que STALE) el delta sería de otro periodo: S/D.
    const ult = serie.length ? serie[serie.length - 1].t : null;
    if (ahoraMs && (ult == null || ahoraMs - ult > STALE_GOES_MIN * 60000)) return { h24: null, d7: null };
    return { h24: tendencia(serie, 24, epsilon, TOLERANCIA_VARIACION), d7: tendencia(serie, 24 * 7, epsilon, TOLERANCIA_VARIACION) };
}

/** Umbral de "Estable" por variable: nivel 2 cm, gasto 1 m³/s. */
export const EPSILON_NIVEL_M = 0.02;
export const EPSILON_GASTO_M3S = 1;

/** Estadística completa de una estación en una ventana. `series` debe cubrir la ventana (ver useHidroEstaciones). */
export function estadisticaEstacion(
    id: string, intervaloMin: number | null, series: SeriesEstadistica, ventana: VentanaHidro, ahoraMs: number,
): EstadisticaEstacion {
    const hasta = ahoraMs;
    const desde = hasta - VENTANAS[ventana].horas * HORA;
    const nivel = enVentana(series.nivel_m, desde, hasta);
    const gastoCrudo = enVentana(series.gasto_m3s, desde, hasta);
    const { validos: gasto, excluidas, tExcluidos } = sinCerosSospechosos(id, gastoCrudo, nivel);
    const pctExcluidas = gastoCrudo.length ? (excluidas / gastoCrudo.length) * 100 : null;
    const velocidad = enVentana(series.velocidad_ms, desde, hasta);
    return {
        id, ventana, desde, hasta,
        nivel: resumenEstacion(nivel),
        gasto: resumenEstacion(gasto),
        velocidad: resumenEstacion(velocidad),
        // La cobertura cuenta lo recibido (incluidos los ceros sospechosos: la estación sí transmitió).
        cobertura: nivel.length || gastoCrudo.length
            ? cobertura(nivel.length >= gastoCrudo.length ? nivel : gastoCrudo, intervaloMin ?? 20, desde, hasta - LATENCIA_COBERTURA_MIN * 60000)
            : null,
        // Se integra la serie cruda cortando los tramos con extremo excluido (no se puentean los ceros descartados).
        volumen: volumenMm3(gastoCrudo, desde, hasta, MAX_HUECO_VOLUMEN_MIN, tExcluidos),
        excluidas,
        gastoRecibidas: gastoCrudo.length,
        pctExcluidas,
        gastoRepresentativo: pctExcluidas == null || pctExcluidas <= 50,
        variacionNivel: variacion(enVentana(series.nivel_m, desde - 8 * DIA, hasta), EPSILON_NIVEL_M, ahoraMs),
        variacionGasto: variacion(sinCerosSospechosos(id, enVentana(series.gasto_m3s, desde - 8 * DIA, hasta), series.nivel_m ?? []).validos, EPSILON_GASTO_M3S, ahoraMs),
        pendienteGastoDia: pendientePorDia(gasto),
    };
}

/** Texto de dirección para una pendiente por día, con banda de "estable" dada. */
export function etiquetaPendiente(pendiente: number | null, estable: number): 'sube' | 'baja' | 'estable' | null {
    if (pendiente == null || !Number.isFinite(pendiente)) return null;
    return Math.abs(pendiente) < estable ? 'estable' : pendiente > 0 ? 'sube' : 'baja';
}

export interface ComparacionPresaRio {
    gastoPresa: number;
    gastoRio: number;
    /** río − presa, m³/s. */
    diferencia: number;
    /** diferencia / gasto de presa, %; null si la presa extrae ~0. */
    pct: number | null;
    desfaseH: number;
}

/**
 * Comparación ORIENTATIVA (no balance cerrado): gasto medio extraído por la presa frente al medido en una estación de río
 * aguas abajo, con `desfaseH` horas de tránsito. Ignora aportes, tomas y pérdidas intermedias.
 */
export function comparaPresaRio(presa: PuntoHidro[], rio: PuntoHidro[], desde: number, hasta: number, desfaseH: number): ComparacionPresaRio | null {
    const a = resumenSerie(enVentana(presa, desde, hasta).map(p => p.v));
    const b = resumenSerie(enVentana(rio, desde + desfaseH * HORA, hasta + desfaseH * HORA).map(p => p.v));
    if (!a || !b) return null;
    return {
        gastoPresa: a.media, gastoRio: b.media, diferencia: b.media - a.media,
        pct: a.media > 0.05 ? ((b.media - a.media) / a.media) * 100 : null, desfaseH,
    };
}
