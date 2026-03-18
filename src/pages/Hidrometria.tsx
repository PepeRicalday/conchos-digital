import { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Upload, Download, AlertTriangle, Activity, Calendar, Plus, Save, TrendingUp, X, RefreshCw, ArrowLeft, ArrowRight, Droplet } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { calculateEfficiency, getEfficiencyStatus } from '../utils/hydraulics';
import KPICard from '../components/KPICard';
import ChartWidget from '../components/ChartWidget';
import { useHydraEngine } from '../hooks/useHydraEngine';
import { getStartOfWeek, getEndOfWeek } from '../utils/dateHelpers';
import './Hidrometria.css';

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="p-4 border border-slate-700 shadow-2xl rounded-xl bg-slate-950 min-w-[180px] z-50">
                <p className="font-black text-white text-[10px] uppercase tracking-[0.2em] mb-3 text-slate-400 border-b border-slate-800 pb-2">
                    MÓDULO {label}
                </p>
                {payload.map((entry: any, index: number) => {
                    const shortName = entry.name.replace('Caudal ', '');
                    return (
                        <div key={index} className="flex justify-between items-center gap-4 mb-2 last:mb-0">
                            <span className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: entry.color }}>
                                <span className="w-1.5 h-1.5 rounded-full shadow-[0_0_5px_currentColor]" style={{ backgroundColor: entry.color }}></span>
                                {shortName}
                            </span>
                            <span className="font-mono font-black text-white text-sm">
                                {entry.value} <span className="text-[9px] text-slate-500">m³/s</span>
                            </span>
                        </div>
                    );
                })}
            </div>
        );
    }
    return null;
};

const Hidrometria = () => {
    const { modules, loading: storeLoading } = useHydraEngine();
    const [entranceFlow, setEntranceFlow] = useState<number>(0);
    const [loadingEntrance, setLoadingEntrance] = useState(true);

    const [selectedDate, setSelectedDate] = useState(new Date());
    
    // Weekly Analysis State
    const [weeklyRequests, setWeeklyRequests] = useState<any[]>([]);
    const [weeklyDeliveries, setWeeklyDeliveries] = useState<any[]>([]);
    const [loadingWeekly, setLoadingWeekly] = useState(false);
    const [showRequestModal, setShowRequestModal] = useState(false);
    const [savingRequest, setSavingRequest] = useState(false);
    const [bulkValues, setBulkValues] = useState<Record<string, number>>({});

    const startOfWeek = useMemo(() => getStartOfWeek(selectedDate), [selectedDate]);
    const endOfWeek = useMemo(() => getEndOfWeek(selectedDate), [selectedDate]);

    useEffect(() => {
        fetchEntranceData();
    }, []);

    useEffect(() => {
        fetchWeeklyAnalysis();
    }, [startOfWeek]);

    async function fetchEntranceData() {
        setLoadingEntrance(true);
        try {
            const today = new Date().toISOString().split('T')[0];
            const [aforoRes, escalaRes] = await Promise.all([
                supabase.from('aforos')
                    .select('gasto_calculado_m3s')
                    .eq('punto_control_id', 'CANAL-000')
                    .eq('fecha', today)
                    .maybeSingle(),
                supabase.from('lecturas_escalas')
                    .select('gasto_calculado_m3s, escalas!inner(id)')
                    .eq('escalas.km', 0)
                    .order('creado_en', { ascending: false })
                    .limit(1)
                    .maybeSingle()
            ]);

            const flow = aforoRes.data?.gasto_calculado_m3s || escalaRes.data?.gasto_calculado_m3s || 0;
            setEntranceFlow(flow);
        } catch (error) {
            console.error("Error fetching entrance flow:", error);
        } finally {
            setLoadingEntrance(false);
        }
    }

    const fetchWeeklyAnalysis = async () => {
        setLoadingWeekly(true);
        try {
            const { data: requests } = await supabase
                .from('solicitudes_riego_semanal')
                .select('*')
                .eq('fecha_inicio', startOfWeek);

            const { data: deliveries } = await supabase
                .from('reportes_diarios')
                .select('modulo_id, volumen_total_mm3, fecha')
                .gte('fecha', startOfWeek)
                .lte('fecha', endOfWeek);

            const deliveryMap: Record<string, number> = {};
            const todayStr = new Date().toISOString().split('T')[0];
            
            deliveries?.forEach(d => {
                if (d.modulo_id && d.fecha !== todayStr) {
                    deliveryMap[d.modulo_id] = (deliveryMap[d.modulo_id] || 0) + (d.volumen_total_mm3 || 0);
                }
            });

            const initialBulk: Record<string, number> = {};
            // Convertir Volumen DB (Mm³) a Caudal (m³/s) para la visualización del usuario
            requests?.forEach(r => {
                const mm3 = r.volumen_solicitado_mm3 || 0;
                const flow = (mm3 * 1000000) / (7 * 24 * 3600);
                initialBulk[r.modulo_id] = Number(flow.toFixed(3));
            });
            
            setBulkValues(initialBulk);
            setWeeklyRequests(requests || []);
            setWeeklyDeliveries(Object.entries(deliveryMap).map(([id, vol]) => ({ modulo_id: id, volumen_entregado: vol })));
        } catch (error) {
            console.error("Error fetching weekly analysis:", error);
        } finally {
            setLoadingWeekly(false);
        }
    }

    const saveBulkRequests = async () => {
        setSavingRequest(true);
        try {
            const updates = Object.entries(bulkValues).map(([id, flow]) => {
                // Convertimos el Caudal del UI (m³/s) hacia Volumen requerido por DB (Mm³)
                const volMm3 = (flow * 7 * 24 * 3600) / 1000000;
                return {
                    modulo_id: id,
                    fecha_inicio: startOfWeek,
                    fecha_fin: endOfWeek,
                    volumen_solicitado_mm3: Number(volMm3.toFixed(6))
                };
            });

            if (updates.length === 0) {
                setShowRequestModal(false);
                return;
            }

            const { error } = await supabase
                .from('solicitudes_riego_semanal')
                .upsert(updates, { onConflict: 'modulo_id, fecha_inicio' });

            if (error) throw error;
            await fetchWeeklyAnalysis();
            setShowRequestModal(false);
        } catch (error) {
            console.error("Error saving bulk requests:", error);
        } finally {
            setSavingRequest(false);
        }
    };

    const changeWeek = (offset: number) => {
        const next = new Date(selectedDate);
        next.setDate(next.getDate() + (offset * 7));
        setSelectedDate(next);
    };

    const handleBulkChange = (id: string, val: string) => {
        setBulkValues(prev => ({ ...prev, [id]: parseFloat(val) || 0 }));
    };

    const { totalDeliveryFlow, seasonalVolume, totalAuthorizedVolume } = useMemo(() => {
        let flow = 0;
        let vol = 0;
        let auth = 0;
        modules.forEach(m => {
            flow += m.current_flow || 0;
            vol += m.accumulated_vol || 0;
            auth += m.authorized_vol || 0;
        });
        return { totalDeliveryFlow: flow, seasonalVolume: vol, totalAuthorizedVolume: auth };
    }, [modules]);

    const globalLossesFlow = Math.max(0, entranceFlow - totalDeliveryFlow);
    const efficiencyGlobal = entranceFlow > 0 ? (totalDeliveryFlow / entranceFlow) * 100 : 0;
    const cycleProgress = totalAuthorizedVolume > 0 ? (seasonalVolume / totalAuthorizedVolume) * 100 : 0;

    const balanceData = useMemo(() => modules.map(m => {
        const outFlow = m.current_flow || 0;
        const mockLossFactor = 1.05 + (m.short_code?.length || 5) % 3 * 0.05; 
        const inFlow = outFlow * mockLossFactor;
        const eff = calculateEfficiency(inFlow, outFlow);

        return {
            zone: m.short_code || m.name,
            volIn: Number(inFlow.toFixed(3)),
            volOut: Number(outFlow.toFixed(3)),
            efficiency: Number(eff.toFixed(1))
        };
    }), [modules]);

    if (storeLoading || loadingEntrance) return (
        <div className="flex-center" style={{ height: '80vh', flexDirection: 'column', gap: '2rem' }}>
            <div className="animate-spin-slow">
                <RefreshCw size={48} className="text-primary" />
            </div>
            <div className="text-center">
                <p className="text-gradient font-bold uppercase tracking-widest text-lg">Sincronizando Red Mayor</p>
                <p className="status-badge" style={{ marginTop: '0.5rem' }}>Conectando con Supabase & Aforadores...</p>
            </div>
        </div>
    );

    return (
        <div className="hidrometria-container p-6 animate-fade-in">
            <header className="page-header mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-2">
                    <h2 className="text-3xl font-black text-white flex items-center gap-3">
                        <Droplet className="text-primary" size={32} />
                        HIDROMETRÍA <span className="text-primary">&</span> EFICIENCIA
                    </h2>
                    <p className="text-slate-500 font-medium ml-1">Monitoreo Técnico y Auditoría de Distribución (Red Mayor)</p>
                </div>

                <div className="flex items-center gap-2 bg-slate-900/50 backdrop-blur-xl p-1.5 rounded-2xl border border-slate-800 shadow-xl">
                    <button onClick={() => changeWeek(-1)} className="p-3 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-all">
                        <ArrowLeft size={18} />
                    </button>
                    <div className="px-6 flex flex-col items-center">
                        <span className="text-[10px] text-primary font-black uppercase tracking-[0.2em]">Semana de Riego</span>
                        <span className="text-white font-bold text-sm font-mono">
                            {startOfWeek.split('-').slice(1).reverse().join('/')} — {endOfWeek.split('-').slice(1).reverse().join('/')}
                        </span>
                    </div>
                    <button onClick={() => changeWeek(1)} className="p-3 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-all">
                        <ArrowRight size={18} />
                    </button>
                </div>
            </header>

            <div className="hidro-grid grid grid-cols-12 gap-6">
                <section className="col-span-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <KPICard title="Gasto Entrada (K-0)" value={entranceFlow.toFixed(3)} unit="m³/s" color="blue" icon={Upload} />
                    <KPICard title="Entrega Total" value={totalDeliveryFlow.toFixed(3)} unit="m³/s" color="emerald" icon={Download} />
                    <KPICard title="Eficiencia Global" value={`${efficiencyGlobal.toFixed(1)}%`} color={efficiencyGlobal > 85 ? 'blue' : 'amber'} icon={Activity} />
                    <div className="glass-card flex flex-col justify-center items-center p-4 border-primary/20 hover:border-primary/50 transition-all cursor-pointer group" onClick={() => setShowRequestModal(true)}>
                        <Calendar className="text-primary mb-2 group-hover:scale-110 transition-transform" size={24} />
                        <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-2">Programación</span>
                        <button className="btn-tech active w-full">SOLICITUDES SEMANALES</button>
                    </div>
                </section>

                <div className="col-span-12 grid grid-cols-12 gap-6">
                    <ChartWidget title={`Distribución de Caudales: ${startOfWeek} al ${endOfWeek}`} className="col-span-12 lg:col-span-8 h-[450px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart 
                                data={modules.map(m => {
                                    const reqMm3 = weeklyRequests.find(r => r.modulo_id === m.id)?.volumen_solicitado_mm3 || 0;
                                    let delMm3 = weeklyDeliveries.find(d => d.modulo_id === m.id)?.volumen_entregado || 0;
                                    
                                    const todayStr = new Date().toISOString().split('T')[0];
                                    if (todayStr >= startOfWeek && todayStr <= endOfWeek) {
                                        delMm3 += m.daily_vol || 0;
                                    }

                                    // Hydro-Synchrony: Convert to Target Flow (m³/s)
                                    const secondsInWeek = 7 * 24 * 3600;
                                    const reqFlow = reqMm3 > 0 ? (reqMm3 * 1000000) / secondsInWeek : 0;
                                    
                                    const startOfWeekMs = new Date(startOfWeek + 'T00:00:00').getTime();
                                    const endOfWeekMs = new Date(endOfWeek + 'T23:59:59').getTime();
                                    const currentMs = Date.now();
                                    const isCurrentWeek = (currentMs >= startOfWeekMs && currentMs <= endOfWeekMs);
                                    
                                    let delFlow = 0;
                                    if (isCurrentWeek) {
                                        // Para el monitoreo operativo de la semana en curso, lo que importa es el CAUDAL INSTANTÁNEO REAL (m³/s)
                                        delFlow = m.current_flow || 0;
                                    } else if (currentMs > endOfWeekMs) {
                                        // Para semanas pasadas, obtener el Caudal Promedio (m³/s) basado en el volumen total entregado
                                        delFlow = delMm3 > 0 ? (delMm3 * 1000000) / secondsInWeek : 0;
                                    }

                                    return {
                                        name: m.short_code || m.name,
                                        solicitado: Number(reqFlow.toFixed(2)),
                                        entregado: Number(delFlow.toFixed(2))
                                    };
                                })}
                                margin={{ top: 20, right: 30, left: 10, bottom: 20 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                <XAxis dataKey="name" stroke="#64748b" fontSize={11} fontWeight="bold" />
                                <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `${v} m³/s`} />
                                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.02)' }} content={<CustomTooltip />} />
                                <Legend />
                                <Bar dataKey="solicitado" name="Caudal Programado" fill="#38bdf8" radius={[4, 4, 0, 0]} barSize={20} />
                                <Bar dataKey="entregado" name="Caudal Entregado" fill="#10b981" radius={[4, 4, 0, 0]} barSize={20} />
                            </BarChart>
                        </ResponsiveContainer>
                    </ChartWidget>

                    <div className="col-span-12 lg:col-span-4 glass-card p-6 flex flex-col h-[450px]">
                        <h3 className="text-white font-black text-[10px] uppercase tracking-[0.2em] mb-4 text-slate-500 italic">Desempeño Operativo del Sistema</h3>
                        <div className="flex-1 overflow-auto custom-scrollbar">
                            <table className="w-full text-left text-xs">
                                <thead className="text-slate-600 font-bold border-b border-slate-800">
                                    <tr>
                                        <th className="pb-3 px-2 text-left">Módulo</th>
                                        <th className="pb-3 px-2 text-right">Prog. (m³/s)</th>
                                        <th className="pb-3 px-2 text-right">Entr. (m³/s)</th>
                                        <th className="pb-3 px-2 text-right">Efic.</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/40">
                                    {modules.map(m => {
                                        const reqMm3 = weeklyRequests.find(r => r.modulo_id === m.id)?.volumen_solicitado_mm3 || 0;
                                        let delMm3 = weeklyDeliveries.find(d => d.modulo_id === m.id)?.volumen_entregado || 0;
                                        
                                        const todayStr = new Date().toISOString().split('T')[0];
                                        if (todayStr >= startOfWeek && todayStr <= endOfWeek) {
                                            delMm3 += m.daily_vol || 0;
                                        }
                                            
                                        // Hydro-Synchrony: Convert to Target Flow (m³/s)
                                        const secondsInWeek = 7 * 24 * 3600;
                                        const reqFlow = reqMm3 > 0 ? (reqMm3 * 1000000) / secondsInWeek : 0;
                                        
                                        const startOfWeekMs = new Date(startOfWeek + 'T00:00:00').getTime();
                                        const endOfWeekMs = new Date(endOfWeek + 'T23:59:59').getTime();
                                        const currentMs = Date.now();
                                        const isCurrentWeek = (currentMs >= startOfWeekMs && currentMs <= endOfWeekMs);
                                        
                                        let delFlow = 0;
                                        if (isCurrentWeek) {
                                            delFlow = m.current_flow || 0;
                                        } else if (currentMs > endOfWeekMs) {
                                            delFlow = delMm3 > 0 ? (delMm3 * 1000000) / secondsInWeek : 0;
                                        }

                                        const eff = reqFlow > 0 ? (delFlow / reqFlow) * 100 : 0;
                                        const status = getEfficiencyStatus(eff);
                                        return (
                                            <tr key={m.id} className="hover:bg-white/5 transition-colors group">
                                                <td className="py-4 px-2 font-black group-hover:text-primary transition-colors">{m.short_code}</td>
                                                <td className="py-4 px-2 text-right font-mono text-slate-400">{reqFlow.toFixed(3)}</td>
                                                <td className="py-4 px-2 text-right font-mono font-bold" style={{ color: status.color }}>{delFlow.toFixed(3)}</td>
                                                <td className="py-4 px-2 text-right">
                                                    <span className="font-black" style={{ color: status.color }}>{eff.toFixed(1)}%</span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            {/* Modal: Bulk Weekly Programming — Technical Capture */}
            {showRequestModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-fade-in">
                    <div className="glass-card shadow-2xl w-full max-w-4xl border-white/10" style={{ maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <header className="p-8 border-b border-white/5 flex justify-between items-start bg-gradient-to-br from-blue-900/20 to-transparent">
                            <div className="space-y-1">
                                <h3 className="text-2xl font-black text-white flex items-center gap-3">
                                    <Calendar className="text-primary" />
                                    PROGRAMACIÓN SEMANAL DE RIEGO
                                </h3>
                                <p className="text-slate-500 font-bold text-[10px] uppercase tracking-[0.3em] italic">Captura de Volúmenes por Asociación (Ciclo 2026)</p>
                            </div>
                            <button onClick={() => setShowRequestModal(false)} className="btn-tech hover:bg-red-500/20 hover:text-red-400 transition-all p-2">
                                <X size={20} />
                            </button>
                        </header>
                        
                        <div className="p-8 overflow-auto flex-1 custom-scrollbar">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {modules.map(m => {
                                    const flow = bulkValues[m.id] || 0;
                                    const volMm3 = (flow * 7 * 24 * 3600) / 1000000;
                                    return (
                                        <div key={m.id} className="p-5 bg-slate-900/50 rounded-2xl border border-white/5 hover:border-primary/30 transition-all">
                                            <div className="flex justify-between items-center mb-3">
                                                <span className="font-black text-white text-sm uppercase">{m.short_code}</span>
                                                <span className="text-[9px] text-slate-600 font-bold truncate max-w-[120px]">{m.name}</span>
                                            </div>
                                            <div className="relative mb-3">
                                                <input 
                                                    type="number" 
                                                    step="0.001"
                                                    placeholder="0.000"
                                                    className="w-full bg-slate-950 border border-white/10 rounded-xl p-3 text-white font-mono font-bold outline-none focus:border-primary/50 text-right pr-14 text-lg"
                                                    value={flow === 0 ? '' : flow}
                                                    onChange={(e) => handleBulkChange(m.id, e.target.value)}
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-primary font-black">m³/s</span>
                                            </div>
                                            <div className="flex justify-between items-center px-1">
                                                <span className="text-[9px] text-slate-500 uppercase font-bold tracking-tighter">Vol. Programado</span>
                                                <span className="text-xs font-mono font-bold text-slate-400">{volMm3.toFixed(3)} Mm³</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <footer className="p-8 border-t border-white/5 bg-slate-900/30 flex justify-between items-center">
                            <div className="flex items-center gap-4">
                                <div className="p-2 bg-slate-800 rounded-lg">
                                    <Calendar className="text-primary" size={20} />
                                </div>
                                <div className="text-xs">
                                    <p className="text-slate-500 font-bold uppercase tracking-widest text-[9px]">Semana en Edición</p>
                                    <p className="text-white font-black">{startOfWeek.split('-').reverse().join('/')} ➞ {endOfWeek.split('-').reverse().join('/')}</p>
                                </div>
                            </div>
                            <div className="flex gap-4">
                                <button onClick={() => setShowRequestModal(false)} className="btn-tech">CANCELAR</button>
                                <button 
                                    onClick={saveBulkRequests} 
                                    className="btn-tech active"
                                    disabled={savingRequest}
                                >
                                    {savingRequest ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
                                    GUARDAR PROGRAMACIÓN (TOTAL)
                                </button>
                            </div>
                        </footer>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Hidrometria;
