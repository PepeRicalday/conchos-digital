
import React from 'react';
import { ShieldAlert, Droplets, ArrowRight, Activity, Zap } from 'lucide-react';
import { useLeakMonitor } from '../hooks/useLeakMonitor';

const WaterLossMonitor: React.FC = () => {
    const { segments, loading } = useLeakMonitor();

    if (loading && segments.length === 0) {
        return <div className="p-8 text-center text-slate-500 animate-pulse font-mono text-xs">Sincronizando Balances Hídricos...</div>;
    }

    return (
        <div className="flex flex-col h-full bg-[#020617]/40 rounded-3xl border border-white/5 overflow-hidden backdrop-blur-3xl shadow-2xl">
            <header className="px-6 py-5 border-b border-white/5 bg-gradient-to-r from-blue-500/10 via-transparent to-transparent">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/20 rounded-xl border border-blue-500/30">
                            <ShieldAlert size={18} className="text-blue-400" />
                        </div>
                        <div>
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-white">Monitor de Vulnerabilidad</h3>
                            <p className="text-[9px] font-mono text-blue-400/60 uppercase">Detección de Fugas en Tiempo Real</p>
                        </div>
                    </div>
                </div>
            </header>

            <div className="p-4 overflow-y-auto space-y-3 flex-1 scrollbar-hide">
                {segments.map((s, idx) => {
                    const estatus = s.estatus || '';
                    const isCritical = estatus.includes('CRÍTICA');
                    const isWarning = estatus.includes('PREVENTIVA');

                    return (
                        <div
                            key={idx}
                            className={`group relative p-4 rounded-2xl border transition-all duration-500 ${isCritical ? 'bg-red-500/5 border-red-500/20 hover:bg-red-500/10' :
                                isWarning ? 'bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10' :
                                    'bg-emerald-500/5 border-emerald-500/10 hover:bg-emerald-500/10'
                                }`}
                        >
                            <div className="flex justify-between items-start mb-3">
                                <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 rounded-md bg-white/5 text-[10px] font-mono font-bold text-slate-400">
                                        KM {s.km_inicio}
                                    </span>
                                    <ArrowRight size={10} className="text-slate-600" />
                                    <span className="px-2 py-0.5 rounded-md bg-white/5 text-[10px] font-mono font-bold text-slate-400">
                                        KM {s.km_fin}
                                    </span>
                                </div>
                                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-[9px] font-black uppercase tracking-tighter ${isCritical ? 'bg-red-500/20 border-red-500/30 text-red-400' :
                                    isWarning ? 'bg-amber-500/20 border-amber-500/30 text-amber-400' :
                                        'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                                    }`}>
                                    <Activity size={10} className={isCritical ? 'animate-pulse' : ''} />
                                    {s.estatus}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <p className="text-[9px] uppercase font-bold text-slate-500 flex items-center gap-1">
                                        <Zap size={8} /> Eficiencia de Tramo
                                    </p>
                                    <div className="flex items-end gap-2">
                                        <span className={`text-xl font-black font-mono leading-none ${isCritical ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-emerald-400'
                                            }`}>
                                            {s.eficiencia_pct}%
                                        </span>
                                    </div>
                                    <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full transition-all duration-1000 ${isCritical ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-emerald-500'
                                                }`}
                                            style={{ width: `${s.eficiencia_pct}%` }}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <p className="text-[9px] uppercase font-bold text-slate-500 flex items-center gap-1">
                                        <Droplets size={8} /> Pérdida Estimada
                                    </p>
                                    <div className="flex items-end gap-1">
                                        <span className="text-lg font-black text-white leading-none">
                                            {(s.q_perdida * 1000).toFixed(0)}
                                        </span>
                                        <span className="text-[10px] font-mono text-slate-500 font-bold">L/s</span>
                                    </div>
                                    <p className="text-[8px] font-mono text-slate-600 truncate">
                                        {s.tramo_inicio} → {s.tramo_fin}
                                    </p>
                                </div>
                            </div>

                            {/* Glow effect on hover */}
                            <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-700 bg-gradient-to-br ${isCritical ? 'from-red-500/5 via-transparent to-transparent' :
                                isWarning ? 'from-amber-500/5 via-transparent to-transparent' :
                                    'from-emerald-500/5 via-transparent to-transparent'
                                }`} />
                        </div>
                    );
                })}
            </div>

            <footer className="px-6 py-4 border-t border-white/5 bg-black/20">
                <div className="flex items-center justify-between">
                    <span className="text-[8px] font-mono text-slate-600">SISTEMA HYDRA ENGINE v2.0</span>
                    <button className="text-[9px] font-black text-blue-400 uppercase tracking-widest hover:text-blue-300 transition-colors">
                        Ver Reporte Completo
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default WaterLossMonitor;
