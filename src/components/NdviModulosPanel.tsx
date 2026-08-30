import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Satellite, RefreshCw, TrendingUp, TrendingDown, FileText } from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import { MapContainer, WMSTileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './NdviModulosPanel.css';
// Reutiliza el esqueleto visual del modal de Manejo de Vaso (overlay, header,
// tarjetas de KPI) en vez de duplicar esas reglas — mismo criterio de overlay
// a pantalla completa que PresaVasoMonitor.
import '../components/PresaVasoMonitor.css';
import { supabase } from '../lib/supabase';
import { COLOR_MODULO_SRL } from '../utils/modulosSRL';
import { bboxDeModulo } from '../utils/modulosBbox';
import { NdviModuloDetalle } from './NdviModuloDetalle';
import { PlanoGeneralModulos } from './PlanoGeneralModulos';
import { generarInformeInstitucional } from '../utils/informeNdviInstitucional';

interface NdviModuloFila {
    numero_modulo: number;
    nombre_modulo: string;
    mes: string;
    ndvi_medio: number;
    ndvi_min: number | null;
    ndvi_max: number | null;
    ndvi_desv: number | null;
    kc_estimado: number | null;
    delta_ndvi: number | null;
    superficie_ha: number | null;
    fraccion_cobertura_activa: number | null;
    muestras_validas: number | null;
}

interface NdviModulosPanelProps {
    onClose: () => void;
}

const MODULOS_SRL = [1, 2, 3, 4, 5, 12];

/** Mini-mapa Leaflet recortado al bbox del módulo, con la capa WMS "NDVI Agro"
 *  de Sentinel Hub ya usada en el mapa principal de GeoMonitor.tsx (mismo
 *  sentinelInstanceId, mismos tiles en vivo) — no genera ni guarda ninguna
 *  imagen nueva, solo reutiliza la config WMS ya validada. maxCloudCoverage
 *  40 y ventana de 30 días, igual criterio que el resto de capas Sentinel de
 *  este proyecto (ver sentinelWmsParams en GeoMonitor.tsx). */
const MiniMapaNdviAgro: React.FC<{ numeroModulo: number; instanceId: string }> = ({ numeroModulo, instanceId }) => {
    const bbox = bboxDeModulo(numeroModulo);
    if (!bbox) return null;
    const center: [number, number] = [(bbox.minLat + bbox.maxLat) / 2, (bbox.minLon + bbox.maxLon) / 2];
    const wmsParams = useMemo(() => ({
        layers: '9_NDVI_AGRO',
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        maxcc: 40,
        time: `${new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)}/${new Date().toISOString().slice(0, 10)}`,
    }), []);
    return (
        <MapContainer
            center={center}
            zoom={11}
            className="ndvi-minimap"
            zoomControl={false}
            dragging={false}
            scrollWheelZoom={false}
            doubleClickZoom={false}
            attributionControl={false}
        >
            <WMSTileLayer
                url={`https://services.sentinel-hub.com/ogc/wms/${instanceId}`}
                params={wmsParams as any}
                maxZoom={19}
            />
        </MapContainer>
    );
};

export const NdviModulosPanel: React.FC<NdviModulosPanelProps> = ({ onClose }) => {
    const [sentinelInstanceId] = useState<string>(() => (
        localStorage.getItem('geo_sentinel_instance_id') || import.meta.env.VITE_SENTINEL_INSTANCE_ID || ''
    ));
    const [filas, setFilas] = useState<NdviModuloFila[]>([]);
    const [cargando, setCargando] = useState(true);
    const [sincronizando, setSincronizando] = useState(false);
    const [resultadoSync, setResultadoSync] = useState<string | null>(null);
    const [moduloDetalle, setModuloDetalle] = useState<number | null>(null);
    // Mes que muestran las 6 tarjetas de resumen — por defecto el más
    // reciente disponible, pero seleccionable para revisar meses pasados sin
    // tener que abrir la ficha de cada módulo por separado. El mini-mapa
    // satelital de fondo (MiniMapaNdviAgro) NO cambia con este filtro: es un
    // tile WMS en vivo de Sentinel Hub (últimos 30 días reales), no tiene
    // historial por mes — solo los NÚMEROS (NDVI/delta/Kc) reflejan el mes
    // elegido.
    const [mesTarjetas, setMesTarjetas] = useState<string>('');

    const [generandoInforme, setGenerandoInforme] = useState(false);

    const recargar = useCallback(async () => {
        const { data, error } = await supabase
            .from('ndvi_modulo_historico')
            .select('numero_modulo, nombre_modulo, mes, ndvi_medio, ndvi_min, ndvi_max, ndvi_desv, kc_estimado, delta_ndvi, superficie_ha, fraccion_cobertura_activa, muestras_validas')
            .order('mes', { ascending: true });
        setFilas(error || !data ? [] : (data as NdviModuloFila[]));
    }, []);

    useEffect(() => {
        let cancelado = false;
        setCargando(true);
        recargar().then(() => { if (!cancelado) setCargando(false); });
        return () => { cancelado = true; };
    }, [recargar]);

    // Sincroniza el mes en curso a demanda — mismo endpoint que invoca el cron
    // automático (día 3 de cada mes), sin esperar esa fecha. Sin numero_modulo
    // en el body: procesa los 6 módulos SRL en una sola invocación.
    const sincronizarAhora = useCallback(async () => {
        setSincronizando(true);
        setResultadoSync(null);
        try {
            const { data, error } = await supabase.functions.invoke('sentinel-ndvi-modulo-sync', { body: {} });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            const insertados = (data?.resultados || []).filter((r: any) => r.insertado).length;
            const total = (data?.resultados || []).length;
            setResultadoSync(`Actualizado: ${insertados}/${total} módulos con dato nuevo para ${data?.mes ?? 'el mes actual'}.`);
            await recargar();
        } catch (err) {
            setResultadoSync(`Error: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setSincronizando(false);
        }
    }, [recargar]);

    const meses = useMemo(() => Array.from(new Set(filas.map(f => f.mes))).sort(), [filas]);

    useEffect(() => {
        if (meses.length && !mesTarjetas) setMesTarjetas(meses[meses.length - 1]);
    }, [meses, mesTarjetas]);

    // Fila de cada módulo para el MES SELECCIONADO (mesTarjetas) — antes
    // siempre era "la más reciente"; con el filtro puede ser cualquier mes
    // del histórico. Si el mes elegido no tiene dato para un módulo (hueco
    // en la serie), esa tarjeta cae a "Sin dato aún", no a otro mes.
    const ultimoPorModulo = useMemo(() => {
        const mapa = new Map<number, NdviModuloFila>();
        for (const f of filas) if (f.mes === mesTarjetas) mapa.set(f.numero_modulo, f);
        return mapa;
    }, [filas, mesTarjetas]);

    const generarInforme = useCallback(async () => {
        setGenerandoInforme(true);
        try {
            await generarInformeInstitucional(filas);
        } catch (err) {
            setResultadoSync(`Error al generar el informe: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setGenerandoInforme(false);
        }
    }, [filas]);

    const chartOption = useMemo(() => {
        const series = MODULOS_SRL.map(numeroModulo => {
            const porMes = new Map(filas.filter(f => f.numero_modulo === numeroModulo).map(f => [f.mes, f.ndvi_medio]));
            return {
                name: `Módulo ${numeroModulo}`,
                type: 'line',
                connectNulls: true,
                symbol: 'circle',
                symbolSize: 6,
                lineStyle: { width: 2, color: COLOR_MODULO_SRL[numeroModulo] },
                itemStyle: { color: COLOR_MODULO_SRL[numeroModulo] },
                data: meses.map(m => porMes.get(m) ?? null),
            };
        });
        return {
            backgroundColor: 'transparent',
            grid: { left: 50, right: 20, top: 40, bottom: 40 },
            legend: { data: series.map(s => s.name), textStyle: { color: '#94a3b8' }, top: 0 },
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: meses, axisLabel: { color: '#94a3b8' }, axisLine: { lineStyle: { color: '#334155' } } },
            yAxis: { type: 'value', min: 0, max: 1, axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.1)' } } },
            series,
        };
    }, [filas, meses]);

    return (
        <div className="vaso-screen-overlay">
            <div className="vaso-container animate-in-zoom">
                <div className="vaso-scroll-content">
                    <header className="vaso-header ndvi-panel-header">
                        <div className="vaso-title-group ndvi-panel-title-group">
                            <div className="vaso-badge">GEO-MONITOR · TELEDETECCIÓN</div>
                            <h2>NDVI MENSUAL POR MÓDULO</h2>
                            <div className="vaso-coords">
                                Vigor vegetativo agregado, calculado con el polígono exacto de cada módulo (Sentinel Hub, Statistical API)
                            </div>
                        </div>
                        <div className="ndvi-panel-header-actions">
                            <button
                                type="button"
                                className="vaso-header-3d-btn"
                                onClick={generarInforme}
                                disabled={generandoInforme || filas.length === 0}
                                title="Generar informe institucional HTML (plano general + datos por módulo + promedio SRL)"
                            >
                                <FileText size={14} /> {generandoInforme ? 'Generando…' : 'Informe institucional'}
                            </button>
                            <button
                                type="button"
                                className="vaso-header-3d-btn"
                                onClick={sincronizarAhora}
                                disabled={sincronizando}
                                title="Forzar cálculo del mes actual sin esperar al cron del día 3"
                            >
                                <RefreshCw size={14} className={sincronizando ? 'ndvi-spin' : ''} /> {sincronizando ? 'Actualizando…' : 'Actualizar ahora'}
                            </button>
                            <button className="vaso-close" onClick={onClose}>×</button>
                        </div>
                    </header>

                    {resultadoSync && (
                        <div className="ndvi-sync-msg glass">{resultadoSync}</div>
                    )}

                    {cargando ? (
                        <div className="ndvi-empty-state">Cargando histórico…</div>
                    ) : filas.length === 0 ? (
                        <div className="ndvi-empty-state">
                            <Satellite size={28} />
                            <p>Todavía no hay datos históricos. El cron corre el día 3 de cada mes, o usa "Actualizar ahora" para calcular el mes en curso.</p>
                        </div>
                    ) : (
                        <>
                            <div className="ndvi-tarjetas-filtro">
                                <label className="ndvi-tarjetas-filtro-label">
                                    <span>Mes</span>
                                    <select value={mesTarjetas} onChange={e => setMesTarjetas(e.target.value)}>
                                        {meses.map(m => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                </label>
                                <span className="ndvi-tarjetas-filtro-nota">
                                    El mini-mapa satelital siempre muestra los últimos 30 días reales (Sentinel Hub en vivo); los valores numéricos corresponden al mes elegido.
                                </span>
                            </div>
                            <div className="vaso-stats-grid">
                                {MODULOS_SRL.map(numeroModulo => {
                                    const ultimo = ultimoPorModulo.get(numeroModulo);
                                    return (
                                        <div
                                            key={numeroModulo}
                                            className="vaso-stat-card glass ndvi-modulo-card-clickable"
                                            style={{ borderTop: `3px solid ${COLOR_MODULO_SRL[numeroModulo]}` }}
                                            onClick={() => setModuloDetalle(numeroModulo)}
                                            title={`Ver ficha técnica del Módulo ${numeroModulo}`}
                                        >
                                            <div className="vaso-stat-label">Módulo {numeroModulo}</div>
                                            {sentinelInstanceId ? (
                                                <MiniMapaNdviAgro numeroModulo={numeroModulo} instanceId={sentinelInstanceId} />
                                            ) : (
                                                <div className="ndvi-minimap ndvi-minimap-sd">Sentinel Hub no configurado</div>
                                            )}
                                            {ultimo ? (
                                                <>
                                                    <div className="vaso-stat-value">
                                                        {ultimo.ndvi_medio.toFixed(2)} <small>NDVI</small>
                                                    </div>
                                                    <div className="vaso-stat-footer">
                                                        {ultimo.delta_ndvi != null && (
                                                            <span className={ultimo.delta_ndvi >= 0 ? 'ndvi-delta-up' : 'ndvi-delta-down'}>
                                                                {ultimo.delta_ndvi >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                                                {' '}{ultimo.delta_ndvi >= 0 ? '+' : ''}{ultimo.delta_ndvi.toFixed(3)}
                                                            </span>
                                                        )}
                                                        {' · '}Kc≈{ultimo.kc_estimado?.toFixed(2) ?? 'S/D'} · {ultimo.mes}
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="vaso-stat-value" style={{ fontSize: '1.1rem', opacity: 0.6 }}>Sin dato aún</div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            <PlanoGeneralModulos filas={filas} meses={meses} sentinelInstanceId={sentinelInstanceId} />

                            <div className="ndvi-chart-card glass">
                                <ReactECharts option={chartOption} style={{ height: 380, width: '100%' }} notMerge />
                            </div>
                        </>
                    )}
                </div>
            </div>

            {moduloDetalle !== null && (
                <NdviModuloDetalle
                    numeroModulo={moduloDetalle}
                    instanceId={sentinelInstanceId}
                    onClose={() => setModuloDetalle(null)}
                />
            )}
        </div>
    );
};

export default NdviModulosPanel;
