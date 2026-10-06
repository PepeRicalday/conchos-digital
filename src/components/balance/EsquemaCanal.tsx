import { memo } from 'react';
import { estadoTramo, type TramoBalance } from '../../utils/balanceTramos';
import { fmt } from '../../utils/formato';

const COLOR = { ok: '#34d399', warn: '#fbbf24', crit: '#f87171', sd: '#8396ad', info: '#38bdf8' } as const;

/** Esquema del canal: cada tramo con su entrada, % de capacidad de diseño usada y estado en texto. */
export const EsquemaCanal = memo(function EsquemaCanal({ tramos }: { tramos: TramoBalance[] }) {
    const ordenados = [...tramos].sort((a, b) => a.km_inicio - b.km_inicio);
    return (
        <section className="sc-card" aria-labelledby="bal-esq-t">
            <span className="sc-kicker">Flujo real contra capacidad de diseño</span>
            <h3 id="bal-esq-t">Esquema del canal</h3>
            {ordenados.length === 0 ? <p className="sc-vacio">Sin tramos para dibujar.</p> : (
                <ol className="bal-esquema">
                    {ordenados.map((b) => {
                        const est = estadoTramo(b);
                        const sd = b.sinDato && !b.cerrado;
                        // Sin perfil de diseño no hay base de capacidad: tubería rayada, no un 50 % inventado.
                        const pct = b.perfil && b.perfil.capacidad_diseno_m3s > 0 && !sd ? Math.min(100, (b.q_entrada / b.perfil.capacidad_diseno_m3s) * 100) : null;
                        return (
                            <li key={`${b.km_inicio}`} className="bal-tramo">
                                <div className="bal-tramo-cab">
                                    <b>{b.seccion_nombre.split(' → ')[0]}</b>
                                    <span className="bal-tramo-q">{sd ? 'S/D' : `${fmt(b.q_entrada, 2)} m³/s`}</span>
                                    <span className={`sc-estado sc-estado-${est.tipo}`}>{est.texto}</span>
                                </div>
                                <div className={`sc-barra ${pct == null ? 'sc-sd' : ''}`} role="progressbar" aria-label={`Capacidad usada ${b.seccion_nombre}`} aria-valuemin={0} aria-valuemax={100}
                                    aria-valuenow={pct == null ? undefined : Math.round(pct)} aria-valuetext={pct == null ? 'Sin perfil de diseño o sin dato' : `${pct.toFixed(0)} por ciento de la capacidad`}>
                                    {pct != null && <i style={{ width: `${pct}%`, background: COLOR[est.tipo] }} />}
                                </div>
                                <div className="sc-barra-pie">
                                    <span>{pct != null ? `${pct.toFixed(0)} % de la capacidad de diseño` : sd ? 'Sin dato de caudal' : 'Sin perfil de diseño'}</span>
                                    <span>{b.q_tomas > 0 && !sd ? `Tomas ${fmt(b.q_tomas, 2)} m³/s` : ''}{b.q_perdidas > 0.01 && !sd && !b.anomalo ? ` · pérdida ${fmt(b.q_perdidas, 2)} m³/s` : ''}</span>
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}
        </section>
    );
});
