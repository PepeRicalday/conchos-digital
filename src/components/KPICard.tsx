import React from 'react';
import { type LucideIcon, TrendingUp, TrendingDown, Minus, HelpCircle, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import './KPICard.css';

/** Severidad operativa — independiente del color temático de la tarjeta. */
export type KPISeverity = 'normal' | 'warning' | 'critical';

interface KPICardProps {
    title: string;
    /** Valor a mostrar. `null` significa SIN DATO → se renderiza "S/D", nunca 0. */
    value: string | number | null;
    unit?: string;
    subtext?: string;
    icon?: LucideIcon;
    color?: 'blue' | 'cyan' | 'emerald' | 'amber' | 'rose';
    className?: string;
    trend?: 'rising' | 'falling' | 'stable';
    /** Etiqueta de tendencia. Por defecto Ascenso/Descenso/Estable. */
    trendLabel?: string;
    /** Franja de severidad en el borde superior de la tarjeta. */
    severity?: KPISeverity;
    /** Serie para el sparkline. Omitir si no aplica. */
    sparkline?: number[];
    /** Sello de frescura, ej. "Lectura del 18 Jul · hace 1 día". */
    freshness?: string;
    /** Marca el sello de frescura en ámbar (dato viejo). */
    freshnessStale?: boolean;
    /** Motivo del S/D — se muestra en lugar del subtexto cuando value es null. */
    noDataReason?: string;
    /** Marca visualmente el valor como anómalo (ej. "0.0" con módulos activos):
     *  la franja de severidad por sí sola es sutil frente a un valor en cero. */
    valueFlag?: boolean;
}

/** Sparkline SVG sin dependencias, con endpoint enfatizado. */
const Sparkline: React.FC<{ data: number[]; stale?: boolean }> = ({ data, stale }) => {
    if (!data || data.length < 2) return null;

    const w = 72;
    const h = 22;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;

    const pts = data.map((v, i) => {
        const x = (i / (data.length - 1)) * w;
        const y = h - ((v - min) / span) * (h - 5) - 2.5;
        return [x, y] as const;
    });

    const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${w},${h} L0,${h} Z`;
    const [lastX, lastY] = pts[pts.length - 1];

    return (
        <svg className="kpi-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
            <path d={area} className="kpi-spark-area" />
            <path d={line} className="kpi-spark-line" fill="none" />
            <circle cx={lastX} cy={lastY} r="2.5" className={clsx('kpi-spark-dot', stale && 'is-stale')} />
        </svg>
    );
};

const KPICard: React.FC<KPICardProps> = React.memo(({
    title,
    value,
    unit,
    subtext,
    icon: Icon,
    color = 'blue',
    className,
    trend,
    trendLabel,
    severity = 'normal',
    sparkline,
    freshness,
    freshnessStale,
    noDataReason,
    valueFlag,
}) => {
    // "S/D" nunca 0: un dato ausente no puede verse igual que una medición de cero.
    const sinDato = value === null || value === undefined;

    const trendText = trendLabel ?? (
        trend === 'rising' ? 'Ascenso' : trend === 'falling' ? 'Descenso' : 'Estable'
    );

    return (
        <div
            className={clsx(
                'kpi-card',
                `kpi-${color}`,
                severity !== 'normal' && `kpi-sev-${severity}`,
                sinDato && 'kpi-nodata',
                className
            )}
        >
            <div className="kpi-header">
                <h3 className="kpi-title">{title}</h3>
                {Icon && (
                    <div className="kpi-icon">
                        {sinDato ? <HelpCircle size={20} /> : <Icon size={20} />}
                    </div>
                )}
            </div>

            <div className="kpi-body">
                <div className="kpi-value-row">
                    <div className="kpi-value-container">
                        {sinDato ? (
                            <span className="kpi-value kpi-value-sd" title={noDataReason || 'Sin dato disponible'}>
                                S/D
                            </span>
                        ) : (
                            <>
                                {valueFlag && (
                                    <AlertTriangle
                                        size={20}
                                        className="kpi-value-flag"
                                        aria-label="Valor anómalo"
                                    />
                                )}
                                <span className="kpi-value">{value}</span>
                                {unit && <span className="kpi-unit">{unit}</span>}
                            </>
                        )}
                    </div>

                    <div className="kpi-aside">
                        {!sinDato && sparkline && sparkline.length > 1 && (
                            <Sparkline data={sparkline} stale={freshnessStale} />
                        )}
                        {!sinDato && trend && (
                            <div className={clsx('kpi-trend', `trend-${trend}`)}>
                                {trend === 'rising' ? <TrendingUp size={16} />
                                    : trend === 'falling' ? <TrendingDown size={16} />
                                        : <Minus size={16} />}
                                {trendText}
                            </div>
                        )}
                    </div>
                </div>

                {(sinDato ? noDataReason : subtext) && (
                    <p className={clsx('kpi-subtext', sinDato && 'kpi-subtext-sd')}>
                        {sinDato ? noDataReason : subtext}
                    </p>
                )}

                {freshness && (
                    <p className={clsx('kpi-freshness', freshnessStale && 'is-stale')}>
                        {freshness}
                    </p>
                )}
            </div>
        </div>
    );
});

export default KPICard;
