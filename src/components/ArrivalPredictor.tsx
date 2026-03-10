
import React, { useState, useEffect } from 'react';
import { Timer, MapPin, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface ArrivalInfo {
    nombre: string;
    km: number;
    hora_arribo_estimada: string;
    seconds_remaining: number;
}

const ArrivalPredictor: React.FC = () => {
    const [predictions, setPredictions] = useState<ArrivalInfo[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchPredictions = async () => {
        const { data, error } = await supabase
            .from('vw_prediccion_arribo_escalas')
            .select('nombre, km, hora_arribo_estimada')
            .order('km', { ascending: true })
            .limit(4);

        if (!error && data) {
            const processed = data.map(d => ({
                ...d,
                seconds_remaining: (new Date(d.hora_arribo_estimada).getTime() - Date.now()) / 1000
            }));
            setPredictions(processed);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchPredictions();
        const interval = setInterval(() => {
            setPredictions(prev => prev.map(p => ({
                ...p,
                seconds_remaining: Math.max(0, (new Date(p.hora_arribo_estimada).getTime() - Date.now()) / 1000)
            })));
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const formatTime = (seconds: number) => {
        if (seconds <= 0) return "Llegó";
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    if (loading || predictions.length === 0) return null;

    return (
        <div className="relative overflow-hidden bg-slate-950/40 backdrop-blur-3xl border border-white/5 rounded-[2rem] p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
            {/* Ambient background glows */}
            <div className="absolute -top-24 -left-24 w-64 h-64 bg-blue-500/10 blur-[100px] rounded-full" />
            <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-indigo-500/10 blur-[100px] rounded-full" />

            <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between mb-10 gap-6">
                <div className="flex items-center gap-5">
                    <div className="relative">
                        <div className="absolute inset-0 bg-blue-400 blur-md opacity-20 animate-pulse" />
                        <div className="relative p-3.5 bg-gradient-to-br from-blue-500/20 to-blue-600/10 rounded-2xl border border-blue-400/30">
                            <Timer className="text-blue-400" size={24} />
                        </div>
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-white uppercase tracking-[0.15em] leading-tight">Predictor de Tránsito</h3>
                        <div className="flex items-center gap-2 mt-1">
                            <div className="h-px w-8 bg-blue-500/40" />
                            <p className="text-[10px] text-blue-400 font-black uppercase tracking-widest font-mono">Modelo Hidráulico DR-005</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 px-5 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl backdrop-blur-md shadow-[0_0_20px_rgba(16,185,129,0.1)]">
                    <div className="relative flex items-center justify-center">
                        <div className="absolute w-2.5 h-2.5 rounded-full bg-emerald-500 blur-sm animate-pulse" />
                        <div className="relative w-2 h-2 rounded-full bg-emerald-400" />
                    </div>
                    <span className="text-xs font-black text-emerald-400 uppercase tracking-widest">En Llenado</span>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {predictions.map((p, i) => (
                    <div key={i} className="relative group overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                        <div className="relative p-6 bg-white/[0.03] border border-white/[0.05] rounded-[1.5rem] group-hover:border-blue-500/30 transition-all duration-500 group-hover:-translate-y-1">
                            <div className="flex items-center justify-between mb-5">
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500/40" />
                                    <span className="text-[10px] font-black font-mono text-slate-500 tracking-widest uppercase text-shadow-sm">KM {p.km}</span>
                                </div>
                                <div className="p-1.5 bg-slate-800/40 rounded-lg group-hover:bg-blue-500/20 transition-colors">
                                    <MapPin size={14} className="text-slate-500 group-hover:text-blue-400 transition-colors" />
                                </div>
                            </div>

                            <h4 className="text-sm font-black text-slate-200 mb-6 group-hover:text-white transition-colors h-10 line-clamp-2 leading-snug uppercase tracking-tight">
                                {p.nombre}
                            </h4>

                            <div className="space-y-4">
                                <div className="flex flex-col">
                                    <span className="text-3xl font-black font-mono text-white tracking-tighter shadow-blue-500/20 drop-shadow-md">
                                        {formatTime(p.seconds_remaining)}
                                    </span>
                                    <div className="flex items-center gap-2 mt-2 px-2 py-1 bg-white/5 rounded-lg w-fit">
                                        <Clock size={10} className="text-blue-400" />
                                        <span className="text-[9px] text-slate-400 font-black uppercase tracking-wider">
                                            Arribo: <span className="text-blue-200">{new Date(p.hora_arribo_estimada).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                        </span>
                                    </div>
                                </div>

                                <div className="relative h-1.5 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                                    <div
                                        className="h-full bg-gradient-to-r from-blue-600 to-indigo-400 relative overflow-hidden transition-all duration-1000 ease-out"
                                        style={{ width: `${60 - (i * 10)}%` }}
                                    >
                                        <div className="absolute inset-0 bg-white/20 animate-shimmer" style={{ backgroundSize: '200% 100%', backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)' }} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ArrivalPredictor;
