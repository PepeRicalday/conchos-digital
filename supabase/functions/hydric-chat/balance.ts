/**
 * balance — balance de masa por tramo entre escalas de CONTROL consecutivas, calculado en el servidor para que el
 * modelo lea el resultado y no haga aritmética. Mismos criterios que la aplicación (src/utils/balanceTramos.ts +
 * hydraulics.ts): eficiencia = (Q_salida + Q_tomas) / Q_entrada, bandas 95/90/80 %, "S/D nunca cero", las escalas de
 * referencia (K-64, K-94+200) no cortan tramos. Módulo PURO.
 *
 * Tomas desconocidas (consulta caída o sin reportes del día) NO equivalen a "cero tomas": con `tomas = null` el tramo
 * no se clasifica como fuga; solo se afirma lo que los dos caudales permiten (cota inferior de eficiencia).
 */

export type EstadoBalance = 'optimo' | 'atencion' | 'alerta' | 'critico' | 'anomalo' | 'cerrado' | 'sin_dato' | 'tomas_sd' | 'no_aplica';

export interface EscalaQ { nombre: string; km: number; gasto: number | null; referencia: boolean }
export interface Toma { nombre: string; km: number; caudal: number }

export interface TramoBalance {
    de: string;
    a: string;
    km_inicio: number;
    km_fin: number;
    q_entrada: number | null;
    q_salida: number | null;
    /** null = tomas desconocidas (S/D); 0 solo si se sabe que no hubo. */
    q_tomas: number | null;
    /** null si no hay dato, las tomas son desconocidas o el tramo es anómalo/cerrado (no se inventa una pérdida). */
    q_perdidas: number | null;
    /** Con tomas desconocidas: Q_entrada − Q_salida = tomas + pérdidas (cota superior de la pérdida). */
    q_tomas_mas_perdidas: number | null;
    eficiencia: number | null;
    estado: EstadoBalance;
}

/** Banda de eficiencia compartida con la aplicación (getEfficiencyStatus). */
export function clasificaEficiencia(eficiencia: number): 'optimo' | 'atencion' | 'alerta' | 'critico' {
    if (eficiencia >= 95) return 'optimo';
    if (eficiencia >= 90) return 'atencion';
    if (eficiencia >= 80) return 'alerta';
    return 'critico';
}

const r3 = (v: number) => Number(v.toFixed(3));

/** Suma de tomas del tramo [kmA, kmB); el último tramo incluye también el km final. */
export function tomasEntre(tomas: Toma[], kmA: number, kmB: number, incluyeFin: boolean): number {
    return tomas
        .filter((t) => t.km >= kmA && (incluyeFin ? t.km <= kmB : t.km < kmB))
        .reduce((a, t) => a + t.caudal, 0);
}

/** `tomas === null` → no se conocen las tomas (no es lo mismo que "no hubo tomas"). */
export function balanceTramos(escalas: EscalaQ[], tomas: Toma[] | null): TramoBalance[] {
    const control = escalas.filter((e) => !e.referencia && Number.isFinite(e.km)).sort((a, b) => a.km - b.km);
    const out: TramoBalance[] = [];
    for (let i = 0; i < control.length - 1; i++) {
        const e1 = control[i], e2 = control[i + 1];
        const qTomas = tomas == null ? null : r3(tomasEntre(tomas, e1.km, e2.km, i === control.length - 2));
        const base = { de: e1.nombre, a: e2.nombre, km_inicio: e1.km, km_fin: e2.km, q_tomas: qTomas, q_tomas_mas_perdidas: null as number | null };

        if (e1.gasto == null || e2.gasto == null) {
            out.push({ ...base, q_entrada: e1.gasto, q_salida: e2.gasto, q_perdidas: null, eficiencia: null, estado: 'sin_dato' });
            continue;
        }
        if (e1.gasto === 0) {
            out.push({ ...base, q_entrada: 0, q_salida: e2.gasto, q_perdidas: null, eficiencia: null, estado: 'cerrado' });
            continue;
        }

        if (qTomas == null) {
            // Sin tomas conocidas: solo se puede afirmar la cota inferior de eficiencia (Q_salida / Q_entrada).
            if (e2.gasto > e1.gasto) {
                out.push({ ...base, q_entrada: e1.gasto, q_salida: e2.gasto, q_perdidas: null, eficiencia: 100, estado: 'anomalo' });
                continue;
            }
            const minimo = (e2.gasto / e1.gasto) * 100;
            const seguro = minimo >= 95;    // aun sin tomas, la eficiencia real es ≥ 95 %
            out.push({
                ...base, q_entrada: e1.gasto, q_salida: e2.gasto, q_perdidas: null,
                q_tomas_mas_perdidas: r3(e1.gasto - e2.gasto),
                eficiencia: seguro ? Number(minimo.toFixed(2)) : null,
                estado: seguro ? 'optimo' : 'tomas_sd',
            });
            continue;
        }

        const contabilizado = e2.gasto + qTomas;
        if (contabilizado > e1.gasto) {
            // más salidas que entradas: error de medición o aportación lateral, no una fuga
            out.push({ ...base, q_entrada: e1.gasto, q_salida: e2.gasto, q_perdidas: null, eficiencia: 100, estado: 'anomalo' });
            continue;
        }
        const eficiencia = Math.min(100, (contabilizado / e1.gasto) * 100);
        out.push({
            ...base, q_entrada: e1.gasto, q_salida: e2.gasto,
            q_perdidas: r3(Math.max(0, e1.gasto - contabilizado)),
            eficiencia: Number(eficiencia.toFixed(2)),
            estado: clasificaEficiencia(eficiencia),
        });
    }
    return out;
}

export interface ResumenBalance { tramos: number; conDato: number; sinDato: number; tomasSd: number; cerrados: number; anomalos: number; fugas: number }

export function resumenBalance(t: TramoBalance[]): ResumenBalance {
    return {
        tramos: t.length,
        conDato: t.filter((b) => !['sin_dato', 'cerrado', 'anomalo', 'tomas_sd', 'no_aplica'].includes(b.estado)).length,
        sinDato: t.filter((b) => b.estado === 'sin_dato').length,
        tomasSd: t.filter((b) => b.estado === 'tomas_sd').length,
        cerrados: t.filter((b) => b.estado === 'cerrado').length,
        anomalos: t.filter((b) => b.estado === 'anomalo').length,
        fugas: t.filter((b) => b.estado === 'alerta' || b.estado === 'critico').length,
    };
}
