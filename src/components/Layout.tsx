import React, { useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import SelectorFecha from './SelectorFecha';
import { useHydraStore } from '../store/useHydraStore';
import { startHub, stopHub } from '../lib/realtimeHub';
import './Layout.css';

interface LayoutProps {
    children: ReactNode;
}

// Rutas cuya página realmente consume useFecha (FechaContext) — el selector
// solo debe mostrarse donde cambiar la fecha tiene un efecto visible.
const RUTAS_CON_SELECTOR_FECHA = new Set(['/', '/presas', '/escalas', '/clima', '/bitacora', '/balance']);

const Layout: React.FC<LayoutProps> = ({ children }) => {
    const location = useLocation();
    const mostrarSelectorFecha = RUTAS_CON_SELECTOR_FECHA.has(location.pathname);

    useEffect(() => {
        startHub();
        const { initSubscription, destroySubscription } = useHydraStore.getState();
        initSubscription();
        return () => {
            destroySubscription();
            stopHub();
        };
    }, []);

    return (
        <div className="layout-container">
            <Sidebar />
            <main className="main-content">
                {mostrarSelectorFecha && (
                    <div className="top-bar">
                        <SelectorFecha />
                    </div>
                )}
                {children}
            </main>
        </div>
    );
};

export default Layout;
