import type { CubetaActividad, Granularidad } from '../../utils/alertasPantalla';
import { haceTexto, type AlertaFila } from '../../utils/alertasPantalla';

const SEV = [
    { k: 'critical', et: 'Crítica', cls: 'al-act-crit' },
    { k: 'warning', et: 'Aviso', cls: 'al-act-warn' },
    { k: 'info', et: 'Info', cls: 'al-act-info' },
] as const;

const UNIDAD: Record<Granularidad, string> = { horas: 'bloques de 2 h', dias: 'días', semanas: 'semanas' };

function duracion(h: number | null): string {
    if (h == null) return 'duración S/D';
    if (h < 1) return `abierta ${Math.max(1, Math.round(h * 60))} min`;
    if (h < 48) return `abierta ${h.toFixed(h < 10 ? 1 : 0)} h`;
    return `abierta ${Math.round(h / 24)} d`;
}

interface Props {
    cubetas: CubetaActividad[];
    granularidad: Granularidad;
    cerradas: (AlertaFila & { abiertaH: number | null })[];
    ahoraMs: number;
    periodo: string;
}

/**
 * Actividad del periodo: aperturas por intervalo apiladas por severidad (barras CSS, una columna por intervalo, con
 * el total encima) y las últimas alertas cerradas con cuánto duraron abiertas. El color nunca va solo: leyenda con
 * texto y conteo total por severidad.
 */
export function ActividadAlertas({ cubetas, granularidad, cerradas, ahoraMs, periodo }: Props) {
    const max = Math.max(1, ...cubetas.map((c) => c.critical + c.warning + c.info));
    const tot = { critical: 0, warning: 0, info: 0 };
    for (const c of cubetas) { tot.critical += c.critical; tot.warning += c.warning; tot.info += c.info; }
    const total = tot.critical + tot.warning + tot.info;
    // Etiquetas del eje: no más de ~8 para que no se encimen.
    const cadaN = Math.max(1, Math.ceil(cubetas.length / 10));

    return (
        <section className="sc-card al-act" aria-labelledby="al-act-t">
            <span className="sc-kicker">Actividad · {periodo}</span>
            <h3 id="al-act-t">Aperturas por {granularidad === 'horas' ? 'hora' : granularidad === 'dias' ? 'día' : 'semana'}</h3>
            <ul className="al-act-leyenda">
                {SEV.map((s) => <li key={s.k}><i className={s.cls} aria-hidden="true" />{s.et} <b>{tot[s.k]}</b></li>)}
            </ul>
            {total === 0 ? (
                <p className="al-nota">Sin aperturas en el periodo.</p>
            ) : (
                <div className="al-act-graf" role="img"
                    aria-label={`${total} aperturas en ${cubetas.length} ${UNIDAD[granularidad]}: ${tot.critical} críticas, ${tot.warning} avisos, ${tot.info} informativas`}>
                    {cubetas.map((c, i) => {
                        const n = c.critical + c.warning + c.info;
                        return (
                            <div key={c.inicioMs} className="al-act-col" title={`${c.etiqueta}${granularidad === 'horas' ? ' h' : ` ${c.mes}`}: ${n} aperturas (${c.critical} crít., ${c.warning} avisos, ${c.info} info)`}>
                                <span className="al-act-n">{n > 0 ? n : ''}</span>
                                <div className="al-act-pila" style={{ height: `${(n / max) * 100}%` }}>
                                    {SEV.map((s) => c[s.k] > 0 && <span key={s.k} className={s.cls} style={{ flexGrow: c[s.k] }} />)}
                                </div>
                                <span className="al-act-et">
                                    {i % cadaN === 0 ? c.etiqueta : ''}
                                    {granularidad !== 'horas' && (i === 0 || cubetas[i - 1].mes !== c.mes) && <small>{c.mes}</small>}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}

            <h4 className="al-act-sub">Últimas cerradas</h4>
            {cerradas.length === 0 ? (
                <p className="al-nota">Ninguna alerta del periodo se ha cerrado todavía.</p>
            ) : (
                <ul className="al-cerradas">
                    {cerradas.map((a) => (
                        <li key={a.id}>
                            <i className={a.tipo_riesgo === 'critical' ? 'al-act-crit' : a.tipo_riesgo === 'warning' ? 'al-act-warn' : 'al-act-info'} aria-hidden="true" />
                            <div>
                                <b>{a.titulo}</b>
                                <small>Cerrada {haceTexto(a.fecha_resolucion ?? null, ahoraMs)} · {duracion(a.abiertaH)}</small>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
