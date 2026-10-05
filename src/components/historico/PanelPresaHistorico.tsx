import { useMemo } from 'react';
import {
    aperturaMes, calidadMes, cierreMes, cierresPorAnio, deltaMes, extremos, formatearNumero, MESES_LARGO,
    NOMBRE_PRESA, posicionHistorica, serieMes,
    type MapaPresa, type Metrica, type TipoSerie,
} from '../../utils/historicoPresas';
import MapaCalorLlenado from './MapaCalorLlenado';
import SerieComparada, { ESTILOS_SERIE } from './SerieComparada';

interface Props {
    presaId: string;
    mapa: MapaPresa | undefined;
    todosLosAnios: number[];
    /** Años seleccionados, del más reciente (base) al más antiguo. */
    aniosSel: number[];
    mes: number;
    vista: 'mes' | 'anio';
    metrica: Metrica;
    serie: TipoSerie;
    onSeleccionar: (anio: number, mes: number) => void;
}

const fechaCorta = (iso: string) => `${Number(iso.slice(8))} ${MESES_LARGO[Number(iso.slice(5, 7)) - 1].slice(0, 3).toLowerCase()} ${iso.slice(0, 4)}`;
const signo = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');
const abs = Math.abs;

function Spark({ valores, color }: { valores: (number | null)[]; color: string }) {
    const pts = valores.map((v, i) => (v == null ? null : ([i, v] as const))).filter((p): p is readonly [number, number] => p !== null);
    if (pts.length < 2) return null;
    const lo = Math.min(...pts.map(p => p[1]));
    const hi = Math.max(...pts.map(p => p[1]));
    const W = 120, H = 34;
    const x = (i: number) => (i / Math.max(1, valores.length - 1)) * W;
    const y = (v: number) => (hi === lo ? H / 2 : H - 3 - ((v - lo) / (hi - lo)) * (H - 6));
    return (
        <svg className="ah-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
            <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={pts.map(p => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')} />
            <circle cx={x(pts[pts.length - 1][0])} cy={y(pts[pts.length - 1][1])} r="3" fill={color} />
        </svg>
    );
}

export default function PanelPresaHistorico({ presaId, mapa, todosLosAnios, aniosSel, mes, vista, metrica, serie, onSeleccionar }: Props) {
    const nombre = NOMBRE_PRESA[presaId] ?? presaId;
    const mesNombre = MESES_LARGO[mes - 1];

    // Año de referencia de las tarjetas: el más reciente de los elegidos que tenga lecturas en el mes
    // (si el año base aún no tiene, el contexto usa el siguiente en vez de mostrar todo en S/D).
    const base = useMemo(
        () => aniosSel.find(a => cierreMes(mapa, a, mes, 'volumen', serie) != null) ?? aniosSel[0],
        [aniosSel, mapa, mes, serie],
    );
    const sustituido = base !== aniosSel[0];

    const t = useMemo(() => {
        const cVol = cierreMes(mapa, base, mes, 'volumen', serie);
        const cPct = cierreMes(mapa, base, mes, 'llenado', serie);
        const dVol = deltaMes(mapa, base, mes, 'volumen', serie);
        const dEle = deltaMes(mapa, base, mes, 'elevacion', serie);
        const cierres = cierresPorAnio(mapa, todosLosAnios, mes, 'volumen', serie);
        const pos = posicionHistorica(cierres, base);
        const prev = cierres.find(c => c.anio === base - 1);
        const ext = extremos(mapa, 'volumen', serie);
        const q = calidadMes(mapa, base, mes);
        const apertura = aperturaMes(mapa, base, mes, 'volumen', serie);
        return { cVol, cPct, dVol, dEle, cierres, pos, prev, ext, q, apertura, spark: serieMes(mapa, base, mes, 'volumen', serie), fuente: mapa?.get(cVol?.fecha ?? '')?.fuente };
    }, [mapa, base, mes, serie, todosLosAnios]);

    const vsPrev = t.cVol && t.prev && t.prev.valor !== 0 ? { abs: t.cVol.valor - t.prev.valor, pct: ((t.cVol.valor - t.prev.valor) / t.prev.valor) * 100 } : null;

    return (
        <section className="ah-panel" aria-label={`Histórico de ${nombre}`}>
            <header className="ah-panel-head">
                <div>
                    <span className="ah-kicker">Presa</span>
                    <h2 className="ah-panel-nombre">{nombre}</h2>
                </div>
                {t.ext && (
                    <p className="ah-extremos">
                        <span><b>Máx.</b> {formatearNumero(t.ext.max.valor, 0)} Mm³ · {fechaCorta(t.ext.max.fecha)}</span>
                        <span><b>Mín.</b> {formatearNumero(t.ext.min.valor, 0)} Mm³ · {fechaCorta(t.ext.min.fecha)}</span>
                    </p>
                )}
            </header>

            {sustituido && (
                <p className="ah-aviso">
                    {aniosSel[0]} aún no tiene lecturas de {mesNombre.toLowerCase()}: las tarjetas de contexto usan {base}, el año más reciente con dato.
                </p>
            )}

            <div className="ah-tiles">
                <article className="ah-tile">
                    <span className="ah-k">Cierre de {mesNombre.toLowerCase()} {base}</span>
                    <span className="ah-num">{t.cVol ? formatearNumero(t.cVol.valor, 1) : 'S/D'}<small>Mm³</small></span>
                    <span className="ah-sub">
                        {t.cPct ? `${formatearNumero(t.cPct.valor, 1)} % de la capacidad` : 'sin lectura en el mes'}
                        {t.cVol && ` · al ${fechaCorta(t.cVol.fecha)}`}
                    </span>
                    {t.fuente && <span className={`ah-chip ah-chip--${t.fuente.toLowerCase()}`}>{t.fuente === 'HISTORICO' ? 'HISTÓRICO SRL' : t.fuente}</span>}
                </article>

                <article className="ah-tile">
                    <span className="ah-k">Cambio durante el mes</span>
                    {t.dVol ? (
                        <>
                            <span className={`ah-num ${t.dVol.delta > 0 ? 'is-up' : t.dVol.delta < 0 ? 'is-down' : ''}`}>
                                {signo(t.dVol.delta)}{formatearNumero(abs(t.dVol.delta), 1)}<small>Mm³</small>
                            </span>
                            <span className="ah-sub">
                                {t.dEle ? `${signo(t.dEle.delta)}${formatearNumero(abs(t.dEle.delta), 2)} m · ` : ''}
                                {t.dVol.base === 'mes-anterior' ? `desde el cierre de ${MESES_LARGO[(mes + 10) % 12].toLowerCase()}` : `desde el ${fechaCorta(t.dVol.desde.fecha)}`}
                            </span>
                            <Spark valores={t.spark} color={ESTILOS_SERIE[0].color} />
                        </>
                    ) : (
                        <>
                            <span className="ah-num is-sd">S/D</span>
                            <span className="ah-sub">{t.apertura ? 'solo hay una lectura en el mes: no hay con qué comparar' : 'sin lecturas en el mes'}</span>
                        </>
                    )}
                </article>

                <article className="ah-tile">
                    <span className="ah-k">Posición en el registro</span>
                    {t.pos ? (
                        <>
                            <span className="ah-num ah-num--txt">{t.pos.posicion === 1 ? 'El más bajo' : t.pos.posicion === t.pos.de ? 'El más alto' : `${t.pos.posicion}.º más bajo`}</span>
                            <span className="ah-sub">de {t.pos.de} años con dato al cierre de {mesNombre.toLowerCase()}</span>
                            <ol className="ah-rank" aria-label="Cierres por año, de menor a mayor">
                                {t.cierres.map(c => (
                                    <li key={c.anio} className={c.anio === base ? 'is-base' : ''} title={`${c.anio}: ${formatearNumero(c.valor, 1)} Mm³`}>
                                        <i style={{ height: `${12 + (c.valor / t.cierres[t.cierres.length - 1].valor) * 26}px` }} />
                                        <span>{String(c.anio).slice(2)}</span>
                                    </li>
                                ))}
                            </ol>
                        </>
                    ) : (
                        <>
                            <span className="ah-num is-sd">S/D</span>
                            <span className="ah-sub">se necesitan al menos dos años con dato en {mesNombre.toLowerCase()}</span>
                        </>
                    )}
                </article>

                <article className="ah-tile">
                    <span className="ah-k">Contra {base - 1}</span>
                    {vsPrev ? (
                        <>
                            <span className={`ah-num ${vsPrev.abs > 0 ? 'is-up' : vsPrev.abs < 0 ? 'is-down' : ''}`}>
                                {signo(vsPrev.pct)}{formatearNumero(abs(vsPrev.pct), 1)}<small>%</small>
                            </span>
                            <span className="ah-sub">{signo(vsPrev.abs)}{formatearNumero(abs(vsPrev.abs), 1)} Mm³ frente al cierre de {mesNombre.toLowerCase()} {base - 1}</span>
                        </>
                    ) : (
                        <>
                            <span className="ah-num is-sd">S/D</span>
                            <span className="ah-sub">{base - 1} no tiene lectura de {mesNombre.toLowerCase()}</span>
                        </>
                    )}
                </article>
            </div>

            <SerieComparada mapa={mapa} anios={aniosSel} mes={mes} vista={vista} metrica={metrica} serie={serie} nombrePresa={nombre} />

            <div className="ah-sub-titulo">
                <h3>Almanaque de cierres mensuales</h3>
                <span>Toca una celda para llevar la comparación a ese mes y año</span>
            </div>
            <MapaCalorLlenado
                mapa={mapa} anios={todosLosAnios} metrica={metrica} serie={serie}
                mesSeleccionado={mes} aniosSeleccionados={aniosSel} onSeleccionar={onSeleccionar}
            />

            <footer className="ah-calidad">
                <b>{mesNombre} {base}:</b> {t.q.conDato} de {t.q.diasMes} días con dato
                {t.q.sinDato > 0 && <> · <span className="ah-warn">{t.q.sinDato} sin dato (S/D)</span></>}
                {t.q.atipicos > 0 && <> · <span className="ah-warn">{t.q.atipicos} atípico{t.q.atipicos > 1 ? 's' : ''} por revisar</span></>}
                {t.q.fuentes.length > 0 && <> · fuente: {t.q.fuentes.map(f => (f === 'HISTORICO' ? 'histórico SRL' : f.toLowerCase())).join(', ')}</>}
            </footer>
        </section>
    );
}
