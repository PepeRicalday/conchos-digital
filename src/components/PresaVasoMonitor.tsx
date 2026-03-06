import React, { useMemo } from 'react';
import { Droplets, Gauge, Activity, AlertTriangle, TrendingUp } from 'lucide-react';
import './PresaVasoMonitor.css';

interface PresaVasoMonitorProps {
    data: {
        nombre: string;
        nivel_msnm: number;
        almacenamiento_mm3: number;
        porcentaje: number;
        extraccion_m3s: number;
        nivel_nma: number; // Nivel Maximo Aguas
        capacidad_total: number;
    };
    onClose: () => void;
}

export const PresaVasoMonitor: React.FC<PresaVasoMonitorProps> = ({ data, onClose }) => {
    // Calculamos la posición visual del nivel basado en el porcentaje
    // Simulamos un "relleno" o "anillo"
    const nivelVisual = useMemo(() => {
        const pct = Math.min(Math.max(data.porcentaje, 0), 100);
        return pct;
    }, [data.porcentaje]);

    return (
        <div className="vaso-screen-overlay">
            <div className="vaso-container animate-in-zoom">
                {/* Background Stylized Image */}
                <div className="vaso-map-bg">
                    <img
                        src="/boquilla_reservoir_stylized.png"
                        alt="Vaso de la Presa"
                        className="vaso-base-img"
                    />
                    <div className="vaso-water-overlay" style={{ opacity: nivelVisual / 100 }}></div>
                    <div className="vaso-scanline"></div>
                </div>

                {/* UI OVERLAYS */}
                <header className="vaso-header">
                    <div className="vaso-title-group">
                        <div className="vaso-badge">SITUACIÓN DEL VASO</div>
                        <h2>PRESA {data.nombre.toUpperCase()}</h2>
                        <div className="vaso-coords">27.5501° N, 105.4116° W</div>
                    </div>
                    <button className="vaso-close" onClick={onClose}>×</button>
                </header>

                {/* KPI SQUARES */}
                <div className="vaso-stats-grid">
                    <div className="vaso-stat-card glass">
                        <div className="vaso-stat-label">
                            <Gauge size={14} /> NIVEL ACTUAL
                        </div>
                        <div className="vaso-stat-value">
                            {data.nivel_msnm.toFixed(2)} <small>msnm</small>
                        </div>
                        <div className="vaso-stat-footer">
                            NMA: {data.nivel_nma.toFixed(2)} m
                        </div>
                    </div>

                    <div className="vaso-stat-card glass">
                        <div className="vaso-stat-label">
                            <Droplets size={14} /> ALMACENAMIENTO
                        </div>
                        <div className="vaso-stat-value">
                            {data.almacenamiento_mm3.toLocaleString()} <small>Mm³</small>
                        </div>
                        <div className="vaso-stat-progress">
                            <div className="vaso-progress-bar">
                                <div className="vaso-progress-fill" style={{ width: `${nivelVisual}%` }}></div>
                            </div>
                            <span>{nivelVisual.toFixed(1)}%</span>
                        </div>
                    </div>

                    <div className="vaso-stat-card glass">
                        <div className="vaso-stat-label">
                            <Activity size={14} /> EXTRACCIÓN OBRA TOMA
                        </div>
                        <div className="vaso-stat-value">
                            {data.extraccion_m3s.toFixed(2)} <small>m³/s</small>
                        </div>
                        <div className="vaso-stat-footer status-active">
                            <span className="pulse-dot"></span> EN OPERACIÓN
                        </div>
                    </div>
                </div>

                {/* BOTTOM PANEL: ANALYTICS */}
                <div className="vaso-analytics glass">
                    <div className="vaso-analytics-header">
                        <TrendingUp size={16} /> ANÁLISIS DE IMPACTO DE PRECIPITACIÓN
                    </div>
                    <div className="vaso-analytics-body">
                        <div className="vaso-alert-box">
                            <AlertTriangle size={20} className="text-amber-500" />
                            <div className="vaso-alert-text">
                                <strong>Evaporación Detectada:</strong> Se estima una pérdida superficial de 0.12 Mm³ en las últimas 24h debido a radiación solar.
                            </div>
                        </div>
                        <div className="vaso-prediction">
                            Próximas 72h: Escurrimientos estimados de <strong>+2.4 Mm³</strong> por cuenca propia.
                        </div>
                    </div>
                </div>

                {/* FLOATING TAGS ON MAP */}
                <div className="vaso-map-tag tag-torre" style={{ top: '45%', left: '75%' }}>
                    <div className="tag-line"></div>
                    <div className="tag-content">Torre de Control</div>
                </div>
                <div className="vaso-map-tag tag-obratoma" style={{ top: '60%', left: '85%' }}>
                    <div className="tag-line"></div>
                    <div className="tag-content">Obra de Toma</div>
                </div>
                <div className="vaso-map-tag tag-vertedor" style={{ top: '35%', left: '60%' }}>
                    <div className="tag-line"></div>
                    <div className="tag-content">Vertedor de Demasías</div>
                </div>
            </div>
        </div>
    );
};
