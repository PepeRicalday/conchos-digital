import React from 'react';
import { AlertTriangle, Activity, ArrowRight } from 'lucide-react';
import { type ModuleData } from '../hooks/useHydraEngine';

interface AnomalyMatrixProps {
    modules: ModuleData[];
    onSelectModule?: (modId: string) => void;
}

const AnomalyMatrix: React.FC<AnomalyMatrixProps> = ({ modules, onSelectModule }) => {
    // Detectar Anomalías
    // 1. Sobregiro (Q Actual > Q Diseño) -> Simulado con random para demo si no hay triggers aún
    // 2. Eficiencia Baja (< 80%)

    const anomalies = modules.flatMap(m => {
        const issues = [];
        // Check Efficiency - Logic available for future use
        // const efficiency = m.delivery_points.length > 0
        //     ? (m.delivery_points.reduce((a, b) => a + b.accumulated, 0) / (m.authorized_vol || 1)) * 100 // Placeholder logic
        //     : 0;

        // Simulando detección basada en datos reales
        if (m.current_flow > m.target_flow * 1.1 && m.target_flow > 0) {
            issues.push({
                id: `overflow-${m.id}`,
                type: 'critical',
                title: 'Sobregiro de Gasto',
                desc: `${(m.current_flow * 1000).toFixed(0)} L/s vs ${(m.target_flow * 1000).toFixed(0)} L/s`,
                moduleId: m.id,
                moduleName: m.short_code || m.name
            });
        }

        // Check Delivery Points capacities
        m.delivery_points.forEach(dp => {
            if (dp.current_q > dp.capacity) {
                issues.push({
                    id: `cap-${dp.id}`,
                    type: 'critical',
                    title: 'Capacidad Excedida',
                    desc: `${dp.name}: ${(dp.current_q * 1000).toFixed(0)} L/s > ${(dp.capacity * 1000).toFixed(0)} L/s`,
                    moduleId: m.id,
                    moduleName: m.short_code || m.name
                });
            }
        });

        return issues;
    });

    if (anomalies.length === 0) {
        return (
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 h-full flex flex-col items-center justify-center text-slate-500">
                <Activity size={32} className="mb-2 opacity-50" />
                <span className="text-sm font-medium">Sistema Estable</span>
                <span className="text-xs">Sin anomalías detectadas</span>
            </div>
        );
    }

    return (
        <div className="bg-slate-900 rounded-xl border border-red-900/30 overflow-hidden flex flex-col h-full shadow-lg shadow-red-900/10">
            <header className="bg-red-900/20 px-4 py-3 border-b border-red-900/30 flex justify-between items-center">
                <h3 className="text-red-200 font-bold text-sm flex items-center gap-2">
                    <AlertTriangle size={16} />
                    Matriz de Anomalías
                </h3>
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
                    {anomalies.length}
                </span>
            </header>

            <div className="overflow-y-auto p-2 space-y-2 flex-1 scrollbar-thin scrollbar-thumb-slate-700">
                {anomalies.map((issue) => (
                    <div
                        key={issue.id}
                        className="bg-slate-800 p-3 rounded-lg border-l-4 border-red-500 hover:bg-slate-700 transition-colors cursor-pointer group"
                        onClick={() => onSelectModule && onSelectModule(issue.moduleId)}
                    >
                        <div className="flex justify-between items-start mb-1">
                            <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">{issue.moduleName}</span>
                            <ArrowRight size={12} className="text-slate-500 group-hover:text-white transition-colors" />
                        </div>
                        <h4 className="text-white font-semibold text-sm leading-tight mb-1">{issue.title}</h4>
                        <p className="text-red-300 text-xs font-mono">{issue.desc}</p>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default AnomalyMatrix;
