import React, { useState, useEffect } from 'react';
import { Timer, MapPin, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import './ArrivalPredictor.css';

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
        <div className="arrival-predictor">
            {/* Ambient background glows */}
            <div className="ap-glow-top" />
            <div className="ap-glow-bottom" />

            <header className="ap-header">
                <div className="ap-header-left">
                    <div className="ap-icon-container">
                        <div className="ap-icon-glow" />
                        <div className="ap-icon-box">
                            <Timer size={24} />
                        </div>
                    </div>
                    <div className="ap-header-info">
                        <h3>Predictor de Tránsito</h3>
                        <div className="ap-model-tag">
                            <div className="ap-model-line" />
                            <span className="ap-model-text">Modelo Hidráulico DR-005</span>
                        </div>
                    </div>
                </div>

                <div className="ap-status-pill">
                    <div className="ap-status-indicator">
                        <div className="ap-indicator-glow" />
                        <div className="ap-indicator-dot" />
                    </div>
                    <span className="ap-status-text">En Llenado</span>
                </div>
            </header>

            <div className="ap-grid">
                {predictions.map((p, i) => (
                    <div key={i} className="ap-point-card">
                        <div className="ap-card-inner">
                            <div className="ap-card-shimmer" />

                            <div className="ap-card-header">
                                <div className="ap-km-tag">
                                    <div className="ap-km-dot" />
                                    <span className="ap-km-text">KM {p.km}</span>
                                </div>
                                <div className="ap-pin-box">
                                    <MapPin size={14} />
                                </div>
                            </div>

                            <h4 className="ap-point-name">
                                {p.nombre}
                            </h4>

                            <div className="ap-time-group">
                                <span className="ap-countdown">
                                    {formatTime(p.seconds_remaining)}
                                </span>
                                <div className="ap-arrival-meta">
                                    <Clock size={10} style={{ color: '#60a5fa' }} />
                                    <span className="ap-arrival-text">
                                        Arribo: <span className="ap-arrival-time">{new Date(p.hora_arribo_estimada).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </span>
                                </div>
                            </div>

                            <div className="ap-progress-container">
                                <div
                                    className="ap-progress-bar"
                                    style={{ width: `${60 - (i * 10)}%` }}
                                >
                                    <div className="ap-progress-shimmer" />
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
