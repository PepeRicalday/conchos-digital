import React, { useEffect, useMemo, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { MapContainer, TileLayer, WMSTileLayer, GeoJSON, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './PlanoGeneralModulos.css';
import './ndvi/ndviVisual.css';
import { COLOR_MODULO_SRL, numeroGeojsonDeSRL } from '../utils/modulosSRL';
import { calcICV, calcIHR } from '../utils/indicesSrl';
import { sentinelWmsUrl } from '../utils/sentinelWms';
import { cargarContornosModulos } from '../utils/contornosModulos';
import { NDVI_RANGO, claseNdvi, colorNdvi } from '../utils/ndviRampa';
import { fmt } from '../utils/formato';
import { SelectorChips } from './ndvi/SelectorChips';
import { LeyendaNdvi } from './ndvi/LeyendaNdvi';

interface NdviModuloFila {
    numero_modulo: number;
    nombre_modulo: string;
    mes: string;
    ndvi_medio: number;
    ndvi_desv: number | null;
    kc_estimado: number | null;
    delta_ndvi: number | null;
    superficie_ha: number | null;
    fraccion_cobertura_activa: number | null;
    muestras_validas: number | null;
}

interface PlanoGeneralModulosProps {
    filas: NdviModuloFila[];
    meses: string[];
    /** Sentinel Hub WMS instance ID — mismo que MiniMapaNdviAgro, para el
     *  overlay "NDVI Agro" recortado por módulo cuando el índice es NDVI. */
    sentinelInstanceId: string;
}

const MODULOS_SRL = [1, 2, 3, 4, 5, 12];

// Mismo basemap CARTO oscuro y mismo criterio de fallback que PublicMonitor.tsx
// (CARTO_TILE_URL) — sin VITE_CARTO_ACCESS_TOKEN el tile legacy funciona pero
// con marca de agua "API KEY REQUIRED"; con el token, ruta /rastertiles/ correcta.
const CARTO_ACCESS_TOKEN = import.meta.env.VITE_CARTO_ACCESS_TOKEN as string | undefined;
const CARTO_TILE_URL = CARTO_ACCESS_TOKEN
    ? `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${CARTO_ACCESS_TOKEN}`
    : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

type ClaveIndice = 'ndvi' | 'icv' | 'ihr';
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
        if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 11 });
    }, [data, map]);
    return null;
};

/** Semáforo rojo→ámbar→verde — solo para ICV/IHR (índices 0-100 derivados). El NDVI usa la rampa agronómica (ndviRampa). */
function colorSemaforo(t: number): string {
    const c = Math.max(0, Math.min(1, t));
    const lerp = (a: number, b: number, f: number) => Math.round(a + (b - a) * f);
    let r: number, g: number, b: number;
    if (c < 0.5) {
        const f = c / 0.5;
        r = lerp(0xd0, 0xd9, f); g = lerp(0x3b, 0x87, f); b = lerp(0x3b, 0x04, f);
    } else {
        const f = (c - 0.5) / 0.5;
        r = lerp(0xd9, 0x0c, f); g = lerp(0x87, 0xa3, f); b = lerp(0x04, 0x0c, f);
    }
    return `rgb(${r},${g},${b})`;
}

function valorIndice(clave: ClaveIndice, fila: NdviModuloFila | undefined): number | null {
    if (!fila) return null;
    if (clave === 'ndvi') return fila.ndvi_medio;
    const base = {
        numeroModulo: fila.numero_modulo, nombreModulo: fila.nombre_modulo,
        ndviMedio: fila.ndvi_medio, ndviDesv: fila.ndvi_desv, fraccionCoberturaActiva: fila.fraccion_cobertura_activa,
        superficieHa: fila.superficie_ha, volumenAcumuladoHm3: null,
    };
    return clave === 'icv' ? calcICV(base).valor : calcIHR(base).valor;
}

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
        const mapa = new Map<number, NdviModuloFila>();
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

    const promedioSrl = useMemo(() => {
        const valores = MODULOS_SRL.map(m => valoresPorModulo.get(m)).filter((v): v is number => v != null);
        if (!valores.length) return null;
        return valores.reduce((a, b) => a + b, 0) / valores.length;
    }, [valoresPorModulo]);

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
                <div className="plano-general-titulo">
                    <MapIcon size={16} /> PLANO GENERAL — {indiceInfo.corta} · {mesSeleccionado || 'S/D'}
                </div>
                <div className="plano-general-controles">
                    <SelectorChips etiqueta="Mes (plano)" valor={mesSeleccionado} onChange={setMesElegido}
                        opciones={meses.map(m => ({ valor: m, texto: m }))} />
                    <SelectorChips etiqueta="Índice" valor={indiceSeleccionado} onChange={setIndiceSeleccionado}
                        opciones={INDICES.map(i => ({ valor: i.clave, texto: i.corta, title: i.etiqueta }))} />
                </div>
            </div>

            <div className="plano-general-body">
                <div className="plano-general-mapa-col">
                    <div className="plano-general-map-wrap">
                        <MapContainer center={center} zoom={9} className="plano-general-map" attributionControl={false}>
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
                                    const clase = esNdvi ? claseNdvi(valor) : null;
                                    layer.bindTooltip(
                                        `<strong>${nombre}</strong><br/>${indiceInfo.corta}: ${fmt(valor, decimales)}${clase ? ` · ${clase.etiqueta}` : ''}`,
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
                                                const [lo, hi] = indiceInfo.rango;
                                                const t = valor != null ? (valor - lo) / (hi - lo) : null;
                                                const relleno = esNdvi ? colorNdvi(valor) : (t != null ? colorSemaforo(t) : '#334155');
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
                        <p className="ndvi-ley-nota">Relleno de cada módulo = {indiceInfo.etiqueta} del mes elegido (rojo = bajo, verde = alto; escala 0–100).</p>
                    )}
                </div>

                <div className="plano-general-lateral">
                    <div className="plano-general-promedio-card">
                        <div className="plano-general-promedio-label">PROMEDIO SRL</div>
                        <div className="plano-general-promedio-valor">{fmt(promedioSrl, esNdvi ? 2 : 1)}</div>
                        <div className="plano-general-promedio-sub">{indiceInfo.corta} · promedio simple de los 6 módulos (sin ponderar por superficie)</div>
                    </div>
                    <div className="plano-general-tabla">
                        {MODULOS_SRL.map(srl => {
                            const valor = valoresPorModulo.get(srl) ?? null;
                            const clase = esNdvi ? claseNdvi(valor) : null;
                            return (
                                <div key={srl} className="plano-general-fila">
                                    <span className="plano-general-fila-dot" style={{ background: COLOR_MODULO_SRL[srl] ?? '#334155' }} aria-hidden="true" />
                                    <span className="plano-general-fila-nombre">Módulo {srl}</span>
                                    {clase && <span className="ndvi-fila-clase"><i style={{ background: clase.color }} aria-hidden="true" />{clase.etiqueta}</span>}
                                    <span className="plano-general-fila-valor">{fmt(valor, decimales)}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PlanoGeneralModulos;
