
import React from 'react';
import { ShieldAlert, Droplets, ArrowRight, Activity, Zap } from 'lucide-react';
import { useLeakMonitor } from '../hooks/useLeakMonitor';

const WaterLossMonitor: React.FC = () => {
    const { segments, loading } = useLeakMonitor();

    if (loading && segments.length === 0) {
        return <div className="p-8 text-center text-slate-500 animate-pulse font-mono text-xs">Sincronizando Balances Hídricos...</div>;
    }

    return (
        <div className="relative flex flex-col h-full bg-slate-950/40 rounded-[2.5rem] border border-white/5 overflow-hidden backdrop-blur-3xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.6)]">
            {/* Background branding glow */}
            <div className="absolute top-0 right-0 w-48 h-48 bg-blue-600/5 blur-[80px] -mr-20 -mt-20" />

            <header className="relative px-8 py-7 border-b border-white/5 bg-gradient-to-br from-blue-500/[0.07] via-transparent to-transparent">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-5">
                        <div className="relative">
                            <div className="absolute inset-0 bg-blue-500 blur-lg opacity-20 animate-pulse" />
                            <div className="relative p-3 bg-blue-500/20 rounded-2xl border border-blue-500/30">
                                <ShieldAlert size={22} className="text-blue-400" />
                            </div>
                        </div>
                        <div>
                            <h3 className="text-[11px] font-black uppercase tracking-[0.25em] text-white/90">Monitor de Vulnerabilidad</h3>
                            <div className="flex items-center gap-2 mt-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                                <p className="text-[10px] font-black font-mono text-blue-400/80 uppercase tracking-widest">Detección de Fugas • Hydra Engine</p>
                            </div>
                        </div>
                    </div>
                    {/* Pulsing activity indicator */}
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-xl">
                        <Activity size={12} className="text-slate-500" />
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Live Analysis</span>
                    </div>
                </div>
            </header>

            <div className="p-6 overflow-y-auto space-y-4 flex-1 scrollbar-hide">
                {segments.map((s, idx) => {
                    const estatus = s.estatus || '';
                    const isCritical = estatus.includes('CRÍTICA');
                    const isWarning = estatus.includes('PREVENTIVA');
                    const safetyQ = isNaN(s.q_perdida) ? 0 : s.q_perdida;
                    const safetyPct = isNaN(s.eficiencia_pct) ? 100 : s.eficiencia_pct;

                    return (
                        <div
                            key={idx}
                            className={`group relative p-6 rounded-[1.75rem] border transition-all duration-700 ${isCritical ? 'bg-red-500/[0.03] border-red-500/10 hover:border-red-500/30 hover:bg-red-500/[0.06]' :
                                    isWarning ? 'bg-amber-500/[0.03] border-amber-500/10 hover:border-amber-500/30 hover:bg-amber-500/[0.06]' :
                                        'bg-emerald-500/[0.03] border-emerald-500/10 hover:border-emerald-500/30 hover:bg-emerald-500/[0.06]'
                                } shadow-sm hover:shadow-xl hover:-translate-y-0.5`}
                        >
                            <div className="flex justify-between items-start mb-5">
                                <div className="flex items-center gap-2.5">
                                    <div className="flex flex-col">
                                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Segmento</span>
                                        <div className="flex items-center gap-2">
                                            <span className="px-3 py-1.5 rounded-xl bg-white/5 text-[11px] font-mono font-black text-white/70 border border-white/5 shadow-inner">
                                                KM {s.km_inicio}
                                            </span>
                                            <div className="w-4 h-px bg-slate-700" />
                                            <span className="px-3 py-1.5 rounded-xl bg-white/5 text-[11px] font-mono font-black text-white/70 border border-white/5 shadow-inner">
                                                KM {s.km_fin}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-2xl border text-[10px] font-black uppercase tracking-tight shadow-md ${isCritical ? 'bg-red-500/20 border-red-500/30 text-red-400 shadow-red-900/20' :
                                        isWarning ? 'bg-amber-500/20 border-amber-500/30 text-amber-400 shadow-amber-900/20' :
                                            'bg-emerald-500/20 border-emerald-500/30 text-emerald-400 shadow-emerald-900/20'
                                    }`}>
                                    <div className={`w-1.5 h-1.5 rounded-full ${isCritical ? 'bg-red-400 animate-pulse' : isWarning ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                                    {s.estatus}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-6 relative z-10">
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <p className="text-[10px] uppercase font-black text-slate-500 flex items-center gap-1.5 tracking-wider">
                                            <Zap size={10} className="text-blue-400" /> Eficiencia
                                        </p>
                                    </div>
                                    <div className="flex items-end gap-2">
                                        <span className={`text-3xl font-black font-mono leading-none tracking-tighter ${isCritical ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-emerald-400'
                                            }`}>
                                            {safetyPct}%
                                        </span>
                                    </div>
                                    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden border border-white/5 shadow-inner">
                                        <div
                                            className={`h-full transition-all duration-[1.5s] ease-out relative ${isCritical ? 'bg-gradient-to-r from-red-600 to-red-400' :
                                                    isWarning ? 'bg-gradient-to-r from-amber-600 to-amber-400' :
                                                        'bg-gradient-to-r from-emerald-600 to-emerald-400'
                                                }`}
                                            style={{ width: `${safetyPct}%` }}
                                        >
                                            <div className="absolute inset-0 bg-white/20 animate-shimmer" style={{ backgroundSize: '200% 100%', backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)' }} />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <p className="text-[10px] uppercase font-black text-slate-500 flex items-center gap-1.5 tracking-wider">
                                        <Droplets size={10} className="text-blue-400" /> Pérdida
                                    </p>
                                    <div className="flex items-baseline gap-1.5">
                                        <span className="text-3xl font-black text-white leading-none tracking-tighter">
                                            {(safetyQ * 1000).toFixed(0)}
                                        </span>
                                        <span className="text-xs font-black font-mono text-slate-500 tracking-tighter">L/S</span>
                                    </div>
                                    <p className="text-[9px] font-black font-mono text-slate-600 truncate uppercase mt-1">
                                        {s.tramo_inicio} <span className="text-slate-800">→</span> {s.tramo_fin}
                                    </p>
                                </div>
                            </div>

                            {/* Decorative ambient light */}
                            <div className={`absolute -right-4 -bottom-4 w-24 h-24 blur-[40px] opacity-0 group-hover:opacity-20 transition-opacity duration-1000 rounded-full ${isCritical ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-emerald-500'
                                }`} />
                        </div>
                    );
                })}
            </div>

            <footer className="px-8 py-5 border-t border-white/5 bg-black/40 backdrop-blur-md">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-1 h-1 rounded-full bg-slate-700" />
                        <span className="text-[9px] font-black font-mono text-slate-600 tracking-widest uppercase">Sistema Hydra Engine v2.0</span>
                    </div>
                    <button className="group flex items-center gap-2 px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-xl transition-all">
                        <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest group-hover:text-blue-300 transition-colors">
                            Ver Reporte Completo
                        </span>
                        <ArrowRight size={12} className="text-blue-500 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default WaterLossMonitor;
