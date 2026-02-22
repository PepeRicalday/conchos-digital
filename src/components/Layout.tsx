import React, { type ReactNode } from 'react';
import Sidebar from './Sidebar';
import SelectorFecha from './SelectorFecha';
import './Layout.css';

interface LayoutProps {
    children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
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
