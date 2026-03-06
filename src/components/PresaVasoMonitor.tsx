import React, { useMemo, useState } from 'react';
import { Droplets, Gauge, Activity, AlertTriangle, TrendingUp, ChevronLeft, ChevronRight, Info } from 'lucide-react';
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
        presa_id: string;
    };
    onClose: () => void;
}

export const PresaVasoMonitor: React.FC<PresaVasoMonitorProps> = ({ data, onClose }) => {
    // Estado para simulación interactiva
    const [simNivel, setSimNivel] = useState(data.nivel_msnm);

    // Cálculos dinámicos basados en el nivel (Simulación de Curva de Elevación-Capacidad simplificada)
    const stats = useMemo(() => {
        const diff = simNivel - data.nivel_msnm;
        // Factor de cambio Mm3 por metro (Boquilla es aprox 200-300 Mm3 por metro en niveles altos)
        const factorMm3m = data.presa_id === 'BOQUILLA' ? 245 : 85;
        const nuevoAlmacenamiento = Math.max(0, data.almacenamiento_mm3 + (diff * factorMm3m));
        const nuevoPorcentaje = Math.min(100, (nuevoAlmacenamiento / data.capacidad_total) * 100);

        // Área expuesta (simulación visual)
        const areaExpuestaFactor = Math.max(0, data.nivel_nma - simNivel) * 12; // Exageración visual para el CSS

        return {
            almacenamiento: nuevoAlmacenamiento,
            porcentaje: nuevoPorcentaje,
            areaExpuesta: areaExpuestaFactor,
            isSimulated: Math.abs(diff) > 0.01
        };
    }, [simNivel, data]);

    return (
        <div className="vaso-screen-overlay">
            <div className="vaso-container animate-in-zoom">
                {/* Background Satellite Image with Dynamic Mask */}
                <div className="vaso-map-bg">
                    <img
                        src="/boquilla_5marzo.png"
                        alt="Vaso de la Presa - Imagen Satelital 5 de Marzo"
                        className="vaso-base-img"
                        style={{ filter: `brightness(${0.4 + (stats.porcentaje / 200)}) contrast(1.1)` }}
                    />

                    {/* SVG MASK INTERACTIVA: Simula el espejo de agua moviéndose */}
                    <svg className="vaso-water-mask" viewBox="0 0 1000 600" preserveAspectRatio="none">
                        <defs>
                            <filter id="glow">
                                <feGaussianBlur stdDeviation="5" result="coloredBlur" />
                                <feMerge>
                                    <feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                        </defs>
                        <path
                            d="M150,300 Q300,150 500,200 T850,300 Q700,450 500,400 T150,300"
                            fill="rgba(34, 211, 238, 0.2)"
                            stroke="#22d3ee"
                            strokeWidth="2"
                            style={{
                                transform: `scale(${0.5 + (stats.porcentaje / 180)})`,
                                transformOrigin: 'center',
                                transition: 'all 0.5s ease-out',
                                filter: 'url(#glow)'
                            }}
                        />
                    </svg>

                    <div className="vaso-scanline"></div>
                </div>

                {/* UI OVERLAYS */}
                <header className="vaso-header">
                    <div className="vaso-title-group">
                        <div className="vaso-badge">SITUACIÓN E INTERACTIVIDAD DE VASO</div>
                        <h2>PRESA {data.nombre.toUpperCase()}</h2>
                        <div className="vaso-coords">LECTURA OFICIAL: {data.nivel_msnm.toFixed(2)} msnm</div>
                    </div>
                    <button className="vaso-close" onClick={onClose}>×</button>
                </header>

                {/* CONTROLES DE SIMULACIÓN INTERACTIVA */}
                <div className="vaso-sim-controls glass">
                    <div className="sim-header">
                        <Activity size={16} /> SIMULADOR DE IMPACTO HIDRÁULICO
                    </div>
                    <div className="sim-body">
                        <div className="sim-slider-group">
                            <label>Ajustar Nivel Manualmente (msnm)</label>
                            <div className="sim-input-row">
                                <button onClick={() => setSimNivel(s => s - 0.5)}><ChevronLeft /></button>
                                <input
                                    type="range"
                                    min={data.nivel_msnm - 10}
                                    max={data.nivel_nma + 2}
                                    step="0.1"
                                    value={simNivel}
                                    onChange={(e) => setSimNivel(parseFloat(e.target.value))}
                                />
                                <button onClick={() => setSimNivel(s => s + 0.5)}><ChevronRight /></button>
                            </div>
                            <div className="sim-value-display">
                                <strong>{simNivel.toFixed(2)}</strong> <small>msnm</small>
                            </div>
                        </div>
                        {stats.isSimulated && (
                            <button className="sim-reset-btn" onClick={() => setSimNivel(data.nivel_msnm)}>
                                Restablecer a Lectura Real
                            </button>
                        )}
                    </div>
                </div>

                {/* KPI SQUARES (DINÁMICOS) */}
                <div className="vaso-stats-grid">
                    <div className={clsx('vaso-stat-card glass', stats.isSimulated && 'simulated-highlight')}>
                        <div className="vaso-stat-label">
                            <Gauge size={14} /> VOLUMEN INTERACTIVO
                        </div>
                        <div className="vaso-stat-value">
                            {stats.almacenamiento.toLocaleString(undefined, { maximumFractionDigits: 1 })} <small>Mm³</small>
                        </div>
                        <div className="vaso-stat-footer">
                            CAP. TOTAL: {data.capacidad_total} Mm³
                        </div>
                    </div>

                    <div className="vaso-stat-card glass">
                        <div className="vaso-stat-label">
                            <Droplets size={14} /> PORCENTAJE LLENADO
                        </div>
                        <div className="vaso-stat-value">
                            {stats.porcentaje.toFixed(1)} <small>%</small>
                        </div>
                        <div className="vaso-stat-progress">
                            <div className="vaso-progress-bar">
                                <div className="vaso-progress-fill" style={{ width: `${stats.porcentaje}%` }}></div>
                            </div>
                        </div>
                    </div>

                    <div className="vaso-stat-card glass">
                        <div className="vaso-stat-label">
                            <Info size={14} /> ESTADO DEL EMBALSE
                        </div>
                        <div className="vaso-stat-value" style={{ fontSize: '1.5rem', marginTop: '10px' }}>
                            {stats.porcentaje < 20 ? 'CRÍTICO' : stats.porcentaje < 40 ? 'BAJO' : 'NORMAL'}
                        </div>
                        <div className="vaso-stat-footer status-active">
                            <span className="pulse-dot"></span> MONITOREO ACTIVO
                        </div>
                    </div>
                </div>

                {/* ANALYTICS: PERFIL DE IMPACTO */}
                <div className="vaso-analytics glass">
                    <div className="vaso-analytics-header">
                        <TrendingUp size={16} /> ANÁLISIS TÉCNICO DE SUPERFICIE
                    </div>
                    <div className="vaso-analytics-body">
                        <div className="vaso-alert-box">
                            <AlertTriangle size={20} className={stats.porcentaje < 30 ? 'text-red-500' : 'text-amber-500'} />
                            <div className="vaso-alert-text">
                                {stats.isSimulated ? (
                                    <span>Simulando impacto de <strong>{(simNivel - data.nivel_msnm).toFixed(2)}m</strong> sobre la lectura base de hoy.</span>
                                ) : (
                                    <span>Situación operativa estable basada en el aforo de entrada de la SRL.</span>
                                )}
                            </div>
                        </div>
                        <div className="vaso-prediction">
                            Diferencia vs NMA: <strong>{(data.nivel_nma - simNivel).toFixed(2)}m</strong> de "anillo de sequía" expuesto.
                        </div>
                    </div>
                </div>

                {/* MAP INTERACTORS */}
                <div className="vaso-map-tag tag-cortina" style={{ top: '50%', left: '88%' }}>
                    <div className="tag-line"></div>
                    <div className="tag-content">CORTINA</div>
                </div>
            </div>
        </div>
    );
};

const clsx = (...classes: any[]) => classes.filter(Boolean).join(' ');
