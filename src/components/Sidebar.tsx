import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Droplets, Waves, Activity, Bell, Cloud, Map, LogOut, User as UserIcon, BookOpen, CalendarDays, MapPin, ChevronDown, ChevronUp, FolderKanban, Brain } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';

import './Layout.css';
import SupabaseStatus from './SupabaseStatus';

const Sidebar = () => {
    const { profile, signOut } = useAuth();
    const navigate = useNavigate();
    const [isAdminOpen, setIsAdminOpen] = useState(false);

    const handleLogout = async () => {
        await signOut();
        navigate('/login');
    };

    const navItems = [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
        { icon: Waves, label: 'Presas', path: '/presas' },
        { icon: Droplets, label: 'Distribución', path: '/canales' },
        { icon: Activity, label: 'Control de Niveles', path: '/escalas' },
        { icon: Activity, label: 'Hidrometría', path: '/hidrometria' },
        { icon: Cloud, label: 'Clima', path: '/clima' },
        { icon: Map, label: 'Geo-Monitor', path: '/geo-monitor' },
        { icon: Bell, label: 'Alertas', path: '/alertas' },
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
