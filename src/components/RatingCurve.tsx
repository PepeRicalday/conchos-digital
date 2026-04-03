/**
 * RatingCurve — Curva Q-h por punto de aforo.
 *
 * Muestra scatter de pares (tirante, gasto) históricos y la curva teórica Manning.
 * Permite identificar escalas con lecturas sistemáticamente fuera de la curva,
 * lo que indica necesidad de recalibración física o cambio de sección.
 */

import { useState } from 'react';
import {
    Scatter, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, ComposedChart,
} from 'recharts';
import { TrendingUp, AlertTriangle, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useRatingCurve, type RatingCurveData } from '../hooks/useRatingCurve';

// ─── Subcomponente por punto ──────────────────────────────────────────────────

const R2Badge = ({ r2 }: { r2: number | null }) => {
    if (r2 === null) return <span className="text-[9px] text-slate-600 font-bold">R² —</span>;
    const color = r2 >= 0.9 ? '#10b981' : r2 >= 0.75 ? '#f59e0b' : '#ef4444';
    return (
        <span className="text-[9px] font-black font-mono" style={{ color }}>
            R² {r2.toFixed(3)}
        </span>
    );
};

const PuntoCard = ({ data }: { data: RatingCurveData }) => {
    const [expanded, setExpanded] = useState(false);

    const r2 = data.r2;
    const estado = r2 === null ? 'insuficiente' : r2 >= 0.9 ? 'ok' : r2 >= 0.75 ? 'atencion' : 'revision';
    const colorMap = {
        ok:          '#10b981',
        atencion:    '#f59e0b',
        revision:    '#ef4444',
        insuficiente:'#475569',
    };
    const color = colorMap[estado];

    // Combinamos scatter + línea en un ComposedChart
    const scatterData = data.mediciones.map(m => ({ tirante: m.tirante, gasto: m.gasto }));

    return (
        <div className="border border-white/5 rounded-xl overflow-hidden bg-slate-950/40">
            {/* Cabecera */}
            <button
                type="button"
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
                onClick={() => setExpanded(e => !e)}
            >
                <div className="flex items-center gap-3">
                    {estado === 'ok'
                        ? <CheckCircle size={12} style={{ color }} />
                        : <AlertTriangle size={12} style={{ color }} />
                    }
                    <span className="text-[11px] font-black text-white">{data.nombre_punto}</span>
                    {data.km_punto !== null && (
                        <span className="text-[8px] text-slate-600 font-mono">K{data.km_punto}</span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-[8px] text-slate-600">{data.mediciones.length} aforos</span>
                    <R2Badge r2={r2} />
                    <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded"
                        style={{ color, background: `${color}18` }}>
                        {estado === 'ok' ? 'Conforme' : estado === 'atencion' ? 'Atención' : estado === 'revision' ? 'Revisión' : 'Sin datos'}
                    </span>
                    {expanded ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
                </div>
            </button>

            {/* Gráfica expandida */}
            {expanded && (
                <div className="px-4 pb-4">
                    <div className="flex gap-4 mb-2 text-[9px] text-slate-500">
                        <span>b={data.plantilla_m.toFixed(1)}m</span>
                        <span>z={data.talud_z.toFixed(2)}</span>
                        <span>n={data.rugosidad_n.toFixed(4)}</span>
                        <span>S₀={data.pendiente_s0.toExponential(2)}</span>
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                        <ComposedChart margin={{ top: 8, right: 16, bottom: 24, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                            <XAxis
                                dataKey="tirante"
                                type="number"
                                domain={['auto', 'auto']}
                                label={{ value: 'Tirante (m)', position: 'insideBottom', offset: -12, fill: '#475569', fontSize: 9 }}
                                tick={{ fill: '#64748b', fontSize: 8 }}
                            />
                            <YAxis
                                label={{ value: 'Q (m³/s)', angle: -90, position: 'insideLeft', offset: 12, fill: '#475569', fontSize: 9 }}
                                tick={{ fill: '#64748b', fontSize: 8 }}
                            />
                            <Tooltip
                                contentStyle={{ background: 'rgba(4,11,22,0.97)', border: '1px solid #1e3a5f', borderRadius: 6 }}
                                labelStyle={{ color: '#94a3b8', fontSize: 9 }}
                                itemStyle={{ fontSize: 10 }}
                                formatter={(v: number | undefined, name: string | undefined) => [
                                    `${typeof v === 'number' ? v.toFixed(3) : v} m³/s`,
                                    name === 'gasto' ? 'Aforo campo' : 'Manning teórico',
                                ] as [string, string]}
                            />
                            {/* Curva teórica Manning */}
                            <Line
                                data={data.curva_teorica}
                                dataKey="gasto"
                                type="monotone"
                                stroke="rgba(56,189,248,0.6)"
                                strokeWidth={1.5}
                                dot={false}
                                name="Manning"
                            />
                            {/* Scatter de aforos de campo */}
                            <Scatter
                                data={scatterData}
                                dataKey="gasto"
                                fill={color}
                                name="campo"
                                opacity={0.85}
                                shape={(props: any) => {
                                    const { cx, cy } = props;
                                    return <circle cx={cx} cy={cy} r={4} fill={color} stroke="#04080f" strokeWidth={1.2} />;
                                }}
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                    <p className="text-[8px] text-slate-700 mt-1">
                        Puntos fuera de la curva azul indican cambio de sección o necesidad de recalibración física.
                    </p>
                </div>
            )}
        </div>
    );
};

// ─── Componente principal ─────────────────────────────────────────────────────

export const RatingCurve = ({ diasAtras = 365 }: { diasAtras?: number }) => {
    const { puntos, loading, error } = useRatingCurve(diasAtras);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-10">
                <span className="text-[10px] text-slate-600 font-bold uppercase tracking-widest animate-pulse">
                    Calculando curvas Q-h ({diasAtras} días)...
                </span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center gap-2 py-6 text-red-400">
                <AlertTriangle size={13} />
                <span className="text-xs font-bold">{error}</span>
            </div>
        );
    }

    if (puntos.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-slate-600">
                <TrendingUp size={28} />
                <p className="text-xs font-bold uppercase tracking-widest">Sin aforos suficientes</p>
                <p className="text-[9px] text-slate-700 text-center max-w-sm">
                    Se requieren ≥2 aforos por punto de control en los últimos {diasAtras} días.
                </p>
            </div>
        );
    }

    const conformes = puntos.filter(p => p.r2 !== null && p.r2 >= 0.9).length;
    const revision  = puntos.filter(p => p.r2 !== null && p.r2 < 0.75).length;

    return (
        <div className="space-y-3">
            {/* KPIs */}
            <div className="grid grid-cols-3 gap-3 mb-2">
                <div className="bg-slate-950/50 rounded-xl p-3 border border-white/5">
                    <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Puntos con aforos</p>
                    <p className="text-2xl font-black text-white font-mono mt-1">{puntos.length}</p>
                </div>
                <div className="bg-emerald-950/30 rounded-xl p-3 border border-emerald-900/30">
                    <p className="text-[8px] font-black text-emerald-600 uppercase tracking-widest">R² ≥ 0.9</p>
                    <p className="text-2xl font-black text-emerald-400 font-mono mt-1">{conformes}</p>
                </div>
                <div className="bg-red-950/30 rounded-xl p-3 border border-red-900/30">
                    <p className="text-[8px] font-black text-red-600 uppercase tracking-widest">Requieren revisión</p>
                    <p className="text-2xl font-black text-red-400 font-mono mt-1">{revision}</p>
                </div>
            </div>

            {/* Lista de puntos */}
            {puntos.map(p => <PuntoCard key={p.punto_control_id} data={p} />)}

            <p className="text-[8px] text-slate-700 text-right font-mono">
                Ventana: {diasAtras} días · Curva teórica: Manning Q=(1/n)·A·R^(2/3)·√S₀
            </p>
        </div>
    );
};

export default RatingCurve;
