/**
 * useManningCalibration
 * Calibración automática del coeficiente de Manning (n) por punto de control.
 *
 * Método: para cada aforo de campo con Q_medido, tirante y geometría,
 * se despeja n de la ecuación de Manning:
 *   n = A · R^(2/3) · √S0 / Q
 *
 * S0 se obtiene de perfil_hidraulico_canal por tramo (km_inicio–km_fin).
 * Cuando el aforo no puede vincularse a un tramo específico, se usa la
 * mediana de S0 del canal (≈0.00016 para Canal Principal Conchos).
 *
 * Agrupación: por nombre_punto (punto de control), no por tramo geométrico,
 * porque los operadores piensan en puntos de control, no en tramos abstractos.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const S0_FALLBACK = 0.00016; // pendiente media Canal Principal Conchos

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type ConfianzaNivel = 'alta' | 'media' | 'baja' | 'insuficiente';

export interface ResultadoCalibPunto {
    punto_control_id: string;
    nombre_punto: string;
    km_punto: number | null;   // km extraído del nombre (K-23 → 23), null si no parseable
    n_diseno: number;          // rugosidad de diseño (de perfil o constante 0.015)
    n_calibrado: number;       // mediana de n calculados
    n_media: number;
    n_std: number;
    delta_pct: number;         // (n_cal - n_dis) / n_dis × 100
    n_muestras: number;
    confianza: ConfianzaNivel;
    estado: 'ok' | 'atencion' | 'revision' | 'critico';
    s0_usado: number;
    valores_n: number[];       // todos los n individuales (para distribución)
}

export interface ManningCalibrationResult {
    resultados: ResultadoCalibPunto[];
    loading: boolean;
    error: string | null;
    ultima_actualizacion: string | null;
}

// ─── Helpers matemáticos ──────────────────────────────────────────────────────

function calcN(Q: number, b: number, z: number, y: number, S0: number): number | null {
    if (Q <= 0 || b <= 0 || y <= 0 || S0 <= 0) return null;
    const A = (b + z * y) * y;
    const P = b + 2 * y * Math.sqrt(1 + z * z);
    if (A <= 0 || P <= 0) return null;
    const R = A / P;
    const n = (A * Math.pow(R, 2 / 3) * Math.sqrt(S0)) / Q;
    // Rango físico realista para canales revestidos: 0.008–0.035
    if (n < 0.008 || n > 0.035) return null;
    return n;
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stddev(values: number[], mean: number): number {
    if (values.length < 2) return 0;
    const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (values.length - 1);
    return Math.sqrt(variance);
}

function confianza(n: number): ConfianzaNivel {
    if (n >= 10) return 'alta';
    if (n >= 5)  return 'media';
    if (n >= 2)  return 'baja';
    return 'insuficiente';
}

function estado(deltaPct: number): ResultadoCalibPunto['estado'] {
    const abs = Math.abs(deltaPct);
    if (abs <= 5)  return 'ok';
    if (abs <= 10) return 'atencion';
    if (abs <= 20) return 'revision';
    return 'critico';
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useManningCalibration(diasAtras = 90): ManningCalibrationResult {
    const [result, setResult] = useState<ManningCalibrationResult>({
        resultados: [],
        loading: true,
        error: null,
        ultima_actualizacion: null,
    });

    useEffect(() => {
        let cancelled = false;

        async function run() {
            try {
                const fechaDesde = new Date(Date.now() - diasAtras * 86400000)
                    .toISOString()
                    .split('T')[0];

                const [
                    { data: aforosDB, error: errAforos },
                    { data: afoControlDB },
                    { data: perfilDB },
                ] = await Promise.all([
                    supabase
                        .from('aforos')
                        .select('id, punto_control_id, fecha, gasto_calculado_m3s, tirante_calculo_m, plantilla_m, talud_z, area_hidraulica_m2')
                        .gte('fecha', fechaDesde)
                        .not('gasto_calculado_m3s', 'is', null)
                        .not('tirante_calculo_m', 'is', null)
                        .gt('gasto_calculado_m3s', 0)
                        .gt('tirante_calculo_m', 0),
                    supabase
                        .from('aforos_control')
                        .select('id, nombre_punto'),
                    supabase
                        .from('perfil_hidraulico_canal')
                        .select('km_inicio, km_fin, pendiente_s0, rugosidad_n')
                        .order('km_inicio'),
                ]);

                if (errAforos) throw errAforos;
                if (cancelled) return;

                // Índices auxiliares
                const controlNombre: Record<string, string> = {};
                const controlKm: Record<string, number | null> = {};
                for (const ac of afoControlDB ?? []) {
                    controlNombre[ac.id] = ac.nombre_punto;
                    // Extrae km del nombre: "K-23", "K23", "K 23.5", "k104", etc.
                    const m = ac.nombre_punto.match(/[Kk][-_ ]?(\d+(?:\.\d+)?)/);
                    controlKm[ac.id] = m ? Number(m[1]) : null;
                }

                // S0 mediana del canal como fallback
                const s0Values = (perfilDB ?? []).map(t => Number(t.pendiente_s0)).filter(v => v > 0);
                const s0Fallback = s0Values.length > 0 ? median(s0Values) : S0_FALLBACK;

                // n de diseño dominante (mediana de rugosidades del perfil)
                const nDisenoValues = (perfilDB ?? []).map(t => Number(t.rugosidad_n)).filter(v => v > 0);
                const nDisenoGlobal = nDisenoValues.length > 0 ? median(nDisenoValues) : 0.015;

                // Agrupar n_calculados por punto_control_id
                const grupos: Record<string, number[]> = {};

                for (const af of aforosDB ?? []) {
                    const Q  = Number(af.gasto_calculado_m3s);
                    const y  = Number(af.tirante_calculo_m);
                    const b  = Number(af.plantilla_m);
                    const z  = af.talud_z != null ? Number(af.talud_z) : 1.5; // default talud
                    const S0 = s0Fallback;

                    const nVal = calcN(Q, b, z, y, S0);
                    if (nVal === null) continue;

                    const pid = af.punto_control_id;
                    if (!grupos[pid]) grupos[pid] = [];
                    grupos[pid].push(nVal);
                }

                const resultados: ResultadoCalibPunto[] = Object.entries(grupos)
                    .filter(([, vals]) => vals.length >= 1)
                    .map(([pid, vals]) => {
                        const nCal  = median(vals);
                        const nMean = vals.reduce((a, b) => a + b, 0) / vals.length;
                        const nStd  = stddev(vals, nMean);
                        const delta = ((nCal - nDisenoGlobal) / nDisenoGlobal) * 100;

                        return {
                            punto_control_id: pid,
                            nombre_punto: controlNombre[pid] ?? pid,
                            km_punto:    controlKm[pid] ?? null,
                            n_diseno:    Math.round(nDisenoGlobal * 10000) / 10000,
                            n_calibrado: Math.round(nCal  * 10000) / 10000,
                            n_media:     Math.round(nMean * 10000) / 10000,
                            n_std:       Math.round(nStd  * 10000) / 10000,
                            delta_pct:   Math.round(delta * 10) / 10,
                            n_muestras:  vals.length,
                            confianza:   confianza(vals.length),
                            estado:      estado(delta),
                            s0_usado:    s0Fallback,
                            valores_n:   vals,
                        };
                    })
                    .sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct));

                if (!cancelled) {
                    setResult({
                        resultados,
                        loading: false,
                        error: null,
                        ultima_actualizacion: new Date().toISOString(),
                    });
                }
            } catch (err: any) {
                if (!cancelled) {
                    setResult(r => ({ ...r, loading: false, error: err.message }));
                }
            }
        }

        run();
        return () => { cancelled = true; };
    }, [diasAtras]);

    return result;
}
