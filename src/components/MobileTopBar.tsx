import { useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';

// Barra superior fija que solo existe en teléfono (data-device="phone", ver hooks/useDevice.ts).
// Respeta la isla dinámica del iPhone (padding-top: var(--sat)) y abre/cierra el menú lateral
// deslizable. Los títulos replican las etiquetas del menú (Sidebar.tsx).
const TITULOS: Record<string, string> = {
    '/': 'Dashboard',
    '/monitor-publico': 'Monitor Público',
    '/alertas': 'Alertas',
    '/presas': 'Presas',
    '/escalas': 'Control de Niveles',
    '/hidrometria': 'Hidrometría',
    '/canales': 'Distribución',
    '/balance': 'Balance Hidráulico',
    '/modelacion-hidraulica': 'Modelación Hidráulica',
    '/analisis-historico': 'Análisis Histórico',
    '/clima': 'Clima',
    '/geo-monitor': 'Geo-Monitor',
    '/bitacora': 'Bitácora Oficial',
    '/ciclos': 'Ciclo Agrícola',
    '/infraestructura': 'Infraestructura',
    '/reporte-oficial': 'Reporte Oficial',
    '/importar': 'Importar Datos',
    '/inteligencia-hidrica': 'Consultoría IA',
};

interface Props {
    abierto: boolean;
    onAlternar: () => void;
}

export default function MobileTopBar({ abierto, onAlternar }: Props) {
    const { pathname } = useLocation();
    const titulo = TITULOS[pathname] ?? 'SICA 005';

    return (
        <header className="mobile-topbar" role="banner">
            <button
                type="button"
                className="mobile-topbar__menu"
                onClick={onAlternar}
                aria-label={abierto ? 'Cerrar menú' : 'Abrir menú'}
                aria-expanded={abierto}
                aria-controls="sidebar-principal"
            >
                {abierto ? <X size={24} /> : <Menu size={24} />}
            </button>
            <img src="/logos/SICA005.png" alt="" className="mobile-topbar__logo" width={30} height={30} />
            <h1 className="mobile-topbar__titulo">{titulo}</h1>
        </header>
    );
}
