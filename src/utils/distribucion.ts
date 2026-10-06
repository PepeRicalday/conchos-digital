/**
 * distribucion — cifras del Centro de Control Operativo (módulos, ciclo, tomas) con la regla "S/D nunca cero".
 *
 * Antes: `authorized_vol || 1` convertía un módulo sin volumen autorizado en "0.00 Mm³ disponibles"; el gauge de
 * cada módulo usaba un máximo fijo de 1000 L/s; y "eficiencia" era entregado/objetivo (0 % si faltaba el objetivo).
 */

export interface ModuloDist {
    id: string;
    short_code?: string | null;
    name: string;
    current_flow: number;
    daily_vol: number;
    accumulated_vol: number;
    authorized_vol: number;
    target_flow: number;
    delivery_points: { km: number }[];
}

const pos = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

export interface VolumenCiclo {
    consumidoMm3: number;
    /** null = el módulo no tiene volumen autorizado cargado (no se inventa un 1). */
    autorizadoMm3: number | null;
    disponibleMm3: number | null;
    /** Puede superar 100 (sobregiro): no se trunca. */
    pct: number | null;
}

export function volumenCiclo(m: Pick<ModuloDist, 'accumulated_vol' | 'authorized_vol'>): VolumenCiclo {
    const consumido = Number.isFinite(m.accumulated_vol) ? m.accumulated_vol : 0;
    const aut = pos(m.authorized_vol);
    return {
        consumidoMm3: consumido,
        autorizadoMm3: aut,
        disponibleMm3: aut != null ? Math.max(aut - consumido, 0) : null,
        pct: aut != null ? (consumido / aut) * 100 : null,
    };
}

export interface AvanceDistrito {
    acumuladoMm3: number | null;
    autorizadoMm3: number | null;
    pct: number | null;
    modulosConAutorizado: number;
    modulosTotal: number;
}

/** Avance del ciclo del distrito: solo módulos con volumen autorizado (el resto no entra ni al numerador ni al denominador). */
export function avanceDistrito(mods: Pick<ModuloDist, 'accumulated_vol' | 'authorized_vol'>[]): AvanceDistrito {
    const conAut = mods.filter((m) => pos(m.authorized_vol) != null);
    if (conAut.length === 0) return { acumuladoMm3: null, autorizadoMm3: null, pct: null, modulosConAutorizado: 0, modulosTotal: mods.length };
    const acum = conAut.reduce((a, m) => a + (Number.isFinite(m.accumulated_vol) ? m.accumulated_vol : 0), 0);
    const aut = conAut.reduce((a, m) => a + m.authorized_vol, 0);
    return { acumuladoMm3: acum, autorizadoMm3: aut, pct: (acum / aut) * 100, modulosConAutorizado: conAut.length, modulosTotal: mods.length };
}

export interface CaudalModulo {
    lps: number;
    /** Gasto objetivo del módulo (L/s); null si no tiene caudal objetivo (S/D, no 0). */
    objetivoLps: number | null;
    /** % del objetivo que se está entregando (puede superar 100). */
    pctObjetivo: number | null;
    operando: boolean;
}

export const UMBRAL_OPERANDO_M3S = 0.1;

export function caudalModulo(m: Pick<ModuloDist, 'current_flow' | 'target_flow'>): CaudalModulo {
    const lps = (Number.isFinite(m.current_flow) ? m.current_flow : 0) * 1000;
    const obj = pos(m.target_flow);
    return {
        lps,
        objetivoLps: obj != null ? obj * 1000 : null,
        pctObjetivo: obj != null ? (lps / (obj * 1000)) * 100 : null,
        operando: m.current_flow > UMBRAL_OPERANDO_M3S,
    };
}

/** Rango de km que cubre el módulo según sus propias tomas (no hay tabla de rangos en el código). */
export function rangoKmModulo(m: Pick<ModuloDist, 'delivery_points'>): [number, number] | null {
    const kms = m.delivery_points.map((p) => p.km).filter((k) => Number.isFinite(k));
    return kms.length ? [Math.min(...kms), Math.max(...kms)] : null;
}

export interface ResumenTomas { total: number; conCaptura: number; abiertas: number }
export function resumenTomas(puntos: { isCaptured: boolean; isOpen: boolean }[]): ResumenTomas {
    return { total: puntos.length, conCaptura: puntos.filter((p) => p.isCaptured).length, abiertas: puntos.filter((p) => p.isOpen).length };
}

/** Mensaje del mapa cuando no hay tomas que dibujar; explica la CAUSA en lugar de dejar un lienzo vacío. */
export function mensajeMapaVacio(r: ResumenTomas, esHoy: boolean): string | null {
    if (r.abiertas > 0 || r.conCaptura > 0) return null;
    return r.total === 0
        ? 'No hay tomas registradas para este tramo.'
        : `0 de ${r.total} tomas con captura ${esHoy ? 'hoy' : 'en la fecha elegida'}: el gasto de los módulos llega por captura de módulo, no por toma.`;
}

/** Posición (0–100 %) de un km dentro de [kmIni, kmFin]; null si el km está fuera del tramo o el rango es inválido. */
export function posicionKm(km: number, kmIni: number, kmFin: number): number | null {
    if (!Number.isFinite(km) || kmFin <= kmIni) return null;
    const p = ((km - kmIni) / (kmFin - kmIni)) * 100;
    return p < 0 || p > 100 ? null : p;
}
