import React, { useEffect, useState } from 'react';
import { CheckCircle2, ArrowRight, Droplets, AlertTriangle, Shield, TrendingUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';

interface TransicionCondiciones {
    evento_id: string;
    puntos_totales: number;
    puntos_confirmados: number;
    puntos_estabilizados: number;
    nivel_promedio_m: number | null;
    gasto_promedio_m3s: number | null;
    gasto_solicitado_m3s: number | null;
    todos_confirmados: boolean;
    gasto_dentro_tolerancia: boolean;
    dia_llenado: number;
}

interface Props {
    eventoId: string;
    onTransicionCompletada: () => void;
}

const TransicionProtocolo: React.FC<Props> = ({ eventoId, onTransicionCompletada }) => {
    const [condiciones, setCondiciones] = useState<TransicionCondiciones | null>(null);
    const [loading, setLoading] = useState(true);
    const [transitioning, setTransitioning] = useState(false);
    const [motivoTransicion, setMotivoTransicion] = useState('');

    useEffect(() => {
        fetchCondiciones();
        const interval = setInterval(fetchCondiciones, 30000); // Refrescar cada 30s
        return () => clearInterval(interval);
    }, [eventoId]);

    const fetchCondiciones = async () => {
        const { data, error } = await supabase
            .from('vw_condiciones_transicion')
            .select('*')
            .eq('evento_id', eventoId)
            .maybeSingle();

        if (error) {
            console.error('Error fetch condiciones:', error);
            setLoading(false);
            return;
        }
        setCondiciones(data);
        setLoading(false);
    };

    const ejecutarTransicion = async () => {
        if (!condiciones) return;
        setTransitioning(true);

        try {
            // 1. Obtener usuario
            const { data: userData } = await supabase.auth.getUser();

            // 2. Desactivar el evento LLENADO actual
            await supabase
                .from('sica_eventos_log')
                .update({ esta_activo: false })
                .eq('id', eventoId);

            // 3. Crear nuevo evento ESTABILIZACIÓN
            const { data: nuevoEvento, error: insertErr } = await supabase
                .from('sica_eventos_log')
                .insert({
                    evento_tipo: 'ESTABILIZACION',
                    notas: `Transición desde Llenado (Día ${condiciones.dia_llenado}). ${motivoTransicion}`,
                    esta_activo: true,
                    autorizado_por: userData?.user?.id || null,
                    gasto_solicitado_m3s: condiciones.gasto_solicitado_m3s
                })
                .select()
                .single();

            if (insertErr) throw insertErr;

            // 4. Registrar la transición
            await supabase
                .from('sica_transiciones_protocolo')
                .insert({
                    evento_origen_id: eventoId,
                    evento_destino_id: nuevoEvento.id,
                    tipo_origen: 'LLENADO',
                    tipo_destino: 'ESTABILIZACION',
                    autorizado_por: userData?.user?.id || null,
                    motivo: motivoTransicion || 'Llenado completado — Canal estabilizado',
                    puntos_confirmados: condiciones.puntos_confirmados,
                    puntos_totales: condiciones.puntos_totales,
                    gasto_promedio_m3s: condiciones.gasto_promedio_m3s,
                    nivel_promedio_m: condiciones.nivel_promedio_m,
                    criterios_cumplidos: {
                        todos_confirmados: condiciones.todos_confirmados,
                        gasto_dentro_tolerancia: condiciones.gasto_dentro_tolerancia,
                        dia_llenado: condiciones.dia_llenado
                    }
                });

            toast.success('✅ Transición LLENADO → ESTABILIZACIÓN completada');
            onTransicionCompletada();
        } catch (err: any) {
            console.error('Error en transición:', err);
            toast.error('Error: ' + err.message);
        } finally {
            setTransitioning(false);
        }
    };

    if (loading || !condiciones) return null;

    const { puntos_confirmados, puntos_totales, todos_confirmados, gasto_dentro_tolerancia, dia_llenado, gasto_promedio_m3s, nivel_promedio_m, gasto_solicitado_m3s } = condiciones;
    const progreso = puntos_totales > 0 ? (puntos_confirmados / puntos_totales) * 100 : 0;
    const readyForTransition = progreso >= 80; // Al menos 80% de puntos confirmados

    return (
        <div style={{
            background: readyForTransition
                ? 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(34,211,238,0.05))'
                : 'rgba(15,23,42,0.6)',
            border: `1px solid ${readyForTransition ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.06)'}`,
            borderRadius: '16px', padding: '20px', marginTop: '16px',
            transition: 'all 0.5s ease'
        }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 14px', borderRadius: '10px',
                        background: readyForTransition ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.1)',
                        border: `1px solid ${readyForTransition ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.2)'}`
                    }}>
                        <Shield size={16} style={{ color: readyForTransition ? '#10b981' : '#f59e0b' }} />
                        <span style={{
                            color: readyForTransition ? '#10b981' : '#f59e0b',
                            fontSize: '0.7rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em'
                        }}>
                            {readyForTransition ? 'Listo para Estabilización' : 'En Progreso'}
                        </span>
                    </div>
                </div>

                <span style={{
                    color: '#64748b', fontSize: '0.7rem', fontWeight: 700,
                    padding: '4px 10px', background: 'rgba(30,41,59,0.5)', borderRadius: '6px'
                }}>
                    📅 Día {dia_llenado} de Llenado
                </span>
            </div>

            {/* Criterios de Transición */}
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '10px', marginBottom: '16px'
            }}>
                {/* Criterio 1: Puntos confirmados */}
                <CriterioCard
                    icon={<CheckCircle2 size={16} />}
                    label="Puntos Confirmados"
                    value={`${puntos_confirmados}/${puntos_totales}`}
                    cumplido={todos_confirmados}
                    progreso={progreso}
                />

                {/* Criterio 2: Gasto dentro de tolerancia */}
                <CriterioCard
                    icon={<TrendingUp size={16} />}
                    label="Gasto vs Solicitado"
                    value={`${gasto_promedio_m3s?.toFixed(1) || '--'} / ${gasto_solicitado_m3s?.toFixed(0) || '--'} m³/s`}
                    cumplido={gasto_dentro_tolerancia}
                    detail="Tolerancia: ±10%"
                />

                {/* Criterio 3: Nivel promedio */}
                <CriterioCard
                    icon={<Droplets size={16} />}
                    label="Nivel Promedio"
                    value={nivel_promedio_m ? `${nivel_promedio_m.toFixed(2)} m` : 'Sin datos'}
                    cumplido={nivel_promedio_m != null && nivel_promedio_m > 0}
                />
            </div>

            {/* Barra de progreso global */}
            <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ color: '#94a3b8', fontSize: '0.65rem', fontWeight: 700 }}>
                        Progreso de Llenado
                    </span>
                    <span style={{ color: '#e2e8f0', fontSize: '0.65rem', fontWeight: 900 }}>
                        {progreso.toFixed(0)}%
                    </span>
                </div>
                <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', overflow: 'hidden' }}>
                    <div style={{
                        height: '100%', borderRadius: '10px',
                        background: readyForTransition
                            ? 'linear-gradient(90deg, #10b981, #22d3ee)'
                            : 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                        width: `${progreso}%`,
                        transition: 'width 0.5s ease'
                    }} />
                </div>
            </div>

            {/* Zona de Transición */}
            {readyForTransition && (
                <div style={{
                    padding: '16px', borderRadius: '12px',
                    background: 'rgba(16,185,129,0.05)',
                    border: '1px solid rgba(16,185,129,0.15)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        <ArrowRight size={16} style={{ color: '#22d3ee' }} />
                        <span style={{ color: '#f1f5f9', fontSize: '0.85rem', fontWeight: 800 }}>
                            Transición a Estabilización
                        </span>
                    </div>

                    <p style={{ color: '#94a3b8', fontSize: '0.75rem', marginBottom: '12px', lineHeight: 1.5 }}>
                        El canal ha alcanzado cobertura suficiente. Al confirmar, el protocolo cambiará 
                        a <strong style={{ color: '#10b981' }}>ESTABILIZACIÓN</strong> y se activará el monitoreo 
                        de flujo permanente y distribución a tomas.
                    </p>

                    <div style={{ display: 'flex', gap: '8px', padding: '10px 12px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: '10px', marginBottom: '12px' }}>
                        <Shield size={14} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
                        <div>
                            <p style={{ color: '#fca5a5', fontSize: '0.65rem', fontWeight: 800, margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Cambio de Mando (Gerencia SRL)
                            </p>
                            <p style={{ color: '#94a3b8', fontSize: '0.6rem', margin: 0, lineHeight: 1.4 }}>
                                La transición de protocolo quedará auditada permanentemente bajo su usuario como responsable operativo.
                            </p>
                        </div>
                    </div>

                    <textarea
                        value={motivoTransicion}
                        onChange={e => setMotivoTransicion(e.target.value)}
                        placeholder="Motivo de la transición (opcional)..."
                        rows={2}
                        style={{
                            display: 'block', width: '100%', marginBottom: '12px', padding: '10px',
                            background: '#1e293b', border: '1px solid #334155', borderRadius: '8px',
                            color: '#f1f5f9', fontSize: '0.8rem', resize: 'none'
                        }}
                    />

                    <button
                        onClick={ejecutarTransicion}
                        disabled={transitioning}
                        style={{
                            width: '100%', padding: '14px', border: 'none', borderRadius: '12px',
                            background: 'linear-gradient(135deg, #10b981, #059669)',
                            color: 'white', fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                            textTransform: 'uppercase', letterSpacing: '0.06em',
                            opacity: transitioning ? 0.6 : 1,
                            boxShadow: '0 4px 15px rgba(16,185,129,0.3)'
                        }}
                    >
                        <Droplets size={18} />
                        {transitioning ? '⏳ Procesando Transición...' : '⚡ Activar Protocolo de Estabilización'}
                    </button>
                </div>
            )}

            {!readyForTransition && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '10px 14px', borderRadius: '8px',
                    background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.1)'
                }}>
                    <AlertTriangle size={14} style={{ color: '#f59e0b', flexShrink: 0 }} />
                    <span style={{ color: '#f59e0b', fontSize: '0.7rem', fontWeight: 600 }}>
                        Confirme al menos el 80% de los puntos de control para habilitar la transición a Estabilización.
                    </span>
                </div>
            )}
        </div>
    );
};

// === Sub-componente: Card de Criterio ===
const CriterioCard: React.FC<{
    icon: React.ReactNode;
    label: string;
    value: string;
    cumplido: boolean;
    progreso?: number;
    detail?: string;
}> = ({ icon, label, value, cumplido, progreso, detail }) => (
    <div style={{
        padding: '12px', borderRadius: '10px',
        background: cumplido ? 'rgba(16,185,129,0.08)' : 'rgba(30,41,59,0.5)',
        border: `1px solid ${cumplido ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.06)'}`,
        transition: 'all 0.3s ease'
    }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <span style={{ color: cumplido ? '#10b981' : '#64748b' }}>{icon}</span>
            <span style={{ color: '#94a3b8', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {label}
            </span>
            <span style={{
                marginLeft: 'auto', width: '8px', height: '8px', borderRadius: '50%',
                background: cumplido ? '#10b981' : '#475569',
                boxShadow: cumplido ? '0 0 6px #10b981' : 'none'
            }} />
        </div>
        <div style={{ color: '#e2e8f0', fontSize: '0.9rem', fontWeight: 900 }}>{value}</div>
        {progreso !== undefined && (
            <div style={{ marginTop: '6px', height: '3px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{
                    height: '100%', borderRadius: '4px',
                    background: cumplido ? '#10b981' : '#3b82f6',
                    width: `${progreso}%`, transition: 'width 0.5s ease'
                }} />
            </div>
        )}
        {detail && (
            <div style={{ color: '#64748b', fontSize: '0.55rem', fontWeight: 600, marginTop: '4px' }}>{detail}</div>
        )}
    </div>
);

export default TransicionProtocolo;
