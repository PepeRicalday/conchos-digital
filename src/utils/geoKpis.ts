/**
 * geoKpis — lógica pura de Geo-Monitor (antes embebida en un componente de 3,000 líneas y sin pruebas).
 *
 * Regla rectora "S/D nunca cero": un dato ausente jamás se convierte en 0. Los casos peligrosos que se corrigen aquí:
 *  · apertura de radiales nula ≠ "CERRADAS";
 *  · extracción sin medición no se sustituye por un gasto inventado (se distingue MEDIDO de SOLICITADO);
 *  · almacenamiento/% nulos no disparan la alerta de «presa baja»;
 *  · un nivel nulo no se grafica como 0.
 */

/** Minutos a partir de los cuales la lectura de una escala deja de considerarse "en vivo". */
export const STALE_MIN_ESCALA = 240;

export const minutosDesde = (tsMs: number | null | undefined, ahoraMs: number): number | null =>
    tsMs == null || !Number.isFinite(tsMs) ? null : (ahoraMs - tsMs) / 60000;

export function esFrescaEscala(ultimaTelemetriaMs: number | null | undefined, ahoraMs: number, umbralMin: number = STALE_MIN_ESCALA): boolean {
    const m = minutosDesde(ultimaTelemetriaMs, ahoraMs);
    return m != null && m <= umbralMin;
}

export type EstadoCompuertas = 'S/D' | 'CERRADAS' | 'ABIERTAS';

/** Apertura de radiales (m). null/undefined = sin dato; 0 = medición de cerrado. */
export function estadoCompuertas(aperturaM: number | null | undefined): EstadoCompuertas {
    if (aperturaM == null || !Number.isFinite(aperturaM)) return 'S/D';
    return aperturaM > 0 ? 'ABIERTAS' : 'CERRADAS';
}

export interface ExtraccionPresa {
    valorM3s: number | null;
    /** MEDIDO = lectura o movimiento de campo; SOLICITADO = instrucción de un protocolo (no es una medición). */
    fuente: 'MEDIDO' | 'SOLICITADO' | null;
}

/**
 * Extracción de una presa. Una medición de campo prevalece; el gasto SOLICITADO por un protocolo solo se muestra
 * como tal (nunca como medido) y nunca se rellena con un valor por defecto.
 */
export function extraccionPresa(medidoM3s: number | null | undefined, solicitadoM3s: number | null | undefined): ExtraccionPresa {
    if (medidoM3s != null && Number.isFinite(medidoM3s)) return { valorM3s: medidoM3s, fuente: 'MEDIDO' };
    if (solicitadoM3s != null && Number.isFinite(solicitadoM3s) && solicitadoM3s > 0) return { valorM3s: solicitadoM3s, fuente: 'SOLICITADO' };
    return { valorM3s: null, fuente: null };
}

export const UMBRAL_PRESA_BAJA_PCT = 40;

/** ¿Hay que alertar por presa baja? Sin dato de llenado NO se alerta (antes null → 0 % → alerta falsa). */
export function presaBaja(porcentajeLlenado: number | null | undefined): boolean {
    return porcentajeLlenado != null && Number.isFinite(porcentajeLlenado) && porcentajeLlenado < UMBRAL_PRESA_BAJA_PCT;
}

/** Valor para una serie graficada: null se queda null (hueco), no 0. */
export const valorGrafica = (v: number | string | null | undefined): number | null => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/** Kilometraje con 3 decimales; null → S/D (el km 0 real sí se muestra como 0.000). */
export const kmTexto = (km: number | null | undefined): string => (km == null || !Number.isFinite(km) ? 'S/D' : km.toFixed(3));

export function ordenarPorKm<T extends { km: number | null | undefined }>(items: T[]): T[] {
    return [...items].sort((a, b) => (a.km ?? Number.POSITIVE_INFINITY) - (b.km ?? Number.POSITIVE_INFINITY));
}

/** Busca la escala de un punto kilométrico exacto (0 y 104 son los extremos del tramo). */
export function escalaEnKm<T extends { km: number | null | undefined }>(items: T[], km: number): T | undefined {
    return items.find(i => i.km != null && i.km === km);
}
