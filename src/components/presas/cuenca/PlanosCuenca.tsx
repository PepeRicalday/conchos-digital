import { Kpi, DataTable } from '../../ui/base';
import { useEffect, useMemo, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import type { RedJcas } from '../../../hooks/useJcasCuenca';
import { useCuencaPronostico } from '../../../hooks/useCuencaPronostico';
import BotonInformeClimaCuenca from '../../BotonInformeClimaCuenca';
import type { ModeloUnifrut } from '../../../utils/unifrutModelo';
import { useDevice } from '../../../hooks/useDevice';
import { cargarDemCuenca, type DemGrid, type PuntoCampo } from '../../../utils/camposCuenca';
import { consensoPorPunto, resumenConfiabilidad, valorPronosticoPeriodo } from '../../../utils/cuencaPronostico';
import { formatearNumero } from '../../../utils/historicoPresas';
import { fechaCorta } from '../../../utils/analiticaPresas';
import { VARIABLES_PLANO, type VariablePlano } from '../../../utils/paletasClima';
import { construirPlano, planoSvg, type PeriodoPlano } from '../../../utils/planosCuenca';
import { puntosObservados, puntosPronostico, rankingDePuntos } from '../../../utils/planosDatos';
import type { CapasCuenca } from '../../../hooks/useCapasCuenca';
import SelectorCapas from './SelectorCapas';
import { arealDe, cuandoVentana, VENTANAS_OBS, type VentanaObs } from '../../../utils/jcasModelo';
import { fmtLluvia } from '../../../utils/fmtLluvia';
import { hoyLocalISO } from '../../../utils/hoyLocal';

type Modo = 'obs' | 'pron';
const VARIABLES: { v: VariablePlano; t: string }[] = [{ v: 'lluvia', t: 'Lluvia' }, { v: 'temperatura', t: 'Temperatura' }, { v: 'viento', t: 'Viento' }, { v: 'humedad', t: 'Humedad' }, { v: 'tmin', t: 'T mínima' }, { v: 'horasFrio', t: 'Horas frío' }];
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

const hoyLocal = () => hoyLocalISO();
const horaLectura = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-MX', { timeZone: 'America/Chihuahua', hour: '2-digit', minute: '2-digit', hour12: false }) : 'S/D');
const hace = (iso: string | null) => {
    if (!iso) return 'sin corrida';
    const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000));
    return h < 1 ? 'hace menos de 1 h' : h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
};

/**
 * Planos de la cuenca del Conchos: isoyetas y planos de temperatura, viento y humedad, observados (red JCAS) o pronosticados (3 modelos en 24 puntos).
 * CONTEXTO provisional de fuente tercera. El dibujo es el mismo SVG que usa el informe (utils/planosCuenca): una sola definición.
 */
export default function PlanosCuenca({ jcas, capas, diasObs: diasProp, onDias, unifrut, onMapaCompleto }: { jcas: { red: RedJcas | null; loading: boolean; error: string | null }; capas?: CapasCuenca; diasObs?: VentanaObs; onDias?: (v: VentanaObs) => void; unifrut?: { modelo: ModeloUnifrut | null; ultSyncEn: string | null }; onMapaCompleto?: () => void }) {
    const [variable, setVariableBase] = useState<VariablePlano>('lluvia');
    const [modo, setModo] = useState<Modo>('obs');
    // Las horas frío no se pronostican: al elegirlas se vuelve a lo observado.
    const setVariable = (v: VariablePlano) => { setVariableBase(v); if (v === 'horasFrio') setModo('obs'); };
    const [diasLocal, setDiasLocal] = useState<VentanaObs>(30);
    const diasObs = diasProp ?? diasLocal;
    const setDiasObs = onDias ?? setDiasLocal;
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

    // Una sola verdad: la lluvia areal observada es la MISMA que muestran la cabecera, la red de estaciones y los informes (arealDe).
    const arealUnico = useMemo(() => (variable === 'lluvia' && modo === 'obs' && jcas.red?.modelo ? arealDe(jcas.red.modelo, diasObs) : null), [variable, modo, jcas.red, diasObs]);
    const periodoClave = modo === 'obs' ? `obs:${diasObs}` : `pron:${diasPron}`;
    const plano = useMemo(() => (contorno && puntos ? construirPlano({ variable, periodo, puntos, contorno, dem, areal: arealUnico }) : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [contorno, puntos, variable, periodoClave, dem, arealUnico]);

    const descripcion = plano ? `${plano.titulo}. ${plano.motivoSD ? `Sin dato: ${plano.motivoSD}` : `Promedio ${plano.resumen.media == null ? 'S/D' : variable === 'lluvia' ? fmtLluvia(plano.resumen.media) : fmt(plano.resumen.media)} ${plano.unidad} con ${plano.resumen.n} estaciones`}` : '';
    // El SVG se muestra como imagen (data URL): no puede ejecutar nada aunque un nombre de estación trajera marcado.
    const svg = useMemo(() => (plano && contorno ? planoSvg(plano, contorno, { tema: 'pantalla', textoPx: dev.esPhone ? 17 : 12, idPrefijo: 'pnl', descripcion, capas: capas && capas.ids.length ? { ids: capas.ids, datos: capas.datos } : undefined }) : ''), [plano, contorno, dev.esPhone, descripcion, capas?.ids, capas?.datos]);

    const confiab = useMemo(() => resumenConfiabilidad(pron.datos?.verificacion ?? []), [pron.datos]);
    const filasPron = useMemo(() => {
        if (modo !== 'pron' || !pron.datos) return [];
        return pron.datos.puntos.map((p) => {
            const d = consensoPorPunto(pron.datos!.filas, p.id, hoy);
            return { p, lluvia: valorPronosticoPeriodo(d, 'lluvia', hoy, diasPron), temp: valorPronosticoPeriodo(d, 'temperatura', hoy, diasPron).valor, viento: valorPronosticoPeriodo(d, 'viento', hoy, diasPron).valor, diasLluvia: d.slice(0, diasPron).some((x) => x.probPct == null) ? null : d.slice(0, diasPron).filter((x) => (x.probPct ?? 0) >= 50).length };
        }).sort((a, b) => (b.lluvia.valor ?? -1) - (a.lluvia.valor ?? -1));
    }, [modo, pron.datos, hoy, diasPron]);

    const cfg = VARIABLES_PLANO[variable];
    // El ranking sale de los puntos YA colapsados del plano (una estación por ciudad, sospechosas fuera): mismas filas y nombres que el mapa.
    const ranking = useMemo(() => rankingDePuntos(plano?.puntos ?? []), [plano]);
    // El resumen del plano ya viene del areal en lluvia observada: sin respaldo con otra cifra (si es S/D, se dice S/D).
    const mediaKpi = plano?.resumen.media ?? null;
    const fmtVal = (v: number) => (variable === 'lluvia' ? fmtLluvia(v) : formatearNumero(v, variable === 'temperatura' || variable === 'tmin' ? 1 : 0));
    const maxRank = ranking.filas.length ? Math.max(...ranking.filas.map((f) => Math.abs(f.valor)), 0.0001) : 1;
    const cargando = jcas.loading || (modo === 'pron' && pron.loading);
    const falla = modo === 'obs' ? jcas.error : pron.error;

    return (
        <section className="an-card cu-planos" aria-label="Planos de la cuenca">
            <div className="cu-red-cab">
                <div>
                    <h4 className="an-h">Planos de la cuenca</h4>
                    <p className="an-nota">
                        {modo === 'obs' ? 'Lo observado por las estaciones JCAS/UACJ y, en lluvia, también las propias' : 'Pronóstico de 3 modelos (ECMWF, GFS e ICON) en 24 puntos de la cuenca'} · contexto provisional, no medición oficial.
                    </p>
                </div>
                <div className="cu-planos-acc">
                {onMapaCompleto && <button type="button" className="an-btn" onClick={onMapaCompleto} disabled={!jcas.red?.contorno} title="Mapa interactivo de clima a pantalla completa: estaciones propias, JCAS y Unifrut con filtros"><Maximize2 size={14} aria-hidden="true" /> Mapa interactivo</button>}
                <BotonInformeClimaCuenca red={jcas.red} pron={pron.datos} dem={dem} unifrut={unifrut?.modelo ?? null} ultSyncUnifrut={unifrut?.ultSyncEn ?? null} />
                </div>
            </div>
            <div className="cu-cq" id="cu-planos">
                <div className="cu-pl-grid">
                    <div className="cu-pl-ctl">
                        <div className="cu-controles" role="group" aria-label="Variable y periodo del plano">
                            <Segmentado<VariablePlano> etiqueta="Variable" valor={variable} onChange={setVariable} opciones={VARIABLES} />
                            <Segmentado<Modo> etiqueta="Datos" valor={modo} onChange={setModo} opciones={variable === 'horasFrio' ? [{ v: 'obs', t: 'Observado' }] : [{ v: 'obs', t: 'Observado' }, { v: 'pron', t: 'Pronóstico' }]} />
                            {modo === 'obs'
                                ? <Segmentado<VentanaObs> etiqueta="Periodo" valor={diasObs} onChange={setDiasObs} opciones={VENTANAS_OBS} />
                                : <Segmentado<3 | 7> etiqueta="Periodo" valor={diasPron} onChange={setDiasPron} opciones={[{ v: 3, t: '3 días' }, { v: 7, t: '7 días' }]} />}
                        </div>
                        {capas && <SelectorCapas ids={capas.ids} onAlternar={capas.alternar} onTodas={capas.todas} onNinguna={capas.ninguna} nombre="planos" />}
                    </div>

                    {cargando && <div className="an-skeleton an-skeleton--alta cu-pl-estado" aria-busy="true" />}
                    {!cargando && (falla || !plano) && (
                        <div className="an-vacio cu-pl-estado" role="status"><strong>Sin plano por ahora (S/D)</strong><span>{falla ?? 'Todavía no hay estaciones o contorno cargados.'}</span></div>
                    )}

                    {!cargando && plano && (
                        <>
                            <figure className="cu-plano">
                                <img className="cu-plano-img" alt={descripcion} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} />
                                <figcaption className="cu-leyenda-viz">{plano.titulo} · {cfg.titulo} en {cfg.unidad}. Escala fija por datos registrados: dos planos de fechas distintas se comparan a ojo.</figcaption>
                            </figure>
                            <div className="cu-pl-res">
                                <Kpi densidad="compacta" etiqueta={`${variable === 'lluvia' ? (modo === 'obs' ? 'Lluvia promedio de la cuenca' : 'Lluvia pronosticada promedio') : `${cfg.titulo} promedio`}`} valor={mediaKpi == null ? 'S/D' : fmtVal(mediaKpi)} unidad={mediaKpi != null ? ` ${cfg.unidad}` : undefined} contexto={mediaKpi == null && (arealUnico?.motivoSD ?? plano.motivoSD)
                                            ? (arealUnico?.motivoSD ?? plano.motivoSD)
                                            : `${plano.periodo.tipo === 'obs' ? `${cuandoVentana(plano.periodo.dias)} · ` : ''}${plano.resumen.min != null && plano.resumen.max != null ? `rango ${fmtVal(plano.resumen.min)}–${fmtVal(plano.resumen.max)} ${cfg.unidad} · ` : ''}n = ${plano.resumen.n} estaciones · cobertura ${plano.resumen.coberturaPct.toFixed(0)} % del área · provisional`} />
                                {plano.resumen.maxEn && <p className="cu-pl-dato"><b>Mayor valor:</b> {plano.resumen.maxEn.nombre}, {fmtVal(plano.resumen.maxEn.valor)} {cfg.unidad}</p>}
                                <p className="cu-pl-dato"><b>Altitud:</b> {plano.ajuste.motivo}.</p>
                                {plano.excluidos.length > 0 && <p className="an-aviso" role="status"><b>Excluida del plano:</b> {plano.excluidos.map((p) => p.nombre).join(', ')} (pluviómetro sospechoso).</p>}
                                {ranking.filas.length > 0 && (
                                    <div className="cu-rank" role="group" aria-label={`Estaciones ordenadas por ${cfg.titulo.toLowerCase()}`}>
                                        <span className="cu-ctl-etq">Mayor a menor · {cfg.titulo.toLowerCase()} ({cfg.unidad})</span>
                                        <ol className="cu-rank-lista">
                                            {ranking.filas.slice(0, 8).map((f) => (
                                                <li key={f.clave} className="cu-rank-fila" style={{ ['--w' as string]: `${Math.max(2, Math.round((Math.abs(f.valor) / maxRank) * 100))}%` }}>
                                                    <span className="cu-rank-nom">{f.nombre}</span>
                                                    <span className="cu-rank-val">{fmtVal(f.valor)}</span>
                                                </li>
                                            ))}
                                        </ol>
                                        {(ranking.filas.length > 8 || ranking.sinDato > 0) && <span className="cu-rank-pie">{ranking.filas.length > 8 ? `${ranking.filas.length - 8} más en la tabla` : ''}{ranking.filas.length > 8 && ranking.sinDato > 0 ? ' · ' : ''}{ranking.sinDato > 0 ? `${ranking.sinDato} sin dato (S/D)` : ''}</span>}
                                    </div>
                                )}
                                {modo === 'pron' && (
                                                                        <div className="cu-red-kpi">
                                        <span className="an-kpi-lbl">Confiabilidad del pronóstico</span>
                                        <span className="an-kpi-sub">{confiab.texto}</span>
                                        <span className="an-kpi-sub">Corrida {hace(pron.datos?.corridaEn ?? null)} · rango entre modelos en la tabla</span>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {modo === 'pron' && !cargando && filasPron.length > 0 && (
                <DataTable
                    regionAria="Pronóstico por estación (desplazable)" clave={(f) => f.p.id} filas={filasPron}
                    columnas={[
                        {
                            id: 'est', titulo: 'Estación', encabezadoFila: true,
                            render: ({ p }) => <div className="cu-presa"><span className="cu-nombre">{p.nombre}</span>{p.fuente === 'weatherlink' && <span className="cu-tag">Propia</span>}{p.grupo && <span className="cu-nota-fila">Misma ciudad que otras estaciones</span>}</div>,
                        },
                        { id: 'lluvia', titulo: `Lluvia ${diasPron} d`, numerica: true, render: ({ lluvia }) => lluvia.valor == null ? 'S/D' : `${fmt(lluvia.valor)} mm` },
                        { id: 'mod', titulo: 'Entre modelos', numerica: true, render: ({ lluvia }) => lluvia.min == null || lluvia.max == null ? 'S/D' : `${fmt(lluvia.min, 0)}–${fmt(lluvia.max, 0)} mm` },
                        { id: 'dias', titulo: 'Días con lluvia', numerica: true, render: ({ diasLluvia }) => diasLluvia == null ? 'S/D' : `${diasLluvia} de ${diasPron}` },
                        { id: 'temp', titulo: 'Temp. media', numerica: true, render: ({ temp }) => temp == null ? 'S/D' : `${fmt(temp)} °C` },
                        { id: 'vto', titulo: 'Viento', numerica: true, render: ({ viento }) => viento == null ? 'S/D' : `${fmt(viento, 0)} km/h` },
                    ]}
                />
            )}

            <details className="an-pie cu-notas">
                <summary className="cu-notas-sum">Cómo se hacen los planos y qué límites tienen</summary>
                <ul>
                    <li><b>Interpolación:</b> inverso de la distancia al cuadrado entre las estaciones, limitada a 90 km. Donde no hay una estación a esa distancia el plano se deja con trama y no entra a los promedios. Con menos de 5 estaciones útiles o menos del 50 % del área cubierta, el plano es S/D.</li>
                    <li><b>Altitud:</b> la corrección por altitud usa la elevación del modelo digital (no la que reporta JCAS, que no es confiable) y solo se aplica con 12 o más estaciones y R² de 0.5 o más; se declara arriba.</li>
                    <li><b>Una estación por ciudad:</b> las 4 de Chihuahua pesan una vez (mediana). Los pluviómetros sospechosos se excluyen solo de la lluvia.</li>
                    <li><b>Pronóstico:</b> mediana de 3 modelos (ECMWF, GFS, ICON) en las coordenadas de cada estación; la lluvia de un periodo es la suma de la mediana diaria; un «día con lluvia» es aquel en que al menos 2 de los 3 modelos dan 1 mm o más. Los modelos pueden discrepar mucho en tormentas: por eso se muestra el rango entre ellos. Se compara con lo que midió JCAS (pronóstico de víspera) y, con menos de {60} pares día-estación, la confiabilidad se rotula «en construcción».</li>
                    <li><b>Fuente:</b> estaciones de JCAS/UACJ (portal público, datos provisionales) y pronóstico de Open-Meteo (uso no comercial). Son contexto: no sustituyen las estaciones propias ni los aforos.</li>
                    <li>Flechas de viento: solo en el pronóstico (hacia donde sopla; media circular de los modelos y de los días, ponderada por la velocidad). JCAS solo entrega la velocidad media diaria, sin dirección.{plano?.periodo.tipo === 'obs' ? ` ${diasObs === 'hoy' ? ` Lectura parcial del ${fechaCorta(jcas.red?.modelo?.fechaHoy ?? hoy)}, hasta ${horaLectura(jcas.red?.modelo?.hoyEn ?? null)}.` : ` Días completos al ${fechaCorta(jcas.red?.modelo?.fin ?? hoy)}.`}` : ''}</li>
                </ul>
            </details>
        </section>
    );
}
