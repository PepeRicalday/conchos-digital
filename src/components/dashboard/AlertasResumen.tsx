import { memo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Info, XCircle, ArrowRight, CircleCheck } from 'lucide-react';
import type { AlertaSistema, ResumenAlertas } from '../../utils/dashboardKpis';

const MAX = 3;
const ICONO = { critical: XCircle, warning: AlertTriangle, info: Info } as const;
const ROTULO = { critical: 'Crítica', warning: 'Aviso', info: 'Informativa' } as const;

/**
 * Resumen de alertas para el Dashboard: las más graves VIGENTES (sin scroll interno) y la salida a /alertas.
 * Las antiguas (> 14 d sin resolver) no compiten con lo de hoy: solo se cuentan.
 */
export const AlertasResumen = memo(function AlertasResumen({ alertas, resumen }: { alertas: AlertaSistema[]; resumen: ResumenAlertas }) {
    const vigentes = alertas.filter((a) => a.id !== 'ok' && a.type !== 'info' && !a.antigua);
    const visibles = vigentes.slice(0, MAX);
    const restantes = Math.max(0, vigentes.length - visibles.length);
    return (
        <section className="sc-card sc-alertas-res" aria-labelledby="sc-alr-t">
            <div className="sc-alr-cab">
                <div><span className="sc-kicker">Lo que requiere atención</span><h3 id="sc-alr-t">Alertas vigentes</h3></div>
                <span className={`sc-alr-total ${resumen.criticas > 0 ? 'sc-crit' : resumen.avisos > 0 ? 'sc-aviso-t' : ''}`} aria-label={`${resumen.accionables} accionables`}>{resumen.accionables}</span>
            </div>
            {visibles.length === 0 ? (
                <p className="sc-alr-ok"><CircleCheck size={18} aria-hidden="true" /> Sin críticas ni avisos vigentes.</p>
            ) : (
                <ul className="sc-alr-lista">
                    {visibles.map((a) => { const I = ICONO[a.type]; return (
                        <li key={a.id} className={`sc-alr sc-alr-${a.type}`}>
                            <I size={18} aria-hidden="true" />
                            <div>
                                <b>{a.title} <span className="sc-alr-sev">· {ROTULO[a.type]}</span></b>
                                <p className="sc-alr-msg" title={a.accion ? `${a.message} Acción: ${a.accion}` : a.message}>{a.message}</p>
                                <span className="sc-alr-t">{a.timestamp}</span>
                            </div>
                        </li>
                    ); })}
                </ul>
            )}
            <p className="sc-alr-pie">
                {restantes > 0 && <>+{restantes} más · </>}{resumen.informativas} informativa(s){resumen.antiguas > 0 ? ` · ${resumen.antiguas} pendiente(s) con más de 14 d` : ''}
            </p>
            <Link to="/alertas" className="sc-btn sc-pie-boton">Ver todas las alertas <ArrowRight size={14} aria-hidden="true" /></Link>
        </section>
    );
});
