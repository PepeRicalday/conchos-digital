import React, { useState } from 'react';
import { AlertTriangle, Info, XCircle, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import './AlertList.css';

export interface Alert {
    id: string;
    type: 'warning' | 'critical' | 'info';
    title: string;
    message: string;
    timestamp: string;
}

interface AlertListProps {
    alerts: Alert[];
}

const GRUPOS: { type: Alert['type']; label: (n: number) => string; icon: React.ReactNode; defaultOpen: boolean }[] = [
    { type: 'critical', label: n => `${n} crítica${n === 1 ? '' : 's'}`, icon: <XCircle size={14} />, defaultOpen: true },
    { type: 'warning', label: n => `${n} advertencia${n === 1 ? '' : 's'}`, icon: <AlertTriangle size={14} />, defaultOpen: true },
    { type: 'info', label: n => `${n} informativa${n === 1 ? '' : 's'}`, icon: <Info size={14} />, defaultOpen: false },
];

const AlertItem = ({ alert }: { alert: Alert }) => (
    <div className={clsx('alert-item', `alert-${alert.type}`)}>
        <div className="alert-icon">
            {alert.type === 'warning' && <AlertTriangle size={22} />}
            {alert.type === 'critical' && <XCircle size={22} />}
            {alert.type === 'info' && <Info size={22} />}
        </div>
        <div className="alert-content">
            <h4 className="alert-title">{alert.title}</h4>
            <p className="alert-message">{alert.message}</p>
            <span className="alert-time">{alert.timestamp}</span>
        </div>
    </div>
);

/**
 * Agrupa por severidad para que 7+ alertas sueltas no exijan leer línea por
 * línea: críticas y advertencias abren expandidas, informativas colapsadas.
 * El orden de severidad ya lo decide realAlerts (Dashboard.tsx) — aquí sólo
 * se agrupa, no se reordena entre alertas del mismo tipo.
 */
const AlertList: React.FC<AlertListProps> = ({ alerts }) => {
    const [colapsado, setColapsado] = useState<Record<string, boolean>>({});

    const grupos = GRUPOS
        .map(g => ({ ...g, items: alerts.filter(a => a.type === g.type) }))
        .filter(g => g.items.length > 0);

    const esColapsado = (type: string, defaultOpen: boolean) =>
        colapsado[type] ?? !defaultOpen;

    return (
        <div className="alert-list-container">
            <div className="alert-list-header">
                <h3>Alertas Recientes</h3>
                {alerts.length > 0 && <span className="alert-badge">{alerts.length}</span>}
            </div>
            <div className="alert-list-body">
                {grupos.length === 0 && (
                    <p className="alert-empty">Sin alertas activas.</p>
                )}
                {grupos.map(g => {
                    const oculto = esColapsado(g.type, g.defaultOpen);
                    return (
                        <div key={g.type} className={clsx('alert-group', `alert-group-${g.type}`)}>
                            <button
                                type="button"
                                className="alert-group-head"
                                onClick={() => setColapsado(prev => ({ ...prev, [g.type]: !oculto }))}
                                aria-expanded={!oculto}
                            >
                                <span className="alert-group-head-label">
                                    {g.icon} {g.label(g.items.length)}
                                </span>
                                <ChevronDown size={14} className={clsx('alert-group-chevron', !oculto && 'is-open')} />
                            </button>
                            {!oculto && (
                                <div className="alert-group-body">
                                    {g.items.map(alert => <AlertItem key={alert.id} alert={alert} />)}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default AlertList;
