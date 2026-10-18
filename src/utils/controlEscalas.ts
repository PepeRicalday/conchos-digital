/**
 * controlEscalas — lógica pura de la pantalla Control de Niveles y Represos.
 *
 * Regla rectora "S/D nunca cero": una escala sin lectura vigente NO vale 0 m, no está "fuera de rango" y no entra
 * en promedios. Una fila autogenerada por continuidad de medianoche (confirmada=false, "SICA Chronos") es un
 * arrastre del último nivel, no una medición: se muestra rotulada y no cuenta como dato vigente.
 */

import { esEscalaReferencia } from './escalasReferencia';
import { STALE_MIN_ESCALA, esFrescaEscala } from './geoKpis';

export type EstadoNivel = 'sd' | 'stale' | 'arrastre' | 'referencia' | 'vaciado' | 'bajo' | 'alto' | 'en_rango';

export interface EntradaEstado {
    nombre?: string | null;
    km?: number | null;
    nivelM: number | null;
    minOperativo: number | null;
    maxOperativo: number | null;
    /** Instante (ms) de la lectura que originó el nivel; null si se desconoce. */
    telemetriaMs: number | null;
    /** false = fila autogenerada de continuidad (no es una medición de campo). */
    confirmada: boolean | null;
    vaciado: boolean;
    ahoraMs: number;
}

export interface ResultadoEstado {
    estado: EstadoNivel;
    /** Desviación respecto al rango (m): >0 sobre el máximo, <0 bajo el mínimo; null si no aplica. */
    desviacionM: number | null;
    /** true solo si el estado es una alerta operativa (bajo/alto). */
    alerta: boolean;
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Normaliza un campo numérico de BD: null/'' → null (nunca 0). */
export const aNumeroONull = num;

export function estadoNivel(e: EntradaEstado): ResultadoEstado {
    const sin = (estado: EstadoNivel): ResultadoEstado => ({ estado, desviacionM: null, alerta: false });
    if (e.nivelM == null || !Number.isFinite(e.nivelM)) return sin('sd');
    if (e.confirmada === false) return sin('arrastre');
    if (!esFrescaEscala(e.telemetriaMs, e.ahoraMs, STALE_MIN_ESCALA)) return sin('stale');
    if (esEscalaReferencia({ nombre: e.nombre, km: e.km })) return sin('referencia');
    if (e.vaciado) return sin('vaciado');
    const { minOperativo: mn, maxOperativo: mx, nivelM: n } = e;
    if (mn != null && n < mn) return { estado: 'bajo', desviacionM: n - mn, alerta: true };
    if (mx != null && n > mx) return { estado: 'alto', desviacionM: n - mx, alerta: true };
    return { estado: 'en_rango', desviacionM: 0, alerta: false };
}

/** ¿El nivel de este estado puede entrar en promedios? Solo mediciones vigentes de escalas de control. */
export const estadoCuentaEnPromedio = (s: EstadoNivel): boolean =>
    s === 'en_rango' || s === 'bajo' || s === 'alto' || s === 'vaciado';

/** Promedio solo con valores presentes; null (S/D) si no hay ninguno. */
export function promedioONull(valores: Array<number | null | undefined>): number | null {
    const v = valores.filter((x): x is number => x != null && Number.isFinite(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export interface Apertura { index: number; apertura_m: number }

/**
 * `radiales_json` llega como arreglo, string JSON, null o basura. Devuelve aperturas por POSICIÓN de compuerta
 * (0..n-1) tolerando índices base 0 y base 1, igual que calcRadialFlow. `null` en una posición = sin dato.
 */
export function normalizaRadiales(raw: unknown, pzas: number): Array<number | null> {
    let arr: unknown = raw;
    if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { arr = null; } }
    const out: Array<number | null> = Array.from({ length: Math.max(0, pzas) }, () => null);
    if (!Array.isArray(arr)) return out;
    const items = arr.filter((x): x is { index?: unknown; apertura_m?: unknown } => !!x && typeof x === 'object');
    const base1 = items.length > 0 && items.every(i => num(i.index) != null && (num(i.index) as number) >= 1) && !items.some(i => num(i.index) === 0);
    items.forEach((it, pos) => {
        const idx = num(it.index);
        const p = idx == null ? pos : (base1 ? idx - 1 : idx);
        const ap = num(it.apertura_m);
        if (p >= 0 && p < out.length && ap != null) out[p] = ap;
    });
    return out;
}

/** Resumen de compuertas: S/D si no hay ninguna apertura registrada (≠ "todas cerradas"). */
export function resumenCompuertas(aperturas: Array<number | null>): { estado: 'S/D' | 'CERRADAS' | 'ABIERTAS'; abiertas: number; conDato: number } {
    const conDato = aperturas.filter(a => a != null).length;
    if (conDato === 0) return { estado: 'S/D', abiertas: 0, conDato };
    const abiertas = aperturas.filter(a => a != null && a > 0).length;
    return { estado: abiertas > 0 ? 'ABIERTAS' : 'CERRADAS', abiertas, conDato };
}

/** Nivel visual del tubo (0–100 %) acotado, o null si no hay nivel. */
export function porcentajeTubo(valorM: number | null, maxEscalaM: number): number | null {
    if (valorM == null || !Number.isFinite(valorM) || !(maxEscalaM > 0)) return null;
    return Math.max(0, Math.min(100, (valorM / maxEscalaM) * 100));
}

/**
 * Eje visual del tubo (m, entero para marcas limpias): cubre el máximo operativo y el nivel actual con holgura.
 * OJO: `escalas.capacidad_max` (35–70) es capacidad de GASTO en m³/s, no un nivel: no sirve para el eje.
 */
export function maxEjeTubo(maxOperativo: number | null, nivelM: number | null): number {
    const cand = [maxOperativo != null ? maxOperativo * 1.15 : 0, nivelM != null ? nivelM * 1.05 : 0, 1];
    return Math.ceil(Math.max(...cand.filter(Number.isFinite)));
}
