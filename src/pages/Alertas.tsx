import { useState, useEffect, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, LineChart, Line, Cell, Legend } from 'recharts';
import { AlertTriangle, CheckCircle, TrendingDown, TrendingUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { onTable } from '../lib/realtimeHub';
import { formatTime } from '../utils/dateHelpers';
import { useAuth } from '../context/AuthContext';
import type { RegistroAlertaRow } from '../types/sica.types';

import './Alertas.css';

// ── HELPERS DE PERIODO ─────────────────────────────────────────────────────
function periodoInicio(periodo: string): string {
    const now = new Date();
    if (periodo === 'Última Semana') {
        const d = new Date(now); d.setDate(d.getDate() - 7);
        return d.toISOString();
    }
    if (periodo === 'Este Mes') {
        return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    }
    if (periodo === 'Últimos 3 Meses') {
        const d = new Date(now); d.setMonth(d.getMonth() - 3);
        return d.toISOString();
    }
    // Último día
    const d = new Date(now); d.setDate(d.getDate() - 1);
    return d.toISOString();
}

// Mapeo nivel UI → tipo_riesgo DB
function riesgoToTipo(riesgo: string): string[] {
    if (riesgo === 'Muy Alto') return ['critical'];
    if (riesgo === 'Alto')     return ['critical', 'warning'];
    if (riesgo === 'Medio')    return ['warning'];
    if (riesgo === 'Bajo')     return ['info'];
    return ['critical', 'warning', 'info'];
}

const CATEGORIA_COLORS: Record<string, string> = {
    'HIDRAULICA':  '#38bdf8',
    'NIVEL':       '#f59e0b',
    'CAUDAL':      '#f43f5e',
    'ESCALA':      '#a78bfa',
    'TOMA':        '#10b981',
    'PRESA':       '#fb923c',
    'SISTEMA':     '#64748b',
};

const Alertas = () => {
    const { profile } = useAuth();
    const [riesgo, setRiesgo]   = useState('Alto');
    const [periodo, setPeriodo] = useState('Última Semana');

    // Alertas activas (no resueltas) — fuente del log en vivo
    const [alertasActivas, setAlertasActivas]     = useState<RegistroAlertaRow[]>([]);
    // Alertas históricas del período (resueltas + activas) — fuente de gráficas
    const [alertasHistoricas, setAlertasHist]     = useState<RegistroAlertaRow[]>([]);
    // Datos de precipitación / clima para gráfica inferior
    const [climaData, setClimaData]               = useState<{ dia: string; mm: number }[]>([]);
    const [loading, setLoading]                   = useState(true);

    // ── FETCH ALERTAS ACTIVAS (vivo, sin filtro de tipo — filtramos en UI) ───
    const fetchActivas = async () => {
        setLoading(true);
        try {
            const { data } = await supabase
                .from('registro_alertas')
                .select('*')
                .eq('resuelta', false)
                .order('fecha_deteccion', { ascending: false });
            if (data) setAlertasActivas(data as RegistroAlertaRow[]);
        } catch { /* silencioso */ }
        finally { setLoading(false); }
    };

    // ── FETCH HISTÓRICAS del período (para gráficas) ──────────────────────
    const fetchHistoricas = async () => {
        try {
            const desde = periodoInicio(periodo);
            const { data } = await supabase
                .from('registro_alertas')
                .select('*')
                .gte('fecha_deteccion', desde)
                .order('fecha_deteccion', { ascending: true });
            if (data) setAlertasHist(data as RegistroAlertaRow[]);
        } catch { /* silencioso */ }
    };

    // ── FETCH CLIMA (precipitación) ──────────────────────────────────────
    const fetchClima = async () => {
        try {
            const desde = periodoInicio(periodo);
            const { data } = await supabase
                .from('clima_presas')
                .select('fecha, precipitacion_mm')
                .gte('fecha', desde.split('T')[0])
                .order('fecha', { ascending: true });
            if (data) {
                setClimaData(data.map((d: any) => ({
                    dia: d.fecha,
                    mm: d.precipitacion_mm ?? 0,
                })));
            }
        } catch { /* silencioso */ }
    };

    useEffect(() => {
        fetchActivas();
        const unsub = onTable('registro_alertas', '*', () => fetchActivas());
        return () => unsub();
    }, []);

    useEffect(() => {
        fetchHistoricas();
        fetchClima();
    }, [periodo]);

    // ── DATOS DERIVADOS ────────────────────────────────────────────────────

    // Log visible — filtrado por nivel de riesgo seleccionado
    const tiposVisibles = riesgoToTipo(riesgo);
    const alertasFiltradas = useMemo(
        () => alertasActivas.filter(a => tiposVisibles.includes(a.tipo_riesgo)),
        [alertasActivas, riesgo]
    );

    // KPIs
    const countCritical = alertasActivas.filter(a => a.tipo_riesgo === 'critical').length;
    const countWarning  = alertasActivas.filter(a => a.tipo_riesgo === 'warning').length;

    // Tendencia: alertas de las últimas 24h vs las 24h anteriores
    const ahora = Date.now();
    const ult24h   = alertasHistoricas.filter(a => ahora - new Date(a.fecha_deteccion).getTime() < 86400000).length;
    const prev24h  = alertasHistoricas.filter(a => {
        const t = ahora - new Date(a.fecha_deteccion).getTime();
        return t >= 86400000 && t < 172800000;
    }).length;
    const tendencia = ult24h - prev24h;

    // Sparkline de alertas activas por día (últimos 15 días)
    const sparkData = useMemo(() => {
        const dias: Record<string, number> = {};
        for (let i = 14; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            dias[d.toISOString().split('T')[0]] = 0;
        }
        alertasHistoricas
            .filter(a => a.tipo_riesgo === 'critical')
            .forEach(a => {
                const k = a.fecha_deteccion.split('T')[0];
                if (k in dias) dias[k]++;
            });
        return Object.entries(dias).map(([, val]) => ({ val }));
    }, [alertasHistoricas]);

    // Barchart: conteo real de alertas por categoría en el período
    const barData = useMemo(() => {
        const counts: Record<string, number> = {};
        alertasHistoricas.forEach(a => {
            const cat = (a.categoria ?? 'SISTEMA').toUpperCase();
            counts[cat] = (counts[cat] ?? 0) + 1;
        });
        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 7)
            .map(([name, uv]) => ({
                name: name.length > 8 ? name.slice(0, 8) : name,
                uv,
                color: CATEGORIA_COLORS[name] ?? '#64748b',
            }));
    }, [alertasHistoricas]);

    // Gráfica inferior: precipitación real de clima_presas (o placeholder vacío)
    const climaChartData = useMemo(() =>
        climaData.length > 0
            ? climaData.map(d => ({ day: d.dia.slice(5), mm: d.mm }))
            : [],
        [climaData]
    );

    // ── ATENDER — marca resuelta con responsable ──────────────────────────
    const handleAtender = async (id: string) => {
        await supabase
            .from('registro_alertas')
            .update({
                resuelta:          true,
                resuelto_por:      profile?.nombre ?? 'Operador',
                fecha_resolucion:  new Date().toISOString(),
            })
            .eq('id', id);
        // La suscripción Realtime actualiza fetchActivas() automáticamente
    };

    return (
        <div className="alertas-container">
            <header className="al-header">
                <div>
                    <h1 className="al-header-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        SICA DE ALERTAS: <span className="al-header-subtitle">MONITOREO HIDROLÓGICO CRÍTICO - DR 005 DELICIAS</span>
                    </h1>
                </div>
                <div className="al-header-right">
                    <span>PANEL DE CONTROL DE RIESGOS</span>
                    <img src="/logos/SICA005.png" alt="SICA 005" className="al-logos" />
                </div>
            </header>

            <div className="al-filters-row" style={{ marginBottom: '1rem' }}>
                <div className="al-filter-group">
                    <span className="al-filter-label">NIVEL DE RIESGO</span>
                    <div className="al-filter-controls">
                        <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(15,23,42,0.6)', padding: '0.2rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            {['Muy Alto', 'Alto', 'Medio', 'Bajo'].map(r => (
                                <button
                                    key={r}
                                    onClick={() => setRiesgo(r)}
                                    style={{
                                        background: riesgo === r ? 'rgba(255,255,255,0.1)' : 'transparent',
                                        color: riesgo === r ? (r === 'Muy Alto' || r === 'Alto' ? '#f43f5e' : r === 'Medio' ? '#f59e0b' : '#38bdf8') : '#94a3b8',
                                        border: 'none',
                                        padding: '0.3rem 1rem',
                                        borderRadius: '4px',
                                        fontSize: '0.8rem',
                                        fontWeight: riesgo === r ? 700 : 500,
                                        cursor: 'pointer'
                                    }}>
                                    {r}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="al-filter-group">
                    <span className="al-filter-label" style={{ textAlign: 'right' }}>PERÍODO (Gráficas)</span>
                    <div className="al-filter-controls">
                        <select className="al-combo-box" title="Seleccionar período" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
                            <option value="Último Día">Último Día</option>
                            <option value="Última Semana">Última Semana</option>
                            <option value="Este Mes">Este Mes</option>
                            <option value="Últimos 3 Meses">Últimos 3 Meses</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="al-grid">
                {/* Left Column */}
                <div className="al-left-col">
                    <div className="al-kpi-row">
                        {/* Alertas Críticas */}
                        <div className="al-kpi-card red">
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span className="al-kpi-title">ALERTAS CRÍTICAS ACTIVAS</span>
                                {countCritical === 0 ? <CheckCircle size={18} color="#10b981" /> : <AlertTriangle size={18} color="#f43f5e" opacity={0.8} />}
                            </div>
                            <span className="al-kpi-value">{loading ? '...' : countCritical}</span>
                            <div className="al-kpi-chart">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={sparkData}>
                                        <defs>
                                            <linearGradient id="gRed" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <Area type="monotone" dataKey="val" stroke="#f43f5e" fill="url(#gRed)" strokeWidth={2} isAnimationActive={false} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Advertencias */}
                        <div className="al-kpi-card amber">
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span className="al-kpi-title">ADVERTENCIAS ACTIVAS</span>
                            </div>
                            <span className="al-kpi-value">{loading ? '...' : `${countWarning}`}</span>
                            <div className="al-kpi-subtext">
                                {countWarning > 0 ? 'Focos de alerta en monitoreo activo.' : 'Sin advertencias pendientes.'}
                            </div>
                        </div>

                        {/* Tendencia 24h */}
                        <div className="al-kpi-card blue">
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span className="al-kpi-title">TENDENCIA 24H</span>
                                {tendencia > 0
                                    ? <TrendingUp size={16} color="#f43f5e" />
                                    : <TrendingDown size={16} color="#10b981" />}
                            </div>
                            <span className="al-kpi-value" style={{ color: tendencia > 0 ? '#f43f5e' : '#10b981' }}>
                                {tendencia > 0 ? `+${tendencia}` : tendencia === 0 ? '—' : `${tendencia}`}
                            </span>
                            <div className="al-kpi-subtext">
                                {tendencia > 0
                                    ? `${tendencia} más que las 24h previas`
                                    : tendencia < 0
                                        ? `${Math.abs(tendencia)} menos que las 24h previas`
                                        : 'Sin cambio vs las 24h previas'}
                            </div>
                        </div>
                    </div>

                    {/* Mapa geo-referenciado — pins sobre fondo */}
                    <div className="al-map-card">
                        <div className="al-card-title">ALERTAS GEO-REFERENCIADAS — Canal Conchos KM 0–104</div>
                        <div style={{ flex: 1, position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                            {/* Canal esquemático horizontal */}
                            <svg width="100%" height="100%" viewBox="0 0 800 200" style={{ position: 'absolute', top: 0, left: 0 }}>
                                {/* Fondo */}
                                <rect width="800" height="200" fill="rgba(5,14,26,0.6)" rx="8" />
                                {/* Línea del canal */}
                                <line x1="40" y1="100" x2="760" y2="100" stroke="rgba(56,189,248,0.25)" strokeWidth="8" strokeLinecap="round" />
                                <line x1="40" y1="100" x2="760" y2="100" stroke="rgba(56,189,248,0.5)" strokeWidth="2" strokeLinecap="round" />
                                {/* KM labels */}
                                {[0, 23, 34, 57, 80, 104].map(km => {
                                    const x = 40 + (km / 104) * 720;
                                    return (
                                        <g key={km}>
                                            <circle cx={x} cy={100} r={3} fill="#38bdf8" opacity={0.6} />
                                            <text x={x} y={120} fill="#475569" fontSize="10" textAnchor="middle">K{km}</text>
                                        </g>
                                    );
                                })}
                                {/* Pins de alertas reales */}
                                {alertasActivas.filter(a => a.coordenadas).map(alerta => {
                                    // Calcular posición x por longitud (aproximada al canal Conchos ~105.5°–106.5° W)
                                    const lng = Number(alerta.coordenadas!.lng);
                                    // Mapeo lineal: -106.5 → x=40, -105.5 → x=760
                                    const x = Math.max(40, Math.min(760, 40 + ((-105.5 - lng) / (-105.5 - (-106.5))) * 720));
                                    const color = alerta.tipo_riesgo === 'critical' ? '#f43f5e' : alerta.tipo_riesgo === 'warning' ? '#f59e0b' : '#38bdf8';
                                    return (
                                        <g key={alerta.id}>
                                            <circle cx={x} cy={80} r={5} fill={color} opacity={0.85}
                                                style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
                                            <line x1={x} y1={85} x2={x} y2={100} stroke={color} strokeWidth={1} opacity={0.5} />
                                            <text x={x} y={70} fill={color} fontSize="8" textAnchor="middle"
                                                style={{ fontFamily: 'monospace' }}>
                                                {alerta.origen_id ?? ''}
                                            </text>
                                        </g>
                                    );
                                })}
                                {/* Leyenda */}
                                {alertasActivas.filter(a => a.coordenadas).length === 0 && (
                                    <text x="400" y="95" fill="#334155" fontSize="12" textAnchor="middle">
                                        Sin alertas geo-referenciadas activas
                                    </text>
                                )}
                                <text x="400" y="185" fill="#1e3a5f" fontSize="9" textAnchor="middle">
                                    Presa Boquilla → K-0 Canal Conchos → K-104 Cola
                                </text>
                            </svg>
                        </div>
                    </div>
                </div>

                {/* Right Column */}
                <div className="al-right-col">
                    {/* Histórico real por categoría */}
                    <div className="al-side-card">
                        <div className="al-side-card-top">
                            <span className="al-card-title" style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                                {alertasHistoricas.length} eventos · {periodo}
                            </span>
                        </div>
                        <span className="al-card-title">ALERTAS POR CATEGORÍA</span>

                        <div style={{ flex: 1, minHeight: '150px' }}>
                            {barData.length === 0 ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#334155', fontSize: '0.8rem' }}>
                                    Sin datos en el período
                                </div>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={barData} margin={{ top: 20, right: 0, left: -25, bottom: 25 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                        <XAxis dataKey="name" stroke="none" tick={{ fill: '#64748b', fontSize: 9, textAnchor: 'end' }} dy={10} />
                                        <YAxis stroke="none" tick={{ fill: '#64748b', fontSize: 10 }} />
                                        <Tooltip
                                            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                            contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', border: '1px solid rgba(255,255,255,0.1)' }}
                                        />
                                        <Bar dataKey="uv" name="Alertas" radius={[4, 4, 0, 0]} maxBarSize={20}>
                                            {barData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.7} stroke={entry.color} strokeWidth={1} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>

                    {/* Precipitación real de clima_presas */}
                    <div className="al-side-card">
                        <span className="al-card-title">PRECIPITACIÓN — PRESAS ({periodo})</span>

                        <div style={{ flex: 1, minHeight: '150px', marginTop: '1rem' }}>
                            {climaChartData.length === 0 ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#334155', fontSize: '0.8rem' }}>
                                    Sin datos de clima en el período
                                </div>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={climaChartData} margin={{ top: 0, right: 0, left: -25, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                        <XAxis dataKey="day" stroke="none" tick={{ fill: '#64748b', fontSize: 9 }} dy={5} interval="preserveStartEnd" />
                                        <YAxis stroke="none" tick={{ fill: '#64748b', fontSize: 10 }} unit=" mm" />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', border: '1px solid rgba(255,255,255,0.1)' }}
                                            formatter={(v: number | undefined) => [`${v ?? 0} mm`, 'Precipitación']}
                                        />
                                        <Legend wrapperStyle={{ fontSize: '10px', top: -20 }} iconType="plainline" />
                                        <Line type="monotone" dataKey="mm" name="Precip. mm" stroke="#38bdf8" strokeWidth={2} dot={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Log de Eventos — filtrado por nivel seleccionado */}
            <div className="al-log-section" style={{ marginTop: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <div className="al-card-title">CENTRO DE DESPACHO: LOG DE EVENTOS — NIVEL {riesgo.toUpperCase()}</div>
                    <span style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 700 }}>
                        {alertasFiltradas.length} activa{alertasFiltradas.length !== 1 ? 's' : ''} · {alertasActivas.length} total sin resolver
                    </span>
                </div>
                <div className="al-log-container">
                    {loading ? (
                        <div className="al-log-loading">Sincronizando con Hydra Engine...</div>
                    ) : alertasFiltradas.length === 0 ? (
                        <div className="al-log-empty">
                            <CheckCircle size={20} color="#10b981" />
                            <span>
                                {alertasActivas.length === 0
                                    ? 'SISTEMA ÓPTIMO: No se detectan anomalías activas.'
                                    : `Sin alertas de nivel "${riesgo}" — hay ${alertasActivas.length} evento(s) en otros niveles.`}
                            </span>
                        </div>
                    ) : (
                        <div className="al-log-grid">
                            {alertasFiltradas.map((alerta) => (
                                <div key={alerta.id} className={`al-log-item ${alerta.tipo_riesgo}`}>
                                    <div className="al-log-indicator"></div>
                                    <div className="al-log-content">
                                        <div className="al-log-header">
                                            <span className="al-log-tag">{alerta.categoria.toUpperCase()}</span>
                                            <span className="al-log-time">{formatTime(alerta.fecha_deteccion)}</span>
                                            {alerta.origen_id && (
                                                <span style={{ fontSize: '0.6rem', color: '#38bdf8', fontWeight: 700, fontFamily: 'monospace' }}>
                                                    {alerta.origen_id}
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="al-log-title">{alerta.titulo}</h3>
                                        <p className="al-log-msg">{alerta.mensaje}</p>
                                    </div>
                                    <button
                                        className="al-log-action"
                                        onClick={() => handleAtender(alerta.id)}
                                    >
                                        ATENDER
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Alertas;
