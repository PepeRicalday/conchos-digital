import React, { useState } from 'react';
import { Timer, MapPin, Clock, CheckCircle2, AlertTriangle, Shield } from 'lucide-react';
import { getLocalDatetimeInput, formatTime } from '../utils/dateHelpers';
import { useLlenadoTracker } from '../hooks/useLlenadoTracker';
import type { PuntoControl, LlenadoEstado } from '../hooks/useLlenadoTracker';
import TransicionProtocolo from './TransicionProtocolo';
import './LlenadoTracker.css';

interface Props {
    eventoId: string | null;
    qSolicitado: number;
    horaApertura: string | null;
    onConfirmarApertura: () => void;
    onUpdateGasto?: (newGasto: number) => void;
}

const formatCountdown = (seconds: number): string => {
    if (seconds < 0) return 'DEMORADO';
    if (seconds === 0) return 'EN PUNTO';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const formatHora = (iso: string | null): string => {
    if (!iso) return '--:--';
    return formatTime(iso);
};

const EstadoBadge: React.FC<{ estado: LlenadoEstado }> = ({ estado }) => {
    const config: Record<LlenadoEstado, { label: string; class: string }> = {
        'PREPARACION': { label: '🔒 Esperando Apertura', class: 'bg-amber-500/10 text-amber-500 border-amber-500/30' },
        'TRANSITO_RIO': { label: '🌊 Tránsito en Río', class: 'bg-blue-500/10 text-blue-500 border-blue-500/30' },
        'TRANSITO_CANAL': { label: '⚡ Tránsito en Canal', class: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' },
        'COMPLETADO': { label: '✅ Llenado Completo', class: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' },
    };
    const c = config[estado];
    return (
        <span className={`px-3.5 py-1.5 rounded-full text-[10px] font-black tracking-widest uppercase border ${c.class}`}>
            {c.label}
        </span>
    );
};

const PuntoCard: React.FC<{
    punto: PuntoControl;
    isAncla: boolean;
    estadoGeneral: LlenadoEstado;
    onConfirmar: (punto: PuntoControl) => void;
}> = ({ punto, isAncla, estadoGeneral, onConfirmar }) => {
    const isPendiente = estadoGeneral === 'PREPARACION';
    const isConfirmado = punto.estado === 'CONFIRMADO' || punto.estado === 'ESTABILIZADO';
    const isProximo = !isConfirmado && punto.seconds_remaining > 0 && punto.seconds_remaining < 1800;
    const isDelayed = !isConfirmado && !isPendiente && punto.seconds_remaining === 0;

    const cardClassName = [
        'punto-card',
        isConfirmado ? 'confirmed' : '',
        isAncla ? 'ancla' : '',
        isProximo ? 'proximo' : ''
    ].filter(Boolean).join(' ');

    return (
        <div className={cardClassName}>
            {/* Header / Fila Superior: Status + KM + MapPin */}
            <div className="punto-header">
                <div className="punto-status-group">
                    <div className={`status-dot ${isConfirmado ? 'green' : isPendiente ? 'gray' : 'blue'}`} />
                    <span className="text-slate-500 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">
                        {punto.km === -36 ? 'KM -36' : punto.km === 0 ? 'ENTRADA CANAL' : `KM ${punto.km}`}
                    </span>
                    {isAncla && (
                        <span className="punto-tag-ancla">
                            ANCLA
                        </span>
                    )}
                </div>
                <MapPin size={10} className={isConfirmado ? 'text-emerald-500/60' : 'text-slate-800'} />
            </div>

            {/* Fila del Punto / Título Principal */}
            <h4 className="text-white text-base font-[1000] mb-0.5 leading-tight tracking-tight uppercase">
                {punto.punto_nombre}
            </h4>
            
            {punto.km === 0 ? (
                <span className="text-[9px] text-[#3d85f6] font-black uppercase tracking-tighter mb-2">
                    Transferencia Río → Canal
                </span>
            ) : <div className="h-4" />} {/* Spacer to maintain height consistency */}

            {/* Central Display */}
            <div className="display-block">
                {isPendiente ? (
                    <>
                        <div className="text-slate-800 font-mono text-3xl font-black tracking-tighter">--:--:--</div>
                        <div className="text-slate-800 text-[9px] font-black uppercase tracking-wider mt-1">ESPERANDO APERTURA</div>
                    </>
                ) : isConfirmado ? (
                    <div className="arribo-text">
                        <CheckCircle2 size={32} className="text-emerald-500 mb-3" />
                        <span style={{ fontSize: '0.9rem', fontWeight: 900 }}>
                            ARRIBO: {formatHora(punto.hora_real)}
                        </span>
                    </div>
                ) : (
                    <>
                        <div className={`countdown-text ${isDelayed ? 'text-rose-500 animate-pulse' : ''}`}>
                            {formatCountdown(punto.seconds_remaining)}
                        </div>
                        <div className="eta-label">
                            <Clock size={10} className="mr-1" /> ETA: <span className="eta-value">{formatHora(punto.hora_estimada_actual)}</span>
                        </div>
                        {punto.recalculado_desde && (
                            <div className="recal-indicator">
                                ↻ Recalculado desde {punto.recalculado_desde === 'CALIBRACION_REAL' ? 'CALIBRACION REAL' : punto.recalculado_desde}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Tech Info Row: Estilo Vertical Solicitado */}
            {isConfirmado && (punto.nivel_arribo_m || punto.gasto_paso_m3s) && (
                <div className="tech-info-row">
                    {punto.nivel_arribo_m !== undefined && (
                        <div className="tech-tag">
                            <span>Nivel</span>
                            <span>{punto.nivel_arribo_m?.toFixed(2)} m</span>
                        </div>
                    )}
                    {punto.gasto_paso_m3s !== undefined && (
                        <div className="tech-tag">
                            <span>Gasto</span>
                            <span>{punto.gasto_paso_m3s?.toFixed(2)} m³/s</span>
                        </div>
                    )}
                </div>
            )}

            {/* Barra de progreso para tránsito */}
            {!isPendiente && !isConfirmado && punto.segundos_modelo && (
                <div className="mt-2 h-1 bg-slate-900 rounded-full overflow-hidden w-full">
                    <div 
                        className="h-full bg-gradient-to-r from-blue-600 to-blue-400"
                        style={{ width: `${Math.max(5, 100 - (punto.seconds_remaining / (punto.segundos_modelo || 1)) * 100)}%` }}
                    />
                </div>
            )}

            {/* Botón de confirmar arribo */}
            {!isConfirmado && !isPendiente && (
                <button
                    onClick={() => onConfirmar(punto)}
                    className="btn-confirmar-arribo"
                >
                    <CheckCircle2 size={14} />
                    Confirmar Arribo
                </button>
            )}
        </div>
    );
};

// === Componente Principal ===
const LlenadoTracker: React.FC<Props> = ({ eventoId, qSolicitado, horaApertura, onConfirmarApertura, onUpdateGasto }) => {
    const { puntos, estadoGeneral, puntoAncla, telemetria, loading, confirmarArribo } = useLlenadoTracker(eventoId, qSolicitado, horaApertura);
    const [isEditingGasto, setIsEditingGasto] = useState(false);
    const [tempGasto, setTempGasto] = useState(qSolicitado.toString());
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [selectedPunto, setSelectedPunto] = useState<PuntoControl | null>(null);
    const [confirNivel, setConfirNivel] = useState('');
    const [confirGasto, setConfirGasto] = useState('');
    const [confirNotas, setConfirNotas] = useState('');
    const [confirDatetime, setConfirDatetime] = useState('');

    const handleConfirmar = (punto: PuntoControl) => {
        setSelectedPunto(punto);
        setConfirNivel('');
        setConfirGasto('');
        setConfirNotas('');
        
        // P2-9: getLocalDatetimeInput() usa Intl en America/Chihuahua — seguro en DST
        setConfirDatetime(getLocalDatetimeInput());
        
        setShowConfirmModal(true);
    };

    const ejecutarConfirmacion = async () => {
        if (!selectedPunto?.id || !confirDatetime) return;
        
        const selectedDate = new Date(confirDatetime);
        await confirmarArribo(
            selectedPunto.id,
            selectedDate.toISOString(),
            confirNivel ? parseFloat(confirNivel) : undefined,
            confirGasto ? parseFloat(confirGasto) : undefined,
            confirNotas || undefined
        );
        setShowConfirmModal(false);
    };

    const tiempoTranscurrido = horaApertura
        ? Math.max(0, (Date.now() - new Date(horaApertura).getTime()) / 1000)
        : 0;

    if (loading || puntos.length === 0) {
        return (
            <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                <Timer size={24} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
                <p style={{ fontSize: '0.8rem' }}>Inicializando puntos de control...</p>
            </div>
        );
    }

    const confirmados = puntos.filter(p => p.hora_real).length;
    const total = puntos.length;

    // Calcular día operacional del llenado
    const diaLlenado = (() => {
        if (!horaApertura) return 0;
        const apertura = new Date(horaApertura);
        const hoy = new Date();
        const diffMs = hoy.getTime() - apertura.getTime();
        return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    })();

    return (
        <div className="relative">
            {/* Cabecera */}
            <div className="tracker-main-card">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-cyan-500/10 rounded-xl border border-cyan-500/20 shadow-[0_0_15px_rgba(34,211,238,0.1)]">
                            <Timer size={20} className="text-cyan-400" />
                        </div>
                        <div>
                            <h3 className="text-white text-lg font-black tracking-tight leading-tight">
                                Tránsito de Onda Positiva
                            </h3>
                            <div className="flex items-center gap-2 mt-0.5">
                                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                                    36km Río + 104km Canal | Q=
                                </p>
                                {isEditingGasto ? (
                                    <div className="flex items-center gap-1">
                                        <input 
                                            type="number" 
                                            value={tempGasto} 
                                            onChange={e => setTempGasto(e.target.value)}
                                            className="w-16 bg-slate-800 border-2 border-mobile-accent text-white text-[10px] font-black rounded px-1.5 py-0.5"
                                        />
                                        <button onClick={() => {
                                            if (onUpdateGasto) onUpdateGasto(parseFloat(tempGasto));
                                            setIsEditingGasto(false);
                                        }} className="p-1 bg-emerald-500 text-white rounded hover:bg-emerald-600 transition-colors" title="Guardar gasto">
                                            <CheckCircle2 size={12} />
                                        </button>
                                        <button onClick={() => setIsEditingGasto(false)} className="p-1 bg-slate-700 text-slate-300 rounded hover:bg-slate-600 transition-colors" title="Cancelar">
                                            <Shield size={12} />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-cyan-400 text-[11px] font-black bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20 shadow-inner">
                                            {qSolicitado} m³/s
                                        </span>
                                        {!horaApertura && onUpdateGasto && (
                                            <button 
                                                onClick={() => {
                                                    setTempGasto(qSolicitado.toString());
                                                    setIsEditingGasto(true);
                                                }}
                                                className="text-cyan-600 hover:text-cyan-400 hover:scale-110 transition-all"
                                                title="Editar gasto solicitado"
                                            >
                                                <Clock size={12} />
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {diaLlenado > 0 && (
                            <span className="px-3 py-1.5 rounded-lg text-[10px] font-black text-white bg-slate-800 border border-slate-700 shadow-inner">
                                📅 Día {diaLlenado}
                            </span>
                        )}
                        <EstadoBadge estado={estadoGeneral} />
                    </div>
                </div>

                {/* Info de apertura */}
                <div className="flex flex-wrap gap-3 mb-4">
                    {horaApertura ? (
                        <>
                            <div className="flex-1 min-w-[120px] p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 shadow-inner">
                                <div className="text-slate-500 text-[9px] font-black uppercase mb-1">Hora de Apertura</div>
                                <div className="text-emerald-400 text-lg font-black tracking-tight">{formatHora(horaApertura)}</div>
                            </div>
                            <div className="flex-1 min-w-[120px] p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20 shadow-inner">
                                <div className="text-slate-500 text-[9px] font-black uppercase mb-1">Tiempo de Tránsito</div>
                                <div className="text-blue-400 text-lg font-black font-mono tracking-tighter">
                                    {formatCountdown(tiempoTranscurrido)}
                                </div>
                            </div>
                            <div className="flex-1 min-w-[120px] p-3 bg-cyan-500/10 rounded-2xl border border-cyan-500/20 shadow-inner">
                                <div className="text-slate-500 text-[9px] font-black uppercase mb-1">Checkpoints</div>
                                <div className="text-cyan-400 text-lg font-black">{confirmados} <span className="text-slate-600 font-normal">/ {total}</span></div>
                            </div>
                        </>
                    ) : (
                        <button
                            onClick={onConfirmarApertura}
                            className="w-full p-4 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-700 text-slate-950 font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3 shadow-xl shadow-amber-900/40 hover:scale-[1.01] active:scale-[0.99] transition-all animate-pulse"
                            title="Confirmar apertura de presa"
                        >
                            <AlertTriangle size={20} className="animate-bounce" />
                            SICA: Confirmar Hora de Apertura (Obra de Toma)
                        </button>
                    )}
                </div>

                {/* Panel de Inteligencia de Datos (Telemetría Avanzada) */}
                {horaApertura && (
                    <div className="telemetry-panel">
                        <div className="telemetry-item">
                            <span className="telemetry-label">V. Promedio del Frente</span>
                            <div className="telemetry-value-group">
                                <span className="telemetry-value">{(telemetria.velocidad_promedio_km_h ?? 0).toFixed(2)}</span>
                                <span className="telemetry-unit">km/h</span>
                                <span className="telemetry-accent">({(telemetria.velocidad_promedio_m_s ?? 0).toFixed(2)} m/s)</span>
                            </div>
                        </div>
                        <div className="telemetry-item">
                            <span className="telemetry-label">Desde KM 0+000</span>
                            <div className="telemetry-value-group">
                                <span className="telemetry-value">
                                    {telemetria.tiempo_desde_km0_s > 0 ? formatCountdown(telemetria.tiempo_desde_km0_s) : "--:--:--"}
                                </span>
                                <span className="telemetry-unit">Transcurrido</span>
                            </div>
                        </div>
                        <div className="telemetry-item">
                            <span className="telemetry-label">Volumen Inyectado</span>
                            <div className="telemetry-value-group">
                                <span className="telemetry-value" style={{ color: '#4ade80' }}>
                                    {(telemetria.volumen_estimado_inyectado_mm3 ?? 0).toFixed(4)}
                                </span>
                                <span className="telemetry-unit">Mm³</span>
                            </div>
                        </div>
                        <div className="telemetry-item">
                            <span className="telemetry-label">Progreso Total</span>
                            <div className="telemetry-progress-container">
                                <div className="progress-stats">
                                    <span className="progress-pct">{(telemetria.avance_porcentaje ?? 0).toFixed(1)}%</span>
                                    <span className="progress-dist">{(telemetria.distancia_recorrida_km ?? 0).toFixed(1)} / 140 km</span>
                                </div>
                                <div className="progress-track">
                                    <div 
                                        className="progress-fill"
                                        style={{ width: `${telemetria.avance_porcentaje}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Grid de puntos */}
            <div className="punto-grid">
                {puntos.map(p => (
                    <PuntoCard
                        key={p.id || p.km}
                        punto={p}
                        isAncla={puntoAncla?.id === p.id}
                        estadoGeneral={estadoGeneral}
                        onConfirmar={handleConfirmar}
                    />
                ))}
            </div>

            {/* Panel de Transición LLENADO → ESTABILIZACIÓN */}
            {eventoId && estadoGeneral !== 'PREPARACION' && (
                <TransicionProtocolo
                    eventoId={eventoId}
                    onTransicionCompletada={() => window.location.reload()}
                />
            )}

            {/* Modal de confirmación de arribo */}
            {showConfirmModal && selectedPunto && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 9999,
                    background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }} onClick={() => setShowConfirmModal(false)}>
                    <div onClick={e => e.stopPropagation()} style={{
                        background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '16px', padding: '28px', width: '420px', maxWidth: '95vw',
                        boxShadow: '0 25px 50px rgba(0,0,0,0.5)'
                    }}>
                        <h3 style={{ color: '#22d3ee', fontSize: '1.1rem', fontWeight: 900, marginBottom: '4px' }}>
                            📍 Confirmar Arribo
                        </h3>
                        <p style={{ color: '#94a3b8', fontSize: '0.75rem', marginBottom: '16px' }}>
                            {selectedPunto.punto_nombre} — KM {selectedPunto.km}
                        </p>

                        <div style={{ display: 'flex', gap: '8px', padding: '10px 12px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: '10px', marginBottom: '20px' }}>
                            <Shield size={14} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
                            <div>
                                <p style={{ color: '#fca5a5', fontSize: '0.65rem', fontWeight: 800, margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Acción Auditada (SRL)
                                </p>
                                <p style={{ color: '#94a3b8', fontSize: '0.6rem', margin: 0, lineHeight: 1.4 }}>
                                    Confirmar este arribo recalculará la cronometría de toda la cuenca aguas abajo.
                                </p>
                            </div>
                        </div>

                        <div style={{ marginBottom: '12px' }}>
                            <label style={{ color: '#e2e8f0', fontSize: '0.7rem', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
                                Fecha y Hora Real de Arribo
                            </label>
                            <input 
                                type="datetime-local" 
                                value={confirDatetime} 
                                onChange={e => setConfirDatetime(e.target.value)}
                                style={{ 
                                    display: 'block', width: '100%', padding: '10px', 
                                    background: '#1e293b', border: '1px solid #334155', 
                                    borderRadius: '8px', color: '#f1f5f9', fontSize: '0.9rem' 
                                }} 
                            />
                        </div>

                        <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                            <label style={{ flex: 1, color: '#e2e8f0', fontSize: '0.7rem', fontWeight: 700 }}>
                                Nivel del agua (m)
                                <input type="number" step="0.01" value={confirNivel} onChange={e => setConfirNivel(e.target.value)}
                                    placeholder="ej: 1.85"
                                    style={{ display: 'block', width: '100%', marginTop: '4px', padding: '10px', background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#f1f5f9', fontSize: '0.9rem' }} />
                            </label>
                            <label style={{ flex: 1, color: '#e2e8f0', fontSize: '0.7rem', fontWeight: 700 }}>
                                Gasto medido (m³/s)
                                <input type="number" step="0.001" value={confirGasto} onChange={e => setConfirGasto(e.target.value)}
                                    placeholder="ej: 55.3"
                                    style={{ display: 'block', width: '100%', marginTop: '4px', padding: '10px', background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#f1f5f9', fontSize: '0.9rem' }} />
                            </label>
                        </div>

                        <label style={{ color: '#e2e8f0', fontSize: '0.7rem', fontWeight: 700, display: 'block', marginBottom: '16px' }}>
                            Notas del operador
                            <textarea value={confirNotas} onChange={e => setConfirNotas(e.target.value)}
                                rows={2} placeholder="Observaciones..."
                                style={{ display: 'block', width: '100%', marginTop: '4px', padding: '10px', background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#f1f5f9', fontSize: '0.8rem', resize: 'none' }} />
                        </label>

                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button onClick={() => setShowConfirmModal(false)}
                                style={{ flex: 1, padding: '12px', background: '#334155', color: '#e2e8f0', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }}>
                                Cancelar
                            </button>
                            <button onClick={ejecutarConfirmacion}
                                style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #10b981, #059669)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 900, fontSize: '0.85rem', textTransform: 'uppercase' }}>
                                ✅ Confirmar Arribo
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LlenadoTracker;
