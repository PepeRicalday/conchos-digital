import React, { useEffect, useMemo, useState } from 'react';
import { Map as MapIcon, Hand } from 'lucide-react';
import { MapContainer, TileLayer, WMSTileLayer, GeoJSON, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './PlanoGeneralModulos.css';
import './ndvi/ndviVisual.css';
import { COLOR_MODULO_SRL, numeroGeojsonDeSRL } from '../utils/modulosSRL';
import { sentinelWmsUrl } from '../utils/sentinelWms';
import { cargarContornosModulos } from '../utils/contornosModulos';
import { CLASES_ICV, CLASES_IHR, NDVI_RANGO, claseIndice, claseNdvi, colorNdvi } from '../utils/ndviRampa';
import { fmt } from '../utils/formato';
import { deltaVsResto, promedioSrl as calcPromedioSrl, textoNDe, valorIndice, type ClaveIndice } from '../utils/ndviSerie';
import { MESES_LARGOS } from '../utils/ndviGrafica';
import { UMBRAL_SIN_CAMBIO } from '../utils/ndviInteranual';
import type { FilaNdviSerie } from '../utils/ndviSerie';
import { SelectorChips } from './ndvi/SelectorChips';
import { SelectorMes } from './ndvi/SelectorMes';
import { LeyendaNdvi } from './ndvi/LeyendaNdvi';

interface PlanoGeneralModulosProps {
    filas: FilaNdviSerie[];
    meses: string[];
    /** Sentinel Hub WMS instance ID — mismo que MiniMapaNdviAgro, para el
     *  overlay "NDVI Agro" recortado por módulo cuando el índice es NDVI. */
    sentinelInstanceId: string;
}

const MODULOS_SRL = [1, 2, 3, 4, 5, 12];
/** Diferencia mínima para llamar "distinto" a un módulo contra los demás: 0.02 de NDVI (UMBRAL_SIN_CAMBIO) o 2 puntos en los índices 0–100. */
const UMBRAL_DELTA: Record<ClaveIndice, number> = { ndvi: UMBRAL_SIN_CAMBIO, icv: 2, ihr: 2 };
const mesLegible = (m: string) => (m ? `${MESES_LARGOS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : 'sin dato');

/** Dispositivo táctil: el mapa no captura el dedo al desplazar la página; hay que activarlo para moverlo. */
const esTactil = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

// Mismo basemap CARTO oscuro y mismo criterio de fallback que PublicMonitor.tsx
// (CARTO_TILE_URL) — sin VITE_CARTO_ACCESS_TOKEN el tile legacy funciona pero
// con marca de agua "API KEY REQUIRED"; con el token, ruta /rastertiles/ correcta.
const CARTO_ACCESS_TOKEN = import.meta.env.VITE_CARTO_ACCESS_TOKEN as string | undefined;
const CARTO_TILE_URL = CARTO_ACCESS_TOKEN
    ? `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${CARTO_ACCESS_TOKEN}`
    : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

const INDICES: { clave: ClaveIndice; etiqueta: string; corta: string; rango: [number, number] }[] = [
    { clave: 'ndvi', etiqueta: 'NDVI', corta: 'NDVI', rango: NDVI_RANGO },
    { clave: 'icv', etiqueta: 'ICV (Condición Vegetativa)', corta: 'ICV', rango: [0, 100] },
    { clave: 'ihr', etiqueta: 'IHR (Homogeneidad de Riego)', corta: 'IHR', rango: [0, 100] },
];

/** Pin numerado: el número identifica al módulo sin competir con la rampa de color del índice. */
function iconoPinModulo(numeroModulo: number): L.DivIcon {
    return L.divIcon({
        className: 'ndvi-pin-icon',
        html: `<div class="ndvi-pin" aria-label="Módulo ${numeroModulo}">${numeroModulo}</div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
    });
}

/** Encuadra el mapa a los 6 contornos en cuanto se cargan (antes quedaban chicos en un zoom fijo). */
const AjustarVista: React.FC<{ data: GeoJSON.FeatureCollection }> = ({ data }) => {
    const map = useMap();
    useEffect(() => {
        if (!data.features.length) return;
        const b = L.geoJSON(data).getBounds();
        if (b.isValid()) map.fitBounds(b, { padding: [24, 24], maxZoom: 12 });
    }, [data, map]);
    return null;
};

/** Plano general: mapa único con el contorno EXACTO (public/geo/modulos.geojson)
 *  de los 6 módulos SRL, coloreado según el índice y mes elegidos — vista
 *  coroplética institucional en vez de 6 mini-mapas separados. Incluye el
 *  promedio SRL (promedio simple de los 6 módulos) del mes/índice seleccionado. */
export const PlanoGeneralModulos: React.FC<PlanoGeneralModulosProps> = ({ filas, meses, sentinelInstanceId }) => {
    // Mes elegido por el usuario; mientras no elija, el más reciente (derivado, sin efecto que lo sincronice).
    const [mesElegido, setMesElegido] = useState<string>('');
    const mesSeleccionado = mesElegido || meses[meses.length - 1] || '';
    const [indiceSeleccionado, setIndiceSeleccionado] = useState<ClaveIndice>('ndvi');
    const [contornos, setContornos] = useState<Record<number, GeoJSON.Feature>>({});
    const [cargandoContornos, setCargandoContornos] = useState(true);
    const [tactil] = useState(esTactil);
    const [mapaActivo, setMapaActivo] = useState(false);
    const moverMapa = !tactil || mapaActivo;

    useEffect(() => {
        let cancelado = false;
        cargarContornosModulos()
            .then((fc) => {
                if (cancelado || !fc) return;
                const mapa: Record<number, GeoJSON.Feature> = {};
                for (const srl of MODULOS_SRL) {
                    const numeroGeojson = numeroGeojsonDeSRL(srl);
                    const feature = fc.features.find(f => Number(f.properties?.numero_modulo) === numeroGeojson);
                    if (feature) mapa[srl] = feature;
                }
                setContornos(mapa);
            })
            .finally(() => { if (!cancelado) setCargandoContornos(false); });
        return () => { cancelado = true; };
    }, []);

    const filaPorModulo = useMemo(() => {
        const mapa = new Map<number, FilaNdviSerie>();
        for (const f of filas) if (f.mes === mesSeleccionado) mapa.set(f.numero_modulo, f);
        return mapa;
    }, [filas, mesSeleccionado]);

    const indiceInfo = INDICES.find(i => i.clave === indiceSeleccionado)!;
    const esNdvi = indiceSeleccionado === 'ndvi';

    const valoresPorModulo = useMemo(() => {
        const mapa = new Map<number, number | null>();
        for (const srl of MODULOS_SRL) mapa.set(srl, valorIndice(indiceSeleccionado, filaPorModulo.get(srl)));
        return mapa;
    }, [filaPorModulo, indiceSeleccionado]);

    // Promedio de los módulos CON dato del mes, con su "n de 6": un módulo S/D no entra ni cuenta como 0.
    const promedioSrl = useMemo(() => calcPromedioSrl(MODULOS_SRL.map(m => valoresPorModulo.get(m))), [valoresPorModulo]);

    const deltas = useMemo(() => deltaVsResto(valoresPorModulo), [valoresPorModulo]);

    const geoJsonCombinado: GeoJSON.FeatureCollection = useMemo(() => ({
        type: 'FeatureCollection',
        features: MODULOS_SRL.filter(m => contornos[m]).map(m => ({
            ...contornos[m],
            properties: { ...contornos[m].properties, numero_modulo_srl: m },
        })),
    }), [contornos]);

    // Centroide aproximado (centro del bbox del anillo exterior) de cada
    // módulo, para colocar el pin — suficiente para un ícono visual.
    const centroidePorModulo = useMemo(() => {
        const mapa = new Map<number, [number, number]>();
        for (const m of MODULOS_SRL) {
            const feature = contornos[m];
            if (!feature) continue;
            const geom = feature.geometry;
            const anillo = geom.type === 'Polygon' ? geom.coordinates[0] : geom.type === 'MultiPolygon' ? geom.coordinates[0][0] : null;
            if (!anillo) continue;
            const lons = anillo.map((c) => c[0]), lats = anillo.map((c) => c[1]);
            mapa.set(m, [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2]);
        }
        return mapa;
    }, [contornos]);

    // Ventana de 30 días fijada al montar (inicializador perezoso: no llama a Date.now() en cada render).
    const [wmsParams] = useState(() => ({
        layers: '9_NDVI_AGRO',
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        maxcc: 40,
        // Suprime el watermark "Copernicus" quemado en el tile por defecto
        // en CDSE (plan gratuito) — mismo fix que NdviModulosPanel.tsx/GeoMonitor.tsx.
        showlogo: false,
        time: `${new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)}/${new Date().toISOString().slice(0, 10)}`,
    }));

    const center: [number, number] = [28.02, -105.35];
    const conImagenFondo = esNdvi && !!sentinelInstanceId;
    const decimales = esNdvi ? 2 : 0;

    return (
        <div className="plano-general-card glass">
            <div className="plano-general-header">
                <h3 className="plano-general-titulo">
                    <MapIcon size={16} aria-hidden="true" /> Plano general: {indiceInfo.corta}, {mesLegible(mesSeleccionado)}
                </h3>
                <div className="plano-general-controles">
                    <SelectorMes etiqueta="Plano" valor={mesSeleccionado} onChange={setMesElegido} meses={meses} />
                    <SelectorChips etiqueta="Índice" valor={indiceSeleccionado} onChange={setIndiceSeleccionado}
                        opciones={INDICES.map(i => ({ valor: i.clave, texto: i.corta, title: i.etiqueta }))} />
                </div>
            </div>

            <div className="plano-general-body">
                <div className="plano-general-mapa-col">
                    <div className="plano-general-map-wrap" role="group" aria-label={`Mapa de los seis módulos coloreados por ${indiceInfo.corta}. Los valores de cada módulo están en la tabla al lado.`}>
                        {tactil && (
                            <button type="button" className={`plano-general-mover ${mapaActivo ? 'on' : ''}`} aria-pressed={mapaActivo} onClick={() => setMapaActivo(v => !v)}>
                                <Hand size={16} aria-hidden="true" /> {mapaActivo ? 'Soltar el mapa' : 'Mover el mapa'}
                            </button>
                        )}
                        <MapContainer center={center} zoom={9} className="plano-general-map" attributionControl={false}
                            dragging={moverMapa} touchZoom={moverMapa} scrollWheelZoom={false} doubleClickZoom={moverMapa}>
                            <TileLayer url={CARTO_TILE_URL} attribution="&copy; CARTO" />
                            <AjustarVista data={geoJsonCombinado} />
                            {/* Solo para NDVI: imagen real "NDVI Agro" de Sentinel Hub como REFERENCIA (opacidad baja, sin leyenda
                                propia: sus colores los define el servidor). El valor del mes lo da el relleno de cada polígono. */}
                            {conImagenFondo && (
                                <WMSTileLayer
                                    url={sentinelWmsUrl(sentinelInstanceId)}
                                    params={wmsParams as unknown as L.WMSParams}
                                    maxZoom={19}
                                    opacity={0.3}
                                />
                            )}
                            {!cargandoContornos && (() => {
                                const bindTooltip = (feature: GeoJSON.Feature, layer: L.Layer) => {
                                    const srl = feature.properties?.numero_modulo_srl;
                                    const valor = srl != null ? valoresPorModulo.get(srl) : null;
                                    const nombre = feature.properties?.nombre ?? `Módulo ${srl}`;
                                    const clase = esNdvi ? claseNdvi(valor) : claseIndice(indiceSeleccionado as 'icv' | 'ihr', valor);
                                    layer.bindTooltip(
                                        `<strong>${nombre}</strong><br/>${indiceInfo.corta}: ${valor != null ? fmt(valor, decimales) : 'S/D'}${clase ? ` · ${clase.etiqueta}` : ''}`,
                                        { sticky: true, className: 'plano-general-tooltip' }
                                    );
                                };
                                return (
                                    <>
                                        {/* Halo blanco bajo el borde: con la imagen satelital de fondo el borde de color se perdería. */}
                                        {conImagenFondo && (
                                            <GeoJSON
                                                key={`plano-halo-${indiceSeleccionado}-${mesSeleccionado}`}
                                                data={geoJsonCombinado}
                                                style={{ color: '#ffffff', weight: 5, fillOpacity: 0, opacity: 0.8 }}
                                            />
                                        )}
                                        <GeoJSON
                                            key={`plano-${indiceSeleccionado}-${mesSeleccionado}`}
                                            data={geoJsonCombinado}
                                            style={(feature) => {
                                                const srl = feature?.properties?.numero_modulo_srl;
                                                const valor = srl != null ? valoresPorModulo.get(srl) ?? null : null;
                                                                const relleno = esNdvi ? colorNdvi(valor) : (claseIndice(indiceSeleccionado as 'icv' | 'ihr', valor)?.color ?? '#334155');
                                                return {
                                                    color: '#f8fafc', weight: 2, opacity: 0.95,
                                                    fillColor: relleno,
                                                    fillOpacity: valor != null ? 0.6 : 0.25,
                                                };
                                            }}
                                            onEachFeature={bindTooltip}
                                        />
                                    </>
                                );
                            })()}
                            {MODULOS_SRL.map(m => {
                                const centroide = centroidePorModulo.get(m);
                                if (!centroide) return null;
                                return <Marker key={`pin-${m}`} position={centroide} icon={iconoPinModulo(m)} />;
                            })}
                        </MapContainer>
                    </div>
                    {esNdvi ? (
                        <LeyendaNdvi nota={conImagenFondo
                            ? 'Relleno de cada módulo = NDVI del mes elegido. La imagen tenue de fondo es la referencia satelital de los últimos 30 días.'
                            : 'Relleno de cada módulo = NDVI del mes elegido.'} />
                    ) : (
                        <LeyendaIndice clave={indiceSeleccionado as 'icv' | 'ihr'} etiqueta={indiceInfo.etiqueta} />
                    )}
                </div>

                <div className="plano-general-lateral">
                    <div className="plano-general-promedio-card">
                        <div className="plano-general-promedio-label">Promedio SRL</div>
                        <div className="plano-general-promedio-valor">{fmt(promedioSrl.valor, esNdvi ? 2 : 1)}</div>
                        <div className="plano-general-promedio-n">{promedioSrl.valor == null ? 'Sin módulos con dato' : `${promedioSrl.n} de ${promedioSrl.total} módulos`}</div>
                        <div className="plano-general-promedio-sub">{indiceInfo.corta}, promedio simple de los {textoNDe(promedioSrl)} con dato en el mes (sin ponderar por superficie)</div>
                    </div>
                    <ul className="plano-general-tabla" aria-label={`${indiceInfo.corta} por módulo y diferencia contra el promedio de los demás`}>
                        {MODULOS_SRL.map(srl => {
                            const valor = valoresPorModulo.get(srl) ?? null;
                            const clase = esNdvi ? claseNdvi(valor) : claseIndice(indiceSeleccionado as 'icv' | 'ihr', valor);
                            const d = deltas.get(srl);
                            const dif = d?.delta ?? null;
                            const umbral = UMBRAL_DELTA[indiceSeleccionado];
                            const tipo = dif == null ? 'sd' : Math.abs(dif) < umbral ? 'igual' : dif > 0 ? 'sube' : 'baja';
                            const dec = esNdvi ? 3 : 1;
                            return (
                                <li key={srl} className="plano-general-fila">
                                    <span className="plano-general-fila-dot" style={{ background: COLOR_MODULO_SRL[srl] ?? '#334155' }} aria-hidden="true" />
                                    <span className="plano-general-fila-nombre">Módulo {srl}</span>
                                    {clase && <span className="ndvi-fila-clase"><i style={{ background: clase.color }} aria-hidden="true" />{clase.etiqueta}</span>}
                                    <span className="plano-general-fila-valor">{valor != null ? fmt(valor, decimales) : 'S/D'}</span>
                                    <span className={`plano-general-fila-delta ${tipo}`} title={dif != null ? `Contra el promedio de los otros ${d?.nResto} módulos con dato` : 'Sin referencia'}>
                                        {dif == null ? 'S/D' : <>{tipo === 'sube' ? '▲' : tipo === 'baja' ? '▼' : '≈'} {dif >= 0 ? '+' : '−'}{fmt(Math.abs(dif), dec)}</>}
                                        <span className="ndvi-sr-only"> contra los demás módulos ({d?.nResto} de {MODULOS_SRL.length - 1} con dato)</span>
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                    <p className="ndvi-nota">▲▼ = módulo contra el promedio de los demás ({esNdvi ? '≈ si la diferencia es menor a 0.02' : '≈ si es menor a 2 puntos'}).</p>
                </div>
            </div>
        </div>
    );
};

/** Leyenda graduada de ICV/IHR: cortes discretos con etiqueta y rango (el color nunca es el único canal). */
const LeyendaIndice: React.FC<{ clave: 'icv' | 'ihr'; etiqueta: string }> = ({ clave, etiqueta }) => (
    <div className="ndvi-ley" role="group" aria-label={`Leyenda de ${etiqueta}`}>
        <ul className="ndvi-ley-lista">
            {(clave === 'icv' ? CLASES_ICV : CLASES_IHR).map((c) => (
                <li key={c.etiqueta}><i style={{ background: c.color }} aria-hidden="true" /><b>{c.etiqueta}</b> <span>{c.desde === 0 ? `< ${c.hasta}` : c.hasta === 100 ? `≥ ${c.desde}` : `${c.desde}–${c.hasta}`}</span></li>
            ))}
        </ul>
        <p className="ndvi-ley-nota">Relleno de cada módulo = {etiqueta} del mes elegido, en clases (escala 0–100). Módulo sin dato: gris.</p>
    </div>
);

export default PlanoGeneralModulos;
