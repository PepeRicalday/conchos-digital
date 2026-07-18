import {
    Cloud, Sun, Wind, Droplets, Thermometer, AlertTriangle,
    TrendingDown, MapPin, RefreshCw,
    Leaf, Zap, Activity, Loader
} from 'lucide-react';
import {
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, Legend
} from 'recharts';
import './Clima.css';
import { useFecha } from '../context/FechaContext';
import { usePresas, type ClimaPresaData } from '../hooks/usePresas';
import { useClimaEstaciones, type EstacionConLectura } from '../hooks/useClimaEstaciones';
import { exportClimaReport } from '../utils/exportClimaReport';
import { Download } from 'lucide-react';

// Types for display
interface WeatherCondition {
    variable: string;
    current: string;
    forecast: string;
    impact: string;
    icon: React.ReactNode;
    status: 'normal' | 'warning' | 'alert';
}

interface TechnicalVariable {
    name: string;
    value: string;
    unit: string;
    description: string;
    icon: React.ReactNode;
}

// Build weather conditions from Supabase data
function buildConditions(climaRecords: ClimaPresaData[]): WeatherCondition[] {
    if (climaRecords.length === 0) return [];

    // Use first record as primary, compare with second if available
    const primary = climaRecords[0];
    const secondary = climaRecords.length > 1 ? climaRecords[1] : null;

    const conditions: WeatherCondition[] = [];

    if (primary.temp_maxima_c != null) {
        const tempMax = Number(primary.temp_maxima_c);
        conditions.push({
            variable: 'Temperatura Máxima',
            current: `${tempMax}°C`,
            forecast: secondary?.temp_maxima_c != null ? `${secondary.temp_maxima_c}°C` : '—',
            impact: tempMax > 35 ? 'Estrés térmico alto en cultivos' : 'Define el estrés térmico del cultivo',
            icon: <Thermometer size={18} />,
            status: tempMax > 38 ? 'alert' : tempMax > 35 ? 'warning' : 'normal'
        });
    }

    if (primary.temp_minima_c != null) {
        const tempMin = Number(primary.temp_minima_c);
        conditions.push({
            variable: 'Temperatura Mínima',
            current: `${tempMin}°C`,
            forecast: secondary?.temp_minima_c != null ? `${secondary.temp_minima_c}°C` : '—',
            impact: tempMin < 5 ? '⚠️ Riesgo de heladas en frutales' : 'Sin riesgo de heladas',
            icon: <Thermometer size={18} />,
            status: tempMin < 0 ? 'alert' : tempMin < 5 ? 'warning' : 'normal'
        });
    }

    if (primary.evaporacion_mm != null) {
        conditions.push({
            variable: 'Evaporación',
            current: `${primary.evaporacion_mm} mm`,
            forecast: secondary?.evaporacion_mm != null ? `${secondary.evaporacion_mm} mm` : '—',
            impact: 'Pérdida de agua en vasos y canales',
            icon: <Droplets size={18} />,
            status: 'normal'
        });
    }

    if (primary.dir_viento) {
        conditions.push({
            variable: 'Viento',
            current: `${primary.dir_viento} — Int: ${primary.intensidad_viento ?? 0}`,
            forecast: primary.dir_viento_24h ? `${primary.dir_viento_24h} — Int: ${primary.intensidad_24h ?? 0}` : '—',
            impact: 'Afecta la uniformidad del riego por aspersión',
            icon: <Wind size={18} />,
            status: Number(primary.intensidad_viento ?? 0) > 3 ? 'warning' : 'normal'
        });
    }

    if (primary.precipitacion_mm != null) {
        const precip = primary.precipitacion_mm;
        conditions.push({
            variable: 'Precipitación',
            current: `${precip} mm`,
            forecast: secondary?.precipitacion_mm != null ? `${secondary.precipitacion_mm} mm` : '—',
            impact: precip > 10 ? 'Posible suspensión de riegos' : 'Sin impacto en operación',
            icon: <Droplets size={18} />,
            status: precip > 20 ? 'alert' : precip > 10 ? 'warning' : 'normal'
        });
    }

    if (primary.edo_tiempo) {
        conditions.push({
            variable: 'Estado del Tiempo',
            current: primary.edo_tiempo,
            forecast: primary.edo_tiempo_24h || '—',
            impact: 'Condiciones generales de operación',
            icon: <Cloud size={18} />,
            status: 'normal'
        });
    }

    if (primary.visibilidad != null) {
        conditions.push({
            variable: 'Visibilidad',
            current: `${primary.visibilidad} km`,
            forecast: '—',
            impact: 'Capacidad de supervisión en campo',
            icon: <Sun size={18} />,
            status: Number(primary.visibilidad ?? 99) < 5 ? 'warning' : 'normal'
        });
    }

    return conditions;
}

// Component: Condition Row
const ConditionRow = ({ condition }: { condition: WeatherCondition }) => (
    <tr className={`condition-row ${condition.status}`}>
        <td className="var-cell">
            <div className="var-icon">{condition.icon}</div>
            <span>{condition.variable}</span>
        </td>
        <td className="value-cell current">{condition.current}</td>
        <td className="value-cell forecast">{condition.forecast}</td>
        <td className="impact-cell">{condition.impact}</td>
    </tr>
);

// Component: Technical Variable Card
const TechVarCard = ({ variable }: { variable: TechnicalVariable }) => (
    <div className="tech-var-card">
        <div className="tech-icon">{variable.icon}</div>
        <div className="tech-content">
            <span className="tech-name">{variable.name}</span>
            <div className="tech-value-row">
                <span className="tech-value">{variable.value}</span>
                <span className="tech-unit">{variable.unit}</span>
            </div>
            <span className="tech-desc">{variable.description}</span>
        </div>
    </div>
);

// ── Tarjeta de estación WeatherLink en tiempo real ──────────────────────────
const rolLabel = (rol: string) =>
    rol === 'presa' ? 'Presa' : rol === 'modulo' ? 'Módulo' : 'Canal';

const EstacionCard = ({ est }: { est: EstacionConLectura }) => {
    const l = est.lectura;
    return (
        <div className={`estacion-card ${est.enLinea ? 'online' : 'offline'}`}>
            <div className="estacion-head">
                <div className="estacion-title">
                    <MapPin size={14} />
                    <span>{est.nombre}</span>
                    <em className="estacion-rol">{rolLabel(est.rol)}</em>
                </div>
                <span className={`estacion-status ${est.enLinea ? 'on' : 'off'}`}>
                    {est.enLinea ? '● en línea'
                        : est.edadHoras != null ? `○ ${est.edadHoras < 48 ? Math.round(est.edadHoras) + ' h' : Math.round(est.edadHoras / 24) + ' d'} sin datos`
                            : '○ sin datos'}
                </span>
            </div>
            {l ? (
                <div className="estacion-grid">
                    <div className="est-var"><Thermometer size={13} /><b>{l.temp_c != null ? l.temp_c.toFixed(1) : '—'}</b><small>°C</small></div>
                    <div className="est-var"><Droplets size={13} /><b>{l.hum_rel_pct != null ? Math.round(l.hum_rel_pct) : '—'}</b><small>% HR</small></div>
                    <div className="est-var"><Wind size={13} /><b>{l.viento_ms != null ? l.viento_ms.toFixed(1) : '—'}</b><small>m/s</small></div>
                    <div className="est-var"><Cloud size={13} /><b>{l.lluvia_dia_mm != null ? l.lluvia_dia_mm.toFixed(1) : '—'}</b><small>mm día</small></div>
                    <div className="est-var accent"><Activity size={13} /><b>{l.eto_mm != null ? l.eto_mm.toFixed(2) : (l.et_dia_mm != null ? l.et_dia_mm.toFixed(2) : '—')}</b><small>ETₒ mm</small></div>
                    <div className="est-var"><Zap size={13} /><b>{l.gdd != null ? l.gdd.toFixed(0) : '—'}</b><small>GDD</small></div>
                </div>
            ) : (
                <div className="estacion-nodata">Aún sin lecturas registradas.</div>
            )}
        </div>
    );
};

// Main Component
const Clima = () => {
    const { fechaSeleccionada } = useFecha();
    const { presas, clima, loading } = usePresas(fechaSeleccionada);
    const { estaciones, loading: loadingEst } = useClimaEstaciones();

    // Build weather conditions from Supabase data
    const conditions = buildConditions(clima);

    // Build technical variables. Prioriza la ETₒ REAL de las estaciones WeatherLink
    // (FAO-56 Penman-Monteith); si no hay estaciones, cae a la aproximación previa.
    const techVars: TechnicalVariable[] = [];
    const estEnLinea = estaciones.filter(e => e.enLinea && e.lectura?.eto_mm != null);
    if (estEnLinea.length > 0) {
        const etoProm = estEnLinea.reduce((a, e) => a + (e.lectura!.eto_mm ?? 0), 0) / estEnLinea.length;
        techVars.push({
            name: 'Evapotranspiración (ETₒ)',
            value: etoProm.toFixed(2),
            unit: 'mm/día',
            description: `Real, promedio de ${estEnLinea.length} estación(es) — FAO-56 Penman-Monteith`,
            icon: <Activity size={18} />
        });
        const estGdd = estaciones.filter(e => e.lectura?.gdd != null);
        if (estGdd.length > 0) {
            const gddProm = estGdd.reduce((a, e) => a + (e.lectura!.gdd ?? 0), 0) / estGdd.length;
            techVars.push({
                name: 'Unidades Calor (GDD)',
                value: gddProm.toFixed(0),
                unit: '°C-día',
                description: 'Real de estación · base 10°C (nogal/alfalfa)',
                icon: <Zap size={18} />
            });
        }
    } else if (clima.length > 0) {
        const c = clima[0];
        if (c.evaporacion_mm != null) {
            const eto = (c.evaporacion_mm * 0.7).toFixed(1);
            techVars.push({
                name: 'Evapotranspiración (ETₒ)',
                value: eto,
                unit: 'mm/día',
                description: 'Estimada desde evaporación × 0.7 (sin estación en línea)',
                icon: <Activity size={18} />
            });
        }
        if (c.temp_maxima_c != null && c.temp_minima_c != null) {
            const gdd = Math.max(0, ((c.temp_maxima_c + c.temp_minima_c) / 2) - 10);
            techVars.push({
                name: 'Unidades Calor (GDD)',
                value: gdd.toFixed(0),
                unit: '°C-día',
                description: 'Base 10°C para nogal/alfalfa',
                icon: <Zap size={18} />
            });
        }
    }

    // Precipitation data per station
    const precipData = clima.map(c => {
        const presa = presas.find(p => p.id === c.presa_id);
        return {
            station: presa?.nombre_corto || c.presa_id,
            precipitacion: c.precipitacion_mm || 0,
            evaporacion: c.evaporacion_mm || 0,
        };
    });

    // Irrigation alerts derived from real data
    const irrigationAlerts = [];
    if (clima.length > 0) {
        const c = clima[0];
        if (Number(c.intensidad_viento ?? 0) > 3) {
            irrigationAlerts.push({
                active: true,
                message: `Viento fuerte (Int: ${c.intensidad_viento}): Suspender riego por aspersión`,
                threshold: 'Int > 3',
            });
        } else {
            irrigationAlerts.push({
                active: false,
                message: 'Viento dentro de parámetros: Riego por aspersión permitido',
                threshold: 'Int ≤ 3',
            });
        }
        if ((c.precipitacion_mm ?? 0) > 10) {
            irrigationAlerts.push({
                active: true,
                message: `Precipitación ${c.precipitacion_mm} mm: Considerar cierre preventivo de tomas`,
                threshold: '> 10 mm',
            });
        }
        if ((c.temp_minima_c ?? 99) < 5) {
            irrigationAlerts.push({
                active: true,
                message: `Temp. mín ${c.temp_minima_c}°C: Vigilar heladas en frutales`,
                threshold: '< 5°C',
            });
        }
    }

    if (loading && clima.length === 0) {
        return (
            <div className="clima-container flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-3 text-slate-400">
                    <Loader size={32} className="animate-spin text-blue-400" />
                    <span className="text-sm font-medium">Cargando datos climatológicos...</span>
                </div>
            </div>
        );
    }

    const noData = clima.length === 0;

    return (
        <div className="clima-container">
            <header className="page-header">
                <div>
                    <h2 className="text-2xl font-bold text-white">Inteligencia Agroclimática</h2>
                    <p className="text-slate-400 text-sm">SICA-005 • Módulo Agro-SICA para el Distrito de Riego • {fechaSeleccionada}</p>
                </div>

                {/* Sync Status */}
                <div className="sync-status">
                    <RefreshCw size={14} className="sync-icon" />
                    <span>Fecha seleccionada: {fechaSeleccionada}</span>
                </div>
            </header>

            {/* Station Identification */}
            <section className="station-card">
                <div className="station-info">
                    <div className="station-icon">
                        <Cloud size={32} />
                    </div>
                    <div className="station-details">
                        <h3>Estaciones Meteorológicas — Presas del Distrito</h3>
                        <div className="station-meta">
                            <span className="meta-item">
                                <Activity size={12} />
                                {presas.length} estaciones activas
                            </span>
                            <span className="meta-item">
                                <Leaf size={12} />
                                SICA-005 / CONAGUA
                            </span>
                            {presas.length > 0 && (
                                <span className="meta-item">
                                    <MapPin size={12} />
                                    {presas.map(p => p.nombre_corto).join(', ')}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Quick Stats */}
                <div className="quick-stats">
                    <div className="quick-stat">
                        <span className="stat-label">Temp. Máx</span>
                        <span className="stat-value">
                            {clima.length > 0 && clima[0].temp_maxima_c != null ? `${clima[0].temp_maxima_c}` : '—'} <small>°C</small>
                        </span>
                    </div>
                    <div className="quick-stat">
                        <span className="stat-label">Precip. Total</span>
                        <span className="stat-value">
                            {clima.reduce((acc, c) => acc + (c.precipitacion_mm || 0), 0).toFixed(1)} <small>mm</small>
                        </span>
                    </div>
                    <div className="quick-stat">
                        <span className="stat-label">Evap. Promedio</span>
                        <span className="stat-value">
                            {clima.length > 0 ? (clima.reduce((acc, c) => acc + (c.evaporacion_mm || 0), 0) / clima.length).toFixed(1) : '—'} <small>mm</small>
                        </span>
                    </div>
                </div>
            </section>

            {/* Estaciones WeatherLink en tiempo real */}
            {estaciones.length > 0 && (
                <section className="card estaciones-section">
                    <div className="estaciones-header">
                        <h3><Activity size={18} /> Estaciones en tiempo real (WeatherLink / Davis)</h3>
                        <button className="estaciones-dl" onClick={() => exportClimaReport(estaciones)} title="Descargar informe de clima (HTML)">
                            <Download size={14} /> Informe
                        </button>
                    </div>
                    <div className="estaciones-grid">
                        {estaciones.map((e) => <EstacionCard key={e.id} est={e} />)}
                    </div>
                    <p className="estaciones-foot">
                        {estaciones.filter(e => e.enLinea).length} de {estaciones.length} en línea ·
                        ETₒ calculada por estación (FAO-56 Penman-Monteith)
                    </p>
                </section>
            )}
            {!loadingEst && estaciones.length === 0 && (
                <div className="card p-4 text-center text-slate-400 text-xs">
                    Estaciones climáticas no configuradas todavía (tabla clima_estaciones vacía).
                </div>
            )}

            {noData && (
                <div className="card p-6 text-center text-slate-400">
                    <AlertTriangle size={24} className="mx-auto mb-2 text-amber-400" />
                    <p className="text-sm">No hay datos climatológicos disponibles para la fecha {fechaSeleccionada}.</p>
                    <p className="text-xs mt-1">Los datos mostrados podrían ser de la lectura más reciente disponible.</p>
                </div>
            )}

            <div className="clima-grid">
                {/* Section: Current Conditions */}
                {conditions.length > 0 && (
                    <section className="card conditions-section">
                        <h3><Thermometer size={18} /> Condiciones Registradas y Pronóstico (24h)</h3>
                        <table className="conditions-table">
                            <thead>
                                <tr>
                                    <th>Variable</th>
                                    <th>Valor Actual</th>
                                    <th>Pronóstico 24h</th>
                                    <th>Impacto Operativo</th>
                                </tr>
                            </thead>
                            <tbody>
                                {conditions.map((c, i) => (
                                    <ConditionRow key={i} condition={c} />
                                ))}
                            </tbody>
                        </table>
                    </section>
                )}

                {/* Section: Technical Variables */}
                {techVars.length > 0 && (
                    <section className="card tech-section">
                        <h3><Activity size={18} /> Variables Técnicas de Riego (Cálculo SICA)</h3>
                        <div className="tech-grid">
                            {techVars.map((v, i) => (
                                <TechVarCard key={i} variable={v} />
                            ))}
                        </div>

                        <div className="kc-info">
                            <div className="kc-header">
                                <Leaf size={16} />
                                <span>Coeficiente de Cultivo (Kc)</span>
                            </div>
                            <p>La App cruza la ETₒ ({techVars[0]?.value || '—'} mm/día) con la etapa del cultivo para determinar la lámina de riego real:</p>
                            <div className="kc-formula">
                                <span>ETc = ETₒ × Kc</span>
                                <span className="kc-example">Ej: Nogal en brotación: {techVars[0]?.value || '—'} × 0.85 = <strong>{((Number(techVars[0]?.value) || 0) * 0.85).toFixed(2)} mm/día</strong></span>
                            </div>
                        </div>
                    </section>
                )}

                {/* Section: Irrigation Integration */}
                {irrigationAlerts.length > 0 && (
                    <section className="card alerts-section">
                        <h3><AlertTriangle size={18} /> Integración con Plan de Riego</h3>
                        <div className="alerts-list">
                            {irrigationAlerts.map((alert, i) => (
                                <div key={i} className={`alert-item ${alert.active ? 'active' : ''}`}>
                                    <div className="alert-indicator" />
                                    <div className="alert-content">
                                        <span className="alert-message">{alert.message}</span>
                                        <span className="alert-threshold">Umbral: {alert.threshold}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Section: Precipitation by Station */}
                {precipData.length > 0 && (
                    <section className="card history-section">
                        <h3><TrendingDown size={18} /> Precipitación y Evaporación por Estación</h3>
                        <div className="chart-container">
                            <ResponsiveContainer width="100%" height={200}>
                                <BarChart data={precipData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="station" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                    <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} unit=" mm" />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                    />
                                    <Legend wrapperStyle={{ fontSize: '10px' }} />
                                    <Bar dataKey="precipitacion" name="Precipitación" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                    <Bar dataKey="evaporacion" name="Evaporación" fill="#ef4444" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
};

export default Clima;
