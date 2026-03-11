import React, { useState } from 'react';
import { Timer, MapPin, Clock, CheckCircle2, AlertTriangle, Lock } from 'lucide-react';
import { useLlenadoTracker } from '../hooks/useLlenadoTracker';
import type { PuntoControl, LlenadoEstado } from '../hooks/useLlenadoTracker';
import TransicionProtocolo from './TransicionProtocolo';
import './LlenadoTracker.css';

interface Props {
    eventoId: string | null;
    qSolicitado: number;
    horaApertura: string | null;
    onConfirmarApertura: () => void;
}

const formatCountdown = (seconds: number): string => {
    if (seconds < 0) return '--:--:--';
    if (seconds === 0) return 'ARRIBADO';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const formatHora = (iso: string | null): string => {
    if (!iso) return '--:--';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const EstadoBadge: React.FC<{ estado: LlenadoEstado }> = ({ estado }) => {
    const config: Record<LlenadoEstado, { label: string; color: string; bg: string }> = {
        'PREPARACION': { label: '🔒 Esperando Apertura', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
        'TRANSITO_RIO': { label: '🌊 Tránsito en Río', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
        'TRANSITO_CANAL': { label: '⚡ Tránsito en Canal', color: '#22d3ee', bg: 'rgba(34,211,238,0.1)' },
        'COMPLETADO': { label: '✅ Llenado Completo', color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
    };
    const c = config[estado];
    return (
        <span style={{
            padding: '6px 14px', borderRadius: '20px', fontSize: '0.7rem',
            fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase',
            color: c.color, background: c.bg, border: `1px solid ${c.color}30`
        }}>
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

    const cardStyle: React.CSSProperties = {
        background: isConfirmado
            ? 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(16,185,129,0.02))'
            : isAncla
                ? 'linear-gradient(135deg, rgba(34,211,238,0.12), rgba(34,211,238,0.03))'
                : isProximo
                    ? 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.02))'
                    : 'rgba(15,23,42,0.6)',
        border: `1px solid ${isConfirmado ? 'rgba(16,185,129,0.3)' : isAncla ? 'rgba(34,211,238,0.3)' : 'rgba(255,255,255,0.06)'}`,
        borderRadius: '12px',
        padding: '16px',
        position: 'relative',
        overflow: 'hidden',
        transition: 'all 0.3s ease'
    };

    return (
        <div style={cardStyle}>
            {/* Cabecera */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: isConfirmado ? '#10b981' : isProximo ? '#f59e0b' : isPendiente ? '#475569' : '#3b82f6',
                        boxShadow: isConfirmado ? '0 0 8px #10b981' : isProximo ? '0 0 8px #f59e0b' : 'none'
                    }} />
                    <span style={{ color: '#94a3b8', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                        {punto.km === 0 ? 'ENTRADA CANAL' : `KM ${punto.km}`}
                    </span>
                    {isAncla && (
                        <span style={{
                            padding: '2px 6px', borderRadius: '4px', fontSize: '0.55rem',
                            fontWeight: 900, color: '#22d3ee', background: 'rgba(34,211,238,0.15)',
                            border: '1px solid rgba(34,211,238,0.3)'
                        }}>ANCLA</span>
                    )}
                </div>
                <MapPin size={14} style={{ color: isConfirmado ? '#10b981' : '#475569' }} />
            </div>

            {/* Nombre */}
            <h4 style={{
                color: '#f1f5f9', fontSize: '1rem', fontWeight: 800,
                marginBottom: '8px', lineHeight: 1.2
            }}>
                {punto.punto_nombre}
                {punto.km === 0 && (
                    <span style={{ display: 'block', fontSize: '0.6rem', color: '#22d3ee', opacity: 0.7, marginTop: '2px', fontWeight: 600 }}>
                        Transferencia Río → Canal
                    </span>
                )}
            </h4>

            {/* Countdown / Estado */}
            {isPendiente ? (
                <div style={{
                    padding: '12px', background: 'rgba(71,85,105,0.2)', borderRadius: '8px',
                    textAlign: 'center', marginBottom: '8px'
                }}>
                    <Lock size={16} style={{ color: '#64748b', margin: '0 auto 4px' }} />
                    <div style={{ color: '#64748b', fontSize: '1.4rem', fontWeight: 900, fontFamily: 'monospace' }}>--:--:--</div>
                    <div style={{ color: '#475569', fontSize: '0.6rem', fontWeight: 700 }}>PENDIENTE DE APERTURA</div>
                </div>
            ) : isConfirmado ? (
                <div style={{
                    padding: '12px', background: 'rgba(16,185,129,0.1)', borderRadius: '8px',
                    textAlign: 'center', marginBottom: '8px', border: '1px solid rgba(16,185,129,0.2)'
                }}>
                    <CheckCircle2 size={18} style={{ color: '#10b981', margin: '0 auto 4px' }} />
                    <div style={{ color: '#10b981', fontSize: '0.9rem', fontWeight: 900 }}>
                        ARRIBO: {formatHora(punto.hora_real)}
                    </div>
                    {punto.diferencia_minutos !== null && (
                        <div style={{
                            color: punto.diferencia_minutos > 0 ? '#f59e0b' : '#10b981',
                            fontSize: '0.65rem', fontWeight: 700, marginTop: '2px'
                        }}>
                            Δ {punto.diferencia_minutos > 0 ? '+' : ''}{punto.diferencia_minutos.toFixed(0)} min vs modelo
                        </div>
                    )}
                </div>
            ) : (
                <div style={{
                    padding: '12px', background: 'rgba(59,130,246,0.1)', borderRadius: '8px',
                    textAlign: 'center', marginBottom: '8px', border: '1px solid rgba(59,130,246,0.15)'
                }}>
                    <div style={{
                        color: isProximo ? '#f59e0b' : '#60a5fa',
                        fontSize: '1.6rem', fontWeight: 900, fontFamily: "'Courier New', monospace",
                        textShadow: `0 0 20px ${isProximo ? 'rgba(245,158,11,0.3)' : 'rgba(96,165,250,0.3)'}`
                    }}>
                        {formatCountdown(punto.seconds_remaining)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'center', marginTop: '4px' }}>
                        <Clock size={10} style={{ color: '#60a5fa' }} />
                        <span style={{ color: '#94a3b8', fontSize: '0.65rem' }}>
                            ETA: <strong style={{ color: '#e2e8f0' }}>{formatHora(punto.hora_estimada_actual)}</strong>
                        </span>
                    </div>
                    {punto.recalculado_desde && (
                        <div style={{ color: '#22d3ee', fontSize: '0.55rem', marginTop: '3px', fontWeight: 700 }}>
                            ↻ Recalculado desde {punto.recalculado_desde}
                        </div>
                    )}
                </div>
            )}

            {/* Datos técnicos (si confirmado) */}
            {isConfirmado && (punto.nivel_arribo_m || punto.gasto_paso_m3s) && (
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    {punto.nivel_arribo_m && (
                        <div style={{ flex: 1, padding: '6px', background: 'rgba(30,41,59,0.5)', borderRadius: '6px', textAlign: 'center' }}>
                            <div style={{ color: '#64748b', fontSize: '0.55rem', fontWeight: 700 }}>NIVEL</div>
                            <div style={{ color: '#e2e8f0', fontSize: '0.8rem', fontWeight: 800 }}>{punto.nivel_arribo_m.toFixed(2)} m</div>
                        </div>
                    )}
                    {punto.gasto_paso_m3s && (
                        <div style={{ flex: 1, padding: '6px', background: 'rgba(30,41,59,0.5)', borderRadius: '6px', textAlign: 'center' }}>
                            <div style={{ color: '#64748b', fontSize: '0.55rem', fontWeight: 700 }}>GASTO</div>
                            <div style={{ color: '#0ea5e9', fontSize: '0.8rem', fontWeight: 800 }}>{punto.gasto_paso_m3s.toFixed(2)} m³/s</div>
                        </div>
                    )}
                </div>
            )}

            {/* Botón de confirmar arribo */}
            {!isConfirmado && !isPendiente && punto.seconds_remaining >= 0 && (
                <button
                    onClick={() => onConfirmar(punto)}
                    style={{
                        width: '100%', padding: '8px', border: 'none', borderRadius: '8px',
                        background: isProximo ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'rgba(59,130,246,0.15)',
                        color: isProximo ? '#0f172a' : '#93c5fd',
                        fontWeight: 800, fontSize: '0.7rem', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                        textTransform: 'uppercase', letterSpacing: '0.05em',
                        transition: 'all 0.2s ease'
                    }}>
                    <CheckCircle2 size={14} />
                    Confirmar Arribo
                </button>
            )}

            {/* Barra de progreso */}
            {!isPendiente && !isConfirmado && punto.segundos_modelo && (
                <div style={{ marginTop: '8px', height: '3px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                        height: '100%', borderRadius: '4px',
                        background: 'linear-gradient(90deg, #3b82f6, #22d3ee)',
                        width: `${Math.max(5, 100 - (punto.seconds_remaining / (punto.segundos_modelo || 1)) * 100)}%`,
                        transition: 'width 1s linear'
                    }} />
                </div>
            )}
        </div>
    );
};

// === Componente Principal ===
const LlenadoTracker: React.FC<Props> = ({ eventoId, qSolicitado, horaApertura, onConfirmarApertura }) => {
    const { puntos, estadoGeneral, puntoAncla, loading, confirmarArribo } = useLlenadoTracker(eventoId, qSolicitado, horaApertura);
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
        
        // Inicializar con la fecha/hora actual local
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(now.getTime() - offset)).toISOString().slice(0, 16);
        setConfirDatetime(localISOTime);
        
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
        <div style={{ position: 'relative' }}>
            {/* Cabecera */}
            <div style={{
                background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '16px', padding: '20px', marginBottom: '16px',
                backdropFilter: 'blur(10px)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                            padding: '8px', background: 'rgba(34,211,238,0.1)',
                            borderRadius: '10px', border: '1px solid rgba(34,211,238,0.2)'
                        }}>
                            <Timer size={20} style={{ color: '#22d3ee' }} />
                        </div>
                        <div>
                            <h3 style={{ color: '#f1f5f9', fontSize: '1rem', fontWeight: 900, margin: 0 }}>
                                Tránsito de Onda Positiva
                            </h3>
                            <p style={{ color: '#64748b', fontSize: '0.7rem', margin: 0 }}>
                                36km Río + 104km Canal | Q={qSolicitado} m³/s
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {diaLlenado > 0 && (
                            <span style={{
                                padding: '4px 10px', borderRadius: '8px', fontSize: '0.65rem',
                                fontWeight: 800, color: '#22d3ee',
                                background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.2)'
                            }}>
                                📅 Día {diaLlenado}
                            </span>
                        )}
                        <EstadoBadge estado={estadoGeneral} />
                    </div>
                </div>

                {/* Info de apertura */}
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    {horaApertura ? (
                        <>
                            <div style={{ padding: '8px 14px', background: 'rgba(16,185,129,0.1)', borderRadius: '8px', border: '1px solid rgba(16,185,129,0.2)' }}>
                                <div style={{ color: '#64748b', fontSize: '0.55rem', fontWeight: 700 }}>APERTURA</div>
                                <div style={{ color: '#10b981', fontSize: '0.85rem', fontWeight: 900 }}>{formatHora(horaApertura)}</div>
                            </div>
                            <div style={{ padding: '8px 14px', background: 'rgba(59,130,246,0.1)', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.2)' }}>
                                <div style={{ color: '#64748b', fontSize: '0.55rem', fontWeight: 700 }}>TRANSCURRIDO</div>
                                <div style={{ color: '#60a5fa', fontSize: '0.85rem', fontWeight: 900, fontFamily: 'monospace' }}>
                                    {formatCountdown(tiempoTranscurrido)}
                                </div>
                            </div>
                            <div style={{ padding: '8px 14px', background: 'rgba(34,211,238,0.1)', borderRadius: '8px', border: '1px solid rgba(34,211,238,0.2)' }}>
                                <div style={{ color: '#64748b', fontSize: '0.55rem', fontWeight: 700 }}>PROGRESO</div>
                                <div style={{ color: '#22d3ee', fontSize: '0.85rem', fontWeight: 900 }}>{confirmados}/{total}</div>
                            </div>
                        </>
                    ) : (
                        <button
                            onClick={onConfirmarApertura}
                            style={{
                                padding: '12px 24px', border: 'none', borderRadius: '10px',
                                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                                color: '#0f172a', fontWeight: 900, fontSize: '0.8rem',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
                                textTransform: 'uppercase', letterSpacing: '0.05em',
                                boxShadow: '0 4px 15px rgba(245,158,11,0.3)',
                                animation: 'pulse 2s infinite'
                            }}>
                            <AlertTriangle size={16} />
                            Confirmar Hora de Apertura de Obra de Toma
                        </button>
                    )}
                </div>
            </div>

            {/* Grid de puntos */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '12px'
            }}>
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
                        <p style={{ color: '#94a3b8', fontSize: '0.75rem', marginBottom: '20px' }}>
                            {selectedPunto.punto_nombre} — KM {selectedPunto.km}
                        </p>

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
