import React, { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import clsx from 'clsx';
import Sidebar from './Sidebar';
import MobileTopBar from './MobileTopBar';
import SelectorFecha from './SelectorFecha';
import { useHydraStore } from '../store/useHydraStore';
import { startHub, stopHub } from '../lib/realtimeHub';
import { useDevice } from '../hooks/useDevice';
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
    // En teléfono el menú lateral es un panel deslizable que se abre desde la barra superior.
    const { esPhone } = useDevice();
    const [menuAbierto, setMenuAbierto] = useState(false);

    useEffect(() => {
        startHub();
        const { initSubscription, destroySubscription } = useHydraStore.getState();
        initSubscription();
        return () => {
            destroySubscription();
            stopHub();
        };
    }, []);

    // Navegar cierra el menú; salir de modo teléfono (p. ej. girar a escritorio) también.
    useEffect(() => { setMenuAbierto(false); }, [location.pathname]);
    useEffect(() => { if (!esPhone) setMenuAbierto(false); }, [esPhone]);

    // Menú abierto: Escape lo cierra y el fondo no se desplaza detrás del panel.
    useEffect(() => {
        if (!menuAbierto) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuAbierto(false); };
        window.addEventListener('keydown', onKey);
        const main = document.querySelector<HTMLElement>('.main-content');
        const previo = main?.style.overflowY ?? '';
        if (main) main.style.overflowY = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            if (main) main.style.overflowY = previo;
        };
    }, [menuAbierto]);

    // Menú cerrado en teléfono: fuera del orden de tabulación/lectores de pantalla (inert).
    useEffect(() => {
        const aside = document.getElementById('sidebar-principal');
        if (aside) aside.toggleAttribute('inert', esPhone && !menuAbierto);
    }, [esPhone, menuAbierto]);

    return (
        <div className={clsx('layout-container', menuAbierto && 'menu-abierto')}>
            {esPhone && <MobileTopBar abierto={menuAbierto} onAlternar={() => setMenuAbierto(v => !v)} />}
            <Sidebar />
            <div className="sidebar-backdrop" onClick={() => setMenuAbierto(false)} aria-hidden="true" />
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
