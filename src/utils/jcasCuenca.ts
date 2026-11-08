// ═══════════════════════════════════════════════════════════════════════════
// Lluvia de la cuenca del Conchos con la red JCAS + las demás fuentes — modelo puro (sin React ni red)
// ---------------------------------------------------------------------------
// Contexto, no medición oficial: JCAS/UACJ es una fuente TERCERA sin API y con datos provisionales. Reglas del proyecto:
//  · S/D = null, nunca 0. Un acumulado con menos del 80 % de los días con dato es S/D.
//  · Estaciones de una misma ciudad pesan UNA vez (mediana del grupo).
//  · Un pluviómetro que marca 0 mm en una ventana larga mientras sus vecinas registran lluvia se EXCLUYE y se avisa
//    (Parral, nov-2026: 0.0 mm en 31 días frente a 28–118 mm alrededor).
//  · El promedio areal usa IDW (p=2, utils/interpolacionClima.ts) limitado a una vecindad: no se extrapola a 200 km.
//    Si la cobertura de la cuenca es < 50 % o hay < 5 estaciones útiles, el resultado es S/D (nunca "0 mm").
//  · Nunca se habla de "normal" ni de anomalía: la serie JCAS es corta.
// ═══════════════════════════════════════════════════════════════════════════
import { distanciaKm, idw, type PuntoMuestra } from './interpolacionClima';
import { type PoligonoGeo, type ContornoCuenca } from './geoCuenca';
import { dentroDelPoligono } from './vasoAnalisis';

export type FuenteLluvia = 'weatherlink' | 'aqwp' | 'jcas';

export interface PuntoLluvia {
    id: string;
    fuente: FuenteLluvia;
    nombre: string;
    lat: number;
    lon: number;
    /** Acumulado de la ventana en mm; null = S/D. */
    mm: number | null;
    /** Pluviómetro excluido del promedio (motivo en `motivo`). */
    sospechosa?: boolean;
    motivo?: string;
}

export const RADIO_VECINDAD_KM = 90;
export const MIN_PUNTOS_AREAL = 5;
export const MIN_COBERTURA_PCT = 50;
export const MIN_COBERTURA_DIAS = 0.8;
/** Dos estaciones a menos de esta distancia son el mismo sitio; se conserva la de la fuente con mayor prioridad. */
export const DISTANCIA_MISMO_SITIO_KM = 3;
const PRIORIDAD: Record<FuenteLluvia, number> = { weatherlink: 0, aqwp: 1, jcas: 2 };

export interface DiaLluvia { fecha: string; lluviaMm: number | null }

/** Acumulado de `dias` días que terminan en `hasta` (inclusive, YYYY-MM-DD). null si faltan datos (< 80 % de los días). */
export function acumuladoLluvia(lecturas: DiaLluvia[], hasta: string, dias: number): { mm: number | null; diasConDato: number } {
    const fin = Date.parse(`${hasta}T00:00:00Z`);
    const ini = fin - (dias - 1) * 86_400_000;
    const vistos = new Map<string, number>();
    for (const l of lecturas) {
        const t = Date.parse(`${l.fecha}T00:00:00Z`);
        if (t >= ini && t <= fin && l.lluviaMm != null && Number.isFinite(l.lluviaMm) && l.lluviaMm >= 0) vistos.set(l.fecha, l.lluviaMm);
    }
    const diasConDato = vistos.size;
    if (diasConDato < Math.ceil(dias * MIN_COBERTURA_DIAS)) return { mm: null, diasConDato };
    let s = 0;
    for (const v of vistos.values()) s += v;
    return { mm: Math.round(s * 10) / 10, diasConDato };
}

const mediana = (v: number[]): number => { const a = [...v].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

/** Estaciones del mismo grupo (misma ciudad) → un punto con la mediana de su lluvia; las S/D no cuentan. */
export function colapsarGrupos(puntos: (PuntoLluvia & { grupo?: string | null })[]): PuntoLluvia[] {
    const grupos = new Map<string, (PuntoLluvia & { grupo?: string | null })[]>();
    const sueltos: PuntoLluvia[] = [];
    for (const p of puntos) {
        if (p.grupo) grupos.set(p.grupo, [...(grupos.get(p.grupo) ?? []), p]); else sueltos.push(p);
    }
    for (const [g, ps] of grupos) {
        const con = ps.filter((p) => p.mm != null);
        const lat = ps.reduce((a, p) => a + p.lat, 0) / ps.length, lon = ps.reduce((a, p) => a + p.lon, 0) / ps.length;
        sueltos.push({
            id: `grupo:${g}`, fuente: ps[0].fuente, nombre: `${g.charAt(0).toUpperCase()}${g.slice(1)} (${ps.length} est.)`, lat, lon,
            mm: con.length ? Math.round(mediana(con.map((p) => p.mm as number)) * 10) / 10 : null,
        });
    }
    return sueltos;
}

/** Quita duplicados de sitio entre fuentes (p. ej. la estación propia y la JCAS de la misma ciudad): gana la de mayor prioridad. */
export function deduplicarSitios(puntos: PuntoLluvia[]): PuntoLluvia[] {
    const orden = [...puntos].sort((a, b) => PRIORIDAD[a.fuente] - PRIORIDAD[b.fuente] || (b.mm != null ? 1 : 0) - (a.mm != null ? 1 : 0));
    const out: PuntoLluvia[] = [];
    for (const p of orden) {
        if (!out.some((q) => distanciaKm(p.lat, p.lon, q.lat, q.lon) < DISTANCIA_MISMO_SITIO_KM)) out.push(p);
    }
    return out;
}

/**
 * Marca como sospechoso al pluviómetro con 0 mm cuando ≥ 2 vecinas (≤ RADIO_VECINDAD_KM) registran ≥ 20 mm en la misma ventana.
 * Solo aplica a acumulados de 14 días o más: en ventanas cortas un 0 es normal.
 */
export function marcarSospechosos(puntos: PuntoLluvia[], ventanaDias: number): PuntoLluvia[] {
    if (ventanaDias < 14) return puntos;
    return puntos.map((p) => {
        if (p.mm !== 0) return p;
        const vecinas = puntos.filter((q) => q !== p && q.mm != null && !q.sospechosa && q.mm >= 20 && distanciaKm(p.lat, p.lon, q.lat, q.lon) <= RADIO_VECINDAD_KM);
        return vecinas.length >= 2
            ? { ...p, sospechosa: true, motivo: `0 mm en ${ventanaDias} días mientras ${vecinas.length} estaciones vecinas registran ${Math.min(...vecinas.map((v) => v.mm as number)).toFixed(0)}–${Math.max(...vecinas.map((v) => v.mm as number)).toFixed(0)} mm` }
            : p;
    });
}

export interface LluviaAreal {
    /** Promedio areal en mm; null = S/D (con `motivoSD`). */
    mm: number | null;
    motivoSD: string | null;
    nEstaciones: number;
    nExcluidas: number;
    coberturaPct: number;
    ventanaDias: number;
    min: number | null;
    max: number | null;
}

/**
 * Promedio areal de lluvia dentro de uno o varios polígonos: IDW sobre una malla regular (`pasoGrados`), contando solo las celdas
 * con al menos una estación útil a ≤ RADIO_VECINDAD_KM. Cobertura = % de celdas del polígono que cumplen eso.
 */
export function lluviaAreal(
    poligonos: PoligonoGeo[], puntos: PuntoLluvia[], ventanaDias: number, opciones: { pasoGrados?: number; minPuntos?: number; radioKm?: number } = {},
): LluviaAreal {
    const paso = opciones.pasoGrados ?? 0.1, minPuntos = opciones.minPuntos ?? MIN_PUNTOS_AREAL, radio = opciones.radioKm ?? RADIO_VECINDAD_KM;
    const utiles = puntos.filter((p) => p.mm != null && !p.sospechosa);
    const excluidas = puntos.filter((p) => p.sospechosa).length;
    const muestras: PuntoMuestra[] = utiles.map((p) => ({ nombre: p.nombre, lat: p.lat, lon: p.lon, valor: p.mm as number }));
    const base = { nEstaciones: utiles.length, nExcluidas: excluidas, ventanaDias, min: null, max: null };
    if (utiles.length < minPuntos) return { ...base, mm: null, motivoSD: `solo ${utiles.length} estación(es) con dato útil (mínimo ${minPuntos})`, coberturaPct: 0 };

    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const p of poligonos) for (const [x, y] of p[0]) { minLon = Math.min(minLon, x); maxLon = Math.max(maxLon, x); minLat = Math.min(minLat, y); maxLat = Math.max(maxLat, y); }
    let celdas = 0, cubiertas = 0, suma = 0, mn = Infinity, mx = -Infinity;
    for (let lat = minLat + paso / 2; lat < maxLat; lat += paso) {
        for (let lon = minLon + paso / 2; lon < maxLon; lon += paso) {
            if (!poligonos.some((p) => dentroDelPoligono(p, lon, lat))) continue;
            celdas++;
            const cerca = muestras.filter((m) => distanciaKm(lat, lon, m.lat, m.lon) <= radio);
            if (!cerca.length) continue;
            const v = idw({ lat, lon }, cerca);
            if (v == null) continue;
            cubiertas++; suma += v; mn = Math.min(mn, v); mx = Math.max(mx, v);
        }
    }
    const cobertura = celdas ? (cubiertas / celdas) * 100 : 0;
    if (cobertura < MIN_COBERTURA_PCT) return { ...base, mm: null, motivoSD: `las estaciones cubren solo el ${cobertura.toFixed(0)} % del área (mínimo ${MIN_COBERTURA_PCT} %)`, coberturaPct: cobertura };
    return { ...base, mm: Math.round((suma / cubiertas) * 10) / 10, motivoSD: null, coberturaPct: cobertura, min: Math.round(mn * 10) / 10, max: Math.round(mx * 10) / 10 };
}

/** Atajo para el contorno completo de la cuenca. */
export const lluviaArealCuenca = (c: ContornoCuenca, puntos: PuntoLluvia[], ventanaDias: number) => lluviaAreal(c.poligonos, puntos, ventanaDias);
