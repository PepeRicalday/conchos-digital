import React, { type ReactNode } from 'react';
import { ResponsiveContainer } from 'recharts';
import './ChartWidget.css';

interface ChartWidgetProps {
    title: string;
    children: ReactNode;
    height?: number;
}

const ChartWidget: React.FC<ChartWidgetProps> = ({ title, children, height = 300 }) => {
    return (
        <div className="chart-widget">
            <div className="chart-header">
                <h3 className="chart-title">{title}</h3>
            </div>
            <div className="chart-body" style={{ height }}>
                <ResponsiveContainer width="100%" height="100%">
                    {React.isValidElement(children) ? children : <>{children}</>}
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default ChartWidget;
