/**
 * vasoAnalisis — lógica PURA del bloque "Evolución del vaso" (antes ~10 useMemo dentro de PresaVasoMonitor.tsx):
 * nivel del día de cada escena, validación cruzada contra la curva oficial, índice de fragmentación, diferencia
 * de polígonos (azolve / nueva inundación) y resumen de recalibración. S/D = null, nunca 0.
 */
import { areaKm2PorElevacion, type PuntoCurva } from './presaNiveles';
import type { EscenaVaso, ValidacionVaso } from './informeVasoDatos';
import type { BboxVaso } from './informeVasoSvg';
import { DIAS_NIVEL_ESCENA, FRAGMENTACION_ATENCION_PCT, FRAGMENTACION_CRITICA_PCT, NUBES_VASO_MAX_PCT } from './vasoUmbrales';

export interface NivelDia { fecha: string; escala_msnm: number; fuente: 'historico' | 'captura' }

/** Fecha real de los píxeles (v2) o, si no se conoce (v1), la fecha registrada de la escena. */
export const fechaPixeles = (e: Pick<EscenaVaso, 'fecha_escena' | 'fecha_pixeles'>) => e.fecha_pixeles ?? e.fecha_escena;
/** % nublado sobre el vaso (v2) o, de respaldo, la nubosidad de toda la escena (v1). */
export const nubesEscena = (e: Pick<EscenaVaso, 'cobertura_nubes_vaso_pct' | 'nubosidad_pct'>) => e.cobertura_nubes_vaso_pct ?? e.nubosidad_pct ?? null;

/** 'AAAA-MM-DD' en hora de Chihuahua de un instante ISO. */
export const diaLocal = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Chihuahua' });
const diasEntre = (a: string, b: string) => Math.abs(Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 864e5;

/** Une el histórico diario (CILA, preferente) con las capturas, una fila por día. */
export function unirNiveles(historico: { fecha: string; escala_msnm: number | null }[], captura: { fecha: string; escala_msnm: number | null }[]): NivelDia[] {
    const porDia = new Map<string, NivelDia>();
    for (const c of captura) if (c.escala_msnm != null) porDia.set(c.fecha.slice(0, 10), { fecha: c.fecha.slice(0, 10), escala_msnm: Number(c.escala_msnm), fuente: 'captura' });
    for (const h of historico) if (h.escala_msnm != null) porDia.set(h.fecha.slice(0, 10), { fecha: h.fecha.slice(0, 10), escala_msnm: Number(h.escala_msnm), fuente: 'historico' });
    return [...porDia.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Nivel del embalse el día de la escena (±dias), el más cercano; null si no hay. */
export function nivelEnFecha(iso: string, niveles: NivelDia[], dias = DIAS_NIVEL_ESCENA): (NivelDia & { dias: number }) | null {
    const d = diaLocal(iso);
    let mejor: (NivelDia & { dias: number }) | null = null;
    for (const n of niveles) {
        const dd = diasEntre(n.fecha, d);
        if (dd <= dias && (!mejor || dd < mejor.dias || (dd === mejor.dias && n.fuente === 'historico'))) mejor = { ...n, dias: dd };
    }
    return mejor;
}

/** Por escena: área satelital contra el área de la curva oficial a la cota DEL DÍA de los píxeles. */
export function validacionCruzada(escenas: EscenaVaso[], niveles: NivelDia[], curva: PuntoCurva[] | undefined): ValidacionVaso[] {
    return escenas.map((e) => {
        const base = { fecha_escena: e.fecha_escena, areaSatelite: e.area_km2 };
        const nubes = nubesEscena(e);
        if (nubes != null && nubes > NUBES_VASO_MAX_PCT) return { ...base, sinReferencia: true, motivo: 'nubes' as const };
        const n = nivelEnFecha(fechaPixeles(e), niveles);
        if (!n) return { ...base, sinReferencia: true, motivo: 'sin_nivel' as const };
        const esperada = areaKm2PorElevacion(curva, n.escala_msnm);
        if (esperada == null || esperada <= 0) return { ...base, sinReferencia: true, motivo: 'sin_curva' as const };
        return {
            ...base, sinReferencia: false, fechaLectura: n.fecha, escalaLectura: n.escala_msnm, fuenteNivel: n.fuente,
            diasDiferencia: n.dias, areaEsperadaKm2: esperada, pctCoincidencia: (e.area_km2 / esperada) * 100,
        };
    });
}

export type Fragmentacion =
    | { disponible: false }
    | { disponible: true; nivel: 'normal' | 'atencion' | 'critico'; desviacionPct: number; baseRatio: number; ratioActual: number; islasAgravante: boolean; baseIslas: number; islasActuales: number };

/**
 * Índice de fragmentación: ratio de elongación de la escena más reciente contra el promedio de la propia presa,
 * SOLO entre escenas del mismo método (el perímetro depende de la resolución: v1 a 20 m y v2 a 10 m no se comparan).
 * Más bancos de tierra que el promedio sube un nivel.
 */
export function indiceFragmentacion(escenas: EscenaVaso[]): Fragmentacion {
    const reciente = escenas[escenas.length - 1];
    if (!reciente || reciente.ratio_elongacion == null) return { disponible: false };
    const mismas = escenas.filter((e) => (e.metodo ?? 'v1') === (reciente.metodo ?? 'v1') && e.ratio_elongacion != null);
    if (mismas.length < 3) return { disponible: false };
    const previos = mismas.filter((e) => e.fecha_escena !== reciente.fecha_escena);
    const baseRatio = previos.reduce((s, e) => s + e.ratio_elongacion!, 0) / previos.length;
    if (!(baseRatio > 0)) return { disponible: false };
    const ratioActual = reciente.ratio_elongacion;
    const desviacionPct = ((ratioActual - baseRatio) / baseRatio) * 100;
    let nivel: 'normal' | 'atencion' | 'critico' = desviacionPct <= FRAGMENTACION_ATENCION_PCT ? 'normal' : desviacionPct <= FRAGMENTACION_CRITICA_PCT ? 'atencion' : 'critico';
    const baseIslas = previos.reduce((s, e) => s + e.num_islas, 0) / previos.length;
    const islasAgravante = reciente.num_islas > baseIslas + 1;
    if (islasAgravante) nivel = nivel === 'normal' ? 'atencion' : 'critico';
    return { disponible: true, nivel, desviacionPct, baseRatio, ratioActual, islasAgravante, baseIslas, islasActuales: reciente.num_islas };
}

/** Punto en polígono con islas (par-impar sobre todos los anillos). */
export function dentroDelPoligono(coordinates: [number, number][][], lon: number, lat: number): boolean {
    let dentro = false;
    for (const anillo of coordinates) {
        for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
            const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
            if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
        }
    }
    return dentro;
}

export interface DiferenciaPoligonos { W: number; H: number; RES: number; celdasAzolve: [number, number][]; celdasNuevaAgua: [number, number][]; areaAzolveKm2: number; areaNuevaKm2: number }

/**
 * Diferencia entre dos polígonos rasterizada sobre el encuadre común (misma proyección que poligonoPath):
 * agua en `base` y tierra en `comp` = banco expuesto; el caso inverso = nueva inundación.
 * km por píxel de pantalla = 111.32·cos(lat) / k (k = píxeles por grado·cos) — antes se usaba 111.32 km/px,
 * lo que inflaba las áreas ~10⁵ veces.
 */
export function diferenciaPoligonos(
    base: [number, number][][], comp: [number, number][][], b: BboxVaso, W: number, H: number, RES = 3,
): DiferenciaPoligonos {
    const spanLon = (b.maxLon - b.minLon) * b.cosLat, spanLat = b.maxLat - b.minLat;
    const k = Math.min(W / spanLon, H / spanLat);
    const offX = (W - spanLon * k) / 2, offY = (H - spanLat * k) / 2;
    const kmPorPx = 111.32 / k;
    const celdasAzolve: [number, number][] = [], celdasNuevaAgua: [number, number][] = [];
    for (let py = 0; py < H; py += RES) {
        for (let px = 0; px < W; px += RES) {
            const lon = b.minLon + (px + RES / 2 - offX) / (b.cosLat * k);
            const lat = b.maxLat - (py + RES / 2 - offY) / k;
            if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat) continue;
            const enB = dentroDelPoligono(base, lon, lat), enC = dentroDelPoligono(comp, lon, lat);
            if (enB && !enC) celdasAzolve.push([px, py]);
            else if (!enB && enC) celdasNuevaAgua.push([px, py]);
        }
    }
    const km2Celda = (RES * kmPorPx) ** 2;
    return { W, H, RES, celdasAzolve, celdasNuevaAgua, areaAzolveKm2: celdasAzolve.length * km2Celda, areaNuevaKm2: celdasNuevaAgua.length * km2Celda };
}

export interface FactorCorreccion { banda_elevacion_msnm: number; factor_area: number; desviacion_pct_prom: number; n_observaciones: number }

/** Desvío promedio ponderado por observaciones y banda con mayor |desvío|; null si no hay observaciones. */
export function resumenRecalibracion(factores: FactorCorreccion[]) {
    const totalObs = factores.reduce((s, f) => s + f.n_observaciones, 0);
    if (!factores.length || totalObs <= 0) return null;
    const desviacionPonderada = factores.reduce((s, f) => s + f.desviacion_pct_prom * f.n_observaciones, 0) / totalObs;
    const bandaMayorDesvio = [...factores].sort((a, b) => Math.abs(b.desviacion_pct_prom) - Math.abs(a.desviacion_pct_prom))[0];
    return { desviacionPonderada, bandaMayorDesvio, totalBandas: factores.length, totalObs };
}
