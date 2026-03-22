import { useState, useMemo, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Droplets, Waves, Activity, Bell, Cloud, Map, LogOut, User as UserIcon, BookOpen, CalendarDays, MapPin, ChevronDown, ChevronUp, FolderKanban, Brain, Gauge, BarChart3, Database, Box } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { useHydraStore } from '../store/useHydraStore';
import { supabase } from '../lib/supabase';
import { onTable } from '../lib/realtimeHub';

import './Layout.css';
import SupabaseStatus from './SupabaseStatus';

const Sidebar = () => {
    const { profile, signOut } = useAuth();
    const navigate = useNavigate();
    const [isAdminOpen, setIsAdminOpen] = useState(false);
    const modules = useHydraStore(s => s.modules);

    // ── Live micro-indicators from HydraStore ──
    const liveStats = useMemo(() => {
        const totalPoints = modules.reduce((acc, m) => acc + m.delivery_points.length, 0);
        const activePoints = modules.reduce((acc, m) => acc + m.delivery_points.filter(p => p.is_open).length, 0);
        const totalFlow = modules.reduce((acc, m) => acc + m.current_flow, 0);
        return { totalPoints, activePoints, totalFlow };
    }, [modules]);

    // ── Realtime Alertas Badge ──
    const [criticalAlertsCount, setCriticalAlertsCount] = useState(0);

    useEffect(() => {
        const fetchAlerts = async () => {
            const { count } = await supabase
                .from('registro_alertas')
                .select('*', { count: 'exact', head: true })
                .eq('resuelta', false)
                .in('tipo_riesgo', ['critical', 'warning']);
            setCriticalAlertsCount(count || 0);
        };
        fetchAlerts();

        const unsubAlertas = onTable('registro_alertas', '*', () => fetchAlerts());

        return () => unsubAlertas();
    }, []);

    const handleLogout = async () => {
        await signOut();
        navigate('/login');
    };

    const navItems = [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
        { icon: Waves, label: 'Presas', path: '/presas' },
        { icon: Box, label: 'Modelación Hidráulica', path: '/modelacion-hidraulica' },
        { icon: Droplets, label: 'Distribución', path: '/canales', badge: liveStats.activePoints > 0 ? `${liveStats.activePoints}` : undefined },
        { icon: Gauge, label: 'Control de Niveles', path: '/escalas' },
        { icon: Activity, label: 'Hidrometría', path: '/hidrometria' },
        { icon: BarChart3, label: 'Balance Hidráulico', path: '/balance' },
        { icon: Database, label: 'Análisis Histórico', path: '/analisis-historico' },
        { icon: Cloud, label: 'Clima', path: '/clima' },
        { icon: Map, label: 'Geo-Monitor', path: '/geo-monitor' },
        { icon: Activity, label: 'Monitor Público', path: '/monitor-publico' },
        { icon: Bell, label: 'Alertas', path: '/alertas', badge: criticalAlertsCount > 0 ? `${criticalAlertsCount}` : undefined, badgeColor: criticalAlertsCount > 0 ? '#f43f5e' : undefined },
    ];

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="brand-logo-container">
                    <img src="/logos/SICA005.png" alt="SICA 005" className="brand-logo" />
                </div>
                <div className="brand-text">
                    <h1 className="text-sm font-bold text-white tracking-widest uppercase mt-1">
                        Control Digital
                    </h1>
                </div>
            </div>

            {profile && (
                <div className="user-profile-summary">
                    <div className="avatar-small">
                        <UserIcon size={16} />
                    </div>
                    <div className="profile-info">
                        <span className="profile-name">{profile.nombre}</span>
                        <span className="profile-role">{profile.rol === 'SRL' ? 'SRL Conchos' : `Módulo ${profile.modulo_id}`}</span>
                    </div>
                </div>
            )}

            {/* ── Live System Pulse ── */}
            {liveStats.totalFlow > 0 && (
                <div style={{
                    margin: '0 var(--spacing-md)',
                    marginBottom: 'var(--spacing-sm)',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid rgba(16, 185, 129, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                }}>
                    <div style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: '#10b981',
                        boxShadow: '0 0 8px rgba(16, 185, 129, 0.6)',
                        animation: 'pulse-glow 2s infinite',
                    }} />
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.65rem', color: '#94a3b8', letterSpacing: '1px', textTransform: 'uppercase' }}>
                            Caudal Total
                        </div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#10b981', fontFamily: 'var(--font-mono)' }}>
                            {liveStats.totalFlow.toFixed(2)} m³/s
                        </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Tomas</div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc', fontFamily: 'var(--font-mono)' }}>
                            {liveStats.activePoints}/{liveStats.totalPoints}
                        </div>
                    </div>
                </div>
            )}

            <nav className="sidebar-nav">
                {navItems.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive }) =>
                            clsx('nav-item', isActive && 'active')
                        }
                    >
                        <item.icon size={20} />
                        <span>{item.label}</span>
                        {item.badge && (
                            <span style={{
                                marginLeft: 'auto',
                                fontSize: '0.6rem',
                                fontWeight: 800,
                                padding: '2px 6px',
                                borderRadius: '9999px',
                                background: item.badgeColor ? `color-mix(in srgb, ${item.badgeColor} 15%, transparent)` : 'rgba(16, 185, 129, 0.15)',
                                color: item.badgeColor || '#10b981',
                                fontFamily: 'var(--font-mono)',
                                border: `1px solid ${item.badgeColor ? `color-mix(in srgb, ${item.badgeColor} 40%, transparent)` : 'rgba(16, 185, 129, 0.2)'}`,
                                minWidth: '22px',
                                textAlign: 'center',
                                boxShadow: item.badgeColor ? `0 0 10px color-mix(in srgb, ${item.badgeColor} 20%, transparent)` : 'none'
                            }}>{item.badge}</span>
                        )}
                    </NavLink>
                ))}
            </nav>

            <div className="sidebar-footer">
                <div className="admin-menu-container mb-2">
                    <button
                        onClick={() => setIsAdminOpen(!isAdminOpen)}
                        className="nav-item"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <FolderKanban size={20} />
                            <span>Administración</span>
                        </div>
                        {isAdminOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>

                    {isAdminOpen && (
                        <div className="admin-submenu" style={{ paddingLeft: '1rem', marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <NavLink to="/bitacora" className={({ isActive }) => clsx('nav-item', isActive && 'active')} style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
                                <BookOpen size={16} />
                                <span>Bitácora Oficial</span>
                            </NavLink>
                            <NavLink to="/ciclos" className={({ isActive }) => clsx('nav-item', isActive && 'active')} style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
                                <CalendarDays size={16} />
                                <span>Ciclo Agrícola</span>
                            </NavLink>
                            <NavLink to="/infraestructura" className={({ isActive }) => clsx('nav-item', isActive && 'active')} style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
                                <MapPin size={16} />
                                <span>Infraestructura</span>
                            </NavLink>
                        </div>
                    )}
                </div>

                {profile?.rol === 'SRL' && (
                    <NavLink
                        to="/inteligencia-hidrica"
                        className={({ isActive }) => clsx('nav-item', isActive && 'active')}
                        style={{ background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: '12px', position: 'relative' }}
                    >
                        <Brain size={20} />
                        <span>Inteligencia Hídrica</span>
                        <span style={{
                            marginLeft: 'auto',
                            fontSize: '0.55rem',
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: '9999px',
                            background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(129, 140, 248, 0.2))',
                            color: '#38bdf8',
                            border: '1px solid rgba(56, 189, 248, 0.2)',
                            letterSpacing: '0.5px',
                        }}>IA</span>
                    </NavLink>
                )}

                <button onClick={handleLogout} className="nav-item logout-button mx-4" style={{
                    background: 'none',
                    border: 'none',
                    width: 'calc(100% - 32px)',
                    cursor: 'pointer',
                    color: '#f87171'
                }}>
                    <LogOut size={20} />
                    <span>Cerrar Sesión</span>
                </button>

                <div style={{ padding: '0 var(--spacing-md)', marginTop: '8px' }}>
                    <div className="status-indicator justify-center mb-1">
                        <SupabaseStatus />
                    </div>
                    <div className="footer-version text-center">v{__APP_VERSION__} — Sist. Control Integrado</div>
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;

