import { memo } from 'react';
import { Link } from 'react-router-dom';
import { CloudRain, Sprout, Radio, RotateCw } from 'lucide-react';
import { Sparkline } from '../ui/Sparkline';
import type { BloqueEstado, FilaGoes } from '../../hooks/useDashboardExtra';
import type { ResumenPronostico, ResumenNdvi } from '../../utils/dashboardExtra';
import { textoEdad, textoBajoUmbral } from '../../utils/hidroEstaciones';

const f = (v: number | null | undefined, d = 1) => (v == null ? 'S/D' : v.toFixed(d));
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mesTexto = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

function Estado({ e, vacio }: { e: BloqueEstado<unknown>; vacio: string }) {
    if (!e.cargado) return <div className="sc-esqueleto sc-esqueleto-bloque" role="status" aria-label="Consultando…" />;
    if (e.error) return (
        <div className="sc-vacio sc-vacio-chico sc-vacio-error" role="alert">
            <p>No se pudo leer: {e.error}</p>
            <button type="button" className="sc-btn" onClick={e.recargar}><RotateCw size={14} aria-hidden="true" /> Reintentar</button>
        </div>
    );
    if (!e.datos) return <p className="sc-vacio sc-vacio-chico">{vacio}</p>;
    return null;
}

/** Pronóstico 48 h de la red (Open-Meteo con corrección de sesgo medida). Es previsión, no medición. */
export const BloquePronostico = memo(function BloquePronostico({ est }: { est: BloqueEstado<ResumenPronostico> }) {
    const p = est.datos;
    return (
        <section className="sc-card sc-extra" aria-labelledby="sc-pro-t">
            <div className="sc-extra-cab"><div><span className="sc-kicker">Pronóstico · próximas 48 h</span><h3 id="sc-pro-t">Clima previsto</h3></div><CloudRain size={20} aria-hidden="true" /></div>
            <Estado e={est} vacio="Sin pronóstico vigente: S/D." />
            {p && (
                <>
                    <dl className="sc-kv">
                        <div><dt>Lluvia prevista</dt><dd>{f(p.lluviaMm)} <small>mm</small></dd></div>
                        <div><dt>Prob. máx. lluvia</dt><dd>{f(p.probMax, 0)} <small>%</small></dd></div>
                        <div><dt>Temp. máx / mín</dt><dd>{f(p.tMax)} / {f(p.tMin)} <small>°C</small></dd></div>
                        <div><dt>Viento máx.</dt><dd>{f(p.vientoMax)} <small>m/s</small></dd></div>
                        <div><dt>ETₒ prevista</dt><dd>{f(p.etoMm, 2)} <small>mm</small></dd></div>
                    </dl>
                    <p className="sc-nota">Previsión (promedio de {p.estaciones} estaciones), con corrección de sesgo local. No es medición.</p>
                </>
            )}
            <Link to="/clima" className="sc-btn sc-pie-boton">Ver Clima y pronóstico</Link>
        </section>
    );
});

/** NDVI del último mes con dato y su anomalía contra el mismo mes de años anteriores. */
export const BloqueNdvi = memo(function BloqueNdvi({ est }: { est: BloqueEstado<ResumenNdvi> }) {
    const n = est.datos && est.datos.mes ? est.datos : null;
    return (
        <section className="sc-card sc-extra" aria-labelledby="sc-ndvi-t">
            <div className="sc-extra-cab"><div><span className="sc-kicker">Vegetación · NDVI mensual</span><h3 id="sc-ndvi-t">Estado del cultivo</h3></div><Sprout size={20} aria-hidden="true" /></div>
            <Estado e={est.cargado && !n && !est.error ? { ...est, datos: null } : est} vacio="Sin serie NDVI: S/D." />
            {n && (
                <>
                    <div className="sc-extra-cifra"><b>{f(n.valor, 3)}</b><span>{mesTexto(n.mes as string)} · {n.nModulos} módulos</span></div>
                    <dl className="sc-kv">
                        <div><dt>Anomalía vs años previos</dt><dd>{n.anomalia == null ? 'S/D' : `${n.anomalia > 0 ? '+' : n.anomalia < 0 ? '−' : ''}${Math.abs(n.anomalia).toFixed(3)}`}</dd></div>
                        <div><dt>Años de referencia</dt><dd>{n.aniosRef}</dd></div>
                        <div><dt>Menor NDVI</dt><dd>{n.peor ? `Mód. ${n.peor.modulo} · ${n.peor.valor.toFixed(3)}` : 'S/D'}</dd></div>
                        <div><dt>Mayor NDVI</dt><dd>{n.mejor ? `Mód. ${n.mejor.modulo} · ${n.mejor.valor.toFixed(3)}` : 'S/D'}</dd></div>
                    </dl>
                    <p className="sc-nota">Último mes cerrado (Sentinel-2). El mes en curso aparece al cerrar.</p>
                </>
            )}
            <Link to="/geo-monitor" className="sc-btn sc-pie-boton">Ver Geo-Monitor</Link>
        </section>
    );
});

/**
 * Telemetría satelital GOES en franja a ancho completo, justo bajo el Pulso: es la salud del dato que respalda Canal, Presas y Alertas.
 * Sin ninguna estación en línea → banda compacta (sin sparklines vacías); con al menos una → tarjetas con gasto y serie de 24 h.
 */
export const FranjaGoes = memo(function FranjaGoes({ est, enVivoFuera }: { est: BloqueEstado<FilaGoes[]>; enVivoFuera: boolean }) {
    const filas = est.datos && est.datos.length ? est.datos : null;
    const enLinea = filas ? filas.filter((g) => g.enlace.clave === 'en_linea' || g.enlace.clave === 'retraso').length : 0;
    const colapsada = filas != null && enLinea === 0;
    return (
        <section className={`sc-card sc-goes-franja ${colapsada ? 'sc-goes-colapsada' : ''}`} aria-labelledby="sc-goes-t">
            <div className="sc-extra-cab">
                <div>
                    <span className="sc-kicker">Telemetría GOES · últimas 24 h{enVivoFuera ? ' · en vivo, no de la fecha' : ''}</span>
                    <h3 id="sc-goes-t">Estaciones hidrométricas{filas ? <span className="sc-goes-cuenta"> · {enLinea} de {filas.length} en línea</span> : null}</h3>
                </div>
                <Radio size={20} aria-hidden="true" />
            </div>
            <Estado e={est.cargado && !filas && !est.error ? { ...est, datos: null } : est} vacio="Sin estaciones GOES activas: S/D." />
            {filas && colapsada && (
                <ul className="sc-goes-chips">
                    {filas.map((g) => (
                        <li key={g.id} className="sc-chip sc-chip-crit">
                            <Radio size={12} aria-hidden="true" /> {g.nombre} · {g.enlace.edadMin == null ? 'sin mensajes' : `sin señal ${textoEdad(g.enlace.edadMin).replace('hace ', 'hace ')}`}
                        </li>
                    ))}
                </ul>
            )}
            {filas && !colapsada && (
                <ul className="sc-goes">
                    {filas.map((g) => (
                        <li key={g.id}>
                            <div className="sc-goes-nom"><b>{g.nombre}</b>
                                <span className={`sc-estado ${g.enlace.clave === 'en_linea' ? 'sc-estado-ok' : g.enlace.clave === 'retraso' ? 'sc-estado-warn' : 'sc-estado-crit'}`}>{g.enlace.etiqueta}</span>
                            </div>
                            <div className="sc-goes-val">
                                <b>{g.bajoUmbral != null ? textoBajoUmbral(g.id) : f(g.gasto, 2)}</b><small>m³/s</small>
                                <span>{textoEdad(g.enlace.edadMin)}</span>
                            </div>
                            <div className="sc-goes-spark"><Sparkline valores={g.serieGasto} etiqueta={`Gasto de ${g.nombre}, últimas 24 h`} unidad="m³/s" decimales={2} alto={22} color="var(--sc-s3)" /></div>
                        </li>
                    ))}
                </ul>
            )}
            <Link to="/presas" className="sc-btn sc-goes-enlace">Ver estaciones en Presas</Link>
        </section>
    );
});
