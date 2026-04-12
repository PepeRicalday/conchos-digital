/**
 * IEC — Índice de Estado del Canal (0–100)
 * Combina 4 componentes en un KPI único para gerencia.
 *
 *  Eficiencia hidráulica  30 pts  (Q_K104 / Q_K0)
 *  Coherencia de escalas  25 pts  (puntos_coherentes / total)
 *  Detección de fugas     25 pts  (1 - q_fuga / q_entrada)
 *  Escalas en crítico     20 pts  (penalización proporcional)
 */

export type IECSemaforo = 'VERDE' | 'AMARILLO' | 'ROJO';

export interface IECBreakdown {
    /** Índice global 0–100 */
    iec:              number;
    semaforo:         IECSemaforo;
    /** Puntos por componente */
    p_eficiencia:     number;   // 0–30
    p_coherencia:     number;   // 0–25
    p_fugas:          number;   // 0–25
    p_criticos:       number;   // 0–20
    /** Texto de estado para UI */
    texto:            string;
    /** Inputs usados (para debug/tooltip) */
    inputs: {
        eficiencia_pct:   number;
        coherencia_pct:   number | null;
        fuga_pct:         number | null;
        criticos_pct:     number | null;
    };
}

export interface IECInputs {
    /** Eficiencia de conducción presa→K104 en % */
    eficiencia:       number;
    /** Puntos de escala coherentes */
    n_coherentes:     number;
    /** Total de puntos evaluados */
    total_puntos:     number;
    /** Caudal de fuga detectada total (m³/s) — de fn_balance_hidrico_tramos */
    q_fuga_total:     number;
    /** Caudal de entrada al canal (m³/s) — referencia para % de fuga */
    q_entrada:        number;
    /** Número de escalas en zona CRÍTICA (nivel > 92% bordo libre) */
    escalas_criticas: number;
    /** Total de escalas con datos */
    total_escalas:    number;
}

export function calcIEC(inputs: IECInputs): IECBreakdown {
    const {
        eficiencia,
        n_coherentes, total_puntos,
        q_fuga_total, q_entrada,
        escalas_criticas, total_escalas,
    } = inputs;

    // Componente 1: Eficiencia hidráulica (30 pts)
    const p_ef = Math.min(30, Math.max(0, (eficiencia / 100) * 30));

    // Componente 2: Coherencia de escalas (25 pts)
    const p_coh = total_puntos > 0
        ? Math.min(25, Math.max(0, (n_coherentes / total_puntos) * 25))
        : 25; // Sin datos de coherencia → no penalizar

    // Componente 3: Fugas (25 pts)
    const fracFuga = q_entrada > 0 ? q_fuga_total / q_entrada : 0;
    const p_fugas  = Math.min(25, Math.max(0, 25 * (1 - Math.min(1, fracFuga))));

    // Componente 4: Escalas en estado crítico (20 pts)
    const fracCrit  = total_escalas > 0 ? escalas_criticas / total_escalas : 0;
    const p_criticos = Math.min(20, Math.max(0, 20 * (1 - fracCrit)));

    const iec = Math.round(p_ef + p_coh + p_fugas + p_criticos);

    const semaforo: IECSemaforo = iec >= 75 ? 'VERDE' : iec >= 50 ? 'AMARILLO' : 'ROJO';

    const texto = iec >= 75
        ? 'Sistema operando normalmente'
        : iec >= 50
        ? 'Sistema con anomalías — monitoreo reforzado'
        : 'Sistema en condición crítica — acción inmediata requerida';

    return {
        iec,
        semaforo,
        p_eficiencia: Math.round(p_ef  * 10) / 10,
        p_coherencia: Math.round(p_coh * 10) / 10,
        p_fugas:      Math.round(p_fugas   * 10) / 10,
        p_criticos:   Math.round(p_criticos * 10) / 10,
        texto,
        inputs: {
            eficiencia_pct:  Math.round(eficiencia * 10) / 10,
            coherencia_pct:  total_puntos > 0 ? Math.round((n_coherentes / total_puntos) * 1000) / 10 : null,
            fuga_pct:        q_entrada > 0 ? Math.round(fracFuga * 1000) / 10 : null,
            criticos_pct:    total_escalas > 0 ? Math.round(fracCrit * 1000) / 10 : null,
        },
    };
}

/** Colores de semáforo para UI */
export function iecColor(semaforo: IECSemaforo): string {
    return semaforo === 'VERDE' ? '#22c55e' : semaforo === 'AMARILLO' ? '#f59e0b' : '#ef4444';
}

/** Descripción corta de cada componente para tooltip */
export function iecComponentLabel(key: keyof Pick<IECBreakdown, 'p_eficiencia' | 'p_coherencia' | 'p_fugas' | 'p_criticos'>): string {
    const labels: Record<string, string> = {
        p_eficiencia: 'Eficiencia Q presa→K104 (máx 30)',
        p_coherencia: 'Coherencia de escalas (máx 25)',
        p_fugas:      'Ausencia de fugas detectadas (máx 25)',
        p_criticos:   'Escalas fuera de zona crítica (máx 20)',
    };
    return labels[key] ?? key;
}
