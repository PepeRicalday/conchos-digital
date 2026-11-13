// ═══════════════════════════════════════════════════════════════════════════
// Modelo de la red regional UNIFRUT (Red de Estaciones Meteorológicas de Unifrut A.C., Cuauhtémoc) para la vista de la cuenca.
// Puro y sin red: lo alimenta useUnifrutCuenca y lo usan la tabla, el mapa y el informe, así las cifras nunca divergen.
//
// REGLAS (acordadas 2026-11-13):
//  · Las estaciones Unifrut están FUERA del contorno de la cuenca del Conchos: NUNCA entran al promedio ni a la lluvia areal de la cuenca (jcasModelo).
//    Se muestran como «contexto regional»; solo las colindantes (≤ COLINDANTE_KM del límite) se resumen aparte, rotuladas como tales.
//  · Solo días COMPLETOS (el portal no da lectura parcial del día en curso): la ventana 'hoy' es S/D.
//  · S/D = null, nunca 0. Una ventana con menos del 80 % de los días con dato es S/D (misma regla que JCAS).
// ═══════════════════════════════════════════════════════════════════════════
import { diasDeVentana, type VentanaObs } from './jcasModelo';

/** Distancia al contorno (km) hasta la cual una estación se considera colindante. */
export const COLINDANTE_KM = 25;
/** Días sin dato a partir de los cuales una estación se considera atrasada (el portal publica el día N hasta bien entrado el N+1). */
export const DIAS_ATRASO_UNIFRUT = 3;
/** Más de estos días sin dato = fuera de servicio (no es «atrasada», es S/D). */
export const DIAS_FUERA_SERVICIO = 30;

export interface FilaEstacionUnifrut {
    id_unifrut: string; nombre: string; municipio: string; tipo: 'CAMB' | 'ADCON'; latitud: number; longitud: number; altitud_m: number | null;
    zona: 'cuenca' | 'salida' | 'fuera'; dist_limite_km: number | null; ult_fecha: string | null;
}
export interface FilaLecturaUnifrut {
    estacion_id: string; fecha: string; lluvia_mm: number | null; tmax_c: number | null; tmin_c: number | null; tmed_c: number | null;
    viento_kmh: number | null; viento_max_kmh: number | null; eto_mm: number | null;
}

export type EstadoUnifrut = 'vigente' | 'atrasada' | 'fuera-servicio' | 'sin-datos';
export type VariableUnifrut = 'lluvia' | 'tmed' | 'tmax' | 'tmin' | 'eto' | 'viento';

export interface PuntoUnifrut {
    id: string; nombre: string; municipio: string; tipo: 'CAMB' | 'ADCON'; lat: number; lon: number; altitudM: number | null;
    distLimiteKm: number | null; colindante: boolean; estado: EstadoUnifrut; ultFecha: string | null; atrasoDias: number | null;
    /** Lecturas diarias completas, ordenadas por fecha. */
    lec: FilaLecturaUnifrut[];
}
export interface ModeloUnifrut {
    /** Último día completo (ayer). */
    fin: string;
    puntos: PuntoUnifrut[];
    total: number; vigentes: number; colindantesVigentes: number;
}

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const sumaDias = (f: string, n: number) => new Date(Date.parse(`${f}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function estadoDe(ultFecha: string | null, fin: string): { estado: EstadoUnifrut; atrasoDias: number | null } {
    if (!ultFecha) return { estado: 'sin-datos', atrasoDias: null };
    const d = diasEntre(ultFecha, fin);
    if (d <= DIAS_ATRASO_UNIFRUT) return { estado: 'vigente', atrasoDias: Math.max(0, d) };
    if (d <= DIAS_FUERA_SERVICIO) return { estado: 'atrasada', atrasoDias: d };
    return { estado: 'fuera-servicio', atrasoDias: d };
}

/** `hoy` = día local de hoy (YYYY-MM-DD); el último día completo es ayer. */
export function construirRedUnifrut(est: FilaEstacionUnifrut[], lec: FilaLecturaUnifrut[], hoy: string): ModeloUnifrut {
    const fin = sumaDias(hoy, -1);
    const porEst = new Map<string, FilaLecturaUnifrut[]>();
    for (const l of lec) { if (l.fecha > fin) continue; (porEst.get(l.estacion_id) ?? porEst.set(l.estacion_id, []).get(l.estacion_id)!).push(l); }
    const puntos: PuntoUnifrut[] = est.map((e) => {
        const ls = (porEst.get(e.id_unifrut) ?? []).sort((a, b) => a.fecha.localeCompare(b.fecha));
        const ult = ls.length ? ls[ls.length - 1].fecha : e.ult_fecha;
        const { estado, atrasoDias } = estadoDe(ult, fin);
        const dist = e.dist_limite_km;
        return {
            id: e.id_unifrut, nombre: e.nombre, municipio: e.municipio, tipo: e.tipo, lat: e.latitud, lon: e.longitud, altitudM: e.altitud_m,
            distLimiteKm: dist, colindante: dist != null && dist <= COLINDANTE_KM, estado, ultFecha: ult, atrasoDias, lec: ls,
        };
    });
    const vig = puntos.filter((p) => p.estado === 'vigente');
    return { fin, puntos, total: puntos.length, vigentes: vig.length, colindantesVigentes: vig.filter((p) => p.colindante).length };
}

const CAMPO: Record<VariableUnifrut, keyof FilaLecturaUnifrut> = {
    lluvia: 'lluvia_mm', tmed: 'tmed_c', tmax: 'tmax_c', tmin: 'tmin_c', eto: 'eto_mm', viento: 'viento_kmh',
};
const redondea = (v: number) => Math.round(v * 10) / 10;

/**
 * Valor de un punto en una ventana de días completos que termina en `fin`: lluvia y ETo se SUMAN, temperatura media y viento se PROMEDIAN,
 * Tmax es el máximo y Tmin el mínimo de la ventana. 'hoy' = S/D. Menos del 80 % de los días con dato = S/D (nunca 0).
 */
export function valorUnifrut(p: PuntoUnifrut, variable: VariableUnifrut, v: VentanaObs, fin: string): number | null {
    if (v === 'hoy') return null;
    const dias = diasDeVentana(v, fin);
    if (dias <= 0) return null;
    const t1 = Date.parse(`${fin}T00:00:00Z`), t0 = t1 - (dias - 1) * 86_400_000;
    const campo = CAMPO[variable];
    const xs: number[] = [];
    for (const l of p.lec) {
        const t = Date.parse(`${l.fecha}T00:00:00Z`), x = l[campo];
        if (t >= t0 && t <= t1 && typeof x === 'number' && Number.isFinite(x)) xs.push(x);
    }
    if (xs.length < Math.ceil(dias * 0.8)) return null;
    const suma = xs.reduce((a, b) => a + b, 0);
    switch (variable) {
        case 'lluvia': case 'eto': return redondea(suma);
        case 'tmax': return redondea(Math.max(...xs));
        case 'tmin': return redondea(Math.min(...xs));
        default: return redondea(suma / xs.length);
    }
}

export interface ResumenColindantes { n: number; media: number | null; min: number | null; max: number | null; nombres: string[] }

/**
 * Lluvia de las estaciones COLINDANTES vigentes con dato en la ventana: media simple, NO es la lluvia areal de la cuenca.
 * Con menos de 2 estaciones el resultado es S/D (una sola no resume nada).
 */
export function resumenColindantes(m: ModeloUnifrut, v: VentanaObs): ResumenColindantes {
    const ps = m.puntos.filter((p) => p.estado === 'vigente' && p.colindante)
        .map((p) => ({ p, mm: valorUnifrut(p, 'lluvia', v, m.fin) })).filter((x): x is { p: PuntoUnifrut; mm: number } => x.mm != null);
    if (ps.length < 2) return { n: ps.length, media: null, min: null, max: null, nombres: ps.map((x) => x.p.nombre) };
    const mms = ps.map((x) => x.mm);
    return { n: ps.length, media: redondea(mms.reduce((a, b) => a + b, 0) / mms.length), min: Math.min(...mms), max: Math.max(...mms), nombres: ps.map((x) => x.p.nombre) };
}

export const ROTULO_UNIFRUT = 'Unifrut · contexto regional';
/** Texto de ubicación frente a la cuenca para tabla y mapa. */
export const ubicacionUnifrut = (p: Pick<PuntoUnifrut, 'distLimiteKm' | 'colindante'>): string =>
    p.distLimiteKm == null ? 'fuera de la cuenca' : p.colindante ? `colindante · ≈ ${p.distLimiteKm} km del límite` : `≈ ${p.distLimiteKm} km del límite`;
