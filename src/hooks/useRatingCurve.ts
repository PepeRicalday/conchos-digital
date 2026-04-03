/**
 * useRatingCurve
 * Para cada punto de aforo activo: obtiene los pares (tirante, gasto) históricos
 * de la tabla `aforos` y genera la curva teórica Manning con la geometría del tramo
 * correspondiente de `perfil_hidraulico_canal`.
 *
 * Retorna un array de RatingCurvePoint por punto de control, ordenados por |delta_pct|
 * para que los puntos más desviados aparezcan primero.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';


// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface RatingMeasurement {
    fecha:   string;
    tirante: number;   // m
    gasto:   number;   // m³/s
    froude:  number | null;
}

export interface RatingCurveData {
    punto_control_id: string;
    nombre_punto: string;
    km_punto: number | null;
    // Datos de campo (scatter)
    mediciones: RatingMeasurement[];
    // Curva teórica Manning (tirante 0.1→4m, paso 0.1m)
    curva_teorica: { tirante: number; gasto: number }[];
    // Parámetros de geometría usados
    plantilla_m: number;
    talud_z:     number;
    rugosidad_n: number;
    pendiente_s0: number;
    // Ajuste: R² entre mediciones y curva teórica
    r2: number | null;
}

export interface RatingCurveResult {
    puntos:   RatingCurveData[];
    loading:  boolean;
    error:    string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function manningQ(y: number, b: number, z: number, n: number, S0: number): number {
    if (y <= 0) return 0;
    const A = (b + z * y) * y;
    const P = b + 2 * y * Math.sqrt(1 + z * z);
    if (P <= 0) return 0;
    const R = A / P;
    return (1 / n) * A * Math.pow(R, 2 / 3) * Math.sqrt(S0);
}

function calcR2(measured: { tirante: number; gasto: number }[], b: number, z: number, n: number, S0: number): number | null {
    if (measured.length < 2) return null;
    const yMean = measured.reduce((s, m) => s + m.gasto, 0) / measured.length;
    let ssTot = 0, ssRes = 0;
    for (const m of measured) {
        const predicted = manningQ(m.tirante, b, z, n, S0);
        ssTot += (m.gasto - yMean) ** 2;
        ssRes += (m.gasto - predicted) ** 2;
    }
    if (ssTot === 0) return null;
    return Math.max(0, Math.min(1, 1 - ssRes / ssTot));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useRatingCurve(diasAtras = 365): RatingCurveResult {
    const [result, setResult] = useState<RatingCurveResult>({
        puntos: [],
        loading: true,
        error: null,
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
                        .select('punto_control_id, fecha, tirante_calculo_m, gasto_calculado_m3s, froude, plantilla_m, talud_z')
                        .gte('fecha', fechaDesde)
                        .not('tirante_calculo_m', 'is', null)
                        .not('gasto_calculado_m3s', 'is', null)
                        .gt('tirante_calculo_m', 0)
                        .gt('gasto_calculado_m3s', 0)
                        .order('fecha', { ascending: true }),
                    supabase
                        .from('aforos_control')
                        .select('id, nombre_punto'),
                    supabase
                        .from('perfil_hidraulico_canal')
                        .select('km_inicio, km_fin, plantilla_m, talud_z, rugosidad_n, pendiente_s0')
                        .order('km_inicio'),
                ]);

                if (errAforos) throw errAforos;
                if (cancelled) return;

                // Índice: punto_control_id → nombre + km
                const controlMeta: Record<string, { nombre: string; km: number | null }> = {};
                for (const ac of afoControlDB ?? []) {
                    const m = ac.nombre_punto.match(/[Kk][-_ ]?(\d+(?:\.\d+)?)/);
                    controlMeta[ac.id] = {
                        nombre: ac.nombre_punto,
                        km:     m ? Number(m[1]) : null,
                    };
                }

                // Agrupar mediciones por punto_control_id
                const grupos: Record<string, RatingMeasurement[]> = {};
                // Guardar geometría del aforo para usar en curva teórica (toma del primer aforo)
                const geomAforo: Record<string, { plantilla_m: number; talud_z: number }> = {};

                for (const af of aforosDB ?? []) {
                    const pid = af.punto_control_id;
                    if (!grupos[pid]) grupos[pid] = [];
                    grupos[pid].push({
                        fecha:   af.fecha,
                        tirante: Number(af.tirante_calculo_m),
                        gasto:   Number(af.gasto_calculado_m3s),
                        froude:  af.froude != null ? Number(af.froude) : null,
                    });
                    if (!geomAforo[pid]) {
                        geomAforo[pid] = {
                            plantilla_m: Number(af.plantilla_m) || 8,
                            talud_z:     Number(af.talud_z)     || 1.5,
                        };
                    }
                }

                // Función para encontrar tramo del perfil dado un km
                const findPerfil = (km: number | null) => {
                    if (km === null || !perfilDB?.length) return null;
                    return perfilDB.find(t => Number(t.km_inicio) <= km && Number(t.km_fin) >= km)
                        ?? perfilDB[0];
                };

                // Construir resultado por punto
                const puntos: RatingCurveData[] = Object.entries(grupos)
                    .filter(([, meds]) => meds.length >= 2)
                    .map(([pid, meds]) => {
                        const meta   = controlMeta[pid];
                        const kmPto  = meta?.km ?? null;
                        const perfil = findPerfil(kmPto);
                        const geom   = geomAforo[pid];

                        const b  = perfil ? Number(perfil.plantilla_m)  : geom.plantilla_m;
                        const z  = perfil ? Number(perfil.talud_z)       : geom.talud_z;
                        const n  = perfil ? Number(perfil.rugosidad_n)   : 0.015;
                        const S0 = perfil ? Number(perfil.pendiente_s0)  : 0.00016;

                        // Curva teórica: barrido de tirante 0.05 a 4.0 m en pasos de 0.05
                        const curva_teorica = Array.from({ length: 80 }, (_, i) => {
                            const y = (i + 1) * 0.05;
                            return { tirante: +y.toFixed(2), gasto: +manningQ(y, b, z, n, S0).toFixed(3) };
                        });

                        const r2 = calcR2(meds, b, z, n, S0);

                        return {
                            punto_control_id: pid,
                            nombre_punto: meta?.nombre ?? pid,
                            km_punto:     kmPto,
                            mediciones:   meds,
                            curva_teorica,
                            plantilla_m:  b,
                            talud_z:      z,
                            rugosidad_n:  n,
                            pendiente_s0: S0,
                            r2,
                        };
                    })
                    // Ordenar: peor R² primero (más necesitan revisión)
                    .sort((a, b) => {
                        if (a.r2 === null) return 1;
                        if (b.r2 === null) return -1;
                        return a.r2 - b.r2;
                    });

                if (!cancelled) {
                    setResult({ puntos, loading: false, error: null });
                }
            } catch (err: any) {
                if (!cancelled) setResult(r => ({ ...r, loading: false, error: err.message }));
            }
        }

        run();
        return () => { cancelled = true; };
    }, [diasAtras]);

    return result;
}
