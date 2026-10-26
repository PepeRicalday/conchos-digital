import { useMemo, useState } from 'react';
import { useHidroEstaciones } from '../../../hooks/useHidroEstaciones';
import { useAhora } from '../../../hooks/useAhora';
import {
    ORDEN_ESTACIONES, TITULO_GRUPO, VENTANAS, colorEstacion, estadoEnlace, grupoDeEstacion, horaLocal, ultimoBueno,
    type VentanaHidro,
} from '../../../utils/hidroEstaciones';
import TarjetaEstacion from './TarjetaEstacion';
import GraficaGoes from './GraficaGoes';
import PanelMeteo from './PanelMeteo';
import TablaEnlace from './TablaEnlace';
import { DefsGoes } from './Spark';
import './goes.css';

interface Props { presaId: string }

const GRUPOS = ['PRE-001', 'PRE-002', 'rio'] as const;

/**
 * Estaciones hidrométricas GOES: telemetría satelital (DCP) de las presas y del río. Cifras tal cual las reporta la
 * estación; lo ausente u obsoleto se muestra S/D, nunca 0. Hora local de Chihuahua.
 */
export default function EstacionesGoes({ presaId }: Props) {
    const [ventana, setVentana] = useState<VentanaHidro>('24h');
    const [seleccion, setSeleccion] = useState<string[]>([...ORDEN_ESTACIONES]);
    const [meteoAbierto, setMeteoAbierto] = useState(false);
    const ahora = useAhora(60_000);

    const h = useHidroEstaciones({ ventana, seleccion, meteo: meteoAbierto });

    const estados = useMemo(() => h.estaciones.map(e => ({ e, enlace: estadoEnlace(ultimoBueno(h.mensajes, e.id) ?? (e.ult_dato_en ? Date.parse(e.ult_dato_en) : null), ahora) })), [h.estaciones, h.mensajes, ahora]);
    const enLinea = estados.filter(x => x.enlace.clave === 'en_linea' || x.enlace.clave === 'retraso').length;
    const sinTx = estados.filter(x => x.enlace.clave === 'sin_transmision').length;

    const orden = useMemo(() => {
        const g = [...GRUPOS];
        const i = g.indexOf(presaId as typeof GRUPOS[number]);
        if (i > 0) g.unshift(...g.splice(i, 1));
        return g;
    }, [presaId]);

    const alternar = (id: string) => setSeleccion(prev => (prev.includes(id) ? (prev.length > 1 ? prev.filter(x => x !== id) : prev) : ORDEN_ESTACIONES.filter(x => x === id || prev.includes(x))));

    if (h.loading) {
        return (
            <div className="goes-root" aria-busy="true" aria-label="Cargando estaciones hidrométricas">
                <div className="goes-skeleton" /><div className="goes-skeleton goes-skeleton--alta" />
            </div>
        );
    }
    if (h.error) {
        return (
            <div className="goes-root"><div className="goes-vacio" role="alert">
                <strong>No se pudo cargar la telemetría de las estaciones.</strong>
                <span>{h.error}</span>
                <button type="button" className="goes-btn" onClick={h.recargar}>Reintentar</button>
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
                <div>
                    <h3 className="goes-titulo">Estaciones hidrométricas (GOES)</h3>
                    <p className="goes-sub">Telemetría satelital de nivel y gasto, lecturas cada 15–20 min según la estación · hora de Chihuahua</p>
                </div>
                <div className="goes-head-der">
                    <span className="goes-resumen" role="status" aria-live="polite">
                        <b>{enLinea}</b> de {estados.length} en línea{sinTx > 0 && <> · <b className="goes-resumen-alerta">{sinTx} sin transmisión</b></>}
                    </span>
                    <span className="goes-sub goes-sub--der">Actualizado {horaLocal(h.actualizadoEn)}</span>
                    <button type="button" className="goes-btn goes-btn--sec" onClick={h.recargar}>Actualizar</button>
                </div>
            </header>

            {orden.map(g => {
                const del = h.estaciones.filter(e => grupoDeEstacion(e) === g);
                if (!del.length) return null;
                return (
                    <section key={g} className="goes-grupo" aria-label={TITULO_GRUPO[g]}>
                        <h4 className="goes-grupo-t">{TITULO_GRUPO[g]}{g === presaId && <span className="goes-grupo-marca">presa en pantalla</span>}</h4>
                        <div className="goes-fichas">
                            {del.map(e => <TarjetaEstacion key={e.id} estacion={e} series={h.series24[e.id]} mensajes={h.mensajes} ahora={ahora} destacada={g === presaId} />)}
                        </div>
                    </section>
                );
            })}

            <section className="goes-card" aria-label="Gráfica de nivel y gasto">
                <div className="goes-h-fila">
                    <h4 className="goes-h">Gasto y nivel</h4>
                    <div className="goes-seg" role="group" aria-label="Ventana de tiempo">
                        {(Object.keys(VENTANAS) as VentanaHidro[]).map(v => (
                            <button key={v} type="button" className="goes-seg-btn" aria-pressed={ventana === v} onClick={() => setVentana(v)}>{VENTANAS[v].etiqueta}</button>
                        ))}
                    </div>
                </div>
                <div className="goes-filtros" role="group" aria-label="Estaciones en la gráfica">
                    {h.estaciones.map(e => (
                        <button key={e.id} type="button" className="goes-chip" aria-pressed={seleccion.includes(e.id)} onClick={() => alternar(e.id)}>
                            <i className="goes-sw" style={{ background: colorEstacion(e.id) }} aria-hidden="true" />{e.nombre}
                        </button>
                    ))}
                </div>
                {h.errorGrafica
                    ? <div className="goes-vacio" role="alert"><strong>No se pudo cargar la serie.</strong><span>{h.errorGrafica}</span><button type="button" className="goes-btn" onClick={h.recargar}>Reintentar</button></div>
                    : h.cargandoGrafica || !h.serieVentana
                        ? <div className="goes-skeleton goes-skeleton--alta" aria-busy="true" />
                        : <GraficaGoes estaciones={h.estaciones} seleccion={seleccion} series={h.serieVentana} ventana={ventana} ahora={ahora} />}
                <p className="goes-nota">Cada línea es una estación; el hueco es ausencia de lectura, no cero. Las ventanas largas se promedian ({VENTANAS['7d'].pasoMin} min en 7 días, {VENTANAS['30d'].pasoMin} min en 30 días).</p>
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

            <section className="goes-card" aria-label="Salud del enlace satelital">
                <h4 className="goes-h">Salud del enlace</h4>
                <TablaEnlace estaciones={h.estaciones} mensajes={h.mensajes} ahora={ahora} />
            </section>

            <footer className="goes-pie">
                <h4 className="goes-h goes-h--pie">Qué conviene saber</h4>
                <ul>
                    <li><b>Sin transmisión:</b> si el último mensaje bueno tiene más de 3 h, la estación pasa a «Sin transmisión» y sus cifras se muestran S/D con la hora del último dato.</li>
                    <li><b>Babisas:</b> la estación reporta gasto 0 en la mayor parte de las lecturas aun con el nivel alto. Se muestra tal cual, con marca de posible corte de curva de gasto; no está confirmado.</li>
                    <li><b>Francisco I. Madero:</b> no se muestra su radiación (valor fijo, canal no confiable) y el viento tiene huecos que se leen S/D.</li>
                    <li><b>Ubicación:</b> solo una estación tiene coordenadas registradas; las demás indican «Ubicación pendiente» y no se dibujan en mapa.</li>
                </ul>
            </footer>
        </div>
    );
}
