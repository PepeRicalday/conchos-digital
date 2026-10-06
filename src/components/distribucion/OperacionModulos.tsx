import { memo } from 'react';
import { getLogoPath } from '../../utils/uiHelpers';
import { volumenCiclo, caudalModulo, type ModuloDist } from '../../utils/distribucion';
import { fmt, fmtMiles } from '../../utils/formato';

export interface ModuloOp extends ModuloDist { logo_url?: string | null }
interface Props { modulos: ModuloOp[]; onAbrir: (id: string) => void; sdGlobal: boolean }

const colorCiclo = (p: number) => (p > 100 ? '#f87171' : p > 90 ? '#fbbf24' : '#3987e5');

/** Tarjeta por módulo: ciclo (consumido/autorizado) y caudal contra su objetivo. Sin autorizado/objetivo → S/D, nunca 0.00. */
export const OperacionModulos = memo(function OperacionModulos({ modulos, onAbrir, sdGlobal }: Props) {
    return (
        <section aria-labelledby="dc-mod-t">
            <span className="sc-kicker">{modulos.length} módulos</span>
            <h3 id="dc-mod-t" className="dc-titulo-seccion">Operación por módulo</h3>
            <div className="dc-modulos">
                {modulos.map((m) => {
                    const v = volumenCiclo(m);
                    const q = caudalModulo(m);
                    const codigo = m.short_code || m.name;
                    return (
                        <button key={m.id} type="button" className="sc-card dc-modulo" onClick={() => onAbrir(m.id)} aria-label={`${m.name}: ver detalle`}>
                            <div className="dc-modulo-cab">
                                <img src={getLogoPath(m.name, m.short_code || '', m.logo_url)} alt="" width={36} height={36} className="dc-logo" />
                                <div>
                                    <b className="dc-modulo-cod">{codigo}</b>
                                    <span className="dc-modulo-nombre">{m.name}</span>
                                </div>
                                <span className={`sc-estado ${q.operando ? 'sc-estado-ok' : 'sc-estado-sd'}`}>{sdGlobal ? 'S/D' : q.operando ? 'Operando' : 'Sin flujo'}</span>
                            </div>

                            <div className="dc-modulo-fila">
                                <span className="sc-kicker">Ciclo consumido</span>
                                <b>{v.pct != null ? `${v.pct.toFixed(1)} %` : 'S/D'}</b>
                            </div>
                            <div className={`sc-barra ${v.pct == null ? 'sc-sd' : ''}`} role="progressbar" aria-label={`Ciclo consumido de ${codigo}`} aria-valuemin={0} aria-valuemax={100}
                                aria-valuenow={v.pct == null ? undefined : Math.min(Math.round(v.pct), 100)} aria-valuetext={v.pct == null ? 'Sin volumen autorizado' : `${v.pct.toFixed(1)} por ciento`}>
                                {v.pct != null && <i style={{ width: `${Math.min(v.pct, 100)}%`, background: colorCiclo(v.pct) }} />}
                            </div>
                            <div className="sc-barra-pie">
                                <span>{fmt(v.consumidoMm3, 2)} Mm³ consumidos</span>
                                <span>{v.disponibleMm3 != null ? `${fmtMiles(v.disponibleMm3, 2)} Mm³ disponibles` : 'Sin autorizado'}</span>
                            </div>

                            <div className="dc-modulo-fila">
                                <span className="sc-kicker">Caudal</span>
                                <b>{sdGlobal ? 'S/D' : `${fmtMiles(q.lps, 0)} L/s`}</b>
                            </div>
                            <div className="sc-barra-pie">
                                <span>{q.objetivoLps != null ? `Objetivo ${fmtMiles(q.objetivoLps, 0)} L/s` : 'Sin caudal objetivo'}</span>
                                <span>{q.pctObjetivo != null && !sdGlobal ? `${q.pctObjetivo.toFixed(0)} % del objetivo` : ''}</span>
                            </div>
                        </button>
                    );
                })}
            </div>
        </section>
    );
});
