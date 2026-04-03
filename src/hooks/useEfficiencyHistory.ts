import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useMetadataStore } from '../store/useMetadataStore';

export type EstadoBalance = 'optimo' | 'atencion' | 'alerta' | 'critico' | 'sin_datos';

export interface EficienciaCell {
    eficiencia: number | null;
    estado: EstadoBalance;
    q_entrada: number;
    q_salida: number;
    q_tomas: number;
    q_fuga: number;
}

export interface EficienciaTramo {
    km_inicio: number;
    km_fin: number;
    escala_entrada: string;
    escala_salida: string;
}

export interface EfficiencyHistory {
    tramos: EficienciaTramo[];
    dias: string[];           // YYYY-MM-DD, ascending
    matrix: EficienciaCell[][];  // [tramoidx][dayidx]
    loading: boolean;
}

function clasificarEstado(eficiencia: number | null): EstadoBalance {
    if (eficiencia === null) return 'sin_datos';
    if (eficiencia >= 95) return 'optimo';
    if (eficiencia >= 90) return 'atencion';
    if (eficiencia >= 85) return 'alerta';
    return 'critico';
}

// Genera array de los últimos N días en formato YYYY-MM-DD (local Chihuahua)
function lastNDays(n: number): string[] {
    return Array.from({ length: n }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (n - 1 - i));
        return d.toLocaleDateString('en-CA'); // YYYY-MM-DD
    });
}

export function useEfficiencyHistory(days = 7): EfficiencyHistory {
    const [history, setHistory] = useState<EfficiencyHistory>({
        tramos: [],
        dias: [],
        matrix: [],
        loading: true,
    });

    useEffect(() => {
        let cancelled = false;

        async function fetch() {
            const metaStore = useMetadataStore.getState();
            if (!metaStore.last_fetched) await metaStore.fetchMetadata();

            const escalas = metaStore.escalas
                .filter(e => e.activa && e.km >= 0 && e.km <= 104)
                .sort((a, b) => Number(a.km) - Number(b.km));

            const puntos = metaStore.puntos_entrega;

            if (escalas.length < 2) {
                if (!cancelled) setHistory(h => ({ ...h, loading: false }));
                return;
            }

            const dias = lastNDays(days);
            const fechaInicio = dias[0];
            const fechaFin = dias[dias.length - 1];

            // Fetch lecturas + reportes en paralelo para el rango completo
            const [{ data: lecturas }, { data: reportes }] = await Promise.all([
                supabase
                    .from('lecturas_escalas')
                    .select('escala_id, fecha, gasto_calculado_m3s')
                    .gte('fecha', fechaInicio)
                    .lte('fecha', fechaFin)
                    .not('gasto_calculado_m3s', 'is', null)
                    .gt('gasto_calculado_m3s', 0),
                supabase
                    .from('reportes_diarios')
                    .select('punto_id, fecha, caudal_promedio_m3s')
                    .gte('fecha', fechaInicio)
                    .lte('fecha', fechaFin)
                    .in('estado', ['inicio', 'continua', 'reabierto', 'modificacion'])
                    .is('hora_cierre', null)
                    .gt('caudal_promedio_m3s', 0),
            ]);

            if (cancelled) return;

            // Índice lecturas: fecha → escala_id → gasto (última lectura del día)
            const lectIdx: Record<string, Record<string, number>> = {};
            for (const l of lecturas ?? []) {
                if (!lectIdx[l.fecha]) lectIdx[l.fecha] = {};
                // Si hay varias lecturas del mismo día, conservar la de mayor gasto (más representativa)
                const prev = lectIdx[l.fecha][l.escala_id] ?? 0;
                if ((l.gasto_calculado_m3s ?? 0) > prev) {
                    lectIdx[l.fecha][l.escala_id] = Number(l.gasto_calculado_m3s);
                }
            }

            // Índice reportes: fecha → punto_id → caudal
            const repIdx: Record<string, Record<string, number>> = {};
            for (const r of reportes ?? []) {
                if (!repIdx[r.fecha]) repIdx[r.fecha] = {};
                repIdx[r.fecha][r.punto_id] = Number(r.caudal_promedio_m3s);
            }

            // Construir tramos como pares de escalas consecutivas
            const tramos: EficienciaTramo[] = [];
            for (let i = 0; i < escalas.length - 1; i++) {
                tramos.push({
                    km_inicio: Number(escalas[i].km),
                    km_fin: Number(escalas[i + 1].km),
                    escala_entrada: escalas[i].nombre,
                    escala_salida: escalas[i + 1].nombre,
                });
            }

            // Matriz [tramoidx][dayidx]
            const matrix: EficienciaCell[][] = tramos.map((tramo, ti) => {
                return dias.map(fecha => {
                    const dayLect = lectIdx[fecha] ?? {};
                    const qEnt = dayLect[escalas[ti].id] ?? null;
                    const qSal = dayLect[escalas[ti + 1].id] ?? null;

                    if (qEnt === null || qSal === null || qEnt <= 0) {
                        return { eficiencia: null, estado: 'sin_datos', q_entrada: 0, q_salida: 0, q_tomas: 0, q_fuga: 0 };
                    }

                    // Sumar tomas registradas en el km range del tramo
                    const dayRep = repIdx[fecha] ?? {};
                    let qTomas = 0;
                    for (const p of puntos) {
                        const kmP = Number(p.km);
                        if (kmP > tramo.km_inicio && kmP <= tramo.km_fin) {
                            qTomas += dayRep[p.id] ?? 0;
                        }
                    }

                    const eficiencia = ((qSal + qTomas) / qEnt) * 100;
                    const qFuga = qEnt - qSal - qTomas;

                    return {
                        eficiencia: Math.min(100, Math.round(eficiencia * 10) / 10),
                        estado: clasificarEstado(eficiencia),
                        q_entrada: qEnt,
                        q_salida: qSal,
                        q_tomas: qTomas,
                        q_fuga: Math.round(qFuga * 1000) / 1000,
                    };
                });
            });

            if (!cancelled) {
                setHistory({ tramos, dias, matrix, loading: false });
            }
        }

        fetch().catch(err => {
            console.error('[useEfficiencyHistory]', err);
            if (!cancelled) setHistory(h => ({ ...h, loading: false }));
        });

        return () => { cancelled = true; };
    }, [days]);

    return history;
}
