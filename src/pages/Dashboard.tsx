import { useMemo, useState, useEffect } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { Droplets, Waves, Activity, AlertTriangle, TrendingUp, TrendingDown, ArrowRight, Loader, ShieldCheck, Smartphone, Monitor as MonitorIcon } from 'lucide-react';
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

const Dashboard = () => {
    const { fechaSeleccionada, esHoy } = useFecha();

    // 1. Get Canal Data (Hydra Engine)
    const { modules, loading: loadingModules } = useHydraEngine();

    // 2. Get Presas Data from Supabase
    const {
        presas,
        totalAlmacenamiento,
        totalCapacidad,
        totalExtraccion,
        porcentajeLlenado,
        loading: loadingPresas
    } = usePresas(fechaSeleccionada);

    // 2.1. Version Info for Dashboard
    const [appVersions, setAppVersions] = useState<any[]>([]);
    useEffect(() => {
        const fetchVersions = async () => {
            const { data } = await supabase.from('app_versions').select('*');
            if (data) setAppVersions(data);
        };
        fetchVersions();
    }, []);

    const loading = loadingModules || loadingPresas;

    // Dashboard Vivo - Live tick
    const [now, setNow] = useState<number>(Date.now());
    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 3000);
        return () => clearInterval(interval);
    }, []);

    // 3. Aggregate Data with Interpolation
    const totalDailyVol = useMemo(() => modules.reduce((acc, m) => {
        const mDailyVol = m.delivery_points.reduce((ptAcc, pt) => {
            const elapsedSeconds = pt.last_update_time ? Math.max(0, (now - new Date(pt.last_update_time).getTime()) / 1000) : 0;
            // M-07: Cap interpolation at 30 min to prevent drift when measurements stop
            const cappedSeconds = Math.min(elapsedSeconds, 30 * 60);
            const interpolated = (esHoy && pt.current_q > 0) ? (pt.current_q * cappedSeconds) / 1000000 : 0;
            return ptAcc + (pt.daily_vol || 0) + interpolated;
        }, 0);
        return acc + mDailyVol;
    }, 0), [modules, now, esHoy]);

    // Extraction trend from data
    const extractionTrend = useMemo(() => totalExtraccion > 30 ? 'rising' : totalExtraccion > 0 ? 'stable' : 'falling', [totalExtraccion]);

    // Prepare Module Data for Bar Chart
    const moduleChartData = useMemo(() => {
        return modules.map(m => ({
            name: m.short_code || m.name.substring(0, 10),
            full_name: m.name,
            efficiency: Math.min(((m.accumulated_vol / (m.authorized_vol || 1)) * 100), 100),
            flow: m.current_flow * 1000
        })).sort((a, b) => b.efficiency - a.efficiency).slice(0, 8);
    }, [modules]);

    // Generate Alerts from Real Data
    const realAlerts: Alert[] = useMemo(() => {
        const alerts: Alert[] = [];

        modules.forEach(m => {
            if (m.current_flow > m.target_flow * 1.1 && m.target_flow > 0) {
                alerts.push({
                    id: `ovf-${m.id}`,
                    type: 'critical',
                    title: 'Sobregiro Detectado',
                    message: `${m.name}: Gasto ${(m.current_flow * 1000).toFixed(0)} L/s excede autorizado.`,
                    timestamp: 'Ahora'
                });
            }
        });

        presas.forEach(p => {
            if (p.lectura && p.lectura.porcentaje_llenado > 90) {
                alerts.push({
                    id: `dam-high-${p.id}`,
                    type: 'warning' as const,
                    title: 'Alto Nivel',
                    message: `${p.nombre}: ${p.lectura.porcentaje_llenado.toFixed(1)}% de llenado.`,
                    timestamp: p.lectura.fecha
                });
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

    return (
        <div className="dashboard-container" style={{ marginTop: '-24px' }}>
            {/* Header Wrapper to negate dashboard-container grid gap */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {/* Encabezado Oficial SRL */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', paddingTop: '4px' }}>
                    <div style={{
                        flexShrink: 0,
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        padding: '10px',
                        borderRadius: '16px',
                        border: '1px solid rgba(255,255,255,0.05)',
                        boxShadow: '0 8px 20px -5px rgba(0, 0, 0, 0.3)'
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
                <KPICard
                    title="Almacenamiento Total"
                    value={`${porcentajeLlenado.toFixed(1)}%`}
                    subtext={`${totalAlmacenamiento.toFixed(1)} / ${totalCapacidad.toFixed(0)} Mm³`}
                    icon={Waves}
                    color="cyan"
                    className="shadow-cyan-900/10"
                />
                <KPICard
                    title="Extracción Total (Presas)"
                    value={totalExtraccion.toFixed(1)}
                    unit="m³/s"
                    subtext="Gasto combinado actual"
                    icon={Droplets}
                    color="blue"
                    trend={extractionTrend as any}
                    className="shadow-blue-900/10"
                />
                <KPICard
                    title="Entrega a Módulos"
                    value={totalDailyVol.toFixed(4)}
                    unit="Mm³"
                    subtext="Volumen Real del Día (Mm³)"
                    icon={Activity}
                    color="emerald"
                    trend="rising"
                    className="shadow-emerald-900/10"
                />
                <KPICard
                    title="Alertas Activas"
                    value={realAlerts.length.toString()}
                    subtext="Atención Requerida"
                    icon={AlertTriangle}
                    color={realAlerts.some(a => a.type === 'critical') ? 'rose' : 'amber'}
                    className="shadow-rose-900/10"
                />
            </section>

            {/* Main Content Grid */}
            <section className="dashboard-grid-main">
                <div className="grid-col-left">
                    {/* Presas Status from Supabase */}
                    <div className="card presa-status-card">
                        <div className="presa-header flex justify-between items-center mb-2">
                            <h3 className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div> Estado de Fuentes (Presas)</h3>
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
                                            <div className="flex flex-col">
                                                <h4 className="text-white font-bold text-base flex items-center gap-2">
                                                    {presa.nombre}
                                                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono">{presa.nombre_corto}</span>
                                                </h4>
                                                <span className="text-xs text-slate-400 mt-1">{presa.municipio}</span>
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

                    {/* Chart - Storage comparison placeholder */}
                    <ChartWidget title="Almacenamiento por Presa (Mm³)">
                        <div style={{ width: '100%', height: 300 }}>
                            <ResponsiveContainer>
                                <BarChart
                                    data={presas.map(p => ({
                                        nombre: p.nombre_corto || p.nombre,
                                        actual: p.lectura?.almacenamiento_mm3 || 0,
                                        capacidad: p.capacidad_max_mm3,
                                    }))}
                                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="nombre" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'rgba(15, 23, 42, 0.9)',
                                            borderColor: 'rgba(255,255,255,0.1)',
                                            borderRadius: '8px',
                                        }}
                                        itemStyle={{ color: '#fff', fontSize: '12px' }}
                                    />
                                    <Bar dataKey="capacidad" name="Capacidad NAMO" fill="rgba(59,130,246,0.2)" radius={[4, 4, 0, 0]} />
                                    <Bar dataKey="actual" name="Almacenamiento Actual" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </ChartWidget>
                </div>

                <div className="grid-col-right space-y-4">
                    <AlertList alerts={realAlerts} />

                    <div className="card h-full flex flex-col">
                        <div className="flex items-center gap-2 mb-4">
                            <Activity size={18} className="text-blue-400 shadow-blue-500/50 drop-shadow-sm" />
                            <h3 className="font-bold text-white">Cumplimiento Módulos</h3>
                        </div>

                        <div className="flex-1 w-full min-h-[300px]">
                            {loadingModules ? (
                                <div className="flex items-center justify-center h-full text-slate-500 animate-pulse">Cargando datos...</div>
                            ) : moduleChartData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart
                                        data={moduleChartData}
                                        layout="vertical"
                                        margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                                        barSize={12}
                                    >
                                        <XAxis type="number" domain={[0, 100]} hide />
                                        <YAxis
                                            type="category"
                                            dataKey="name"
                                            tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 500 }}
                                            width={50}
                                            axisLine={false}
                                            tickLine={false}
                                        />
                                        <Tooltip
                                            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                            contentStyle={{
                                                backgroundColor: '#0f172a',
                                                borderColor: '#1e293b',
                                                color: '#f1f5f9',
                                                fontSize: '12px',
                                                borderRadius: '6px'
                                            }}
                                            formatter={(value: any) => [`${value.toFixed(1)}%`, 'Cumplimiento']}
                                        />
                                        <Bar dataKey="efficiency" radius={[0, 4, 4, 0]} background={{ fill: 'rgba(255,255,255,0.02)' }}>
                                            {moduleChartData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.efficiency > 90 ? '#f43f5e' : '#10b981'} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
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

                    {/* Version Control Widget */}
                    <div className="card">
                        <div className="flex items-center gap-2 mb-4">
                            <ShieldCheck size={18} className="text-emerald-400" />
                            <h3 className="font-bold text-white">SICA "Source of Truth"</h3>
                        </div>
                        <div className="space-y-3">
                            {appVersions.map(v => (
                                <div key={v.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-900/50 border border-slate-700/30">
                                    <div className="flex items-center gap-2">
                                        {v.app_id === 'capture' ? <Smartphone size={14} className="text-slate-400" /> : <MonitorIcon size={14} className="text-slate-400" />}
                                        <span className="text-xs font-medium text-slate-200 capitalize">{v.app_id.replace('-', ' ')}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300">v{v.version}</span>
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <p className="text-[10px] text-slate-500 mt-4 leading-tight italic">
                            Los dispositivos con versiones inferiores a la mínima requerida son bloqueados automáticamente por seguridad.
                        </p>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default Dashboard;
