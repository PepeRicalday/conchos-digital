import { useState, useMemo, useEffect } from 'react';
import { toDateString, isToday } from '../utils/dateHelpers';
import { calculateEfficiency } from '../utils/hydraulics';
import { X, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import CanalSchematic from '../components/CanalSchematic';
import { useHydraEngine, type ModuleData } from '../hooks/useHydraEngine';
import EfficiencyGauge from '../components/EfficiencyGauge';

import OfflineIndicator from '../components/OfflineIndicator';
import { formatVol, defaultSections, getLogoPath } from '../utils/uiHelpers';
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

    const { totalDailyVolMm3, totalAccumulatedVol } = useMemo(() => ({
        totalDailyVolMm3: modules.reduce((acc, m) => acc + m.daily_vol, 0),
        totalAccumulatedVol: modules.reduce((acc, m) => acc + m.accumulated_vol, 0),
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

            <header className="px-6 py-4 bg-slate-900/50 border-b border-slate-800 backdrop-blur-md flex justify-between items-center shrink-0 z-20">
                <div className="flex items-center gap-6">
                    <img src={getLogoPath('SRL', 'SRL')} alt="SRL Logo" style={{ height: '36px', width: 'auto' }} className="brightness-110 contrast-110 drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]" />
                    <div>
                        <h1 className="text-white text-base font-black uppercase tracking-widest leading-none mb-1">Centro de Control Operativo</h1>
                        <p className="text-slate-500 text-[10px] font-bold tracking-widest uppercase">Distrito de Riego 005 - Unidad de Manejo</p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="date-nav flex items-center bg-slate-950/50 backdrop-blur rounded-full border border-slate-800 p-0.5 shadow-inner">
                        <button onClick={() => handleDateChange(-1)} className="nav-btn p-2 hover:text-white transition-colors"><ChevronLeft size={18} /></button>
                        <div className="current-date px-4 flex items-center gap-2 text-white font-black font-mono text-xs">
                            <Calendar size={14} className="text-blue-400" />
                            <span>{selectedDate.toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()}</span>
                        </div>
                        <button
                            onClick={() => handleDateChange(1)}
                            className="nav-btn p-2 hover:text-white transition-colors"
                            disabled={selectedDate.toDateString() === new Date().toDateString()}
                        ><ChevronRight size={18} /></button>
                    </div>
                </div>
            </header>

            {/* SECTION SELECTOR TABS (PREMIUM REDESIGN) */}
            <div className="conchos-tabs-area">
                <button
                    onClick={() => setActiveSectionId('all')}
                    className={`conchos-section-tab ${activeSectionId === 'all' ? 'active' : ''}`}
                >
                    Vista General
                </button>
                {sections.map((sec: any) => (
                    <button
                        key={sec.id}
                        onClick={() => setActiveSectionId(sec.id)}
                        className={`conchos-section-tab ${activeSectionId === sec.id ? 'active' : ''}`}
                        style={activeSectionId === sec.id ? {
                            backgroundColor: sec.color,
                            borderColor: `${sec.color}40`,
                            boxShadow: `0 6px 20px -4px ${sec.color}80`
                        } : {}}
                    >
                        <div className="conchos-tab-indicator" />
                        {sec.nombre}
                    </button>
                ))}
            </div>

            {/* MAIN DASHBOARD SCROLLABLE AREA */}
            <div className="conchos-dashboard-v-layout scrollbar-none">

                {/* ROW 1: KPIs & EFFICIENCY */}
                <div className="conchos-top-row">
                    {/* LEFT PANEL: BALANCE */}
                    <div className="conchos-balance-card">
                        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                            <h3 style={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '2px', color: '#60a5fa', margin: 0 }}>
                                {activeSectionId === 'all' ? 'Balance Distrito 005' : 'Balance Seccional'}
                            </h3>
                            <div className="conchos-online-led conchos-pulse" style={{ backgroundColor: '#22d3ee', color: '#22d3ee' }} />
                        </header>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            <div className="metric-entry">
                                <span className="conchos-vol-label">Entrega Actual (Q)</span>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '4px' }}>
                                    <span className="conchos-vol-huge">
                                        {(activeSectionId === 'all' ? modules.reduce((a, m) => a + m.current_flow, 0) * 1000 : sectionFlow * 1000).toFixed(0)}
                                    </span>
                                    <span className="conchos-unit-small">L/s</span>
                                </div>
                                <div className="conchos-prog-container" style={{ marginTop: '10px', height: '4px' }}>
                                    <div className="conchos-prog-bar" style={{
                                        backgroundColor: '#3b82f6',
                                        width: `${(() => {
                                            const totalFlow = activeSectionId === 'all' ? modules.reduce((a, m) => a + m.current_flow, 0) : sectionFlow;
                                            const totalTarget = activeSectionId === 'all' ? modules.reduce((a, m) => a + m.target_flow, 0) : visiblePoints.reduce((a, p) => a + (p.capacity || 0), 0);
                                            return totalTarget > 0 ? Math.min((totalFlow / totalTarget) * 100, 100) : 0;
                                        })()}%`
                                    }}></div>
                                </div>
                            </div>

                            <div className="metric-entry">
                                <span className="conchos-vol-label">Volumen del Día</span>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '4px' }}>
                                    <span style={{ fontSize: '24px', fontWeight: 900, color: '#60a5fa', fontFamily: 'JetBrains Mono' }}>
                                        {formatVol(activeSectionId === 'all' ? totalDailyVolMm3 : visiblePoints.reduce((a, p) => a + (p.daily_vol || 0), 0))}
                                    </span>
                                    <span className="conchos-unit-small">Mm³</span>
                                </div>
                            </div>

                            <div className="metric-entry">
                                <span className="conchos-vol-label">Acumulado Ciclo</span>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '4px' }}>
                                    <span style={{ fontSize: '24px', fontWeight: 900, color: '#10b981', fontFamily: 'JetBrains Mono' }}>
                                        {formatVol(activeSectionId === 'all' ? totalAccumulatedVol : sectionVol)}
                                    </span>
                                    <span className="conchos-unit-small">Mm³</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* CENTER: EFFICIENCY */}
                    <div className="conchos-efficiency-center">
                        <EfficiencyGauge value={globalEfficiency} />
                    </div>

                    {/* RIGHT: MARGEN BALANCE */}
                    <div style={{ flex: '0 0 320px' }} className="hidden lg:block"></div>
                </div>

                {/* ROW 2: MAP */}
                <section className="conchos-map-section">
                    <div style={{ position: 'absolute', top: '16px', left: '16px', zIndex: 10, background: 'rgba(2, 6, 23, 0.9)', padding: '8px 16px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)', fontSize: '10px', color: '#94a3b8', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '1px' }}>
                        <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981', marginRight: '8px', boxShadow: '0 0 8px #10b981' }}></span>
                        {activeSectionId === 'all' ? 'Red Completa del Distrito' : `Tramo Seccional: ${sections.find((s: any) => s.id === activeSectionId)?.nombre}`}
                    </div>

                    <div style={{ flex: 1, position: 'relative', width: '100%', height: '100%' }}>
                        <CanalSchematic
                            points={visiblePoints}
                            activePointId={selectedPointId}
                            onPointClick={(p) => setSelectedPointId(p.id === selectedPointId ? null : p.id)}
                        />
                    </div>

                    {/* Popover */}
                    {activePoint && (
                        <div style={{ position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(13, 20, 34, 0.98)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '20px', padding: '20px', width: '340px', zIndex: 30, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                                <div>
                                    <span style={{ fontSize: '9px', color: '#3b82f6', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '1.5px' }}>{activePoint.type}</span>
                                    <h3 style={{ fontSize: '20px', fontWeight: 900, color: 'white', margin: '4px 0', fontFamily: 'Inter' }}>{activePoint.name}</h3>
                                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Km {activePoint.km} • <span style={{ color: '#94a3b8' }}>{activePoint.moduleName}</span></div>
                                </div>
                                <button onClick={() => setSelectedPointId(null)} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#94a3b8 hover:text-white transition-colors' }}><X size={16} /></button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <div style={{ background: 'rgba(0,0,0,0.4)', padding: '12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.03)' }}>
                                    <span style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', fontWeight: 800 }}>Gasto</span>
                                    <div style={{ color: '#10b981', fontWeight: 900, fontSize: '16px', fontFamily: 'JetBrains Mono' }}>{activePoint.current_q_lps.toFixed(0)} <span style={{ fontSize: '10px', opacity: 0.5 }}>L/s</span></div>
                                </div>
                                <div style={{ background: 'rgba(0,0,0,0.4)', padding: '12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.03)' }}>
                                    <span style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', fontWeight: 800 }}>Vol. Día</span>
                                    <div style={{ color: '#3b82f6', fontWeight: 900, fontSize: '16px', fontFamily: 'JetBrains Mono' }}>{activePoint.daily_vol.toFixed(4)} <span style={{ fontSize: '10px', opacity: 0.5 }}>Mm³</span></div>
                                </div>
                            </div>
                        </div>
                    )}
                </section>

                {/* ROW 3: MODULES */}
                <div className="conchos-modules-header">Operación por Módulo</div>
                <div className="conchos-modules-grid">
                    {modules.map(mod => (
                        <div key={mod.id} onClick={() => setViewingModule(mod)}>
                            <ModuleCard data={mod} />
                        </div>
                    ))}
                </div>

                {/* Spacer for scroll */}
                <div style={{ height: '40px' }} />
            </div>

            {viewingModule && (
                <ModuleDetailModal module={viewingModule as ModuleData} onClose={() => setViewingModule(null)} />
            )}
        </div>
    );
};

export default Canales;
