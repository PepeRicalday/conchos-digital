/**
 * conduccion — eficiencia y pérdida de conducción del canal (tramo K-0+000 → K-104): FUENTE ÚNICA.
 *
 * Monitor Público calculaba  eficiencia = Q salida / Q entrada × 100  y Geo-Monitor calculaba
 * (Q entrada − Q salida) / Q entrada × 100, que es la PÉRDIDA con nombre de eficiencia (las dos tarjetas salían
 * intercambiadas). Ambos usan ahora esta función.
 *
 * Solo es válida de extremo a extremo: K-0 y K-104 con lectura fresca y gasto > 0. Si falta uno no se sustituye por
 * otra escala ni se inventa un 0 %: el resultado es null y la UI muestra S/D.
 */

export interface ExtremoTramo {
    /** Gasto en m³/s; null/undefined = sin dato. */
    gasto: number | null | undefined;
    /** ¿La lectura es reciente (STALE_MIN)? */
    fresca: boolean;
}

export interface ConduccionTramo {
    completo: boolean;
    /** Q salida / Q entrada × 100. */
    eficienciaPct: number | null;
    /** 100 − eficiencia. */
    perdidaPct: number | null;
    /** Q entrada − Q salida (m³/s). */
    perdidaM3s: number | null;
    /** Salida > entrada: no es una eficiencia real (aforos desfasados o error de lectura); revisar. */
    incoherente: boolean;
}

const util = (e: ExtremoTramo): e is { gasto: number; fresca: true } =>
    e.fresca && typeof e.gasto === 'number' && Number.isFinite(e.gasto) && e.gasto > 0;

export function conduccionTramo(entrada: ExtremoTramo, salida: ExtremoTramo): ConduccionTramo {
    if (!util(entrada) || !util(salida)) {
        return { completo: false, eficienciaPct: null, perdidaPct: null, perdidaM3s: null, incoherente: false };
    }
    const eficienciaPct = (salida.gasto / entrada.gasto) * 100;
    return {
        completo: true,
        eficienciaPct,
        perdidaPct: 100 - eficienciaPct,
        perdidaM3s: entrada.gasto - salida.gasto,
        incoherente: eficienciaPct > 100,
    };
}

/** Color semántico de la eficiencia (el estado se acompaña SIEMPRE de texto). */
export function etiquetaEficiencia(eficienciaPct: number | null): 'S/D' | 'Óptima' | 'Aceptable' | 'Baja' {
    if (eficienciaPct == null) return 'S/D';
    return eficienciaPct >= 90 ? 'Óptima' : eficienciaPct >= 75 ? 'Aceptable' : 'Baja';
}
