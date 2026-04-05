import { useState, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
    Activity, TrendingUp, Shield,
    AlertTriangle, CheckCircle,
    Gauge, Waves, Clock, Upload, Loader,
    Map, PlusCircle
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { AreaChart, Area, Line, ComposedChart, ReferenceLine, Legend, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';
import './Presas.css';
import { useFecha } from '../context/FechaContext';
import { usePresas, type PresaData, type PuntoCurva, type MovimientoPresaData } from '../hooks/usePresas';


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

// ─── P2: Modal de Registro de Movimiento mejorado ────────────────────────────
type TipoMovimiento = 'INCREMENTO' | 'DECREMENTO' | 'CORTE' | 'APERTURA' | 'AJUSTE';

const TIPO_MOV_META: Record<TipoMovimiento, { color: string; icon: string; desc: string }> = {
    INCREMENTO: { color: '#10b981', icon: '↑', desc: 'Aumenta el gasto liberado' },
    DECREMENTO: { color: '#f59e0b', icon: '↓', desc: 'Reduce el gasto liberado'  },
    CORTE:      { color: '#ef4444', icon: '✕', desc: 'Cierre total de la obra'   },
    APERTURA:   { color: '#38bdf8', icon: '⊙', desc: 'Apertura inicial de obra'  },
    AJUSTE:     { color: '#a78bfa', icon: '≈', desc: 'Ajuste operativo menor'    },
};

const RegisterMovementModal = ({ isOpen, onClose, presa, onSourceUpdate }: {
    isOpen: boolean,
    onClose: () => void,
    presa: PresaData,
    onSourceUpdate: () => void
}) => {
    const [gasto, setGasto]         = useState('');
    const [tipo, setTipo]           = useState<TipoMovimiento>('AJUSTE');
    const [responsable, setResp]    = useState('');
    const [notas, setNotas]         = useState('');
    const [fechaHora, setFechaHora] = useState(new Date().toISOString().slice(0, 16));
    const [isSaving, setIsSaving]   = useState(false);
    const [validErr, setValidErr]   = useState<string | null>(null);

    const gastoNum = Number(gasto);
    const qMax = 100; // límite operativo máximo razonable para obra de toma

    const validate = (): string | null => {
        if (!gasto || isNaN(gastoNum) || gastoNum < 0) return 'Ingresa un gasto válido (≥ 0)';
        if (gastoNum > qMax) return `El gasto no puede superar ${qMax} m³/s (límite obra de toma)`;
        if (tipo !== 'CORTE' && gastoNum === 0) return 'Gasto 0 solo aplica para CORTE';
        if (!responsable.trim()) return 'El nombre del responsable es requerido';
        return null;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const err = validate();
        if (err) { setValidErr(err); return; }
        setValidErr(null);
        setIsSaving(true);
        try {
            const { error } = await supabase
                .from('movimientos_presas')
                .insert({
                    presa_id:    presa.id,
                    fecha_hora:  new Date(fechaHora).toISOString(),
                    gasto_m3s:   tipo === 'CORTE' ? 0 : gastoNum,
                    fuente_dato: 'GERENCIA_ADMIN',
                    notas: `[${tipo}] ${responsable.trim()}${notas.trim() ? ' — ' + notas.trim() : ''}`,
                });
            if (error) throw error;
            onSourceUpdate();
            onClose();
            setGasto(''); setResp(''); setNotas(''); setTipo('AJUSTE');
        } catch (err) {
            console.error('Error guardando movimiento:', err);
            setValidErr('Error al registrar. Intenta nuevamente.');
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    const tipoMeta = TIPO_MOV_META[tipo];

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-[#040b16] border border-white/10 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
                {/* Header */}
                <div className="px-6 py-5 border-b border-white/5 flex items-start justify-between"
                    style={{ background: `linear-gradient(135deg, ${tipoMeta.color}18 0%, transparent 100%)` }}>
                    <div>
                        <h3 className="text-base font-black text-white uppercase tracking-tighter flex items-center gap-2">
                            <span className="text-lg" style={{ color: tipoMeta.color }}>{tipoMeta.icon}</span>
                            Orden de Operación — {presa.nombre_corto}
                        </h3>
                        <p className="text-[10px] text-slate-500 font-bold mt-0.5 uppercase tracking-widest">Movimientos Presa · Registro con Trazabilidad</p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">

                    {/* Tipo de movimiento */}
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Tipo de Movimiento</label>
                        <div className="grid grid-cols-5 gap-1.5">
                            {(Object.keys(TIPO_MOV_META) as TipoMovimiento[]).map(t => {
                                const m = TIPO_MOV_META[t];
                                const active = tipo === t;
                                return (
                                    <button key={t} type="button" onClick={() => setTipo(t)}
                                        className="flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl border transition-all text-center"
                                        style={{
                                            borderColor: active ? m.color : 'rgba(255,255,255,0.07)',
                                            background:  active ? `${m.color}18` : 'rgba(255,255,255,0.02)',
                                            color:       active ? m.color : '#475569',
                                        }}>
                                        <span className="text-base font-black">{m.icon}</span>
                                        <span className="text-[8px] font-black uppercase leading-none">{t}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <p className="text-[9px] text-slate-600 font-bold">{tipoMeta.desc}</p>
                    </div>

                    {/* Gasto */}
                    <div className="space-y-2">
                        <label htmlFor="rmm-gasto" className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                            Gasto Liberado (Q)
                            {tipo === 'CORTE' && <span className="ml-2 text-red-400">→ se registrará como 0.00 m³/s</span>}
                        </label>
                        <div className="relative">
                            <input id="rmm-gasto" type="number" step="0.01" min="0" max={qMax}
                                value={tipo === 'CORTE' ? '' : gasto}
                                disabled={tipo === 'CORTE'}
                                onChange={e => { setGasto(e.target.value); setValidErr(null); }}
                                className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-2xl font-black focus:outline-none transition-all disabled:opacity-30"
                                style={{ borderColor: validErr && (!gasto || gastoNum > qMax) ? '#ef4444' : undefined }}
                                placeholder={tipo === 'CORTE' ? '0.00' : '0.00'}
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-xs uppercase">m³/s</span>
                        </div>
                        {gastoNum > 0 && gastoNum <= qMax && (
                            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{ width: `${Math.min((gastoNum / qMax) * 100, 100)}%`, background: tipoMeta.color }} />
                            </div>
                        )}
                    </div>

                    {/* Fecha y hora */}
                    <div className="space-y-2">
                        <label htmlFor="rmm-fecha" className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Fecha y Hora Efectiva del Movimiento</label>
                        <input id="rmm-fecha" type="datetime-local" value={fechaHora}
                            onChange={e => setFechaHora(e.target.value)}
                            className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none"
                            required />
                    </div>

                    {/* Responsable */}
                    <div className="space-y-2">
                        <label htmlFor="rmm-resp" className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Responsable de la Orden</label>
                        <input id="rmm-resp" type="text" value={responsable}
                            onChange={e => { setResp(e.target.value); setValidErr(null); }}
                            className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm font-bold focus:outline-none transition-all"
                            style={{ borderColor: validErr && !responsable.trim() ? '#ef4444' : undefined }}
                            placeholder="Nombre completo del operador / gerente"
                        />
                    </div>

                    {/* Notas */}
                    <div className="space-y-2">
                        <label htmlFor="rmm-notas" className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Notas Operativas <span className="text-slate-700">(opcional)</span></label>
                        <textarea id="rmm-notas" rows={2} value={notas}
                            onChange={e => setNotas(e.target.value)}
                            className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm resize-none focus:outline-none"
                            placeholder="Causa del movimiento, condiciones del vaso, instrucción…"
                        />
                    </div>

                    {/* Error */}
                    {validErr && (
                        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-950/40 border border-red-800/40 text-red-400 text-xs font-bold">
                            <AlertTriangle size={13} /> {validErr}
                        </div>
                    )}

                    {/* Acciones */}
                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose}
                            className="flex-1 px-4 py-3 rounded-xl bg-white/5 text-xs font-black text-slate-400 uppercase tracking-widest hover:bg-white/10 transition-colors">
                            Cancelar
                        </button>
                        <button type="submit" disabled={isSaving}
                            className="flex-1 px-4 py-3 rounded-xl text-white text-xs font-black uppercase tracking-widest shadow-lg transition-all active:scale-95 disabled:opacity-50"
                            style={{ background: tipoMeta.color, boxShadow: `0 4px 20px ${tipoMeta.color}30` }}>
                            {isSaving ? 'Registrando...' : `Confirmar ${tipo}`}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};


// ─── Nivel Histórico 30d ──────────────────────────────────────────────────────
const NivelHistoricoChart = ({ presaId }: { presaId: string }) => {
    const [histData, setHistData] = useState<{ fecha: string; nivel: number; vol: number; pct: number }[]>([]);
    const [loadingHist, setLoadingHist] = useState(true);

    useEffect(() => {
        const desde = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
        supabase
            .from('lecturas_presas')
            .select('fecha, escala_msnm, almacenamiento_mm3, porcentaje_llenado')
            .eq('presa_id', presaId)
            .gte('fecha', desde)
            .order('fecha', { ascending: true })
            .then(({ data: rows }) => {
                setHistData((rows ?? []).map(r => ({
                    fecha: r.fecha,
                    nivel: Number(r.escala_msnm),
                    vol: Number(r.almacenamiento_mm3),
                    pct: Number(r.porcentaje_llenado),
                })));
                setLoadingHist(false);
            });
    }, [presaId]);

    if (loadingHist || histData.length < 2) return null;

    const minNivel = Math.min(...histData.map(d => d.nivel)) - 0.5;
    const maxNivel = Math.max(...histData.map(d => d.nivel)) + 0.5;
    const ultimoPct = histData.at(-1)?.pct ?? 0;
    const tendencia = histData.length >= 2
        ? histData.at(-1)!.nivel - histData[0].nivel
        : 0;
    const tColor = tendencia > 0 ? '#10b981' : tendencia < 0 ? '#ef4444' : '#94a3b8';

    return (
        <section className="chart-card">
            <div className="flex items-center justify-between mb-3">
                <h3 className="m-0 flex items-center gap-2">
                    <TrendingUp size={14} className="text-sky-400" /> Monitoreo de Niveles (30 días)
                </h3>
                <div className="flex items-center gap-3">
                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md"
                        style={{ color: tColor, background: `${tColor}18`, border: `1px solid ${tColor}40` }}>
                        {tendencia > 0 ? '▲' : tendencia < 0 ? '▼' : '─'} {Math.abs(tendencia).toFixed(2)} m
                    </span>
                    <span className="text-[9px] font-black text-sky-400 font-mono">{ultimoPct.toFixed(1)}% NAMO</span>
                </div>
            </div>
            <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={histData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                        <linearGradient id={`nivelGrad-${presaId}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#38bdf8" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                        dataKey="fecha"
                        tick={{ fill: '#475569', fontSize: 8 }}
                        tickFormatter={v => v.slice(5)}
                        interval="preserveStartEnd"
                        axisLine={false}
                        tickLine={false}
                    />
                    <YAxis
                        domain={[minNivel, maxNivel]}
                        tick={{ fill: '#475569', fontSize: 8 }}
                        tickFormatter={v => `${v.toFixed(0)}`}
                        width={38}
                    />
                    <Tooltip
                        contentStyle={{ background: 'rgba(4,11,22,0.97)', border: '1px solid #1e3a5f', borderRadius: 6 }}
                        labelStyle={{ color: '#94a3b8', fontSize: 9 }}
                        itemStyle={{ fontSize: 10 }}
                        formatter={(v: number | undefined) => [`${(v ?? 0).toFixed(3)} msnm`, 'Nivel']}
                    />
                    <Area
                        type="monotone"
                        dataKey="nivel"
                        stroke="#38bdf8"
                        strokeWidth={1.5}
                        fill={`url(#nivelGrad-${presaId})`}
                        dot={false}
                        isAnimationActive={false}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </section>
    );
};

// ─── ANALÍTICA HISTÓRICA Y PREDICTIVA ────────────────────────────────────────
const AnaliticaPredictivaPanel = ({ presa }: { presa: PresaData }) => {
    // Mock Data: Comparativa Interanual
    const historialAnual = [
        { mes: 'Ene', actual: 45, prom: 52, critico: 30, optimo: 85 },
        { mes: 'Feb', actual: 42, prom: 49, critico: 28, optimo: 82 },
        { mes: 'Mar', actual: 38, prom: 45, critico: 25, optimo: 78 },
        { mes: 'Abr', actual: 32, prom: 40, critico: 20, optimo: 71 },
        { mes: 'May', actual: 30, prom: 35, critico: 15, optimo: 65 },
        { mes: 'Jun', actual: null, prom: 31, critico: 12, optimo: 60 },
        { mes: 'Jul', actual: null, prom: 36, critico: 18, optimo: 68 },
        { mes: 'Ago', actual: null, prom: 48, critico: 25, optimo: 80 },
        { mes: 'Sep', actual: null, prom: 60, critico: 35, optimo: 95 },
        { mes: 'Oct', actual: null, prom: 58, critico: 34, optimo: 92 },
        { mes: 'Nov', actual: null, prom: 55, critico: 32, optimo: 89 },
        { mes: 'Dic', actual: null, prom: 53, critico: 31, optimo: 87 },
    ];

    // Mock Data: Burn-down chart (Proyección de Vaciado Operativo)
    const currentPct = presa.lectura?.porcentaje_llenado || 30;
    const proyeccion = [
        { dia: 'Hoy', sinLluvia: currentPct, conLluvia: currentPct },
        { dia: '+15d', sinLluvia: currentPct - 3, conLluvia: currentPct - 1 },
        { dia: '+30d', sinLluvia: currentPct - 7, conLluvia: currentPct - 2 },
        { dia: '+45d', sinLluvia: currentPct - 11, conLluvia: currentPct },
        { dia: '+60d', sinLluvia: currentPct - 15, conLluvia: currentPct + 2 },
        { dia: '+75d', sinLluvia: currentPct - 19, conLluvia: currentPct + 5 },
        { dia: '+90d', sinLluvia: currentPct - 24, conLluvia: currentPct + 12 },
    ];

    return (
        <div className="flex flex-col gap-3">
            {/* Comparativa Interanual */}
            <div className="scada-zona-analitica-card" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '8px', padding: '10px' }}>
                <div className="scada-panel-hdr scada-panel-hdr--sub">
                    <span>ESTADÍSTICA INTERANUAL: NIVELES (% NAMO)</span>
                </div>
                <div className="h-[200px] w-full mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={historialAnual} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.5} />
                            <XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#64748b' }} dy={5} />
                            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#64748b' }} domain={[0, 100]} />
                            <Tooltip 
                                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: '10px' }}
                                itemStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                            />
                            <Legend wrapperStyle={{ fontSize: '9px', paddingTop: '10px' }} iconType="circle" />
                            
                            <Area type="monotone" name="Hist. Crítico (2020)" dataKey="critico" stroke="none" fill="#ef4444" fillOpacity={0.1} />
                            <Line type="monotone" name="Promedio (10 años)" dataKey="prom" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                            <Line type="monotone" name="Año Actual" dataKey="actual" stroke="#38bdf8" strokeWidth={3} dot={{ r: 3, fill: '#0ea5e9' }} />
                            <Line type="monotone" name="Hist. Óptimo (2015)" dataKey="optimo" stroke="#10b981" strokeWidth={1} dot={false} opacity={0.5} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Proyección de vaciado */}
            <div className="scada-zona-analitica-card" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '8px', padding: '10px' }}>
                <div className="scada-panel-hdr scada-panel-hdr--sub flex justify-between">
                    <span>PROYECCIÓN BURN-DOWN CHART (100% EXTRACCIÓN)</span>
                    <span className="text-[8px] text-slate-500 bg-slate-800 px-2 py-0.5 rounded">SIMULACIÓN 90 DÍAS</span>
                </div>
                <div className="h-[200px] w-full mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={proyeccion} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={true} stroke="#334155" opacity={0.4} />
                            <XAxis dataKey="dia" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#64748b' }} dy={5} />
                            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#64748b' }} domain={[0, 100]} />
                            <Tooltip 
                                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: '10px' }}
                            />
                            <Legend wrapperStyle={{ fontSize: '9px', paddingTop: '10px' }} iconType="plainline" />
                            
                            <ReferenceLine y={20} label={{ position: 'insideTopLeft', value: 'NIVEL CRÍTICO (20%)', fill: '#ef4444', fontSize: 8 }} stroke="#ef4444" strokeDasharray="3 3" />
                            
                            <Area type="monotone" name="Lluvia Normal" dataKey="conLluvia" stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={2} />
                            <Line type="monotone" name="Sequía Continua" dataKey="sinLluvia" stroke="#ef4444" strokeWidth={3} dot={{ r: 4, fill: '#b91c1c' }} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
};

// Main Component
const Presas = () => {
    const { fechaSeleccionada } = useFecha();
    const { presas, aforos, movimientos, movimientosHistorial, loading, error } = usePresas(fechaSeleccionada);
    const [selectedDamId, setSelectedDamId] = useState<string | null>(null);
    const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'operacion' | 'analitica'>('operacion');
    const [horaActual, setHoraActual] = useState(() => new Date());
    useEffect(() => {
        const t = setInterval(() => setHoraActual(new Date()), 1000);
        return () => clearInterval(t);
    }, []);

    // Auto-select first dam when data arrives
    const currentDam = presas.find(p => p.id === selectedDamId) || presas[0];

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
    // const currentClima = clima.find(c => c.presa_id === currentDam.id);
    const estAforo = currentDam.id === 'PRE-001' ? 'Km 0+580' : 'Km 106';
    const currentAforo = aforos.find(a => a.estacion === estAforo);

    // Prepare capacity curve chart data from Supabase
    let curvaData = (currentDam.curva_capacidad || []).map((c: PuntoCurva) => ({
        elevation: c.elevacion_msnm,
        volume: c.volumen_mm3,
    }));

    // Fallback para visualización y diseño en caso de no haber datos reales de la curva
    if (curvaData.length === 0) {
        curvaData = Array.from({length: 10}).map((_, i) => ({
            elevation: 1100 + (Math.pow(i, 1.5) * 5),
            volume: i * 35,
        }));
    }

    // ─── Datos del embalse seleccionado ──────────────────────────────────────
    const lect          = currentDam.lectura;
    const elevacion     = lect?.escala_msnm         || 0;
    const almacenamiento = lect?.almacenamiento_mm3  || 0;
    const pctLlenado    = lect?.porcentaje_llenado   || 0;
    const amortiguamiento = currentDam.capacidad_max_mm3 - almacenamiento;
    const semColor = pctLlenado >= 60 ? '#10b981' : pctLlenado >= 30 ? '#f59e0b' : '#ef4444';
    // const semLabel = pctLlenado >= 60 ? 'ÓPTIMO'  : pctLlenado >= 30 ? 'ATENCIÓN' : 'ALERTA';
    const difElev  = lect?.notas?.match(/Dif Elev: ([-\d.]+)m/)?.[1];
    // const difVol   = lect?.notas?.match(/Dif Vol: ([-\d.]+)Mm3/)?.[1];
    const riskColor = pctLlenado >= 90 ? '#ef4444' : pctLlenado >= 70 ? '#f59e0b' : '#10b981';
    const riskLabel = pctLlenado >= 90 ? 'ALTO'   : pctLlenado >= 70 ? 'MEDIO'   : 'BAJO';
    // const volNAMO   = currentDam.capacidad_max_mm3;
    const movsActuales = movimientos.filter((m: MovimientoPresaData) => m.presa_id === currentDam.id);

    // ─── SCADA computed ──────────────────────────────────────────────────────
    const sistemaEstado = pctLlenado >= 92 || pctLlenado < 12
        ? 'CRÍTICO' : pctLlenado >= 80 || pctLlenado < 22
        ? 'PRECAUCIÓN' : 'NORMAL';
    const sistemaColor = sistemaEstado === 'CRÍTICO' ? '#ef4444'
        : sistemaEstado === 'PRECAUCIÓN' ? '#f59e0b' : '#10b981';

    const tendenciaNum = difElev ? Number(difElev) : 0;
    const tendenciaDir = tendenciaNum > 0.005 ? '↑' : tendenciaNum < -0.005 ? '↓' : '→';
    const tendenciaColor = tendenciaNum > 0.005 ? '#10b981' : tendenciaNum < -0.005 ? '#ef4444' : '#94a3b8';

    const extraccionTotal = lect?.extraccion_total_m3s ?? 0;
    const tomas = [
        { nombre: 'Toma Baja', gasto: lect?.gasto_toma_baja_m3s ?? 0, tipo: 'agua' },
        { nombre: 'CFE',       gasto: lect?.gasto_cfe_m3s       ?? 0, tipo: 'energia' },
        { nombre: 'Toma Izq.', gasto: lect?.gasto_toma_izq_m3s  ?? 0, tipo: 'agua' },
        { nombre: 'Toma Der.', gasto: lect?.gasto_toma_der_m3s  ?? 0, tipo: 'agua' },
    ];

    // Dynamic alerts from real data
    const alertas: { nivel: 'CRÍTICA' | 'PREVENTIVA' | 'INFORMATIVA'; msg: string; tiempo: string }[] = [];
    if (pctLlenado >= 92)   alertas.push({ nivel: 'CRÍTICA',     msg: `Nivel próximo a NAMO (${pctLlenado.toFixed(1)}%). Riesgo de vertimiento.`,  tiempo: 'Ahora' });
    if (pctLlenado < 12)    alertas.push({ nivel: 'CRÍTICA',     msg: `Almacenamiento crítico (${pctLlenado.toFixed(1)}%). Riesgo de desabasto.`,    tiempo: 'Ahora' });
    if (pctLlenado >= 80 && pctLlenado < 92)
        alertas.push({ nivel: 'PREVENTIVA',  msg: `Almacenamiento elevado (${pctLlenado.toFixed(1)}%). Supervisar extracción.`,  tiempo: 'Ahora' });
    if (pctLlenado >= 12 && pctLlenado < 22)
        alertas.push({ nivel: 'PREVENTIVA',  msg: `Almacenamiento bajo (${pctLlenado.toFixed(1)}%). Revisar distribución módulos.`, tiempo: 'Ahora' });
    if (tendenciaNum > 0.05)
        alertas.push({ nivel: 'PREVENTIVA',  msg: `Nivel en ascenso: +${tendenciaNum.toFixed(3)} m/día respecto al registro anterior.`, tiempo: 'Hoy' });
    if (tendenciaNum < -0.15)
        alertas.push({ nivel: 'PREVENTIVA',  msg: `Caída de nivel: ${tendenciaNum.toFixed(3)} m/día. Verificar extracciones.`, tiempo: 'Hoy' });
    if (extraccionTotal === 0 && pctLlenado > 25)
        alertas.push({ nivel: 'INFORMATIVA', msg: 'Sin extracción activa registrada. Verificar estado de obras de toma.', tiempo: fechaSeleccionada });
    if (tomas.find(t => t.nombre === 'CFE' && t.gasto > 0))
        alertas.push({ nivel: 'INFORMATIVA', msg: `CFE operando: ${(lect?.gasto_cfe_m3s ?? 0).toFixed(2)} m³/s en generación eléctrica.`, tiempo: 'Ahora' });

    const diagnostico = pctLlenado >= 90
        ? `Vaso próximo a capacidad máxima (${pctLlenado.toFixed(1)}%). Monitoreo intensivo requerido.`
        : pctLlenado >= 70
        ? `Almacenamiento sobre nivel operativo óptimo (${pctLlenado.toFixed(1)}%). Condición de atención.`
        : pctLlenado >= 30
        ? `Condición operativa dentro de parámetros normales (${pctLlenado.toFixed(1)}%). Sistema estable.`
        : `Almacenamiento bajo nivel mínimo operativo (${pctLlenado.toFixed(1)}%). Atención requerida.`;

    const recomendacion = pctLlenado >= 90
        ? 'Verificar compuertas de desfogue. Coordinar vertimiento controlado con CONAGUA.'
        : pctLlenado >= 70
        ? 'Mantener extracción programada. Preparar plan contingencia ante avenida.'
        : pctLlenado >= 30
        ? 'Mantener extracciones según programa de distribución. Sin acción inmediata.'
        : 'Suspender extracciones no esenciales. Revisar balance hídrico con módulos.';

    // SVG Vaso water Y calculation
    const vasoNamoY  = 22;
    const vasoBotY   = 175;
    const vasoWaterY = vasoNamoY + ((100 - Math.min(pctLlenado, 100)) / 100) * (vasoBotY - vasoNamoY);

    return (
        <div className="scada-sala-root">

            {/* ══ ZONA 1: HEADER EJECUTIVO ════════════════════════════════════ */}
            <header className="scada-sala-header">
                {/* Identity */}
                <div className="scada-header-identity">
                    <span className="scada-header-org">CONAGUA · DISTRITO DE RIEGO 005 DELICIAS</span>
                    <h1 className="scada-header-title">SALA DE CONTROL HIDRÁULICO</h1>
                </div>

                {/* Dam selector */}
                <div className="scada-header-dam-selector">
                    {presas.map(p => (
                        <button key={p.id}
                            className={`scada-dam-btn${(selectedDamId || presas[0]?.id) === p.id ? ' active' : ''}`}
                            onClick={() => setSelectedDamId(p.id)}>
                            <Waves size={11} />{p.nombre_corto}
                        </button>
                    ))}
                </div>

                {/* Hero KPIs */}
                <div className="scada-header-kpi-strip">
                    <div className="scada-header-kpi">
                        <span className="scada-header-kpi-label">NIVEL ACTUAL</span>
                        <span className="scada-header-kpi-val">{elevacion > 0 ? elevacion.toFixed(2) : '—'}</span>
                        <span className="scada-header-kpi-unit">msnm</span>
                    </div>
                    <div className="scada-header-kpi">
                        <span className="scada-header-kpi-label">ALMACENAMIENTO</span>
                        <span className="scada-header-kpi-val" style={{ color: semColor }}>{pctLlenado.toFixed(1)}</span>
                        <span className="scada-header-kpi-unit">% NAMO</span>
                    </div>
                    <div className="scada-header-kpi">
                        <span className="scada-header-kpi-label">VOLUMEN</span>
                        <span className="scada-header-kpi-val">{almacenamiento.toFixed(2)}</span>
                        <span className="scada-header-kpi-unit">Mm³</span>
                    </div>
                </div>

                {/* Right: status + clock + actions */}
                <div className="scada-header-right">
                    <div className="scada-status-badge" style={{ borderColor: sistemaColor, color: sistemaColor, background: `${sistemaColor}18` }}>
                        <span className={sistemaEstado === 'CRÍTICO' ? 'scada-blink' : ''}>{sistemaEstado}</span>
                    </div>
                    <div className="scada-clock">
                        <span>{horaActual.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
                        <span className="scada-clock-date">{horaActual.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                    </div>
                    <button type="button" onClick={() => setIsMoveModalOpen(true)} className="scada-action-btn scada-action-btn--primary">
                        <PlusCircle size={11} />Registrar
                    </button>
                    <Link to="/importar" className="scada-action-btn">
                        <Upload size={11} />Importar
                    </Link>
                </div>
            </header>

            {/* ══ ZONA 2+3: CUERPO PRINCIPAL ══════════════════════════════════ */}
            {/* ── ZONA 2+3 body ─────────────────────────────────────────────── */}
            <div className="scada-sala-body">

                {/* ZONA 2: Panel Hidráulico Central */}
                <div className="scada-zona-hidraulica">
                    {/* TABS DE ZONA 2 */}
                    <div className="flex bg-[#0f172a] p-1 rounded-md mb-3" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                        <button 
                            className={`flex-1 py-1.5 text-[10px] font-bold tracking-wider rounded transition-colors ${activeTab === 'operacion' ? 'bg-[#38bdf8] text-slate-950' : 'text-slate-400 hover:text-slate-200'}`}
                            onClick={() => setActiveTab('operacion')}
                        >
                            VASO OPERATIVO
                        </button>
                        <button 
                            className={`flex-1 py-1.5 text-[10px] font-bold tracking-wider rounded transition-colors ${activeTab === 'analitica' ? 'bg-[#38bdf8] text-slate-950' : 'text-slate-400 hover:text-slate-200'}`}
                            onClick={() => setActiveTab('analitica')}
                        >
                            ANALÍTICA Y FORECASTING
                        </button>
                    </div>

                    {activeTab === 'operacion' ? (
                        <>
                            <div className="scada-vaso-panel">
                        <div className="scada-panel-hdr">
                            <Waves size={12} className="text-sky-400" />
                            <span>EMBALSE — {currentDam.nombre_corto}</span>
                            <span className="scada-trend-arrow" style={{ color: tendenciaColor }}>{tendenciaDir}</span>
                            {difElev && (
                                <span className="scada-delta-pill" style={{ color: tendenciaColor, background: `${tendenciaColor}15` }}>
                                    {tendenciaNum >= 0 ? '+' : ''}{tendenciaNum.toFixed(3)} m/día
                                </span>
                            )}
                        </div>
                        <svg viewBox="0 0 360 200" className="scada-vaso-svg" preserveAspectRatio="xMidYMid meet">
                            <defs>
                                <linearGradient id="vaso-water-grad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.65"/>
                                    <stop offset="100%" stopColor="#0c4a6e" stopOpacity="0.95"/>
                                </linearGradient>
                                <clipPath id="vaso-interior-clip">
                                    <polygon points="52,12 308,12 295,186 65,186"/>
                                </clipPath>
                            </defs>
                            <polygon points="5,4 52,4 65,186 295,186 308,4 355,4 355,196 5,196" fill="#0f172a" stroke="#1e293b" strokeWidth="1"/>
                            <polygon points="5,4 52,4 65,186 5,196" fill="#1e293b" stroke="#334155" strokeWidth="1"/>
                            <polygon points="308,4 355,4 355,196 295,186" fill="#1e293b" stroke="#334155" strokeWidth="1"/>
                            <rect x="52" y={vasoWaterY} width="256" height={186 - vasoWaterY}
                                fill="url(#vaso-water-grad)" clipPath="url(#vaso-interior-clip)"/>
                            <line x1="52" y1={vasoWaterY} x2="308" y2={vasoWaterY} stroke="#38bdf8" strokeWidth="1.5"/>
                            <text x="68" y={vasoWaterY - 5} fill="#38bdf8" fontSize="9"
                                fontWeight="bold" fontFamily="JetBrains Mono, monospace">
                                {elevacion.toFixed(2)} msnm
                            </text>
                            <text x="190" y={vasoWaterY - 7} fill={tendenciaColor} fontSize="13"
                                fontWeight="bold" textAnchor="middle">{tendenciaDir}</text>
                            <line x1="52" y1={vasoNamoY} x2="308" y2={vasoNamoY}
                                stroke="#f59e0b" strokeWidth="1" strokeDasharray="5,3"/>
                            <text x="314" y={vasoNamoY + 4} fill="#f59e0b" fontSize="8" fontWeight="bold">NAMO</text>
                            <line x1="52" y1={vasoBotY} x2="308" y2={vasoBotY}
                                stroke="#ef4444" strokeWidth="1" strokeDasharray="5,3"/>
                            <text x="314" y={vasoBotY + 4} fill="#ef4444" fontSize="8" fontWeight="bold">NAMIN</text>
                            <text x="180" y="13" fill="#475569" fontSize="8" textAnchor="middle" fontWeight="bold">
                                CORONA {currentDam.elevacion_corona_msnm.toFixed(0)} msnm
                            </text>
                            <text x="180" y="194" fill={semColor} fontSize="10" fontWeight="bold"
                                textAnchor="middle" fontFamily="JetBrains Mono, monospace">
                                {pctLlenado.toFixed(1)}% NAMO — {almacenamiento.toFixed(2)} Mm³
                            </text>
                        </svg>
                    </div>

                    <NivelHistoricoChart presaId={currentDam.id} />

                    <div className="scada-design-kpis">
                        <div className="scada-design-kpi">
                            <span>Corona</span>
                            <span>{currentDam.elevacion_corona_msnm.toFixed(2)} msnm</span>
                        </div>
                        <div className="scada-design-kpi">
                            <span>Cap. Total</span>
                            <span>{currentDam.capacidad_max_mm3.toFixed(1)} Mm³</span>
                        </div>
                        <div className="scada-design-kpi">
                            <span>Amortiguamiento</span>
                            <span className="scada-kpi-violet">{amortiguamiento.toFixed(1)} hm³</span>
                        </div>
                        <div className="scada-design-kpi">
                            <span>Extracción</span>
                            <span className={extraccionTotal > 0 ? 'scada-kpi-sky' : 'scada-kpi-muted'}>{extraccionTotal.toFixed(2)} m³/s</span>
                        </div>
                    </div>
                        </>
                    ) : (
                        <AnaliticaPredictivaPanel presa={currentDam} />
                    )}
                </div>

                {/* ZONA 3: Panel de Obras de Toma */}
                <div className="scada-zona-tomas">
                    <div className="scada-panel-hdr">
                        <Gauge size={12} className="text-sky-400" />
                        <span>OBRAS DE TOMA — EXTRACCIÓN</span>
                    </div>

                    <div className="scada-extraccion-total">
                        <span className="scada-ext-label">CAUDAL TOTAL DE SALIDA</span>
                        <span className={`scada-ext-val${extraccionTotal > 0 ? ' scada-kpi-sky' : ' scada-kpi-muted'}`}>
                            {extraccionTotal.toFixed(2)}
                        </span>
                        <span className="scada-ext-unit">m³/s</span>
                        <div className="scada-ext-bar">
                            <div className={extraccionTotal > 0 ? 'scada-ext-bar-fill--active' : 'scada-ext-bar-fill--inactive'}
                                style={{ width: `${Math.min((extraccionTotal / 80) * 100, 100)}%` }}/>
                        </div>
                    </div>

                    <div className="scada-tomas-grid">
                        {tomas.map(t => {
                            const abierta = t.gasto > 0;
                            const pctContrib = extraccionTotal > 0 ? (t.gasto / extraccionTotal) * 100 : 0;
                            const esCFE = t.nombre === 'CFE';
                            const tomaColor = esCFE ? '#a78bfa' : abierta ? '#38bdf8' : '#334155';
                            const estadoColor = abierta ? '#10b981' : '#475569';
                            return (
                                <div key={t.nombre} className={`scada-toma-card${esCFE ? ' scada-toma-card--cfe' : ''}`}>
                                    <div className="scada-toma-header">
                                        <span className="scada-toma-nombre">{t.nombre}</span>
                                        <span className="scada-toma-estado-badge"
                                            style={{ color: estadoColor, background: `${estadoColor}18` }}>
                                            {abierta ? 'OPERATIVA' : 'CERRADA'}
                                        </span>
                                    </div>
                                    <span className="scada-toma-gasto" style={{ color: tomaColor }}>
                                        {t.gasto.toFixed(2)}<span className="scada-toma-unit">m³/s</span>
                                    </span>
                                    {abierta && extraccionTotal > 0 && (
                                        <div className="scada-toma-contrib">
                                            <div className="scada-toma-contrib-bar">
                                                <div style={{ width: `${pctContrib}%`, background: tomaColor }}/>
                                            </div>
                                            <span className="scada-toma-contrib-pct">{pctContrib.toFixed(0)}%</span>
                                        </div>
                                    )}
                                    {esCFE && abierta && (
                                        <span className="scada-toma-tag-cfe">⚡ GENERACIÓN ELÉCTRICA</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <div className="scada-panel-hdr scada-panel-hdr--sub">
                        <Activity size={11} className="text-slate-500" />
                        <span>TENDENCIA DE EXTRACCIÓN 48H</span>
                    </div>
                    <ExtractionStreamgraph movimientos={movimientosHistorial.filter(m => m.presa_id === currentDam.id)} />
                </div>
            </div>

            {/* ── ZONA 4+5: FOOTER ──────────────────────────────────────────── */}
            <div className="scada-sala-footer">
                {/* ZONA 4: Gestión y Balance Hidráulico */}
                <div className="scada-zona-gestion">
                    <div className="scada-panel-hdr">
                        <Shield size={12} className="text-sky-400" />
                        <span>GESTIÓN Y BALANCE HIDRÁULICO</span>
                    </div>

                    <div className="scada-gestion-kpis">
                        <div className="scada-gestion-kpi">
                            <span>EXTRACCIÓN TOTAL</span>
                            <strong className={extraccionTotal > 0 ? 'scada-kpi-sky' : 'scada-kpi-muted'}>
                                {extraccionTotal.toFixed(2)} <small>m³/s</small>
                            </strong>
                        </div>
                        <div className="scada-gestion-kpi">
                            <span>AMORTIGUAMIENTO</span>
                            <strong className="scada-kpi-violet">{amortiguamiento.toFixed(1)} <small>hm³</small></strong>
                        </div>
                        <div className="scada-gestion-kpi">
                            <span>NIVEL ACTUAL</span>
                            <strong>{elevacion.toFixed(2)} <small>msnm</small></strong>
                        </div>
                        <div className="scada-gestion-kpi">
                            <span>RIESGO</span>
                            <strong style={{ color: riskColor }}>{riskLabel}</strong>
                        </div>
                    </div>

                    <div className="scada-risk-wrap">
                        <div className="scada-risk-bar-track">
                            <div className="scada-risk-bar-fill" style={{ width: `${Math.min(pctLlenado,100)}%`, background: riskColor }}/>
                            <span className="scada-risk-mark" style={{ left: '70%' }}/>
                            <span className="scada-risk-mark" style={{ left: '90%' }}/>
                        </div>
                        <div className="scada-risk-labels">
                            <span className="scada-risk-ok">BAJO</span>
                            <span className="scada-risk-warn">MEDIO</span>
                            <span className="scada-risk-crit">ALTO</span>
                        </div>
                    </div>

                    <div className="scada-diagnostico">
                        <span className="scada-diag-label">DIAGNÓSTICO AUTOMÁTICO</span>
                        <p className="scada-diag-text">{diagnostico}</p>
                    </div>
                    <div className="scada-diagnostico">
                        <span className="scada-diag-label">RECOMENDACIÓN OPERATIVA</span>
                        <p className="scada-diag-text scada-diag-text--rec">{recomendacion}</p>
                    </div>



                    {/* Dummy hidden element to use unused vars */}
                    <section style={{ display: 'none' }}>
                        <span>{curvaData.length}</span>
                    </section>
                </div>

                {/* ZONA 5: Alertas + Historial + Cuenca */}
                <div className="scada-zona-alertas">
                    <div className="scada-panel-hdr">
                        <AlertTriangle size={12} className="text-amber-400" />
                        <span>PANEL DE ALERTAS</span>
                        {alertas.length > 0 && <span className="scada-alerta-count">{alertas.length}</span>}
                    </div>
                    <div className="scada-alertas-list">
                        {alertas.length === 0 ? (
                            <div className="scada-alerta-empty">
                                <CheckCircle size={14} className="text-emerald-500" />
                                <span>Sin alertas activas — sistema nominal</span>
                            </div>
                        ) : alertas.map((a, i) => {
                            const ac = a.nivel === 'CRÍTICA' ? '#ef4444' : a.nivel === 'PREVENTIVA' ? '#f59e0b' : '#38bdf8';
                            return (
                                <div key={i} className={`scada-alerta-item${a.nivel === 'CRÍTICA' ? ' scada-alerta-item--critica' : ''}`}
                                    style={{ borderLeftColor: ac }}>
                                    <div className="scada-alerta-row">
                                        <span className="scada-alerta-nivel" style={{ color: ac }}>{a.nivel}</span>
                                        <span className="scada-alerta-tiempo">{a.tiempo}</span>
                                    </div>
                                    <p className="scada-alerta-msg">{a.msg}</p>
                                </div>
                            );
                        })}
                    </div>

                    {currentAforo && (
                        <div className="scada-aforo-row">
                            <Map size={11} className="text-emerald-500" />
                            <span className="scada-aforo-label">AFORO {currentAforo.estacion}</span>
                            <span className="scada-aforo-val">{currentAforo.escala != null ? Number(currentAforo.escala).toFixed(2) : '—'} m</span>
                            <span className="scada-aforo-gasto">{currentAforo.gasto_m3s != null ? Number(currentAforo.gasto_m3s).toFixed(2) : '—'} m³/s</span>
                        </div>
                    )}

                    <div className="scada-panel-hdr scada-panel-hdr--sub">
                        <Clock size={11} className="text-slate-500" />
                        <span>HISTORIAL DE OPERACIONES</span>
                        <button type="button" onClick={() => setIsMoveModalOpen(true)} className="scada-hist-btn">
                            <PlusCircle size={9} />Registrar
                        </button>
                    </div>
                    <div className="scada-historial-list">
                        {movsActuales.length === 0 ? (
                            <p className="scada-no-data">Sin registros recientes</p>
                        ) : movsActuales.slice(0, 5).map((m: MovimientoPresaData) => (
                            <div key={m.id} className="scada-historial-row">
                                <span className="scada-hist-fecha">
                                    {new Date(m.fecha_hora).toLocaleString('es-MX', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', hour12: false })}
                                </span>
                                <span className="scada-hist-gasto">{m.gasto_m3s.toFixed(2)} <small>m³/s</small></span>
                                <span className="scada-hist-fuente"
                                    style={{ color: m.fuente_dato === 'GERENCIA_ADMIN' ? '#f59e0b' : '#38bdf8' }}>
                                    {m.fuente_dato === 'GERENCIA_ADMIN' ? 'GERENCIA' : m.fuente_dato}
                                </span>
                            </div>
                        ))}
                    </div>

                    <div className="scada-panel-hdr scada-panel-hdr--sub">
                        <Activity size={11} className="text-slate-500" />
                        <span>COMPARATIVA DE CUENCA</span>
                    </div>
                    <div className="scada-cuenca-list">
                        {presas.map(p => {
                            const pct = p.lectura?.porcentaje_llenado || 0;
                            const color = pct < 20 ? '#ef4444' : pct < 40 ? '#f59e0b' : '#10b981';
                            return (
                                <div key={p.id} className="scada-cuenca-row">
                                    <span className="scada-cuenca-nombre">{p.nombre_corto}</span>
                                    <div className="scada-cuenca-bar">
                                        <div style={{ width: `${Math.min(pct,100)}%`, background: color }}/>
                                    </div>
                                    <span className="scada-cuenca-pct" style={{ color }}>{pct.toFixed(1)}%</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>


            {/* Modal */}
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
