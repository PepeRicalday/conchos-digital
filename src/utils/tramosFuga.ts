/**
 * tramosFuga — normaliza las filas de la vista dashboard_vulnerabilidad_fugas (sin React ni Supabase).
 *
 * La vista parte el canal en TODAS las escalas y calcula con la última lectura de cada una, sin frescura ni
 * distinción entre «0» y «sin dato». Resultado real observado: eficiencias de 306 %, 3037 %, o 100 % con gasto 0.
 * Regla "S/D nunca cero": un tramo solo tiene balance si entra agua (> 0) y la eficiencia cae en (0, 100]; una
 * «pérdida negativa» es ganancia no medida (tomas, aportes o escalas de referencia), no una pérdida.
 * Antes el hook leía columnas con otro nombre (q_perdida vs q_perdida_m3s) y nunca recibía los valores.
 */

export interface SegmentLoss {
    tramo_inicio: string;
    tramo_fin: string;
    km_inicio: number;
    km_fin: number;
    /** null = S/D (sin balance válido en el tramo). */
    q_entrada: number | null;
    q_salida: number | null;
    q_entregado: number | null;
    q_perdida: number | null;
    eficiencia_pct: number | null;
    estatus: string;
}

export interface FilaVistaFugas {
    escala_inicio_nombre?: string | null;
    escala_fin_nombre?: string | null;
    km_inicio?: number | string | null;
    km_fin?: number | string | null;
    q_entrada_m3s?: number | string | null;
    q_salida_m3s?: number | string | null;
    q_extracciones_m3s?: number | string | null;
    q_perdida_m3s?: number | string | null;
    eficiencia_pct?: number | string | null;
    estatus_hidraulico?: string | null;
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function normalizaTramoFuga(f: FilaVistaFugas): SegmentLoss {
    const qEntrada = num(f.q_entrada_m3s);
    const qSalida = num(f.q_salida_m3s);
    const qPerdidaVista = num(f.q_perdida_m3s);
    const efVista = num(f.eficiencia_pct);

    // Balance válido: entra agua, la eficiencia es un porcentaje real y no hay «pérdida negativa».
    const valido = qEntrada != null && qEntrada > 0
        && efVista != null && efVista > 0 && efVista <= 100
        && (qPerdidaVista == null || qPerdidaVista >= 0);

    return {
        tramo_inicio: f.escala_inicio_nombre ?? '',
        tramo_fin: f.escala_fin_nombre ?? '',
        km_inicio: num(f.km_inicio) ?? NaN,
        km_fin: num(f.km_fin) ?? NaN,
        q_entrada: qEntrada,
        q_salida: qSalida,
        q_entregado: num(f.q_extracciones_m3s),
        q_perdida: valido ? qPerdidaVista : null,
        eficiencia_pct: valido ? efVista : null,
        estatus: f.estatus_hidraulico ?? '',
    };
}
