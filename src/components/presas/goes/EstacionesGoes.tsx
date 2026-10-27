import { useMemo, useState } from 'react';
import { useHidroEstaciones, useHidroEstadistica, type SeriesPorEstacion } from '../../../hooks/useHidroEstaciones';
import { useAhora } from '../../../hooks/useAhora';
import {
    ORDEN_ESTACIONES, VENTANAS, colorEstacion, estadoEnlace, grupoDeEstacion, horaLocal,
    type VentanaHidro,
} from '../../../utils/hidroEstaciones';
import { enVentana, estadisticaEstacion, type EstadisticaEstacion } from '../../../utils/hidroEstadistica';
import TarjetaEstacion from './TarjetaEstacion';
import { instanteEnlace } from './enlaceGoes';
import GraficaGoes from './GraficaGoes';
import PanelMeteo from './PanelMeteo';
import PanelEstadistica from './PanelEstadistica';
import TablaEnlace from './TablaEnlace';
import InformeGoesBoton from './InformeGoesBoton';
import { DefsGoes } from './Spark';
import './goes.css';

interface Props { presaId: string }

const GRUPOS = ['PRE-001', 'PRE-002', 'rio'] as const;
/** Constante de módulo: su referencia no cambia, así no hay refetch por identidad de arreglo. */
const IDS: string[] = [...ORDEN_ESTACIONES];

/**
 * Estaciones hidrométricas GOES: telemetría satelital (DCP) de las presas y del río. Cifras tal cual las reporta la
 * estación; lo ausente u obsoleto se muestra S/D, nunca 0. Hora local de Chihuahua.
 * La ventana (24 h / 7 d / 30 d) es GLOBAL: rige fichas, gráfica y resumen estadístico con una sola descarga de series.
 */
export default function EstacionesGoes({ presaId }: Props) {
    const [ventana, setVentana] = useState<VentanaHidro>('24h');
    const [seleccion, setSeleccion] = useState<string[]>([...ORDEN_ESTACIONES]);
    const [meteoAbierto, setMeteoAbierto] = useState(false);
    const ahora = useAhora(60_000);

    // useHidroEstaciones baja estaciones, mensajes del enlace y 24 h de series (cifra vigente de las fichas); useHidroEstadistica
    // baja por separado la ventana elegida con su base (192 h para 24 h/7 d, 720 h para 30 d) con otra clave de caché: son dos
    // descargas distintas. La ventana la sirve useHidroEstadistica para trazos, gráfica y resumen.
    const h = useHidroEstaciones({ ventana: '24h', seleccion: IDS, meteo: meteoAbierto });
    const est = useHidroEstadistica(ventana, IDS);

    const estados = useMemo(() => h.estaciones.map(e => ({ e, enlace: estadoEnlace(instanteEnlace(e, h.mensajes), ahora) })), [h.estaciones, h.mensajes, ahora]);
    const enLinea = estados.filter(x => x.enlace.clave === 'en_linea' || x.enlace.clave === 'retraso').length;
    const sinTx = estados.filter(x => x.enlace.clave === 'sin_transmision').length;

    // Fichas en una sola rejilla; la presa abierta en pantalla va primero.
    const ordenadas = useMemo(() => {
        const g = [...GRUPOS];
        const i = g.indexOf(presaId as typeof GRUPOS[number]);
        if (i > 0) g.unshift(...g.splice(i, 1));
        return [...h.estaciones].sort((a, b) => g.indexOf(grupoDeEstacion(a)) - g.indexOf(grupoDeEstacion(b)));
    }, [h.estaciones, presaId]);

    // Series de la ventana global (la descarga incluye 8 d de base para la variación a 7 d: aquí se recorta).
    const serieVentana = useMemo<SeriesPorEstacion | null>(() => {
        if (!est.series || !ahora) return null;
        const desde = ahora - VENTANAS[ventana].horas * 3600000;
        return Object.fromEntries(Object.entries(est.series).map(([id, s]) => [id, Object.fromEntries(Object.entries(s).map(([v, pts]) => [v, enVentana(pts, desde, ahora)]))]));
    }, [est.series, ventana, ahora]);

    const estadisticas = useMemo<Record<string, EstadisticaEstacion> | null>(() => {
        if (!est.series || !ahora) return null;
        const series = est.series;
        return Object.fromEntries(h.estaciones.map(e => [e.id, estadisticaEstacion(e.id, e.intervalo_min, series[e.id] ?? {}, ventana, ahora)]));
    }, [est.series, h.estaciones, ventana, ahora]);

    const alternar = (id: string) => setSeleccion(prev => (prev.includes(id) ? (prev.length > 1 ? prev.filter(x => x !== id) : prev) : ORDEN_ESTACIONES.filter(x => x === id || prev.includes(x))));
    const recargarTodo = () => { h.recargar(); est.recargar(); };

    if (h.loading) {
        return (
            <div className="goes-root" aria-busy="true" aria-label="Cargando estaciones hidrométricas">
                <div className="goes-skeleton" /><div className="goes-fichas">{IDS.map(id => <div key={id} className="goes-skeleton goes-skeleton--ficha" />)}</div><div className="goes-skeleton goes-skeleton--alta" />
            </div>
        );
    }
    if (h.error) {
        return (
            <div className="goes-root"><div className="goes-vacio" role="alert">
                <strong>No se pudo cargar la telemetría de las estaciones.</strong>
                <span>{h.error}</span>
                <button type="button" className="goes-btn" onClick={recargarTodo}>Reintentar</button>
            </div></div>
        );
    }
    if (h.estaciones.length === 0) {
        return <div className="goes-root"><div className="goes-vacio" role="status"><strong>Sin estaciones registradas (S/D)</strong><span>La tabla de estaciones GOES no devolvió ninguna estación.</span></div></div>;
    }

    return (
        <div className="goes-root pr-reveal">
            <DefsGoes />
            <header className="goes-head">
                <div className="goes-head-id">
                    <h3 className="goes-titulo">Estaciones hidrométricas (GOES)</h3>
                    <p className="goes-sub">Telemetría satelital de nivel y gasto, lecturas cada 15–20 min según la estación · hora de Chihuahua</p>
                </div>
                <div className="goes-head-der">
                    <div className="goes-ventana">
                        <span className="goes-ventana-t" id="goes-ventana-t">Ventana de análisis</span>
                        <div className="goes-seg" role="group" aria-labelledby="goes-ventana-t">
                            {(Object.keys(VENTANAS) as VentanaHidro[]).map(v => (
                                <button key={v} type="button" className="goes-seg-btn" aria-pressed={ventana === v} onClick={() => setVentana(v)}>{VENTANAS[v].etiqueta}</button>
                            ))}
                        </div>
                    </div>
                    <div className="goes-estado">
                        <span className="goes-resumen" role="status" aria-live="polite">
                            <b>{enLinea}</b> de {estados.length} en línea{sinTx > 0 && <> · <b className="goes-resumen-alerta">{sinTx} sin transmisión</b></>}
                        </span>
                        <span className="goes-sub goes-sub--der">Actualizado {horaLocal(h.actualizadoEn)}</span>
                    </div>
                    <div className="goes-acciones">
                        <InformeGoesBoton estaciones={h.estaciones} ventana={ventana} />
                        <button type="button" className="goes-btn goes-btn--sec" onClick={recargarTodo}>Actualizar</button>
                    </div>
                </div>
            </header>

            <div className="goes-fichas">
                {ordenadas.map(e => (
                    <TarjetaEstacion key={e.id} estacion={e} series={h.series24[e.id]} serieVentana={serieVentana?.[e.id] ?? null}
                        estadistica={estadisticas?.[e.id] ?? null} ventana={ventana} mensajes={h.mensajes} ahora={ahora}
                        destacada={grupoDeEstacion(e) === presaId} />
                ))}
            </div>
            {est.error && !estadisticas && (
                <p className="goes-aviso" role="alert">No se pudo calcular la estadística de {VENTANAS[ventana].etiqueta}: {est.error} Las cifras vigentes de arriba siguen siendo las últimas lecturas.</p>
            )}

            <div className="goes-analisis">
                <section className="goes-card goes-card--grafica" aria-label="Gráfica de nivel y gasto">
                    <div className="goes-h-fila">
                        <h4 className="goes-h">Gasto y nivel <small className="goes-h-sub">últimas {VENTANAS[ventana].etiqueta}</small></h4>
                    </div>
                    <div className="goes-filtros" role="group" aria-label="Estaciones en la gráfica">
                        {h.estaciones.map(e => (
                            <button key={e.id} type="button" className="goes-chip" aria-pressed={seleccion.includes(e.id)} onClick={() => alternar(e.id)}>
                                <i className="goes-sw" style={{ background: colorEstacion(e.id) }} aria-hidden="true" />{e.nombre}
                            </button>
                        ))}
                    </div>
                    {est.error && !serieVentana
                        ? <div className="goes-vacio" role="alert"><strong>No se pudo cargar la serie.</strong><span>{est.error}</span><button type="button" className="goes-btn" onClick={recargarTodo}>Reintentar</button></div>
                        : !serieVentana
                            ? <div className="goes-skeleton goes-skeleton--alta" aria-busy="true" aria-label="Cargando la serie" />
                            : <GraficaGoes estaciones={h.estaciones} seleccion={seleccion} series={serieVentana} ventana={ventana} ahora={ahora} />}
                    <p className="goes-nota">Cada línea es una estación; el hueco es ausencia de lectura, no cero. Las ventanas largas se promedian ({VENTANAS['7d'].pasoMin} min en 7 días, {VENTANAS['30d'].pasoMin} min en 30 días); en Babisas ese promedio puede mezclar ceros con lecturas reales, que la tabla de resumen sí excluye. El nivel es el del sensor de cada estación (referencia propia): no es cota msnm ni porcentaje de llenado.</p>
                </section>

                <PanelEstadistica estaciones={h.estaciones} estadisticas={estadisticas} ventana={ventana} error={est.error} onReintentar={recargarTodo} />
            </div>

            <div className="goes-inferior">
                <section className="goes-card" aria-label="Salud del enlace satelital">
                    <h4 className="goes-h">Salud del enlace</h4>
                    <TablaEnlace estaciones={h.estaciones} mensajes={h.mensajes} ahora={ahora} />
                </section>
                <section className="goes-card" aria-label="Meteorología de las estaciones">
                    <button type="button" className="goes-plegar" aria-expanded={meteoAbierto} aria-controls="goes-meteo-cuerpo" onClick={() => setMeteoAbierto(a => !a)}>
                        <span className="goes-h">Meteorología en las estaciones</span>
                        <span className="goes-plegar-estado">{meteoAbierto ? 'Ocultar' : 'Mostrar'} <span aria-hidden="true">{meteoAbierto ? '▴' : '▾'}</span></span>
                    </button>
                    <div id="goes-meteo-cuerpo" hidden={!meteoAbierto}>
                        {meteoAbierto && <PanelMeteo estaciones={h.estaciones} mensajes={h.mensajes} clima={h.clima} cargando={h.cargandoClima} error={h.errorClima} ahora={ahora} />}
                    </div>
                </section>

            </div>

            <footer className="goes-pie">
                <h4 className="goes-h goes-h--pie">Qué conviene saber</h4>
                <ul>
                    <li><b>Sin transmisión:</b> si el último mensaje bueno tiene más de 3 h, la estación pasa a «Sin transmisión» y sus cifras se muestran S/D con la hora del último dato.</li>
                    <li><b>Babisas:</b> la estación reporta gasto 0 en la mayor parte de las lecturas aun con el nivel alto. Se muestra tal cual, con marca de posible corte de curva de gasto; no está confirmado, y esas lecturas no entran a promedios ni al volumen.</li>
                    <li><b>Francisco I. Madero:</b> no se muestra su radiación (valor fijo, canal no confiable) y el viento tiene huecos que se leen S/D.</li>
                    <li><b>Hora de las lecturas:</b> se estima a partir de la hora del mensaje satelital; cada estación lee cada 15 min (Ojinaga) o 20 min (las demás).</li>
                    <li><b>Ubicación:</b> solo una estación tiene coordenadas registradas; las demás indican «Ubicación pendiente» y no se dibujan en mapa.</li>
                    <li><b>Presa y río:</b> no se compara la salida de la presa con Ojinaga: entre ambas hay tomas, aportes de afluentes y un tránsito de días que no está calibrado, así que la diferencia no sería un balance.</li>
                </ul>
            </footer>
        </div>
    );
}
