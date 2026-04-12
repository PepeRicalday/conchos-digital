/**
 * CanalReport.tsx — Reporte gerencial de estado del canal (ESTABILIZACIÓN)
 * Imprime / exporta PDF: IEC, balance hídrico, FGV, telemetría crítica.
 */
import React, { useRef, useEffect } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Printer, X } from 'lucide-react';
import type { IECBreakdown } from '../utils/canalIndex';
import './CanalReport.css';

// ── Tipos ────────────────────────────────────────────────────────────────────
interface CoherenciaCanal {
    qPresa: number;
    qK0Medido: number;
    qFinal: number;
    eficiencia: number | null;
    perdidaRio: number | null;
    perdidaCanal: number | null;
    nCoherentes: number;
    totalPuntos: number;
}

interface EscalaRow {
    id: string;
    nombre: string;
    km: number;
    nivel_actual?: number | null;
    nivel_max_operativo?: number | null;
    gasto_actual?: number | null;
    apertura_actual?: number | null;
    delta_12h?: number | null;
    ultima_telemetria?: number | null;
}

interface FGVSummary {
    q_entrada: number;
    q_salida: number;
    eficiencia_conduccion: number | null;
    transit_time_h: number;
    alertas: { km: number; y: number; pct_bordo: number }[];
    criticos: { km: number; y: number }[];
}

export interface CanalReportProps {
    coherencia: CoherenciaCanal;
    iec: IECBreakdown;
    escalas: EscalaRow[];
    fgv?: FGVSummary | null;
    onClose: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const N = (v: number | null | undefined, dec = 2, fb = '—') =>
    v != null && isFinite(v) ? v.toFixed(dec) : fb;

const semColor = (s: string) =>
    s === 'VERDE' ? '#16a34a' : s === 'AMARILLO' ? '#d97706' : '#dc2626';

function formatTs(ts?: number | null): string {
    if (!ts) return 'Sin datos';
    const min = (Date.now() - ts) / 60_000;
    if (min < 1)    return 'Hace < 1 min';
    if (min < 60)   return `Hace ${Math.floor(min)} min`;
    if (min < 1440) return `Hace ${Math.floor(min / 60)}h ${Math.floor(min % 60)}min`;
    return 'Más de 1 día';
}

// ── Componente ───────────────────────────────────────────────────────────────
const CanalReport: React.FC<CanalReportProps> = ({
    coherencia, iec, escalas, fgv, onClose,
}) => {
    const ref    = useRef<HTMLDivElement>(null);
    const iecRef = useRef<HTMLDivElement>(null);

    // CSS custom properties para IEC (colores + anchos de barra dinámicos)
    useEffect(() => {
        const el = iecRef.current;
        if (!el) return;
        const c = semColor(iec.semaforo);
        el.style.setProperty('--sem-color', c);
        el.style.setProperty('--iec-pef',   `${(iec.p_eficiencia / 30) * 100}%`);
        el.style.setProperty('--iec-pcoh',  `${(iec.p_coherencia / 25) * 100}%`);
        el.style.setProperty('--iec-pfug',  `${(iec.p_fugas      / 25) * 100}%`);
        el.style.setProperty('--iec-pcrit', `${(iec.p_criticos   / 20) * 100}%`);
    }, [iec]);

    const handlePrint = useReactToPrint({
        contentRef: ref,
        documentTitle: `SICA_Canal_${new Date().toLocaleDateString('en-CA')}`,
    });

    const fecha = new Date().toLocaleString('es-MX', {
        timeZone: 'America/Chihuahua',
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });

    const alertasTop = [...escalas]
        .filter(e => e.km >= 0 && e.nivel_actual != null && e.nivel_max_operativo != null)
        .map(e => ({
            ...e,
            pct: ((e.nivel_actual! / e.nivel_max_operativo!) * 100),
        }))
        .filter(e => e.pct >= 80)
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 8);

    const incoherentes = [...escalas]
        .filter(e => e.km >= 0 && e.gasto_actual != null)
        .filter((e, i, arr) => {
            if (i === 0) return false;
            const prev = arr[i - 1];
            const delta = prev.gasto_actual! > 0
                ? ((e.gasto_actual! - prev.gasto_actual!) / prev.gasto_actual!) * 100
                : 0;
            return delta > 15;
        });

    return (
        <div className="rpt-overlay" onClick={onClose}>
            <div className="rpt-dialog" onClick={e => e.stopPropagation()}>
                {/* Toolbar */}
                <div className="rpt-toolbar">
                    <span className="rpt-toolbar-title">REPORTE GERENCIAL — CANAL CONCHOS</span>
                    <div className="rpt-toolbar-actions">
                        <button type="button" className="rpt-btn-print" onClick={() => handlePrint()}>
                            <Printer size={14} /> Imprimir / PDF
                        </button>
                        <button type="button" className="rpt-btn-close" onClick={onClose} title="Cerrar reporte" aria-label="Cerrar reporte">
                            <X size={14} />
                        </button>
                    </div>
                </div>

                {/* Contenido imprimible */}
                <div className="rpt-body" ref={ref}>
                    {/* Encabezado */}
                    <div className="rpt-header">
                        <div className="rpt-header-brand">
                            <img src="/logos/logo-srl.png" alt="SRL" className="rpt-logo" />
                            <div>
                                <div className="rpt-title">REPORTE DE ESTADO HIDRÁULICO</div>
                                <div className="rpt-subtitle">CANAL PRINCIPAL CONCHOS — DISTRITO 005</div>
                            </div>
                        </div>
                        <div className="rpt-header-meta">
                            <div className="rpt-meta-date">{fecha}</div>
                            <div className="rpt-meta-mode">MODO ESTABILIZACIÓN</div>
                        </div>
                    </div>

                    {/* IEC Scorecard */}
                    <section className="rpt-section">
                        <h2 className="rpt-section-title">ÍNDICE DE ESTADO DEL CANAL (IEC)</h2>
                        <div className="rpt-iec-row" ref={iecRef} data-sem={iec.semaforo}>
                            <div className="rpt-iec-score">
                                <span className="rpt-iec-num">{iec.iec}</span>
                                <span className="rpt-iec-den">/100</span>
                                <span className="rpt-iec-sem">{iec.semaforo}</span>
                            </div>
                            <div className="rpt-iec-components">
                                {([
                                    ['Eficiencia hidráulica', 'ef',   iec.p_eficiencia, 30, iec.inputs.eficiencia_pct],
                                    ['Coherencia de escalas', 'coh',  iec.p_coherencia, 25, iec.inputs.coherencia_pct],
                                    ['Ausencia de fugas',     'fug',  iec.p_fugas,      25, iec.inputs.fuga_pct],
                                    ['Niveles operativos',    'crit', iec.p_criticos,   20, iec.inputs.criticos_pct],
                                ] as [string, string, number, number, number | null][]).map(([label, key, pts, max, raw]) => (
                                    <div key={key} className="rpt-iec-comp">
                                        <span className="rpt-iec-comp-label">{label}</span>
                                        <div className="rpt-iec-comp-bar">
                                            <div className={`rpt-iec-comp-fill iec-fill-${key}`} />
                                        </div>
                                        <span className="rpt-iec-comp-pts">{pts}/{max}</span>
                                        {raw != null && <span className="rpt-iec-comp-raw">({raw.toFixed(1)}%)</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <p className="rpt-iec-texto">{iec.texto}</p>
                    </section>

                    {/* Balance hídrico */}
                    <section className="rpt-section">
                        <h2 className="rpt-section-title">BALANCE HÍDRICO</h2>
                        <div className="rpt-balance-chain">
                            <div className="rpt-bc-node">
                                <div className="rpt-bc-label">PRESA</div>
                                <div className="rpt-bc-val">{N(coherencia.qPresa, 2)} m³/s</div>
                            </div>
                            <div className="rpt-bc-arrow">
                                <div className="rpt-bc-loss">−{N(coherencia.perdidaRio, 2)}</div>
                                <div className="rpt-bc-dist">36 km río</div>
                            </div>
                            <div className="rpt-bc-node">
                                <div className="rpt-bc-label">K0+000</div>
                                <div className="rpt-bc-val">{N(coherencia.qK0Medido, 2)} m³/s</div>
                            </div>
                            <div className="rpt-bc-arrow">
                                <div className="rpt-bc-loss">−{N(coherencia.perdidaCanal, 2)}</div>
                                <div className="rpt-bc-dist">104 km canal</div>
                            </div>
                            <div className="rpt-bc-node">
                                <div className="rpt-bc-label">K104</div>
                                <div className="rpt-bc-val">{N(coherencia.qFinal, 2)} m³/s</div>
                            </div>
                        </div>
                        <div className="rpt-balance-kpis">
                            <div className="rpt-bkpi">
                                <span>Eficiencia canal</span>
                                <b>{N(coherencia.eficiencia, 1)}%</b>
                            </div>
                            <div className="rpt-bkpi">
                                <span>Coherencia de escalas</span>
                                <b>{coherencia.nCoherentes}/{coherencia.totalPuntos} puntos</b>
                            </div>
                            <div className="rpt-bkpi">
                                <span>Pérdida río (36 km)</span>
                                <b>{N(coherencia.perdidaRio, 2)} m³/s</b>
                            </div>
                            <div className="rpt-bkpi">
                                <span>Pérdida canal (104 km)</span>
                                <b>{N(coherencia.perdidaCanal, 2)} m³/s</b>
                            </div>
                        </div>
                    </section>

                    {/* FGV (si disponible) */}
                    {fgv && (
                        <section className="rpt-section">
                            <h2 className="rpt-section-title">MODELACIÓN HIDRÁULICA FGV</h2>
                            <div className="rpt-balance-kpis">
                                <div className="rpt-bkpi"><span>Q entrada simulado</span><b>{N(fgv.q_entrada, 2)} m³/s</b></div>
                                <div className="rpt-bkpi"><span>Q salida simulado</span><b>{N(fgv.q_salida, 2)} m³/s</b></div>
                                <div className="rpt-bkpi"><span>Eficiencia conducción FGV</span><b>{N(fgv.eficiencia_conduccion, 1)}%</b></div>
                                <div className="rpt-bkpi"><span>Tiempo de tránsito</span><b>{N(fgv.transit_time_h, 1)} h</b></div>
                                <div className="rpt-bkpi"><span>Puntos de alerta FGV</span><b>{fgv.alertas.length}</b></div>
                                <div className="rpt-bkpi"><span>Puntos críticos FGV</span><b className={fgv.criticos.length > 0 ? 'rpt-val-crit' : ''}>{fgv.criticos.length}</b></div>
                            </div>
                            {fgv.criticos.length > 0 && (
                                <table className="rpt-table rpt-mt">
                                    <thead>
                                        <tr><th>KM</th><th>Tirante (m)</th><th>Estado</th></tr>
                                    </thead>
                                    <tbody>
                                        {fgv.criticos.map((c, i) => (
                                            <tr key={i} className="rpt-row-crit">
                                                <td>K{c.km.toFixed(1)}</td>
                                                <td>{c.y.toFixed(3)} m</td>
                                                <td>CRÍTICO</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </section>
                    )}

                    {/* Escalas en alerta */}
                    {alertasTop.length > 0 && (
                        <section className="rpt-section">
                            <h2 className="rpt-section-title">ESCALAS EN ZONA DE ALERTA / CRÍTICO</h2>
                            <table className="rpt-table">
                                <thead>
                                    <tr><th>Nombre</th><th>KM</th><th>Nivel (m)</th><th>Nivel Máx (m)</th><th>% Bordo</th><th>Gasto (m³/s)</th><th>Último dato</th></tr>
                                </thead>
                                <tbody>
                                    {alertasTop.map(e => (
                                        <tr key={e.id} className={e.pct >= 92 ? 'rpt-row-crit' : 'rpt-row-alert'}>
                                            <td>{e.nombre}</td>
                                            <td>{e.km.toFixed(1)}</td>
                                            <td>{N(e.nivel_actual, 3)}</td>
                                            <td>{N(e.nivel_max_operativo, 2)}</td>
                                            <td>{e.pct.toFixed(1)}%</td>
                                            <td>{N(e.gasto_actual, 3)}</td>
                                            <td>{formatTs(e.ultima_telemetria)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>
                    )}

                    {/* Incoherencias */}
                    {incoherentes.length > 0 && (
                        <section className="rpt-section">
                            <h2 className="rpt-section-title">PUNTOS CON INCOHERENCIA HIDRÁULICA</h2>
                            <table className="rpt-table">
                                <thead>
                                    <tr><th>Nombre</th><th>KM</th><th>Gasto (m³/s)</th><th>Observación</th></tr>
                                </thead>
                                <tbody>
                                    {incoherentes.map(e => (
                                        <tr key={e.id} className="rpt-row-alert">
                                            <td>{e.nombre}</td>
                                            <td>{e.km.toFixed(1)}</td>
                                            <td>{N(e.gasto_actual, 3)}</td>
                                            <td>Incremento anómalo aguas abajo</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>
                    )}

                    {/* Footer */}
                    <div className="rpt-footer">
                        <span>SICA 005 — Conchos Digital · Generado automáticamente</span>
                        <span>{fecha}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CanalReport;
