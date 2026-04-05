import { useState, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
    Activity, TrendingUp, Shield, Database,
    AlertTriangle, CheckCircle,
    Gauge, Waves, ThermometerSun, Clock, Upload, Loader,
    Map, PlusCircle
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, ComposedChart, Bar, Line } from 'recharts';
import './Presas.css';
import { ReservoirViz } from '../components/ReservoirViz';
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
    const { presas, aforos, movimientos, movimientosHistorial, loading, error } = usePresas(fechaSeleccionada);
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
    const semLabel = pctLlenado >= 60 ? 'ÓPTIMO'  : pctLlenado >= 30 ? 'ATENCIÓN' : 'ALERTA';
    const difElev  = lect?.notas?.match(/Dif Elev: ([-\d.]+)m/)?.[1];
    const difVol   = lect?.notas?.match(/Dif Vol: ([-\d.]+)Mm3/)?.[1];
    const riskColor = pctLlenado >= 90 ? '#ef4444' : pctLlenado >= 70 ? '#f59e0b' : '#10b981';
    const riskLabel = pctLlenado >= 90 ? 'ALTO'   : pctLlenado >= 70 ? 'MEDIO'   : 'BAJO';
    // const volNAMO   = currentDam.capacidad_max_mm3;
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
            <div className="presas-exec-kpi-grid">
                {/* Nivel de embalse */}
                <div className="presas-exec-kpi-card">
                    <div className="presas-exec-kpi-title"><Activity size={12}/> NIVEL DE EMBALSE</div>
                    <div className="presas-exec-kpi-val">{elevacion.toFixed(2)} <span>m</span></div>
                    <div className="presas-exec-kpi-sub">{pctLlenado.toFixed(1)}% Capacidad</div>
                </div>

                {/* Volumen actual */}
                <div className="presas-exec-kpi-card">
                    <div className="presas-exec-kpi-title"><Waves size={12}/> VOLUMEN ACTUAL</div>
                    <div className="presas-exec-kpi-val">{almacenamiento.toFixed(3)} <span>Mm³</span></div>
                    <div className="presas-exec-kpi-sub">{currentDam.elevacion_corona_msnm} m (Corona)</div>
                </div>

                {/* Estado general con barra */}
                <div className="presas-exec-kpi-card">
                    <div className="presas-exec-kpi-title"><CheckCircle size={12}/> ESTADO GENERAL</div>
                    <div className="presas-v3-estado-bar-track mt-3 mb-1">
                        <div className="presas-v3-estado-bar-fill" style={{ width: `${Math.min(pctLlenado, 100)}%`, background: semColor, display: 'flex', gap: '2px' }}>
                            {/* Segmented effect inside fill */}
                            {[1,2,3,4,5,6,7,8,9,10].map(i => (
                                <div key={i} style={{flex: 1, backgroundColor: 'rgba(255,255,255,0.2)', borderRight: '1px solid rgba(0,0,0,0.2)'}}></div>
                            ))}
                        </div>
                    </div>
                    <div className="presas-exec-kpi-sub" style={{ color: semColor }}>{semLabel}</div>
                </div>

                {/* Cap. amortiguamiento */}
                <div className="presas-exec-kpi-card">
                    <div className="presas-exec-kpi-title"><Shield size={12}/> CAPACIDAD DE AMORTIGUAMIENTO</div>
                    <div className="presas-exec-kpi-val">{amortiguamiento.toFixed(0)} <span>hm³</span></div>
                </div>

                {/* Cap. útil / almacenada */}
                <div className="presas-exec-kpi-card">
                    <div className="presas-exec-kpi-title"><Database size={12}/> CAPACIDAD ÚTIL/ALMACENADA</div>
                    <div className="presas-exec-kpi-val">{almacenamiento.toFixed(3)} <span>Mm³</span> <span className="font-normal">(~{pctLlenado.toFixed(1)}%)</span></div>
                    <div className="presas-exec-kpi-sub">(Calculated from Volume)</div>
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

            {/* ── FILA 1.5: Capacidad y Geometría (SCADA FULL WIDTH) ─────── */}
            <div className="mb-4">
                <section className="presas-v3-card presas-v3-card--capacity" style={{ width: '100%' }}>
                    <div className="presas-v3-section-hdr">
                        <Waves size={13} className="text-teal-400" />
                        <span>ANÁLISIS DE CAPACIDAD Y GEOMETRÍA SCADA</span>
                        <div className="ml-auto flex gap-2">
                            <span className="w-1 h-1 bg-slate-500 rounded-full"></span>
                            <span className="w-1 h-1 bg-slate-500 rounded-full"></span>
                            <span className="w-1 h-1 bg-slate-500 rounded-full"></span>
                        </div>
                    </div>
                    <div className="presas-scada-full-container mt-4">
                        <ReservoirViz
                            percent={pctLlenado}
                            storageMm3={almacenamiento}
                            maxStorageMm3={currentDam.capacidad_max_mm3}
                            areaHa={lect?.area_ha || 0}
                            elevationMsnm={elevacion}
                            damName={currentDam.nombre_corto}
                            presaId={currentDam.id}
                            ultimoMovimiento={movsActuales.length > 0 ? movsActuales[0] : null}
                        />
                    </div>
                </section>
            </div>

            {/* ── FILA 2: Sistema de Monitoreo Climático y Tendencias ─────── */}
            <div className="mb-4">
                <section className="scada-climate-module">
                    {/* Header */}
                    <div className="scada-climate-header">
                        <div className="scada-climate-title-group">
                            <h2 className="scada-climate-title">
                                SISTEMA DE MONITOREO CLIMÁTICO Y TENDENCIAS - {currentDam?.nombre_corto || 'Región'}
                            </h2>
                            <div className="scada-climate-sub">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ fontSize: '20px' }}>⛅</span>
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        <span style={{ fontSize: '10px', color: '#94a3b8', lineHeight: 1 }}>FRESCO 14°C Temp. Ambiente</span>
                                        <span style={{ fontSize: '10px', color: '#94a3b8', lineHeight: 1, marginTop: '4px' }}>4T Visibilidad</span>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                   <span style={{ fontSize: '24px', fontWeight: 'bold' }}>14°C</span>
                                </div>
                            </div>
                        </div>
                        <div className="scada-climate-controls">
                            <div className="scada-btn-dark">
                                <span>📅 Global fecha picker</span>
                            </div>
                            <div className="scada-btn-dark">
                                <span style={{ color: '#94a3b8' }}>Sección:</span> <span style={{ color: '#e2e8f0' }}>Pastado</span> <span style={{ fontSize: '10px' }}>▼</span>
                            </div>
                        </div>
                    </div>

                    <div className="scada-climate-body">
                        {/* LEFT COLUMN */}
                        <div className="scada-climate-col-l">
                            <div className="scada-mon-grid-top">
                                {/* DATO CLIMATICO ACTUAL */}
                                <div className="scada-panel-box" style={{ alignItems: 'center' }}>
                                    <span className="scada-panel-title" style={{ width: '100%', textAlign: 'left' }}>DATO CLIMÁTICO ACTUAL</span>
                                    {/* Semi-circle Gauge SVG Mock */}
                                    <div className="scada-gauge-wrap">
                                        <div className="scada-gauge-track">
                                            <svg viewBox="0 0 100 100" className="scada-gauge-svg">
                                                <path d="M 10 50 Q 25 40 40 50 T 70 30 T 90 20 L 90 90 L 10 90 Z" fill="url(#sparkGrad)" />
                                                <path d="M 10 50 Q 25 40 40 50 T 70 30 T 90 20" fill="none" stroke="#fb923c" strokeWidth="2" />
                                                <defs>
                                                    <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="0%" stopColor="#fb923c" stopOpacity="0.5"/>
                                                        <stop offset="100%" stopColor="#fb923c" stopOpacity="0"/>
                                                    </linearGradient>
                                                </defs>
                                            </svg>
                                        </div>
                                    </div>
                                    <div className="scada-gauge-text">
                                        <span style={{ fontSize: '10px', color: '#94a3b8' }}>Temp. Ambiente:</span>
                                        <span style={{ fontSize: '26px', fontWeight: 'bold', lineHeight: 1, marginTop: '4px' }}>14°C</span>
                                    </div>
                                </div>
                                
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {/* Rango Diario */}
                                    <div className="scada-panel-box">
                                        <span className="scada-panel-title">Rango Diario</span>
                                        <div className="scada-range-container">
                                            <div className="scada-range-thumb" style={{ left: '20%' }}>
                                                <span style={{ position: 'absolute', bottom: '-16px', fontSize: '9px', color: '#38bdf8', fontWeight: 'bold' }}>13°C</span>
                                            </div>
                                            <div className="scada-range-thumb" style={{ left: '80%', borderColor: '#fb923c' }}>
                                                <span style={{ position: 'absolute', top: '-16px', fontSize: '9px', color: '#fb923c', fontWeight: 'bold' }}>28°C</span>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', fontWeight: 'bold', marginTop: '12px', color: '#94a3b8' }}>
                                            <span>Min: 13°C</span>
                                            <span>Max: 28°C</span>
                                        </div>
                                    </div>
                                    
                                    {/* Dir Viento */}
                                    <div className="scada-panel-box" style={{ alignItems: 'center' }}>
                                        <span className="scada-panel-title" style={{ width: '100%', textAlign: 'left', marginBottom: '4px' }}>Dir. Viento</span>
                                        <div className="scada-compass-wrap">
                                            <span className="scada-comp-n">N</span>
                                            <span className="scada-comp-s">S</span>
                                            <span className="scada-comp-w">W</span>
                                            <span className="scada-comp-e">E</span>
                                            {/* Compass Arrow */}
                                            <div className="scada-comp-arrow">
                                                <div className="scada-comp-half1"></div>
                                                <div className="scada-comp-half2"></div>
                                            </div>
                                        </div>
                                        <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#e2e8f0' }}>NW</span>
                                        <span style={{ fontSize: '10px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                                            <ThermometerSun size={10} color="#38bdf8" /> Intensidad: 15 km/h
                                        </span>
                                    </div>
                                </div>
                            </div>
                            
                            {/* Precipitación y Evaporación */}
                            <div className="scada-panel-box">
                                <span className="scada-panel-title">Precipitación y Evaporación</span>
                                <div style={{ display: 'flex', gap: '24px', alignItems: 'center', marginBottom: '12px' }}>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <span style={{ fontSize: '30px', filter: 'drop-shadow(0 2px 4px rgba(56, 189, 248, 0.4))' }}>💧</span> 
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#e2e8f0' }}>Inapreciable</span>
                                            <span style={{ fontSize: '9px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 'bold' }}>mm</span>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <span style={{ fontSize: '24px', color: '#7dd3fc' }}>♨️</span>
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#e2e8f0' }}>7.14</span>
                                            <span style={{ fontSize: '9px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 'bold' }}>mm</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="scada-chart-h90">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={[
                                            { h: '8', p: 1, e: 0 }, { h: '9', p: 3, e: 1 }, { h: '10', p: 9, e: 2 }, 
                                            { h: '11', p: 12, e: 4 }, { h: '12', p: 11, e: 5 }, { h: '13', p: 15, e: 6 },
                                            { h: '14', p: 10, e: 5 }, { h: '15', p: 6, e: 4 }, { h: '16', p: 0, e: 8 },
                                            { h: '17', p: 0, e: 7 }, { h: '18', p: 0, e: 6 }, { h: '19', p: 0, e: 5 },
                                            { h: '20', p: 0, e: 3 }, { h: '21', p: 0, e: 2 }, { h: '22', p: 0, e: 1 }
                                        ]}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#475569" opacity={0.3} />
                                            <XAxis dataKey="h" axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: '#64748b' }} dy={5} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: '#64748b' }} dx={-10} tickFormatter={(v: any) => `${v}%`} />
                                            <Bar dataKey="p" fill="#0ea5e9" barSize={6} />
                                            <Bar dataKey="e" fill="#f59e0b" barSize={6} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Alertas */}
                            <div className="scada-panel-box">
                                <span style={{ fontSize: '9px', color: '#94a3b8', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>REPORTE DE ALERTAS DE TENDENCIAS</span>
                                <span style={{ fontSize: '11px', color: '#e2e8f0' }}>Alerta: Tendencia de aumento de evaporación en la última semana</span>
                            </div>
                        </div>

                        {/* RIGHT COLUMN */}
                        <div className="scada-climate-col-r">
                            <div className="scada-panel-box">
                                <span className="scada-panel-title" style={{ color: '#f1f5f9', marginBottom: '12px' }}>ANÁLISIS DE TENDENCIAS CLIMÁTICAS HISTÓRICAS</span>
                                
                                <div className="scada-chart-h190">
                                    {/* Left: Temp chart */}
                                    <div className="scada-chart-grid-left">
                                        <span style={{ fontSize: '11px', color: '#cbd5e1', fontWeight: 'bold', marginBottom: '4px' }}>Tendencia de Temperatura Semanal</span>
                                        <div className="scada-chart-legend">
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ color: '#fb923c', fontSize: '18px', lineHeight: 1 }}>●</span> Max</span> 
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ color: '#38bdf8', fontSize: '18px', lineHeight: 1 }}>●</span> Min</span> 
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ color: '#34d399', fontSize: '18px', lineHeight: 1 }}>●</span> Promedio</span>
                                        </div>
                                        <div className="scada-chart-flex mt-1">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <ComposedChart data={[
                                                    { d: 'Perio 1', max: 21, min: 8, prom: 15 },
                                                    { d: 'Perio 2', max: 19, min: 7, prom: 14 },
                                                    { d: 'Perio 3', max: 18, min: 7, prom: 14.5 },
                                                    { d: 'Perio 4', max: 21, min: 9, prom: 16 },
                                                    { d: 'Perio 5', max: 23, min: 11, prom: 18 },
                                                    { d: 'Perio 6', max: 23.5, min: 12, prom: 18.5 },
                                                    { d: 'Perio 7', max: 27, min: 13, prom: 20 },
                                                ]} margin={{top: 15, right: 10, left: -25, bottom: 0}}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={true} stroke="#475569" opacity={0.3} />
                                                    <XAxis dataKey="d" axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: '#64748b' }} dy={10} />
                                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#64748b' }} tickFormatter={(v: any) => `${v}`} />
                                                    
                                                    {/* Background fill for max area */}
                                                    <Area type="monotone" dataKey="max" stroke="none" fill="url(#sparkGrad)" fillOpacity={0.2} />
                                                    
                                                    <Line type="monotone" dataKey="max" stroke="#fb923c" dot={{ r: 3, fill: '#fb923c', strokeWidth: 0 }} strokeWidth={2} />
                                                    <Line type="monotone" dataKey="min" stroke="#38bdf8" dot={{ r: 3, fill: '#38bdf8', strokeWidth: 0 }} strokeWidth={2} />
                                                    <Line type="monotone" dataKey="prom" stroke="#34d399" dot={{ r: 3, fill: '#34d399', strokeWidth: 0 }} strokeWidth={2} />
                                                </ComposedChart>
                                            </ResponsiveContainer>
                                        </div>
                                        <div className="scada-chart-note">Últimos 7 días</div>
                                    </div>
                                    
                                    {/* Right: Bar charts */}
                                    <div className="scada-chart-grid-right">
                                        {/* Aportaciones vs Evap */}
                                        <div className="scada-chart-flex" style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontSize: '10px', color: '#cbd5e1', fontWeight: 'bold', marginBottom: '4px' }}>Aportaciones vs. Evaporación Mensual</span>
                                            <div className="scada-chart-flex">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <ComposedChart data={[
                                                        { m: 'Jan', a: 160, e: 60 }, { m: 'Feb', a: 150, e: 70 }, 
                                                        { m: 'Mar', a: 190, e: 100 }, { m: 'Abr', a: 210, e: 90 },
                                                        { m: 'May', a: 230, e: 80 }, { m: 'Jun', a: 200, e: 60 }
                                                    ]} margin={{top: 5, right: 0, left: -25, bottom: 0}}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#475569" opacity={0.3} />
                                                        <XAxis dataKey="m" axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: '#64748b' }} dy={5} />
                                                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: '#64748b' }} />
                                                        <Bar dataKey="a" fill="#0ea5e9" barSize={8} />
                                                        <Bar dataKey="e" fill="#fbbf24" barSize={8} />
                                                    </ComposedChart>
                                                </ResponsiveContainer>
                                            </div>
                                            <div className="scada-chart-note">Últimos 6 meses</div>
                                        </div>
                                        {/* Var Precipitacion */}
                                        <div className="scada-chart-flex" style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid rgba(51, 65, 85, 0.5)', paddingTop: '8px' }}>
                                            <span style={{ fontSize: '10px', color: '#cbd5e1', fontWeight: 'bold', marginBottom: '4px' }}>Variación de Precipitación Trimestral</span>
                                            <div className="scada-chart-flex">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <ComposedChart data={[
                                                        { q: '1', v: 13 }, { q: '2', v: 10 }, { q: '3', v: -6 }, { q: '4', v: -1 }
                                                    ]} margin={{top: 5, right: 0, left: -25, bottom: 0}}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#475569" opacity={0.3} />
                                                        <XAxis dataKey="q" axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: '#64748b' }} dy={5} />
                                                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: '#64748b' }} tickFormatter={(v: any)=>`${v}%`} />
                                                        <Bar dataKey="v" fill="#38bdf8" barSize={14} />
                                                    </ComposedChart>
                                                </ResponsiveContainer>
                                            </div>
                                            <div className="scada-chart-note">Últimos 4 quarteres</div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="scada-panel-box" style={{ flex: 1, position: 'relative' }}>
                                <span className="scada-panel-title" style={{ color: '#f1f5f9', marginBottom: '4px' }}>ANÁLISIS TENDENCIAL</span>
                                <span style={{ fontSize: '10px', color: '#cbd5e1', marginBottom: '8px' }}>Tendencia de Previsión de Lluvias</span>
                                
                                <div className="scada-chart-flex" style={{ marginTop: '8px' }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={[
                                            { p: 'Period 1', v: 4, l: null }, { p: '', v: 5 }, { p: '', v: 11 }, { p: '', v: 5 },
                                            { p: '', v: 7 }, { p: '', v: 6 }, { p: '', v: 8 }, { p: '', v: 12 }, { p: '', v: 14 },
                                            { p: '', v: 12, l: '18.33 %' }, { p: '', v: 15 }, { p: '', v: 14 }, { p: '', v: 12 },
                                            { p: 'Period 3', v: 11, l: '15.07 %' }, { p: '', v: 14 }, { p: 'Period 4', v: 17, l: '20.00 %' }
                                        ]} margin={{ top: 20, right: 10, left: -25, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="colorWave" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.4}/>
                                                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0}/>
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={true} stroke="#475569" opacity={0.3} />
                                            <XAxis dataKey="p" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#64748b' }} dy={10} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#64748b' }} tickFormatter={(v: any)=>`${v}%`} />
                                            <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none' }} />
                                            <Area type="monotone" dataKey="v" stroke="#38bdf8" fillOpacity={1} fill="url(#colorWave)" strokeWidth={2} 
                                                dot={(props: any) => {
                                                    const { cx, cy, payload } = props;
                                                    if (payload.l) {
                                                        return (
                                                            <g>
                                                                <circle cx={cx} cy={cy} r={3} fill="#0f172a" stroke="#38bdf8" strokeWidth={2} />
                                                                <text x={cx} y={cy - 12} fill="#f1f5f9" fontSize="10" fontWeight="bold" textAnchor="middle">{payload.l}</text>
                                                            </g>
                                                        );
                                                    }
                                                    return <g></g>;
                                                }}
                                            />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                                <div style={{ position: 'absolute', bottom: '8px', left: 0, width: '100%', textAlign: 'center', fontSize: '9px', color: '#64748b', pointerEvents: 'none' }}>
                                    Últimos próximo 30 días
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            {/* ── FILA 3: Estado Operativo y Cuenca ─────── */}
            <div className="grid grid-cols-[1.5fr_1fr] gap-4 mb-4">
                {/* Panel Central: Datos de Operación e Historial */}
                <div className="flex flex-col gap-4">
                    {/* Aforo Mini-Card */}
                    {currentAforo && (
                        <div className="bg-[#4a585a] rounded-lg border border-[#5c6d6f] p-3 shadow-lg flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="p-2 bg-[#059669]/20 rounded-full text-[#10b981]">
                                    <Map size={18} />
                                </span>
                                <div className="flex flex-col">
                                    <span className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">AFORO ENTRADA PRINCIPAL</span>
                                    <span className="text-sm font-bold text-slate-100">{currentAforo.estacion}</span>
                                </div>
                            </div>
                            <div className="flex gap-6 text-right">
                                <div className="flex flex-col items-end">
                                    <span className="text-[10px] text-slate-300 uppercase">ESCALA</span>
                                    <span className="text-lg font-bold text-slate-200">{currentAforo.escala != null ? Number(currentAforo.escala).toFixed(2) : '--'}<span className="text-[10px] ml-1 font-normal text-slate-400">m</span></span>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className="text-[10px] text-[#10b981] font-bold uppercase">GASTO ACTUAL</span>
                                    <span className="text-lg font-bold text-[#10b981]">{currentAforo.gasto_m3s != null ? Number(currentAforo.gasto_m3s).toFixed(2) : '--'}<span className="text-[10px] ml-1 font-normal opacity-80">m³/s</span></span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Historial Card */}
                    <div className="bg-[#4a585a] rounded-lg border border-[#5c6d6f] p-3 shadow-lg flex-1">
                        <div className="flex justify-between items-center mb-3">
                            <div className="text-[11px] font-bold tracking-wider text-slate-200 uppercase flex items-center gap-2">
                                <Clock size={13} className="text-teal-400" /> HISTORIAL DE MOVIMIENTOS
                            </div>
                            <button type="button" onClick={() => setIsMoveModalOpen(true)}
                                className="text-[10px] font-bold bg-[#059669] text-white px-3 py-1 rounded shadow-sm hover:bg-[#047857] transition-all flex items-center gap-1 uppercase">
                                <PlusCircle size={10} /> Registrar
                            </button>
                        </div>
                        <div className="grid grid-cols-[1fr_1fr_1fr] text-[10px] font-bold text-slate-400 border-b border-slate-600 pb-1 mb-2">
                            <span>FECHA DE OPERACIÓN</span>
                            <span className="text-right">GASTO CONFIGURADO</span>
                            <span className="text-right">ORIGEN</span>
                        </div>
                        
                        {/* Table Loop */}
                        <div className="flex flex-col gap-1 max-h-[160px] overflow-y-auto pr-2 custom-scrollbar">
                            {movsActuales.length > 0 ? movsActuales.slice(0, 8).map((m: MovimientoPresaData) => (
                                <div key={m.id} className="grid grid-cols-[1fr_1fr_1fr] items-center bg-[#566567] rounded px-2 py-[6px] text-[11px] text-slate-200 border border-[#637375]">
                                    <span className="font-mono">{new Date(m.fecha_hora).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} <span className="text-[9px] text-slate-400">hrs</span></span>
                                    <span className="text-right font-bold text-emerald-400">{m.gasto_m3s.toFixed(2)} <span className="font-normal opacity-70">m³/s</span></span>
                                    <div className="flex justify-end">
                                        <span className={`px-2 py-[2px] rounded uppercase text-[9px] font-bold bg-slate-800 border ${m.fuente_dato === 'GERENCIA_ADMIN' ? 'text-amber-400 border-amber-900/50' : 'text-blue-400 border-blue-900/50'}`}>
                                            {m.fuente_dato === 'GERENCIA_ADMIN' ? 'GERENCIA' : m.fuente_dato}
                                        </span>
                                    </div>
                                </div>
                            )) : (
                                <div className="text-[11px] text-slate-400 italic py-4 text-center">No hay registros recientes para este embalse.</div>
                            )}
                        </div>
                    </div>
                </div>

                {/* COMPARATIVA CUENCA COLUMN */}
                <div className="bg-[#4a585a] rounded-lg border border-[#5c6d6f] p-3 shadow-lg flex flex-col">
                    <div className="flex items-center gap-2 text-slate-200 mb-3">
                        <Activity size={13} className="text-sky-400" />
                        <span className="text-[11px] font-bold tracking-wider uppercase">COMPARATIVA DE CUENCA (RESERVAS)</span>
                    </div>

                    <div className="flex flex-col gap-[10px] flex-1 overflow-y-auto pr-2 custom-scrollbar">
                        {presas.map(p => {
                            const pct = p.lectura?.porcentaje_llenado || 0;
                            const isCrit = pct < 20;
                            const isWarn = pct >= 20 && pct < 40;
                            const colorClass = isCrit ? 'bg-red-500' : isWarn ? 'bg-amber-500' : 'bg-[#10b981]';
                            const titleColor = isCrit ? 'text-red-400' : isWarn ? 'text-amber-400' : 'text-[#10b981]';
                            
                            return (
                                <div key={p.id} className="flex gap-3 items-center border-b border-slate-600/50 pb-[10px] last:border-0 last:pb-0">
                                    <div className="w-[100px] text-[11px] font-bold text-slate-200 truncate">{p.nombre_corto}</div>
                                    <div className="flex-1 flex flex-col gap-1">
                                        <div className="h-[6px] w-full bg-[#1e293b] rounded-full border border-slate-700/50 overflow-hidden">
                                            <div className={`h-full ${colorClass}`} style={{ width: `${Math.min(pct, 100)}%` }}></div>
                                        </div>
                                    </div>
                                    <div className={`w-[45px] text-right font-bold text-[12px] ${titleColor}`}>
                                        {pct.toFixed(1)}%
                                    </div>
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
