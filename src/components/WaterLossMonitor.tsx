import React from 'react';
import { ShieldAlert, Droplets, ArrowRight, Activity, Zap } from 'lucide-react';
import { useLeakMonitor } from '../hooks/useLeakMonitor';
import './WaterLossMonitor.css';

const WaterLossMonitor: React.FC = () => {
    const { segments, loading } = useLeakMonitor();

    if (loading && segments.length === 0) {
        return <div className="p-8 text-center text-slate-500 animate-pulse font-mono text-xs">Sincronizando Balances Hídricos...</div>;
    }

    return (
        <div className="water-loss-monitor">
            {/* Background branding glow */}
            <div className="wlm-bg-glow" />

            <header className="wlm-header">
                <div className="wlm-header-content">
                    <div className="wlm-header-left">
                        <div className="wlm-icon-wrapper">
                            <div className="wlm-icon-glow" />
                            <div className="wlm-icon-box">
                                <ShieldAlert size={22} className="wlm-icon-color" />
                            </div>
                        </div>
                        <div className="wlm-title-group">
                            <h3>Monitor de Vulnerabilidad</h3>
                            <div className="wlm-subtitle">
                                <div className="wlm-dot" />
                                <p>Detección de Fugas • Hydra Engine</p>
                            </div>
                        </div>
                    </div>
                    {/* Pulsing activity indicator */}
                    <div className="wlm-status-badge">
                        <Activity size={12} className="wlm-status-icon" />
                        <span>Live Analysis</span>
                    </div>
                </div>
            </header>

            <div className="wlm-content scrollbar-hide">
                {segments.map((s, idx) => {
                    const estatus = s.estatus || '';
                    const isCritical = estatus.includes('CRÍTICA');
                    const isWarning = estatus.includes('PREVENTIVA');
                    const safetyQ = isNaN(s.q_perdida) ? 0 : s.q_perdida;
                    const safetyPct = isNaN(s.eficiencia_pct) ? 100 : s.eficiencia_pct;

                    let statusClass = 'is-normal';
                    let tagClass = 'normal';
                    if (isCritical) { statusClass = 'is-critical'; tagClass = 'critical'; }
                    else if (isWarning) { statusClass = 'is-warning'; tagClass = 'warning'; }

                    return (
                        <div
                            key={idx}
                            className={`wlm-card ${statusClass}`}
                        >
                            <div className="wlm-segment-header">
                                <div className="wlm-km-group">
                                    <span className="wlm-label">Segmento</span>
                                    <div className="wlm-km-values">
                                        <span className="wlm-km-pill">
                                            KM {s.km_inicio}
                                        </span>
                                        <div className="wlm-km-divider" />
                                        <span className="wlm-km-pill">
                                            KM {s.km_fin}
                                        </span>
                                    </div>
                                </div>
                                <div className={`wlm-status-tag ${tagClass}`}>
                                    <div className="tag-dot" style={{ backgroundColor: isCritical ? '#f87171' : isWarning ? '#fbbf24' : '#34d399' }} />
                                    {s.estatus}
                                </div>
                            </div>

                            <div className="wlm-stats-grid">
                                <div className="wlm-stat-item">
                                    <p className="wlm-stat-label">
                                        <Zap size={10} style={{ color: '#60a5fa' }} /> Eficiencia
                                    </p>
                                    <div className="wlm-stat-value" style={{ color: isCritical ? '#f87171' : isWarning ? '#fbbf24' : '#34d399' }}>
                                        {safetyPct}<span className="wlm-stat-unit">%</span>
                                    </div>
                                    <div className="wlm-progress-bg">
                                        <div
                                            className="wlm-progress-bar"
                                            style={{
                                                width: `${safetyPct}%`,
                                                background: isCritical ? 'linear-gradient(90deg, #dc2626, #f87171)' :
                                                    isWarning ? 'linear-gradient(90deg, #d97706, #fbbf24)' :
                                                        'linear-gradient(90deg, #059669, #34d399)'
                                            }}
                                        >
                                            <div className="wlm-progress-shimmer" />
                                        </div>
                                    </div>
                                </div>

                                <div className="wlm-stat-item">
                                    <p className="wlm-stat-label">
                                        <Droplets size={10} style={{ color: '#60a5fa' }} /> Pérdida
                                    </p>
                                    <div className="wlm-loss-value-group">
                                        <span className="wlm-stat-value" style={{ color: '#f8fafc' }}>
                                            {(safetyQ * 1000).toFixed(0)}
                                        </span>
                                        <span className="wlm-stat-unit">L/S</span>
                                    </div>
                                    <p className="wlm-stat-desc">
                                        {s.tramo_inicio} <span className="wlm-tramo-arrow">→</span> {s.tramo_fin}
                                    </p>
                                </div>
                            </div>

                            {/* Decorative ambient light */}
                            <div
                                className="wlm-ambient-light"
                                style={{ backgroundColor: isCritical ? '#ef4444' : isWarning ? '#f59e0b' : '#10b981' }}
                            />
                        </div>
                    );
                })}
            </div>

            <footer className="wlm-footer">
                <div className="wlm-footer-left">
                    <div className="wlm-footer-dot" />
                    <span className="wlm-version">Sistema Hydra Engine v2.0</span>
                </div>
                <button className="wlm-report-btn">
                    <span>Ver Reporte Completo</span>
                    <ArrowRight size={12} className="wlm-report-icon" />
                </button>
            </footer>
        </div>
    );
};

export default WaterLossMonitor;
