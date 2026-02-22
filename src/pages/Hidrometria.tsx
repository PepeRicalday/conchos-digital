import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Upload, Download, AlertTriangle, Activity } from 'lucide-react';
import { calculateEfficiency } from '../utils/hydraulics';
import KPICard from '../components/KPICard';
import ChartWidget from '../components/ChartWidget';
import { useHydraEngine } from '../hooks/useHydraEngine';
import './Hidrometria.css';

const Hidrometria = () => {
    const { modules, loading } = useHydraEngine();

    // 1. Calculate Global KPIs from Real Data
    const totalAccumulated = modules.reduce((acc, m) => acc + (m.accumulated_vol ?? 0), 0);

    // Mock Extraction (In a real scenario, this would come from the 'Presas' or 'Bocatoma' table)
    // For now, we assume extraction is roughly 15% higher than delivery (losses)
    const mockExtraction = totalAccumulated * 1.15;
    const losses = mockExtraction - totalAccumulated;
    const efficiencyGlobal = mockExtraction > 0 ? (totalAccumulated / mockExtraction) * 100 : 0;

    // 2. Prepare Chart Data (Aggregated by Module for "Sectors")
    const balanceData = modules.map(m => {
        const accVol = m.accumulated_vol ?? 0;
        const volIn = accVol * 1.12;
        const volOut = accVol;
        const eff = calculateEfficiency(volIn, volOut);

        return {
            zone: m.short_code || m.name,
            volIn: Number(volIn.toFixed(2)),
            volOut: Number(volOut.toFixed(2)),
            efficiency: Number(eff.toFixed(1))
        };
    });

    if (loading) return <div className="text-white p-10">Cargando Hidrometría...</div>;

    return (
        <div className="hidrometria-container p-6 animate-fade-in">
            <header className="page-header mb-6">
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                    <span className="w-2 h-8 bg-blue-500 rounded-full"></span>
                    Hidrometría y Eficiencia
                </h2>
                <p className="text-slate-400 text-sm ml-4">Balance Hídrico y Análisis de Pérdidas por Módulo</p>
            </header>

            <div className="hidro-grid grid grid-cols-12 gap-6">
                {/* KPI Summary */}
                <section className="hidro-kpis col-span-12 grid grid-cols-4 gap-4">
                    <KPICard title="Volumen Extraído (Est.)" value={mockExtraction.toFixed(2)} unit="Mm³" color="blue" icon={Upload} />
                    <KPICard title="Volumen Entregado (Neto)" value={totalAccumulated.toFixed(2)} unit="Mm³" color="emerald" icon={Download} />
                    <KPICard title="Pérdidas Totales" value={losses.toFixed(2)} unit="Mm³" color="rose" subtext="Cond. + Operación" icon={AlertTriangle} />
                    <KPICard title="Eficiencia Global" value={`${efficiencyGlobal.toFixed(1)}%`} color={efficiencyGlobal > 85 ? 'cyan' : 'amber'} icon={Activity} />
                </section>

                {/* Efficiency Chart */}
                <section className="hidro-charts col-span-12 grid grid-cols-12 gap-6">
                    <div className="col-span-8">
                        <ChartWidget title="Balance Volumétrico por Módulo (Mm³)">
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart data={balanceData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.1)" />
                                    <XAxis dataKey="zone" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8' }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8' }} />
                                    <Tooltip
                                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                                        itemStyle={{ color: '#e2e8f0' }}
                                    />
                                    <Legend wrapperStyle={{ paddingTop: '10px' }} />
                                    <Bar dataKey="volIn" name="Volumen Entrada" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={20} />
                                    <Bar dataKey="volOut" name="Volumen Salida" fill="#10b981" radius={[4, 4, 0, 0]} barSize={20} />
                                </BarChart>
                            </ResponsiveContainer>
                        </ChartWidget>
                    </div>

                    <div className="col-span-4 card efficiency-table-card bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                        <h3 className="text-white font-bold mb-4 text-sm uppercase tracking-wider text-slate-400">Detalle de Eficiencia ($E_c$)</h3>
                        <div className="overflow-x-auto">
                            <table className="hidro-table w-full text-sm text-left text-slate-300">
                                <thead>
                                    <tr className="border-b border-slate-700 text-slate-500 text-xs uppercase">
                                        <th className="py-2">Módulo</th>
                                        <th className="text-right">Eficiencia</th>
                                        <th className="text-center">Estado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700/50">
                                    {balanceData.map((row) => (
                                        <tr key={row.zone} className="hover:bg-slate-700/30 transition-colors">
                                            <td className="py-3 font-medium">{row.zone}</td>
                                            <td className="text-right font-mono text-blue-300">{row.efficiency}%</td>
                                            <td className="text-center">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${row.efficiency < 85 ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                                                    {row.efficiency < 85 ? 'Pérdidas' : 'Óptimo'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default Hidrometria;
