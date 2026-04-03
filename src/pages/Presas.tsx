import { useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
    MapPin, Droplets, Activity, TrendingUp, TrendingDown, Minus,
    AlertTriangle, CheckCircle, Camera, Signature, ExternalLink,
    Gauge, Waves, Settings, ThermometerSun, Clock, Upload, Loader,
    Map, PlusCircle
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, Cell
} from 'recharts';
import './Presas.css';
import ReservoirViz from '../components/ReservoirViz';
import { useFecha } from '../context/FechaContext';
import { usePresas, type PresaData, type PuntoCurva, type ClimaPresaData, type AforoDiarioData, type MovimientoPresaData } from '../hooks/usePresas';
import { useEfficiencyHistory, type EstadoBalance } from '../hooks/useEfficiencyHistory';

// --- Hidro-Sincronía 2.1: Advanced Analytics & Interactive Simulation ---

const HydroFlowDiagram = ({ presa }: { presa: PresaData }) => {
    return (
        <div className="technical-card h-40 flex items-center justify-center relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 pointer-events-none">
                <svg width="100%" height="100%" viewBox="0 0 400 200">
                    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="white" strokeWidth="0.5" />
                    </pattern>
                    <rect width="100%" height="100%" fill="url(#grid)" />
                </svg>
            </div>
            {/* Hydraulic Logic Minimalist Diagram */}
            <div className="flex items-center gap-8 z-10">
                <div className="flex flex-col items-center">
                    <div className="w-12 h-12 rounded-lg bg-blue-500/20 border border-blue-400 flex items-center justify-center">
                        <Waves size={24} className="text-blue-400" />
                    </div>
                    <span className="text-[9px] font-black uppercase text-blue-400 mt-2">Vaso</span>
                </div>
                <div className="flex-1 w-20 h-px bg-gradient-to-right from-blue-400 to-emerald-400 relative">
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] font-mono font-bold text-white">
                        {presa.lectura?.extraccion_total_m3s?.toFixed(2) || '0.00'} m³/s
                    </div>
                    <div className="absolute top-1/2 left-0 w-2 h-2 rounded-full bg-blue-400 -translate-y-1/2 animate-ping" />
                </div>
                <div className="flex flex-col items-center">
                    <div className="w-12 h-12 rounded-lg bg-emerald-500/20 border border-emerald-400 flex items-center justify-center">
                        <Activity size={24} className="text-emerald-400" />
                    </div>
                    <span className="text-[9px] font-black uppercase text-emerald-400 mt-2">Canal Riego</span>
                </div>
            </div>
        </div>
    );
};

const FUENTE_COLOR: Record<string, string> = {
    GERENCIA_ADMIN: '#f59e0b',
    CAMPO:          '#10b981',
    AUTOMATICO:     '#38bdf8',
    DEFAULT:        '#6366f1',
};

const ExtractionStreamgraph = ({ movimientos }: { movimientos: MovimientoPresaData[] }) => {
    // Build 48-hour step chart at 2-hour resolution (24 points)
    // movimientos represent state changes — carry forward last known gasto
    const data = useMemo(() => {
        const now = Date.now();
        const SLOTS = 24;
        const INTERVAL_MS = 2 * 3600000;

        return Array.from({ length: SLOTS }, (_, i) => {
            const slotEnd = now - (SLOTS - 1 - i) * INTERVAL_MS;
            const last = movimientos
                .filter(m => new Date(m.fecha_hora).getTime() <= slotEnd)
                .at(-1); // already sorted ascending from hook

            const d = new Date(slotEnd);
            const showDate = i === 0 || d.getHours() === 0;
            const label = showDate
                ? d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' })
                : d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });

            return {
                hora: label,
                gasto: last?.gasto_m3s ?? 0,
                fuente: last?.fuente_dato ?? 'DEFAULT',
            };
        });
    }, [movimientos]);

    const hasDatos = data.some(d => d.gasto > 0);

    if (!hasDatos) {
        return (
            <div className="h-48 w-full mt-4 bg-black/20 rounded-xl flex items-center justify-center border border-white/5">
                <p className="text-xs text-slate-600 font-bold uppercase tracking-widest">Sin movimientos en los últimos 7 días</p>
            </div>
        );
    }

    // Determine dominant fuente for color
    const fuenteDominante = data.find(d => d.gasto > 0)?.fuente ?? 'DEFAULT';
    const color = FUENTE_COLOR[fuenteDominante] ?? FUENTE_COLOR.DEFAULT;

    return (
        <div className="h-48 w-full mt-4 bg-black/20 rounded-xl p-4 border border-white/5">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                    <defs>
                        <linearGradient id="gastoGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={color} stopOpacity={0.4} />
                            <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                        </linearGradient>
                    </defs>
                    <XAxis
                        dataKey="hora"
                        tick={{ fontFamily: 'JetBrains Mono', fontSize: 9, fill: '#475569' }}
                        interval={3}
                        axisLine={false}
                        tickLine={false}
                    />
                    <YAxis hide domain={[0, 'auto']} />
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <Tooltip
                        contentStyle={{ backgroundColor: '#020617', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px' }}
                        itemStyle={{ fontFamily: 'JetBrains Mono', fontSize: '11px', color: '#e2e8f0' }}
                        formatter={(val: number | undefined, _: string | undefined, entry: any) => [
                            `${(val ?? 0).toFixed(2)} m³/s`,
                            entry.payload.fuente ?? 'Gasto'
                        ] as [string, string]}
                    />
                    <Area
                        type="stepAfter"
                        dataKey="gasto"
                        stroke={color}
                        strokeWidth={2}
                        fill="url(#gastoGrad)"
                        dot={false}
                        isAnimationActive={false}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
};

const ESTADO_COLOR: Record<EstadoBalance, string> = {
    optimo:    '#10b981',
    atencion:  '#f59e0b',
    alerta:    '#ef4444',
    critico:   '#7f1d1d',
    sin_datos: '#0f172a',
};

const ESTADO_LABEL: Record<EstadoBalance, string> = {
    optimo:    '≥95% Óptimo',
    atencion:  '90-95% Atención',
    alerta:    '85-90% Alerta',
    critico:   '<85% Crítico',
    sin_datos: 'Sin datos',
};

const EfficiencyHeatmap = () => {
    const { tramos, dias, matrix, loading } = useEfficiencyHistory(7);

    if (loading) {
        return (
            <div className="mt-4 h-24 flex items-center justify-center">
                <span className="text-[10px] text-slate-600 font-bold uppercase tracking-widest animate-pulse">Calculando balance histórico...</span>
            </div>
        );
    }

    if (tramos.length === 0) {
        return (
            <div className="mt-4 h-24 flex items-center justify-center">
                <span className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">Sin lecturas de escalas disponibles</span>
            </div>
        );
    }

    const dayLabels = dias.map(d => {
        const [, , day] = d.split('-');
        const date = new Date(d + 'T12:00:00');
        return date.toLocaleDateString('es-MX', { weekday: 'short' }).slice(0, 1).toUpperCase() + day;
    });

    const cols = dias.length;

    return (
        <div className="mt-4 overflow-x-auto">
            {/* Header: días */}
            <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: `120px repeat(${cols}, 1fr)` }}>
                <div />
                {dayLabels.map((label, i) => (
                    <div key={i} className="text-[8px] font-black text-slate-500 text-center uppercase">{label}</div>
                ))}
            </div>

            {/* Filas: tramos */}
            {tramos.map((tramo, ti) => (
                <div key={ti} className="grid gap-1 mb-1" style={{ gridTemplateColumns: `120px repeat(${cols}, 1fr)` }}>
                    {/* Etiqueta del tramo */}
                    <div className="text-[8px] font-bold text-slate-500 truncate pr-1 flex items-center">
                        K{tramo.km_inicio}→K{tramo.km_fin}
                    </div>
                    {/* Celdas por día */}
                    {dias.map((_, di) => {
                        const cell = matrix[ti]?.[di];
                        if (!cell) return <div key={di} className="aspect-square rounded-[2px] bg-slate-900" />;
                        const bg = ESTADO_COLOR[cell.estado];
                        const tooltip = cell.estado === 'sin_datos'
                            ? 'Sin datos'
                            : `${cell.eficiencia?.toFixed(1)}% — ${ESTADO_LABEL[cell.estado]}\nEnt: ${cell.q_entrada.toFixed(2)} | Sal: ${cell.q_salida.toFixed(2)} | Tomas: ${cell.q_tomas.toFixed(2)} | Fuga: ${cell.q_fuga.toFixed(2)} m³/s`;
                        return (
                            <div
                                key={di}
                                className="aspect-square rounded-[2px] border border-white/5 transition-all hover:border-white/30 hover:scale-110 cursor-default"
                                style={{ backgroundColor: bg, opacity: cell.estado === 'sin_datos' ? 0.3 : 0.85 }}
                                title={tooltip}
                            />
                        );
                    })}
                </div>
            ))}

            {/* Leyenda */}
            <div className="flex gap-3 mt-3 flex-wrap">
                {(Object.keys(ESTADO_COLOR) as EstadoBalance[]).filter(k => k !== 'sin_datos').map(k => (
                    <div key={k} className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-[1px]" style={{ backgroundColor: ESTADO_COLOR[k] }} />
                        <span className="text-[8px] font-bold text-slate-500 uppercase">{ESTADO_LABEL[k]}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- Modal de Registro de Movimiento (Gerente) ---
const RegisterMovementModal = ({ isOpen, onClose, presa, onSourceUpdate }: { 
    isOpen: boolean, 
    onClose: () => void, 
    presa: PresaData,
    onSourceUpdate: () => void
}) => {
    const [gasto, setGasto] = useState('');
    const [fechaHora, setFechaHora] = useState(new Date().toISOString().slice(0, 16));
    const [isSaving, setIsSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!gasto || isNaN(Number(gasto))) return;

        setIsSaving(true);
        try {
            const { error } = await supabase
                .from('movimientos_presas')
                .insert({
                    presa_id: presa.id,
                    fecha_hora: new Date(fechaHora).toISOString(),
                    gasto_m3s: Number(gasto),
                    fuente_dato: 'GERENCIA_ADMIN'
                });

            if (error) throw error;
            onSourceUpdate();
            onClose();
        } catch (err) {
            console.error('Error guardando movimiento:', err);
            alert('Error al registrar el movimiento');
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in duration-200">
                <div className="p-6 border-b border-white/5 bg-gradient-to-r from-blue-600/20 to-emerald-600/20">
                    <h3 className="text-xl font-black text-white flex items-center gap-2 uppercase tracking-tighter">
                        <PlusCircle className="text-emerald-400" />
                        Registrar Movimiento
                    </h3>
                    <p className="text-xs text-slate-400 font-bold mt-1">Órdenes de Operación - {presa.nombre_corto}</p>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="space-y-2">
                        <label htmlFor="gasto-liberado" className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                            Gasto Liberado (Q)
                        </label>
                        <div className="relative">
                            <input 
                                id="gasto-liberado"
                                type="number" 
                                step="0.01"
                                value={gasto}
                                onChange={(e) => setGasto(e.target.value)}
                                className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-xl focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 outline-none transition-all"
                                placeholder="0.00"
                                required
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-xs uppercase">m³/s</span>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="fecha-hora-efectiva" className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                            Fecha y Hora Efectiva
                        </label>
                        <input 
                            id="fecha-hora-efectiva"
                            type="datetime-local" 
                            value={fechaHora}
                            onChange={(e) => setFechaHora(e.target.value)}
                            className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-sm focus:border-blue-500/50 outline-none"
                            required
                        />
                    </div>

                    <div className="pt-4 flex gap-3">
                        <button 
                            type="button" 
                            onClick={onClose}
                            className="flex-1 px-4 py-3 rounded-xl bg-white/5 text-xs font-black text-slate-400 uppercase tracking-widest hover:bg-white/10 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button 
                            type="submit" 
                            disabled={isSaving}
                            className="flex-1 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-widest shadow-lg shadow-emerald-900/40 transition-all active:scale-95 disabled:opacity-50"
                        >
                            {isSaving ? 'Guardando...' : 'Confirmar Registro'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- Technical Helper Components ---

const TempRangeBar = ({ min, max }: { min: number, max: number }) => {
    // scale: 0C to 45C (typical range in Delicias)
    const start = Math.max(0, (min / 45) * 100);
    const end = Math.min(100, (max / 45) * 100);
    const width = end - start;

    return (
        <div className="flex flex-col w-full gap-1">
            <div className="flex justify-between text-[10px] font-bold text-slate-500">
                <span>0°C</span>
                <span>45°C</span>
            </div>
            <div className="temp-range-container">
                <div
                    className="temp-range-bar"
                    style={{ left: `${start}%`, width: `${width}%` }}
                />
                <div className="temp-indicator" style={{ left: `${start}%` }} />
                <div className="temp-indicator" style={{ left: `${end}%` }} />
            </div>
            <div className="flex justify-between text-[12px] font-black text-white font-mono">
                <span>{min.toFixed(1)}°</span>
                <span>{max.toFixed(1)}°</span>
            </div>
        </div>
    );
};

const Compass = ({ direction }: { direction: string }) => {
    const directions: Record<string, number> = {
        'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5,
        'E': 90, 'ESE': 112.5, 'SE': 135, 'SSE': 157.5,
        'S': 180, 'SSW': 202.5, 'SW': 225, 'WSW': 247.5,
        'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5
    };
    const rotation = directions[direction.toUpperCase()] || 0;

    return (
        <div className="flex items-center gap-3">
            <div className="compass-container">
                <div className="compass-needle" style={{ transform: `rotate(${rotation}deg)` }} />
                <span className="absolute top-0 text-[8px] text-slate-500 font-bold">N</span>
            </div>
            <span className="text-xs font-bold text-white uppercase">{direction}</span>
        </div>
    );
};

const MiniMetricChart = ({ label, value, unit, color }: { label: string, value: number, unit: string, color: string }) => {
    const data = [{ v: value }, { v: 10 - value }]; // Dummy for visual pulse
    return (
        <div className="technical-card flex flex-col gap-2">
            <span className="mini-chart-label">{label}</span>
            <div className="flex items-end justify-between">
                <span className="mini-chart-value">{value.toFixed(1)} <small className="text-[10px] opacity-50">{unit}</small></span>
                <div className="w-12 h-8">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data}>
                            <Bar dataKey="v" radius={[2, 2, 0, 0]}>
                                <Cell fill={color} opacity={0.8} />
                                <Cell fill="rgba(255,255,255,0.05)" />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
};

// Component: Dam Card
const DamCard = ({ presa, climaObj, aforoObj, movimientosHistorial }: { presa: PresaData, climaObj?: ClimaPresaData, aforoObj?: AforoDiarioData, movimientosHistorial: MovimientoPresaData[] }) => {
    const lect = presa.lectura;
    const elevacion = lect?.escala_msnm || 0;
    const almacenamiento = lect?.almacenamiento_mm3 || 0;
    const pctLlenado = lect?.porcentaje_llenado || 0;
    const extraccion = lect?.extraccion_total_m3s || 0;

    // Determine trend from data
    const trend = extraccion > 30 ? 'rising' : extraccion > 0 ? 'stable' : 'falling';
    const TrendIcon = trend === 'rising' ? TrendingUp : trend === 'falling' ? TrendingDown : Minus;
    const trendColor = trend === 'rising' ? '#10b981' : trend === 'falling' ? '#ef4444' : '#94a3b8';

    // Breakdown of extraction
    const gastos = [
        { name: 'Toma Baja', value: lect?.gasto_toma_baja_m3s },
        { name: 'CFE', value: lect?.gasto_cfe_m3s },
        { name: 'Toma Izq', value: lect?.gasto_toma_izq_m3s },
        { name: 'Toma Der', value: lect?.gasto_toma_der_m3s },
    ].filter(g => g.value != null && g.value > 0);

    return (
        <div className="dam-card">
            {/* Section 1: Identification */}
            <div className="dam-header">
                <div className="dam-title">
                    <Waves size={24} className="text-blue-400" />
                    <div>
                        <h2>{presa.nombre}</h2>
                        <p className="dam-subtitle">{presa.rio} • {presa.municipio}</p>
                    </div>
                </div>
                <a
                    href={`https://maps.google.com/?q=${presa.latitud},${presa.longitud}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="location-link"
                >
                    <MapPin size={14} />
                    Ver en Mapa
                    <ExternalLink size={12} />
                </a>
            </div>
            <div className="dam-type-badge">{presa.tipo_cortina}</div>

            {/* Section 2: Design Parameters from curva_capacidad */}
            <div className="params-section">
                <h3><Settings size={16} /> Parámetros de Diseño</h3>
                <table className="params-table">
                    <thead>
                        <tr>
                            <th>Parámetro</th>
                            <th>Elevación (msnm)</th>
                            <th>Volumen (Mm³)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr className="name-row">
                            <td>Corona</td>
                            <td>{presa.elevacion_corona_msnm.toFixed(2)}</td>
                            <td>—</td>
                        </tr>
                        <tr className="namo-row">
                            <td>NAMO (100%)</td>
                            <td>{presa.curva_capacidad.length > 0 ? presa.curva_capacidad[presa.curva_capacidad.length - 1].elevacion_msnm.toFixed(2) : '—'}</td>
                            <td>{presa.capacidad_max_mm3.toFixed(1)}</td>
                        </tr>
                        {presa.curva_capacidad.length > 0 && (
                            <tr>
                                <td>Punto Inferior Curva</td>
                                <td>{presa.curva_capacidad[0].elevacion_msnm.toFixed(2)}</td>
                                <td>{presa.curva_capacidad[0].volumen_mm3.toFixed(1)}</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Section 3: Real-Time Status */}
            <div className="status-section">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="m-0"><Activity size={16} /> Estado Hidráulico Autorizado</h3>
                    {lect && (
                        <div className="reading-timestamp m-0">
                            <Clock size={12} />
                            <span>{lect.fecha}{lect.responsable ? ` — ${lect.responsable}` : ''}</span>
                        </div>
                    )}
                </div>

                {/* Variation Parsing for "Hidro-Sincronía 2.0" */}
                {(() => {
                    const difElev = lect?.notas?.match(/Dif Elev: ([-\d.]+)m/)?.[1];
                    const difVol = lect?.notas?.match(/Dif Vol: ([-\d.]+)Mm3/)?.[1];

                    if (!difElev && !difVol) return null;

                    return (
                        <div className="variations-banner flex gap-4 mb-4 p-3 bg-blue-500/5 rounded-xl border border-blue-500/20">
                            {difElev && (
                                <div className="flex-1 flex flex-col items-center border-r border-blue-500/10">
                                    <span className="text-[8px] font-black uppercase text-slate-500 tracking-widest mb-1">Δ Variación Elevación (24h)</span>
                                    <div className={`flex items-center gap-1 font-mono font-black text-xs ${Number(difElev) > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {Number(difElev) > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                        {difElev} m
                                    </div>
                                </div>
                            )}
                            {difVol && (
                                <div className="flex-1 flex flex-col items-center">
                                    <span className="text-[8px] font-black uppercase text-slate-500 tracking-widest mb-1">Δ Variación Volumen (24h)</span>
                                    <div className={`flex items-center gap-1 font-mono font-black text-xs ${Number(difVol) > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {Number(difVol) > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                        {difVol} Mm³
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })()}

                <div className="status-grid">
                    <div className="status-metric">
                        <span className="metric-label flex items-center gap-1"><Gauge size={12} /> Elevación Actual</span>
                        <span className="metric-value elevation font-black font-mono tracking-tighter">{elevacion.toFixed(2)}</span>
                        <span className="metric-unit">msnm</span>
                    </div>
                    <div className="status-metric">
                        <span className="metric-label flex items-center gap-1"><Waves size={12} /> Almacenamiento</span>
                        <span className="metric-value storage font-black font-mono tracking-tighter">{almacenamiento.toFixed(1)}</span>
                        <span className="metric-unit">Mm³</span>
                    </div>
                    <div className="status-metric">
                        <span className="metric-label flex items-center gap-1"><Activity size={12} /> % Llenado (NAMO)</span>
                        <div className="fill-gauge">
                            <div className="fill-bar" style={{ width: `${Math.min(pctLlenado, 100)}%` }} />
                            <span className="fill-value font-black font-mono">{pctLlenado.toFixed(1)}%</span>
                        </div>
                    </div>
                    <div className="status-metric">
                        <span className="metric-label">Tendencia Hidráulica</span>
                        <div className="trend-indicator" style={{ color: trendColor }}>
                            <TrendIcon size={20} />
                            <span className="font-black italic">{trend === 'rising' ? 'Ascendente' : trend === 'falling' ? 'Sin extracción' : 'Estable'}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Section 4: Extraction Control */}
            <div className="extraction-section">
                <h3><Gauge size={16} /> Extracción de Presa</h3>

                <div className="extraction-grid">
                    <div className="extraction-main">
                        <span className="extraction-label">Extracción Obra de Toma (Q)</span>
                        <div className="extraction-value-box">
                            <span className="extraction-value">{extraccion > 0 ? extraccion.toFixed(1) : lect?.notas?.includes('Cerrada') ? 'Cerrada' : '0'}</span>
                            <span className="extraction-unit">{extraccion > 0 ? 'm³/s' : ''}</span>
                        </div>
                        <span className="destination-tag">→ Canal Principal</span>
                    </div>

                    {gastos.length > 0 && (
                        <div className="valves-panel">
                            <span className="valves-title">Desglose de Compuertas</span>
                            {gastos.map(g => (
                                <div key={g.name} className="valve-row">
                                    <span className="valve-name">{g.name}</span>
                                    <div className="valve-bar-container">
                                        <div className="valve-bar" style={{ width: `${extraccion > 0 ? ((g.value! / extraccion) * 100) : 0}%` }} />
                                    </div>
                                    <span className="valve-percent">{g.value!.toFixed(1)} m³/s</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Nuevo: Datos Climatológicos (CONAGUA Premium) */}
            {climaObj && (
                <div className="mt-8 border-t border-slate-700/50 pt-8">
                    <h3 className="flex items-center gap-2 text-blue-400 font-black mb-6 uppercase text-xs tracking-[0.2em] shadow-sm">
                        <ThermometerSun size={16} /> Estación Climatológica Autorizada
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="technical-card">
                            <span className="mini-chart-label flex items-center gap-1"><ThermometerSun size={12} /> Oscilación Térmica</span>
                            <div className="mt-4 px-2">
                                <TempRangeBar
                                    min={Number(climaObj.temp_minima_c || 0)}
                                    max={Number(climaObj.temp_maxima_c || 0)}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <MiniMetricChart
                                label="Precipitación"
                                value={Number(climaObj.precipitacion_mm || 0)}
                                unit="mm"
                                color="#60a5fa"
                            />
                            <MiniMetricChart
                                label="Evaporación"
                                value={Number(climaObj.evaporacion_mm || 0)}
                                unit="mm"
                                color="#fbbf24"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
                        <div className="technical-card flex items-center justify-between">
                            <span className="mini-chart-label">Viento</span>
                            <Compass direction={climaObj.dir_viento || 'N'} />
                        </div>
                        <div className="technical-card flex flex-col">
                            <span className="mini-chart-label">Visibilidad</span>
                            <span className="text-sm font-bold text-white mt-1">{climaObj.visibilidad || '--'}</span>
                        </div>
                        <div className="technical-card flex flex-col col-span-2 lg:col-span-1">
                            <span className="mini-chart-label">Estado del Tiempo</span>
                            <div className="flex gap-2 items-center mt-1">
                                <span className="text-xs font-bold text-white uppercase italic">{climaObj.edo_tiempo || '--'}</span>
                                <span className="text-[10px] text-slate-500 font-bold px-1.5 py-0.5 bg-white/5 rounded">PREV: {climaObj.edo_tiempo_24h || '--'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Nuevo: Aforos Principales (CONAGUA) */}
            {aforoObj && (
                <div className="mt-4">
                    <h3 className="flex items-center gap-2 text-emerald-400 font-bold mb-3 uppercase text-xs tracking-widest"><Map size={16} /> Aforo Principal Reportado</h3>
                    <div className="flex items-center gap-6 bg-slate-800/80 p-4 rounded-xl border-l-4 border-emerald-500 shadow-inner">
                        <div className="flex-1">
                            <span className="text-xs text-slate-400 uppercase tracking-widest font-bold">Estación Oficial</span>
                            <p className="text-lg font-bold text-white leading-none mt-1">{aforoObj.estacion}</p>
                        </div>
                        <div className="flex flex-col px-4 border-l border-slate-600">
                            <span className="text-[10px] uppercase text-slate-500 font-bold">Escala</span>
                            <span className="text-lg font-mono text-white">{aforoObj.escala ? aforoObj.escala.toFixed(2) : '--'} m</span>
                        </div>
                        <div className="flex flex-col px-4 border-l border-slate-600">
                            <span className="text-[10px] uppercase text-emerald-500 font-bold">Gasto</span>
                            <span className="text-lg font-mono text-emerald-400 font-bold">{aforoObj.gasto_m3s ? aforoObj.gasto_m3s.toFixed(2) : '--'} <span className="text-sm">m³/s</span></span>
                        </div>
                    </div>
                </div>
            )}

            {/* Section 5: Area & Safety */}
            {lect && lect.area_ha > 0 && (
                <div className="safety-section mt-4">
                    <div className="safety-grid">
                        <div className="safety-indicator">
                            <Droplets size={16} />
                            <span>Espejo de agua: {lect.area_ha.toLocaleString()} ha</span>
                        </div>
                        {lect.notas && (
                            <div className="safety-indicator">
                                <CheckCircle size={16} />
                                <span>{lect.notas}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Analytics Section: Streamgraph & Flow Diagram */}
            <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6 pt-8 border-t border-white/5">
                <div>
                    <h4 className="mini-chart-label mb-2 flex items-center gap-2">
                        <Activity size={14} className="text-blue-400" /> Tendencia de Extracción (Streamgraph)
                    </h4>
                    <p className="text-[10px] text-slate-500 mb-4 uppercase tracking-[0.2em]">Balance dinámico de gasto por sección (24h).</p>
                    <ExtractionStreamgraph movimientos={movimientosHistorial.filter(m => m.presa_id === presa.id)} />
                </div>
                <div>
                    <h4 className="mini-chart-label mb-2 flex items-center gap-2">
                        <Waves size={14} className="text-emerald-400" /> Hidro-Sincronía: Diagrama de Flujo
                    </h4>
                    <p className="text-[10px] text-slate-500 mb-4 uppercase tracking-[0.2em]">Representación esquemática del balance hídrico actual.</p>
                    <HydroFlowDiagram presa={presa} />
                </div>
            </div>

            <div className="mt-8 pt-8 border-t border-white/5">
                <h4 className="mini-chart-label mb-2 flex items-center gap-2">
                    <Gauge size={14} className="text-amber-400" /> Mapa de Calor: Eficiencia de Aforo Semanal
                </h4>
                <p className="text-[10px] text-slate-500 mb-4 uppercase tracking-[0.2em]">Intensidad de uso y estabilidad de tirantes por cuadrante temporal.</p>
                <div className="technical-card">
                    <EfficiencyHeatmap />
                </div>
            </div>

            {/* Section 6: Audit Evidence */}
            <div className="audit-section mt-12">
                <div className="audit-grid">
                    <div className="photo-placeholder">
                        <Camera size={24} />
                        <span>Foto Escala Ammerman</span>
                    </div>
                    <div className="photo-placeholder">
                        <Camera size={24} />
                        <span>Foto Obra de Toma</span>
                    </div>
                    <div className="signature-box flex-1 min-w-[200px]">
                        <Signature size={16} />
                        <span className="signature-label">Auditor CONAGUA/SRL:</span>
                        <span className="signature-name font-mono">{lect?.responsable || 'Taide Ramírez'}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Main Component
const Presas = () => {
    const { fechaSeleccionada } = useFecha();
    const { presas, clima, aforos, movimientos, movimientosHistorial, loading, error } = usePresas(fechaSeleccionada);
    const [selectedDamId, setSelectedDamId] = useState<string | null>(null);
    const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);

    // Auto-select first dam when data arrives
    const currentDam = presas.find(p => p.id === selectedDamId) || presas[0];

    // Delicias general weather summary
    const deliciasClima = clima.find(c => c.presa_id === 'PRE-003');
    const deliciasAforo = aforos.find(a => a.estacion === 'Km 104');

    if (loading && presas.length === 0) {
        return (
            <div className="presas-container flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-3 text-slate-400">
                    <Loader size={32} className="animate-spin text-blue-400" />
                    <span className="text-sm font-medium">Cargando datos de presas y clima oficial...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="presas-container flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-3 text-red-400">
                    <AlertTriangle size={32} />
                    <span className="text-sm">Error: {error}</span>
                </div>
            </div>
        );
    }

    if (!currentDam) return null;

    // Matching objects logic
    const currentClima = clima.find(c => c.presa_id === currentDam.id);
    const estAforo = currentDam.id === 'PRE-001' ? 'Km 0+580' : 'Km 106';
    const currentAforo = aforos.find(a => a.estacion === estAforo);

    // Prepare capacity curve chart data from Supabase
    const curvaData = currentDam.curva_capacidad.map((c: PuntoCurva) => ({
        elevation: c.elevacion_msnm,
        volume: c.volumen_mm3,
    }));

    return (
        <div className="presas-container">
            <header className="page-header flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Activity className="text-blue-400" />
                        Reporte Diario CONAGUA
                    </h2>
                    <p className="text-slate-400 text-sm">Validación visual de Presas, Clima y Aforos de Control • {fechaSeleccionada}</p>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                    {/* Actions Group */}
                    <div className="flex items-center gap-3">
                        <div className="conagua-badge">
                            <CheckCircle size={12} /> Oficial
                        </div>
                        <button 
                            onClick={() => setIsMoveModalOpen(true)}
                            className="btn-premium-action bg-emerald-600 hover:bg-emerald-500"
                        >
                            <PlusCircle size={14} />
                            <span>Registrar Movimiento</span>
                        </button>
                        <Link to="/importar" className="btn-premium-action">
                            <Upload size={14} />
                            <span>Capturar Documento</span>
                        </Link>
                    </div>

                    {/* Dam Selector Group */}
                    <div className="dam-selector-modern">
                        {presas.map(p => (
                            <button
                                key={p.id}
                                className={(selectedDamId || presas[0]?.id) === p.id ? 'active' : ''}
                                onClick={() => setSelectedDamId(p.id)}
                            >
                                <Waves size={14} />
                                <span>{p.nombre_corto}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            <div className="presas-layout">
                {/* Main Dam Card */}
                <div className="dam-main">
                    <DamCard presa={currentDam} climaObj={currentClima} aforoObj={currentAforo} movimientosHistorial={movimientosHistorial} />

                    {/* Dynamic Reservoir Visualization */}
                    <ReservoirViz
                        percent={currentDam.lectura?.porcentaje_llenado || 0}
                        storageMm3={currentDam.lectura?.almacenamiento_mm3 || 0}
                        maxStorageMm3={currentDam.capacidad_max_mm3}
                        areaHa={currentDam.lectura?.area_ha || 0}
                        elevationMsnm={currentDam.lectura?.escala_msnm || 0}
                        damName={currentDam.nombre_corto}
                        presaId={currentDam.id}
                    />
                </div>

                {/* Charts Sidebar */}
                <div className="charts-sidebar">
                    {/* Nuevo: Resumen Climatológico Delicias */}
                    {(deliciasClima || deliciasAforo) && (
                        <section className="delicias-summary-card mb-4 border border-slate-700/60 transition-all hover:border-slate-500/50">
                            <div className="bg-slate-800/40 p-4 flex items-center justify-between border-b border-white/5 backdrop-blur-md">
                                <h3 className="text-xs text-slate-200 font-black m-0 flex items-center gap-2 uppercase tracking-tighter">
                                    <ThermometerSun size={18} className="text-amber-500" />
                                    Delicias (Sede)
                                </h3>
                                <div className="text-[10px] bg-blue-500/10 border border-blue-500/20 px-2 py-1 rounded-full text-blue-400 font-bold">
                                    {fechaSeleccionada}
                                </div>
                            </div>

                            {deliciasClima && (
                                <div className="p-6 grid grid-cols-2 gap-4 text-sm divide-x divide-white/5">
                                    <div className="flex flex-col gap-1 items-center">
                                        <span className="text-[10px] text-slate-500 uppercase font-black text-center tracking-widest mb-1">Clima Actual</span>
                                        <div className="clima-value-main">
                                            {deliciasClima.temp_ambiente_c != null ? Number(deliciasClima.temp_ambiente_c).toFixed(1) : '--'}°
                                        </div>
                                        <span className="text-xs text-white/90 font-bold bg-white/5 px-2 py-0.5 rounded-md mt-1 italic">{deliciasClima.edo_tiempo || '--'}</span>
                                    </div>
                                    <div className="flex flex-col gap-2 pl-6 items-center justify-center">
                                        <span className="text-[10px] text-slate-500 uppercase font-black text-center tracking-widest">Ayer (24H)</span>
                                        <div className="text-sm text-slate-400 font-bold bg-slate-900/50 px-3 py-1.5 rounded-lg border border-white/5 text-center">
                                            {deliciasClima.edo_tiempo_24h || '--'}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {deliciasAforo && (
                                <div className="aforo-summary-box shadow-inner">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-emerald-500/10 rounded-lg">
                                            <Map size={16} className="text-emerald-400" />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-black text-slate-500 uppercase leading-none">Canal Km 104</span>
                                            <span className="text-xs font-bold text-slate-300">Aforo Principal</span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xl font-mono text-emerald-400 font-black">
                                            {deliciasAforo.gasto_m3s ? Number(deliciasAforo.gasto_m3s).toFixed(2) : '--'}
                                        </div>
                                        <div className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest">m³/s</div>
                                    </div>
                                </div>
                            )}
                        </section>
                    )}

                    {/* Section 5: Elevation-Capacity Curve from Supabase curvas_capacidad */}
                    <section className="chart-card">
                        <h3>Curva Elevación-Capacidades</h3>
                        <div className="chart-container">
                            <ResponsiveContainer width="100%" height={200}>
                                <AreaChart data={curvaData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorCapacity" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="volume" tick={{ fill: '#94a3b8', fontSize: 10 }} tickFormatter={(v) => `${v}`} />
                                    <YAxis dataKey="elevation" tick={{ fill: '#94a3b8', fontSize: 10 }} domain={['dataMin', 'dataMax']} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                        labelFormatter={(v) => `Vol: ${v} Mm³`}
                                        formatter={(v: any) => [`${Number(v).toFixed(2)} msnm`, 'Elevación']}
                                    />
                                    <Area type="monotone" dataKey="elevation" stroke="#3b82f6" fill="url(#colorCapacity)" />
                                </AreaChart>
                            </ResponsiveContainer>
                            {/* Current level marker */}
                            <div className="current-marker">
                                <div className="marker-dot" />
                                <span>Nivel Actual: {(currentDam.lectura?.escala_msnm || 0).toFixed(2)} msnm</span>
                            </div>
                        </div>
                    </section>

                    {/* Section: Historial de Movimientos (Gasto de Apertura) */}
                    <section className="movimientos-historial chart-card mb-4">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="m-0">Historial de Movimientos</h3>
                            <button 
                                onClick={() => setIsMoveModalOpen(true)}
                                className="text-[10px] font-black bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-500/20 hover:bg-emerald-500/20 transition-all uppercase tracking-widest"
                            >
                                Registrar
                            </button>
                        </div>
                        <div className="overflow-hidden rounded-xl border border-white/5 bg-slate-900/50">
                            <table className="w-full text-left text-xs font-mono">
                                <thead className="bg-white/5 text-[9px] font-black text-slate-500 uppercase tracking-widest">
                                    <tr>
                                        <th className="px-4 py-2">Fecha/Hora</th>
                                        <th className="px-4 py-2 text-right">Gasto</th>
                                        <th className="px-4 py-2">Origen</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {movimientos.filter((m: MovimientoPresaData) => m.presa_id === currentDam.id).length > 0 ? (
                                        movimientos.filter((m: MovimientoPresaData) => m.presa_id === currentDam.id).map((m: MovimientoPresaData) => (
                                            <tr key={m.id} className="hover:bg-white/5 transition-colors">
                                                <td className="px-4 py-3 text-slate-300">
                                                    {new Date(m.fecha_hora).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true })}
                                                </td>
                                                <td className="px-4 py-3 text-right font-black text-emerald-400">
                                                    {m.gasto_m3s.toFixed(2)} <span className="text-[9px] text-slate-500">m³/s</span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={`text-[8px] font-black px-2 py-1 rounded-md border ${
                                                        m.fuente_dato === 'GERENCIA_ADMIN' 
                                                            ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' 
                                                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                    }`}>
                                                        {m.fuente_dato}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={3} className="px-4 py-8 text-center text-slate-500 italic">No hay movimientos registrados recientes</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    {/* Section: Storage Comparative Analytic Chart */}
                    <section className="chart-card">
                        <h3>Comparativa de Almacenamiento</h3>
                        <div className="storage-comparison-viz mt-4">
                            <ResponsiveContainer width="100%" height={150}>
                                <BarChart
                                    data={presas.map(p => ({
                                        name: p.nombre_corto,
                                        volume: p.lectura?.almacenamiento_mm3 || 0,
                                        capacity: p.capacidad_max_mm3,
                                        pct: p.lectura?.porcentaje_llenado || 0
                                    }))}
                                    layout="vertical"
                                    barSize={20}
                                    margin={{ left: 0, right: 40 }}
                                >
                                    <XAxis type="number" hide domain={[0, 'dataMax']} />
                                    <YAxis
                                        dataKey="name"
                                        type="category"
                                        tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }}
                                        width={80}
                                    />
                                    <Tooltip
                                        cursor={{ fill: 'transparent' }}
                                        content={({ active, payload }) => {
                                            if (active && payload && payload.length) {
                                                const data = payload[0].payload;
                                                return (
                                                    <div className="bg-slate-900 border border-slate-700 p-2 rounded shadow-xl">
                                                        <p className="text-[10px] font-black text-white uppercase">{data.name}</p>
                                                        <p className="text-xs text-blue-400 font-mono">{data.volume.toFixed(1)} / {data.capacity.toFixed(0)} Mm³</p>
                                                        <p className="text-xs text-emerald-500 font-black">{data.pct.toFixed(1)}% Llenado</p>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                    <Bar dataKey="volume" radius={[0, 4, 4, 0]}>
                                        {presas.map((p, index) => {
                                            const pct = p.lectura?.porcentaje_llenado || 0;
                                            return <Cell key={`cell-${index}`} fill={pct > 90 ? '#f59e0b' : '#3b82f6'} />;
                                        })}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="p-4 grid grid-cols-2 gap-2">
                            {presas.map(p => (
                                <div key={`stat-${p.id}`} className="flex flex-col">
                                    <span className="text-[9px] text-slate-500 uppercase font-black">{p.nombre_corto}</span>
                                    <span className="text-xs font-bold text-white">{(p.lectura?.porcentaje_llenado || 0).toFixed(1)}%</span>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
            </div>

            {/* Managerial Modals */}
            <RegisterMovementModal 
                isOpen={isMoveModalOpen} 
                onClose={() => setIsMoveModalOpen(false)} 
                presa={currentDam}
                onSourceUpdate={() => window.location.reload()}
            />
        </div>
    );
};

export default Presas;
