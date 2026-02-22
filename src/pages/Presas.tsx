import { useState } from 'react';
import {
    MapPin, Droplets, Activity, TrendingUp, TrendingDown, Minus,
    AlertTriangle, CheckCircle, Camera, Signature, ExternalLink,
    Gauge, Waves, Settings, ThermometerSun, Clock, Printer, Upload, Loader
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import './Presas.css';
import ReservoirViz from '../components/ReservoirViz';
import { useFecha } from '../context/FechaContext';
import { usePresas, type PresaData, type PuntoCurva } from '../hooks/usePresas';

// Component: Dam Card
const DamCard = ({ presa }: { presa: PresaData }) => {
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
                <h3><Activity size={16} /> Estado Actual</h3>
                {lect && (
                    <div className="reading-timestamp">
                        <Clock size={12} />
                        <span>Lectura: {lect.fecha}{lect.responsable ? ` — ${lect.responsable}` : ''}</span>
                    </div>
                )}

                <div className="status-grid">
                    <div className="status-metric">
                        <span className="metric-label">Elevación Actual</span>
                        <span className="metric-value elevation">{elevacion.toFixed(2)}</span>
                        <span className="metric-unit">msnm</span>
                    </div>
                    <div className="status-metric">
                        <span className="metric-label">Almacenamiento</span>
                        <span className="metric-value storage">{almacenamiento.toFixed(1)}</span>
                        <span className="metric-unit">Mm³</span>
                    </div>
                    <div className="status-metric">
                        <span className="metric-label">% Llenado (NAMO)</span>
                        <div className="fill-gauge">
                            <div className="fill-bar" style={{ width: `${Math.min(pctLlenado, 100)}%` }} />
                            <span className="fill-value">{pctLlenado.toFixed(1)}%</span>
                        </div>
                    </div>
                    <div className="status-metric">
                        <span className="metric-label">Tendencia</span>
                        <div className="trend-indicator" style={{ color: trendColor }}>
                            <TrendIcon size={20} />
                            <span>{trend === 'rising' ? 'Ascendente' : trend === 'falling' ? 'Sin extracción' : 'Estable'}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Section 4: Extraction Control */}
            <div className="extraction-section">
                <h3><Gauge size={16} /> Control de Extracciones (Obra de Toma)</h3>

                <div className="extraction-grid">
                    <div className="extraction-main">
                        <span className="extraction-label">Gasto de Extracción (Q)</span>
                        <div className="extraction-value-box">
                            <span className="extraction-value">{extraccion.toFixed(1)}</span>
                            <span className="extraction-unit">m³/s</span>
                        </div>
                        <span className="destination-tag">→ Canal Principal Conchos</span>
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

            {/* Section 5: Area */}
            {lect && lect.area_ha > 0 && (
                <div className="safety-section">
                    <h3><ThermometerSun size={16} /> Datos Adicionales</h3>
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

            {/* Section 6: Audit Evidence */}
            <div className="audit-section">
                <h3><Camera size={16} /> Evidencia y Auditoría</h3>
                <div className="audit-grid">
                    <div className="photo-placeholder">
                        <Camera size={24} />
                        <span>Foto Escala Ammerman</span>
                    </div>
                    <div className="photo-placeholder">
                        <Camera size={24} />
                        <span>Foto Obra de Toma</span>
                    </div>
                    <div className="signature-box">
                        <Signature size={16} />
                        <span className="signature-label">Operador:</span>
                        <span className="signature-name">{lect?.responsable || 'Sin asignar'}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Main Component
const Presas = () => {
    const { fechaSeleccionada } = useFecha();
    const { presas, loading, error } = usePresas(fechaSeleccionada);
    const [selectedDamId, setSelectedDamId] = useState<string | null>(null);

    // Auto-select first dam when data arrives
    const currentDam = presas.find(p => p.id === selectedDamId) || presas[0];

    if (loading && presas.length === 0) {
        return (
            <div className="presas-container flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-3 text-slate-400">
                    <Loader size={32} className="animate-spin text-blue-400" />
                    <span className="text-sm font-medium">Cargando datos de presas...</span>
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
                        Gestión de Fuentes
                    </h2>
                    <p className="text-slate-400 text-sm">SICA-005 • Control de Presas del Distrito • {fechaSeleccionada}</p>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                    {/* Actions Group */}
                    <div className="flex items-center gap-2 bg-slate-800/80 p-1 rounded-lg border border-slate-700/50 backdrop-blur-sm">
                        <Link to="/importar" className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-xs font-medium transition-all shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40">
                            <Upload size={14} />
                            <span>Digitalizar</span>
                        </Link>
                        <div className="w-px h-4 bg-slate-700 mx-1"></div>
                        <Link to="/reporte-oficial" target="_blank" className="flex items-center gap-2 text-slate-300 hover:text-white px-2 py-1.5 rounded text-xs font-medium transition-colors hover:bg-slate-700/50">
                            <Printer size={14} />
                            <span>Imprimir</span>
                        </Link>
                    </div>

                    {/* Dam Selector Group */}
                    <div className="dam-selector flex bg-slate-900/50 p-1 rounded-lg border border-slate-800">
                        {presas.map(p => (
                            <button
                                key={p.id}
                                className={`px-4 py-1.5 rounded text-sm font-medium transition-all flex items-center gap-2 ${(selectedDamId || presas[0]?.id) === p.id
                                    ? 'bg-slate-700 text-white shadow-sm'
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                                    }`}
                                onClick={() => setSelectedDamId(p.id)}
                            >
                                <Waves size={14} className={(selectedDamId || presas[0]?.id) === p.id ? 'text-blue-400' : 'opacity-50'} />
                                <span>{p.nombre_corto}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            <div className="presas-layout">
                {/* Main Dam Card */}
                <div className="dam-main">
                    <DamCard presa={currentDam} />

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

                {/* Charts Section */}
                <div className="charts-sidebar">
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

                    {/* Storage summary */}
                    <section className="chart-card">
                        <h3>Resumen de Almacenamiento</h3>
                        <div className="p-4 space-y-3">
                            {presas.map(p => {
                                const pct = p.lectura?.porcentaje_llenado || 0;
                                const alm = p.lectura?.almacenamiento_mm3 || 0;
                                return (
                                    <div key={p.id} className="space-y-1">
                                        <div className="flex justify-between text-xs">
                                            <span className="text-slate-300 font-medium">{p.nombre_corto}</span>
                                            <span className="text-slate-400 font-mono">{alm.toFixed(1)} / {p.capacidad_max_mm3.toFixed(0)} Mm³</span>
                                        </div>
                                        <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full transition-all duration-700 rounded-full ${pct > 90 ? 'bg-amber-500' : pct > 50 ? 'bg-blue-500' : 'bg-blue-400'}`}
                                                style={{ width: `${Math.min(pct, 100)}%` }}
                                            />
                                        </div>
                                        <div className="text-right text-[10px] text-slate-500 font-mono">{pct.toFixed(1)}%</div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};

export default Presas;
