import React, { useEffect, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import SelectorFecha from './SelectorFecha';
import { useHydraStore } from '../store/useHydraStore';
import { startHub, stopHub } from '../lib/realtimeHub';
import './Layout.css';

interface LayoutProps {
    children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
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
                <div className="top-bar">
                    <SelectorFecha />
                </div>
                {children}
            </main>
        </div>
    );
};

export default Layout;
