
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
        <div className="bg-[#020617]/60 border border-blue-500/20 rounded-2xl p-6 backdrop-blur-xl shadow-2xl">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/20 rounded-lg">
                        <Timer className="text-blue-400" size={20} />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-white uppercase tracking-wider">Predictor de Tránsito</h3>
                        <p className="text-[10px] text-blue-400/60 font-mono">MODELO HIDRÁULICO DR-005</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-black text-emerald-400 uppercase">En Llenado</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {predictions.map((p, i) => (
                    <div key={i} className="relative group p-4 bg-white/5 rounded-xl border border-white/5 hover:border-blue-500/30 transition-all">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-mono text-slate-500">KM {p.km}</span>
                            <MapPin size={12} className="text-blue-500/40" />
                        </div>
                        <h4 className="text-xs font-bold text-white mb-3">{p.nombre}</h4>
                        <div className="flex flex-col gap-1">
                            <span className="text-2xl font-black font-mono text-blue-400 tracking-tighter">
                                {formatTime(p.seconds_remaining)}
                            </span>
                            <div className="flex items-center gap-1.5 text-[9px] text-slate-500 font-bold uppercase">
                                <Clock size={10} />
                                Llega: {new Date(p.hora_arribo_estimada).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                        </div>
                        <div className="mt-3 h-1 w-full bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500/50 animate-shimmer" style={{ width: '30%' }} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ArrivalPredictor;
