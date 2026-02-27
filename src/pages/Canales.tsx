import { useState, useMemo, useEffect } from 'react';
import { toDateString, isToday } from '../utils/dateHelpers';
import { calculateEfficiency } from '../utils/hydraulics';
import { X, Zap, Droplets, Calendar, ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import CanalSchematic from '../components/CanalSchematic';
import { useHydraEngine, type ModuleData } from '../hooks/useHydraEngine';
import EfficiencyGauge from '../components/EfficiencyGauge';
import AnomalyMatrix from '../components/AnomalyMatrix';
import OfflineIndicator from '../components/OfflineIndicator';
import { formatVol, defaultSections } from '../utils/uiHelpers';
import { ModuleCard, ModuleDetailModal } from '../components/ModuleCards';
import './Canales.css';

const Canales = () => {
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const { modules, loading, error } = useHydraEngine();

    const [viewingModule, setViewingModule] = useState<ModuleData | null>(null);
    const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
    const [activeSectionId, setActiveSectionId] = useState<string>('all');

    const handleDateChange = (days: number) => {
        const newDate = new Date(selectedDate);
        newDate.setDate(selectedDate.getDate() + days);
        setSelectedDate(newDate);
        setSelectedPointId(null);
    };

    // Live tick for "Dashboard Vivo" volume interpolation
    const [now, setNow] = useState<number>(Date.now());
    useEffect(() => {
        // Update every 3 seconds to keep UI alive without killing performance
        const interval = setInterval(() => setNow(Date.now()), 3000);
        return () => clearInterval(interval);
    }, []);

    // 1. Flatten Points and Filter by Date (Open and Captured)
    const allPoints = useMemo(() => {
        const dateString = toDateString(selectedDate);

        return modules.flatMap(m => m.delivery_points.map(p => {
            // Find measurement for selected date
            const medicionDate = p.mediciones?.find(med => med.fecha_hora.startsWith(dateString));
            const isCaptured = !!medicionDate;
            const currentQDate = isCaptured ? Number(medicionDate.valor_q) : 0;
            const isOpenDate = currentQDate > 0;

            // Dashboard Vivo Interpolation
            const isTodaySelected = isToday(selectedDate);
            const elapsedSeconds = p.last_update_time ? Math.max(0, (now - new Date(p.last_update_time).getTime()) / 1000) : 0;
            const interpolatedVol = (isTodaySelected && isOpenDate) ? (currentQDate * elapsedSeconds) / 1000000 : 0;

            return {
                ...p,
                flow: currentQDate,
                current_q: currentQDate,
                current_q_lps: currentQDate * 1000,
                daily_vol: (p.daily_vol || 0) + interpolatedVol,
                accumulated: (p.accumulated || 0) + interpolatedVol,
                moduleId: m.id,
                moduleName: m.name,
                isOpen: isOpenDate,
                isCaptured: isCaptured,
                schedule: undefined
            };
        }));
        // All points kept so sections don't disappear. Real filter for schematic is in filteredPoints (L72).
    }, [modules, selectedDate]);

    // Apply the strict filter requested by user for the points to show in schematic
    const filteredPoints = useMemo(() => {
        return allPoints.filter(p => p.type !== 'toma' || (p.isCaptured && p.isOpen));
    }, [allPoints]);

    // 2. Extract Sections (Hybrid: Dynamic + Static Fallback) - Always use allPoints to keep the tabs!
    const sections = useMemo(() => {
        const dynamicSections = Array.from(new Set(allPoints.map(p => JSON.stringify(p.section_data)).filter(Boolean))).map(s => JSON.parse(s));

        const combined = dynamicSections.length > 0 ? dynamicSections : defaultSections;
        combined.sort((a, b) => a.nombre.localeCompare(b.nombre));
        return combined;
    }, [allPoints]);

    // 3. Filter Points by Section
    const visiblePoints = useMemo(() => activeSectionId === 'all'
        ? filteredPoints
        : filteredPoints.filter(p => p.section_data?.id === activeSectionId), [filteredPoints, activeSectionId]);

    // 4. Calculate Section KPIs
    const { sectionVol, sectionFlow } = useMemo(() => ({
        sectionVol: visiblePoints.reduce((acc, p) => acc + (p.accumulated || 0), 0),
        sectionFlow: visiblePoints.reduce((acc, p) => acc + (p.current_q || 0), 0)
    }), [visiblePoints]);

    const { totalDailyVolMm3, totalAccumulatedVol, totalTargetVol } = useMemo(() => ({
        totalDailyVolMm3: modules.reduce((acc, m) => acc + m.daily_vol, 0),
        totalAccumulatedVol: modules.reduce((acc, m) => acc + m.accumulated_vol, 0),
        totalTargetVol: modules.reduce((acc, m) => acc + m.authorized_vol, 0) || 1
    }), [modules]);

    // Eficiencia real: (Σ caudal entregado / Σ caudal objetivo) × 100
    const globalEfficiency = useMemo(() => {
        const totalDelivered = modules.reduce((acc, m) => acc + m.current_flow, 0);
        const totalTarget = modules.reduce((acc, m) => acc + m.target_flow, 0);
        return calculateEfficiency(totalTarget, totalDelivered);
    }, [modules]);

    if (loading && modules.length === 0) return <div className="text-white p-10 flex items-center gap-3"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> Cargando Centro de Control...</div>;

    if (error && modules.length === 0) return <div className="text-red-400 p-10">Error Crítico de Conexión: {error}</div>;

    const activePoint = visiblePoints.find(p => p.id === selectedPointId);

    return (
        <div className="canales-container relative flex flex-col h-screen overflow-hidden">
            <OfflineIndicator />

            <header className="page-header dashboard-header shrink-0">
                <div className="header-left">
                    <img src="/logos/srl_logo.jpg" alt="SRL Logo" className="srl-logo" />
                </div>

                <div className="header-center">
                    <h1 className="srl-title">SOCIEDAD DE ASOCIACIONES DE USUARIOS UNIDAD CONCHOS S. DE R.L. DE I.P. Y C.V.</h1>
                    <p className="srl-subtitle">Centro de Control Operativo - Distrito 005</p>
                </div>

                <div className="header-right">
                    <div className="date-navigator">
                        <button onClick={() => handleDateChange(-1)} className="nav-btn"><ChevronLeft size={20} /></button>
                        <div className="current-date">
                            <Calendar size={16} />
                            <span>{selectedDate.toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' })}</span>
                        </div>
                        <button
                            onClick={() => handleDateChange(1)}
                            className="nav-btn"
                            disabled={selectedDate.toDateString() === new Date().toDateString()}
                        ><ChevronRight size={20} /></button>
                    </div>
                </div>
            </header>

            {/* SECTION SELECTOR TABS */}
            <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex gap-2 overflow-x-auto shrink-0">
                <button
                    onClick={() => setActiveSectionId('all')}
                    className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${activeSectionId === 'all' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                >
                    Vista General (Todas)
                </button>
                {sections.map((sec: any) => (
                    <button
                        key={sec.id}
                        onClick={() => setActiveSectionId(sec.id)}
                        className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all flex items-center gap-2 ${activeSectionId === sec.id ? 'text-white shadow-lg' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                        style={activeSectionId === sec.id ? { backgroundColor: sec.color, boxShadow: `0 4px 12px -2px ${sec.color}40` } : {}}
                    >
                        <span className="w-2 h-2 rounded-full bg-white/50"></span>
                        {sec.nombre}
                    </button>
                ))}
            </div>

            {/* DASHBOARD GRID LAYOUT */}
            <div className="grid grid-cols-12 gap-4 p-4 flex-1 min-h-0">

                {/* COL 1: KPIs & ANOMALIES */}
                <aside className="col-span-3 flex flex-col gap-4 overflow-hidden">
                    <EfficiencyGauge value={globalEfficiency} />

                    {/* DYNAMIC SECTION KPI */}
                    <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                        <h3 className="text-slate-400 text-xs font-bold uppercase mb-3 flex items-center gap-2">
                            <Droplets size={14} className="text-blue-400" />
                            {activeSectionId === 'all' ? 'Balance Distrito' : 'Balance Sección'}
                        </h3>
                        <div className="space-y-4">
                            <div>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="text-slate-400">Entrega Actual (Q)</span>
                                    <span className="text-white font-mono">{(activeSectionId === 'all' ? modules.reduce((a, m) => a + m.current_flow, 0) * 1000 : sectionFlow * 1000).toFixed(0)} L/s</span>
                                </div>
                                <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-blue-500" style={{
                                        width: `${(() => {
                                            const totalFlow = activeSectionId === 'all' ? modules.reduce((a, m) => a + m.current_flow, 0) : sectionFlow;
                                            const totalTarget = activeSectionId === 'all' ? modules.reduce((a, m) => a + m.target_flow, 0) : visiblePoints.reduce((a, p) => a + (p.capacity || 0), 0);
                                            return totalTarget > 0 ? Math.min((totalFlow / totalTarget) * 100, 100) : 0;
                                        })()}%`
                                    }}></div>
                                </div>
                            </div>
                            <div>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="text-slate-400">Vol. del Día</span>
                                    <span className="text-blue-400 font-mono">{formatVol(activeSectionId === 'all' ? totalDailyVolMm3 : visiblePoints.reduce((a, p) => a + (p.daily_vol || 0), 0))} Mm³</span>
                                </div>
                                <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-blue-500 animate-pulse" style={{ width: `${totalDailyVolMm3 > 0 ? Math.min((totalDailyVolMm3 / (totalTargetVol * 0.003)) * 100, 100) : 5}%` }}></div>
                                </div>
                            </div>
                            <div>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="text-slate-400">Acumulado Ciclo</span>
                                    <span className="text-emerald-400 font-mono">{formatVol(activeSectionId === 'all' ? totalAccumulatedVol : sectionVol)} Mm³</span>
                                </div>
                                <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-emerald-500" style={{ width: `${(totalAccumulatedVol / totalTargetVol) * 100}%` }}></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 min-h-0">
                        <AnomalyMatrix modules={modules} onSelectModule={(id) => {
                            const mod = modules.find(m => m.id === id);
                            if (mod) setViewingModule(mod);
                        }} />
                    </div>
                </aside>

                {/* COL 2: MAP */}
                <section className="col-span-6 bg-slate-900/50 rounded-xl border border-slate-700/50 relative overflow-hidden group flex flex-col">
                    {/* Map Overlay Info */}
                    <div className="absolute top-4 left-4 z-10 bg-slate-900/80 backdrop-blur px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 pointer-events-none">
                        <span className="w-2 h-2 bg-emerald-500 rounded-full inline-block mr-2"></span>
                        {activeSectionId === 'all' ? 'Red Completa' : sections.find((s: any) => s.id === activeSectionId)?.nombre}
                    </div>

                    <div className="flex-1 relative">
                        <CanalSchematic
                            points={visiblePoints}
                            activePointId={selectedPointId}
                            onPointClick={(p) => setSelectedPointId(p.id === selectedPointId ? null : p.id)}
                        />
                    </div>

                    {/* Popover Logic Integrated */}
                    {activePoint && (
                        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-slate-800/90 backdrop-blur-md border border-slate-600 p-4 rounded-xl shadow-2xl w-80 z-20">
                            <div className="flex justify-between items-start mb-2">
                                <div>
                                    <span className="text-xs text-blue-400 font-bold uppercase">{activePoint.type}</span>
                                    <h3 className="text-lg font-bold text-white leading-tight">{activePoint.name}</h3>
                                    <div className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
                                        <MapPin size={10} /> {activePoint.moduleName} • Km {activePoint.km}
                                    </div>
                                </div>
                                <button onClick={() => setSelectedPointId(null)} className="text-slate-400 hover:text-white bg-slate-700 rounded-full p-1"><X size={14} /></button>
                            </div>

                            <div className="grid grid-cols-2 gap-2 mt-3">
                                <div className="bg-slate-900/50 p-2 rounded border border-slate-700">
                                    <span className="text-[10px] text-slate-500 block uppercase">Gasto Actual</span>
                                    <span className="text-lg font-mono text-emerald-400 font-bold">{activePoint.current_q_lps.toFixed(0)} <span className="text-xs text-slate-500">L/s</span></span>
                                </div>
                                <div className="bg-slate-900/50 p-2 rounded border border-slate-700">
                                    <span className="text-[10px] text-slate-500 block uppercase">Capacidad</span>
                                    <span className="text-lg font-mono text-slate-300">{(activePoint.capacity * 1000).toFixed(0)} <span className="text-xs text-slate-500">L/s</span></span>
                                </div>
                                <div className="bg-slate-900/50 p-2 rounded border border-slate-700">
                                    <span className="text-[10px] text-slate-500 block uppercase">Vol. Día</span>
                                    <span className="text-lg font-mono text-blue-400 font-bold">{activePoint.daily_vol.toFixed(4)} <span className="text-xs text-slate-500">Mm³</span></span>
                                </div>
                            </div>

                            {activePoint.current_q > activePoint.capacity && (
                                <div className="mt-2 bg-red-500/20 border border-red-500/50 text-red-200 text-xs px-2 py-1.5 rounded flex items-center gap-2 font-bold animate-pulse">
                                    <Zap size={12} /> ALERTA DE CAPACIDAD
                                </div>
                            )}
                        </div>
                    )}
                </section>

                {/* COL 3: LIST & DETAILS - REDESIGNED */}
                <aside className="col-span-3 flex flex-col h-full bg-slate-800/20 border-l border-slate-700/50">
                    <div className="p-3 border-b border-slate-700/50">
                        <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">Operación por Módulo</h3>
                    </div>

                    <div className="flex-1 overflow-y-auto p-2 space-y-3 scrollbar-thin">
                        {modules.map(mod => (
                            <div key={mod.id} onClick={() => setViewingModule(mod)}>
                                <ModuleCard data={mod} />
                            </div>
                        ))}
                    </div>
                </aside>
            </div>

            {viewingModule && (
                <ModuleDetailModal module={viewingModule} onClose={() => setViewingModule(null)} />
            )}
        </div>
    );
};

export default Canales;
