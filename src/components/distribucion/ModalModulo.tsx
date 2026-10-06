import { X } from 'lucide-react';
import { useModalA11y } from '../../hooks/useModalA11y';
import { getLogoPath } from '../../utils/uiHelpers';
import { volumenCiclo, caudalModulo } from '../../utils/distribucion';
import { fmt, fmtMiles } from '../../utils/formato';
import type { ModuleData } from '../../store/useHydraStore';

const TIPOS: { tipo: 'toma' | 'lateral' | 'carcamo'; nombre: string }[] = [
    { tipo: 'toma', nombre: 'Tomas' }, { tipo: 'lateral', nombre: 'Laterales' }, { tipo: 'carcamo', nombre: 'Cárcamos' },
];

/** Detalle de un módulo: cifras del ciclo y del día, entrega por tipo y las tomas con actividad. Diálogo accesible. */
export function ModalModulo({ modulo, onCerrar }: { modulo: ModuleData; onCerrar: () => void }) {
    const ref = useModalA11y<HTMLDivElement>(true, onCerrar);
    const v = volumenCiclo(modulo);
    const q = caudalModulo(modulo);
    const activos = modulo.delivery_points.filter((p) => p.is_open || p.current_q_lps > 0 || p.daily_vol > 0);
    return (
        <div className="sc-modal-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
            <div ref={ref} className="sc-modal" role="dialog" aria-modal="true" aria-labelledby="dc-modal-t" tabIndex={-1}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <img src={getLogoPath(modulo.name, modulo.short_code || '', modulo.logo_url)} alt="" width={52} height={52} className="dc-logo" />
                        <div>
                            <span className="sc-kicker">{modulo.short_code || modulo.id.slice(0, 6)}</span>
                            <h2 id="dc-modal-t">{modulo.acu_name || modulo.name}</h2>
                        </div>
                    </div>
                    <button type="button" className="sc-btn" onClick={onCerrar} aria-label="Cerrar detalle"><X size={18} aria-hidden="true" /></button>
                </div>

                <div className="sc-grid-3" style={{ margin: '14px 0' }}>
                    <div className="sc-cifra"><span>Volumen del día</span><b>{fmt(modulo.daily_vol, 4)}<small>Mm³</small></b></div>
                    <div className="sc-cifra"><span>Caudal</span><b>{fmtMiles(q.lps, 0)}<small>L/s</small></b></div>
                    <div className="sc-cifra"><span>Ciclo consumido</span><b>{v.pct != null ? `${v.pct.toFixed(1)}` : 'S/D'}<small>{v.pct != null ? '%' : ''}</small></b></div>
                </div>
                <p className="sc-fresco">
                    {fmtMiles(v.consumidoMm3, 2)} Mm³ consumidos · {v.disponibleMm3 != null ? `${fmtMiles(v.disponibleMm3, 2)} Mm³ disponibles de ${fmtMiles(v.autorizadoMm3, 2)} Mm³ autorizados` : 'sin volumen autorizado cargado'}
                </p>

                <div className="sc-tabla-wrap" style={{ marginTop: 12 }}>
                    <table className="sc-tabla">
                        <caption>Entrega acumulada por tipo de punto</caption>
                        <thead><tr><th scope="col">Tipo</th><th scope="col">Puntos</th><th scope="col">Acumulado (Mm³)</th></tr></thead>
                        <tbody>
                            {TIPOS.map(({ tipo, nombre }) => {
                                const ps = modulo.delivery_points.filter((p) => p.type === tipo);
                                return <tr key={tipo}><th scope="row">{nombre}</th><td>{ps.length}</td><td>{ps.length ? fmt(ps.reduce((a, p) => a + (p.accumulated || 0), 0), 4) : 'S/D'}</td></tr>;
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="sc-tabla-wrap" style={{ marginTop: 14 }}>
                    <table className="sc-tabla">
                        <caption>Infraestructura de entrega con actividad</caption>
                        <thead><tr><th scope="col">Punto</th><th scope="col">Gasto (L/s)</th><th scope="col">Vol. día (Mm³)</th><th scope="col">Acum. (Mm³)</th><th scope="col">Estado</th></tr></thead>
                        <tbody>
                            {activos.length === 0 && <tr><td colSpan={5}>Sin tomas con actividad registrada.</td></tr>}
                            {activos.map((p) => (
                                <tr key={p.id}>
                                    <th scope="row">{p.name}<br /><span className="sc-fresco">{p.type} · km {p.km}</span></th>
                                    <td>{fmtMiles(p.current_q_lps, 0)}</td>
                                    <td>{fmt(p.daily_vol, 4)}</td>
                                    <td>{fmt(p.accumulated, 4)}</td>
                                    <td><span className={`sc-estado ${p.is_open ? 'sc-estado-ok' : 'sc-estado-sd'}`}>{p.is_open ? 'Abierta' : 'Cerrada'}</span></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
