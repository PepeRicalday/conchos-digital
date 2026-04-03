import { useState, useEffect, useMemo, useRef } from 'react';
import { BarChart3, AlertTriangle, Droplets, TrendingUp, ArrowDown, FlaskConical, TrendingDown, FileText, Printer } from 'lucide-react';
import ManningCalibrador from '../components/ManningCalibrador';
import RatingCurve from '../components/RatingCurve';
import { supabase } from '../lib/supabase';
import { useFecha } from '../context/FechaContext';
import { calculateSectionBalance, manningFlow, getEfficiencyStatus, type PerfilTramo, type BalanceTramo } from '../utils/hydraulics';
import EfficiencyGauge from '../components/EfficiencyGauge';
import { usePredictiveBalance } from '../hooks/usePredictiveBalance';
import './BalanceHidraulico.css';

interface EscalaData {
    escala_id: string;
    nombre: string;
    km: number;
    nivel_actual: number;
    gasto_calculado: number;
    seccion_nombre: string;
}

interface TomaActiva {
    punto_id: string;
    nombre: string;
    km: number;
    caudal: number;
}

// ─── Reporte Ejecutivo Diario ─────────────────────────────────────────────────

interface ReporteProps {
    fecha: string;
    balanceData: BalanceTramo[];
}

const ReporteEjecutivo = ({ fecha, balanceData }: ReporteProps) => {
    const printRef = useRef<HTMLDivElement>(null);
    const { alertas, tramos, loading: loadingPred } = usePredictiveBalance();

    const efGlobal = useMemo(() => {
        if (!balanceData.length) return null;
        const first = balanceData[0];
        const last  = balanceData[balanceData.length - 1];
        if (!first?.q_entrada || first.q_entrada <= 0) return null;
        const qSalida = last?.q_salida ?? 0;
        const qTomas  = balanceData.reduce((s, t) => s + (t.q_tomas ?? 0), 0);
        return Math.min(100, ((qSalida + qTomas) / first.q_entrada) * 100);
    }, [balanceData]);

    const anomalias = tramos.filter(t => t.estado === 'critico' || t.estado === 'alerta');
    const alertasCrit = alertas.filter(a => a.type === 'critical');

    const handlePrint = () => window.print();

    return (
        <div className="mt-8 pt-8 border-t border-white/5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <FileText size={16} className="text-indigo-400" />
                    <h3 className="text-sm font-black text-white uppercase tracking-tight">
                        Reporte Ejecutivo Diario
                    </h3>
                </div>
                <button
                    type="button"
                    onClick={handlePrint}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[9px] font-black uppercase tracking-widest transition-all active:scale-95"
                >
                    <Printer size={11} /> Imprimir / PDF
                </button>
            </div>

            <div ref={printRef} className="reporte-print-area space-y-4">
                {/* Encabezado de impresión */}
                <div className="print-header hidden print:block mb-4">
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
                        Canal Principal Conchos — Reporte de Balance Hídrico
                    </p>
                    <p className="text-[10px] text-slate-600 font-mono">
                        Fecha: {fecha} · Generado: {new Date().toLocaleString('es-MX')}
                    </p>
                </div>

                {/* KPIs globales */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-slate-950/50 border border-white/5 rounded-xl p-3">
                        <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Fecha</p>
                        <p className="text-sm font-black text-white font-mono mt-1">{fecha}</p>
                    </div>
                    <div className={`rounded-xl p-3 border ${efGlobal !== null && efGlobal >= 90 ? 'bg-emerald-950/30 border-emerald-900/30' : efGlobal !== null && efGlobal >= 85 ? 'bg-amber-950/30 border-amber-900/30' : 'bg-red-950/30 border-red-900/30'}`}>
                        <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Eficiencia Global</p>
                        <p className={`text-2xl font-black font-mono mt-1 ${efGlobal !== null && efGlobal >= 90 ? 'text-emerald-400' : efGlobal !== null && efGlobal >= 85 ? 'text-amber-400' : 'text-red-400'}`}>
                            {efGlobal !== null ? `${efGlobal.toFixed(1)}%` : '—'}
                        </p>
                    </div>
                    <div className={`rounded-xl p-3 border ${alertasCrit.length === 0 ? 'bg-emerald-950/30 border-emerald-900/30' : 'bg-red-950/30 border-red-900/30'}`}>
                        <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Alertas Críticas</p>
                        <p className={`text-2xl font-black font-mono mt-1 ${alertasCrit.length === 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {alertasCrit.length}
                        </p>
                    </div>
                    <div className="bg-slate-950/50 border border-white/5 rounded-xl p-3">
                        <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Tramos analizados</p>
                        <p className="text-2xl font-black text-white font-mono mt-1">{balanceData.length}</p>
                    </div>
                </div>

                {/* Tabla de eficiencia por tramo */}
                {balanceData.length > 0 && (
                    <div className="overflow-x-auto rounded-xl border border-white/5">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b border-white/10 bg-slate-950/80">
                                    <th className="px-3 py-2 text-[8px] font-black text-slate-500 uppercase tracking-widest">Tramo</th>
                                    <th className="px-3 py-2 text-[8px] font-black text-slate-500 uppercase tracking-widest text-right">Q Entrada</th>
                                    <th className="px-3 py-2 text-[8px] font-black text-slate-500 uppercase tracking-widest text-right">Q Salida</th>
                                    <th className="px-3 py-2 text-[8px] font-black text-slate-500 uppercase tracking-widest text-right">Q Tomas</th>
                                    <th className="px-3 py-2 text-[8px] font-black text-slate-500 uppercase tracking-widest text-right">Pérdidas</th>
                                    <th className="px-3 py-2 text-[8px] font-black text-slate-500 uppercase tracking-widest text-center">Eficiencia</th>
                                    <th className="px-3 py-2 text-[8px] font-black text-slate-500 uppercase tracking-widest text-center">Estado</th>
                                </tr>
                            </thead>
                            <tbody>
                                {balanceData.map((b, i) => {
                                    const st = getEfficiencyStatus(b.eficiencia);
                                    return (
                                        <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02]">
                                            <td className="px-3 py-2 text-[10px] font-bold text-white">{b.seccion_nombre}</td>
                                            <td className="px-3 py-2 text-[10px] font-mono text-slate-300 text-right">{(b.q_entrada ?? 0).toFixed(2)}</td>
                                            <td className="px-3 py-2 text-[10px] font-mono text-slate-300 text-right">{(b.q_salida ?? 0).toFixed(2)}</td>
                                            <td className="px-3 py-2 text-[10px] font-mono text-slate-300 text-right">{(b.q_tomas ?? 0).toFixed(2)}</td>
                                            <td className="px-3 py-2 text-[10px] font-mono text-right" style={{ color: (b.q_perdidas ?? 0) > 0.5 ? '#ef4444' : '#94a3b8' }}>
                                                {(b.q_perdidas ?? 0).toFixed(3)}
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <span className="text-[11px] font-black font-mono" style={{ color: st.color }}>
                                                    {(b.eficiencia ?? 0).toFixed(1)}%
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded"
                                                    style={{ color: st.color, background: `${st.color}18` }}>
                                                    {st.label}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Alertas predictivas activas */}
                {!loadingPred && alertas.length > 0 && (
                    <div className="space-y-1.5">
                        <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-2">
                            Alertas de Balance Predictivo ({alertas.length})
                        </p>
                        {alertas.map(a => (
                            <div key={a.id} className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-[10px] ${a.type === 'critical' ? 'bg-red-950/30 border-red-900/30' : 'bg-amber-950/30 border-amber-900/30'}`}>
                                <AlertTriangle size={11} className={a.type === 'critical' ? 'text-red-400 mt-0.5 flex-shrink-0' : 'text-amber-400 mt-0.5 flex-shrink-0'} />
                                <div>
                                    <p className={`font-black ${a.type === 'critical' ? 'text-red-300' : 'text-amber-300'}`}>{a.title}</p>
                                    <p className="text-slate-400 text-[9px] mt-0.5">{a.message}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Top anomalías de tramos */}
                {anomalias.length > 0 && (
                    <div>
                        <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-2">
                            Tramos con Anomalía de Balance
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {anomalias.slice(0, 4).map((t, i) => (
                                <div key={i} className={`px-3 py-2 rounded-lg border text-[9px] ${t.estado === 'critico' ? 'bg-red-950/20 border-red-900/20' : 'bg-amber-950/20 border-amber-900/20'}`}>
                                    <p className="font-black text-white">{t.label}</p>
                                    <div className="flex gap-3 mt-1 font-mono text-slate-400">
                                        {t.eficiencia_hoy !== null && <span>Hoy: <strong style={{ color: t.estado === 'critico' ? '#ef4444' : '#f59e0b' }}>{t.eficiencia_hoy.toFixed(1)}%</strong></span>}
                                        {t.eficiencia_baseline !== null && <span>Base: {t.eficiencia_baseline.toFixed(1)}%</span>}
                                        {t.delta_pp !== null && <span>Δ: {t.delta_pp.toFixed(1)} pp</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <p className="text-[8px] text-slate-700 text-right font-mono print:text-black">
                    SICA · Canal Principal Conchos · {new Date().toLocaleString('es-MX')}
                </p>
            </div>
        </div>
    );
};

// ─── Componente principal ─────────────────────────────────────────────────────

const BalanceHidraulico = () => {
    const { fechaSeleccionada } = useFecha();
    const [escalas, setEscalas] = useState<EscalaData[]>([]);
    const [tomas, setTomas] = useState<TomaActiva[]>([]);
    const [perfilTramos, setPerfilTramos] = useState<PerfilTramo[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchData();
    }, [fechaSeleccionada]);

    async function fetchData() {
        setLoading(true);
        const dateStr = fechaSeleccionada;

        const [escRes, tomasRes, perfilRes] = await Promise.all([
            supabase.from('resumen_escalas_diario')
                .select('escala_id, nombre, km, nivel_actual, gasto_calculado_m3s, seccion_nombre')
                .eq('fecha', dateStr)
                .order('km', { ascending: true }),
            supabase.from('reportes_operacion')
                .select('punto_id, puntos_entrega(nombre, km), caudal_promedio, estado')
                .eq('fecha', dateStr)
                .in('estado', ['inicio', 'continua', 'reabierto', 'modificacion']),
            supabase.from('perfil_hidraulico_canal')
                .select('*')
                .order('km_inicio', { ascending: true })
        ]);

        let escalasData = escRes.data || [];

        // Fallback: si resumen_escalas_diario no tiene suficientes datos, usar lecturas_escalas directamente
        if (escalasData.length < 2) {
            const { data: lecturas } = await supabase
                .from('lecturas_escalas')
                .select('escala_id, nivel_m, gasto_calculado_m3s, escalas(nombre, km)')
                .eq('fecha', dateStr)
                .order('hora_lectura', { ascending: false });

            if (lecturas && lecturas.length >= 2) {
                // Deduplicate by escala_id (keep latest)
                const seen = new Set<string>();
                escalasData = lecturas
                    .filter((l: any) => { if (seen.has(l.escala_id)) return false; seen.add(l.escala_id); return true; })
                    .map((l: any) => ({
                        escala_id: l.escala_id,
                        nombre: l.escalas?.nombre || l.escala_id,
                        km: Number(l.escalas?.km || 0),
                        nivel_actual: Number(l.nivel_m || 0),
                        gasto_calculado_m3s: Number(l.gasto_calculado_m3s || 0),
                        seccion_nombre: ''
                    }));
            }
        }

        if (escalasData.length > 0) {
            setEscalas(escalasData.map((e: any) => ({
                escala_id: e.escala_id,
                nombre: e.nombre,
                km: Number(e.km || 0),
                nivel_actual: Number(e.nivel_actual || 0),
                gasto_calculado: Number(e.gasto_calculado_m3s || 0),
                seccion_nombre: e.seccion_nombre || ''
            })));
        }

        if (tomasRes.data) {
            setTomas(tomasRes.data.map((t: any) => ({
                punto_id: t.punto_id,
                nombre: t.puntos_entrega?.nombre || 'Toma',
                km: Number(t.puntos_entrega?.km || 0),
                caudal: Number(t.caudal_promedio || 0)
            })));
        }

        if (perfilRes.data) {
            setPerfilTramos(perfilRes.data as PerfilTramo[]);
        }

        setLoading(false);
    }

    // Calculate balance between consecutive escalas
    const balanceData = useMemo((): BalanceTramo[] => {
        if (escalas.length < 2) return [];

        const balances: BalanceTramo[] = [];
        const sortedEscalas = [...escalas].sort((a, b) => a.km - b.km);

        for (let i = 0; i < sortedEscalas.length - 1; i++) {
            const e1 = sortedEscalas[i];
            const e2 = sortedEscalas[i + 1];

            // Sum all tomas between these two escalas
            const tomasEntre = tomas.filter(t => t.km >= e1.km && t.km < e2.km);
            const qTomas = tomasEntre.reduce((acc, t) => acc + t.caudal, 0);

            // Find matching perfil tramo
            const perfil = perfilTramos.find(p =>
                e1.km >= p.km_inicio && e1.km < p.km_fin
            );

            const balance = calculateSectionBalance(
                `${e1.nombre} → ${e2.nombre}`,
                e1.km,
                e2.km,
                e1.gasto_calculado,
                e2.gasto_calculado,
                qTomas,
                perfil
            );

            balances.push(balance);
        }

        return balances;
    }, [escalas, tomas, perfilTramos]);

    // Eficiencia global — excluir tramos anómalos (q_salida > q_entrada) por error de medición
    const globalEfficiency = useMemo((): number | null => {
        if (balanceData.length === 0) return null;
        const validSections = balanceData.filter(b => b.q_salida + b.q_tomas <= b.q_entrada || b.q_entrada === 0);
        if (validSections.length === 0) return null;
        const totalEntrada = validSections.reduce((acc, b) => acc + b.q_entrada, 0);
        const totalSalida = validSections.reduce((acc, b) => acc + b.q_salida + b.q_tomas, 0);
        return totalEntrada > 0 ? Math.min(100, (totalSalida / totalEntrada) * 100) : null;
    }, [balanceData]);

    const criticalSections = balanceData.filter(b => b.estado === 'critico' || b.estado === 'alerta');

    if (loading) {
        return (
            <div className="balance-loading">
                <div className="balance-loading-spinner"></div>
                <p>Calculando Balance Hidráulico...</p>
            </div>
        );
    }

    return (
        <div className="balance-page">
            <header className="balance-header">
                <div className="balance-title-group">
                    <BarChart3 size={24} className="balance-icon" />
                    <div>
                        <h1>Balance Hidráulico</h1>
                        <p className="balance-subtitle">Modelo de Operación — Canal Principal Conchos</p>
                    </div>
                </div>
                <div className="balance-kpi-row">
                    <div className="balance-kpi">
                        <span className="kpi-value">{escalas.length}</span>
                        <span className="kpi-label">Escalas</span>
                    </div>
                    <div className="balance-kpi">
                        <span className="kpi-value">{tomas.length}</span>
                        <span className="kpi-label">Tomas Activas</span>
                    </div>
                    <div className="balance-kpi">
                        <span className="kpi-value">{perfilTramos.length}</span>
                        <span className="kpi-label">Tramos Diseño</span>
                    </div>
                    <div className="balance-kpi highlight">
                        <span className="kpi-value">{criticalSections.length}</span>
                        <span className="kpi-label">Alertas</span>
                    </div>
                </div>
            </header>

            <div className="balance-content">
                {/* Global Efficiency Gauge */}
                <div className="balance-gauge-card">
                    {globalEfficiency !== null ? (
                        <EfficiencyGauge value={globalEfficiency} label="Eficiencia de Conducción Global" />
                    ) : (
                        <div className="balance-empty balance-empty--gauge">
                            <p>Eficiencia no disponible</p>
                            <p className="balance-empty-hint">Se requieren datos de caudal en escalas para calcular la eficiencia real.</p>
                        </div>
                    )}
                    <div className="balance-formula">
                        <code>E<sub>c</sub> = (Q<sub>salida</sub> + Q<sub>tomas</sub>) / Q<sub>entrada</sub> × 100</code>
                    </div>
                </div>

                {/* Balance Table */}
                <div className="balance-table-card">
                    <h2 className="section-title">
                        <TrendingUp size={18} /> Balance por Tramo
                    </h2>

                    {balanceData.length === 0 ? (
                        <div className="balance-empty">
                            <p>No hay suficientes datos de escalas para calcular el balance.</p>
                            <p className="balance-empty-hint">Se requieren al menos 2 estaciones de medición con datos del día seleccionado.</p>
                        </div>
                    ) : (
                        <div className="balance-table-wrapper">
                            <table className="balance-table">
                                <thead>
                                    <tr>
                                        <th>Tramo</th>
                                        <th>KM</th>
                                        <th>Q Entrada</th>
                                        <th>Q Salida</th>
                                        <th>Q Tomas</th>
                                        <th>Pérdidas</th>
                                        <th>Eficiencia</th>
                                        <th>Estado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {balanceData.map((b, idx) => {
                                        const status = getEfficiencyStatus(b.eficiencia);
                                        return (
                                            <tr key={idx} className={`balance-row ${b.estado}`}>
                                                <td className="tramo-name">{b.seccion_nombre}</td>
                                                <td className="tramo-km">{(b.km_inicio ?? 0).toFixed(1)} - {(b.km_fin ?? 0).toFixed(1)}</td>
                                                <td className="q-value entrada">{(b.q_entrada ?? 0).toFixed(3)}</td>
                                                <td className="q-value salida">{(b.q_salida ?? 0).toFixed(3)}</td>
                                                <td className="q-value tomas">{(b.q_tomas ?? 0).toFixed(3)}</td>
                                                <td className="q-value perdidas">{(b.q_perdidas ?? 0).toFixed(3)}</td>
                                                <td className="efficiency-cell">
                                                    <div className="efficiency-bar-container">
                                                        <div
                                                            className="efficiency-bar-fill"
                                                            style={{
                                                                width: `${Math.min(100, b.eficiencia ?? 0)}%`,
                                                                background: status.color
                                                            }}
                                                        />
                                                        <span className="efficiency-text" style={{ color: status.color }}>
                                                            {(b.eficiencia ?? 0).toFixed(1)}%
                                                        </span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span
                                                        className={`status-badge status-${b.estado}`}
                                                        style={{ background: status.bg, color: status.color, borderColor: status.color }}
                                                    >
                                                        {status.label}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Canal Schematic */}
                <div className="balance-schematic-card">
                    <h2 className="section-title">
                        <Droplets size={18} /> Esquema del Canal — Flujo de Diseño vs Real
                    </h2>
                    <div className="canal-schematic">
                        {balanceData.map((b, idx) => {
                            const status = getEfficiencyStatus(b.eficiencia);
                            const widthPct = b.perfil
                                ? Math.min(100, (b.q_entrada / b.perfil.capacidad_diseno_m3s) * 100)
                                : 50;
                            return (
                                <div key={idx} className="schematic-section">
                                    <div className="schematic-node">
                                        <div className="node-dot" style={{ background: status.color, boxShadow: `0 0 12px ${status.color}` }} />
                                        <span className="node-label">{b.seccion_nombre.split(' → ')[0]}</span>
                                        <span className="node-q">{(b.q_entrada ?? 0).toFixed(2)} m³/s</span>
                                    </div>
                                    <div className="schematic-pipe">
                                        <div
                                            className="pipe-flow"
                                            style={{
                                                width: `${widthPct}%`,
                                                background: `linear-gradient(90deg, ${status.color}40, ${status.color})`
                                            }}
                                        />
                                        {b.q_tomas > 0 && (
                                            <div className="pipe-tomas">
                                                <ArrowDown size={10} />
                                                <span>{(b.q_tomas ?? 0).toFixed(2)}</span>
                                            </div>
                                        )}
                                        {b.q_perdidas > 0.01 && (
                                            <div className="pipe-loss">
                                                <AlertTriangle size={10} />
                                                <span>-{(b.q_perdidas ?? 0).toFixed(2)}</span>
                                            </div>
                                        )}
                                        <span className="pipe-efficiency" style={{ color: status.color }}>
                                            {(b.eficiencia ?? 0).toFixed(1)}%
                                        </span>
                                    </div>
                                    {idx === balanceData.length - 1 && (
                                        <div className="schematic-node">
                                            <div className="node-dot" style={{ background: status.color, boxShadow: `0 0 12px ${status.color}` }} />
                                            <span className="node-label">{b.seccion_nombre.split(' → ')[1]}</span>
                                            <span className="node-q">{(b.q_salida ?? 0).toFixed(2)} m³/s</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Manning Comparison */}
                {perfilTramos.length > 0 && (
                    <div className="balance-manning-card">
                        <h2 className="section-title">
                            <TrendingUp size={18} /> Perfil de Diseño — Manning Teórico
                        </h2>
                        <div className="manning-grid">
                            {perfilTramos.slice(0, 12).map((tramo, idx) => {
                                const manning = manningFlow(
                                    tramo.plantilla_m,
                                    tramo.talud_z,
                                    tramo.tirante_diseno_m,
                                    tramo.pendiente_s0,
                                    tramo.rugosidad_n
                                );
                                return (
                                    <div key={idx} className="manning-item">
                                        <div className="manning-header">
                                            <span className="manning-tramo">{tramo.nombre_tramo}</span>
                                            <span className="manning-km">KM {(tramo.km_inicio ?? 0).toFixed(1)}-{(tramo.km_fin ?? 0).toFixed(1)}</span>
                                        </div>
                                        <div className="manning-values">
                                            <div className="manning-row">
                                                <span>Q Manning:</span>
                                                <strong>{(manning.Q ?? 0).toFixed(2)} m³/s</strong>
                                            </div>
                                            <div className="manning-row">
                                                <span>Q Diseño:</span>
                                                <strong>{((tramo.capacidad_diseno_m3s > 0 ? tramo.capacidad_diseno_m3s : manning.Q) ?? 0).toFixed(2)} m³/s</strong>
                                            </div>
                                            <div className="manning-row">
                                                <span>V:</span>
                                                <strong>{(manning.V ?? 0).toFixed(2)} m/s</strong>
                                            </div>
                                            <div className="manning-row">
                                                <span>Fr:</span>
                                                <strong className={(manning.Fr ?? 0) > 1 ? 'supercrit' : ''}>{(manning.Fr ?? 0).toFixed(3)}</strong>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* ── Curvas Q-h por Escala ─────────────────────────────────────── */}
            <div className="mt-8 pt-8 border-t border-white/5 no-print">
                <div className="flex items-center gap-2 mb-1">
                    <TrendingDown size={16} className="text-sky-400" />
                    <h3 className="text-sm font-black text-white uppercase tracking-tight">
                        Curvas Q-h por Punto de Aforo
                    </h3>
                </div>
                <p className="text-[10px] text-slate-500 mb-4 uppercase tracking-[0.15em]">
                    Scatter de campo vs curva teórica Manning · Detecta cambios de sección y desviaciones · Ventana 365 días
                </p>
                <RatingCurve diasAtras={365} />
            </div>

            {/* ── Calibración Automática de Manning ─────────────────────────── */}
            <div className="mt-8 pt-8 border-t border-white/5 no-print">
                <div className="flex items-center gap-2 mb-1">
                    <FlaskConical size={16} className="text-amber-400" />
                    <h3 className="text-sm font-black text-white uppercase tracking-tight">
                        Calibración Automática — Rugosidad Manning (n)
                    </h3>
                </div>
                <p className="text-[10px] text-slate-500 mb-4 uppercase tracking-[0.15em]">
                    Comparativa diseño vs medición de campo · Ventana 90 días · Aforos sica-capture
                </p>
                <ManningCalibrador />
            </div>

            {/* ── Reporte Ejecutivo Diario ───────────────────────────────────── */}
            <ReporteEjecutivo
                fecha={fechaSeleccionada}
                balanceData={balanceData}
            />
        </div>
    );
};

export default BalanceHidraulico;
