import React, { useState, useEffect, useMemo } from 'react';
import { 
  Waves, Settings, AlertTriangle, AlertOctagon, 
  Activity, Plus, Minus, Search, ChevronUp, Play, Pause, FileText
} from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';
import HydraAI from '../components/HydraAI';
import SimulationReport from '../components/SimulationReport';
import './ModelingDashboard.css';

// Logic for formatting Simulation Time
const formatSimTime = (minutes: number) => {
    const h = Math.floor(minutes / 60) % 24;
    const m = Math.floor(minutes % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

interface ControlPoint {
    id: string;
    nombre: string;
    km: number;
    pzas_radiales: number;
    ancho: number;
    latitud: number;
    longitud: number;
}

interface SimulatedPoint {
    id: string;
    nombre: string;
    km: number;
    h: number;
    y_up: number;
    y_down: number;
    q: number;
    status: 'ESTABLE' | 'TRANSICIÓN' | 'REMANSO';
    efficiency: number;
    travel_time: string;
    transit_time: number;
    volume: number;
    bordo_libre_max: number;
    y_base: number;
}

const ModelingDashboard: React.FC = () => {
    // Basic Data
    const [controlPoints, setControlPoints] = useState<ControlPoint[]>([]);
    
    // Simulations (Current Real State vs User Event)
    const [q_real, setQReal] = useState(62.4);
    const [q_sim, setQSim] = useState(62.4);
    const [activePointId, setActivePointId] = useState<string>('');
    
    // Real Data States
    const [realNetwork, setRealNetwork] = useState<Record<string, any>>({});
    const [simNetwork, setSimNetwork] = useState<Record<string, any>>({});
    
    // Timeline Propagating Simulation
    const [timeDelta, setTimeDelta] = useState(0); // Minutes from now
    const [simTime] = useState(new Date().getHours() * 60 + new Date().getMinutes());
    const [isPlaying, setIsPlaying] = useState(false);
    const [isRiverTransit, setIsRiverTransit] = useState(false);
    const [showReport, setShowReport] = useState(false);

    useEffect(() => {
        let timer: ReturnType<typeof setInterval>;
        if (isPlaying) {
            timer = setInterval(() => {
                setTimeDelta(prev => (prev >= 480 ? 0 : prev + 2)); // Advance 2 minutes per tick
            }, 100);
        }
        return () => clearInterval(timer);
    }, [isPlaying]);

    useEffect(() => {
        const fetchData = async () => {
            const { data } = await supabase
                .from('escalas')
                .select('id, nombre, km, pzas_radiales, ancho, latitud, longitud')
                .gt('pzas_radiales', 0)
                .order('km', { ascending: true });
            
            const today = new Date().toISOString().split('T')[0];
            const [ { data: summaryReadings }, { data: rawReadings } ] = await Promise.all([
                supabase.from('resumen_escalas_diario').select('escala_id, nivel_actual').gte('fecha', today).order('fecha', { ascending: false }),
                supabase.from('lecturas_escalas').select('escala_id, nivel_m').order('fecha', { ascending: false }).order('hora_lectura', { ascending: false }).limit(60)
            ]);

            if (data) {
                const cps = data;
                if (!cps.some((p: any) => p.km > 100)) {
                    cps.push({ id: 'k104', nombre: 'K-104', km: 104, pzas_radiales: 1, ancho: 10, latitud: 28, longitud: -105 });
                }
                setControlPoints(cps);

                const readingsMap = new Map();
                // Prefer raw readings (telemetry) over summary if available
                rawReadings?.forEach(r => {
                    if (!readingsMap.has(r.escala_id)) readingsMap.set(r.escala_id, r.nivel_m);
                });
                summaryReadings?.forEach(r => {
                    if (!readingsMap.has(r.escala_id)) readingsMap.set(r.escala_id, r.nivel_actual);
                });

                const base: Record<string, any> = {};
                cps.forEach((p: any) => {
                    const actualLevel = readingsMap.get(p.id);
                    const defaults = { 
                        h: 1.25, 
                        y_up: actualLevel ? parseFloat(actualLevel) : 2.20, 
                        y_down: 1.10 
                    };
                    
                    // Specific logical adjustments if no data
                    if (!actualLevel) {
                        if (p.km === 0) { defaults.h = 1.85; defaults.y_up = 2.40; defaults.y_down = 1.83; }
                        else if (p.km === 23) { defaults.h = 1.45; defaults.y_up = 2.10; defaults.y_down = 1.80; }
                    } else {
                        // Keep manual H if it exists or use default
                        if (p.km === 0) { defaults.h = 1.85; defaults.y_down = 1.83; }
                        else if (p.km === 23) { defaults.h = 1.45; defaults.y_down = 1.80; }
                    }
                    
                    base[p.id] = defaults;
                });
                setRealNetwork(base);
                setSimNetwork(JSON.parse(JSON.stringify(base)));
                setActivePointId(cps[0]?.id || '');
            }
        };
        fetchData();
    }, []);

    // HYDRAULIC ENGINE
    const calculateScenario = (q_in: number, network: Record<string, any>) => {
        let currentQ = q_in;
        let cumulativeTime = 0;
        const res: SimulatedPoint[] = [];
        const g = 9.81, cd = 0.70;

        controlPoints.forEach((cp, idx) => {
            const config = network[cp.id] || { h: 1.0, y_up: 2.0, y_down: 1.10 };
            const area = Math.max(0.01, cp.ancho * cp.pzas_radiales * config.h);
            
            // Backwater Calc - Basic undershot gate orifice logic
            const head_req = Math.pow(currentQ / (cd * area), 2) / (2 * g);
            const offset = config.y_down > config.h ? config.y_down : (config.h / 1.5);
            let y_up_sim = head_req + offset;
            
            // Critical Event Trigger: Prevent mathematical explosion but allow very high Tirante for visual alerts
            if (y_up_sim > 6.0) y_up_sim = 6.0;
            
            // Travel Calc
            const dist = idx === 0 ? cp.km : (cp.km - controlPoints[idx-1].km);
            const vel = currentQ / (cp.ancho * Math.max(0.1, y_up_sim));
            const transit = vel > 0 ? (dist / (vel * 3.6)) : 0;
            
            // Initial Offset for River Transit if active
            if (idx === 0 && isRiverTransit) {
                const q_val = Math.max(currentQ, 1);
                const v_rio = 0.5 * Math.pow(q_val, 0.4) + 0.5; // Formula from useLlenadoTracker
                const riverDelayHours = (36000 / v_rio) / 3600; // Corrected: meters / (m/s) = seconds -> hours
                cumulativeTime += riverDelayHours;
            }

            cumulativeTime += transit;
            
            const eff = Math.max(0.85, 1 - (dist * 0.0005));
            const vol = dist * 1000 * cp.ancho * y_up_sim;

            const bordo_libre = 3.2; // Max safely allowable level

            res.push({
                id: cp.id,
                nombre: cp.nombre,
                km: cp.km,
                h: config.h,
                y_up: y_up_sim,
                y_down: config.y_down,
                q: currentQ,
                status: y_up_sim > 3.0 ? 'REMANSO' : (y_up_sim < 1.0 ? 'TRANSICIÓN' : 'ESTABLE'),
                efficiency: eff,
                travel_time: formatSimTime(simTime + (cumulativeTime * 60)),
                transit_time: transit * 60, // mins
                volume: vol,
                bordo_libre_max: bordo_libre,
                y_base: realNetwork[cp.id]?.y_up || y_up_sim
            });
            currentQ = currentQ * eff;
        });
        return res;
    };

    const simResults = useMemo(() => calculateScenario(q_sim, simNetwork), [controlPoints, simNetwork, q_sim, simTime, isRiverTransit]);

    // CHART OPTIONS
    const getTelemetryOption = (color: string, data: number[]) => ({
        grid: { top: 15, bottom: 25, left: 35, right: 15 },
        xAxis: { type: 'category', data: ['01:00','05:00','09:00','13:00','17:00','21:00'], axisLabel: { color: '#64748b', fontSize: 9 }, axisLine: { lineStyle: { color: '#1e293b' } } },
        yAxis: { type: 'value', min: 0, max: 200, axisLabel: { color: '#64748b', fontSize: 9 }, splitLine: { lineStyle: { color: '#1e293b' } } },
        series: [{ data, type: 'line', smooth: true, symbol: 'none', areaStyle: { color: `${color}40` }, lineStyle: { color, width: 2 } }]
    });

    const getMapOption = () => {
        const nodes = controlPoints.map((cp, idx) => ({
            name: cp.nombre,
            value: [idx * 20, Math.sin(idx * 0.8) * 10 + 20], // Fake curve for abstract schematic map layout
            symbolSize: 14,
            itemStyle: { color: simResults.find(r=>r.id===cp.id)?.status === 'REMANSO' ? '#fbbf24' : '#2dd4bf' }
        }));
        return {
            tooltip: { formatter: '{b}' },
            grid: { top: 10, bottom: 15, left: 15, right: 15 },
            xAxis: { show: false, min: -10, max: 100 },
            yAxis: { show: false, min: 0, max: 40 },
            series: [
                {
                    type: 'graph',
                    coordinateSystem: 'cartesian2d',
                    symbol: 'circle',
                    edgeSymbol: ['none', 'arrow'],
                    edgeSymbolSize: 8,
                    itemStyle: { borderWidth: 4, borderColor: 'rgba(45, 212, 191, 0.3)' },
                    label: { show: true, position: 'top', color: '#94a3b8', fontSize: 10 },
                    lineStyle: { color: '#0ea5e9', width: 3, curveness: 0.2 },
                    data: nodes,
                    links: nodes.slice(0, -1).map((n, i) => ({ source: n.name, target: nodes[i+1].name }))
                }
            ]
        };
    };

    const getProfileOption = () => {
        const kms = simResults.map(r => r.km);
        const yUps = simResults.map(r => r.y_up);
        const freeboard = simResults.map(() => 3.2);

        // Core Mathematical Engine for Dynamic Time-Dependent Profile
        const smoothData = [];
        const floorData = [];
        const waveSpeedDownstreamKmH = 15; // Onda de crecida acelerada para visualización
        const waveSpeedUpstreamKmH = 10;   // Retorno de remanso rápido para demo
        
        const travelDistDownstream = (timeDelta / 60) * waveSpeedDownstreamKmH;
        let mainFlowRate = q_sim / q_real; // Ratio to scale base level
        const baseLevel = 1.0 + (mainFlowRate * 0.4); // Nivel base dinámico por Gasto

        for (let i = 0; i <= 104; i+=0.5) {
            let targetSteadyY = baseLevel;
            let currentTempY = baseLevel;
            
            // 1. M1 Backwater (Remanso aguas arriba)
            let nodeIdx = simResults.findIndex(r => r.km >= i);
            if (nodeIdx !== -1) {
                const cp = simResults[nodeIdx];
                const distUpstream = cp.km - i;
                if (distUpstream >= 0 && distUpstream < 45) { // Amplio rango visual M1
                    targetSteadyY = baseLevel + Math.max(0, cp.y_up - baseLevel) * Math.exp(-0.06 * distUpstream);
                }
            }

            // 2. M2 Drawdown (Caída de agua justo después de la represa K)
            for (let j = simResults.length - 1; j >= 0; j--) {
                if (simResults[j].km < i) {
                    const distDown = i - simResults[j].km;
                    if (distDown > 0 && distDown < 15 && simResults[j].y_up > 2.5) {
                        // Genera un valle visual después de la compuerta restringida
                        targetSteadyY -= 0.5 * Math.exp(-0.25 * distDown); 
                    }
                    break;
                }
            }
            
            // 3. Apply Time Interruption (Propagación del evento con el slider)
            if (timeDelta < 480) { 
                if (travelDistDownstream < i) {
                    // Frente de onda no ha llegado -> Canal base, pero sin el nuevo flujo extra
                    currentTempY = 1.0; 
                } else {
                    // Pico del frente de ola (Surge front)
                    let surgeBonus = 0;
                    if (i > travelDistDownstream - 5) {
                        surgeBonus = Math.sin(((travelDistDownstream - i)/5) * Math.PI) * 0.2;
                    }

                    const distToNext = (simResults[nodeIdx]?.km || 104) - i;
                    const backwaterTravelDist = (timeDelta / 60) * waveSpeedUpstreamKmH;
                    if (distToNext > backwaterTravelDist && targetSteadyY > baseLevel) {
                        currentTempY = baseLevel + surgeBonus; // Sin remanso aún
                    } else {
                        currentTempY = targetSteadyY + surgeBonus; // Remanso activo
                    }
                }
            } else {
                currentTempY = targetSteadyY; // Estado Estacionario Final
            }
            
            smoothData.push([i, Math.max(0.1, currentTempY)]);
            floorData.push([i, 0]); // Suelo rígido
        }

        const gradientBlue = { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(14, 165, 233, 0.7)' }, { offset: 1, color: 'rgba(14, 165, 233, 0.05)' }] };
        const gradientRed = { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(239, 68, 68, 0.8)' }, { offset: 1, color: 'rgba(239, 68, 68, 0.1)' }] };

        return {
            grid: { top: 20, bottom: 25, left: 35, right: 20 },
            tooltip: { trigger: 'axis', backgroundColor: 'rgba(15, 23, 42, 0.9)', borderColor: '#334155', textStyle: { color: '#f8fafc' }, formatter: (p: any) => `KM ${p[0].value[0]}<br/><strong style="color:#38bdf8">Tirante: ${p[1].value[1].toFixed(2)}m</strong>` },
            legend: { show: true, top: 0, right: 0, icon: 'circle', textStyle: { color: '#94a3b8', fontSize: 10 } },
            xAxis: { type: 'value', name: 'Canal (Toma)', nameLocation: 'middle', nameGap: 20, nameTextStyle: { color: '#64748b' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.02)' } }, axisLabel: { formatter: 'Km {value}', color: '#94a3b8' } },
            yAxis: { type: 'value', name: 'Tirante (m)', nameTextStyle: { color: '#64748b' }, max: 5.0, splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } }, axisLabel: { color: '#94a3b8' } },
            series: [
                { name: 'Fondo del Canal', type: 'line', data: floorData, lineStyle: { color: '#0f172a', width: 4 }, areaStyle: { color: '#020b14' }, showSymbol: false, zlevel: 0 },
                { name: 'Onda Dinámica Proyectada', type: 'line', data: smoothData, smooth: true, animationDuration: 300, lineStyle: { color: '#0ea5e9', width: 4, shadowColor: 'rgba(14, 165, 233, 0.5)', shadowBlur: 10 }, areaStyle: { color: gradientBlue }, showSymbol: false, zlevel: 1 },
                { name: 'Bordo Libre (Peligro)', type: 'line', data: freeboard.map((v,i) => [kms[i], v]), lineStyle: { color: '#ef4444', width: 2, type: 'dashed' }, showSymbol: false, zlevel: 2 },
                { name: 'Nivel en Represa', type: 'scatter', data: kms.map((k,i) => {
                     let fillHeight = baseLevel;
                     if ((timeDelta / 60) * waveSpeedDownstreamKmH >= k || timeDelta >= 480) { fillHeight = yUps[i]; }
                     return [k, fillHeight];
                }), symbolSize: 18, itemStyle: { color: '#fbbf24', shadowColor: 'rgba(251, 191, 36, 0.8)', shadowBlur: 15, borderColor: '#0f172a', borderWidth: 3 }, zlevel: 3 },
                // Add red visual warning areas for overflowing peaks automatically
                { name: 'Alerta Desborde', type: 'line', data: smoothData.map(p => p[1] > 3.2 ? p : [p[0], 0]), smooth: true, lineStyle: { width: 0 }, areaStyle: { color: gradientRed }, showSymbol: false, zlevel: 2 }
            ]
        };
    };

    return (
        <div className="hydra-engine-container">
            <header className="he-header">
                <div className="he-title">
                    <Waves size={24} className="text-teal" />
                    SICA 005 | HYDRA ENGINE <span className="he-title-sub">- MÓDULO DE SIMULACIÓN HIDRODINÁMICA AVANZADA (CANAL PRINCIPAL CONCHOS)</span>
                </div>
                <Settings size={20} className="text-sky cursor-pointer hover:text-white" />
            </header>

            <main className="he-grid">
               {/* LEFT COLUMN: INPUTS */}
               <section className="he-panel">
                 <div className="he-panel-header">
                    <span>Parámetros de Entrada (Inputs)</span>
                    <ChevronUp size={14} className="text-slate-500" />
                 </div>
                 <div className="he-panel-content no-pad">
                    
                    <div className="p-3">
                        <div className="he-sub-panel">
                            <div className="he-sub-header">
                                <span>TELEMETRÍA TIEMPO REAL (NIVELES)</span>
                                <ChevronUp size={12} className="text-slate-500" />
                            </div>
                            <div className="p-2">
                                <div className="text-[0.6rem] text-sky font-bold mb-1">K-23 Gasto Entrada</div>
                                <div className="chart-container-small">
                                    <ReactECharts option={getTelemetryOption('#0ea5e9', [50, 60, 120, 140, 100, 80])} style={{height: '100%', width: '100%'}} />
                                </div>
                                <div className="text-[0.6rem] text-sky font-bold mb-1 mt-2">K-94 Gasto Salida</div>
                                <div className="chart-container-small">
                                    <ReactECharts option={getTelemetryOption('#10b981', [40, 45, 110, 105, 80, 60])} style={{height: '100%', width: '100%'}} />
                                </div>
                            </div>
                        </div>

                        <div className="he-sub-panel mt-4 border-sky-900/50">
                            <div className="he-sub-header bg-sky-900/20 text-sky-300">
                                <span>SIMULACIÓN DESDE PRESA (EXTRACCIÓN)</span>
                                <ChevronUp size={12} className="text-sky-500" />
                            </div>
                            <div className="p-3">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-sky font-bold text-[0.65rem]">Gasto de Extracción (Obras Toma)</span>
                                    <span className="text-[0.8rem] text-amber-400 font-mono font-bold">{q_sim.toFixed(1)} m³/s</span>
                                </div>
                                <input 
                                    type="range" min="0" max="100" step="0.5" 
                                    value={q_sim} 
                                    onChange={e => {setQSim(parseFloat(e.target.value)); setQReal(parseFloat(e.target.value));}} 
                                    className="he-slider m-0 w-full mb-3 shadow-[0_0_10px_rgba(245,158,11,0.2)]" 
                                />
                                <div className="flex items-center justify-between mb-4 bg-amber-500/10 p-2 rounded border border-amber-500/20">
                                    <div className="flex items-center gap-2">
                                        <input 
                                            type="checkbox" 
                                            id="riverToggle"
                                            checked={isRiverTransit}
                                            onChange={() => setIsRiverTransit(!isRiverTransit)}
                                            className="w-4 h-4 accent-amber-500 cursor-pointer"
                                        />
                                        <label htmlFor="riverToggle" className="text-[0.6rem] text-amber-200 font-bold uppercase cursor-pointer">
                                            Tránsito de Río (36km)
                                        </label>
                                    </div>
                                    {isRiverTransit && (
                                        <div className="text-[0.6rem] text-amber-500 font-mono font-bold animate-pulse">
                                            + {((36000 / (0.5 * Math.pow(Math.max(q_sim, 1), 0.4) + 0.5)) / 60).toFixed(0)} min lag
                                        </div>
                                    )}
                                </div>
                                
                                {/* Statistical Impact Calculation for Dam Routing */}
                                <div className="bg-[#020b14]/80 p-2.5 rounded text-[0.65rem] border border-cyan-900/50 space-y-1.5 shadow-inner">
                                    <div className="text-slate-500 font-bold mb-1 uppercase text-[0.55rem]">Predicción Estadística (Presa La Boquilla)</div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-slate-400">Desfogue Diario:</span>
                                        <span className="font-mono font-bold text-sky-400">{(q_sim * 0.0864).toFixed(3)} Mm³</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-slate-400">Volumen Extraído (30 Días):</span>
                                        <span className="font-mono font-bold text-amber-500">{(q_sim * 0.0864 * 30).toFixed(2)} Mm³</span>
                                    </div>
                                    <div className="flex justify-between items-center border-t border-slate-700/50 mt-1 pt-1.5">
                                        <span className="text-slate-400">Caída de Elevación (30d):</span>
                                        <span className="font-mono font-bold text-red-400">- {((q_sim * 0.0864 * 30) / 110).toFixed(2)} m</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div className="he-sub-panel mt-4 border-teal-900">
                            <div className="he-sub-header bg-teal-900/20 text-teal-200">
                                <span>ESTADO DE ESTRUCTURAS - CONTROL</span>
                            </div>
                            <div className="p-3">
                                <div className="flex gap-2 w-full overflow-x-auto custom-scroll pb-2">
                                    {controlPoints.map(cp => (
                                        <button 
                                            key={cp.id}
                                            onClick={() => setActivePointId(cp.id)}
                                            className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap border transition-all
                                              ${activePointId === cp.id ? 'bg-sky-600 border-sky-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}
                                        >
                                            {cp.nombre}
                                        </button>
                                    ))}
                                </div>
                                {activePointId && simNetwork[activePointId] && (() => {
                                    const rs = simResults.find(r => r.id === activePointId);
                                    if (!rs) return null;
                                    const baseNode = realNetwork[activePointId];
                                    const remansoSize = rs.y_up - baseNode.y_up;
                                    const nodeIdx = simResults.findIndex(r => r.id === activePointId);
                                    const nextNode = simResults[nodeIdx + 1];
                                    
                                    // Cálculo de Retardo de Onda de Vaciado Aguas Abajo (Velocidad onda ~ 15km/h)
                                    const distToNext = nextNode ? nextNode.km - rs.km : 0;
                                    const delayMinutes = distToNext > 0 ? (distToNext / 15) * 60 : 0;

                                    return (
                                        <div className="mt-3 bg-slate-900/50 p-3 rounded-md border border-slate-700 relative overflow-hidden">
                                            <div className="absolute top-0 right-0 w-16 h-16 opacity-[0.03] pointer-events-none text-teal-500"><Activity size={64}/></div>
                                            
                                            <div className="flex justify-between items-center mb-2 relative z-10">
                                                <span className="text-[0.65rem] text-sky font-bold">Apertura Radial (m)</span>
                                                <span className="text-[0.8rem] text-amber-400 font-mono font-bold">{simNetwork[activePointId].h.toFixed(2)}m</span>
                                            </div>
                                            <input 
                                                title="Apertura Radial"
                                                type="range" min="0" max="3" step="0.05" 
                                                value={simNetwork[activePointId].h} 
                                                onChange={e => setSimNetwork({...simNetwork, [activePointId]: {...simNetwork[activePointId], h: parseFloat(e.target.value)}})} 
                                                className="he-slider m-0 mb-3 relative z-10" 
                                            />

                                            {/* Advanced Operational Metrics */}
                                            <div className="bg-[#020b14]/80 p-2.5 rounded text-[0.65rem] border border-cyan-900/50 space-y-1.5 shadow-inner">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-slate-400">Nivel Equivalente (Escala):</span>
                                                    <span className={`font-mono font-bold text-sm ${rs.y_up > 3.2 ? 'text-red-400' : 'text-emerald-400'}`}>{rs.y_up.toFixed(2)} m</span>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-slate-400">M1 Remanso Calculado (Δ):</span>
                                                    <span className={`font-mono font-bold ${remansoSize > 0.1 ? 'text-amber-500' : 'text-sky-500'}`}>
                                                        {remansoSize > 0.05 ? `+${remansoSize.toFixed(2)} m` : `~0.00 m`}
                                                    </span>
                                                </div>
                                                
                                                {nextNode && (
                                                    <div className="flex justify-between items-center border-t border-slate-700/50 mt-1 pt-1.5">
                                                        <span className="text-slate-400">Impacto Gasto (Arribo en {nextNode.nombre}):</span>
                                                        <span className="font-mono font-bold text-sky-300">Aprox. en {delayMinutes.toFixed(0)} min</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>

                    </div>
                 </div>
               </section>

               {/* CENTER COLUMN: VISUALIZATION */}
               <section className="he-panel transparent">
                  <div className="flex flex-col h-full gap-4">
                      
                      <div className="he-sub-panel flex-[0.35] min-h-[140px]">
                          <div className="he-sub-header bg-[rgba(2,11,20,0.8)] border-b-cyan-900/50">
                             <div className="flex items-center gap-2 text-cyan-400 text-[0.6rem] tracking-[0.1em]">
                                 <Activity size={12} /> TELEMETRÍA POINTS (Radar level sensors RLS)
                             </div>
                             <div className="flex gap-2">
                                 <div className="bg-slate-800 p-1 rounded cursor-pointer hover:bg-slate-700"><Plus size={10} className="text-slate-300"/></div>
                                 <div className="bg-slate-800 p-1 rounded cursor-pointer hover:bg-slate-700"><Minus size={10} className="text-slate-300"/></div>
                                 <div className="bg-slate-800 p-1 rounded cursor-pointer hover:bg-slate-700"><Search size={10} className="text-slate-300"/></div>
                             </div>
                          </div>
                          <div className="flex-1 w-full relative">
                             <ReactECharts option={getMapOption()} style={{height: '100%', width: '100%'}} />
                          </div>
                      </div>

                      <div className="he-sub-panel flex-[3.0]">
                          <div className="he-sub-header bg-[rgba(2,11,20,0.8)] border-b-cyan-900/50">
                             <span className="text-[0.7rem] font-bold text-slate-200">PERFIL LONGITUDINAL DINÁMICO (SAINT-VENANT 1D)</span>
                             <div className="flex items-center gap-2">
                                 <Activity size={12} className={isPlaying ? "text-teal animate-pulse" : "text-slate-600"} />
                                 <span className={`text-[0.55rem] ${isPlaying ? 'text-teal/80' : 'text-slate-600'}`}>Solver Activo</span>
                             </div>
                          </div>
                          
                          {/* TIMELINE SLIDER ENLARGED CONTROLS */}
                          <div className="px-4 py-3 flex flex-col gap-3 bg-[#06192e]/80 border-b border-sky-900/50 shadow-inner">
                              <div className="flex flex-wrap justify-between items-center gap-2 text-[0.7rem]">
                                 <span className="text-slate-300 font-bold uppercase tracking-widest truncate mr-2">Proyección de Ondas de Retardo</span>
                                 <span className="text-amber-400 font-mono font-black tracking-widest bg-amber-500/10 px-3 py-1 rounded border border-amber-500/30 whitespace-nowrap">
                                     SIMULACIÓN: t + {timeDelta} min
                                 </span>
                              </div>
                              <div className="grid grid-cols-[auto_1fr] items-center gap-4 w-full">
                                 <button 
                                     onClick={() => setIsPlaying(!isPlaying)} 
                                     className={`p-2.5 rounded-full flex-shrink-0 transition-all ${isPlaying ? 'bg-amber-500 text-slate-900 shadow-[0_0_20px_rgba(245,158,11,0.6)]' : 'bg-slate-800 text-teal-400 border border-teal-500/30 hover:bg-slate-700 hover:text-white'}`}
                                 >
                                     {isPlaying ? <Pause size={18} fill="currentColor"/> : <Play size={18} fill="currentColor" />}
                                 </button>
                                 <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 w-full">
                                     <span className="text-[0.6rem] text-slate-500 font-bold w-[70px] text-right whitespace-nowrap">t=0 (Ahora)</span>
                                     <input 
                                        type="range" min="0" max="480" 
                                        value={timeDelta} 
                                        onChange={e => { setTimeDelta(parseInt(e.target.value)); setIsPlaying(false); }} 
                                        className="he-slider w-full m-0 h-3 accent-amber-500 outline-none" 
                                     />
                                     <span className="text-[0.6rem] text-slate-500 font-bold w-[70px] text-left whitespace-nowrap">t+480 (8h)</span>
                                 </div>
                              </div>
                          </div>

                          <div className="flex-1 w-full bg-[#020b14]/30 relative">
                             <ReactECharts option={getProfileOption()} style={{height: '100%', width: '100%'}} notMerge={true} />
                          </div>
                      </div>
                  </div>
               </section>

               {/* RIGHT COLUMN: OUTPUTS */}
               <section className="he-panel">
                 <div className="he-panel-header">
                    <span>Salidas y Análisis Predictivo (Outputs)</span>
                 </div>
                 <div className="he-panel-content">
                    
                    <div className="he-sub-panel max-h-[180px] flex flex-col shrink-0">
                        <div className="he-sub-header shrink-0"><span>MATRIZ DE TIEMPOS DE TRAVESÍA</span></div>
                        <div className="overflow-y-auto custom-scroll flex-1">
                            <table className="he-table w-full">
                                <thead className="sticky top-0 bg-[rgba(15,23,42,0.95)] z-10 shadow-sm">
                                    <tr><th>Km/Toma</th><th>T. Retardo (min)</th><th>Hora Llegada</th></tr>
                                </thead>
                                <tbody>
                                    {simResults.map(p => (
                                        <tr key={p.id}>
                                            <td>{p.nombre}</td>
                                            <td>{Math.round(p.transit_time)}</td>
                                            <td className="text-teal font-black">{p.travel_time}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="he-sub-panel border-emerald-900/30 shrink-0">
                        <div className="he-sub-header bg-emerald-900/20 text-emerald-300">
                            <span>BALANCE HIDRODINÁMICO GLOBAL (EC)</span>
                        </div>
                        {(() => {
                           const lastNode = simResults[simResults.length - 1];
                           const Vn_final = lastNode ? lastNode.q * lastNode.efficiency : 0;
                           const EC = q_sim > 0 ? (Vn_final / q_sim) * 100 : 0;
                           const perdidas_m3 = Math.max(0, q_sim - Vn_final);
                           
                           return (
                               <div className="p-3">
                                   <div className="flex justify-between items-center mb-1.5">
                                       <span className="text-[0.65rem] text-slate-400">Vb (Gasto Inicial Toma)</span>
                                       <span className="text-[0.75rem] font-bold text-sky-400">{q_sim.toFixed(2)} m³/s</span>
                                   </div>
                                   <div className="flex justify-between items-center mb-1.5">
                                       <span className="text-[0.65rem] text-slate-400">Vn (Gasto Final Red Mayor)</span>
                                       <span className="text-[0.75rem] font-bold text-teal-400">{Vn_final.toFixed(2)} m³/s</span>
                                   </div>
                                   <div className="flex justify-between items-center mb-3 border-b border-slate-700/50 pb-2">
                                       <span className="text-[0.65rem] text-slate-400">Pérdidas (Infiltración/ETo)</span>
                                       <span className="text-[0.75rem] font-bold text-amber-500">-{perdidas_m3.toFixed(2)} m³/s</span>
                                   </div>
                                   <div className="bg-[#020b14]/80 p-2 rounded flex flex-col items-center justify-center border border-emerald-900/30 shadow-inner">
                                       <span className="text-[0.55rem] text-emerald-500/80 uppercase tracking-widest mb-0.5">Eficiencia de Conducción</span>
                                       <div className="flex items-end gap-1">
                                           <span className={`text-2xl font-black font-mono ${EC >= 85 ? 'text-emerald-400' : 'text-amber-500'}`}>{EC.toFixed(1)}</span>
                                           <span className="text-sm text-slate-500 mb-1">%</span>
                                       </div>
                                       <span className="text-[0.55rem] text-slate-500 mt-1">Merma Diaria Proyectada: {(perdidas_m3 * 0.0864).toFixed(3)} Mm³</span>
                                   </div>
                               </div>
                           );
                        })()}
                    </div>

                    <div className={`he-sub-panel shrink-0 ${simResults.some(p => p.status === 'REMANSO') ? 'border-red-900/80 shadow-[0_0_15px_rgba(153,27,27,0.4)]' : ''}`}>
                        <div className={`he-sub-header ${simResults.some(p => p.status === 'REMANSO') ? 'bg-red-900/30 text-red-200' : ''}`}>
                            <span>ALERTAS DE CONTINGENCIA</span>
                            {simResults.some(p => p.status === 'REMANSO') && <AlertTriangle size={12} className="text-red-400" />}
                        </div>
                        <div className="p-3 pb-1">
                            {simResults.filter(p => p.status === 'REMANSO').map(p => (
                                <div key={p.id} className="he-alert-box critical">
                                    <AlertTriangle size={14} className="he-alert-icon" />
                                    <div className="he-alert-text">Riesgo Desbordamiento {p.nombre}</div>
                                </div>
                            ))}
                            {simResults.filter(p => p.status === 'TRANSICIÓN').map(p => (
                                <div key={p.id} className="he-alert-box">
                                    <AlertOctagon size={14} className="he-alert-icon" />
                                    <div className="he-alert-text">Toma Varada baja {p.nombre}</div>
                                </div>
                            ))}
                            {simResults.length > 0 && simResults.every(p => p.status === 'ESTABLE') && (
                                <div className="text-center text-emerald-500/70 font-bold text-xs py-4">SISTEMA HIDRÁULICO ESTABLE</div>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 flex flex-col justify-end mt-2">
                        <div className="text-[0.65rem] text-sky font-bold uppercase mb-2 px-1">RECOMENDACIÓN OPERATIVA SUGERIDA</div>
                        <div className="text-[0.7rem] text-slate-300 bg-[#06192e] p-3 rounded-md mb-3 border border-slate-700/50 leading-relaxed shadow-inner">
                            {simResults.some(p => p.status === 'REMANSO') 
                                ? `Ajustar compuertas radiales ${simResults.find(p => p.status === 'REMANSO')?.nombre || 'afectadas'} +15% apertura en 2.0h para mitigar pico M1.`
                                : "Sistema estable. Mantener algoritmo de extracción automático sin intervención."}
                        </div>
                        <button 
                            className="he-btn he-btn-primary"
                            onClick={() => {
                                toast.success("Maniobra de simulación enrutada a tableros PLC SCADA exitosamente.");
                                setRealNetwork(JSON.parse(JSON.stringify(simNetwork)));
                                setTimeout(() => {
                                    toast.info("El sistema hidráulico ha asimilado la nueva maniobra como su punto de equilibrio Base.");
                                }, 2500);
                            }}
                        >
                            APLICAR AJUSTES SICA 005
                        </button>
                        <button 
                            className="he-btn he-btn-secondary"
                            onClick={() => {
                                toast.info("Generando Documento Oficial: Orden de Trabajo Operativa...");
                                setTimeout(() => window.print(), 1200);
                            }}
                        >
                            GENERAR ORDEN DE TRABAJO
                        </button>

                        <button 
                             className="w-full mt-2 py-4 bg-emerald-600 rounded-xl font-black text-xs text-white uppercase tracking-widest shadow-lg shadow-emerald-500/20 hover:bg-emerald-500 transition-all active:scale-95"
                             onClick={() => setShowReport(true)}
                        >
                             <div className="flex items-center justify-center gap-2">
                                 <FileText size={16} />
                                 REPORTE OFICIAL PDF (D Twin)
                             </div>
                        </button>
                    </div>

                 </div>
               </section>
            </main>

            {/* AI Assistant Button & Window */}
            <HydraAI 
              onUpdateParams={({q, river}) => {
                if (q !== undefined) {
                  setQSim(q);
                  setQReal(q);
                }
                if (river !== undefined) {
                  setIsRiverTransit(river);
                }
              }}
              simData={simResults}
            />

            {showReport && (
              <SimulationReport 
                scenario={{
                  q_base: q_real,
                  q_sim: q_sim,
                  isRiver: isRiverTransit,
                  startTime: simTime,
                  date: new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })
                }}
                results={simResults}
                onClose={() => setShowReport(false)}
              />
            )}
        </div>
    );
};

export default ModelingDashboard;
