/**
 * usePredictiveBalance
 * Balance hídrico predictivo con detección temprana de anomalías.
 *
 * Modelo: compara la eficiencia actual del día (lecturas disponibles hasta
 * este momento) contra la línea base de los últimos 7 días.
 *
 * Si la eficiencia actual se desvía significativamente del comportamiento
 * histórico, genera una alerta ANTES de que el día cierre con pérdidas.
 *
 * Alertas generadas:
 *   ANOMALÍA_FUGA   — eficiencia hoy < baseline − 8pp → warning/critical
 *   FUGA_ACTIVA     — eficiencia hoy < 85%            → critical
 *   SOBRECAPACIDAD  — Q_entrada > capacidad_diseño     → warning
 *
 * Retorna Alert[] compatible con el componente AlertList del Dashboard.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useMetadataStore } from '../store/useMetadataStore';
import type { Alert } from '../components/AlertList';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lastNDays(n: number): string[] {
    return Array.from({ length: n }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (n - 1 - i));
        return d.toLocaleDateString('en-CA');
    });
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const s = [...values].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface TramoSnapshot {
    km_inicio: number;
    km_fin: number;
    label: string;           // e.g. "K0→K23"
    eficiencia_hoy: number | null;
    eficiencia_baseline: number | null;
    delta_pp: number | null; // porcentaje-puntos de desviación
    q_entrada_hoy: number;
    capacidad_diseno: number;
    estado: 'normal' | 'atencion' | 'alerta' | 'critico';
}

export interface PredictiveBalanceResult {
    alertas: Alert[];
    tramos: TramoSnapshot[];
    loading: boolean;
    hora_calculo: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePredictiveBalance(): PredictiveBalanceResult {
    const [state, setState] = useState<PredictiveBalanceResult>({
        alertas: [],
        tramos: [],
        loading: true,
        hora_calculo: null,
    });

    useEffect(() => {
        let cancelled = false;

        async function run() {
            try {
                const metaStore = useMetadataStore.getState();
                if (!metaStore.last_fetched) {
                    try {
                        await metaStore.fetchMetadata();
                    } catch {
                        // Metadatos no disponibles — reintentará en el siguiente ciclo
                        if (!cancelled) setState(s => ({ ...s, loading: false }));
                        return;
                    }
                }

                const escalas = metaStore.escalas
                    .filter(e => e.activa && Number(e.km) >= 0 && Number(e.km) <= 104)
                    .sort((a, b) => Number(a.km) - Number(b.km));

                const puntos = metaStore.puntos_entrega;

                if (escalas.length < 2) {
                    if (!cancelled) setState(s => ({ ...s, loading: false }));
                    return;
                }

                const dias8 = lastNDays(8); // hoy + 7 días de baseline
                const hoy   = dias8[dias8.length - 1];
                const baseline7 = dias8.slice(0, 7);

                // Fetch paralelo: lecturas + reportes + perfil
                const [{ data: lecturas }, { data: reportes }, { data: perfil }] = await Promise.all([
                    supabase
                        .from('lecturas_escalas')
                        .select('escala_id, fecha, gasto_calculado_m3s')
                        .gte('fecha', dias8[0])
                        .lte('fecha', hoy)
                        .not('gasto_calculado_m3s', 'is', null)
                        .gt('gasto_calculado_m3s', 0),
                    supabase
                        .from('reportes_diarios')
                        .select('punto_id, fecha, caudal_promedio_m3s')
                        .gte('fecha', dias8[0])
                        .lte('fecha', hoy)
                        .in('estado', ['inicio', 'continua', 'reabierto', 'modificacion'])
                        .is('hora_cierre', null)
                        .gt('caudal_promedio_m3s', 0),
                    supabase
                        .from('perfil_hidraulico_canal')
                        .select('km_inicio, km_fin, capacidad_diseno_m3s')
                        .order('km_inicio'),
                ]);

                if (cancelled) return;

                // Índice lecturas: fecha → escala_id → max gasto del día
                const lectIdx: Record<string, Record<string, number>> = {};
                for (const l of lecturas ?? []) {
                    if (!lectIdx[l.fecha]) lectIdx[l.fecha] = {};
                    const prev = lectIdx[l.fecha][l.escala_id] ?? 0;
                    if (Number(l.gasto_calculado_m3s) > prev) {
                        lectIdx[l.fecha][l.escala_id] = Number(l.gasto_calculado_m3s);
                    }
                }

                // Índice reportes: fecha → punto_id → caudal
                const repIdx: Record<string, Record<string, number>> = {};
                for (const r of reportes ?? []) {
                    if (!repIdx[r.fecha]) repIdx[r.fecha] = {};
                    repIdx[r.fecha][r.punto_id] = Number(r.caudal_promedio_m3s);
                }

                // Función de eficiencia para una fecha + tramo
                const calcEf = (
                    fecha: string,
                    escEntId: string,
                    escSalId: string,
                    kmIni: number,
                    kmFin: number,
                ): number | null => {
                    const dayL = lectIdx[fecha] ?? {};
                    const qEnt = dayL[escEntId] ?? null;
                    const qSal = dayL[escSalId] ?? null;
                    if (!qEnt || !qSal || qEnt <= 0) return null;

                    const dayR = repIdx[fecha] ?? {};
                    let qTomas = 0;
                    for (const p of puntos) {
                        const km = Number(p.km);
                        if (km > kmIni && km <= kmFin) qTomas += dayR[p.id] ?? 0;
                    }
                    const ef = ((qSal + qTomas) / qEnt) * 100;
                    return Math.min(100, ef);
                };

                // Construir tramos y calcular snapshots
                const tramos: TramoSnapshot[] = [];
                const alertas: Alert[] = [];

                for (let i = 0; i < escalas.length - 1; i++) {
                    const escEnt = escalas[i];
                    const escSal = escalas[i + 1];
                    const kmIni  = Number(escEnt.km);
                    const kmFin  = Number(escSal.km);
                    const label  = `K${kmIni}→K${kmFin}`;

                    // Capacidad de diseño del tramo (primer tramo del perfil que lo contenga)
                    const tramoP = perfil?.find(t => Number(t.km_inicio) <= kmIni && Number(t.km_fin) >= kmFin);
                    const capDis = tramoP ? Number(tramoP.capacidad_diseno_m3s) : 0;

                    // Eficiencia hoy
                    const efHoy = calcEf(hoy, escEnt.id, escSal.id, kmIni, kmFin);

                    // Baseline: mediana de los 7 días anteriores (filtrando nulos)
                    const efBaseline7 = baseline7
                        .map(f => calcEf(f, escEnt.id, escSal.id, kmIni, kmFin))
                        .filter((v): v is number => v !== null);
                    const efBaseline = efBaseline7.length > 0 ? median(efBaseline7) : null;

                    const delta = efHoy !== null && efBaseline !== null
                        ? efHoy - efBaseline
                        : null;

                    // Q entrada hoy (para sobrecapacidad)
                    const qEntHoy = lectIdx[hoy]?.[escEnt.id] ?? 0;

                    // Clasificar estado del tramo
                    let estadoTramo: TramoSnapshot['estado'] = 'normal';
                    if (efHoy !== null) {
                        if (efHoy < 85)                              estadoTramo = 'critico';
                        else if (efHoy < 90)                        estadoTramo = 'alerta';
                        else if (delta !== null && delta < -8)       estadoTramo = 'atencion';
                    }

                    tramos.push({ km_inicio: kmIni, km_fin: kmFin, label, eficiencia_hoy: efHoy, eficiencia_baseline: efBaseline, delta_pp: delta, q_entrada_hoy: qEntHoy, capacidad_diseno: capDis, estado: estadoTramo });

                    // Generar alertas
                    if (efHoy === null) continue; // sin datos hoy, no alertar

                    // Alerta 1: fuga activa (eficiencia hoy < 85%)
                    if (efHoy < 85) {
                        const qPerdida = qEntHoy > 0
                            ? (qEntHoy * (1 - efHoy / 100)).toFixed(2)
                            : '?';
                        alertas.push({
                            id: `pred-fuga-${kmIni}`,
                            type: 'critical',
                            title: `Fuga Activa — Tramo ${label}`,
                            message: `Eficiencia actual ${efHoy.toFixed(1)}%${efBaseline !== null ? ` (línea base ${efBaseline.toFixed(1)}%)` : ''}. Pérdida estimada: ${qPerdida} m³/s.`,
                            timestamp: 'Predicción Hoy',
                        });
                        continue; // no duplicar con alerta de anomalía
                    }

                    // Alerta 2: anomalía de caída respecto a baseline
                    if (delta !== null && delta < -8 && efBaseline7.length >= 3) {
                        const tipo = delta < -15 ? 'critical' : 'warning';
                        alertas.push({
                            id: `pred-anomalia-${kmIni}`,
                            type: tipo,
                            title: `Anomalía de Balance — Tramo ${label}`,
                            message: `Eficiencia actual ${efHoy.toFixed(1)}% vs base ${efBaseline!.toFixed(1)}% (${delta.toFixed(1)} pp). Revisar extracciones no registradas.`,
                            timestamp: 'Predicción Hoy',
                        });
                    }

                    // Alerta 3: sobrecapacidad
                    if (capDis > 0 && qEntHoy > capDis * 1.05) {
                        alertas.push({
                            id: `pred-cap-${kmIni}`,
                            type: 'warning',
                            title: `Sobrecapacidad — Tramo ${label}`,
                            message: `Q entrada ${qEntHoy.toFixed(2)} m³/s supera capacidad de diseño ${capDis.toFixed(2)} m³/s (+${(((qEntHoy / capDis) - 1) * 100).toFixed(0)}%).`,
                            timestamp: 'Predicción Hoy',
                        });
                    }
                }

                if (!cancelled) {
                    setState({
                        alertas,
                        tramos,
                        loading: false,
                        hora_calculo: new Date().toISOString(),
                    });
                }
            } catch (err: any) {
                console.error('[usePredictiveBalance]', err);
                if (!cancelled) setState(s => ({ ...s, loading: false }));
            }
        }

        run();

        // Recalcular cada 15 minutos (datos de escalas se actualizan cada turno)
        const interval = setInterval(run, 15 * 60 * 1000);
        return () => { cancelled = true; clearInterval(interval); };
    }, []);

    return state;
}
