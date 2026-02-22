import { useState, useEffect } from 'react';
import { Gauge, Clock, ArrowUp, ArrowDown, Minus, AlertTriangle, Droplets, Activity, Loader } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFecha } from '../context/FechaContext';
import './ControlEscalas.css';

// Types from Supabase view
interface ResumenEscala {
    escala_id: string;
    nombre: string;
    km: number;
    seccion_id: string;
    seccion_nombre: string;
    seccion_color: string;
    nivel_min_operativo: number;
    nivel_max_operativo: number;
    capacidad_max: number;
    fecha: string;
    lectura_am: number | null;
    lectura_pm: number | null;
    hora_am: string | null;
    hora_pm: string | null;
    nivel_actual: number | null;
    delta_12h: number | null;
    estado: string;
}

interface ScaleReading {
    id: string;
    name: string;
    km: number;
    currentLevel: number;
    amReading: number;
    pmReading: number;
    minOperational: number;
    maxOperational: number;
    maxCapacity: number;
}

interface Zone {
    id: string;
    name: string;
    color: string;
    scales: ScaleReading[];
}

function mapResumenToZones(data: ResumenEscala[]): Zone[] {
    const zonesMap = new Map<string, Zone>();

    for (const row of data) {
        const secId = row.seccion_id || 'sin-seccion';
        if (!zonesMap.has(secId)) {
            zonesMap.set(secId, {
                id: secId,
                name: row.seccion_nombre || secId,
                color: row.seccion_color || '#6b7280',
                scales: [],
            });
        }
        zonesMap.get(secId)!.scales.push({
            id: row.escala_id,
            name: row.nombre,
            km: row.km,
            currentLevel: row.nivel_actual ?? 0,
            amReading: row.lectura_am ?? 0,
            pmReading: row.lectura_pm ?? 0,
            minOperational: row.nivel_min_operativo,
            maxOperational: row.nivel_max_operativo,
            maxCapacity: row.capacidad_max,
        });
    }

    // Sort scales within each zone by km
    for (const zone of zonesMap.values()) {
        zone.scales.sort((a, b) => a.km - b.km);
    }

    // Sort zones by the first scale's km
    return Array.from(zonesMap.values()).sort((a, b) => {
        const aKm = a.scales[0]?.km ?? 0;
        const bKm = b.scales[0]?.km ?? 0;
        return aKm - bKm;
    });
}

// Component: Scale Gauge (Vertical)
const ScaleGauge = ({ scale, zoneColor }: { scale: ScaleReading; zoneColor: string }) => {
    const levelPercent = (scale.currentLevel / scale.maxCapacity) * 100;
    const minPercent = (scale.minOperational / scale.maxCapacity) * 100;
    const maxPercent = (scale.maxOperational / scale.maxCapacity) * 100;

    const delta = scale.pmReading - scale.amReading;
    const isRising = delta > 0.02;
    const isFalling = delta < -0.02;

    const isWarning = scale.currentLevel < scale.minOperational || scale.currentLevel > scale.maxOperational;

    return (
        <div className={`scale-gauge-card ${isWarning ? 'warning' : ''}`}>
            <div className="gauge-header">
                <span className="gauge-name">{scale.name}</span>
                <span className="gauge-km">Km {scale.km}</span>
            </div>

            <div className="gauge-container">
                {/* Vertical Gauge */}
                <div className="gauge-bar">
                    {/* Background zones */}
                    <div
                        className="gauge-zone operational"
                        style={{
                            bottom: `${minPercent}%`,
                            height: `${maxPercent - minPercent}%`,
                            backgroundColor: `${zoneColor}20`
                        }}
                    />

                    {/* Min/Max markers */}
                    <div className="gauge-marker min" style={{ bottom: `${minPercent}%` }}>
                        <span>Min</span>
                    </div>
                    <div className="gauge-marker max" style={{ bottom: `${maxPercent}%` }}>
                        <span>Max</span>
                    </div>

                    {/* Water level fill */}
                    <div
                        className="gauge-fill"
                        style={{
                            height: `${levelPercent}%`,
                            backgroundColor: isWarning ? '#ef4444' : zoneColor
                        }}
                    />

                    {/* Level indicator */}
                    <div
                        className="level-indicator"
                        style={{ bottom: `${levelPercent}%`, borderColor: zoneColor }}
                    >
                        <span className="level-value">{scale.currentLevel.toFixed(2)}m</span>
                    </div>
                </div>

                {/* Scale markings (0-4m) */}
                <div className="gauge-scale">
                    {[4, 3, 2, 1, 0].map(m => (
                        <div key={m} className="scale-tick">
                            <span>{m}m</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* 12-Hour Movement */}
            <div className="movement-section">
                <div className="reading-row">
                    <Clock size={12} className="text-slate-500" />
                    <span className="reading-label">06:00</span>
                    <span className="reading-value">{scale.amReading.toFixed(2)}m</span>
                </div>
                <div className="reading-row">
                    <Clock size={12} className="text-slate-500" />
                    <span className="reading-label">18:00</span>
                    <span className="reading-value">{scale.pmReading.toFixed(2)}m</span>
                </div>
                <div className={`delta-row ${isRising ? 'rising' : isFalling ? 'falling' : 'stable'}`}>
                    {isRising ? <ArrowUp size={14} /> : isFalling ? <ArrowDown size={14} /> : <Minus size={14} />}
                    <span>Δ {delta >= 0 ? '+' : ''}{delta.toFixed(2)}m</span>
                </div>
            </div>

            {isWarning && (
                <div className="warning-badge">
                    <AlertTriangle size={12} />
                    <span>Fuera de rango</span>
                </div>
            )}
        </div>
    );
};

// Component: Zone Card
const ZoneCard = ({ zone }: { zone: Zone }) => {
    const avgLevel = zone.scales.reduce((sum, s) => sum + s.currentLevel, 0) / zone.scales.length;
    const hasWarning = zone.scales.some(s => s.currentLevel < s.minOperational || s.currentLevel > s.maxOperational);

    return (
        <div className="zone-card" style={{ borderColor: zone.color }}>
            <div className="zone-header" style={{ backgroundColor: `${zone.color}15` }}>
                <div className="zone-title">
                    <div className="zone-dot" style={{ backgroundColor: zone.color }} />
                    <h3>{zone.name}</h3>
                    <span className="zone-count">{zone.scales.length} escalas</span>
                </div>
                <div className="zone-summary">
                    <div className="summary-stat">
                        <Droplets size={16} style={{ color: zone.color }} />
                        <span className="stat-value">{avgLevel.toFixed(2)}m</span>
                        <span className="stat-label">Promedio</span>
                    </div>
                    {hasWarning && (
                        <div className="zone-warning">
                            <AlertTriangle size={14} />
                        </div>
                    )}
                </div>
            </div>

            <div className="zone-gauges">
                {zone.scales.map(scale => (
                    <ScaleGauge key={scale.id} scale={scale} zoneColor={zone.color} />
                ))}
            </div>
        </div>
    );
};

// Main Component
const ControlEscalas = () => {
    const { fechaSeleccionada } = useFecha();
    const [zones, setZones] = useState<Zone[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function fetchData() {
            setLoading(true);
            setError(null);

            const { data, error: err } = await supabase
                .from('resumen_escalas_diario')
                .select('*')
                .eq('fecha', fechaSeleccionada);

            if (cancelled) return;

            if (err) {
                setError(err.message);
                setLoading(false);
                return;
            }

            if (!data || data.length === 0) {
                // No readings for this date: fetch escalas alone to show empty gauges
                const { data: escalas } = await supabase
                    .from('escalas')
                    .select('id, nombre, km, seccion_id, nivel_min_operativo, nivel_max_operativo, capacidad_max, secciones(id, nombre, color)')
                    .eq('activa', true)
                    .order('km');

                if (cancelled) return;

                if (escalas && escalas.length > 0) {
                    const mapped: ResumenEscala[] = escalas.map((e: any) => ({
                        escala_id: e.id,
                        nombre: e.nombre,
                        km: Number(e.km),
                        seccion_id: e.secciones?.id || '',
                        seccion_nombre: e.secciones?.nombre || '',
                        seccion_color: e.secciones?.color || '#6b7280',
                        nivel_min_operativo: Number(e.nivel_min_operativo),
                        nivel_max_operativo: Number(e.nivel_max_operativo),
                        capacidad_max: Number(e.capacidad_max),
                        fecha: fechaSeleccionada,
                        lectura_am: null,
                        lectura_pm: null,
                        hora_am: null,
                        hora_pm: null,
                        nivel_actual: null,
                        delta_12h: null,
                        estado: 'sin_datos',
                    }));
                    setZones(mapResumenToZones(mapped));
                } else {
                    setZones([]);
                }
                setLoading(false);
                return;
            }

            const mapped: ResumenEscala[] = data.map((r: any) => ({
                escala_id: r.escala_id,
                nombre: r.nombre,
                km: Number(r.km),
                seccion_id: r.seccion_id || '',
                seccion_nombre: r.seccion_nombre || '',
                seccion_color: r.seccion_color || '#6b7280',
                nivel_min_operativo: Number(r.nivel_min_operativo),
                nivel_max_operativo: Number(r.nivel_max_operativo),
                capacidad_max: Number(r.capacidad_max),
                fecha: r.fecha,
                lectura_am: r.lectura_am != null ? Number(r.lectura_am) : null,
                lectura_pm: r.lectura_pm != null ? Number(r.lectura_pm) : null,
                hora_am: r.hora_am,
                hora_pm: r.hora_pm,
                nivel_actual: r.nivel_actual != null ? Number(r.nivel_actual) : null,
                delta_12h: r.delta_12h != null ? Number(r.delta_12h) : null,
                estado: r.estado || 'normal',
            }));

            setZones(mapResumenToZones(mapped));
            setLoading(false);
        }

        fetchData();
        return () => { cancelled = true; };
    }, [fechaSeleccionada]);

    // Calculate overall stats
    const allScales = zones.flatMap(z => z.scales);
    const totalScales = allScales.length;
    const warningCount = allScales.filter(s => s.currentLevel < s.minOperational || s.currentLevel > s.maxOperational).length;
    const avgDelta = totalScales > 0
        ? allScales.reduce((sum, s) => sum + (s.pmReading - s.amReading), 0) / totalScales
        : 0;

    if (loading) {
        return (
            <div className="escalas-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <Loader size={32} className="spin" style={{ color: 'var(--color-primary)' }} />
            </div>
        );
    }

    if (error) {
        return (
            <div className="escalas-container" style={{ textAlign: 'center', padding: '3rem' }}>
                <AlertTriangle size={32} style={{ color: '#ef4444', marginBottom: '1rem' }} />
                <p style={{ color: '#ef4444' }}>Error: {error}</p>
            </div>
        );
    }

    return (
        <div className="escalas-container">
            <header className="page-header">
                <div>
                    <h2 className="text-2xl font-bold text-white">Control de Escalas</h2>
                    <p className="text-slate-400 text-sm">Monitoreo de Niveles Operativos por Zona (Km 0 - Km 104)</p>
                </div>

                {/* Quick Stats */}
                <div className="header-stats">
                    <div className="stat-chip">
                        <Gauge size={16} />
                        <span>{totalScales} Escalas</span>
                    </div>
                    <div className={`stat-chip ${warningCount > 0 ? 'warning' : 'success'}`}>
                        <Activity size={16} />
                        <span>{warningCount} Alertas</span>
                    </div>
                    <div className={`stat-chip ${avgDelta >= 0 ? 'rising' : 'falling'}`}>
                        {avgDelta >= 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                        <span>Δ {avgDelta >= 0 ? '+' : ''}{avgDelta.toFixed(2)}m (12h)</span>
                    </div>
                </div>
            </header>

            {/* Overall Canal Indicator */}
            <section className="overall-indicator">
                <div className="indicator-header">
                    <h3>Nivel Promedio General del Canal</h3>
                    <p>Representación integral Km 0 - Km 104</p>
                </div>

                <div className="indicator-content">
                    {/* Main Average Gauge */}
                    <div className="main-gauge">
                        <div className="gauge-visual">
                            <div className="gauge-track">
                                {[1, 2, 3, 4].map(m => (
                                    <div key={m} className="gauge-segment" style={{ left: `${(m / 4) * 100}%` }}>
                                        <span>{m}m</span>
                                    </div>
                                ))}
                                <div
                                    className="gauge-pointer"
                                    style={{
                                        left: `${totalScales > 0 ? (allScales.reduce((sum, s) => sum + s.currentLevel, 0) / totalScales / 4) * 100 : 0}%`,
                                        backgroundColor: warningCount > 0 ? '#f59e0b' : '#10b981'
                                    }}
                                />
                            </div>
                            <div className="gauge-value-display">
                                <span className="value">{totalScales > 0 ? (allScales.reduce((sum, s) => sum + s.currentLevel, 0) / totalScales).toFixed(2) : '0.00'}</span>
                                <span className="unit">m</span>
                            </div>
                        </div>
                    </div>

                    {/* Zone Averages Strip */}
                    <div className="zone-averages-strip">
                        {zones.map(zone => {
                            const zoneAvg = zone.scales.reduce((sum, s) => sum + s.currentLevel, 0) / zone.scales.length;
                            return (
                                <div key={zone.id} className="zone-avg-chip" style={{ borderColor: zone.color }}>
                                    <div className="chip-dot" style={{ backgroundColor: zone.color }} />
                                    <span className="chip-name">{zone.name}</span>
                                    <span className="chip-value" style={{ color: zone.color }}>{zoneAvg.toFixed(2)}m</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* Zones Grid */}
            <div className="zones-grid">
                {zones.map(zone => (
                    <ZoneCard key={zone.id} zone={zone} />
                ))}
            </div>

            {zones.length === 0 && !loading && (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-muted)' }}>
                    <Gauge size={48} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
                    <p>No hay lecturas de escalas para esta fecha.</p>
                    <p style={{ fontSize: '0.8rem' }}>Selecciona otra fecha o captura nuevas lecturas.</p>
                </div>
            )}
        </div>
    );
};

export default ControlEscalas;
