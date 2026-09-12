import React, { useEffect, useMemo, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { MapContainer, TileLayer, WMSTileLayer, GeoJSON, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './PlanoGeneralModulos.css';
import { COLOR_MODULO_SRL, numeroGeojsonDeSRL } from '../utils/modulosSRL';
import { calcICV, calcIHR } from '../utils/indicesSrl';
import { sentinelWmsUrl } from '../utils/sentinelWms';

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

// Logos institucionales por módulo — ya existen en public/logos/ (mismo
// activo que usa getLogoPath en uiHelpers.ts).
const LOGO_MODULO: Record<number, string> = {
    1: '/logos/modulo_1.jpg',
    2: '/logos/modulo_2.jpg',
    3: '/logos/modulo_3.jpg',
    4: '/logos/modulo_4.jpg',
    5: '/logos/modulo_5.jpg',
    12: '/logos/modulo_12.jpg',
};

function iconoLogoModulo(numeroModulo: number, colorBorde: string): L.DivIcon {
    return L.divIcon({
        className: 'plano-general-logo-icon',
        html: `<div style="
            width:34px;height:34px;border-radius:50%;overflow:hidden;
            border:2.5px solid ${colorBorde};box-shadow:0 2px 8px rgba(0,0,0,0.5);
            background:#0f172a;
        "><img src="${LOGO_MODULO[numeroModulo]}" style="width:100%;height:100%;object-fit:cover" /></div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
    });
}

// Mismo basemap CARTO oscuro y mismo criterio de fallback que PublicMonitor.tsx
// (CARTO_TILE_URL) — sin VITE_CARTO_ACCESS_TOKEN el tile legacy funciona pero
// con marca de agua "API KEY REQUIRED"; con el token, ruta /rastertiles/ correcta.
const CARTO_ACCESS_TOKEN = import.meta.env.VITE_CARTO_ACCESS_TOKEN as string | undefined;
const CARTO_TILE_URL = CARTO_ACCESS_TOKEN
    ? `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${CARTO_ACCESS_TOKEN}`
    : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

type ClaveIndice = 'ndvi' | 'icv' | 'ihr';
const INDICES: { clave: ClaveIndice; etiqueta: string; rango: [number, number] }[] = [
    { clave: 'ndvi', etiqueta: 'NDVI', rango: [0, 1] },
    { clave: 'icv', etiqueta: 'ICV (Condición Vegetativa)', rango: [0, 100] },
    { clave: 'ihr', etiqueta: 'IHR (Homogeneidad de Riego)', rango: [0, 100] },
];

/** Rampa continua rojo→ámbar→verde sobre t∈[0,1] — misma semántica de
 *  semáforo que el resto de índices institucionales del proyecto
 *  (indicesAgro.ts), aplicada aquí como color de relleno del polígono. */
function colorRampa(t: number): string {
    const c = Math.max(0, Math.min(1, t));
    // Interpola en dos tramos: rojo(#d03b3b)→ámbar(#d98704) en [0,0.5],
    // ámbar→verde(#0ca30c) en [0.5,1].
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
    if (clave === 'icv') return calcICV({
        numeroModulo: fila.numero_modulo, nombreModulo: fila.nombre_modulo,
        ndviMedio: fila.ndvi_medio, ndviDesv: fila.ndvi_desv, fraccionCoberturaActiva: fila.fraccion_cobertura_activa,
        superficieHa: fila.superficie_ha, volumenAcumuladoHm3: null,
    }).valor;
    return calcIHR({
        numeroModulo: fila.numero_modulo, nombreModulo: fila.nombre_modulo,
        ndviMedio: fila.ndvi_medio, ndviDesv: fila.ndvi_desv, fraccionCoberturaActiva: fila.fraccion_cobertura_activa,
        superficieHa: fila.superficie_ha, volumenAcumuladoHm3: null,
    }).valor;
}

/** Plano general: mapa único con el contorno EXACTO (public/geo/modulos.geojson)
 *  de los 6 módulos SRL, coloreado según el índice y mes elegidos — vista
 *  coroplética institucional en vez de 6 mini-mapas separados. Incluye el
 *  promedio SRL (agregado de los 6 módulos) del mes/índice seleccionado. */
export const PlanoGeneralModulos: React.FC<PlanoGeneralModulosProps> = ({ filas, meses, sentinelInstanceId }) => {
    const [mesSeleccionado, setMesSeleccionado] = useState<string>('');
    const [indiceSeleccionado, setIndiceSeleccionado] = useState<ClaveIndice>('ndvi');
    const [contornos, setContornos] = useState<Record<number, GeoJSON.Feature>>({});
    const [cargandoContornos, setCargandoContornos] = useState(true);

    useEffect(() => {
        if (meses.length && !mesSeleccionado) setMesSeleccionado(meses[meses.length - 1]);
    }, [meses, mesSeleccionado]);

    useEffect(() => {
        let cancelado = false;
        fetch('/geo/modulos.geojson')
            .then(r => r.ok ? r.json() : null)
            .then((fc: GeoJSON.FeatureCollection | null) => {
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
    // módulo, para colocar el marcador de logo — suficiente para un ícono
    // visual, no requiere el centroide geométrico exacto del polígono.
    const centroidePorModulo = useMemo(() => {
        const mapa = new Map<number, [number, number]>();
        for (const m of MODULOS_SRL) {
            const feature = contornos[m];
            if (!feature) continue;
            const geom = feature.geometry;
            const anillo = geom.type === 'Polygon' ? geom.coordinates[0] : geom.type === 'MultiPolygon' ? geom.coordinates[0][0] : null;
            if (!anillo) continue;
            const lons = anillo.map((c: any) => c[0]), lats = anillo.map((c: any) => c[1]);
            mapa.set(m, [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2]);
        }
        return mapa;
    }, [contornos]);

    const wmsParams = useMemo(() => ({
        layers: '9_NDVI_AGRO',
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        maxcc: 40,
        time: `${new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)}/${new Date().toISOString().slice(0, 10)}`,
    }), []);

    const center: [number, number] = [28.02, -105.35];

    return (
        <div className="plano-general-card glass">
            <div className="plano-general-header">
                <div className="plano-general-titulo">
                    <MapIcon size={16} /> PLANO GENERAL — {indiceInfo.etiqueta} · {mesSeleccionado || 'S/D'}
                </div>
                <div className="plano-general-controles">
                    <label className="plano-general-control">
                        <span>Mes</span>
                        <select value={mesSeleccionado} onChange={e => setMesSeleccionado(e.target.value)}>
                            {meses.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </label>
                    <label className="plano-general-control">
                        <span>Índice</span>
                        <select value={indiceSeleccionado} onChange={e => setIndiceSeleccionado(e.target.value as ClaveIndice)}>
                            {INDICES.map(i => <option key={i.clave} value={i.clave}>{i.etiqueta}</option>)}
                        </select>
                    </label>
                </div>
            </div>

            <div className="plano-general-body">
                <div className="plano-general-map-wrap">
                    <MapContainer center={center} zoom={9} className="plano-general-map" attributionControl={false}>
                        <TileLayer url={CARTO_TILE_URL} attribution="&copy; CARTO" />
                        {/* Solo para NDVI: overlay del tile real "NDVI Agro" de Sentinel Hub
                            — ICV/IHR son números derivados sin banda espectral propia que
                            mostrar, se quedan con el coroplético por color. */}
                        {indiceSeleccionado === 'ndvi' && sentinelInstanceId && (
                            <WMSTileLayer
                                url={sentinelWmsUrl(sentinelInstanceId)}
                                params={wmsParams as any}
                                maxZoom={19}
                                opacity={0.85}
                            />
                        )}
                        {!cargandoContornos && (() => {
                            const conImagenFondo = indiceSeleccionado === 'ndvi' && !!sentinelInstanceId;
                            const bindTooltip = (feature: any, layer: any) => {
                                const srl = feature.properties?.numero_modulo_srl;
                                const valor = srl != null ? valoresPorModulo.get(srl) : null;
                                const nombre = feature.properties?.nombre ?? `Módulo ${srl}`;
                                layer.bindTooltip(
                                    `<strong>${nombre}</strong><br/>${indiceInfo.etiqueta}: ${valor != null ? valor.toFixed(indiceSeleccionado === 'ndvi' ? 3 : 0) : 'S/D'}`,
                                    { sticky: true, className: 'plano-general-tooltip' }
                                );
                            };
                            return (
                                <>
                                    {/* Halo blanco debajo del borde identitario — solo con el tile
                                        NDVI de fondo: sin él, 3 de los 6 colores de módulo (verde,
                                        ámbar, rojo) se pierden casi por completo sobre el propio
                                        semáforo NDVI. Con coroplético puro (ICV/IHR, fondo oscuro
                                        uniforme) el borde de color ya contrasta bien y no hace falta. */}
                                    {conImagenFondo && (
                                        <GeoJSON
                                            key={`plano-halo-${indiceSeleccionado}-${mesSeleccionado}`}
                                            data={geoJsonCombinado as any}
                                            style={{ color: '#ffffff', weight: 6, fillOpacity: 0, opacity: 0.85 }}
                                        />
                                    )}
                                    <GeoJSON
                                        key={`plano-${indiceSeleccionado}-${mesSeleccionado}`}
                                        data={geoJsonCombinado as any}
                                        style={(feature) => {
                                            const srl = feature?.properties?.numero_modulo_srl;
                                            const valor = srl != null ? valoresPorModulo.get(srl) : null;
                                            const [lo, hi] = indiceInfo.rango;
                                            const t = valor != null ? (valor - lo) / (hi - lo) : null;
                                            const colorIdentidad = srl != null ? (COLOR_MODULO_SRL[srl] ?? '#ffffff') : '#ffffff';
                                            return {
                                                color: colorIdentidad, weight: conImagenFondo ? 3 : 2, opacity: 0.9,
                                                fillColor: t != null ? colorRampa(t) : '#334155',
                                                fillOpacity: conImagenFondo ? 0.12 : (t != null ? 0.65 : 0.25),
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
                            return (
                                <Marker key={`logo-${m}`} position={centroide} icon={iconoLogoModulo(m, COLOR_MODULO_SRL[m] ?? '#ffffff')} />
                            );
                        })}
                    </MapContainer>
                </div>

                <div className="plano-general-lateral">
                    <div className="plano-general-promedio-card">
                        <div className="plano-general-promedio-label">PROMEDIO SRL</div>
                        <div className="plano-general-promedio-valor">
                            {promedioSrl != null ? promedioSrl.toFixed(indiceSeleccionado === 'ndvi' ? 3 : 1) : 'S/D'}
                        </div>
                        <div className="plano-general-promedio-sub">{indiceInfo.etiqueta} · promedio de los 6 módulos</div>
                    </div>
                    <div className="plano-general-tabla">
                        {MODULOS_SRL.map(srl => {
                            const valor = valoresPorModulo.get(srl);
                            return (
                                <div key={srl} className="plano-general-fila">
                                    <img src={LOGO_MODULO[srl]} className="plano-general-fila-logo" alt="" />
                                    <span className="plano-general-fila-dot" style={{ background: COLOR_MODULO_SRL[srl] ?? '#334155' }} />
                                    <span className="plano-general-fila-nombre">Módulo {srl}</span>
                                    <span className="plano-general-fila-valor">
                                        {valor != null ? valor.toFixed(indiceSeleccionado === 'ndvi' ? 3 : 0) : 'S/D'}
                                    </span>
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
