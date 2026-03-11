import React, { useEffect, useState } from 'react';
import { Droplets, Activity, AlertTriangle, CheckCircle2, Waves, LayoutDashboard } from 'lucide-react';
import { supabase } from '../lib/supabase';
import './LlenadoTracker.css'; // Reusing some base styles for consistency

interface TramoBalance {
    escala_inicio_nombre: string;
    escala_fin_nombre: string;
    km_inicio: number;
    km_fin: number;
    q_entrada_m3s: number;
    q_salida_m3s: number;
    q_extracciones_m3s: number;
    q_perdida_m3s: number;
    eficiencia_pct: number;
    estatus_hidraulico: string;
}

interface TomaActiva {
    id: string;
    punto_nombre: string;
    modulo_nombre: string;
    caudal_promedio_m3s: number;
}

const EstabilizacionTracker: React.FC = () => {
    const [tramos, setTramos] = useState<TramoBalance[]>([]);
    const [tomasActivas, setTomasActivas] = useState<TomaActiva[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        try {
            // 1. Fetch Balances por Tramo
            const { data: tramosData, error: tramosErr } = await supabase
                .from('dashboard_vulnerabilidad_fugas')
                .select('*')
                .order('km_inicio', { ascending: true });

            if (tramosErr) throw tramosErr;
            setTramos(tramosData || []);

            // 2. Fetch Tomas Activas (Reportes Diarios en curso)
            // Obtener la fecha local (America/Chihuahua)
            const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chihuahua' });

            const { data: tomasData, error: tomasErr } = await supabase
                .from('reportes_operacion')
                .select(`
                    id, 
                    punto_id, 
                    caudal_promedio,
                    puntos_entrega!inner ( nombre, modulo_id )
                `)
                .eq('fecha', today)
                .not('estado', 'in', '("cierre", "suspension")');

            if (tomasErr) throw tomasErr;

            const tomasActivasList: TomaActiva[] = (tomasData || []).map((r: any) => ({
                id: r.punto_id,
                punto_nombre: r.puntos_entrega?.nombre || r.punto_id,
                modulo_nombre: 'MOD-' + (r.puntos_entrega?.modulo_id || 'GENERAL'),
                caudal_promedio_m3s: parseFloat(r.caudal_promedio || 0)
            }));
            
            tomasActivasList.sort((a, b) => a.modulo_nombre.localeCompare(b.modulo_nombre));
            
            setTomasActivas(tomasActivasList);

        } catch (error) {
            console.error('Error fetching estabilizacion data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 30000); // 30s refresh
        return () => clearInterval(interval);
    }, []);

    const totalDistribuido = tomasActivas.reduce((acc, t) => acc + (t.caudal_promedio_m3s || 0), 0);
    const totalConducido = tramos.length > 0 ? tramos[0].q_entrada_m3s : 0; // Gasto en inicio del canal principal
    const totalPerdidas = tramos.reduce((acc, t) => acc + (t.q_perdida_m3s > 0 ? t.q_perdida_m3s : 0), 0);
    
    // Calcular eficiencia global
    const eficienciaGlobal = totalConducido > 0 
        ? ((totalConducido - totalPerdidas) / totalConducido * 100).toFixed(1) 
        : '0.0';

    if (loading) {
        return <div style={{ color: '#94a3b8', padding: '20px', textAlign: 'center' }}>Cargando telemetría de distribución...</div>;
    }

    return (
        <div style={{ background: '#0f172a', borderRadius: '16px', border: '1px solid rgba(16,185,129,0.3)', overflow: 'hidden' }}>
            {/* Header del Tracker */}
            <div style={{ padding: '20px', background: 'linear-gradient(90deg, rgba(16,185,129,0.1) 0%, rgba(15,23,42,0) 100%)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <div style={{ background: 'rgba(16,185,129,0.2)', padding: '6px', borderRadius: '8px' }}>
                            <Droplets size={20} style={{ color: '#10b981' }} />
                        </div>
                        <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.25rem', fontWeight: 900 }}>Monitor de Distribución</h2>
                    </div>
                    <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.8rem' }}>Control de eficiencia y flujo permanente</p>
                </div>
                
                {/* Global Metrics */}
                <div style={{ display: 'flex', gap: '16px' }}>
                    <MetricBox title="Eficiencia Global" value={`${eficienciaGlobal}%`} icon={<Activity size={16} />} color="#10b981" />
                    <MetricBox title="Gasto Derivado" value={`${totalDistribuido.toFixed(2)} m³/s`} icon={<LayoutDashboard size={16} />} color="#3b82f6" />
                    <MetricBox title="Pérdidas Totales" value={`${totalPerdidas.toFixed(2)} m³/s`} icon={<AlertTriangle size={16} />} color="#ef4444" />
                </div>
            </div>

            <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '20px' }}>
                
                {/* SECCIÓN A: SEGMENTOS DE CANAL */}
                <div style={{ background: 'rgba(30,41,59,0.5)', borderRadius: '12px', padding: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <h3 style={{ margin: '0 0 16px', color: '#e2e8f0', fontSize: '0.95rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Waves size={18} style={{ color: '#3b82f6' }} /> Balance Hídrico por Tramo
                    </h3>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {tramos.map((tramo, idx) => {
                            const isCritico = tramo.estatus_hidraulico.includes('CRÍTICA');
                            const isAdvertencia = tramo.estatus_hidraulico.includes('PREVENTIVA');
                            const statusColor = isCritico ? '#ef4444' : isAdvertencia ? '#f59e0b' : '#10b981';

                            return (
                                <div key={idx} style={{ 
                                    background: `rgba(${isCritico ? '239,68,68' : isAdvertencia ? '245,158,11' : '16,185,129'}, 0.05)`, 
                                    border: `1px solid ${statusColor}40`, 
                                    borderRadius: '10px', padding: '12px',
                                    position: 'relative', overflow: 'hidden'
                                }}>
                                    {/* Indicador de estado lateral */}
                                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px', background: statusColor }} />
                                    
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', paddingLeft: '8px' }}>
                                        <div style={{ color: '#f8fafc', fontSize: '0.85rem', fontWeight: 700 }}>
                                            {tramo.escala_inicio_nombre} → {tramo.escala_fin_nombre}
                                        </div>
                                        <div style={{ color: statusColor, fontSize: '0.75rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            {isCritico ? <AlertTriangle size={12} /> : isAdvertencia ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                                            {tramo.eficiencia_pct.toFixed(1)}% Efi.
                                        </div>
                                    </div>
                                    
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', paddingLeft: '8px' }}>
                                        <MiniStat label="Entrada" value={`${tramo.q_entrada_m3s.toFixed(2)}`} color="#94a3b8" />
                                        <MiniStat label="Salida" value={`${tramo.q_salida_m3s.toFixed(2)}`} color="#94a3b8" />
                                        <MiniStat label="Tomas" value={`${tramo.q_extracciones_m3s.toFixed(2)}`} color="#3b82f6" />
                                        <MiniStat label="Pérdida" value={`${tramo.q_perdida_m3s > 0 ? tramo.q_perdida_m3s.toFixed(2) : '0.00'}`} color={tramo.q_perdida_m3s > 0 ? '#fca5a5' : '#94a3b8'} />
                                    </div>
                                    
                                    {isCritico && (
                                        <div style={{ marginTop: '8px', paddingLeft: '8px', fontSize: '0.7rem', color: '#fca5a5', fontStyle: 'italic' }}>
                                            ⚠️ Pérdida mayor al 10%. Posible toma clandestina o falla en aforo.
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {tramos.length === 0 && <div style={{ color: '#64748b', fontSize: '0.8rem' }}>No hay tramos configurados.</div>}
                    </div>
                </div>

                {/* SECCIÓN B: TOMAS ACTIVAS */}
                <div style={{ background: 'rgba(30,41,59,0.5)', borderRadius: '12px', padding: '16px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ margin: '0 0 16px', color: '#e2e8f0', fontSize: '0.95rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <LayoutDashboard size={18} style={{ color: '#8b5cf6' }} /> Tomas Activas ({tomasActivas.length})
                    </h3>
                    
                    <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
                        {tomasActivas.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {tomasActivas.map(toma => (
                                    <div key={toma.id} style={{
                                        background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.05)',
                                        borderRadius: '8px', padding: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                    }}>
                                        <div>
                                            <div style={{ color: '#f1f5f9', fontSize: '0.8rem', fontWeight: 700 }}>{toma.punto_nombre}</div>
                                            <div style={{ color: '#94a3b8', fontSize: '0.7rem', textTransform: 'uppercase' }}>{toma.modulo_nombre}</div>
                                        </div>
                                        <div style={{ background: 'rgba(59,130,246,0.1)', color: '#60a5fa', padding: '4px 8px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 900 }}>
                                            {toma.caudal_promedio_m3s.toFixed(2)} <span style={{ fontSize: '0.65rem', color: '#475569' }}>m³/s</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '0.8rem' }}>
                                No hay entregas en curso registradas para hoy.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// Subcomponente de Métrica
const MetricBox: React.FC<{ title: string, value: string, icon: React.ReactNode, color: string }> = ({ title, value, icon, color }) => (
    <div style={{ background: 'rgba(15,23,42,0.5)', border: `1px solid ${color}30`, borderRadius: '10px', padding: '10px 16px', minWidth: '120px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <div style={{ color }}>{icon}</div>
            <span style={{ color: '#94a3b8', fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</span>
        </div>
        <div style={{ color: '#f8fafc', fontSize: '1.1rem', fontWeight: 900 }}>{value}</div>
    </div>
);

// Subcomponente de Mini-Estadística
const MiniStat: React.FC<{ label: string, value: string, color: string }> = ({ label, value, color }) => (
    <div>
        <div style={{ color: '#64748b', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: '2px' }}>{label}</div>
        <div style={{ color, fontSize: '0.85rem', fontWeight: 800 }}>{value}</div>
    </div>
);

export default EstabilizacionTracker;
