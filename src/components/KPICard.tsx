import React from 'react';
import { type LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import clsx from 'clsx';
import './KPICard.css';

interface KPICardProps {
    title: string;
    value: string | number;
    unit?: string;
    subtext?: string;
    icon?: LucideIcon;
    color?: 'blue' | 'cyan' | 'emerald' | 'amber' | 'rose';
    className?: string;
    trend?: 'rising' | 'falling' | 'stable';
}

const KPICard: React.FC<KPICardProps> = React.memo(({
    title,
    value,
    unit,
    subtext,
    icon: Icon,
    color = 'blue',
    className,
    trend
}) => {
    return (
        <div className={clsx('kpi-card', `kpi-${color}`, className)}>
            <div className="kpi-header">
                <h3 className="kpi-title">{title}</h3>
                {Icon && <div className="kpi-icon"><Icon size={20} /></div>}
            </div>

            <div className="kpi-body">
                <div className="kpi-value-row">
                    <div className="kpi-value-container">
                        <span className="kpi-value">{value}</span>
                        {unit && <span className="kpi-unit">{unit}</span>}
                    </div>
                    {trend && (
                        <div className={clsx("kpi-trend", `trend-${trend}`)}>
                            {trend === 'rising' ? <TrendingUp size={16} /> : trend === 'falling' ? <TrendingDown size={16} /> : <Minus size={16} />}
                            {trend === 'rising' ? 'Ascenso' : trend === 'falling' ? 'Descenso' : 'Estable'}
                        </div>
                    )}
                </div>

                {subtext && <p className="kpi-subtext">{subtext}</p>}
            </div>
        </div>
    );
});

export default KPICard;
