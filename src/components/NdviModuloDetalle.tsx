import React, { useEffect, useMemo, useState } from 'react';
import { X, MapPin, Layers, Ruler, Activity, CalendarRange } from 'lucide-react';
import { MapContainer, WMSTileLayer, GeoJSON } from 'react-leaflet';
import ReactECharts from 'echarts-for-react';
import 'leaflet/dist/leaflet.css';
import './NdviModuloDetalle.css';
import { supabase } from '../lib/supabase';
import { COLOR_MODULO_SRL, numeroGeojsonDeSRL } from '../utils/modulosSRL';
import { bboxDeModulo } from '../utils/modulosBbox';
import { calculaIndicesSrl, volumenAcumuladoPorModuloHm3, type IndiceSrl } from '../utils/indicesSrl';

interface NdviModuloFila {
    numero_modulo: number;
    nombre_modulo: string;
    mes: string;
    ventana_desde: string;
    ventana_hasta: string;
    ndvi_medio: number;
    ndvi_min: number | null;
    ndvi_max: number | null;
    ndvi_desv: number | null;
    kc_estimado: number | null;
    delta_ndvi: number | null;
    superficie_ha: number | null;
    fraccion_cobertura_activa: number | null;
    muestras_validas: number | null;
    nubosidad_max_pct: number | null;
}

interface NdviModuloDetalleProps {
    numeroModulo: number;
    instanceId: string;
    onClose: () => void;
}

/** Ficha técnica de un módulo: contorno EXACTO leído de public/geo/modulos.geojson
 *  (mismo archivo que pinta el mapa principal de GeoMonitor.tsx, mismo mapeo
 *  numeroGeojsonDeSRL — no la geometría simplificada de la Edge Function, que
 *  vive solo del lado servidor) + capa WMS NDVI Agro de fondo + histórico
 *  propio del módulo leído de ndvi_modulo_historico. */
export const NdviModuloDetalle: React.FC<NdviModuloDetalleProps> = ({ numeroModulo, instanceId, onClose }) => {
    const [contorno, setContorno] = useState<GeoJSON.Feature | null>(null);
    const [cargandoContorno, setCargandoContorno] = useState(true);
    const [filas, setFilas] = useState<NdviModuloFila[]>([]);
    const [cargandoDatos, setCargandoDatos] = useState(true);

    const color = COLOR_MODULO_SRL[numeroModulo] ?? '#64748b';
    const bbox = bboxDeModulo(numeroModulo);

    useEffect(() => {
        let cancelado = false;
        setCargandoContorno(true);
        fetch('/geo/modulos.geojson')
            .then(r => r.ok ? r.json() : null)
            .then((fc: GeoJSON.FeatureCollection | null) => {
                if (cancelado || !fc) return;
                const numeroGeojson = numeroGeojsonDeSRL(numeroModulo);
                const feature = fc.features.find(f => Number(f.properties?.numero_modulo) === numeroGeojson) ?? null;
                setContorno(feature);
            })
            .finally(() => { if (!cancelado) setCargandoContorno(false); });
        return () => { cancelado = true; };
    }, [numeroModulo]);

    useEffect(() => {
        let cancelado = false;
        setCargandoDatos(true);
        supabase
            .from('ndvi_modulo_historico')
            .select('numero_modulo, nombre_modulo, mes, ventana_desde, ventana_hasta, ndvi_medio, ndvi_min, ndvi_max, ndvi_desv, kc_estimado, delta_ndvi, superficie_ha, fraccion_cobertura_activa, muestras_validas, nubosidad_max_pct')
            .eq('numero_modulo', numeroModulo)
            .order('mes', { ascending: true })
            .then(({ data, error }) => {
                if (cancelado) return;
                setFilas(error || !data ? [] : (data as NdviModuloFila[]));
            })
            .finally(() => { if (!cancelado) setCargandoDatos(false); });
        return () => { cancelado = true; };
    }, [numeroModulo]);

    const ultimo = filas.length ? filas[filas.length - 1] : null;
    const nombreModulo = ultimo?.nombre_modulo ?? `Módulo ${numeroModulo}`;

    // Volumen acumulado del ciclo agrícola (marzo → mes del último NDVI
    // disponible), para el IEHP — leído de volumen_modulo_mensual_provisional
    // (carga institucional manual, NO entregas_modulo/captura diaria operativa;
    // ver nota en indicesSrl.ts). Es una fuente aparte por diseño, hasta que
    // se defina el flujo definitivo de captura mensual.
    const [volumenAcumuladoHm3, setVolumenAcumuladoHm3] = useState<number | null>(null);
    const [volumenUltimoMesParcial, setVolumenUltimoMesParcial] = useState(false);
    useEffect(() => {
        if (!ultimo) return;
        let cancelado = false;
        volumenAcumuladoPorModuloHm3(ultimo.mes).then(({ porModulo, ultimoMesEsParcial }) => {
            if (cancelado) return;
            setVolumenAcumuladoHm3(porModulo.get(numeroModulo) ?? null);
            setVolumenUltimoMesParcial(ultimoMesEsParcial);
        });
        return () => { cancelado = true; };
    }, [numeroModulo, ultimo]);

    const indices: IndiceSrl[] = useMemo(() => calculaIndicesSrl({
        numeroModulo,
        nombreModulo,
        ndviMedio: ultimo?.ndvi_medio ?? null,
        ndviDesv: ultimo?.ndvi_desv ?? null,
        fraccionCoberturaActiva: ultimo?.fraccion_cobertura_activa ?? null,
        superficieHa: ultimo?.superficie_ha ?? null,
        volumenAcumuladoHm3,
    }), [numeroModulo, nombreModulo, ultimo, volumenAcumuladoHm3]);

    const wmsParams = useMemo(() => ({
        layers: '9_NDVI_AGRO',
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        maxcc: 40,
        time: `${new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)}/${new Date().toISOString().slice(0, 10)}`,
    }), []);

    const chartOption = useMemo(() => ({
        backgroundColor: 'transparent',
        grid: { left: 45, right: 20, top: 20, bottom: 40 },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: filas.map(f => f.mes), axisLabel: { color: '#94a3b8' }, axisLine: { lineStyle: { color: '#334155' } } },
        yAxis: { type: 'value', min: 0, max: 1, axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.1)' } } },
        series: [{
            type: 'line',
            symbol: 'circle',
            symbolSize: 7,
            lineStyle: { width: 2.5, color },
            itemStyle: { color },
            areaStyle: { color, opacity: 0.08 },
            data: filas.map(f => f.ndvi_medio),
        }],
    }), [filas, color]);

    const center: [number, number] = bbox ? [(bbox.minLat + bbox.maxLat) / 2, (bbox.minLon + bbox.maxLon) / 2] : [28, -105.4];

    return (
        <div className="ndvi-detalle-overlay">
            <div className="ndvi-detalle-container animate-in-zoom">
                <div className="ndvi-detalle-scroll">
                    <header className="ndvi-detalle-header">
                        <div className="ndvi-detalle-title-group">
                            <div className="ndvi-detalle-badge" style={{ color, background: `${color}1a`, borderColor: `${color}66` }}>
                                FICHA TÉCNICA · MÓDULO DE RIEGO
                            </div>
                            <h2>{nombreModulo.toUpperCase()}</h2>
                            <div className="ndvi-detalle-sub">
                                Contorno oficial (public/geo/modulos.geojson) · Capa NDVI Agro Sentinel Hub
                            </div>
                        </div>
                        <button className="ndvi-detalle-close" onClick={onClose}><X size={20} /></button>
                    </header>

                    <div className="ndvi-detalle-body">
                        <div className="ndvi-detalle-map-card glass">
                            <MapContainer center={center} zoom={11} className="ndvi-detalle-map" attributionControl={false}>
                                {instanceId && (
                                    <WMSTileLayer
                                        url={`https://services.sentinel-hub.com/ogc/wms/${instanceId}`}
                                        params={wmsParams as any}
                                        maxZoom={19}
                                    />
                                )}
                                {contorno && (
                                    <>
                                        {/* Halo blanco debajo + línea de color encima, más delgada — sin
                                            esto, el contorno de módulos con color identitario verde/ámbar/
                                            rojo (M2, M3, M5) se pierde casi por completo sobre las zonas del
                                            mismo tono en el propio semáforo NDVI de fondo. Técnica estándar
                                            de cartografía para trazos legibles sobre cualquier color base. */}
                                        <GeoJSON
                                            key={`contorno-halo-${numeroModulo}`}
                                            data={contorno as any}
                                            style={{ color: '#ffffff', weight: 6, fillOpacity: 0, opacity: 0.9 }}
                                        />
                                        <GeoJSON
                                            key={`contorno-${numeroModulo}`}
                                            data={contorno as any}
                                            style={{ color, weight: 3, fillColor: color, fillOpacity: 0.1, dashArray: '6, 4' }}
                                        />
                                    </>
                                )}
                            </MapContainer>
                            {cargandoContorno && <div className="ndvi-detalle-map-overlay">Cargando contorno…</div>}
                        </div>

                        <div className="ndvi-detalle-stats">
                            <div className="ndvi-detalle-stats-grid">
                                <div className="ndvi-detalle-stat">
                                    <span className="ndvi-detalle-stat-label"><Layers size={13} /> NDVI medio</span>
                                    <span className="ndvi-detalle-stat-value">{ultimo ? ultimo.ndvi_medio.toFixed(3) : 'S/D'}</span>
                                </div>
                                <div className="ndvi-detalle-stat">
                                    <span className="ndvi-detalle-stat-label"><Activity size={13} /> Rango (min–max)</span>
                                    <span className="ndvi-detalle-stat-value">
                                        {ultimo && ultimo.ndvi_min != null && ultimo.ndvi_max != null
                                            ? `${ultimo.ndvi_min.toFixed(2)} – ${ultimo.ndvi_max.toFixed(2)}`
                                            : 'S/D'}
                                    </span>
                                </div>
                                <div className="ndvi-detalle-stat">
                                    <span className="ndvi-detalle-stat-label"><Ruler size={13} /> Superficie</span>
                                    <span className="ndvi-detalle-stat-value">
                                        {ultimo?.superficie_ha != null ? `${ultimo.superficie_ha.toLocaleString()} ha` : 'S/D'}
                                    </span>
                                </div>
                                <div className="ndvi-detalle-stat">
                                    <span className="ndvi-detalle-stat-label"><MapPin size={13} /> Desviación estándar</span>
                                    <span className="ndvi-detalle-stat-value">{ultimo?.ndvi_desv != null ? ultimo.ndvi_desv.toFixed(3) : 'S/D'}</span>
                                </div>
                                <div className="ndvi-detalle-stat">
                                    <span className="ndvi-detalle-stat-label"><CalendarRange size={13} /> Ventana analizada</span>
                                    <span className="ndvi-detalle-stat-value ndvi-detalle-stat-value-sm">
                                        {ultimo ? `${ultimo.ventana_desde.slice(0, 10)} → ${ultimo.ventana_hasta.slice(0, 10)}` : 'S/D'}
                                    </span>
                                </div>
                                <div className="ndvi-detalle-stat">
                                    <span className="ndvi-detalle-stat-label"><Activity size={13} /> Muestras válidas</span>
                                    <span className="ndvi-detalle-stat-value">{ultimo?.muestras_validas?.toLocaleString() ?? 'S/D'}</span>
                                </div>
                                <div className="ndvi-detalle-stat">
                                    <span className="ndvi-detalle-stat-label"><Layers size={13} /> Kc estimado (NDVI→Kc)</span>
                                    <span className="ndvi-detalle-stat-value">{ultimo?.kc_estimado != null ? ultimo.kc_estimado.toFixed(2) : 'S/D'}</span>
                                </div>
                                <div className="ndvi-detalle-stat">
                                    <span className="ndvi-detalle-stat-label"><Activity size={13} /> Delta vs. mes anterior</span>
                                    <span className="ndvi-detalle-stat-value" style={{ color: ultimo?.delta_ndvi != null ? (ultimo.delta_ndvi >= 0 ? '#4ade80' : '#f87171') : undefined }}>
                                        {ultimo?.delta_ndvi != null ? `${ultimo.delta_ndvi >= 0 ? '+' : ''}${ultimo.delta_ndvi.toFixed(3)}` : 'S/D'}
                                    </span>
                                </div>
                            </div>
                            <div className="ndvi-detalle-nota">
                                Nubosidad máxima admitida en el filtro: {ultimo?.nubosidad_max_pct ?? 40}%. Estadísticas agregadas
                                sobre el polígono exacto del módulo (Statistical API, Sentinel Hub), no una muestra puntual.
                            </div>
                        </div>
                    </div>

                    <div className="ndvi-detalle-indices-card glass">
                        <div className="ndvi-detalle-chart-title">ÍNDICES INSTITUCIONALES — {nombreModulo.toUpperCase()}</div>
                        <div className="ndvi-detalle-indices-grid">
                            {indices.map(ix => (
                                <div key={ix.clave} className="ndvi-indice-card" style={{ borderColor: `${ix.color}55` }}>
                                    <div className="ndvi-indice-header">
                                        <span className="ndvi-indice-clave">{ix.clave}</span>
                                        <span className="ndvi-indice-etiqueta" style={{ color: ix.color }}>{ix.etiqueta}</span>
                                    </div>
                                    <div className="ndvi-indice-valor" style={{ color: ix.color }}>
                                        {ix.valor != null ? ix.valor : 'S/D'} <small>{ix.valor != null ? ix.unidad : ''}</small>
                                    </div>
                                    <div className="ndvi-indice-nombre">{ix.nombre}</div>
                                    <div className="ndvi-indice-implicacion">{ix.implicacion}</div>
                                    {ix.clave === 'IEHP' && volumenUltimoMesParcial && (
                                        <div className="ndvi-indice-parcial-aviso">
                                            ⚠ Incluye un mes parcial (no el mes calendario completo) — comparar con cautela.
                                        </div>
                                    )}
                                    <details className="ndvi-indice-metodologia">
                                        <summary>Metodología</summary>
                                        <div className="ndvi-indice-formula">{ix.formula}</div>
                                        <div className="ndvi-indice-procedencia">{ix.procedencia}</div>
                                    </details>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="ndvi-detalle-chart-card glass">
                        <div className="ndvi-detalle-chart-title">SERIE HISTÓRICA — {nombreModulo.toUpperCase()}</div>
                        {cargandoDatos ? (
                            <div className="ndvi-detalle-map-overlay">Cargando histórico…</div>
                        ) : filas.length === 0 ? (
                            <div className="ndvi-detalle-map-overlay">Sin datos históricos para este módulo.</div>
                        ) : (
                            <ReactECharts option={chartOption} style={{ height: 260, width: '100%' }} notMerge />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default NdviModuloDetalle;
