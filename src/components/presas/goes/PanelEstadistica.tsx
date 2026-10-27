import { Fragment } from 'react';
import { VENTANAS, colorEstacion, fmt, type EstacionHidro, type VentanaHidro } from '../../../utils/hidroEstaciones';
import { COBERTURA_MIN_CONFIABLE, type EstadisticaEstacion, type ResumenEstacion } from '../../../utils/hidroEstadistica';

interface Props {
    estaciones: EstacionHidro[];
    /** Estadística por id de estación; null mientras carga. */
    estadisticas: Record<string, EstadisticaEstacion> | null;
    ventana: VentanaHidro;
    error: string | null;
    onReintentar: () => void;
}

/** Nombre corto para encabezados de columna (el completo va en el título de la celda). */
const NOMBRE_CORTO: Record<string, string> = {
    C6300760: 'Ojinaga', C63009B2: 'Boca del Río', C6301416: 'Babisas', C6301AC4: 'Madero-Vírgenes',
};
const corto = (e: EstacionHidro) => NOMBRE_CORTO[e.id] ?? e.nombre;

type Campo = 'media' | 'min' | 'max' | 'p90';
const CAMPOS: { campo: Campo; rotulo: string }[] = [
    { campo: 'media', rotulo: 'Media' },
    { campo: 'min', rotulo: 'Mínimo' },
    { campo: 'max', rotulo: 'Máximo' },
    { campo: 'p90', rotulo: 'Percentil 90' },
];

const valor = (r: ResumenEstacion | null | undefined, c: Campo, dec: number) => (r ? fmt(r[c], dec) : 'S/D');
const fmtMm3 = (v: number) => fmt(v, Math.abs(v) < 1 ? 3 : Math.abs(v) < 10 ? 2 : 1);

/** Celda de cobertura: porcentaje y, si es baja, aviso con triángulo (no solo color). */
function Cob({ e }: { e: EstadisticaEstacion }) {
    const c = e.cobertura;
    if (!c) return <>S/D</>;
    return <span className={c.confiable ? '' : 'goes-est-baja'}>{fmt(c.pct, 0)} %{!c.confiable && <> <span aria-hidden="true">▲</span><span className="goes-sr"> menos de {COBERTURA_MIN_CONFIABLE} %</span></>}</span>;
}

/** Gasto medio: con lecturas censuradas (0 = bajo el umbral del sensor) es un rango, no la media de las lecturas positivas. */
function mediaGasto(s: EstadisticaEstacion | undefined, dec: number): string {
    const c = s?.censurado;
    return c ? `${fmt(c.mediaInf, dec)} – ${fmt(c.mediaSup, dec)}` : valor(s?.gasto, 'media', dec);
}

function Vol({ e }: { e: EstadisticaEstacion }) {
    const c = e.censurado;
    if (c && c.volInfMm3 != null && c.volSupMm3 != null) return <>{fmtMm3(c.volInfMm3)} – {fmtMm3(c.volSupMm3)}</>;
    const v = e.volumen;
    if (!v) return <>S/D</>;
    return <>{fmtMm3(v.mm3)}</>;
}

/**
 * Resumen estadístico y volumen de las estaciones en la ventana global. Todo viene de hidroEstadistica (sin ceros
 * sospechosos de Babisas); lo que no se puede calcular es S/D. En ancho se dibuja como tabla (una columna por estación);
 * en contenedor angosto, como una tarjeta por estación (sin scroll horizontal anidado).
 */
export default function PanelEstadistica({ estaciones, estadisticas, ventana, error, onReintentar }: Props) {
    const etiqueta = VENTANAS[ventana].etiqueta;
    const hayExcluidas = !!estadisticas && estaciones.some(e => (estadisticas[e.id]?.excluidas ?? 0) > 0);

    return (
        <section className="goes-card goes-est" aria-label="Resumen estadístico y volumen">
            <div className="goes-h-fila">
                <h4 className="goes-h">Resumen estadístico y volumen</h4>
                <span className="goes-est-ventana">Últimas {etiqueta}</span>
            </div>

            {error ? (
                <div className="goes-vacio" role="alert"><strong>No se pudo calcular el resumen.</strong><span>{error}</span><button type="button" className="goes-btn" onClick={onReintentar}>Reintentar</button></div>
            ) : !estadisticas ? (
                <div className="goes-skeleton goes-skeleton--est" aria-busy="true" aria-label="Calculando el resumen estadístico" />
            ) : estaciones.every(e => !estadisticas[e.id]?.nivel && !estadisticas[e.id]?.gasto) ? (
                <div className="goes-vacio" role="status"><strong>Sin lecturas en esta ventana (S/D)</strong><span>Ninguna estación tiene nivel ni gasto en las últimas {etiqueta}.</span></div>
            ) : (
                <>
                    <div className="goes-est-tabla">
                        <table className="goes-tabla goes-tabla--est tap-compact">
                            <caption>Estadística de las lecturas de las últimas {etiqueta}, por estación</caption>
                            <thead>
                                <tr>
                                    <th scope="col"><span className="goes-sr">Concepto</span></th>
                                    {estaciones.map(e => (
                                        <th key={e.id} scope="col" title={e.nombre}><i className="goes-sw" style={{ background: colorEstacion(e.id) }} aria-hidden="true" />{corto(e)}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {([['nivel', 'Nivel', 'm', 2], ['gasto', 'Gasto', 'm³/s', 1]] as const).map(([k, t, u, dec]) => (
                                    <Fragment key={k}>
                                        <tr className="goes-est-grupo"><th scope="colgroup" colSpan={estaciones.length + 1}>{t} <small>{u}</small></th></tr>
                                        {CAMPOS.map(({ campo, rotulo }) => (
                                            <tr key={k + campo}>
                                                <th scope="row">{rotulo}</th>
                                                {estaciones.map(e => { const s = estadisticas[e.id]; const marca = k === 'gasto' && s != null && !s.gastoRepresentativo && (campo === 'media' || campo === 'p90'); return <td key={e.id} className={marca ? 'goes-est-baja' : undefined}>{marca && <span aria-hidden="true">▲ </span>}{k === 'gasto' && campo === 'media' ? mediaGasto(s, dec) : valor(s?.[k], campo, dec)}</td>; })}
                                            </tr>
                                        ))}
                                    </Fragment>
                                ))}
                                <tr>
                                    <th scope="row">Lecturas de gasto usadas</th>
                                    {estaciones.map(e => { const s = estadisticas[e.id]; return <td key={e.id}>{s ? <>{s.gastoRecibidas - s.excluidas} de {s.gastoRecibidas}{!s.gastoRepresentativo && <span className="goes-est-baja goes-est-repr"><span aria-hidden="true">▲</span> poco representativa</span>}</> : 'S/D'}</td>; })}
                                </tr>
                                <tr className="goes-est-grupo"><th scope="colgroup" colSpan={estaciones.length + 1}>Volumen y calidad de la serie</th></tr>
                                <tr className="goes-est-vol">
                                    <th scope="row">Volumen integrado <small>Mm³ (mínimo, o rango si hay ceros censurados)</small></th>
                                    {estaciones.map(e => <td key={e.id}>{estadisticas[e.id] ? <Vol e={estadisticas[e.id]} /> : 'S/D'}</td>)}
                                </tr>
                                <tr>
                                    <th scope="row">Tiempo integrado</th>
                                    {estaciones.map(e => <td key={e.id}>{estadisticas[e.id]?.volumen ? `${fmt(estadisticas[e.id].volumen!.pctIntegrado, 0)} %` : 'S/D'}</td>)}
                                </tr>
                                <tr>
                                    <th scope="row">Cobertura de lecturas</th>
                                    {estaciones.map(e => <td key={e.id}>{estadisticas[e.id] ? <Cob e={estadisticas[e.id]} /> : 'S/D'}</td>)}
                                </tr>
                                <tr>
                                    <th scope="row">Lecturas excluidas</th>
                                    {estaciones.map(e => <td key={e.id}>{estadisticas[e.id] ? estadisticas[e.id].excluidas : 'S/D'}</td>)}
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div className="goes-est-cards">
                        {estaciones.map(e => {
                            const s = estadisticas[e.id];
                            return (
                                <article key={e.id} className="goes-est-card" style={{ ['--acc' as string]: colorEstacion(e.id) }} aria-label={`Resumen de ${e.nombre}`}>
                                    <h5><i className="goes-sw" style={{ background: colorEstacion(e.id) }} aria-hidden="true" />{e.nombre}</h5>
                                    {s ? (
                                        <dl>
                                            <div><dt>Nivel media</dt><dd>{valor(s.nivel, 'media', 2)} <small>m</small></dd></div>
                                            <div><dt>Nivel mín – máx</dt><dd>{valor(s.nivel, 'min', 2)} – {valor(s.nivel, 'max', 2)}</dd></div>
                                            <div><dt>Gasto media</dt><dd>{mediaGasto(s, 1)} <small>m³/s</small></dd></div>
                                            <div><dt>Gasto mín – máx</dt><dd>{valor(s.gasto, 'min', 1)} – {valor(s.gasto, 'max', 1)}</dd></div>
                                            <div><dt>Gasto p90</dt><dd>{valor(s.gasto, 'p90', 1)}</dd></div>
                                            <div><dt>Volumen integrado (mínimo)</dt><dd><Vol e={s} /> <small>Mm³{s.volumen ? ` · ${fmt(s.volumen.pctIntegrado, 0)} % del tiempo` : ''}</small></dd></div>
                                            <div><dt>Lecturas de gasto usadas</dt><dd>{s.gastoRecibidas - s.excluidas} de {s.gastoRecibidas}{!s.gastoRepresentativo && <> <span className="goes-est-baja"><span aria-hidden="true">▲</span> poco representativa</span></>}</dd></div>
                                            <div><dt>Cobertura</dt><dd><Cob e={s} /></dd></div>
                                            <div><dt>Excluidas</dt><dd>{s.excluidas}</dd></div>
                                        </dl>
                                    ) : <p className="goes-extra goes-extra--sd">S/D</p>}
                                </article>
                            );
                        })}
                    </div>

                    <ul className="goes-est-notas">
                        <li><b>Volumen integrado:</b> gasto integrado entre lecturas vecinas (huecos de más de 45 min no se rellenan), por eso es un mínimo que solo cubre el «tiempo integrado». No es el volumen del periodo ni un aforo, y no se compara con entregas.</li>
                        {hayExcluidas && (
                            <li><b>Gasto censurado (Babisas):</b> el sensor no reporta valores entre 0 y ~15 m³/s, así que su «0» significa «por debajo del umbral», no caudal nulo. Media y volumen se dan como <b>rango</b>: el límite inferior toma esos ceros como 0 y el superior como 15 m³/s; el valor real está entre ambos. Mínimo, máximo y p90 usan solo las lecturas por encima del umbral, y si más de la mitad quedó bajo el umbral la cifra es poco representativa del periodo. Causa sin confirmar: falta contrastar con un aforo.</li>
                        )}
                    </ul>
                </>
            )}
        </section>
    );
}
