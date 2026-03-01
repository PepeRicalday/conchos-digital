import React from 'react';
import { AlertTriangle, Activity, ArrowRight, Zap, Target, Gauge } from 'lucide-react';
import { type ModuleData } from '../hooks/useHydraEngine';

interface AnomalyMatrixProps {
    modules: ModuleData[];
    onSelectModule?: (modId: string) => void;
}

const AnomalyMatrix: React.FC<AnomalyMatrixProps> = ({ modules, onSelectModule }) => {
    // Detectar Anomalías Reales
    const anomalies = modules.flatMap(m => {
        const issues = [];

        // 1. Sobregiro de Gasto por Módulo
        if (m.current_flow > m.target_flow * 1.1 && m.target_flow > 0) {
            issues.push({
                id: `overflow-${m.id}`,
                type: 'critical',
                title: 'Sobregiro de Gasto',
                desc: `${(m.current_flow * 1000).toFixed(0)} L/s vs ${(m.target_flow * 1000).toFixed(0)} L/s`,
                moduleId: m.id,
                moduleName: m.short_code || m.name,
                icon: Gauge
            });
        }

        // 2. Capacidad Excedida en Puntos de Entrega (Tomás/Laterales)
        m.delivery_points.forEach(dp => {
            if (dp.current_q > dp.capacity) {
                issues.push({
                    id: `cap-${dp.id}`,
                    type: 'critical',
                    title: 'Capacidad Excedida',
                    desc: `${dp.name}: ${(dp.current_q * 1000).toFixed(0)} L/s > ${(dp.capacity * 1000).toFixed(0)} L/s`,
                    moduleId: m.id,
                    moduleName: m.short_code || m.name,
                    icon: Zap
                });
            }
        });

        // 3. Eficiencia Baja por Módulo (Simulado si < 70%)
        const eff = m.authorized_vol > 0 ? (m.accumulated_vol / m.authorized_vol) * 100 : 100;
        if (eff < 70 && m.authorized_vol > 0) {
            issues.push({
                id: `eff-${m.id}`,
                type: 'warning',
                title: 'Baja Eficiencia Acumulada',
                desc: `Cumplimiento: ${eff.toFixed(1)}% del volumen autorizado`,
                moduleId: m.id,
                moduleName: m.short_code || m.name,
                icon: Target
            });
        }

        return issues;
    });

    if (anomalies.length === 0) {
        return (
            <div className="bg-slate-900/40 rounded-2xl p-6 border border-white/5 h-full flex flex-col items-center justify-center text-slate-500 shadow-inner backdrop-blur-md">
                <div className="w-16 h-16 rounded-full bg-emerald-500/5 flex items-center justify-center mb-4 border border-emerald-500/10">
                    <Activity size={32} className="text-emerald-500/40 animate-pulse" />
                </div>
                <span className="text-xs font-black uppercase tracking-[0.2em] text-emerald-500/60 mb-1">Estatus Operativo</span>
                <span className="text-[10px] font-mono opacity-40">Sincronía Digital Optimizada</span>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-[#020617]/80 rounded-2xl border border-white/10 overflow-hidden shadow-2xl backdrop-blur-xl">
            <header className="px-5 py-4 border-b border-white/10 flex justify-between items-center bg-gradient-to-b from-white/5 to-transparent">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-red-500/10 rounded-lg border border-red-500/20">
                        <AlertTriangle size={16} className="text-red-400" />
                    </div>
                    <h3 className="text-[11px] font-black uppercase tracking-[0.15em] text-white">Matriz de Anomalías</h3>
                </div>
                <div className="flex items-center gap-2 bg-red-500/10 px-2 py-1 rounded-full border border-red-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                    <span className="text-[10px] font-mono font-black text-red-400">{anomalies.length}</span>
                </div>
            </header>

            <div className="overflow-y-auto p-3 space-y-3 flex-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {anomalies.map((issue) => {
                    const IssueIcon = issue.icon || AlertTriangle;
                    const isCritical = issue.type === 'critical';

                    return (
                        <div
                            key={issue.id}
                            className={`group relative p-4 rounded-xl border transition-all duration-300 cursor-pointer overflow-hidden ${isCritical
                                    ? 'bg-red-500/5 border-red-500/10 hover:border-red-500/30'
                                    : 'bg-amber-500/5 border-amber-500/10 hover:border-amber-500/30'
                                }`}
                            onClick={() => onSelectModule && onSelectModule(issue.moduleId)}
                        >
                            {/* Accent line */}
                            <div className={`absolute left-0 top-0 bottom-0 w-1 ${isCritical ? 'bg-red-500' : 'bg-amber-500'} group-hover:w-1.5 transition-all`} />

                            <div className="flex justify-between items-start mb-2">
                                <span className="text-[9px] font-black font-mono text-slate-500 uppercase tracking-widest">{issue.moduleName}</span>
                                <div className="p-1 rounded bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <ArrowRight size={10} className="text-white" />
                                </div>
                            </div>

                            <div className="flex gap-3">
                                <div className={`mt-0.5 p-1.5 rounded-lg ${isCritical ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                    <IssueIcon size={14} />
                                </div>
                                <div className="flex flex-col">
                                    <h4 className="text-xs font-bold text-white mb-1 group-hover:text-red-100 transition-colors">{issue.title}</h4>
                                    <p className={`text-[10px] font-mono ${isCritical ? 'text-red-400/80' : 'text-amber-400/80'}`}>{issue.desc}</p>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <footer className="px-5 py-3 border-t border-white/5 bg-white/5">
                <p className="text-[9px] text-slate-500 font-mono text-center tracking-tighter">
                    © Hidro-Sincronía Digital · SRL Unidad Conchos
                </p>
            </footer>
        </div>
    );
};

export default AnomalyMatrix;
