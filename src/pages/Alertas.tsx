import { useMemo } from 'react';
import { AlertTriangle, CheckCircle, Info, TrendingUp, Droplets, Activity, Clock } from 'lucide-react';
import { useHydraEngine } from '../hooks/useHydraEngine';
import { usePresas } from '../hooks/usePresas';
import { useFecha } from '../context/FechaContext';

interface Alert {
    id: string;
    type: 'critical' | 'warning' | 'info';
    title: string;
    message: string;
    timestamp: string;
    icon?: typeof AlertTriangle;
}

const Alertas = () => {
    const { fechaSeleccionada } = useFecha();
    const { modules, loading: loadingModules } = useHydraEngine();
    const { presas, loading: loadingPresas } = usePresas(fechaSeleccionada);

    const loading = loadingModules || loadingPresas;

    const alerts: Alert[] = useMemo(() => {
        const result: Alert[] = [];

        // Módulos con sobregiro
        modules.forEach(m => {
            if (m.current_flow > m.target_flow * 1.1 && m.target_flow > 0) {
                result.push({
                    id: `ovf-${m.id}`,
                    type: 'critical',
                    title: 'Sobregiro Detectado',
                    message: `${m.name}: Gasto ${(m.current_flow * 1000).toFixed(0)} L/s excede el autorizado (${(m.target_flow * 1000).toFixed(0)} L/s).`,
                    timestamp: 'Tiempo Real',
                    icon: Activity,
                });
            }
        });

        // Puntos con alto caudal (>90% capacidad)
        modules.forEach(m => {
            m.delivery_points.forEach(pt => {
                if (pt.current_q > pt.capacity * 0.9 && pt.capacity > 0) {
                    result.push({
                        id: `cap-${pt.id}`,
                        type: 'warning',
                        title: 'Cerca de Capacidad Máxima',
                        message: `${pt.name} (${m.short_code}): ${(pt.current_q * 1000).toFixed(0)} L/s de ${(pt.capacity * 1000).toFixed(0)} L/s máximo.`,
                        timestamp: pt.last_update_time ? new Date(pt.last_update_time).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : 'N/A',
                        icon: TrendingUp,
                    });
                }
            });
        });

        // Presas con alto llenado
        presas.forEach(p => {
            if (p.lectura && p.lectura.porcentaje_llenado > 90) {
                result.push({
                    id: `dam-high-${p.id}`,
                    type: 'warning',
                    title: 'Alto Nivel de Presa',
                    message: `${p.nombre}: ${p.lectura.porcentaje_llenado.toFixed(1)}% de llenado (${p.lectura.almacenamiento_mm3.toFixed(1)} Mm³).`,
                    timestamp: p.lectura.fecha,
                    icon: Droplets,
                });
            }
        });

        // Si todo está bien
        if (result.length === 0) {
            result.push({
                id: 'ok',
                type: 'info',
                title: 'Sistema Estable',
                message: 'Todos los indicadores operan dentro de los parámetros normales. Sin alertas activas.',
                timestamp: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
                icon: CheckCircle,
            });
        }

        return result.sort((a, b) => {
            const priority = { critical: 0, warning: 1, info: 2 };
            return priority[a.type] - priority[b.type];
        });
    }, [modules, presas]);

    const typeStyles = {
        critical: { bg: 'bg-red-500/10', border: 'border-red-500/30', icon: 'text-red-400', badge: 'bg-red-500/20 text-red-300' },
        warning: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', icon: 'text-amber-400', badge: 'bg-amber-500/20 text-amber-300' },
        info: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', icon: 'text-blue-400', badge: 'bg-blue-500/20 text-blue-300' },
    };

    const criticals = alerts.filter(a => a.type === 'critical').length;
    const warnings = alerts.filter(a => a.type === 'warning').length;

    return (
        <div className="page-transition" style={{ padding: 'var(--spacing-lg)' }}>
            <header className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                        <div className="bg-amber-500/10 p-2 rounded-xl">
                            <AlertTriangle className="text-amber-400" size={24} />
                        </div>
                        Centro de Alertas
                    </h2>
                    <p className="text-slate-400 text-sm font-medium mt-1">
                        Monitoreo de anomalías y condiciones críticas en tiempo real
                    </p>
                </div>

                <div className="flex gap-3">
                    {criticals > 0 && (
                        <span className="px-3 py-1.5 rounded-full bg-red-500/20 text-red-300 text-xs font-bold border border-red-500/30">
                            {criticals} Crítica{criticals > 1 ? 's' : ''}
                        </span>
                    )}
                    {warnings > 0 && (
                        <span className="px-3 py-1.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/30">
                            {warnings} Advertencia{warnings > 1 ? 's' : ''}
                        </span>
                    )}
                    {criticals === 0 && warnings === 0 && (
                        <span className="px-3 py-1.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-500/30">
                            Todo Normal
                        </span>
                    )}
                </div>
            </header>

            {loading ? (
                <div className="card flex items-center justify-center py-20">
                    <div className="flex flex-col items-center gap-3 text-slate-400">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
                        <span className="text-sm font-medium">Evaluando condiciones del sistema...</span>
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    {alerts.map(alert => {
                        const styles = typeStyles[alert.type];
                        const Icon = alert.icon || Info;
                        return (
                            <div key={alert.id} className={`card ${styles.bg} ${styles.border} border flex items-start gap-4 p-4`}>
                                <div className={`p-2 rounded-xl ${styles.bg}`}>
                                    <Icon size={20} className={styles.icon} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${styles.badge}`}>
                                            {alert.type === 'critical' ? 'Crítico' : alert.type === 'warning' ? 'Advertencia' : 'Info'}
                                        </span>
                                        <h4 className="text-white font-bold text-sm">{alert.title}</h4>
                                    </div>
                                    <p className="text-slate-300 text-sm leading-relaxed">{alert.message}</p>
                                </div>
                                <div className="flex items-center gap-1.5 text-slate-500 text-xs whitespace-nowrap">
                                    <Clock size={12} />
                                    <span>{alert.timestamp}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default Alertas;
