import { useState, useEffect } from 'react';
import { Gauge, Clock, ArrowUp, ArrowDown, Minus, AlertTriangle, Droplets, Activity, Loader, Settings, Waves, Calculator, X, Info } from 'lucide-react';
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

interface EscalaConfig {
    id: string;
    pzas_radiales: number;
    ancho: number;
    alto: number;
}

interface RadialApertura {
    index: number;
    apertura_m: number;
}

interface LecturaRadial {
    escala_id: string;
    nivel_m: number;
    nivel_abajo_m: number;
    apertura_radiales_m: number;
    radiales_json: RadialApertura[] | null;
    gasto_calculado_m3s: number;
    hora_lectura: string;
    fecha: string;
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
    // Radial gate data
    pzasRadiales: number;
    anchoRadial: number;
    altoRadial: number;
    radialAperturas: RadialApertura[];
    nivelAbajo: number;
    gastoCalculado: number;
    horaLectura: string;
}

interface Zone {
    id: string;
    name: string;
    color: string;
    scales: ScaleReading[];
}

function mapResumenToZones(
    data: ResumenEscala[],
    configs: Map<string, EscalaConfig>,
    lecturas: Map<string, LecturaRadial>
): Zone[] {
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

        const escalaKey = row.escala_id.trim().toUpperCase();
        const cfg = configs.get(escalaKey);
        const lect = lecturas.get(escalaKey);

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
            // Radial gate enrichment
            pzasRadiales: cfg?.pzas_radiales ?? 0,
            anchoRadial: cfg?.ancho ?? 0,
            altoRadial: cfg?.alto ?? 0,
            radialAperturas: lect?.radiales_json ?? [],
            nivelAbajo: lect?.nivel_abajo_m ?? 0,
            gastoCalculado: lect?.gasto_calculado_m3s ?? 0,
            horaLectura: lect?.hora_lectura ?? '',
        });
    }

    for (const zone of zonesMap.values()) {
        zone.scales.sort((a, b) => a.km - b.km);
    }

    return Array.from(zonesMap.values()).sort((a, b) => {
        const aKm = a.scales[0]?.km ?? 0;
        const bKm = b.scales[0]?.km ?? 0;
        return aKm - bKm;
    });
}

// ─── COMPONENTE: Modal de Cálculo de Radiales ───
const RadialModal = ({ scale, onClose }: { scale: ScaleReading; onClose: () => void }) => {
    if (!scale) return null;

    const { pzasRadiales, anchoRadial, altoRadial, currentLevel, nivelAbajo, gastoCalculado, radialAperturas } = scale;
    const openRadiales = radialAperturas.filter(r => r.apertura_m > 0);
    const totalAperturaXAncho = openRadiales.reduce((acc, r) => acc + (Math.min(r.apertura_m, altoRadial) * anchoRadial), 0);
    const cargaH = currentLevel > 0 ? Math.max(0, currentLevel - (nivelAbajo || 0)) : 0;

    return (
        <div className="radial-modal-overlay" onClick={onClose} style={{
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            backgroundColor: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
            <div className="radial-modal-content" onClick={e => e.stopPropagation()} style={{
                backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '12px',
                width: '90%', maxWidth: '600px', padding: '24px', position: 'relative',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
            }}>
                <button onClick={onClose} style={{ position: 'absolute', top: '16px', right: '16px', color: '#94a3b8', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                    <X size={20} />
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', borderBottom: '1px solid #1e293b', paddingBottom: '16px' }}>
                    <div style={{ padding: '8px', backgroundColor: 'rgba(14, 165, 233, 0.1)', borderRadius: '8px' }}>
                        <Calculator size={24} color="#0ea5e9" />
                    </div>
                    <div>
                        <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '18px' }}>Cálculo Hidráulico de Represo</h3>
                        <p style={{ margin: 0, color: '#94a3b8', fontSize: '12px' }}>{scale.name} — Km {scale.km}</p>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                    <div style={{ backgroundColor: '#1e293b', padding: '16px', borderRadius: '8px', border: '1px solid #334155' }}>
                        <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '4px', textTransform: 'uppercase' }}>Carga Hidrostática (H)</div>
                        <div style={{ color: '#0ea5e9', fontSize: '24px', fontWeight: 'bold' }}>{cargaH.toFixed(2)} <small style={{ fontSize: '14px' }}>m</small></div>
                        <div style={{ color: '#64748b', fontSize: '11px', marginTop: '4px' }}>Tirante arriba ({currentLevel.toFixed(2)}m) - Tirante abajo ({nivelAbajo.toFixed(2)}m)</div>
                    </div>

                    <div style={{ backgroundColor: '#1e293b', padding: '16px', borderRadius: '8px', border: '1px solid #334155' }}>
                        <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '4px', textTransform: 'uppercase' }}>Gasto Total Calculado (Q)</div>
                        <div style={{ color: '#10b981', fontSize: '24px', fontWeight: 'bold' }}>{gastoCalculado.toFixed(3)} <small style={{ fontSize: '14px' }}>m³/s</small></div>
                        <div style={{ color: '#64748b', fontSize: '11px', marginTop: '4px' }}>Aforo procesado desde lectura móvil</div>
                    </div>
                </div>

                <div style={{ marginBottom: '16px', color: '#f8fafc', fontSize: '14px', fontWeight: 'bold' }}>
                    Desglose Operativo por Compuerta <span style={{ color: '#0ea5e9', fontWeight: 'normal', fontSize: '12px' }}>({anchoRadial}m x {altoRadial}m)</span>
                </div>

                <div style={{ border: '1px solid #334155', borderRadius: '8px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                        <thead style={{ backgroundColor: '#0b1120', color: '#94a3b8' }}>
                            <tr>
                                <th style={{ padding: '10px 12px', fontWeight: 'bold' }}>Radial</th>
                                <th style={{ padding: '10px 12px', fontWeight: 'bold' }}>Apertura (a)</th>
                                <th style={{ padding: '10px 12px', fontWeight: 'bold' }}>Área Expuesta (A)</th>
                                <th style={{ padding: '10px 12px', fontWeight: 'bold' }}>Estado</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from({ length: pzasRadiales }).map((_, i) => {
                                const ap = radialAperturas[i]?.apertura_m ?? 0;
                                const area = Math.min(ap, altoRadial) * anchoRadial;
                                return (
                                    <tr key={i} style={{ borderTop: '1px solid #334155', backgroundColor: ap > 0 ? 'rgba(14, 165, 233, 0.05)' : 'transparent' }}>
                                        <td style={{ padding: '10px 12px', color: '#e2e8f0', fontWeight: 'bold' }}>R{i + 1}</td>
                                        <td style={{ padding: '10px 12px', color: ap > 0 ? '#38bdf8' : '#64748b' }}>{ap.toFixed(2)} m</td>
                                        <td style={{ padding: '10px 12px', color: '#e2e8f0' }}>{area.toFixed(2)} m²</td>
                                        <td style={{ padding: '10px 12px' }}>
                                            {ap > 0 ? (
                                                <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '4px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', border: '1px solid rgba(16,185,129,0.2)' }}>ABIERTA</span>
                                            ) : (
                                                <span style={{ backgroundColor: 'rgba(100, 116, 139, 0.1)', color: '#94a3b8', padding: '4px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', border: '1px solid rgba(100,116,139,0.2)' }}>CERRADA</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {totalAperturaXAncho > 0 && (
                    <div style={{ marginTop: '16px', padding: '12px', backgroundColor: 'rgba(14, 165, 233, 0.1)', border: '1px solid rgba(14, 165, 233, 0.2)', borderRadius: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <Info size={18} color="#0ea5e9" style={{ flexShrink: 0 }} />
                        <span style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.4 }}>
                            Área total de sección destapada: <b style={{ color: '#fff' }}>{totalAperturaXAncho.toFixed(2)} m²</b>.
                            El gasto (<b>Q</b>) se calcula a partir de la velocidad dependiente de la carga hidrostática, aproximada localmente durante la bitácora móvil.
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── COMPONENTE: Mini Diagrama de Radiales (SVG inline) ───
const RadialGateDiagram = ({ scale, onOpenModal }: { scale: ScaleReading; onOpenModal: () => void }) => {
    const { pzasRadiales, anchoRadial, altoRadial, radialAperturas, currentLevel } = scale;
    if (pzasRadiales <= 0) return null;

    const W = 140;
    const H = 80;
    const baseLine = 70;
    const pxPerMeter = 45 / Math.max(altoRadial * 1.3, currentLevel * 1.3, 2);
    const gateWidth = (W - 20) / pzasRadiales;
    const pillarW = 4;
    const effectiveGW = gateWidth - pillarW;
    const startX = 10;

    const waterY = baseLine - (currentLevel * pxPerMeter);

    const openCount = radialAperturas.filter(r => r.apertura_m > 0).length;

    return (
        <div className="radial-diagram-section hover-effect" onClick={onOpenModal} style={{ cursor: 'pointer', transition: 'all 0.2s ease' }} title="Ver Cálculo Hidráulico">
            <div className="radial-diagram-header">
                <Settings size={10} />
                <span>{pzasRadiales} Radiales ({anchoRadial}m × {altoRadial}m)</span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="radial-svg">
                <defs>
                    <linearGradient id="wGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.2" />
                        <stop offset="100%" stopColor="#0284c7" stopOpacity="0.5" />
                    </linearGradient>
                </defs>

                {/* Water body */}
                {currentLevel > 0 && (
                    <rect x={startX} y={Math.max(8, waterY)} width={pzasRadiales * gateWidth + pillarW} height={baseLine - Math.max(8, waterY)} fill="url(#wGrad)" />
                )}

                {/* Water line */}
                <line x1={0} y1={waterY} x2={W} y2={waterY} stroke="#38bdf8" strokeWidth="1" strokeDasharray="3 2" opacity={0.5} />

                {/* Base */}
                <line x1={0} y1={baseLine} x2={W} y2={baseLine} stroke="#475569" strokeWidth="2" />

                {/* Pillars + Gates */}
                {Array.from({ length: pzasRadiales + 1 }).map((_, i) => {
                    const px = startX + i * gateWidth;
                    return (
                        <g key={i}>
                            <rect x={px} y={12} width={pillarW} height={baseLine - 12} fill="#334155" stroke="#0f172a" strokeWidth="0.5" />
                            {i < pzasRadiales && (() => {
                                const ap = radialAperturas[i]?.apertura_m ?? 0;
                                const gx = px + pillarW;
                                const gatePxH = altoRadial * pxPerMeter;
                                const liftPx = ap * pxPerMeter;
                                const isOpen = ap > 0;

                                return (
                                    <g>
                                        {/* Flow through aperture */}
                                        {isOpen && (
                                            <rect x={gx + 1} y={baseLine - liftPx} width={effectiveGW - 2} height={liftPx} fill="#0ea5e9" opacity="0.7" rx="1" />
                                        )}

                                        {/* Gate plate */}
                                        <rect
                                            x={gx}
                                            y={baseLine - gatePxH - liftPx}
                                            width={effectiveGW}
                                            height={gatePxH}
                                            fill={isOpen ? '#fbbf24' : '#64748b'}
                                            stroke={isOpen ? '#f59e0b' : '#475569'}
                                            strokeWidth="1"
                                            rx="2"
                                        />

                                        {/* Cross bracing */}
                                        <line x1={gx} y1={baseLine - gatePxH - liftPx} x2={gx + effectiveGW} y2={baseLine - liftPx} stroke="#0f172a" strokeWidth="0.5" opacity="0.3" />

                                        {/* Label */}
                                        <text x={gx + effectiveGW / 2} y={baseLine - gatePxH - liftPx + gatePxH / 2 + 3} textAnchor="middle" fill={isOpen ? '#0f172a' : '#94a3b8'} fontSize="7" fontWeight="bold">
                                            R{i + 1}
                                        </text>

                                        {/* Apertura label */}
                                        {isOpen && (
                                            <text x={gx + effectiveGW / 2} y={baseLine - liftPx / 2 + 3} textAnchor="middle" fill="#fff" fontSize="6" fontWeight="bold">
                                                {ap.toFixed(2)}
                                            </text>
                                        )}
                                    </g>
                                );
                            })()}
                        </g>
                    );
                })}
            </svg>
            <div className="radial-status-row">
                <span className={`radial-badge ${openCount > 0 ? 'open' : 'closed'}`}>
                    {openCount > 0 ? `${openCount}/${pzasRadiales} Abiertas` : 'Todas Cerradas'}
                </span>
            </div>
        </div>
    );
};

// ─── COMPONENTE: Barra de Gasto / Volumen en Caja ───
const GastoVolumeBar = ({ scale }: { scale: ScaleReading }) => {
    // La capacidad de la caja (volumen relativo) se basa en el nivel máximo físico (asumimos 4m si no hay dato)
    const MAX_LEVEL_PHYSICAL = scale.maxOperational > 0 ? (scale.maxOperational * 1.2) : 4.0;
    const volumePercent = Math.min((scale.currentLevel / MAX_LEVEL_PHYSICAL) * 100, 100);
    const isHigh = scale.currentLevel > scale.maxOperational;
    const isLow = scale.currentLevel < scale.minOperational;

    return (
        <div className="gasto-volume-section">
            {scale.gastoCalculado > 0 && (
                <div className="gasto-row">
                    <Waves size={12} />
                    <span className="gasto-label">Q =</span>
                    <span className="gasto-value">{scale.gastoCalculado.toFixed(3)}</span>
                    <span className="gasto-unit">m³/s</span>
                </div>
            )}
            <div className="volume-bar-container">
                <div className="volume-bar-track">
                    <div
                        className={`volume-bar-fill ${isHigh ? 'high' : isLow ? 'low' : 'normal'}`}
                        style={{ width: `${volumePercent}%` }}
                    />
                </div>
                <span className="volume-percent">{volumePercent.toFixed(0)}%</span>
            </div>
        </div>
    );
};

// ─── COMPONENTE: Scale Gauge (Vertical) — Expandido ───
const ScaleGauge = ({ scale, zoneColor, onOpenModal }: { scale: ScaleReading; zoneColor: string; onOpenModal: (scale: ScaleReading) => void }) => {
    const MAX_H = 4.0; // Altura base visual de la escala
    const levelPercent = (scale.currentLevel / MAX_H) * 100;
    const minPercent = (scale.minOperational / MAX_H) * 100;
    const maxPercent = (scale.maxOperational / MAX_H) * 100;

    const delta = scale.pmReading - scale.amReading;
    const isRising = delta > 0.02;
    const isFalling = delta < -0.02;

    const isWarning = scale.currentLevel < scale.minOperational || scale.currentLevel > scale.maxOperational;
    const hasRadiales = scale.pzasRadiales > 0;

    return (
        <div className={`scale-gauge-card ${isWarning ? 'warning' : ''} ${hasRadiales ? 'has-radiales' : ''}`}>
            <div className="gauge-header">
                <span className="gauge-name">{scale.name}</span>
                <span className="gauge-km">Km {scale.km}</span>
            </div>

            <div className="gauge-body-row">
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

                {/* Radial Gate Diagram (alongside gauge vertically) */}
                {hasRadiales && <RadialGateDiagram scale={scale} onOpenModal={() => onOpenModal(scale)} />}
            </div>

            {/* Gasto + Volumen en Caja */}
            {hasRadiales && <GastoVolumeBar scale={scale} />}

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
const ZoneCard = ({ zone, onOpenModal }: { zone: Zone; onOpenModal: (scale: ScaleReading) => void }) => {
    const avgLevel = zone.scales.reduce((sum, s) => sum + s.currentLevel, 0) / zone.scales.length;
    const hasWarning = zone.scales.some(s => s.currentLevel < s.minOperational || s.currentLevel > s.maxOperational);
    const totalGasto = zone.scales.reduce((sum, s) => sum + s.gastoCalculado, 0);
    const radialScales = zone.scales.filter(s => s.pzasRadiales > 0);

    return (
        <div className="zone-card" style={{ borderColor: zone.color }}>
            <div className="zone-header" style={{ backgroundColor: `${zone.color}15` }}>
                <div className="zone-title">
                    <div className="zone-dot" style={{ backgroundColor: zone.color }} />
                    <h3>{zone.name}</h3>
                    <span className="zone-count">{zone.scales.length} escalas</span>
                    {radialScales.length > 0 && (
                        <span className="zone-radial-count">
                            <Settings size={12} />
                            {radialScales.length} represos
                        </span>
                    )}
                </div>
                <div className="zone-summary">
                    <div className="summary-stat">
                        <Droplets size={16} style={{ color: zone.color }} />
                        <span className="stat-value">{avgLevel.toFixed(2)}m</span>
                        <span className="stat-label">Promedio</span>
                    </div>
                    {totalGasto > 0 && (
                        <div className="summary-stat">
                            <Waves size={16} style={{ color: '#0ea5e9' }} />
                            <span className="stat-value" style={{ color: '#0ea5e9' }}>{totalGasto.toFixed(2)}</span>
                            <span className="stat-label">m³/s Total</span>
                        </div>
                    )}
                    {hasWarning && (
                        <div className="zone-warning">
                            <AlertTriangle size={14} />
                        </div>
                    )}
                </div>
            </div>

            <div className="zone-gauges">
                {zone.scales.map(scale => (
                    <ScaleGauge key={scale.id} scale={scale} zoneColor={zone.color} onOpenModal={onOpenModal} />
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
    const [selectedScaleModal, setSelectedScaleModal] = useState<ScaleReading | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function fetchData() {
            setLoading(true);
            setError(null);

            // 1. Fetch Configs and Base Scales
            const { data: escalasBase, error: e1 } = await supabase
                .from('escalas')
                .select('id, nombre, km, seccion_id, nivel_min_operativo, nivel_max_operativo, capacidad_max, pzas_radiales, ancho, alto, activa, secciones(id, nombre, color)')
                .eq('activa', true)
                .order('km');

            if (e1) { console.error("Error escalasBase:", e1); setError(e1.message); setLoading(false); return; }
            if (cancelled) return;

            const configMap = new Map<string, EscalaConfig>();
            (escalasBase || []).forEach((e: any) => {
                const key = e.id.trim().toUpperCase();
                configMap.set(key, {
                    id: e.id,
                    pzas_radiales: Number(e.pzas_radiales) || 0,
                    ancho: Number(e.ancho) || 0,
                    alto: Number(e.alto) || 0,
                });
            });

            // 2. Traer lecturas recientes (Últimos 1000 para asegurar continuidad amplia)
            const { data: lecturasRaw, error: e2 } = await supabase
                .from('lecturas_escalas')
                .select('escala_id, nivel_m, nivel_abajo_m, apertura_radiales_m, radiales_json, gasto_calculado_m3s, hora_lectura, fecha, creado_en')
                .order('creado_en', { ascending: false })
                .limit(1000);

            if (e2) console.error("Error lecturasRaw:", e2);

            const lecturasMap = new Map<string, LecturaRadial>();
            (lecturasRaw || []).forEach((l: any) => {
                const key = l.escala_id.trim().toUpperCase();
                if (!lecturasMap.has(key)) {
                    let parsedRadiales = l.radiales_json;
                    if (typeof l.radiales_json === 'string') {
                        try { parsedRadiales = JSON.parse(l.radiales_json); } catch(e) { console.error("Error parsing radiales_json", e); }
                    }

                    lecturasMap.set(key, {
                        escala_id: l.escala_id,
                        nivel_m: Number(l.nivel_m) || 0,
                        nivel_abajo_m: Number(l.nivel_abajo_m) || 0,
                        apertura_radiales_m: Number(l.apertura_radiales_m) || 0,
                        radiales_json: parsedRadiales || null,
                        gasto_calculado_m3s: Number(l.gasto_calculado_m3s) || 0,
                        hora_lectura: l.hora_lectura || '',
                        fecha: l.fecha,
                    });
                }
            });

            // 3. Resumen diario para la fecha seleccionada
            const { data: resumenData, error: e3 } = await supabase
                .from('resumen_escalas_diario')
                .select('*')
                .eq('fecha', fechaSeleccionada);

            if (e3) console.error("Error resumenData:", e3);
            if (cancelled) return;

            const resumenMap = new Map<string, any>();
            (resumenData || []).forEach(r => resumenMap.set(r.escala_id.trim().toUpperCase(), r));

            // 4. Merge Logic - Logica de CONTINUIDAD (Regla: "Un dato, una sola verdad")
            const mapped: ResumenEscala[] = (escalasBase || []).map((e: any) => {
                const key = e.id.trim().toUpperCase();
                const res = resumenMap.get(key);
                const last = lecturasMap.get(key);

                // Fallback prioritario: Si no hay resumen, usar el dato más reciente
                return {
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
                    lectura_am: res?.lectura_am != null ? Number(res.lectura_am) : (last?.nivel_m ?? null),
                    lectura_pm: res?.lectura_pm != null ? Number(res.lectura_pm) : null,
                    hora_am: res?.hora_am || last?.hora_lectura || null,
                    hora_pm: res?.hora_pm || null,
                    nivel_actual: res?.nivel_actual != null ? Number(res.nivel_actual) : (last?.nivel_m ?? null),
                    delta_12h: res?.delta_12h != null ? Number(res.delta_12h) : 0,
                    estado: res?.estado || (last ? 'continuo' : 'sin_captura'),
                };
            });

            setZones(mapResumenToZones(mapped, configMap, lecturasMap));
            setLoading(false);
        }

        fetchData();

        // Realtime Subscription for Live Updates
        const channel = supabase.channel('realtime_escalas')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'lecturas_escalas' },
                () => {
                    console.log('🔄 Cambio detectado en lecturas_escalas. Refrescando...');
                    fetchData();
                }
            )
            .subscribe();

        return () => {
            cancelled = true;
            supabase.removeChannel(channel);
        };
    }, [fechaSeleccionada]);

    // Calculate overall stats
    const allScales = zones.flatMap(z => z.scales);
    const totalScales = allScales.length;
    const warningCount = allScales.filter(s => s.currentLevel < s.minOperational || s.currentLevel > s.maxOperational).length;
    const avgDelta = totalScales > 0
        ? allScales.reduce((sum, s) => sum + (s.pmReading - s.amReading), 0) / totalScales
        : 0;
    const totalRadiales = allScales.filter(s => s.pzasRadiales > 0).length;
    const totalGasto = allScales.reduce((sum, s) => sum + s.gastoCalculado, 0);

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
                    <h2 className="text-2xl font-bold text-white">Control de Niveles y Represos</h2>
                    <p className="text-slate-400 text-sm">Monitoreo de Niveles Operativos y Compuertas Radiales (Km 0 - Km 104)</p>
                </div>

                {/* Quick Stats */}
                <div className="header-stats">
                    <div className="stat-chip">
                        <Gauge size={16} />
                        <span>{totalScales} Escalas</span>
                    </div>
                    <div className="stat-chip" style={{ color: '#0ea5e9', borderColor: 'rgba(14,165,233,0.3)', backgroundColor: 'rgba(14,165,233,0.1)' }}>
                        <Settings size={16} />
                        <span>{totalRadiales} Represos</span>
                    </div>
                    <div className={`stat-chip ${warningCount > 0 ? 'warning' : 'success'}`}>
                        <Activity size={16} />
                        <span>{warningCount} Alertas</span>
                    </div>
                    <div className={`stat-chip ${avgDelta >= 0 ? 'rising' : 'falling'}`}>
                        {avgDelta >= 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                        <span>Δ {avgDelta >= 0 ? '+' : ''}{avgDelta.toFixed(2)}m (12h)</span>
                    </div>
                    {totalGasto > 0 && (
                        <div className="stat-chip" style={{ color: '#0ea5e9', borderColor: 'rgba(14,165,233,0.3)', backgroundColor: 'rgba(14,165,233,0.1)' }}>
                            <Waves size={16} />
                            <span>Q Total: {totalGasto.toFixed(2)} m³/s</span>
                        </div>
                    )}
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
                    <ZoneCard key={zone.id} zone={zone} onOpenModal={setSelectedScaleModal} />
                ))}
            </div>

            {zones.length === 0 && !loading && (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-muted)' }}>
                    <Gauge size={48} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
                    <p>No hay lecturas de escalas para esta fecha.</p>
                    <p style={{ fontSize: '0.8rem' }}>Selecciona otra fecha o captura nuevas lecturas.</p>
                </div>
            )}

            {/* Modal de Radiales */}
            {selectedScaleModal && (
                <RadialModal scale={selectedScaleModal} onClose={() => setSelectedScaleModal(null)} />
            )}
        </div>
    );
};

export default ControlEscalas;
