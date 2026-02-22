import React from 'react';
import { AlertTriangle, Info, XCircle } from 'lucide-react';
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

const AlertList: React.FC<AlertListProps> = ({ alerts }) => {
    return (
        <div className="alert-list-container">
            <div className="alert-list-header">
                <h3>Alertas Recientes</h3>
                {alerts.length > 0 && <span className="alert-badge">{alerts.length}</span>}
            </div>
            <div className="alert-list-body">
                {alerts.map((alert) => (
                    <div key={alert.id} className={clsx('alert-item', `alert-${alert.type}`)}>
                        <div className="alert-icon">
                            {alert.type === 'warning' && <AlertTriangle size={18} />}
                            {alert.type === 'critical' && <XCircle size={18} />}
                            {alert.type === 'info' && <Info size={18} />}
                        </div>
                        <div className="alert-content">
                            <h4 className="alert-title">{alert.title}</h4>
                            <p className="alert-message">{alert.message}</p>
                            <span className="alert-time">{alert.timestamp}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default AlertList;
