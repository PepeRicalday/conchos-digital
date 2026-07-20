import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Zap } from 'lucide-react';
import { getEfficiencyStatus } from '../utils/hydraulics';
import './EfficiencyGauge.css';

interface EfficiencyGaugeProps {
    value: number; // 0-100
    label?: string;
}

// Cortes idénticos a getEfficiencyStatus() en utils/hydraulics.ts — antes este
// gauge tenía su propia escala de 3 niveles (90/80) distinta de la tabla de
// balance (que usa 4 niveles: 95/90/80), así que podía mostrar "Sistema Óptimo"
// mientras la tabla ya marcaba tramos en rojo.
const EfficiencyGauge: React.FC<EfficiencyGaugeProps> = ({ value, label = "Eficiencia Global" }) => {
    const score = Math.min(Math.max(value, 0), 100);
    const status = getEfficiencyStatus(score);

    const data = [
        { name: 'Eficiencia', value: score },
        { name: 'Pérdida', value: 100 - score }
    ];

    return (
        <div className="efficiency-gauge">
            <h3 className="gauge-title">
                <Zap size={14} className={status.nivel === 'critico' || status.nivel === 'alerta' ? 'gauge-title-icon alert' : 'gauge-title-icon'} />
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
                            <Cell fill={status.color} />
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
                <span
                    className={`gauge-status-badge status-${status.nivel}`}
                    style={{ color: status.color, background: status.bg, borderColor: status.color }}
                >
                    {status.nivel === 'critico' ? '¡ALERTA DE FUGAS!'
                        : status.nivel === 'alerta' ? 'Atención Requerida'
                        : status.nivel === 'atencion' ? 'Vigilar Tendencia'
                        : 'Sistema Óptimo'}
                </span>
            </div>
        </div>
    );
};

export default EfficiencyGauge;
