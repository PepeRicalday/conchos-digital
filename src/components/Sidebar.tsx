import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Droplets, Waves, Activity, Settings, Bell, Cloud, Map, LogOut, User as UserIcon } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';

import './Layout.css';
import SupabaseStatus from './SupabaseStatus';

const Sidebar = () => {
    const { profile, signOut } = useAuth();
    const navigate = useNavigate();

    const handleLogout = async () => {
        await signOut();
        navigate('/login');
    };

    const navItems = [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
        { icon: Waves, label: 'Presas', path: '/presas' },
        { icon: Droplets, label: 'Distribución', path: '/canales' },
        { icon: Activity, label: 'Control de Escalas', path: '/escalas' },
        { icon: Activity, label: 'Hidrometría', path: '/hidrometria' },
        { icon: Cloud, label: 'Clima', path: '/clima' },
        { icon: Map, label: 'Geo-Monitor', path: '/geo-monitor' },
        { icon: Bell, label: 'Alertas', path: '/alertas', badge: 3 },
    ];

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="brand-logo-container">
                    <img src="/logos/SICA005.png" alt="SICA 005" className="brand-logo" />
                </div>
                <div className="brand-text">
                    <h1>Conchos-Digital</h1>
                    <p>Distrito 005</p>
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
                        {item.badge && <span className="badge badge-pulse">{item.badge}</span>}
                    </NavLink>
                ))}
            </nav>

            <div className="sidebar-footer">
                <NavLink to="/settings" className="nav-item">
                    <Settings size={20} />
                    <span>Configuración</span>
                </NavLink>

                <button onClick={handleLogout} className="nav-item logout-button" style={{
                    background: 'none',
                    border: 'none',
                    width: '100%',
                    cursor: 'pointer',
                    color: '#f87171'
                }}>
                    <LogOut size={20} />
                    <span>Cerrar Sesión</span>
                </button>

                <div style={{ padding: '0 var(--spacing-md)', marginTop: '10px' }}>
                    <div className="status-indicator">
                        <SupabaseStatus />
                    </div>
                    <div className="footer-version">v1.2.0 — SICA 005 Delicias</div>
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
