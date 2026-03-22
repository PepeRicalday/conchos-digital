import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, LineChart, Line, Cell, Legend } from 'recharts';
import { AlertTriangle, MapPin, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { onTable } from '../lib/realtimeHub';
import { formatTime } from '../utils/dateHelpers';
import type { RegistroAlertaRow } from '../types/sica.types';

import './Alertas.css';

const Alertas = () => {
    const [riesgo, setRiesgo] = useState('Alto');
    const [periodo, setPeriodo] = useState('Última Semana');
    const [alertasActivas, setAlertasActivas] = useState<RegistroAlertaRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchAlertas = async () => {
            setLoading(true);
            try {
                // Fetch real alerts from Supabase
                const { data, error } = await supabase
                    .from('registro_alertas')
                    .select('*')
                    .eq('resuelta', false)
                    .order('fecha_deteccion', { ascending: false });

                if (!error && data) {
                    setAlertasActivas(data as RegistroAlertaRow[]);
                }
            } catch (err) {
                console.error("No se pudo cargar la matriz de alertas");
            } finally {
                setLoading(false);
            }
        };
        fetchAlertas();

        const unsubAlertas = onTable('registro_alertas', '*', () => fetchAlertas());

        return () => unsubAlertas();
    }, []);

    // Conteo Dinámico basado en Supabase
    const countCritical = alertasActivas.filter(a => a.tipo_riesgo === 'critical').length;
    const countWarning = alertasActivas.filter(a => a.tipo_riesgo === 'warning').length;

    // Datos simulados
    const sparkData = Array.from({ length: 15 }, () => ({ val: Math.random() * 10 }));

    const barData = [
        { name: 'CaudaL', uv: 17, pv: 2400, color: '#f43f5e' },
        { name: 'Evap', uv: 7, pv: 1398, color: '#38bdf8' },
        { name: 'Infra', uv: 12, pv: 9800, color: '#fbbf24' },
        { name: 'Infra2', uv: 17, pv: 3908, color: '#a78bfa' },
        { name: 'Evap2', uv: 7, pv: 4800, color: '#f59e0b' },
        { name: 'Caudal2', uv: 17, pv: 3800, color: '#10b981' },
    ];

    const lineData = Array.from({ length: 30 }, (_, i) => ({
        day: i + 1,
        spei1: (Math.sin(i / 5) * 0.5) + (Math.random() * 0.2) - 0.2,
        spi3: (Math.cos(i / 6) * 0.4) + (Math.random() * 0.2) - 0.1,
    }));

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
                                        color: riesgo === r ? (r === 'Alto' ? '#fbbf24' : '#f8fafc') : '#94a3b8',
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
                    <span className="al-filter-label" style={{ textAlign: 'right' }}>PERÍODO</span>
                    <div className="al-filter-controls">
                        <select className="al-combo-box" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
                            <option value="Última Semana">Última Semana</option>
                            <option value="Este Mes">Este Mes</option>
                        </select>
                        <select className="al-combo-box">
                            <option>Este Mes</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="al-grid">
                {/* Left Column (KPIs + Map) */}
                <div className="al-left-col">
                    <div className="al-kpi-row">
                        {/* Red Card */}
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
                                            <linearGradient id="gRed" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} /><stop offset="95%" stopColor="#f43f5e" stopOpacity={0} /></linearGradient>
                                        </defs>
                                        <Area type="monotone" dataKey="val" stroke="#f43f5e" fill="url(#gRed)" strokeWidth={2} isAnimationActive={false} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Amber Card */}
                        <div className="al-kpi-card amber">
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span className="al-kpi-title">ALMACENAMIENTO BAJO EL MÍNIMO</span>
                            </div>
                            <span className="al-kpi-value">{loading ? '...' : `${countWarning} ZONAS`}</span>
                            <div className="al-kpi-subtext">
                                {countWarning > 0 ? 'Focos de alerta por bajo nivel en reservorios.' : 'Niveles operativos dentro de lo normal.'}
                            </div>
                        </div>

                        {/* Blue Card */}
                        <div className="al-kpi-card blue">
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span className="al-kpi-title">PREVISIÓN DE ESCASEZ</span>
                            </div>
                            <span className="al-kpi-value">+18% RIESGO</span>
                            <div className="al-kpi-subtext">
                                para los próximos 30 días
                            </div>
                        </div>
                    </div>

                    <div className="al-map-card">
                        <div className="al-card-title">MAPA DE CALOR DE ALERTAS GEO-REFERENCIADAS (Recharts)</div>
                        <div style={{ flex: 1, position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                            {/* Visual simulation of the contour heatmap */}
                            <div style={{ position: 'relative', width: '80%', height: '80%', background: 'url(/logos/SICA005.png) center/contain no-repeat', filter: 'blur(1px) opacity(0.1)' }} />

                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={sparkData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                                        <defs>
                                            <radialGradient id="mapGlow" cx="50%" cy="50%" r="50%">
                                                <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.8} />
                                                <stop offset="50%" stopColor="#f59e0b" stopOpacity={0.4} />
                                                <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                                            </radialGradient>
                                        </defs>
                                        <Area type="monotone" dataKey="val" stroke="none" fill="url(#mapGlow)" strokeWidth={0} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                            <div style={{ position: 'absolute', zIndex: 20, width: '100%', height: '100%', pointerEvents: 'none' }}>
                                {alertasActivas.filter(al => al.coordenadas).map((alerta) => (
                                    <div
                                        key={alerta.id}
                                        style={{
                                            position: 'absolute',
                                            left: `${((Number(alerta.coordenadas.lng) + 106) * 50) % 80 + 10}%`,
                                            top: `${((Number(alerta.coordenadas.lat) - 27) * 40) % 70 + 15}%`,
                                            transform: 'translate(-50%, -100%)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center'
                                        }}
                                    >
                                        <MapPin
                                            color={alerta.tipo_riesgo === 'critical' ? '#f43f5e' : alerta.tipo_riesgo === 'warning' ? '#f59e0b' : '#38bdf8'}
                                            size={24}
                                            style={{
                                                filter: `drop-shadow(0 0 8px ${alerta.tipo_riesgo === 'critical' ? '#f43f5e' : alerta.tipo_riesgo === 'warning' ? '#f59e0b' : '#38bdf8'})`,
                                            }}
                                        />
                                        <div style={{
                                            fontSize: '8px',
                                            background: 'rgba(0,0,0,0.8)',
                                            padding: '2px 4px',
                                            borderRadius: '4px',
                                            marginTop: '2px',
                                            color: '#fff',
                                            border: '1px solid rgba(255,255,255,0.1)',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            {alerta.origen_id}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column (Charts) */}
                <div className="al-right-col">
                    <div className="al-side-card">
                        <div className="al-side-card-top">
                            <span className="al-card-title" style={{ color: '#cbd5e1', letterSpacing: '0px', textTransform: 'none' }}>Desglose Técnico Separado</span>
                        </div>
                        <span className="al-card-title">HISTÓRICO DE ALERTAS POR TIPO</span>

                        <div style={{ flex: 1, minHeight: '150px' }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={barData} margin={{ top: 20, right: 0, left: -25, bottom: 25 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                    <XAxis dataKey="name" stroke="none" tick={{ fill: '#64748b', fontSize: 9, textAnchor: 'end' }} dy={10} />
                                    <YAxis stroke="none" tick={{ fill: '#64748b', fontSize: 10 }} />
                                    <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', border: '1px solid rgba(255,255,255,0.1)' }} />
                                    <Legend wrapperStyle={{ fontSize: '10px', top: -30 }} iconType="plainline" />
                                    <Bar dataKey="uv" name="Alertas" radius={[4, 4, 0, 0]} maxBarSize={20}>
                                        {barData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill="transparent" stroke={entry.color} strokeWidth={2} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className="al-side-card">
                        <span className="al-card-title">EVOLUCIÓN DEL ÍNDICE DE SEQUÍA</span>

                        <div style={{ flex: 1, minHeight: '150px', marginTop: '1rem' }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={lineData} margin={{ top: 0, right: 0, left: -25, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                    <XAxis dataKey="day" stroke="none" tick={{ fill: '#64748b', fontSize: 10 }} dy={5} />
                                    <YAxis stroke="none" tick={{ fill: '#64748b', fontSize: 10 }} domain={['dataMin - 0.2', 'dataMax + 0.2']} />
                                    <Tooltip contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', border: '1px solid rgba(255,255,255,0.1)' }} />
                                    <Legend wrapperStyle={{ fontSize: '10px', top: -20 }} iconType="plainline" />
                                    <Line type="monotone" dataKey="spei1" name="SPEI-1" stroke="#38bdf8" strokeWidth={2} dot={false} />
                                    <Line type="monotone" dataKey="spi3" name="SPI-3" stroke="#fbbf24" strokeWidth={2} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

            </div>

            {/* FASE 5: Listado Detallado de Alertas (Log) */}
            <div className="al-log-section" style={{ marginTop: '1.5rem' }}>
                <div className="al-card-title" style={{ marginBottom: '1rem' }}>CENTRO DE DESPACHO: LOG DE EVENTOS CRÍTICOS</div>
                <div className="al-log-container">
                    {loading ? (
                        <div className="al-log-loading">Sincronizando con Hydra Engine...</div>
                    ) : alertasActivas.length === 0 ? (
                        <div className="al-log-empty">
                            <CheckCircle size={20} color="#10b981" />
                            <span>SISTEMA ÓPTIMO: No se detectan anomalías en la red de canales ni presas.</span>
                        </div>
                    ) : (
                        <div className="al-log-grid">
                            {alertasActivas.map((alerta) => (
                                <div key={alerta.id} className={`al-log-item ${alerta.tipo_riesgo}`}>
                                    <div className="al-log-indicator"></div>
                                    <div className="al-log-content">
                                        <div className="al-log-header">
                                            <span className="al-log-tag">{alerta.categoria.toUpperCase()}</span>
                                            <span className="al-log-time">{formatTime(alerta.fecha_deteccion)}</span>
                                        </div>
                                        <h3 className="al-log-title">{alerta.titulo}</h3>
                                        <p className="al-log-msg">{alerta.mensaje}</p>
                                    </div>
                                    <button
                                        className="al-log-action"
                                        onClick={async () => {
                                            await supabase
                                                .from('registro_alertas')
                                                .update({ resuelta: true, fecha_resolucion: new Date().toISOString() })
                                                .eq('id', alerta.id);
                                        }}
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
