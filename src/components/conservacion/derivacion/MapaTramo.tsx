import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MAPA_BASE_ATRIBUCION, MAPA_BASE_URL, MAPA_BASE_ZOOM_MAXIMO, MAPA_FONDO_SIN_TESELAS } from '../../../utils/mapaBase';
import { TEXTO_POSICION_ESTIMADA, etiquetaPk, type ClaveFamilia, type ObraVista } from './ubicacionModelo';
import { simboloClave } from './simbolos';

type Punto = [number, number];

export interface PropsMapa {
    /** Vértices [lat, lon] del tramo: el contorno real (subtrazo) o, si no lo hay, la cuerda entre vértices del inventario. */
    tramo: readonly Punto[];
    /** 'cuerda' = sin contorno real: se dibuja punteada y rotulada. */
    calidad: 'ancla' | 'interpolada' | 'cuerda';
    /** Rótulo del tramo sin contorno real (p. ej. el auxiliar, sin trazo). */
    rotuloCuerda: string | null;
    /** Eje de vértices del inventario (cuerda): contexto solo cuando el tramo no tiene contorno real. */
    eje: readonly Punto[];
    /** Trazo del canal completo, tenue, de fondo (null/vacío = no cargó). */
    fondo: readonly Punto[];
    inicio: { punto: Punto; rotulo: string } | null;
    fin: { punto: Punto; rotulo: string } | null;
    /** Obras del tramo con coordenadas (declaradas o estimadas). */
    obras: readonly ObraVista[];
    obraSel: string | null;
    ocultas: ReadonlySet<ClaveFamilia>;
    onSeleccionar: (id: string) => void;
    onFallanTeselas: () => void;
}

function Encuadre({ puntos, sel }: { puntos: readonly Punto[]; sel: Punto | null }) {
    const map = useMap();
    const firma = puntos.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join('|');
    useEffect(() => {
        if (puntos.length === 0) return;
        map.invalidateSize();
        map.fitBounds(L.latLngBounds(puntos.map((p) => L.latLng(p[0], p[1]))), { padding: [48, 48], maxZoom: 16, animate: false });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [firma, map]);
    useEffect(() => { if (sel) map.panTo(L.latLng(sel[0], sel[1]), { animate: false }); }, [sel, map]);
    return null;
}

const iconoObra = (o: ObraVista, sel: boolean): L.DivIcon => L.divIcon({
    className: `cons-mk${sel ? ' cons-mk-sel' : ''}${o.estado === 'estimada' ? ' cons-mk-est' : ''}`,
    html: simboloClave(o.clave, { tamano: 28, grosor: 2.2, punteado: o.estado === 'estimada' }),
    iconSize: [44, 44], iconAnchor: [22, 22], tooltipAnchor: [0, -16],
});

export default function MapaTramo({ tramo, calidad, rotuloCuerda, eje, fondo, inicio, fin, obras, obraSel, ocultas, onSeleccionar, onFallanTeselas }: PropsMapa) {
    const fallos = useRef(0);
    const visibles = useMemo(() => obras.filter((o) => o.lat !== null && o.lon !== null && !ocultas.has(o.clave)), [obras, ocultas]);
    const puntos = useMemo<Punto[]>(() => {
        const p: Punto[] = [...tramo];
        for (const o of obras) if (o.lat !== null && o.lon !== null) p.push([o.lat, o.lon]);
        return p.length > 0 ? p : [...eje];
    }, [tramo, obras, eje]);
    const sel = obras.find((o) => o.id === obraSel);
    const centro: Punto = puntos[0] ?? [27.9, -105.4];

    return (
        <MapContainer center={centro} zoom={13} preferCanvas zoomControl scrollWheelZoom attributionControl className="cons-ubic-mapa" style={{ background: MAPA_FONDO_SIN_TESELAS }}
            aria-label="Mapa de ubicación del tramo">
            <TileLayer url={MAPA_BASE_URL} attribution={MAPA_BASE_ATRIBUCION} maxZoom={MAPA_BASE_ZOOM_MAXIMO}
                eventHandlers={{ tileerror: () => { fallos.current += 1; if (fallos.current === 3) onFallanTeselas(); } }} />
            {fondo.length > 1 && <Polyline positions={[...fondo]} pathOptions={{ color: '#e2e8f0', weight: 2, opacity: 0.4 }} interactive={false} />}
            {calidad === 'cuerda' && eje.length > 1 && (
                <>
                    {/* La cuerda del auxiliar lleva un fondo oscuro debajo: sobre imagen satelital clara o sobre fondo oscuro se lee igual. */}
                    <Polyline positions={[...eje]} pathOptions={{ color: '#0b1624', weight: 6, opacity: 0.7 }} interactive={false} />
                    <Polyline positions={[...eje]} pathOptions={{ color: '#e2e8f0', weight: 3, opacity: 0.95, dashArray: '3 7' }} interactive={false} />
                </>
            )}
            {tramo.length > 1 && (
                <>
                    {/* Halo oscuro (no blanco): el tramo violeta conserva contraste sobre teselas claras y sobre el fondo oscuro de reserva. */}
                    <Polyline positions={[...tramo]} pathOptions={{ color: '#0b1624', weight: 11, opacity: 0.8, lineCap: calidad === 'cuerda' ? 'butt' : 'round' }} interactive={false} />
                    <Polyline positions={[...tramo]} pathOptions={{ color: '#b79cff', weight: 5, opacity: 1, lineCap: calidad === 'cuerda' ? 'butt' : 'round', ...(calidad === 'cuerda' ? { dashArray: '10 8' } : {}) }} interactive={false}>
                        {calidad === 'cuerda' && <Tooltip sticky>{rotuloCuerda ?? 'Cuerda entre vértices del inventario: sin contorno real'}</Tooltip>}
                    </Polyline>
                </>
            )}
            {[inicio, fin].map((e) => e && (
                <CircleMarker key={e.rotulo} center={e.punto} radius={7} pathOptions={{ color: '#a78bfa', weight: 3, fillColor: '#ffffff', fillOpacity: 1 }}>
                    <Tooltip direction="top" offset={[0, -6]}>{e.rotulo}</Tooltip>
                </CircleMarker>
            ))}
            {visibles.map((o) => (
                <Marker key={o.id} position={[o.lat as number, o.lon as number]} icon={iconoObra(o, o.id === obraSel)} keyboard
                    title={`${o.tipoNombre}, ${etiquetaPk(o.pk)}${o.estado === 'estimada' ? `, ${TEXTO_POSICION_ESTIMADA}` : ''}`}
                    eventHandlers={{ click: () => onSeleccionar(o.id), keypress: (ev) => { const k = (ev.originalEvent as KeyboardEvent).key; if (k === 'Enter' || k === ' ') onSeleccionar(o.id); } }}>
                    <Tooltip direction="top" permanent={o.id === obraSel} className={o.estado === 'estimada' ? 'cons-mk-rotulo cons-mk-rotulo-est' : 'cons-mk-rotulo'}>
                        {o.estado === 'estimada' ? <>posición estimada<br /></> : null}{o.tipoNombre} · {etiquetaPk(o.pk)}
                    </Tooltip>
                </Marker>
            ))}
            <Encuadre puntos={puntos} sel={sel && sel.lat !== null && sel.lon !== null ? [sel.lat, sel.lon] : null} />
        </MapContainer>
    );
}
