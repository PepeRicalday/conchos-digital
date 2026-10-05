import { AlertOctagon, AlertTriangle, ShieldCheck, Radio } from 'lucide-react';
import type { AlertaClima, UmbralClima } from '../../hooks/useClimaOperativo';

const textoHace = (iso: string): string => {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 60) return `hace ${min} min`;
    if (min < 1440) return `hace ${Math.floor(min / 60)} h`;
    return `hace ${Math.floor(min / 1440)} d`;
};

/** 'CLIMA-helada-<uuid>' → 'helada'; 'CLIMA-RED-<uuid>' → 'red'. */
const claveDe = (origen: string) => origen.split('-')[1]?.toLowerCase() ?? '';

interface Props {
    alertas: AlertaClima[];
    umbrales: UmbralClima[];
    cargado: boolean;
    error: string | null;
}

export function AlertasAgro({ alertas, umbrales, cargado, error }: Props) {
    const accionDe = (clave: string) => umbrales.find((u) => u.clave === clave)?.accion ?? null;
    const criticas = alertas.filter((a) => a.tipoRiesgo === 'critical').length;

    return (
        <section className="cl-seccion" aria-labelledby="cl-alert-t">
            <header className="cl-seccion-cab">
                <div>
                    <span className="cl-kicker">Alertas agroclimáticas</span>
                    <h3 id="cl-alert-t">Qué hacer hoy</h3>
                </div>
                <div className="cl-seccion-cifra">
                    <b>{cargado ? alertas.length : '…'}</b>
                    <span>{criticas > 0 ? `${criticas} crítica(s)` : 'abiertas'}</span>
                </div>
            </header>

            {error && <p className="cl-aviso cl-aviso-crit"><AlertTriangle size={14} /> No se pudieron leer las alertas: {error}</p>}

            {cargado && !error && alertas.length === 0 && (
                <p className="cl-vacio"><ShieldCheck size={18} aria-hidden="true" /> Sin alertas abiertas: ninguna estación rebasa los umbrales de aviso y la red reporta.</p>
            )}

            <ul className="cl-alertas">
                {alertas.map((a) => {
                    const clave = claveDe(a.origenId);
                    const accion = a.categoria === 'fuente_datos'
                        ? 'No usar esta estación como lectura actual hasta que vuelva a reportar.'
                        : accionDe(clave);
                    const crit = a.tipoRiesgo === 'critical';
                    const Ico = a.categoria === 'fuente_datos' ? Radio : crit ? AlertOctagon : AlertTriangle;
                    return (
                        <li key={a.id} className={`cl-alerta ${crit ? 'cl-alerta-crit' : 'cl-alerta-warn'}`}>
                            <Ico size={18} aria-hidden="true" />
                            <div>
                                <p className="cl-alerta-tit">
                                    <span className="cl-chip">{crit ? 'Crítica' : 'Aviso'}</span>
                                    {a.titulo}
                                </p>
                                <p className="cl-alerta-msg">{a.mensaje}</p>
                                {accion && <p className="cl-alerta-acc"><b>Acción:</b> {accion}</p>}
                                <span className="cl-alerta-t">Detectada {textoHace(a.detectadaEn)}</span>
                            </div>
                        </li>
                    );
                })}
            </ul>

            {umbrales.length > 0 && (
                <details className="cl-umbrales">
                    <summary>Umbrales vigentes</summary>
                    <table>
                        <caption className="cl-sr">Umbrales de aviso y crítico por variable</caption>
                        <thead><tr><th scope="col">Variable</th><th scope="col">Aviso</th><th scope="col">Crítico</th></tr></thead>
                        <tbody>
                            {umbrales.map((u) => (
                                <tr key={u.clave}>
                                    <th scope="row">{u.etiqueta}</th>
                                    <td>{u.comparador === 'menor' ? '≤' : '≥'} {u.aviso} {u.unidad}</td>
                                    <td>{u.comparador === 'menor' ? '≤' : '≥'} {u.critico} {u.unidad}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p>Se evalúan cada 30 min con la última lectura plausible y el pronóstico a 48 h. Editables en la tabla clima_umbrales.</p>
                </details>
            )}
        </section>
    );
}
