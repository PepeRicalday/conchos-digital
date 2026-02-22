import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Zap } from 'lucide-react';
import './EfficiencyGauge.css';

interface EfficiencyGaugeProps {
    value: number; // 0-100
    label?: string;
}

const EfficiencyGauge: React.FC<EfficiencyGaugeProps> = ({ value, label = "Eficiencia Global" }) => {
    const score = Math.min(Math.max(value, 0), 100);

    const data = [
        { name: 'Eficiencia', value: score },
        { name: 'Pérdida', value: 100 - score }
    ];

    const getColor = (val: number) => {
        if (val >= 90) return '#10b981';
        if (val >= 80) return '#f59e0b';
        return '#ef4444';
    };

    const color = getColor(score);

    return (
        <div className="efficiency-gauge">
            <h3 className="gauge-title">
                <Zap size={14} className={score < 80 ? 'gauge-title-icon alert' : 'gauge-title-icon'} />
                {label}
            </h3>

            <div className="gauge-chart-container">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="100%"
                            startAngle={180}
                            endAngle={0}
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={2}
                            dataKey="value"
                            stroke="none"
                        >
                            <Cell fill={color} />
                            <Cell fill="#334155" />
                        </Pie>
                    </PieChart>
                </ResponsiveContainer>

                <div className="gauge-center-value">
                    <span className="gauge-value-text">{score.toFixed(1)}%</span>
                    <span className="gauge-value-label">Hidro-Sincronía</span>
                </div>
            </div>

            <div className="gauge-status">
                {score < 80 && (
                    <span className="gauge-status-badge status-critical">
                        ¡ALERTA DE FUGAS!
                    </span>
                )}
                {score >= 80 && score < 90 && (
                    <span className="gauge-status-badge status-warning">
                        Atención Requerida
                    </span>
                )}
                {score >= 90 && (
                    <span className="gauge-status-badge status-optimal">
                        Sistema Óptimo
                    </span>
                )}
            </div>
        </div>
    );
};

export default EfficiencyGauge;
