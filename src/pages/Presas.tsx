import { useState } from 'react';
import {
    MapPin, Droplets, Activity, TrendingUp, TrendingDown, Minus,
    AlertTriangle, CheckCircle, Camera, Signature, ExternalLink,
    Gauge, Waves, Settings, ThermometerSun, Clock, Printer, Upload, Loader,
    Map
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, Cell
} from 'recharts';
import './Presas.css';
import ReservoirViz from '../components/ReservoirViz';
import { useFecha } from '../context/FechaContext';
import { usePresas, type PresaData, type PuntoCurva, type ClimaPresaData, type AforoDiarioData } from '../hooks/usePresas';

// --- Hidro-Sincronía 2.0: Advanced Analytics Components ---

const HydroFlowDiagram = ({ presa }: { presa: PresaData }) => {
    return (
        <div className="technical-card h-40 flex items-center justify-center relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 pointer-events-none">
                <svg width="100%" height="100%" viewBox="0 0 400 200">
                    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="white" strokeWidth="0.5" />
                    </pattern>
                    <rect width="100%" height="100%" fill="url(#grid)" />
                </svg>
            </div>
            {/* Hydraulic Logic Minimalist Diagram */}
            <div className="flex items-center gap-8 z-10">
                <div className="flex flex-col items-center">
                    <div className="w-12 h-12 rounded-lg bg-blue-500/20 border border-blue-400 flex items-center justify-center">
                        <Waves size={24} className="text-blue-400" />
                    </div>
                    <span className="text-[9px] font-black uppercase text-blue-400 mt-2">Vaso</span>
                </div>
                <div className="flex-1 w-20 h-px bg-gradient-to-right from-blue-400 to-emerald-400 relative">
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] font-mono font-bold text-white">
                        {presa.lectura?.extraccion_total_m3s?.toFixed(2) || '0.00'} m³/s
                    </div>
                    <div className="absolute top-1/2 left-0 w-2 h-2 rounded-full bg-blue-400 -translate-y-1/2 animate-ping" />
                </div>
                <div className="flex flex-col items-center">
                    <div className="w-12 h-12 rounded-lg bg-emerald-500/20 border border-emerald-400 flex items-center justify-center">
                        <Activity size={24} className="text-emerald-400" />
                    </div>
                    <span className="text-[9px] font-black uppercase text-emerald-400 mt-2">Canal Riego</span>
                </div>
            </div>
        </div>
    );
};

const ExtractionStreamgraph = ({ presa: _presa }: { presa: PresaData }) => {
    // Generate dummy historical trend for "Streamgraph" visualization effect
    const data = [
        { name: '00:00', baja: 10, cfe: 5, izq: 8, der: 12 },
        { name: '04:00', baja: 12, cfe: 4, izq: 10, der: 15 },
        { name: '08:00', baja: 25, cfe: 2, izq: 22, der: 28 },
        { name: '12:00', baja: 30, cfe: 2, izq: 25, der: 32 },
        { name: '16:00', baja: 28, cfe: 3, izq: 20, der: 30 },
        { name: '20:00', baja: 15, cfe: 8, izq: 12, der: 18 },
    ];

    return (
        <div className="h-48 w-full mt-4 bg-black/20 rounded-xl p-4 border border-white/5">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} stackOffset="silhouette">
                    <XAxis dataKey="name" hide />
                    <Tooltip
                        contentStyle={{ backgroundColor: '#020617', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px' }}
                        itemStyle={{ fontFamily: 'JetBrains Mono', fontSize: '12px' }}
                    />
                    <Area type="monotone" dataKey="baja" stackId="1" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.6} />
                    <Area type="monotone" dataKey="cfe" stackId="1" stroke="#818cf8" fill="#818cf8" fillOpacity={0.6} />
                    <Area type="monotone" dataKey="izq" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.6} />
                    <Area type="monotone" dataKey="der" stackId="1" stroke="#fbbf24" fill="#fbbf24" fillOpacity={0.6} />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
};

const EfficiencyHeatmap = () => {
    // 7 days x 6 quadrants (approximate for layout)
    const days = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

    return (
        <div className="mt-4">
            <div className="grid grid-cols-7 gap-1">
                {days.map((d, i) => (
                    <div key={i} className="text-[8px] font-black text-slate-600 text-center uppercase">{d}</div>
                ))}
            </div>
            <div className="grid grid-cols-7 gap-1 mt-1">
                {Array.from({ length: 42 }).map((_, i) => {
                    const intensity = Math.random(); // Dummy intensity for Heatmap effect
                    return (
                        <div
                            key={i}
                            className="aspect-square rounded-[2px] border border-white/5 transition-colors hover:border-white/20"
                            style={{
                                backgroundColor: intensity > 0.8 ? '#10b981' :
                                    intensity > 0.5 ? '#059669' :
                                        intensity > 0.2 ? '#064e3b' : '#020617',
                                opacity: 0.8
                            }}
                            title={`Nivel de Eficiencia: ${(intensity * 100).toFixed(0)}%`}
                        />
                    );
                })}
            </div>
        </div>
    );
};

// --- Technical Helper Components ---

const TempRangeBar = ({ min, max }: { min: number, max: number }) => {
    // scale: 0C to 45C (typical range in Delicias)
    const start = Math.max(0, (min / 45) * 100);
    const end = Math.min(100, (max / 45) * 100);
    const width = end - start;

    return (
        <div className="flex flex-col w-full gap-1">
            <div className="flex justify-between text-[10px] font-bold text-slate-500">
                <span>0°C</span>
                <span>45°C</span>
            </div>
            <div className="temp-range-container">
                <div
                    className="temp-range-bar"
                    style={{ left: `${start}%`, width: `${width}%` }}
                />
                <div className="temp-indicator" style={{ left: `${start}%` }} />
                <div className="temp-indicator" style={{ left: `${end}%` }} />
            </div>
            <div className="flex justify-between text-[12px] font-black text-white font-mono">
                <span>{min.toFixed(1)}°</span>
                <span>{max.toFixed(1)}°</span>
            </div>
        </div>
    );
};

const Compass = ({ direction }: { direction: string }) => {
    const directions: Record<string, number> = {
        'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5,
        'E': 90, 'ESE': 112.5, 'SE': 135, 'SSE': 157.5,
        'S': 180, 'SSW': 202.5, 'SW': 225, 'WSW': 247.5,
        'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5
    };
    const rotation = directions[direction.toUpperCase()] || 0;

    return (
        <div className="flex items-center gap-3">
            <div className="compass-container">
                <div className="compass-needle" style={{ transform: `rotate(${rotation}deg)` }} />
                <span className="absolute top-0 text-[8px] text-slate-500 font-bold">N</span>
            </div>
            <span className="text-xs font-bold text-white uppercase">{direction}</span>
        </div>
    );
};

const MiniMetricChart = ({ label, value, unit, color }: { label: string, value: number, unit: string, color: string }) => {
    const data = [{ v: value }, { v: 10 - value }]; // Dummy for visual pulse
    return (
        <div className="technical-card flex flex-col gap-2">
            <span className="mini-chart-label">{label}</span>
            <div className="flex items-end justify-between">
                <span className="mini-chart-value">{value.toFixed(1)} <small className="text-[10px] opacity-50">{unit}</small></span>
                <div className="w-12 h-8">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data}>
                            <Bar dataKey="v" radius={[2, 2, 0, 0]}>
                                <Cell fill={color} opacity={0.8} />
                                <Cell fill="rgba(255,255,255,0.05)" />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
};

// Component: Dam Card
const DamCard = ({ presa, climaObj, aforoObj }: { presa: PresaData, climaObj?: ClimaPresaData, aforoObj?: AforoDiarioData }) => {
    const lect = presa.lectura;
    const elevacion = lect?.escala_msnm || 0;
    const almacenamiento = lect?.almacenamiento_mm3 || 0;
    const pctLlenado = lect?.porcentaje_llenado || 0;
    const extraccion = lect?.extraccion_total_m3s || 0;

    // Determine trend from data
    const trend = extraccion > 30 ? 'rising' : extraccion > 0 ? 'stable' : 'falling';
    const TrendIcon = trend === 'rising' ? TrendingUp : trend === 'falling' ? TrendingDown : Minus;
    const trendColor = trend === 'rising' ? '#10b981' : trend === 'falling' ? '#ef4444' : '#94a3b8';

    // Breakdown of extraction
    const gastos = [
        { name: 'Toma Baja', value: lect?.gasto_toma_baja_m3s },
        { name: 'CFE', value: lect?.gasto_cfe_m3s },
        { name: 'Toma Izq', value: lect?.gasto_toma_izq_m3s },
        { name: 'Toma Der', value: lect?.gasto_toma_der_m3s },
    ].filter(g => g.value != null && g.value > 0);

    return (
        <div className="dam-card">
            {/* Section 1: Identification */}
            <div className="dam-header">
                <div className="dam-title">
                    <Waves size={24} className="text-blue-400" />
                    <div>
                        <h2>{presa.nombre}</h2>
                        <p className="dam-subtitle">{presa.rio} • {presa.municipio}</p>
                    </div>
                </div>
                <a
                    href={`https://maps.google.com/?q=${presa.latitud},${presa.longitud}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="location-link"
                >
                    <MapPin size={14} />
                    Ver en Mapa
                    <ExternalLink size={12} />
                </a>
            </div>
            <div className="dam-type-badge">{presa.tipo_cortina}</div>

            {/* Section 2: Design Parameters from curva_capacidad */}
            <div className="params-section">
                <h3><Settings size={16} /> Parámetros de Diseño</h3>
                <table className="params-table">
                    <thead>
                        <tr>
                            <th>Parámetro</th>
                            <th>Elevación (msnm)</th>
                            <th>Volumen (Mm³)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr className="name-row">
                            <td>Corona</td>
                            <td>{presa.elevacion_corona_msnm.toFixed(2)}</td>
                            <td>—</td>
                        </tr>
                        <tr className="namo-row">
                            <td>NAMO (100%)</td>
                            <td>{presa.curva_capacidad.length > 0 ? presa.curva_capacidad[presa.curva_capacidad.length - 1].elevacion_msnm.toFixed(2) : '—'}</td>
                            <td>{presa.capacidad_max_mm3.toFixed(1)}</td>
                        </tr>
                        {presa.curva_capacidad.length > 0 && (
                            <tr>
                                <td>Punto Inferior Curva</td>
                                <td>{presa.curva_capacidad[0].elevacion_msnm.toFixed(2)}</td>
                                <td>{presa.curva_capacidad[0].volumen_mm3.toFixed(1)}</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Section 3: Real-Time Status */}
            <div className="status-section">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="m-0"><Activity size={16} /> Estado Hidráulico Autorizado</h3>
                    {lect && (
                        <div className="reading-timestamp m-0">
                            <Clock size={12} />
                            <span>{lect.fecha}{lect.responsable ? ` — ${lect.responsable}` : ''}</span>
                        </div>
                    )}
                </div>

                {/* Variation Parsing for "Hidro-Sincronía 2.0" */}
                {(() => {
                    const difElev = lect?.notas?.match(/Dif Elev: ([-\d.]+)m/)?.[1];
                    const difVol = lect?.notas?.match(/Dif Vol: ([-\d.]+)Mm3/)?.[1];

                    if (!difElev && !difVol) return null;

                    return (
                        <div className="variations-banner flex gap-4 mb-4 p-3 bg-blue-500/5 rounded-xl border border-blue-500/20">
                            {difElev && (
                                <div className="flex-1 flex flex-col items-center border-r border-blue-500/10">
                                    <span className="text-[8px] font-black uppercase text-slate-500 tracking-widest mb-1">Δ Variación Elevación (24h)</span>
                                    <div className={`flex items-center gap-1 font-mono font-black text-xs ${Number(difElev) > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {Number(difElev) > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                        {difElev} m
                                    </div>
                                </div>
                            )}
                            {difVol && (
                                <div className="flex-1 flex flex-col items-center">
                                    <span className="text-[8px] font-black uppercase text-slate-500 tracking-widest mb-1">Δ Variación Volumen (24h)</span>
                                    <div className={`flex items-center gap-1 font-mono font-black text-xs ${Number(difVol) > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {Number(difVol) > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                        {difVol} Mm³
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })()}

                <div className="status-grid">
                    <div className="status-metric">
                        <span className="metric-label flex items-center gap-1"><Gauge size={12} /> Elevación Actual</span>
                        <span className="metric-value elevation font-black font-mono tracking-tighter">{elevacion.toFixed(2)}</span>
                        <span className="metric-unit">msnm</span>
                    </div>
                    <div className="status-metric">
                        <span className="metric-label flex items-center gap-1"><Waves size={12} /> Almacenamiento</span>
                        <span className="metric-value storage font-black font-mono tracking-tighter">{almacenamiento.toFixed(1)}</span>
                        <span className="metric-unit">Mm³</span>
                    </div>
                    <div className="status-metric">
                        <span className="metric-label flex items-center gap-1"><Activity size={12} /> % Llenado (NAMO)</span>
                        <div className="fill-gauge">
                            <div className="fill-bar" style={{ width: `${Math.min(pctLlenado, 100)}%` }} />
                            <span className="fill-value font-black font-mono">{pctLlenado.toFixed(1)}%</span>
                        </div>
                    </div>
                    <div className="status-metric">
                        <span className="metric-label">Tendencia Hidráulica</span>
                        <div className="trend-indicator" style={{ color: trendColor }}>
                            <TrendIcon size={20} />
                            <span className="font-black italic">{trend === 'rising' ? 'Ascendente' : trend === 'falling' ? 'Sin extracción' : 'Estable'}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Section 4: Extraction Control */}
            <div className="extraction-section">
                <h3><Gauge size={16} /> Extracción de Presa</h3>

                <div className="extraction-grid">
                    <div className="extraction-main">
                        <span className="extraction-label">Extracción Obra de Toma (Q)</span>
                        <div className="extraction-value-box">
                            <span className="extraction-value">{extraccion > 0 ? extraccion.toFixed(1) : lect?.notas?.includes('Cerrada') ? 'Cerrada' : '0'}</span>
                            <span className="extraction-unit">{extraccion > 0 ? 'm³/s' : ''}</span>
                        </div>
                        <span className="destination-tag">→ Canal Principal</span>
                    </div>

                    {gastos.length > 0 && (
                        <div className="valves-panel">
                            <span className="valves-title">Desglose de Compuertas</span>
                            {gastos.map(g => (
                                <div key={g.name} className="valve-row">
                                    <span className="valve-name">{g.name}</span>
                                    <div className="valve-bar-container">
                                        <div className="valve-bar" style={{ width: `${extraccion > 0 ? ((g.value! / extraccion) * 100) : 0}%` }} />
                                    </div>
                                    <span className="valve-percent">{g.value!.toFixed(1)} m³/s</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Nuevo: Datos Climatológicos (CONAGUA Premium) */}
            {climaObj && (
                <div className="mt-8 border-t border-slate-700/50 pt-8">
                    <h3 className="flex items-center gap-2 text-blue-400 font-black mb-6 uppercase text-xs tracking-[0.2em] shadow-sm">
                        <ThermometerSun size={16} /> Estación Climatológica Autorizada
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="technical-card">
                            <span className="mini-chart-label flex items-center gap-1"><ThermometerSun size={12} /> Oscilación Térmica</span>
                            <div className="mt-4 px-2">
                                <TempRangeBar
                                    min={Number(climaObj.temp_minima_c || 0)}
                                    max={Number(climaObj.temp_maxima_c || 0)}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <MiniMetricChart
                                label="Precipitación"
                                value={Number(climaObj.precipitacion_mm || 0)}
                                unit="mm"
                                color="#60a5fa"
                            />
                            <MiniMetricChart
                                label="Evaporación"
                                value={Number(climaObj.evaporacion_mm || 0)}
                                unit="mm"
                                color="#fbbf24"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
                        <div className="technical-card flex items-center justify-between">
                            <span className="mini-chart-label">Viento</span>
                            <Compass direction={climaObj.dir_viento || 'N'} />
                        </div>
                        <div className="technical-card flex flex-col">
                            <span className="mini-chart-label">Visibilidad</span>
                            <span className="text-sm font-bold text-white mt-1">{climaObj.visibilidad || '--'}</span>
                        </div>
                        <div className="technical-card flex flex-col col-span-2 lg:col-span-1">
                            <span className="mini-chart-label">Estado del Tiempo</span>
                            <div className="flex gap-2 items-center mt-1">
                                <span className="text-xs font-bold text-white uppercase italic">{climaObj.edo_tiempo || '--'}</span>
                                <span className="text-[10px] text-slate-500 font-bold px-1.5 py-0.5 bg-white/5 rounded">PREV: {climaObj.edo_tiempo_24h || '--'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Nuevo: Aforos Principales (CONAGUA) */}
            {aforoObj && (
                <div className="mt-4">
                    <h3 className="flex items-center gap-2 text-emerald-400 font-bold mb-3 uppercase text-xs tracking-widest"><Map size={16} /> Aforo Principal Reportado</h3>
                    <div className="flex items-center gap-6 bg-slate-800/80 p-4 rounded-xl border-l-4 border-emerald-500 shadow-inner">
                        <div className="flex-1">
                            <span className="text-xs text-slate-400 uppercase tracking-widest font-bold">Estación Oficial</span>
                            <p className="text-lg font-bold text-white leading-none mt-1">{aforoObj.estacion}</p>
                        </div>
                        <div className="flex flex-col px-4 border-l border-slate-600">
                            <span className="text-[10px] uppercase text-slate-500 font-bold">Escala</span>
                            <span className="text-lg font-mono text-white">{aforoObj.escala ? aforoObj.escala.toFixed(2) : '--'} m</span>
                        </div>
                        <div className="flex flex-col px-4 border-l border-slate-600">
                            <span className="text-[10px] uppercase text-emerald-500 font-bold">Gasto</span>
                            <span className="text-lg font-mono text-emerald-400 font-bold">{aforoObj.gasto_m3s ? aforoObj.gasto_m3s.toFixed(2) : '--'} <span className="text-sm">m³/s</span></span>
                        </div>
                    </div>
                </div>
            )}

            {/* Section 5: Area & Safety */}
            {lect && lect.area_ha > 0 && (
                <div className="safety-section mt-4">
                    <div className="safety-grid">
                        <div className="safety-indicator">
                            <Droplets size={16} />
                            <span>Espejo de agua: {lect.area_ha.toLocaleString()} ha</span>
                        </div>
                        {lect.notas && (
                            <div className="safety-indicator">
                                <CheckCircle size={16} />
                                <span>{lect.notas}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Analytics Section: Streamgraph & Flow Diagram */}
            <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6 pt-8 border-t border-white/5">
                <div>
                    <h4 className="mini-chart-label mb-2 flex items-center gap-2">
                        <Activity size={14} className="text-blue-400" /> Tendencia de Extracción (Streamgraph)
                    </h4>
                    <p className="text-[10px] text-slate-500 mb-4 uppercase tracking-[0.2em]">Balance dinámico de gasto por sección (24h).</p>
                    <ExtractionStreamgraph presa={presa} />
                </div>
                <div>
                    <h4 className="mini-chart-label mb-2 flex items-center gap-2">
                        <Waves size={14} className="text-emerald-400" /> Hidro-Sincronía: Diagrama de Flujo
                    </h4>
                    <p className="text-[10px] text-slate-500 mb-4 uppercase tracking-[0.2em]">Representación esquemática del balance hídrico actual.</p>
                    <HydroFlowDiagram presa={presa} />
                </div>
            </div>

            <div className="mt-8 pt-8 border-t border-white/5">
                <h4 className="mini-chart-label mb-2 flex items-center gap-2">
                    <Gauge size={14} className="text-amber-400" /> Mapa de Calor: Eficiencia de Aforo Semanal
                </h4>
                <p className="text-[10px] text-slate-500 mb-4 uppercase tracking-[0.2em]">Intensidad de uso y estabilidad de tirantes por cuadrante temporal.</p>
                <div className="technical-card">
                    <EfficiencyHeatmap />
                </div>
            </div>

            {/* Section 6: Audit Evidence */}
            <div className="audit-section mt-12">
                <div className="audit-grid">
                    <div className="photo-placeholder">
                        <Camera size={24} />
                        <span>Foto Escala Ammerman</span>
                    </div>
                    <div className="photo-placeholder">
                        <Camera size={24} />
                        <span>Foto Obra de Toma</span>
                    </div>
                    <div className="signature-box flex-1 min-w-[200px]">
                        <Signature size={16} />
                        <span className="signature-label">Auditor CONAGUA/SRL:</span>
                        <span className="signature-name font-mono">{lect?.responsable || 'Taide Ramírez'}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Main Component
const Presas = () => {
    const { fechaSeleccionada } = useFecha();
    const { presas, clima, aforos, loading, error } = usePresas(fechaSeleccionada);
    const [selectedDamId, setSelectedDamId] = useState<string | null>(null);

    // Auto-select first dam when data arrives
    const currentDam = presas.find(p => p.id === selectedDamId) || presas[0];

    // Delicias general weather summary
    const deliciasClima = clima.find(c => c.presa_id === 'PRE-003');
    const deliciasAforo = aforos.find(a => a.estacion === 'Km 104');

    if (loading && presas.length === 0) {
        return (
            <div className="presas-container flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-3 text-slate-400">
                    <Loader size={32} className="animate-spin text-blue-400" />
                    <span className="text-sm font-medium">Cargando datos de presas y clima oficial...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="presas-container flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-3 text-red-400">
                    <AlertTriangle size={32} />
                    <span className="text-sm">Error: {error}</span>
                </div>
            </div>
        );
    }

    if (!currentDam) return null;

    // Matching objects logic
    const currentClima = clima.find(c => c.presa_id === currentDam.id);
    const estAforo = currentDam.id === 'PRE-001' ? 'Km 0+580' : 'Km 106';
    const currentAforo = aforos.find(a => a.estacion === estAforo);

    // Prepare capacity curve chart data from Supabase
    const curvaData = currentDam.curva_capacidad.map((c: PuntoCurva) => ({
        elevation: c.elevacion_msnm,
        volume: c.volumen_mm3,
    }));

    return (
        <div className="presas-container">
            <header className="page-header flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Activity className="text-blue-400" />
                        Reporte Diario CONAGUA
                    </h2>
                    <p className="text-slate-400 text-sm">Validación visual de Presas, Clima y Aforos de Control • {fechaSeleccionada}</p>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                    {/* Actions Group */}
                    <div className="flex items-center gap-3">
                        <div className="conagua-badge">
                            <CheckCircle size={12} /> Oficial
                        </div>
                        <Link to="/importar" className="btn-premium-action">
                            <Upload size={14} />
                            <span>Capturar Documento</span>
                        </Link>
                        <a href="#" className="btn-secondary-action">
                            <Printer size={14} />
                            <span>Imprimir</span>
                        </a>
                    </div>

                    {/* Dam Selector Group */}
                    <div className="dam-selector-modern">
                        {presas.map(p => (
                            <button
                                key={p.id}
                                className={(selectedDamId || presas[0]?.id) === p.id ? 'active' : ''}
                                onClick={() => setSelectedDamId(p.id)}
                            >
                                <Waves size={14} />
                                <span>{p.nombre_corto}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            <div className="presas-layout">
                {/* Main Dam Card */}
                <div className="dam-main">
                    <DamCard presa={currentDam} climaObj={currentClima} aforoObj={currentAforo} />

                    {/* Dynamic Reservoir Visualization */}
                    <ReservoirViz
                        percent={currentDam.lectura?.porcentaje_llenado || 0}
                        storageMm3={currentDam.lectura?.almacenamiento_mm3 || 0}
                        maxStorageMm3={currentDam.capacidad_max_mm3}
                        areaHa={currentDam.lectura?.area_ha || 0}
                        elevationMsnm={currentDam.lectura?.escala_msnm || 0}
                        damName={currentDam.nombre_corto}
                    />
                </div>

                {/* Charts Sidebar */}
                <div className="charts-sidebar">
                    {/* Nuevo: Resumen Climatológico Delicias */}
                    {(deliciasClima || deliciasAforo) && (
                        <section className="delicias-summary-card mb-4 border border-slate-700/60 transition-all hover:border-slate-500/50">
                            <div className="bg-slate-800/40 p-4 flex items-center justify-between border-b border-white/5 backdrop-blur-md">
                                <h3 className="text-xs text-slate-200 font-black m-0 flex items-center gap-2 uppercase tracking-tighter">
                                    <ThermometerSun size={18} className="text-amber-500" />
                                    Delicias (Sede)
                                </h3>
                                <div className="text-[10px] bg-blue-500/10 border border-blue-500/20 px-2 py-1 rounded-full text-blue-400 font-bold">
                                    {fechaSeleccionada}
                                </div>
                            </div>

                            {deliciasClima && (
                                <div className="p-6 grid grid-cols-2 gap-4 text-sm divide-x divide-white/5">
                                    <div className="flex flex-col gap-1 items-center">
                                        <span className="text-[10px] text-slate-500 uppercase font-black text-center tracking-widest mb-1">Clima Actual</span>
                                        <div className="clima-value-main">
                                            {deliciasClima.temp_ambiente_c != null ? Number(deliciasClima.temp_ambiente_c).toFixed(1) : '--'}°
                                        </div>
                                        <span className="text-xs text-white/90 font-bold bg-white/5 px-2 py-0.5 rounded-md mt-1 italic">{deliciasClima.edo_tiempo || '--'}</span>
                                    </div>
                                    <div className="flex flex-col gap-2 pl-6 items-center justify-center">
                                        <span className="text-[10px] text-slate-500 uppercase font-black text-center tracking-widest">Ayer (24H)</span>
                                        <div className="text-sm text-slate-400 font-bold bg-slate-900/50 px-3 py-1.5 rounded-lg border border-white/5 text-center">
                                            {deliciasClima.edo_tiempo_24h || '--'}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {deliciasAforo && (
                                <div className="aforo-summary-box shadow-inner">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-emerald-500/10 rounded-lg">
                                            <Map size={16} className="text-emerald-400" />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-black text-slate-500 uppercase leading-none">Canal Km 104</span>
                                            <span className="text-xs font-bold text-slate-300">Aforo Principal</span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xl font-mono text-emerald-400 font-black">
                                            {deliciasAforo.gasto_m3s ? Number(deliciasAforo.gasto_m3s).toFixed(2) : '--'}
                                        </div>
                                        <div className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest">m³/s</div>
                                    </div>
                                </div>
                            )}
                        </section>
                    )}

                    {/* Section 5: Elevation-Capacity Curve from Supabase curvas_capacidad */}
                    <section className="chart-card">
                        <h3>Curva Elevación-Capacidades</h3>
                        <div className="chart-container">
                            <ResponsiveContainer width="100%" height={200}>
                                <AreaChart data={curvaData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorCapacity" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="volume" tick={{ fill: '#94a3b8', fontSize: 10 }} tickFormatter={(v) => `${v}`} />
                                    <YAxis dataKey="elevation" tick={{ fill: '#94a3b8', fontSize: 10 }} domain={['dataMin', 'dataMax']} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                        labelFormatter={(v) => `Vol: ${v} Mm³`}
                                        formatter={(v: any) => [`${Number(v).toFixed(2)} msnm`, 'Elevación']}
                                    />
                                    <Area type="monotone" dataKey="elevation" stroke="#3b82f6" fill="url(#colorCapacity)" />
                                </AreaChart>
                            </ResponsiveContainer>
                            {/* Current level marker */}
                            <div className="current-marker">
                                <div className="marker-dot" />
                                <span>Nivel Actual: {(currentDam.lectura?.escala_msnm || 0).toFixed(2)} msnm</span>
                            </div>
                        </div>
                    </section>

                    {/* Section: Storage Comparative Analytic Chart */}
                    <section className="chart-card">
                        <h3>Comparativa de Almacenamiento</h3>
                        <div className="storage-comparison-viz mt-4">
                            <ResponsiveContainer width="100%" height={150}>
                                <BarChart
                                    data={presas.map(p => ({
                                        name: p.nombre_corto,
                                        volume: p.lectura?.almacenamiento_mm3 || 0,
                                        capacity: p.capacidad_max_mm3,
                                        pct: p.lectura?.porcentaje_llenado || 0
                                    }))}
                                    layout="vertical"
                                    barSize={20}
                                    margin={{ left: 0, right: 40 }}
                                >
                                    <XAxis type="number" hide domain={[0, 'dataMax']} />
                                    <YAxis
                                        dataKey="name"
                                        type="category"
                                        tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }}
                                        width={80}
                                    />
                                    <Tooltip
                                        cursor={{ fill: 'transparent' }}
                                        content={({ active, payload }) => {
                                            if (active && payload && payload.length) {
                                                const data = payload[0].payload;
                                                return (
                                                    <div className="bg-slate-900 border border-slate-700 p-2 rounded shadow-xl">
                                                        <p className="text-[10px] font-black text-white uppercase">{data.name}</p>
                                                        <p className="text-xs text-blue-400 font-mono">{data.volume.toFixed(1)} / {data.capacity.toFixed(0)} Mm³</p>
                                                        <p className="text-xs text-emerald-500 font-black">{data.pct.toFixed(1)}% Llenado</p>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                    <Bar dataKey="volume" radius={[0, 4, 4, 0]}>
                                        {presas.map((p, index) => {
                                            const pct = p.lectura?.porcentaje_llenado || 0;
                                            return <Cell key={`cell-${index}`} fill={pct > 90 ? '#f59e0b' : '#3b82f6'} />;
                                        })}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="p-4 grid grid-cols-2 gap-2">
                            {presas.map(p => (
                                <div key={`stat-${p.id}`} className="flex flex-col">
                                    <span className="text-[9px] text-slate-500 uppercase font-black">{p.nombre_corto}</span>
                                    <span className="text-xs font-bold text-white">{(p.lectura?.porcentaje_llenado || 0).toFixed(1)}%</span>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};

export default Presas;
