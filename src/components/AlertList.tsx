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
    /** Persistida sin resolver con más de 14 días: se lista aparte como pendiente antiguo. */
    antigua?: boolean;
    /** Acción sugerida (p. ej. alertas agroclimáticas). */
    accion?: string | null;
}

interface AlertListProps {
    alerts: Alert[];
}

type GrupoTipo = Alert['type'] | 'antigua';

const GRUPOS: { type: GrupoTipo; label: (n: number) => string; icon: React.ReactNode; defaultOpen: boolean }[] = [
    { type: 'critical', label: n => `${n} crítica${n === 1 ? '' : 's'}`, icon: <XCircle size={14} />, defaultOpen: true },
    { type: 'warning', label: n => `${n} advertencia${n === 1 ? '' : 's'}`, icon: <AlertTriangle size={14} />, defaultOpen: true },
    { type: 'info', label: n => `${n} informativa${n === 1 ? '' : 's'}`, icon: <Info size={14} />, defaultOpen: false },
    { type: 'antigua', label: n => `${n} pendiente${n === 1 ? '' : 's'} antigua${n === 1 ? '' : 's'} (+14 d sin resolver)`, icon: <Info size={14} />, defaultOpen: false },
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
            {alert.accion && <p className="alert-message"><b>Acción:</b> {alert.accion}</p>}
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

    // Las antiguas salen de sus grupos de severidad y forman uno propio, cerrado por defecto.
    const grupos = GRUPOS
        .map(g => ({
            ...g,
            items: g.type === 'antigua'
                ? alerts.filter(a => a.antigua && a.type !== 'info')
                : alerts.filter(a => a.type === g.type && !(a.antigua && a.type !== 'info')),
        }))
        .filter(g => g.items.length > 0);
    // Cifra de la cabecera = críticas + avisos vigentes (misma que el KPI y el menú lateral).
    const accionables = alerts.filter(a => a.type !== 'info' && !a.antigua).length;

    const esColapsado = (type: string, defaultOpen: boolean) =>
        colapsado[type] ?? !defaultOpen;

    return (
        <div className="alert-list-container">
            <div className="alert-list-header">
                <h3>Alertas Recientes</h3>
                {alerts.length > 0 && <span className="alert-badge" title="Críticas y avisos vigentes">{accionables}</span>}
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
