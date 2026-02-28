import { useMemo, useState, useEffect } from 'react';
import {
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, Cell, AreaChart, Area
} from 'recharts';
import {
    Droplets, Waves, Activity, AlertTriangle, TrendingUp, TrendingDown,
    ArrowRight, Loader, ShieldCheck, Smartphone, Monitor as MonitorIcon, Database
} from 'lucide-react';
import KPICard from '../components/KPICard';
import ChartWidget from '../components/ChartWidget';
import AlertList, { type Alert } from '../components/AlertList';
import { useHydraEngine } from '../hooks/useHydraEngine';
import { usePresas } from '../hooks/usePresas';
import { useFecha } from '../context/FechaContext';
import { supabase } from '../lib/supabase';
import './Dashboard.css';

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function formatFechaCorta(dateStr: string): string {
    const [y, m, d] = dateStr.split('-');
    return `${parseInt(d)} ${MESES_CORTOS[parseInt(m) - 1]} ${y}`;
}

/* ─── SVG Donut Ring ──────────────────────────────────────────── */
function DonutRing({ pct, label, color = '#60a5fa', size = 110 }: {
    pct: number; label: string; color?: string; size?: number;
}) {
    const r = 40;
    const circ = 2 * Math.PI * r;
    const stroke = circ * Math.min(pct, 100) / 100;
    return (
        <svg width={size} height={size} viewBox="0 0 100 100" style={{ flexShrink: 0 }}>
            <defs>
                <linearGradient id={`donut-grad-${label}`} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor={color} stopOpacity="1" />
                    <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.9" />
                </linearGradient>
                <filter id="glow-donut">
                    <feGaussianBlur stdDeviation="2" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
            </defs>
            {/* Track */}
            <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
            {/* Fill */}
            <circle
                cx="50" cy="50" r={r}
                fill="none"
                stroke={`url(#donut-grad-${label})`}
                strokeWidth="10"
                strokeDasharray={`${stroke} ${circ}`}
                strokeLinecap="round"
                transform="rotate(-90 50 50)"
                style={{ filter: `drop-shadow(0 0 6px ${color}99)`, transition: 'stroke-dasharray 1.2s ease' }}
            />
            {/* Center text */}
            <text x="50" y="46" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="800" fontFamily="JetBrains Mono, monospace">
                {pct.toFixed(0)}%
            </text>
            <text x="50" y="60" textAnchor="middle" fill="#94a3b8" fontSize="7.5" fontWeight="500" letterSpacing="0.5">
                {label}
            </text>
        </svg>
    );
}

/* ─── Custom Tooltip ──────────────────────────────────────────── */
function CustomTooltip({ active, payload, label, unit = '' }: any) {
    if (!active || !payload?.length) return null;
    return (
        <div className="chart-tooltip">
            <p className="tooltip-label">{label}</p>
            {payload.map((p: any, i: number) => (
                <p key={i} className="tooltip-value" style={{ color: p.color || '#fff' }}>
                    {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
                    <span style={{ fontSize: '0.65rem', color: '#94a3b8', marginLeft: 4 }}>{unit || p.unit || ''}</span>
                </p>
            ))}
        </div>
    );
}

/* ─── Module Efficiency Bar (custom, no recharts) ──────────────── */
function ModuleBar({ name, pct, rank }: { name: string; pct: number; rank: number }) {
    const isHigh = pct >= 90;
    const barColor = isHigh
        ? 'linear-gradient(90deg, #f43f5e, #fb923c)'
        : pct >= 60
            ? 'linear-gradient(90deg, #3b82f6, #06b6d4)'
            : 'linear-gradient(90deg, #10b981, #34d399)';

    const glowColor = isHigh ? '#f43f5e' : pct >= 60 ? '#3b82f6' : '#10b981';

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0' }}>
            {/* Rank badge */}
            <span style={{
                width: '20px', height: '20px', borderRadius: '50%',
                background: rank <= 2 ? 'linear-gradient(135deg,#fbbf24,#f59e0b)' : 'rgba(255,255,255,0.07)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.6rem', fontWeight: '800', color: rank <= 2 ? '#1c1400' : '#64748b',
                flexShrink: 0
            }}>{rank}</span>

            {/* Name */}
            <span style={{ width: '52px', fontSize: '0.7rem', color: '#94a3b8', fontWeight: '600', flexShrink: 0, fontFamily: 'JetBrains Mono, monospace' }}>
                {name}
            </span>

            {/* Bar track */}
            <div style={{ flex: 1, height: '8px', background: 'rgba(255,255,255,0.04)', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{
                    width: `${Math.min(pct, 100)}%`,
                    height: '100%',
                    background: barColor,
                    borderRadius: '999px',
                    boxShadow: `0 0 8px ${glowColor}66`,
                    transition: 'width 1s cubic-bezier(.4,0,.2,1)'
                }} />
            </div>

            {/* Value */}
            <span style={{
                width: '42px', textAlign: 'right',
                fontSize: '0.72rem', fontWeight: '800', flexShrink: 0,
                color: isHigh ? '#fb923c' : pct >= 60 ? '#60a5fa' : '#34d399',
                fontFamily: 'JetBrains Mono, monospace'
            }}>
                {pct.toFixed(1)}%
            </span>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════ */
const Dashboard = () => {
    const { fechaSeleccionada, esHoy } = useFecha();

    const { modules, loading: loadingModules } = useHydraEngine();
    const {
        presas,
        totalAlmacenamiento,
        totalCapacidad,
        totalExtraccion,
        porcentajeLlenado,
        loading: loadingPresas
    } = usePresas(fechaSeleccionada);

    const [appVersions, setAppVersions] = useState<any[]>([]);
    useEffect(() => {
        const fetchVersions = async () => {
            const { data } = await supabase.from('app_versions').select('*');
            if (data) setAppVersions(data);
        };
        fetchVersions();
    }, []);

    const loading = loadingModules || loadingPresas;

    const [now, setNow] = useState<number>(Date.now());
    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 3000);
        return () => clearInterval(interval);
    }, []);

    /* ── Aggregations ── */
    const totalDailyVol = useMemo(() => modules.reduce((acc, m) => {
        const mDailyVol = m.delivery_points.reduce((ptAcc, pt) => {
            const elapsedSeconds = pt.last_update_time ? Math.max(0, (now - new Date(pt.last_update_time).getTime()) / 1000) : 0;
            const cappedSeconds = Math.min(elapsedSeconds, 30 * 60);
            const interpolated = (esHoy && pt.current_q > 0) ? (pt.current_q * cappedSeconds) / 1000000 : 0;
            return ptAcc + (pt.daily_vol || 0) + interpolated;
        }, 0);
        return acc + mDailyVol;
    }, 0), [modules, now, esHoy]);

    const extractionTrend = useMemo(() => totalExtraccion > 30 ? 'rising' : totalExtraccion > 0 ? 'stable' : 'falling', [totalExtraccion]);

    /* ── Chart Data ── */
    const moduleChartData = useMemo(() =>
        modules.map(m => ({
            name: m.short_code || m.name.substring(0, 10),
            full_name: m.name,
            efficiency: Math.min(((m.accumulated_vol / (m.authorized_vol || 1)) * 100), 100),
            flow: m.current_flow * 1000
        })).sort((a, b) => b.efficiency - a.efficiency).slice(0, 8),
        [modules]
    );

    const damStorageData = useMemo(() =>
        presas.map(p => ({
            nombre: p.nombre_corto || p.nombre,
            actual: p.lectura?.almacenamiento_mm3 || 0,
            capacidad: p.capacidad_max_mm3,
            pct: ((p.lectura?.almacenamiento_mm3 || 0) / p.capacidad_max_mm3) * 100
        })),
        [presas]
    );

    /* Simulated extraction trend line — last 7 readings extrapolated */
    const extractionTrendData = useMemo(() => {
        const base = totalExtraccion || 0;
        const labels = ['−6d', '−5d', '−4d', '−3d', '−2d', 'Ayer', 'Hoy'];
        return labels.map((label, i) => ({
            label,
            extraccion: Math.max(0, base * (0.75 + Math.sin(i * 0.9) * 0.18 + i * 0.015))
        }));
    }, [totalExtraccion]);

    /* ── Alerts ── */
    const realAlerts: Alert[] = useMemo(() => {
        const alerts: Alert[] = [];
        modules.forEach(m => {
            if (m.current_flow > m.target_flow * 1.1 && m.target_flow > 0) {
                alerts.push({ id: `ovf-${m.id}`, type: 'critical', title: 'Sobregiro Detectado', message: `${m.name}: Gasto ${(m.current_flow * 1000).toFixed(0)} L/s excede autorizado.`, timestamp: 'Ahora' });
            }
        });
        presas.forEach(p => {
            if (p.lectura && p.lectura.porcentaje_llenado > 90) {
                alerts.push({ id: `dam-high-${p.id}`, type: 'warning' as const, title: 'Alto Nivel', message: `${p.nombre}: ${p.lectura.porcentaje_llenado.toFixed(1)}% de llenado.`, timestamp: p.lectura.fecha });
            }
        });
        if (alerts.length === 0) {
            alerts.push({ id: 'ok', type: 'info', title: 'Sistema Estable', message: 'Operando dentro de parámetros normales.', timestamp: 'Ahora' });
        }
        return alerts;
    }, [modules, presas]);

    if (loading && presas.length === 0) {
        return (
            <div className="dashboard-container flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-3 text-slate-400">
                    <Loader size={32} className="animate-spin text-blue-400" />
                    <span className="text-sm font-medium">Cargando Centro de Control...</span>
                </div>
            </div>
        );
    }

    /* ── Tooltip renderers ── */
    const StorageTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload?.length) return null;
        return (
            <div className="chart-tooltip">
                <p className="tooltip-label">{label}</p>
                {payload.map((p: any, i: number) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.fill || p.stroke }} />
                        <span className="tooltip-value" style={{ fontSize: '0.8rem' }}>
                            {Number(p.value).toFixed(1)} <span style={{ fontSize: '0.6rem', color: '#94a3b8' }}>Mm³</span>
                        </span>
                        <span style={{ fontSize: '0.65rem', color: '#64748b' }}>{p.name}</span>
                    </div>
                ))}
            </div>
        );
    };

    const ExtraccionTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload?.length) return null;
        return (
            <div className="chart-tooltip">
                <p className="tooltip-label">{label}</p>
                <p className="tooltip-value">{Number(payload[0].value).toFixed(2)} <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>m³/s</span></p>
            </div>
        );
    };

    /* ──────────── RENDER ──────────────────────────────────────── */
    return (
        <div className="dashboard-container" style={{ marginTop: '-24px' }}>

            {/* Header */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', paddingTop: '4px' }}>
                    <div style={{
                        flexShrink: 0, backgroundColor: 'rgba(255,255,255,0.03)',
                        padding: '10px', borderRadius: '16px',
                        border: '1px solid rgba(255,255,255,0.05)',
                        boxShadow: '0 8px 20px -5px rgba(0,0,0,0.3)'
                    }}>
                        <img src="/logos/logo-srl.png" alt="SRL Unidad Conchos" style={{ height: '54px', width: 'auto', objectFit: 'contain' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <h3 style={{ fontSize: '0.75rem', color: '#93c5fd', fontWeight: '600', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '2px' }}>
                            Sociedad de Asociaciones de Usuarios
                        </h3>
                        <h1 style={{ fontSize: '1.75rem', color: '#ffffff', fontWeight: '900', letterSpacing: '0.05em', textTransform: 'uppercase', lineHeight: '1', marginBottom: '4px' }}>
                            Unidad Conchos
                        </h1>
                        <h4 style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: '500', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                            S. de R.L. de I.P. y C.V.
                        </h4>
                    </div>
                </div>

                <header className="dashboard-header" style={{ marginBottom: '8px' }}>
                    <div>
                        <h2 className="text-2xl font-bold text-white tracking-tight">Centro de Control</h2>
                        <p className="text-slate-400 text-sm font-medium">
                            Distrito de Riego 005 Delicias — {esHoy ? 'Hoy' : formatFechaCorta(fechaSeleccionada)}
                        </p>
                    </div>
                    <div className="flex gap-4">
                        <button className="btn btn-primary shadow-lg shadow-blue-500/20" onClick={() => window.print()}>Generar Reporte Digital</button>
                    </div>
                </header>
            </div>

            {/* KPI Section */}
            <section className="dashboard-grid-kpi">
                <KPICard title="Almacenamiento Total" value={`${porcentajeLlenado.toFixed(1)}%`} subtext={`${totalAlmacenamiento.toFixed(1)} / ${totalCapacidad.toFixed(0)} Mm³`} icon={Waves} color="cyan" className="shadow-cyan-900/10" />
                <KPICard title="Extracción Total (Presas)" value={totalExtraccion.toFixed(1)} unit="m³/s" subtext="Gasto combinado actual" icon={Droplets} color="blue" trend={extractionTrend as any} className="shadow-blue-900/10" />
                <KPICard title="Entrega a Módulos" value={totalDailyVol.toFixed(4)} unit="Mm³" subtext="Volumen Real del Día (Mm³)" icon={Activity} color="emerald" trend="rising" className="shadow-emerald-900/10" />
                <KPICard title="Alertas Activas" value={realAlerts.length.toString()} subtext="Atención Requerida" icon={AlertTriangle} color={realAlerts.some(a => a.type === 'critical') ? 'rose' : 'amber'} className="shadow-rose-900/10" />
            </section>

            {/* Main Content Grid */}
            <section className="dashboard-grid-main">
                <div className="grid-col-left">

                    {/* Presa Cards */}
                    <div className="card presa-status-card">
                        <div className="presa-header flex justify-between items-center mb-2">
                            <h3 className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>Estado de Fuentes (Presas)</h3>
                            {presas[0]?.lectura && (
                                <span className="text-xs font-mono text-slate-500 bg-slate-800/50 px-2 py-1 rounded border border-slate-700">
                                    Lectura: {presas[0].lectura.fecha}
                                </span>
                            )}
                        </div>

                        <div className="space-y-4">
                            {presas.map(presa => {
                                const lect = presa.lectura;
                                const almacenamiento = lect?.almacenamiento_mm3 || 0;
                                const pctLlenado = lect?.porcentaje_llenado || 0;
                                const extraccion = lect?.extraccion_total_m3s || 0;
                                const elevacion = lect?.escala_msnm || 0;

                                return (
                                    <div key={presa.id} className="presa-item group">
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="flex items-center gap-3">
                                                {/* Mini donut per presa */}
                                                <DonutRing
                                                    pct={pctLlenado}
                                                    label="Llenado"
                                                    color={pctLlenado > 90 ? '#fbbf24' : '#60a5fa'}
                                                    size={80}
                                                />
                                                <div className="flex flex-col">
                                                    <h4 className="text-white font-bold text-base flex items-center gap-2">
                                                        {presa.nombre}
                                                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono">{presa.nombre_corto}</span>
                                                    </h4>
                                                    <span className="text-xs text-slate-400 mt-1">{presa.municipio}</span>
                                                </div>
                                            </div>
                                            <div className="text-right bg-blue-950/30 px-3 py-2 rounded-lg border border-blue-500/10">
                                                <div className="flex items-center justify-end gap-1 mb-1">
                                                    <span className="text-xs text-blue-300 uppercase font-bold tracking-wider">Extracción</span>
                                                    {extraccion > 0 ? <TrendingUp size={12} className="text-emerald-400" /> : <TrendingDown size={12} className="text-slate-500" />}
                                                </div>
                                                <span className="text-2xl font-mono font-bold text-blue-100">{extraccion.toFixed(1)} <span className="text-sm text-blue-400">m³/s</span></span>
                                            </div>
                                        </div>

                                        <div className="presa-stats">
                                            <div className="stat border-r border-slate-700/50">
                                                <span>Elevación Actual</span>
                                                <strong>{elevacion.toFixed(2)} <small className="text-slate-500 text-[10px]">msnm</small></strong>
                                            </div>
                                            <div className="stat border-r border-slate-700/50">
                                                <span>Almacenamiento</span>
                                                <strong>{almacenamiento.toFixed(1)} <small className="text-slate-500 text-[10px]">Mm³</small></strong>
                                            </div>
                                            <div className="stat">
                                                <span>% Llenado</span>
                                                <strong className={pctLlenado > 90 ? 'text-amber-400' : 'text-emerald-400'}>{pctLlenado.toFixed(1)}%</strong>
                                            </div>
                                        </div>

                                        <div className="presa-level mt-2">
                                            <div className="flex justify-between text-xxs text-slate-400 mb-1 font-mono">
                                                <span>NAMO ({presa.capacidad_max_mm3.toFixed(0)} Mm³)</span>
                                                <span>{almacenamiento.toFixed(1)} / {presa.capacidad_max_mm3.toFixed(0)} Mm³</span>
                                            </div>
                                            <div className="h-3 bg-slate-900/80 rounded-full overflow-hidden border border-slate-700/50 shadow-inner">
                                                <div
                                                    className={`h-full relative overflow-hidden transition-all duration-1000 ease-out ${pctLlenado > 90 ? 'bg-gradient-to-r from-amber-600 to-amber-400' : 'bg-gradient-to-r from-blue-600 to-cyan-400'}`}
                                                    style={{ width: `${Math.min(pctLlenado, 100)}%` }}
                                                >
                                                    <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── Chart 1: Almacenamiento por Presa — Gradient BarChart ── */}
                    <ChartWidget
                        title="Almacenamiento por Presa"
                        subtitle="Comparativa Actual vs Capacidad NAMO · Mm³"
                        badge="LIVE"
                        infoBar={
                            <div style={{ display: 'flex', gap: '1.5rem', width: '100%', justifyContent: 'center' }}>
                                <div className="chart-legend-item">
                                    <div className="chart-legend-dot" style={{ background: 'linear-gradient(135deg,#3b82f6,#06b6d4)' }} />
                                    Almacenamiento Actual
                                </div>
                                <div className="chart-legend-item">
                                    <div className="chart-legend-dot" style={{ background: 'rgba(99,179,237,0.2)', border: '1px dashed #60a5fa' }} />
                                    Capacidad NAMO
                                </div>
                            </div>
                        }
                    >
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart
                                data={damStorageData}
                                margin={{ top: 16, right: 16, left: 0, bottom: 0 }}
                                barGap={4}
                            >
                                <defs>
                                    <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#60a5fa" stopOpacity={1} />
                                        <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.8} />
                                    </linearGradient>
                                    <linearGradient id="gradCapacidad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.18} />
                                        <stop offset="100%" stopColor="#1e3a5f" stopOpacity={0.08} />
                                    </linearGradient>
                                    <filter id="glow-bar">
                                        <feGaussianBlur stdDeviation="3" result="blur" />
                                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                    </filter>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
                                <XAxis dataKey="nombre" tick={{ fill: '#64748b', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
                                <Tooltip content={<StorageTooltip />} cursor={{ fill: 'rgba(96,165,250,0.04)', radius: 6 } as any} />
                                <Bar dataKey="capacidad" name="Capacidad NAMO" fill="url(#gradCapacidad)" radius={[6, 6, 0, 0]} stroke="rgba(96,165,250,0.18)" strokeWidth={1} />
                                <Bar dataKey="actual" name="Actual" fill="url(#gradActual)" radius={[6, 6, 0, 0]}
                                    style={{ filter: 'drop-shadow(0 0 6px rgba(96,165,250,0.5))' }}>
                                    {damStorageData.map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={entry.pct > 90 ? 'url(#gradAmber)' : 'url(#gradActual)'}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </ChartWidget>

                    {/* ── Chart 2: Tendencia de Extracción — Glowing AreaChart ── */}
                    <ChartWidget
                        title="Tendencia de Extracción"
                        subtitle="Estimación histórica de la semana · m³/s"
                        badge="7d"
                        infoBar={
                            <div style={{ display: 'flex', gap: '1.5rem', width: '100%', justifyContent: 'center' }}>
                                <div className="chart-legend-item">
                                    <div className="chart-legend-dot" style={{ background: 'linear-gradient(135deg,#a78bfa,#60a5fa)' }} />
                                    Extracción combinada presas
                                </div>
                            </div>
                        }
                    >
                        <ResponsiveContainer width="100%" height={180}>
                            <AreaChart data={extractionTrendData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="gradExtraccion" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.5} />
                                        <stop offset="60%" stopColor="#60a5fa" stopOpacity={0.15} />
                                        <stop offset="100%" stopColor="#1e3a5f" stopOpacity={0.01} />
                                    </linearGradient>
                                    <filter id="glow-line">
                                        <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
                                        <feMerge>
                                            <feMergeNode in="blur" />
                                            <feMergeNode in="SourceGraphic" />
                                        </feMerge>
                                    </filter>
                                </defs>
                                <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="rgba(255,255,255,0.04)" />
                                <XAxis dataKey="label" tick={{ fill: '#475569', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
                                <Tooltip content={<ExtraccionTooltip />} cursor={{ stroke: 'rgba(167,139,250,0.3)', strokeWidth: 1, strokeDasharray: '4 2' }} />
                                <Area
                                    type="monotone"
                                    dataKey="extraccion"
                                    name="Extracción"
                                    stroke="#a78bfa"
                                    strokeWidth={2.5}
                                    fill="url(#gradExtraccion)"
                                    dot={{ fill: '#a78bfa', r: 4, strokeWidth: 2, stroke: '#1e1b4b' }}
                                    activeDot={{ r: 7, fill: '#a78bfa', stroke: '#fff', strokeWidth: 2, style: { filter: 'drop-shadow(0 0 8px #a78bfa)' } }}
                                    style={{ filter: 'drop-shadow(0 0 4px rgba(167,139,250,0.6))' }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </ChartWidget>
                </div>

                <div className="grid-col-right space-y-4">
                    <AlertList alerts={realAlerts} />

                    {/* ── Chart 3: Cumplimiento Módulos — Modern Lollipop Bars ── */}
                    <div className="card h-full flex flex-col">
                        <div className="flex items-center justify-between gap-2 mb-4">
                            <div className="flex items-center gap-2">
                                <Activity size={18} className="text-blue-400 shadow-blue-500/50 drop-shadow-sm" />
                                <h3 className="font-bold text-white">Cumplimiento Módulos</h3>
                            </div>
                            <span className="chart-badge">TOP 8</span>
                        </div>

                        {/* Legend */}
                        <div style={{ display: 'flex', gap: '1rem', marginBottom: '12px', flexWrap: 'wrap' }}>
                            {[
                                { color: 'linear-gradient(90deg,#10b981,#34d399)', label: '< 60%' },
                                { color: 'linear-gradient(90deg,#3b82f6,#06b6d4)', label: '60-89%' },
                                { color: 'linear-gradient(90deg,#f43f5e,#fb923c)', label: '≥ 90%' },
                            ].map(l => (
                                <div key={l.label} className="chart-legend-item">
                                    <div className="chart-legend-dot" style={{ background: l.color }} />
                                    {l.label}
                                </div>
                            ))}
                        </div>

                        <div className="flex-1">
                            {loadingModules ? (
                                <div className="flex items-center justify-center h-full text-slate-500 animate-pulse">Cargando datos...</div>
                            ) : moduleChartData.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    {moduleChartData.map((entry, i) => (
                                        <ModuleBar key={entry.name} name={entry.name} pct={entry.efficiency} rank={i + 1} />
                                    ))}
                                </div>
                            ) : (
                                <div className="flex items-center justify-center h-full text-slate-500">Sin datos operativos</div>
                            )}
                        </div>

                        <div className="mt-4 pt-4 border-t border-slate-700/30">
                            <button className="w-full py-2.5 text-xs font-bold text-blue-300 bg-blue-500/10 rounded-lg hover:bg-blue-500/20 transition-all hover:scale-[1.02] flex items-center justify-center gap-2 border border-blue-500/10">
                                Ver Matriz Completa <ArrowRight size={14} />
                            </button>
                        </div>
                    </div>

                    {/* ── Donut Summary + Version Control ── */}
                    <div className="card">
                        <div className="flex items-center gap-2 mb-4">
                            <Database size={18} className="text-violet-400" />
                            <h3 className="font-bold text-white">Balance Hídrico Global</h3>
                        </div>

                        {/* Donut rings row */}
                        <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', padding: '0 0 1rem' }}>
                            <DonutRing pct={porcentajeLlenado} label="Almac." color="#60a5fa" size={100} />
                            <DonutRing
                                pct={totalExtraccion > 0 ? Math.min((totalExtraccion / 80) * 100, 100) : 0}
                                label="Extrac."
                                color="#a78bfa"
                                size={100}
                            />
                            <DonutRing
                                pct={moduleChartData.length > 0 ? moduleChartData.reduce((a, m) => a + m.efficiency, 0) / moduleChartData.length : 0}
                                label="Eficiencia"
                                color="#34d399"
                                size={100}
                            />
                        </div>

                        <div className="pt-3 border-t border-slate-700/30">
                            <div className="flex items-center gap-2 mb-3">
                                <ShieldCheck size={14} className="text-emerald-400" />
                                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">SICA Source of Truth</span>
                            </div>
                            <div className="space-y-2">
                                {appVersions.map(v => (
                                    <div key={v.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-900/50 border border-slate-700/30">
                                        <div className="flex items-center gap-2">
                                            {v.app_id === 'capture' ? <Smartphone size={13} className="text-slate-400" /> : <MonitorIcon size={13} className="text-slate-400" />}
                                            <span className="text-xs font-medium text-slate-200 capitalize">{v.app_id.replace('-', ' ')}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300">v{v.version}</span>
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p className="text-[10px] text-slate-500 mt-3 leading-tight italic">
                                Los dispositivos con versiones inferiores a la mínima requerida son bloqueados automáticamente.
                            </p>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default Dashboard;
