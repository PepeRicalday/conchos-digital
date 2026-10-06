import { memo } from 'react';
import { Printer, TriangleAlert, FileText } from 'lucide-react';
import { usePredictiveBalance } from '../../hooks/usePredictiveBalance';
import { fmt } from '../../utils/formato';

/** Alertas predictivas y tramos con anomalía de balance, más impresión del reporte (la página completa se imprime sin controles). */
export const ReporteEjecutivo = memo(function ReporteEjecutivo({ fecha }: { fecha: string }) {
    const { alertas, tramos, loading } = usePredictiveBalance();
    const anomalias = tramos.filter((t) => t.estado === 'critico' || t.estado === 'alerta');
    return (
        <section className="sc-card" aria-labelledby="bal-rep-t">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div>
                    <span className="sc-kicker"><FileText size={12} aria-hidden="true" /> Reporte ejecutivo · {fecha}</span>
                    <h3 id="bal-rep-t">Alertas de balance predictivo</h3>
                </div>
                <button type="button" className="sc-btn no-print" onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> Imprimir / PDF</button>
            </div>
            <p className="sc-fresco print-only">Canal Principal Conchos — Reporte de balance hídrico · Fecha {fecha} · Generado {new Date().toLocaleString('es-MX', { timeZone: 'America/Chihuahua' })}</p>

            {loading ? <p className="sc-vacio">Calculando…</p> : alertas.length === 0 && anomalias.length === 0 ? (
                <p className="sc-vacio">Sin alertas predictivas ni anomalías de balance.</p>
            ) : (
                <>
                    <ul className="bal-alertas">
                        {alertas.map((a) => (
                            <li key={a.id} className={`bal-alerta ${a.type === 'critical' ? 'crit' : 'warn'}`}>
                                <TriangleAlert size={16} aria-hidden="true" />
                                <div><b>{a.type === 'critical' ? 'Crítica · ' : 'Aviso · '}{a.title}</b><p>{a.message}</p></div>
                            </li>
                        ))}
                    </ul>
                    {anomalias.length > 0 && (
                        <div className="sc-tabla-wrap">
                            <table className="sc-tabla">
                                <caption>Tramos con anomalía respecto de su línea base de 7 días</caption>
                                <thead><tr><th scope="col">Tramo</th><th scope="col">Hoy</th><th scope="col">Base 7 d</th><th scope="col">Δ (pp)</th></tr></thead>
                                <tbody>
                                    {anomalias.slice(0, 6).map((t) => (
                                        <tr key={t.label}>
                                            <th scope="row">{t.label}</th>
                                            <td>{t.eficiencia_hoy != null ? `${fmt(t.eficiencia_hoy)} %` : 'S/D'}</td>
                                            <td>{t.eficiencia_baseline != null ? `${fmt(t.eficiencia_baseline)} %` : 'S/D'}</td>
                                            <td>{fmt(t.delta_pp)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </section>
    );
});
