import { memo, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { X, AlertTriangle, Info, XCircle, ArrowRight } from 'lucide-react';
import type { AlertaSistema, ResumenAlertas } from '../../utils/dashboardKpis';

const ICONO = { critical: XCircle, warning: AlertTriangle, info: Info } as const;
const ROTULO = { critical: 'Crítica', warning: 'Aviso', info: 'Informativa' } as const;

interface Props { abierto: boolean; onCerrar: () => void; alertas: AlertaSistema[]; resumen: ResumenAlertas }

/**
 * Lista completa de alertas en un <dialog> modal: el navegador da trampa de foco, Esc y `inert` al resto.
 * Panel lateral en pantallas anchas; pantalla completa en teléfono. Al cerrar, el foco vuelve a quien lo abrió.
 */
export const AlertasDrawer = memo(function AlertasDrawer({ abierto, onCerrar, alertas, resumen }: Props) {
    const ref = useRef<HTMLDialogElement | null>(null);
    const tituloRef = useRef<HTMLHeadingElement | null>(null);
    useEffect(() => {
        const d = ref.current; if (!d) return;
        if (abierto && !d.open) { d.showModal(); tituloRef.current?.focus(); }
        if (!abierto && d.open) d.close();
    }, [abierto]);

    const grupos: { clave: string; titulo: string; items: AlertaSistema[] }[] = [
        { clave: 'critical', titulo: 'Críticas', items: alertas.filter((a) => a.type === 'critical' && !a.antigua && a.id !== 'ok') },
        { clave: 'warning', titulo: 'Avisos', items: alertas.filter((a) => a.type === 'warning' && !a.antigua) },
        { clave: 'info', titulo: 'Informativas', items: alertas.filter((a) => a.type === 'info' && !a.antigua && a.id !== 'ok') },
        { clave: 'antigua', titulo: 'Pendientes con más de 14 días', items: alertas.filter((a) => a.antigua) },
    ].filter((g) => g.items.length > 0);

    return (
        <dialog ref={ref} className="kp-drawer" aria-labelledby="kp-drawer-t" onClose={onCerrar} onClick={(e) => { if (e.target === ref.current) onCerrar(); }}>
            <div className="kp-drawer-cuerpo">
                <header className="kp-drawer-cab">
                    <div>
                        <span className="sc-kicker">Alertas del sistema</span>
                        <h2 id="kp-drawer-t" tabIndex={-1} ref={tituloRef}>{resumen.accionables} vigente{resumen.accionables === 1 ? '' : 's'}</h2>
                        <p className="kp-drawer-sub">{resumen.criticas} críticas · {resumen.avisos} avisos · {resumen.informativas} informativas{resumen.antiguas ? ` · ${resumen.antiguas} antiguas` : ''}</p>
                    </div>
                    <button type="button" className="sc-btn" onClick={onCerrar} aria-label="Cerrar alertas"><X size={18} aria-hidden="true" /></button>
                </header>
                <div className="kp-drawer-lista">
                    {grupos.length === 0 && <p className="sc-vacio">Sin alertas activas.</p>}
                    {grupos.map((g) => (
                        <section key={g.clave} aria-label={g.titulo}>
                            <h3 className="kp-drawer-grupo">{g.titulo} · {g.items.length}</h3>
                            <ul>
                                {g.items.map((a) => { const I = ICONO[a.type]; return (
                                    <li key={a.id} className={`sc-alr sc-alr-${a.type}`}>
                                        <I size={18} aria-hidden="true" />
                                        <div>
                                            <b>{a.title} <span className="sc-alr-sev">· {ROTULO[a.type]}</span></b>
                                            <p>{a.message}</p>
                                            {a.accion && <p><b>Acción:</b> {a.accion}</p>}
                                            <span className="sc-alr-t">{a.timestamp}</span>
                                        </div>
                                    </li>
                                ); })}
                            </ul>
                        </section>
                    ))}
                </div>
                <footer className="kp-drawer-pie"><Link to={resumen.criticas > 0 ? '/alertas?tab=criticas' : resumen.avisos > 0 ? '/alertas?tab=avisos' : '/alertas'} className="sc-btn">Abrir página de alertas <ArrowRight size={14} aria-hidden="true" /></Link></footer>
            </div>
        </dialog>
    );
});
