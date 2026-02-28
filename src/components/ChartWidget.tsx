import React, { type ReactNode } from 'react';
import './ChartWidget.css';

interface ChartWidgetProps {
    title: string;
    children: ReactNode;
    height?: number;
    badge?: string;
    subtitle?: string;
    infoBar?: ReactNode;
}

const ChartWidget: React.FC<ChartWidgetProps> = ({
    title,
    children,
    height = 300,
    badge,
    subtitle,
    infoBar
}) => {
    return (
        <div className="chart-widget">
            <div className="chart-header">
                <div>
                    <h3 className="chart-title">{title}</h3>
                    {subtitle && (
                        <p style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '3px', letterSpacing: '0.04em' }}>
                            {subtitle}
                        </p>
                    )}
                </div>
                {badge && <span className="chart-badge">{badge}</span>}
            </div>
            <div style={{ height, width: '100%', flex: 1 }}>
                {children}
            </div>
            {infoBar && <div className="chart-info-bar">{infoBar}</div>}
        </div>
    );
};

export default ChartWidget;
