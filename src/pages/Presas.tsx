import { useState, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
    Activity, TrendingUp,
    AlertTriangle, CheckCircle,
    Gauge, Waves, ThermometerSun, Clock, Upload, Loader,
    Map, PlusCircle
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    ReferenceLine, ReferenceArea, ReferenceDot,
    ComposedChart,
} from 'recharts';
import './Presas.css';
import ReservoirViz from '../components/ReservoirViz';
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

// ─── Gestión Hidráulica ───────────────────────────────────────────────────────
const GestionHidraulicaPanel = ({ presa }: { presa: PresaData }) => {
    const lect = presa.lectura;
    const total = lect?.extraccion_total_m3s ?? 0;

    const obras = [
        { nombre: 'Toma Baja', clave: 'toma_baja', gasto: lect?.gasto_toma_baja_m3s ?? 0 },
        { nombre: 'CFE',       clave: 'cfe',       gasto: lect?.gasto_cfe_m3s       ?? 0 },
        { nombre: 'Toma Izq.', clave: 'izq',       gasto: lect?.gasto_toma_izq_m3s  ?? 0 },
        { nombre: 'Toma Der.', clave: 'der',       gasto: lect?.gasto_toma_der_m3s  ?? 0 },
    ].filter(o => o.gasto != null);

    const hayDetalle = obras.some(o => o.gasto > 0);

    return (
        <div className="extraction-section">
            <h3><Gauge size={16} /> Gestión Hidráulica y Extracción</h3>

            {/* Total output */}
            <div className="flex items-center gap-4 mb-4 p-3 rounded-xl border border-white/5 bg-white/[0.02]">
                <div className="flex flex-col">
                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Caudal Total de Salida</span>
                    <span className="text-3xl font-black font-mono" style={{ color: total > 0 ? '#38bdf8' : '#475569' }}>
                        {total > 0 ? total.toFixed(2) : '0.00'}
                    </span>
                    <span className="text-[9px] font-bold text-slate-500">m³/s</span>
                </div>
                <div className="flex-1">
                    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full transition-all"
                            style={{ width: `${Math.min((total / 100) * 100, 100)}%`, background: total > 0 ? '#38bdf8' : '#334155' }} />
                    </div>
                    <span className="text-[8px] text-slate-600 font-mono mt-1 block">
                        Cap. extracción: {((total / 100) * 100).toFixed(1)}%
                    </span>
                </div>
                <span className={`text-[9px] font-black uppercase px-3 py-1.5 rounded-lg border ${total > 0 ? 'text-sky-400 bg-sky-500/10 border-sky-500/20' : 'text-slate-500 bg-white/5 border-white/10'}`}>
                    {total > 0 ? 'OPERANDO' : 'CERRADA'}
                </span>
            </div>

            {/* Gate cards */}
            {hayDetalle && (
                <div className="grid grid-cols-2 gap-2">
                    {obras.map(o => {
                        const abierta = o.gasto > 0;
                        const pct = total > 0 ? (o.gasto / total) * 100 : 0;
                        return (
                            <div key={o.clave} className="rounded-xl p-3 border transition-all"
                                style={{
                                    background:     abierta ? 'rgba(56,189,248,0.05)' : 'rgba(255,255,255,0.02)',
                                    borderColor:    abierta ? 'rgba(56,189,248,0.3)'  : 'rgba(255,255,255,0.06)',
                                }}>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{o.nombre}</span>
                                    <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded"
                                        style={{ color: abierta ? '#38bdf8' : '#475569', background: abierta ? 'rgba(56,189,248,0.12)' : 'rgba(71,85,105,0.15)' }}>
                                        {abierta ? 'ABIERTA' : 'CERRADA'}
                                    </span>
                                </div>
                                <span className="text-xl font-black font-mono" style={{ color: abierta ? '#38bdf8' : '#334155' }}>
                                    {o.gasto.toFixed(2)}
                                </span>
                                <span className="text-[8px] text-slate-600 font-bold ml-1">m³/s</span>
                                {abierta && total > 0 && (
                                    <div className="mt-2 h-1 rounded-full bg-white/5 overflow-hidden">
                                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#38bdf8' }} />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <span className="destination-tag mt-3 block">→ Canal Principal Conchos</span>
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

    // ─── Datos del embalse seleccionado ──────────────────────────────────────
    const lect          = currentDam.lectura;
    const elevacion     = lect?.escala_msnm         || 0;
    const almacenamiento = lect?.almacenamiento_mm3  || 0;
    const pctLlenado    = lect?.porcentaje_llenado   || 0;
    const extraccion    = lect?.extraccion_total_m3s || 0;
    const amortiguamiento = currentDam.capacidad_max_mm3 - almacenamiento;
    const semColor = pctLlenado >= 60 ? '#10b981' : pctLlenado >= 30 ? '#f59e0b' : '#ef4444';
    const semLabel = pctLlenado >= 60 ? 'ÓPTIMO'  : pctLlenado >= 30 ? 'ATENCIÓN' : 'ALERTA';
    const difElev  = lect?.notas?.match(/Dif Elev: ([-\d.]+)m/)?.[1];
    const difVol   = lect?.notas?.match(/Dif Vol: ([-\d.]+)Mm3/)?.[1];
    const riskColor = pctLlenado >= 90 ? '#ef4444' : pctLlenado >= 70 ? '#f59e0b' : '#10b981';
    const riskLabel = pctLlenado >= 90 ? 'ALTO'   : pctLlenado >= 70 ? 'MEDIO'   : 'BAJO';
    const volNAMO   = currentDam.capacidad_max_mm3;
    const volMuerta = curvaData.length > 0 ? curvaData[0].volume : 0;
    const movsActuales = movimientos.filter((m: MovimientoPresaData) => m.presa_id === currentDam.id);

    return (
        <div className="presas-v3-container">

            {/* ── Header ─────────────────────────────────────────────────────── */}
            <header className="presas-v3-header">
                <div>
                    <h2 className="presas-v3-title">
                        <Activity size={20} className="text-sky-400" />
                        Monitoreo de Presas — CONAGUA
                    </h2>
                    <p className="presas-v3-subtitle">Sistema Integral de Control de Agua · {fechaSeleccionada}</p>
                </div>
                <div className="presas-v3-header-actions">
                    <div className="conagua-badge"><CheckCircle size={12} /> Oficial</div>
                    <button type="button" onClick={() => setIsMoveModalOpen(true)} className="btn-premium-action bg-emerald-600 hover:bg-emerald-500">
                        <PlusCircle size={14} /><span>Registrar Movimiento</span>
                    </button>
                    <Link to="/importar" className="btn-premium-action">
                        <Upload size={14} /><span>Capturar Documento</span>
                    </Link>
                    <div className="dam-selector-modern">
                        {presas.map(p => (
                            <button key={p.id} className={(selectedDamId || presas[0]?.id) === p.id ? 'active' : ''} onClick={() => setSelectedDamId(p.id)}>
                                <Waves size={14} /><span>{p.nombre_corto}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            {/* ── ESTADO ACTUAL — tira KPI horizontal ────────────────────────── */}
            <div className="presas-v3-estado-strip">
                {/* Identidad */}
                <div className="presas-v3-estado-identity">
                    <div className="presas-v3-estado-dot" style={{ background: semColor }} />
                    <div>
                        <div className="presas-v3-estado-dam-name">{currentDam.nombre_corto}</div>
                        <div className="presas-v3-estado-dam-sub">{currentDam.rio} · {currentDam.municipio}</div>
                    </div>
                    <span className="presas-v3-estado-type">{currentDam.tipo_cortina}</span>
                </div>

                <div className="presas-v3-estado-divider" />

                {/* Nivel de embalse */}
                <div className="presas-v3-estado-kpi">
                    <span className="presas-v3-kpi-label">NIVEL DE EMBALSE</span>
                    <span className="presas-v3-kpi-val">{elevacion.toFixed(2)}</span>
                    <span className="presas-v3-kpi-unit">msnm · {pctLlenado.toFixed(1)}%</span>
                </div>

                <div className="presas-v3-estado-divider" />

                {/* Volumen */}
                <div className="presas-v3-estado-kpi">
                    <span className="presas-v3-kpi-label">VOLUMEN ACTUAL</span>
                    <span className="presas-v3-kpi-val">{almacenamiento.toFixed(3)}</span>
                    <span className="presas-v3-kpi-unit">Mm³</span>
                </div>

                <div className="presas-v3-estado-divider" />

                {/* Estado general con barra */}
                <div className="presas-v3-estado-general">
                    <span className="presas-v3-kpi-label">ESTADO GENERAL</span>
                    <div className="presas-v3-estado-bar-track">
                        <div className="presas-v3-estado-bar-fill" style={{ width: `${Math.min(pctLlenado, 100)}%`, background: semColor }} />
                    </div>
                    <span className="presas-v3-kpi-unit" style={{ color: semColor }}>{semLabel} · {pctLlenado.toFixed(1)}%</span>
                </div>

                <div className="presas-v3-estado-divider" />

                {/* Cap. amortiguamiento */}
                <div className="presas-v3-estado-kpi">
                    <span className="presas-v3-kpi-label">CAP. AMORTIGUAMIENTO</span>
                    <span className="presas-v3-kpi-val" style={{ color: '#a78bfa' }}>{amortiguamiento.toFixed(1)}</span>
                    <span className="presas-v3-kpi-unit">Mm³ disponible</span>
                </div>

                <div className="presas-v3-estado-divider" />

                {/* Extracción */}
                <div className="presas-v3-estado-kpi">
                    <span className="presas-v3-kpi-label">EXTRACCIÓN ACTUAL</span>
                    <span className="presas-v3-kpi-val" style={{ color: extraccion > 0 ? '#38bdf8' : '#475569' }}>{extraccion.toFixed(2)}</span>
                    <span className="presas-v3-kpi-unit">m³/s → Canal Principal</span>
                </div>
            </div>

            {/* ── FILA 1: Monitoreo de Niveles  |  Gestión Hidráulica ─────────── */}
            <div className="presas-v3-row presas-v3-row--main">

                {/* Monitoreo de niveles */}
                <section className="presas-v3-card presas-v3-card--levels">
                    <div className="presas-v3-section-hdr">
                        <TrendingUp size={13} className="text-sky-400" />
                        <span>MONITOREO DE NIVELES AVANZADO</span>
                        {(difElev || difVol) && (
                            <div className="presas-v3-delta-badges">
                                {difElev && <span className={`presas-v3-delta-badge ${Number(difElev) >= 0 ? 'presas-v3-delta-badge--up' : 'presas-v3-delta-badge--down'}`}>
                                    {Number(difElev) >= 0 ? '▲' : '▼'} {Math.abs(Number(difElev)).toFixed(3)} m
                                </span>}
                                {difVol && <span className={`presas-v3-delta-badge ${Number(difVol) >= 0 ? 'presas-v3-delta-badge--up' : 'presas-v3-delta-badge--down'}`}>
                                    {Number(difVol) >= 0 ? '▲' : '▼'} {Math.abs(Number(difVol)).toFixed(3)} Mm³
                                </span>}
                            </div>
                        )}
                    </div>

                    {/* Gráfica nivel histórico */}
                    <NivelHistoricoChart presaId={currentDam.id} />

                    {/* Índice de Riesgo */}
                    <div className="presas-v3-risk-panel">
                        <span className="presas-v3-kpi-label">ÍNDICE DE RIESGO DE AVENIDAS</span>
                        <div className="presas-v3-risk-bar-track">
                            <div className="presas-v3-risk-bar-fill" style={{ width: `${Math.min(pctLlenado, 100)}%`, background: riskColor }} />
                            <div className="presas-v3-risk-zones">
                                <span style={{ left: '70%' }} />
                                <span style={{ left: '90%' }} />
                            </div>
                        </div>
                        <div className="presas-v3-risk-labels">
                            <span className="text-emerald-500">BAJO</span>
                            <span className="text-amber-400">MEDIO</span>
                            <span className="text-red-400">ALTO</span>
                            <span className="presas-v3-risk-badge" style={{ color: riskColor, borderColor: riskColor, background: `${riskColor}15` }}>
                                {riskLabel} · {pctLlenado.toFixed(1)}%
                            </span>
                        </div>
                    </div>

                    {/* Mini kpis de diseño */}
                    <div className="presas-v3-design-kpis">
                        <div className="presas-v3-design-kpi">
                            <span>Corona</span>
                            <span>{currentDam.elevacion_corona_msnm.toFixed(2)} msnm</span>
                        </div>
                        <div className="presas-v3-design-kpi">
                            <span>NAMO</span>
                            <span>{curvaData.length > 0 ? curvaData[curvaData.length - 1].elevation.toFixed(2) : '—'} msnm</span>
                        </div>
                        <div className="presas-v3-design-kpi">
                            <span>Cap. Total</span>
                            <span>{currentDam.capacidad_max_mm3.toFixed(1)} Mm³</span>
                        </div>
                        {lect?.area_ha != null && lect.area_ha > 0 && (
                            <div className="presas-v3-design-kpi">
                                <span>Espejo agua</span>
                                <span>{lect.area_ha.toLocaleString()} ha</span>
                            </div>
                        )}
                    </div>
                </section>

                {/* Gestión hidráulica */}
                <section className="presas-v3-card presas-v3-card--hydro">
                    <div className="presas-v3-section-hdr">
                        <Gauge size={13} className="text-sky-400" />
                        <span>GESTIÓN HIDRÁULICA Y EXTRACCIÓN</span>
                    </div>
                    <GestionHidraulicaPanel presa={currentDam} />
                    <div className="presas-v3-section-hdr presas-v3-section-hdr--sub mt-4">
                        <Activity size={11} className="text-slate-500" />
                        <span>TENDENCIA DE EXTRACCIÓN 48H</span>
                    </div>
                    <ExtractionStreamgraph movimientos={movimientosHistorial.filter(m => m.presa_id === currentDam.id)} />
                </section>
            </div>

            {/* ── FILA 2: Capacidad y Geometría  |  Clima y Aportaciones ─────── */}
            <div className="presas-v3-row presas-v3-row--analysis">

                {/* Análisis de capacidad y geometría */}
                <section className="presas-v3-card presas-v3-card--capacity">
                    <div className="presas-v3-section-hdr">
                        <Waves size={13} className="text-blue-400" />
                        <span>ANÁLISIS DE CAPACIDAD Y GEOMETRÍA</span>
                        <span className="ml-auto text-[8px] text-violet-400 font-mono font-black">{amortiguamiento.toFixed(1)} Mm³ libre</span>
                    </div>

                    {/* Leyenda zonas */}
                    <div className="presas-v3-eac-legend">
                        {[
                            { label: 'Cap. Muerta', color: '#1e3a5f' },
                            { label: 'Cap. Útil',   color: '#3b82f6' },
                            { label: 'Nivel actual', color: '#f59e0b' },
                            { label: 'NAMO',        color: '#ef4444' },
                        ].map(z => (
                            <div key={z.label} className="presas-v3-eac-legend-item">
                                <div className="presas-v3-eac-legend-dot" style={{ background: z.color }} />
                                <span>{z.label}</span>
                            </div>
                        ))}
                    </div>

                    {/* Curva EAC */}
                    <ResponsiveContainer width="100%" height={220}>
                        <ComposedChart data={curvaData} margin={{ top: 10, right: 16, left: 0, bottom: 16 }}>
                            <defs>
                                <linearGradient id="eacGradV3" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.5} />
                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.04} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                            <XAxis dataKey="volume" tick={{ fill: '#475569', fontSize: 8 }} tickFormatter={v => `${Number(v).toFixed(0)}`}
                                label={{ value: 'Volumen (Mm³)', position: 'insideBottom', offset: -8, fill: '#475569', fontSize: 8 }} />
                            <YAxis dataKey="elevation" tick={{ fill: '#475569', fontSize: 8 }} domain={['dataMin - 1', 'dataMax + 1']}
                                tickFormatter={v => `${Number(v).toFixed(0)}`} width={38}
                                label={{ value: 'Elev (msnm)', angle: -90, position: 'insideLeft', offset: 10, fill: '#475569', fontSize: 8 }} />
                            <Tooltip
                                contentStyle={{ background: 'rgba(4,11,22,0.97)', border: '1px solid #1e3a5f', borderRadius: 8 }}
                                labelFormatter={v => `Vol: ${Number(v).toFixed(1)} Mm³`}
                                formatter={(v: any) => [`${Number(v).toFixed(2)} msnm`, 'Elevación']}
                            />
                            {volMuerta > 0 && <ReferenceArea x1={0} x2={volMuerta} fill="#1e293b" fillOpacity={0.6} />}
                            {almacenamiento > 0 && (
                                <ReferenceLine x={almacenamiento} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3"
                                    label={{ value: `${elevacion.toFixed(1)}m`, position: 'top', fill: '#f59e0b', fontSize: 8, fontWeight: 'bold' }} />
                            )}
                            {volNAMO > 0 && (
                                <ReferenceLine x={volNAMO} stroke="#ef4444" strokeWidth={1} strokeDasharray="4 2"
                                    label={{ value: 'NAMO', position: 'top', fill: '#ef4444', fontSize: 8 }} />
                            )}
                            <Area type="monotone" dataKey="elevation" stroke="#3b82f6" strokeWidth={2} fill="url(#eacGradV3)" dot={false} />
                            {almacenamiento > 0 && elevacion > 0 && (
                                <ReferenceDot x={almacenamiento} y={elevacion} r={5} fill="#f59e0b" stroke="#040b16" strokeWidth={2} />
                            )}
                        </ComposedChart>
                    </ResponsiveContainer>

                    {/* Breakdown Almacenado / Amortiguamiento / Total */}
                    <div className="presas-v3-cap-breakdown">
                        {[
                            { label: 'Almacenado',      value: almacenamiento.toFixed(1),    unit: 'Mm³', color: '#3b82f6' },
                            { label: 'Amortiguamiento',  value: amortiguamiento.toFixed(1),   unit: 'Mm³', color: '#a78bfa' },
                            { label: 'Capacidad Total',  value: volNAMO.toFixed(1),           unit: 'Mm³', color: '#334155' },
                        ].map(m => (
                            <div key={m.label} className="presas-v3-cap-metric">
                                <span className="presas-v3-cap-metric-label">{m.label}</span>
                                <span className="presas-v3-cap-metric-val" style={{ color: m.color }}>{m.value}</span>
                                <span className="presas-v3-cap-metric-unit">{m.unit}</span>
                            </div>
                        ))}
                    </div>

                    {/* 3D viz */}
                    <div className="mt-4">
                        <ReservoirViz
                            percent={pctLlenado}
                            storageMm3={almacenamiento}
                            maxStorageMm3={currentDam.capacidad_max_mm3}
                            areaHa={lect?.area_ha || 0}
                            elevationMsnm={elevacion}
                            damName={currentDam.nombre_corto}
                            presaId={currentDam.id}
                        />
                    </div>
                </section>

                {/* Clima y aportaciones */}
                <section className="presas-v3-card presas-v3-card--climate">
                    <div className="presas-v3-section-hdr">
                        <ThermometerSun size={13} className="text-amber-400" />
                        <span>ANÁLISIS CLIMÁTICO Y APORTACIONES</span>
                        <span className="ml-auto text-[9px] text-slate-600 font-mono">{fechaSeleccionada}</span>
                    </div>

                    {/* Clima del embalse seleccionado */}
                    {currentClima ? (
                        <div className="presas-v3-clima-grid">
                            <div className="presas-v3-clima-main">
                                <span className="presas-v3-kpi-label">TEMPERATURA</span>
                                <span className="presas-v3-clima-temp">
                                    {currentClima.temp_ambiente_c != null ? Number(currentClima.temp_ambiente_c).toFixed(1) : '--'}°C
                                </span>
                                <span className="presas-v3-kpi-unit italic">{currentClima.edo_tiempo || '--'}</span>
                                {currentClima.temp_minima_c != null && currentClima.temp_maxima_c != null && (
                                    <span className="text-[9px] text-slate-500 font-mono mt-1">
                                        Min {Number(currentClima.temp_minima_c).toFixed(1)}° / Max {Number(currentClima.temp_maxima_c).toFixed(1)}°
                                    </span>
                                )}
                            </div>
                            <div className="presas-v3-clima-metrics">
                                {[
                                    { label: 'Precipitación', value: currentClima.precipitacion_mm, unit: 'mm', color: '#60a5fa' },
                                    { label: 'Evaporación',   value: currentClima.evaporacion_mm,   unit: 'mm', color: '#fbbf24' },
                                    { label: 'Viento',        value: null,                           unit: currentClima.dir_viento || '--', color: '#94a3b8' },
                                ].map(c => (
                                    <div key={c.label} className="presas-v3-clima-metric">
                                        <span className="presas-v3-kpi-label">{c.label}</span>
                                        <span className="presas-v3-clima-metric-val" style={{ color: c.color }}>
                                            {c.value != null ? Number(c.value).toFixed(1) : c.unit}
                                        </span>
                                        {c.value != null && <span className="presas-v3-kpi-unit">{c.unit}</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="presas-v3-clima-empty">Sin datos climatológicos para {fechaSeleccionada}</div>
                    )}

                    {/* Aforo de entrada */}
                    {currentAforo && (
                        <div className="presas-v3-aforo-row">
                            <div className="presas-v3-section-hdr presas-v3-section-hdr--sub mt-4 mb-3">
                                <Map size={11} className="text-emerald-500" />
                                <span>AFORO DE ENTRADA — {currentAforo.estacion}</span>
                            </div>
                            <div className="presas-v3-aforo-values">
                                <div className="presas-v3-aforo-metric">
                                    <span className="presas-v3-kpi-label">ESCALA</span>
                                    <span className="presas-v3-kpi-val">{currentAforo.escala != null ? Number(currentAforo.escala).toFixed(2) : '--'}</span>
                                    <span className="presas-v3-kpi-unit">m</span>
                                </div>
                                <div className="presas-v3-aforo-metric">
                                    <span className="presas-v3-kpi-label">GASTO</span>
                                    <span className="presas-v3-kpi-val" style={{ color: '#10b981' }}>
                                        {currentAforo.gasto_m3s != null ? Number(currentAforo.gasto_m3s).toFixed(2) : '--'}
                                    </span>
                                    <span className="presas-v3-kpi-unit">m³/s</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Historial de movimientos */}
                    <div className="presas-v3-section-hdr presas-v3-section-hdr--sub mt-4 mb-3">
                        <Clock size={11} className="text-slate-500" />
                        <span>HISTORIAL DE MOVIMIENTOS</span>
                        <button type="button" onClick={() => setIsMoveModalOpen(true)}
                            className="ml-auto text-[8px] font-black bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded border border-emerald-500/20 hover:bg-emerald-500/20 transition-all uppercase">
                            + Registrar
                        </button>
                    </div>
                    <div className="presas-v3-movs-table">
                        {movsActuales.length > 0 ? movsActuales.slice(0, 8).map((m: MovimientoPresaData) => (
                            <div key={m.id} className="presas-v3-mov-row">
                                <span className="presas-v3-mov-fecha">
                                    {new Date(m.fecha_hora).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Chihuahua' })}
                                </span>
                                <span className="presas-v3-mov-gasto">{m.gasto_m3s.toFixed(2)} <small>m³/s</small></span>
                                <span className={`presas-v3-mov-fuente ${m.fuente_dato === 'GERENCIA_ADMIN' ? 'presas-v3-mov-fuente--admin' : 'presas-v3-mov-fuente--campo'}`}>
                                    {m.fuente_dato === 'GERENCIA_ADMIN' ? 'Gerencia' : m.fuente_dato}
                                </span>
                            </div>
                        )) : (
                            <p className="text-[10px] text-slate-600 italic py-4 text-center">Sin movimientos registrados</p>
                        )}
                    </div>

                    {/* Comparativa cuenca */}
                    <div className="presas-v3-section-hdr presas-v3-section-hdr--sub mt-5 mb-3">
                        <Activity size={11} className="text-slate-500" />
                        <span>COMPARATIVA DE CUENCA</span>
                    </div>
                    <div className="presas-v3-cuenca-compare">
                        {presas.map(p => {
                            const pct = p.lectura?.porcentaje_llenado || 0;
                            const col = pct >= 60 ? '#10b981' : pct >= 30 ? '#f59e0b' : '#ef4444';
                            return (
                                <div key={p.id} className="presas-v3-cuenca-presa">
                                    <span className="presas-v3-kpi-label">{p.nombre_corto}</span>
                                    <div className="presas-v3-cuenca-bar-track">
                                        <div className="presas-v3-cuenca-bar-fill" style={{ width: `${Math.min(pct, 100)}%`, background: col }} />
                                    </div>
                                    <span className="presas-v3-kpi-unit" style={{ color: col }}>{pct.toFixed(1)}%</span>
                                </div>
                            );
                        })}
                    </div>
                </section>
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
