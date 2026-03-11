import { useState, useEffect, useMemo } from 'react';
import { BarChart3, AlertTriangle, Droplets, TrendingUp, ArrowDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFecha } from '../context/FechaContext';
import { calculateSectionBalance, manningFlow, getEfficiencyStatus, type PerfilTramo, type BalanceTramo } from '../utils/hydraulics';
import EfficiencyGauge from '../components/EfficiencyGauge';
import './BalanceHidraulico.css';

interface EscalaData {
    escala_id: string;
    nombre: string;
    km: number;
    nivel_actual: number;
    gasto_calculado: number;
    seccion_nombre: string;
}

interface TomaActiva {
    punto_id: string;
    nombre: string;
    km: number;
    caudal: number;
}

const BalanceHidraulico = () => {
    const { fechaSeleccionada } = useFecha();
    const [escalas, setEscalas] = useState<EscalaData[]>([]);
    const [tomas, setTomas] = useState<TomaActiva[]>([]);
    const [perfilTramos, setPerfilTramos] = useState<PerfilTramo[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchData();
    }, [fechaSeleccionada]);

    async function fetchData() {
        setLoading(true);
        const dateStr = fechaSeleccionada;

        const [escRes, tomasRes, perfilRes] = await Promise.all([
            supabase.from('resumen_escalas_diario')
                .select('escala_id, nombre, km, nivel_actual, gasto_calculado_m3s, seccion_nombre')
                .eq('fecha', dateStr)
                .order('km', { ascending: true }),
            supabase.from('reportes_operacion')
                .select('punto_id, puntos_entrega(nombre, km), caudal_promedio, estado')
                .eq('fecha', dateStr)
                .in('estado', ['inicio', 'continua', 'reabierto', 'modificacion']),
            supabase.from('perfil_hidraulico_canal')
                .select('*')
                .order('km_inicio', { ascending: true })
        ]);

        if (escRes.data) {
            setEscalas(escRes.data.map((e: any) => ({
                escala_id: e.escala_id,
                nombre: e.nombre,
                km: Number(e.km || 0),
                nivel_actual: Number(e.nivel_actual || 0),
                gasto_calculado: Number(e.gasto_calculado_m3s || 0),
                seccion_nombre: e.seccion_nombre || ''
            })));
        }

        if (tomasRes.data) {
            setTomas(tomasRes.data.map((t: any) => ({
                punto_id: t.punto_id,
                nombre: t.puntos_entrega?.nombre || 'Toma',
                km: Number(t.puntos_entrega?.km || 0),
                caudal: Number(t.caudal_promedio || 0)
            })));
        }

        if (perfilRes.data) {
            setPerfilTramos(perfilRes.data as PerfilTramo[]);
        }

        setLoading(false);
    }

    // Calculate balance between consecutive escalas
    const balanceData = useMemo((): BalanceTramo[] => {
        if (escalas.length < 2) return [];

        const balances: BalanceTramo[] = [];
        const sortedEscalas = [...escalas].sort((a, b) => a.km - b.km);

        for (let i = 0; i < sortedEscalas.length - 1; i++) {
            const e1 = sortedEscalas[i];
            const e2 = sortedEscalas[i + 1];

            // Sum all tomas between these two escalas
            const tomasEntre = tomas.filter(t => t.km >= e1.km && t.km < e2.km);
            const qTomas = tomasEntre.reduce((acc, t) => acc + t.caudal, 0);

            // Find matching perfil tramo
            const perfil = perfilTramos.find(p =>
                e1.km >= p.km_inicio && e1.km < p.km_fin
            );

            const balance = calculateSectionBalance(
                `${e1.nombre} → ${e2.nombre}`,
                e1.km,
                e2.km,
                e1.gasto_calculado,
                e2.gasto_calculado,
                qTomas,
                perfil
            );

            balances.push(balance);
        }

        return balances;
    }, [escalas, tomas, perfilTramos]);

    // Global efficiency
    const globalEfficiency = useMemo(() => {
        if (balanceData.length === 0) return 100;
        const totalEntrada = balanceData.reduce((acc, b) => acc + b.q_entrada, 0);
        const totalSalida = balanceData.reduce((acc, b) => acc + b.q_salida + b.q_tomas, 0);
        return totalEntrada > 0 ? (totalSalida / totalEntrada) * 100 : 100;
    }, [balanceData]);

    const criticalSections = balanceData.filter(b => b.estado === 'critico' || b.estado === 'alerta');

    if (loading) {
        return (
            <div className="balance-loading">
                <div className="balance-loading-spinner"></div>
                <p>Calculando Balance Hidráulico...</p>
            </div>
        );
    }

    return (
        <div className="balance-page">
            <header className="balance-header">
                <div className="balance-title-group">
                    <BarChart3 size={24} className="balance-icon" />
                    <div>
                        <h1>Balance Hidráulico</h1>
                        <p className="balance-subtitle">Modelo de Operación — Canal Principal Conchos</p>
                    </div>
                </div>
                <div className="balance-kpi-row">
                    <div className="balance-kpi">
                        <span className="kpi-value">{escalas.length}</span>
                        <span className="kpi-label">Escalas</span>
                    </div>
                    <div className="balance-kpi">
                        <span className="kpi-value">{tomas.length}</span>
                        <span className="kpi-label">Tomas Activas</span>
                    </div>
                    <div className="balance-kpi">
                        <span className="kpi-value">{perfilTramos.length}</span>
                        <span className="kpi-label">Tramos Diseño</span>
                    </div>
                    <div className="balance-kpi highlight">
                        <span className="kpi-value">{criticalSections.length}</span>
                        <span className="kpi-label">Alertas</span>
                    </div>
                </div>
            </header>

            <div className="balance-content">
                {/* Global Efficiency Gauge */}
                <div className="balance-gauge-card">
                    <EfficiencyGauge value={globalEfficiency} label="Eficiencia de Conducción Global" />
                    <div className="balance-formula">
                        <code>E<sub>c</sub> = (Q<sub>salida</sub> + Q<sub>tomas</sub>) / Q<sub>entrada</sub> × 100</code>
                    </div>
                </div>

                {/* Balance Table */}
                <div className="balance-table-card">
                    <h2 className="section-title">
                        <TrendingUp size={18} /> Balance por Tramo
                    </h2>

                    {balanceData.length === 0 ? (
                        <div className="balance-empty">
                            <p>No hay suficientes datos de escalas para calcular el balance.</p>
                            <p className="balance-empty-hint">Se requieren al menos 2 estaciones de medición con datos del día seleccionado.</p>
                        </div>
                    ) : (
                        <div className="balance-table-wrapper">
                            <table className="balance-table">
                                <thead>
                                    <tr>
                                        <th>Tramo</th>
                                        <th>KM</th>
                                        <th>Q Entrada</th>
                                        <th>Q Salida</th>
                                        <th>Q Tomas</th>
                                        <th>Pérdidas</th>
                                        <th>Eficiencia</th>
                                        <th>Estado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {balanceData.map((b, idx) => {
                                        const status = getEfficiencyStatus(b.eficiencia);
                                        return (
                                            <tr key={idx} className={`balance-row ${b.estado}`}>
                                                <td className="tramo-name">{b.seccion_nombre}</td>
                                                <td className="tramo-km">{b.km_inicio.toFixed(1)} - {b.km_fin.toFixed(1)}</td>
                                                <td className="q-value entrada">{b.q_entrada.toFixed(3)}</td>
                                                <td className="q-value salida">{b.q_salida.toFixed(3)}</td>
                                                <td className="q-value tomas">{b.q_tomas.toFixed(3)}</td>
                                                <td className="q-value perdidas">{b.q_perdidas.toFixed(3)}</td>
                                                <td className="efficiency-cell">
                                                    <div className="efficiency-bar-container">
                                                        <div
                                                            className="efficiency-bar-fill"
                                                            style={{
                                                                width: `${Math.min(100, b.eficiencia)}%`,
                                                                background: status.color
                                                            }}
                                                        />
                                                        <span className="efficiency-text" style={{ color: status.color }}>
                                                            {b.eficiencia.toFixed(1)}%
                                                        </span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span
                                                        className={`status-badge status-${b.estado}`}
                                                        style={{ background: status.bg, color: status.color, borderColor: status.color }}
                                                    >
                                                        {status.label}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Canal Schematic */}
                <div className="balance-schematic-card">
                    <h2 className="section-title">
                        <Droplets size={18} /> Esquema del Canal — Flujo de Diseño vs Real
                    </h2>
                    <div className="canal-schematic">
                        {balanceData.map((b, idx) => {
                            const status = getEfficiencyStatus(b.eficiencia);
                            const widthPct = b.perfil
                                ? Math.min(100, (b.q_entrada / b.perfil.capacidad_diseno_m3s) * 100)
                                : 50;
                            return (
                                <div key={idx} className="schematic-section">
                                    <div className="schematic-node">
                                        <div className="node-dot" style={{ background: status.color, boxShadow: `0 0 12px ${status.color}` }} />
                                        <span className="node-label">{b.seccion_nombre.split(' → ')[0]}</span>
                                        <span className="node-q">{b.q_entrada.toFixed(2)} m³/s</span>
                                    </div>
                                    <div className="schematic-pipe">
                                        <div
                                            className="pipe-flow"
                                            style={{
                                                width: `${widthPct}%`,
                                                background: `linear-gradient(90deg, ${status.color}40, ${status.color})`
                                            }}
                                        />
                                        {b.q_tomas > 0 && (
                                            <div className="pipe-tomas">
                                                <ArrowDown size={10} />
                                                <span>{b.q_tomas.toFixed(2)}</span>
                                            </div>
                                        )}
                                        {b.q_perdidas > 0.01 && (
                                            <div className="pipe-loss">
                                                <AlertTriangle size={10} />
                                                <span>-{b.q_perdidas.toFixed(2)}</span>
                                            </div>
                                        )}
                                        <span className="pipe-efficiency" style={{ color: status.color }}>
                                            {b.eficiencia.toFixed(1)}%
                                        </span>
                                    </div>
                                    {idx === balanceData.length - 1 && (
                                        <div className="schematic-node">
                                            <div className="node-dot" style={{ background: status.color, boxShadow: `0 0 12px ${status.color}` }} />
                                            <span className="node-label">{b.seccion_nombre.split(' → ')[1]}</span>
                                            <span className="node-q">{b.q_salida.toFixed(2)} m³/s</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Manning Comparison */}
                {perfilTramos.length > 0 && (
                    <div className="balance-manning-card">
                        <h2 className="section-title">
                            <TrendingUp size={18} /> Perfil de Diseño — Manning Teórico
                        </h2>
                        <div className="manning-grid">
                            {perfilTramos.slice(0, 12).map((tramo, idx) => {
                                const manning = manningFlow(
                                    tramo.plantilla_m,
                                    tramo.talud_z,
                                    tramo.tirante_diseno_m,
                                    tramo.pendiente_s0,
                                    tramo.rugosidad_n
                                );
                                return (
                                    <div key={idx} className="manning-item">
                                        <div className="manning-header">
                                            <span className="manning-tramo">{tramo.nombre_tramo}</span>
                                            <span className="manning-km">KM {tramo.km_inicio.toFixed(1)}-{tramo.km_fin.toFixed(1)}</span>
                                        </div>
                                        <div className="manning-values">
                                            <div className="manning-row">
                                                <span>Q Manning:</span>
                                                <strong>{manning.Q.toFixed(2)} m³/s</strong>
                                            </div>
                                            <div className="manning-row">
                                                <span>Q Diseño:</span>
                                                <strong>{tramo.capacidad_diseno_m3s.toFixed(2)} m³/s</strong>
                                            </div>
                                            <div className="manning-row">
                                                <span>V:</span>
                                                <strong>{manning.V.toFixed(2)} m/s</strong>
                                            </div>
                                            <div className="manning-row">
                                                <span>Fr:</span>
                                                <strong className={manning.Fr > 1 ? 'supercrit' : ''}>{manning.Fr.toFixed(3)}</strong>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BalanceHidraulico;
