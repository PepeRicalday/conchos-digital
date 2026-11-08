import { useEffect, useMemo, useState } from 'react';
import type { RedJcas } from '../../../hooks/useJcasCuenca';
import { useCuencaPronostico } from '../../../hooks/useCuencaPronostico';
import BotonInformeClimaCuenca from '../../BotonInformeClimaCuenca';
import { useDevice } from '../../../hooks/useDevice';
import { cargarDemCuenca, type DemGrid, type PuntoCampo } from '../../../utils/camposCuenca';
import { consensoPorPunto, resumenConfiabilidad, valorPronosticoPeriodo } from '../../../utils/cuencaPronostico';
import { formatearNumero } from '../../../utils/historicoPresas';
import { fechaCorta } from '../../../utils/analiticaPresas';
import { VARIABLES_PLANO, type VariablePlano } from '../../../utils/paletasClima';
import { construirPlano, planoSvg, type PeriodoPlano } from '../../../utils/planosCuenca';
import { puntosObservados, puntosPronostico } from '../../../utils/planosDatos';

type Modo = 'obs' | 'pron';
const VARIABLES: { v: VariablePlano; t: string }[] = [{ v: 'lluvia', t: 'Lluvia' }, { v: 'temperatura', t: 'Temperatura' }, { v: 'viento', t: 'Viento' }, { v: 'humedad', t: 'Humedad' }];
const fmt = (v: number | null, d = 1) => (v == null ? 'S/D' : formatearNumero(v, d));

function Segmentado<T extends string | number>({ etiqueta, valor, opciones, onChange }: { etiqueta: string; valor: T; opciones: { v: T; t: string }[]; onChange: (v: T) => void }) {
    const id = `cu-pl-${etiqueta}`;
    return (
        <div className="cu-ctl">
            <span className="cu-ctl-etq" id={id}>{etiqueta}</span>
            <div className="an-seg" role="group" aria-labelledby={id}>
                {opciones.map((o) => <button key={String(o.v)} type="button" className="an-seg-btn" aria-pressed={valor === o.v} onClick={() => onChange(o.v)}>{o.t}</button>)}
            </div>
        </div>
    );
}

const hoyLocal = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
const hace = (iso: string | null) => {
    if (!iso) return 'sin corrida';
    const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000));
    return h < 1 ? 'hace menos de 1 h' : h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
};

/**
 * Planos de la cuenca del Conchos: isoyetas y planos de temperatura, viento y humedad, observados (red JCAS) o pronosticados (3 modelos en 24 puntos).
 * CONTEXTO provisional de fuente tercera. El dibujo es el mismo SVG que usa el informe (utils/planosCuenca): una sola definición.
 */
export default function PlanosCuenca({ jcas }: { jcas: { red: RedJcas | null; loading: boolean; error: string | null } }) {
    const [variable, setVariable] = useState<VariablePlano>('lluvia');
    const [modo, setModo] = useState<Modo>('obs');
    const [diasObs, setDiasObs] = useState<7 | 30>(30);
    const [diasPron, setDiasPron] = useState<3 | 7>(7);
    const [dem, setDem] = useState<DemGrid | null>(null);
    const dev = useDevice();
    const pron = useCuencaPronostico();

    useEffect(() => { let vivo = true; cargarDemCuenca().then((d) => { if (vivo) setDem(d); }); return () => { vivo = false; }; }, []);

    const contorno = jcas.red?.contorno ?? null;
    const hoy = hoyLocal();
    const periodo: PeriodoPlano = modo === 'obs' ? { tipo: 'obs', dias: diasObs } : { tipo: 'pron', dias: diasPron };

    const puntos: PuntoCampo[] | null = useMemo(() => {
        if (modo === 'obs') return jcas.red?.modelo ? puntosObservados(jcas.red.modelo, variable, diasObs) : null;
        return pron.datos ? puntosPronostico(pron.datos.puntos, pron.datos.filas, variable, diasPron, hoy) : null;
    }, [modo, variable, diasObs, diasPron, jcas.red, pron.datos, hoy]);

    const plano = useMemo(() => (contorno && puntos ? construirPlano({ variable, periodo, puntos, contorno, dem }) : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [contorno, puntos, variable, modo, diasObs, diasPron, dem]);

    const descripcion = plano ? `${plano.titulo}. ${plano.motivoSD ? `Sin dato: ${plano.motivoSD}` : `Promedio ${fmt(plano.resumen.media)} ${plano.unidad} con ${plano.resumen.n} estaciones`}` : '';
    // El SVG se muestra como imagen (data URL): no puede ejecutar nada aunque un nombre de estación trajera marcado.
    const svg = useMemo(() => (plano && contorno ? planoSvg(plano, contorno, { tema: 'pantalla', textoPx: dev.esPhone ? 17 : 12, idPrefijo: 'pnl', descripcion }) : ''), [plano, contorno, dev.esPhone, descripcion]);

    const confiab = useMemo(() => resumenConfiabilidad(pron.datos?.verificacion ?? []), [pron.datos]);
    const filasPron = useMemo(() => {
        if (modo !== 'pron' || !pron.datos) return [];
        return pron.datos.puntos.map((p) => {
            const d = consensoPorPunto(pron.datos!.filas, p.id, hoy);
            return { p, lluvia: valorPronosticoPeriodo(d, 'lluvia', hoy, diasPron), temp: valorPronosticoPeriodo(d, 'temperatura', hoy, diasPron).valor, viento: valorPronosticoPeriodo(d, 'viento', hoy, diasPron).valor, diasLluvia: d.slice(0, diasPron).some((x) => x.probPct == null) ? null : d.slice(0, diasPron).filter((x) => (x.probPct ?? 0) >= 50).length };
        }).sort((a, b) => (b.lluvia.valor ?? -1) - (a.lluvia.valor ?? -1));
    }, [modo, pron.datos, hoy, diasPron]);

    const cfg = VARIABLES_PLANO[variable];
    const cargando = jcas.loading || (modo === 'pron' && pron.loading);
    const falla = modo === 'obs' ? jcas.error : pron.error;

    return (
        <section className="an-card cu-planos" aria-label="Planos de la cuenca">
            <div className="cu-red-cab">
                <div>
                    <h4 className="an-h">Planos de la cuenca</h4>
                    <p className="an-nota">
                        {modo === 'obs' ? 'Lo observado por las estaciones JCAS/UACJ' : 'Pronóstico de 3 modelos (ECMWF, GFS e ICON) en 24 puntos de la cuenca'} · contexto provisional, no medición oficial.
                    </p>
                </div>
                <BotonInformeClimaCuenca red={jcas.red} pron={pron.datos} dem={dem} />
            </div>
            <div className="cu-controles" role="group" aria-label="Variable y periodo del plano">
                <Segmentado<VariablePlano> etiqueta="Variable" valor={variable} onChange={setVariable} opciones={VARIABLES} />
                <Segmentado<Modo> etiqueta="Datos" valor={modo} onChange={setModo} opciones={[{ v: 'obs', t: 'Observado' }, { v: 'pron', t: 'Pronóstico' }]} />
                {modo === 'obs'
                    ? <Segmentado<7 | 30> etiqueta="Periodo" valor={diasObs} onChange={setDiasObs} opciones={[{ v: 7, t: '7 días' }, { v: 30, t: '30 días' }]} />
                    : <Segmentado<3 | 7> etiqueta="Periodo" valor={diasPron} onChange={setDiasPron} opciones={[{ v: 3, t: '3 días' }, { v: 7, t: '7 días' }]} />}
            </div>

            {cargando && <div className="an-skeleton an-skeleton--alta" aria-busy="true" />}
            {!cargando && (falla || !plano) && (
                <div className="an-vacio" role="status"><strong>Sin plano por ahora (S/D)</strong><span>{falla ?? 'Todavía no hay estaciones o contorno cargados.'}</span></div>
            )}

            {!cargando && plano && (
                <div className="cu-pl-cuerpo">
                    <figure className="cu-plano">
                        <img className="cu-plano-img" alt={descripcion} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} />
                        <figcaption className="cu-leyenda-viz">{plano.titulo} · {cfg.titulo} en {cfg.unidad}. Niveles fijos: dos planos de fechas distintas se comparan a ojo.</figcaption>
                    </figure>
                    <div className="cu-pl-res">
                        <div className="cu-red-kpi">
                            <span className="an-kpi-lbl">{variable === 'lluvia' ? (modo === 'obs' ? 'Lluvia promedio de la cuenca' : 'Lluvia pronosticada promedio') : `${cfg.titulo} promedio`}</span>
                            <span className="an-kpi-val">{plano.resumen.media == null ? 'S/D' : formatearNumero(plano.resumen.media, variable === 'temperatura' || plano.resumen.media < 10 ? 1 : 0)}{plano.resumen.media != null && <small> {cfg.unidad}</small>}</span>
                            <span className="an-kpi-sub">
                                {plano.motivoSD ? plano.motivoSD : `${plano.resumen.min != null && plano.resumen.max != null ? `rango ${formatearNumero(plano.resumen.min, 0)}–${formatearNumero(plano.resumen.max, 0)} ${cfg.unidad} · ` : ''}n = ${plano.resumen.n} estaciones · cobertura ${plano.resumen.coberturaPct.toFixed(0)} % del área`}
                            </span>
                        </div>
                        {plano.resumen.maxEn && <p className="cu-pl-dato"><b>Mayor valor:</b> {plano.resumen.maxEn.nombre}, {formatearNumero(plano.resumen.maxEn.valor, variable === 'temperatura' ? 1 : 0)} {cfg.unidad}</p>}
                        <p className="cu-pl-dato"><b>Altitud:</b> {plano.ajuste.motivo}.</p>
                        {plano.excluidos.length > 0 && <p className="an-aviso" role="status"><b>Excluida del plano:</b> {plano.excluidos.map((p) => p.nombre).join(', ')} (pluviómetro sospechoso).</p>}
                        {modo === 'pron' && (
                            <div className="cu-red-kpi">
                                <span className="an-kpi-lbl">Confiabilidad del pronóstico</span>
                                <span className="an-kpi-sub">{confiab.texto}</span>
                                <span className="an-kpi-sub">Corrida {hace(pron.datos?.corridaEn ?? null)} · rango entre modelos en la tabla</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {modo === 'pron' && !cargando && filasPron.length > 0 && (
                <div className="cu-tabla-wrap" tabIndex={0} role="region" aria-label="Pronóstico por estación (desplazable)">
                    <table className="cu-tabla">
                        <thead><tr>
                            <th scope="col">Estación</th><th scope="col" className="cu-num">Lluvia {diasPron} d</th><th scope="col" className="cu-num">Entre modelos</th>
                            <th scope="col" className="cu-num">Días con lluvia</th><th scope="col" className="cu-num">Temp. media</th><th scope="col" className="cu-num">Viento</th>
                        </tr></thead>
                        <tbody>
                            {filasPron.map(({ p, lluvia, temp, viento, diasLluvia }) => (
                                <tr key={p.id}>
                                    <th scope="row"><div className="cu-presa"><span className="cu-nombre">{p.nombre}</span>{p.fuente === 'weatherlink' && <span className="cu-tag">Propia</span>}{p.grupo && <span className="cu-nota-fila">Misma ciudad que otras estaciones</span>}</div></th>
                                    <td className="cu-num">{lluvia.valor == null ? 'S/D' : `${fmt(lluvia.valor)} mm`}</td>
                                    <td className="cu-num">{lluvia.min == null || lluvia.max == null ? 'S/D' : `${fmt(lluvia.min, 0)}–${fmt(lluvia.max, 0)} mm`}</td>
                                    <td className="cu-num">{diasLluvia == null ? 'S/D' : `${diasLluvia} de ${diasPron}`}</td>
                                    <td className="cu-num">{temp == null ? 'S/D' : `${fmt(temp)} °C`}</td>
                                    <td className="cu-num">{viento == null ? 'S/D' : `${fmt(viento, 0)} km/h`}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <details className="an-pie cu-notas">
                <summary className="cu-notas-sum">Cómo se hacen los planos y qué límites tienen</summary>
                <ul>
                    <li><b>Interpolación:</b> inverso de la distancia al cuadrado entre las estaciones, limitada a 90 km. Donde no hay una estación a esa distancia el plano se deja con trama y no entra a los promedios. Con menos de 5 estaciones útiles o menos del 50 % del área cubierta, el plano es S/D.</li>
                    <li><b>Altitud:</b> la corrección por altitud usa la elevación del modelo digital (no la que reporta JCAS, que no es confiable) y solo se aplica con 12 o más estaciones y R² de 0.5 o más; se declara arriba.</li>
                    <li><b>Una estación por ciudad:</b> las 4 de Chihuahua pesan una vez (mediana). Los pluviómetros sospechosos se excluyen solo de la lluvia.</li>
                    <li><b>Pronóstico:</b> mediana de 3 modelos (ECMWF, GFS, ICON) en las coordenadas de cada estación; la lluvia de un periodo es la suma de la mediana diaria; un «día con lluvia» es aquel en que al menos 2 de los 3 modelos dan 1 mm o más. Los modelos pueden discrepar mucho en tormentas: por eso se muestra el rango entre ellos. Se compara con lo que midió JCAS (pronóstico de víspera) y, con menos de {60} pares día-estación, la confiabilidad se rotula «en construcción».</li>
                    <li><b>Fuente:</b> estaciones de JCAS/UACJ (portal público, datos provisionales) y pronóstico de Open-Meteo (uso no comercial). Son contexto: no sustituyen las estaciones propias ni los aforos.</li>
                    <li>Sin dirección del viento: JCAS solo entrega la velocidad media diaria.{plano?.periodo.tipo === 'obs' ? ` Corte al ${fechaCorta(jcas.red?.modelo?.fin ?? hoy)}.` : ''}</li>
                </ul>
            </details>
        </section>
    );
}
