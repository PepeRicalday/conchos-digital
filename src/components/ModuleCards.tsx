import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Activity, X } from 'lucide-react';
import type { ModuleData } from '../store/useHydraStore';
import { formatVol, getLogoPath } from '../utils/uiHelpers';

export const ModuleDetailModal = ({ module, onClose }: { module: ModuleData, onClose: () => void }) => {
    const pieData = [
        { name: 'Consumido', value: module.accumulated_vol },
        { name: 'Disponible', value: Math.max(0, module.authorized_vol - module.accumulated_vol) }
    ];

    const typeData = [
        { name: 'Tomas', value: module.delivery_points.filter(p => p.type === 'toma').reduce((a, b) => a + b.accumulated, 0) },
        { name: 'Laterales', value: module.delivery_points.filter(p => p.type === 'lateral').reduce((a, b) => a + b.accumulated, 0) },
        { name: 'Cárcamos', value: module.delivery_points.filter(p => p.type === 'carcamo').reduce((a, b) => a + b.accumulated, 0) }
    ].filter(d => d.value > 0);

    const logoSrc = getLogoPath(module.name, module.id);

    return (
        <div className="modal-overlay backdrop-blur-sm bg-black/80" onClick={onClose}>
            <div className="modal-content border border-slate-600 shadow-2xl" onClick={e => e.stopPropagation()}>
                <header className="modal-header bg-slate-800">
                    <div className="flex items-center gap-4">
                        <div className="logo-container">
                            <img src={logoSrc} alt={module.name} className="module-logo w-10 h-10 rounded-full border-2 border-slate-600" />
                        </div>
                        <div>
                            <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">{module.short_code || module.id.substring(0, 6)}</span>
                            <h2 className="text-2xl font-bold text-white">{module.acu_name}</h2>
                        </div>
                    </div>
                    <button onClick={onClose} className="close-btn hover:bg-red-500/20 hover:text-red-400 transition-colors"><X /></button>
                </header>

                <div className="modal-body bg-slate-900">
                    <div className="bg-gradient-to-r from-blue-900/30 to-cyan-900/20 border border-blue-500/20 rounded-xl p-4 mb-4 flex items-center justify-between">
                        <div>
                            <span className="text-xs text-blue-300 font-bold uppercase tracking-wider">Volumen Entregado Hoy</span>
                            <div className="text-2xl font-mono font-bold text-white mt-1">
                                {module.daily_vol.toFixed(4)} <span className="text-sm text-blue-400">Mm³</span>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Caudal Promedio</span>
                            <div className="text-xl font-mono font-bold text-emerald-400 mt-1">
                                {(module.current_flow * 1000).toFixed(0)} <span className="text-sm text-slate-400">L/s</span>
                            </div>
                        </div>
                    </div>
                    <div className="analytics-grid">
                        <div className="chart-card bg-slate-800/50 border-slate-700">
                            <h3>Balance Volumétrico</h3>
                            <div style={{ height: 200, display: 'flex', alignItems: 'center' }}>
                                <ResponsiveContainer width="50%" height="100%">
                                    <PieChart>
                                        <Pie data={pieData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                                            <Cell fill="#ef4444" />
                                            <Cell fill="#10b981" />
                                        </Pie>
                                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none' }} />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className="chart-legend">
                                    <div className="legend-row">
                                        <span className="dot" style={{ background: '#ef4444' }}></span>
                                        <div>
                                            <span className="l-label">Consumido</span>
                                            <span className="l-val">{formatVol(module.accumulated_vol)} Mm³</span>
                                        </div>
                                    </div>
                                    <div className="legend-row">
                                        <span className="dot" style={{ background: '#10b981' }}></span>
                                        <div>
                                            <span className="l-label">Disponible</span>
                                            <span className="l-val">{formatVol(module.authorized_vol - module.accumulated_vol)} Mm³</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="chart-card bg-slate-800/50 border-slate-700">
                            <h3>Distribución</h3>
                            <div style={{ height: 150, width: '100%' }}>
                                <ResponsiveContainer>
                                    <BarChart layout="vertical" data={typeData}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="rgba(255,255,255,0.05)" />
                                        <XAxis type="number" hide />
                                        <YAxis dataKey="name" type="category" width={80} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                        <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: '#1e293b', border: 'none' }} />
                                        <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    <div className="detail-card bg-slate-800/50 border-slate-700 mt-4">
                        <h3>Infraestructura de Entrega</h3>
                        <table className="points-table">
                            <thead>
                                <tr>
                                    <th>Punto</th>
                                    <th>Gasto (L/s)</th>
                                    <th>Vol. Día (Mm³)</th>
                                    <th>Acum. (Mm³)</th>
                                    <th>Estado</th>
                                </tr>
                            </thead>
                            <tbody>
                                {module.delivery_points.map(p => (
                                    <tr key={p.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                                        <td>
                                            <div className="flex flex-col">
                                                <span className="font-medium text-white text-xs">{p.name}</span>
                                                <span className="text-[10px] text-slate-500">{p.type} • Km {p.km}</span>
                                            </div>
                                        </td>
                                        <td className="text-right font-mono text-emerald-400 font-bold">{p.current_q_lps.toFixed(0)}</td>
                                        <td className="text-right font-mono text-blue-400">{p.daily_vol.toFixed(4)}</td>
                                        <td className="text-right font-mono text-slate-300">{p.accumulated.toFixed(4)}</td>
                                        <td className="text-center">
                                            <span className={`status-dot ${p.is_open ? 'active' : 'inactive'}`}></span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const ModuleCard = ({ data }: { data: ModuleData }) => {
    const consumed = data.accumulated_vol || 0;
    const authorized = data.authorized_vol || 1;
    const available = Math.max(authorized - consumed, 0);
    const percentConsumed = authorized > 0 ? (consumed / authorized) * 100 : 0;
    const isOperating = data.current_flow > 0.1;
    const logoSrc = getLogoPath(data.name, data.id);

    const consumedColor = percentConsumed > 90 ? '#ef4444' : percentConsumed > 70 ? '#f59e0b' : '#3b82f6';
    const displayPercent = consumed > 0 ? Math.max(percentConsumed, 5) : 0;

    const pieData = [
        { name: 'Consumido', value: displayPercent, fill: consumedColor },
        { name: 'Disponible', value: 100 - displayPercent, fill: '#1e293b' }
    ];

    return (
        <div className="module-card-premium">
            <div className={`status-pill ${isOperating ? 'active' : ''}`} title={isOperating ? 'Operando' : 'Sin Flujo'}></div>

            <div className="card-content">
                <div className="identity-section">
                    <img src={logoSrc} alt={data.name} className="module-logo-large" />
                    <span className="module-badge-tech">{data.short_code || 'MOD'}</span>
                </div>

                <div className="stats-section">
                    <div className="stat-item">
                        <span className="stat-label">Vol. Consumido</span>
                        <span className="stat-value stat-value-blue">{formatVol(consumed)}</span>
                        <span className="stat-sub">Mm³</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Q. Instantáneo</span>
                        <div className="stat-flow-row">
                            <span className="stat-value stat-value-emerald">{(data.current_flow * 1000).toFixed(0)}</span>
                            {isOperating && <Activity size={10} className="stat-pulse-icon" />}
                        </div>
                        <span className="stat-sub">L/s</span>
                    </div>
                    <div className="stat-item stat-disponible">
                        <span className="stat-label">Disponible</span>
                        <span className="stat-value stat-value-muted">{formatVol(available)} <small className="stat-unit-small">Mm³</small></span>
                    </div>
                </div>

                <div className="progress-section">
                    <div className="vol-chart-wrapper">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={20}
                                    outerRadius={28}
                                    paddingAngle={2}
                                    dataKey="value"
                                    stroke="none"
                                    startAngle={90}
                                    endAngle={-270}
                                >
                                    {pieData.map((entry, index) => (
                                        <Cell key={index} fill={entry.fill} />
                                    ))}
                                </Pie>
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="vol-chart-center">
                            <span className="vol-chart-percent">{percentConsumed.toFixed(0)}%</span>
                        </div>
                    </div>
                    <div className="vol-chart-legend">
                        <span className="vol-legend-item">
                            <span className="vol-legend-dot" style={{ backgroundColor: consumedColor }}></span>
                            Usado
                        </span>
                        <span className="vol-legend-item">
                            <span className="vol-legend-dot" style={{ backgroundColor: '#334155' }}></span>
                            Libre
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};
