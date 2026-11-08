import { useMemo, useState } from 'react';
import type { useJcasCuenca } from '../../../hooks/useJcasCuenca';
import { formatearNumero } from '../../../utils/historicoPresas';
import { fechaCorta } from '../../../utils/analiticaPresas';
import type { LluviaAreal } from '../../../utils/jcasCuenca';
import { arealDe, etiquetaVentana, valorObs, VENTANAS_OBS, type PuntoRedJcas, type VentanaObs } from '../../../utils/jcasModelo';
import MapaCuenca from './MapaCuenca';
import type { CapasCuenca } from '../../../hooks/useCapasCuenca';

const horaLectura = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-MX', { timeZone: 'America/Chihuahua', hour: '2-digit', minute: '2-digit', hour12: false }) : 'S/D');
const fmtMm = (v: number | null) => (v == null ? 'S/D' : `${formatearNumero(v, 1)} mm`);

function estadoTexto(p: PuntoRedJcas): { glifo: string; texto: string; clase: string } {
    if (p.sospechosa) return { glifo: '✕', texto: 'Excluida (sospechosa)', clase: 'crit' };
    if (p.estado === 'sin-datos') return { glifo: '◇', texto: 'Sin datos', clase: 'sd' };
    if (p.estado === 'atrasada') return { glifo: '▲', texto: `Atrasada ${p.atrasoDias} d`, clase: 'warn' };
    if (p.sinPluviometro) return { glifo: '◆', texto: 'Sin pluviómetro', clase: 'sd' };
    return { glifo: '●', texto: 'Al día', clase: 'ok' };
}

function KpiAreal({ etiqueta, a }: { etiqueta: string; a: LluviaAreal }) {
    return (
        <div className="cu-red-kpi">
            <span className="an-kpi-lbl">{etiqueta}</span>
            <span className="an-kpi-val">{a.mm == null ? 'S/D' : formatearNumero(a.mm, 1)}{a.mm != null && <small> mm</small>}</span>
            <span className="an-kpi-sub">
                {a.mm == null
                    ? a.motivoSD
                    : `n = ${a.nEstaciones} estaciones · cobertura ${a.coberturaPct.toFixed(0)} % del área${a.min != null && a.max != null ? ` · rango ${formatearNumero(a.min, 0)}–${formatearNumero(a.max, 0)} mm` : ''}`}
            </span>
        </div>
    );
}

/**
 * Red de estaciones JCAS/UACJ dentro de la cuenca del Conchos: mapa propio, lluvia areal (hoy, ayer, 7 y 30 días) y tabla por estación.
 * CONTEXTO de fuente TERCERA y provisional (portal público sin API): no sustituye las estaciones propias ni entra a KPIs del distrito.
 */
export default function RedEstacionesCuenca({ jcas, capas }: { jcas: ReturnType<typeof useJcasCuenca>; capas?: CapasCuenca }) {
    const { red, loading, error, recargar } = jcas;
    const [ventana, setVentana] = useState<VentanaObs>(30);
    const [sel, setSel] = useState<number | null>(null);

    const filas = useMemo(() => {
        const ps = red?.modelo?.puntos ?? [];
        const mm = (p: PuntoRedJcas) => valorObs(p, 'lluvia', ventana);
        return [...ps].sort((a, b) => (mm(b) ?? -1) - (mm(a) ?? -1) || a.nombre.localeCompare(b.nombre));
    }, [red, ventana]);

    if (loading) return <section className="an-card" aria-busy="true" aria-label="Cargando red de estaciones"><div className="an-skeleton" /></section>;
    if (error || !red?.modelo || !red.contorno) {
        return (
            <section className="an-card" aria-label="Red de estaciones de la cuenca">
                <h4 className="an-h">Red de estaciones de la cuenca · JCAS</h4>
                <div className="an-vacio" role="status">
                    <strong>Sin estaciones JCAS por ahora (S/D)</strong>
                    <span>{error ?? 'Todavía no hay estaciones o contorno de la cuenca cargados.'}</span>
                    <button type="button" className="an-btn" onClick={recargar}>Reintentar</button>
                </div>
            </section>
        );
    }
    const m = red.modelo;
    const areal = arealDe(m, ventana);
    const excluidas = m.puntos.filter((p) => p.sospechosa);

    return (
        <section className="an-card cu-red" aria-label="Red de estaciones de la cuenca">
            <div className="cu-red-cab">
                <div>
                    <h4 className="an-h">Red de estaciones de la cuenca · JCAS</h4>
                    <p className="an-nota">
                        {m.vigentes} de {m.total} estaciones JCAS/UACJ con dato de los últimos 3 días · días completos al {fechaCorta(m.fin)}{m.fechaHoy ? <> · <b>hoy {fechaCorta(m.fechaHoy)} (parcial, lectura de las {horaLectura(m.hoyEn)})</b></> : ' · hoy sin lectura (S/D)'} · fuente: portal público de JCAS (UACJ),
                        dato provisional; <b>contexto</b>, no sustituye las estaciones propias.
                    </p>
                </div>
                <div className="cu-ctl">
                    <span className="cu-ctl-etq" id="cu-red-ventana">Ventana</span>
                    <div className="an-seg" role="group" aria-labelledby="cu-red-ventana">
                        {VENTANAS_OBS.map(({ v, t }) => (
                            <button key={String(v)} type="button" className="an-seg-btn" aria-pressed={ventana === v} onClick={() => setVentana(v)}>{t}</button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="cu-red-kpis">
                <KpiAreal etiqueta={`Lluvia areal de la cuenca · ${typeof ventana === 'number' && ventana > 1 ? `${ventana} días` : etiquetaVentana(ventana)}`} a={areal} />
                <div className="cu-red-kpi">
                    <span className="an-kpi-lbl">Estaciones con lluvia útil</span>
                    <span className="an-kpi-val">{m.conLluvia}<small> de {m.total}</small></span>
                    <span className="an-kpi-sub">Incluye las estaciones propias del distrito. Las de una misma ciudad pesan una vez; las sin pluviómetro o excluidas no entran al promedio.</span>
                </div>
            </div>

            {excluidas.length > 0 && (
                <p className="an-aviso" role="status">
                    <b>{excluidas.length === 1 ? 'Pluviómetro excluido' : 'Pluviómetros excluidos'}:</b> {excluidas.map((p) => `${p.nombre} (${p.motivo})`).join('; ')}. Es un criterio de SICA, no un dictamen: puede ser un sensor obstruido o una zona sin lluvia.
                </p>
            )}

            <MapaCuenca contorno={red.contorno} puntos={m.puntos} seleccionada={sel} onSelect={setSel} ventana={ventana} propias={m.propias} capas={capas} />

            <div className="cu-tabla-wrap" tabIndex={0} role="region" aria-label="Tabla de estaciones JCAS (desplazable)">
                <table className="cu-tabla">
                    <thead>
                        <tr>
                            <th scope="col">Estación</th>
                            <th scope="col" className="cu-num">Lluvia hoy (parcial)</th>
                            <th scope="col" className="cu-num">Lluvia ayer</th>
                            <th scope="col" className="cu-num">Lluvia 7 d</th>
                            <th scope="col" className="cu-num">Lluvia 30 d</th>
                            <th scope="col" className="cu-num">Temp. último día</th>
                            <th scope="col">Estado</th>
                            <th scope="col">Último día</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filas.map((p) => {
                            const e = estadoTexto(p);
                            return (
                                <tr key={p.id} className={p.id === sel ? 'cu-fila--sel' : undefined} onClick={() => setSel(p.id)}>
                                    <th scope="row"><div className="cu-presa">
                                        <span className="cu-nombre">{p.nombre}</span>
                                        {p.zona === 'salida' && <span className="cu-tag">Salida</span>}
                                        {p.grupo && <span className="cu-nota-fila">Misma ciudad que otras estaciones: pesa una vez en el promedio</span>}
                                        {p.sospechosa && p.motivo && <span className="cu-nota-fila">{p.motivo}</span>}
                                    </div></th>
                                    <td className="cu-num">{fmtMm(p.hoy?.mm ?? null)}</td>
                                    <td className="cu-num">{fmtMm(p.ayer.mm)}</td>
                                    <td className="cu-num">{fmtMm(p.mm7)}</td>
                                    <td className="cu-num">{fmtMm(p.mm30)}</td>
                                    <td className="cu-num">{p.tempUltima == null ? 'S/D' : `${formatearNumero(p.tempUltima, 1)} °C`}</td>
                                    <td><span className={`cu-estado cu-estado--${e.clase}`}><span aria-hidden="true">{e.glifo}</span> {e.texto}</span></td>
                                    <td className="cu-fecha">{p.ultFecha ? fechaCorta(p.ultFecha) : 'S/D'}</td>
                                </tr>
                            );
                        })}
                        {m.propias.map((p) => (
                            <tr key={p.id}>
                                <th scope="row"><div className="cu-presa"><span className="cu-nombre">{p.nombre}</span><span className="cu-tag">Propia</span><span className="cu-nota-fila">Estación WeatherLink del distrito: solo aporta lluvia</span></div></th>
                                <td className="cu-num">{fmtMm(p.mmHoy)}</td><td className="cu-num">{fmtMm(p.mm1)}</td><td className="cu-num">{fmtMm(p.mm7)}</td><td className="cu-num">{fmtMm(p.mm30)}</td>
                                <td className="cu-num">S/D</td>
                                <td><span className="cu-estado cu-estado--ok"><span aria-hidden="true">●</span> Al día</span></td>
                                <td className="cu-fecha">{p.ultFecha ? fechaCorta(p.ultFecha) : 'S/D'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <details className="an-pie cu-notas">
                <summary className="cu-notas-sum">Cómo se calcula y qué límites tiene la red JCAS</summary>
                <ul>
                    <li><b>Fuente:</b> JCAS (Junta Central de Agua y Saneamiento de Chihuahua) con la UACJ publica sus estaciones en un portal abierto sin API ni términos de uso publicados. SICA lee solo las páginas públicas de cada estación, con pausas, y lo copia a tablas propias (última sincronización: {red.ultSyncEn ? new Date(red.ultSyncEn).toLocaleString('es-MX', { timeZone: 'America/Chihuahua', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : 'nunca'}). Si el portal cambia de formato, la lectura se detiene y se muestra S/D.</li>
                    <li><b>Contorno:</b> cuencas J–N de la región hidrológica RH24 (INEGI-CONAGUA, 28 subcuencas, ≈ {formatearNumero(red.contorno.areaKm2 ?? 0, 0)} km²). Ojinaga queda en el borde de salida.</li>
                    <li><b>Días completos y hoy:</b> los acumulados de ayer, 7 y 30 días usan solo días cerrados del reloj de cada estación. «Hoy» es el día en curso y es PARCIAL: lluvia acumulada y medias hasta la última lectura (cada 2 h aprox.); no se mezcla con los días completos ni con la verificación del pronóstico. Un acumulado con menos del 80 % de los días con dato es S/D.</li>
                    <li><b>Promedio areal:</b> interpolación por inverso de la distancia al cuadrado sobre una malla de 0.1°, limitada a 90 km de cada estación; con menos de 5 estaciones útiles o menos del 50 % del área cubierta, el resultado es S/D (nunca 0 mm).</li>
                    <li><b>Estaciones propias:</b> las {m.propias.length} estaciones WeatherLink dentro de la cuenca suman a la lluvia observada (el valor del día es la última lectura de su contador diario). Solo aportan lluvia; temperatura, viento y humedad siguen viniendo de JCAS.</li>
                    <li><b>Pluviómetros sospechosos:</b> 0 mm en 30 días mientras al menos dos vecinas a ≤ 90 km registran 20 mm o más. Se excluyen del promedio y se avisa.</li>
                    <li>Sin pluviómetro, el 0.0 que muestra el portal no significa «no llovió»: se trata como S/D. La serie JCAS es corta, así que no se dice qué es lo normal ni se calculan anomalías.</li>
                </ul>
            </details>
        </section>
    );
}
