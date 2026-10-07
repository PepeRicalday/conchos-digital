import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Satellite, RefreshCw, TrendingUp, TrendingDown, FileText } from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import { MapContainer, TileLayer, WMSTileLayer } from 'react-leaflet';
import type { WMSParams } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './NdviModulosPanel.css';
import './ndvi/ndviVisual.css';
// Reutiliza el esqueleto visual del modal de Manejo de Vaso (overlay, header,
// tarjetas de KPI) en vez de duplicar esas reglas — mismo criterio de overlay
// a pantalla completa que PresaVasoMonitor.
import '../components/PresaVasoMonitor.css';
import { supabase } from '../lib/supabase';
import { COLOR_MODULO_SRL } from '../utils/modulosSRL';
import { bboxDeModulo } from '../utils/modulosBbox';
import { sentinelWmsUrl } from '../utils/sentinelWms';
import { claseNdvi } from '../utils/ndviRampa';
import { fmt } from '../utils/formato';
import { NdviModuloDetalle } from './NdviModuloDetalle';
import { PlanoGeneralModulos } from './PlanoGeneralModulos';
import { SelectorChips } from './ndvi/SelectorChips';
import { SparklineNdvi } from './ndvi/SparklineNdvi';
import { generarInformeInstitucional } from '../utils/informeNdviInstitucional';

// Mismo basemap CARTO oscuro y mismo criterio de fallback que GeoMonitor.tsx /
// PlanoGeneralModulos.tsx — sin él, el WMS de NDVI (transparente) queda flotando
// sobre fondo negro y el mini-mapa parece vacío.
const CARTO_ACCESS_TOKEN = import.meta.env.VITE_CARTO_ACCESS_TOKEN as string | undefined;
const CARTO_TILE_URL = CARTO_ACCESS_TOKEN
    ? `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${CARTO_ACCESS_TOKEN}`
    : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

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
const MESES_SPARK = 6;

/** Monta el hijo solo cuando entra al viewport (una vez). Las 6 tarjetas dejaban 6 mapas Leaflet + 6 tandas de tiles
 *  WMS en vivo al abrir el panel aunque estuvieran fuera de pantalla; ahora solo se piden los visibles. */
const Diferido: React.FC<{ alto: number; children: React.ReactNode }> = ({ alto, children }) => {
    const ref = useRef<HTMLDivElement>(null);
    // Sin IntersectionObserver (navegadores muy viejos) se monta de inmediato, como antes.
    const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
    useEffect(() => {
        const el = ref.current;
        if (!el || visible) return;
        const io = new IntersectionObserver((entradas) => {
            if (entradas.some(e => e.isIntersecting)) { setVisible(true); io.disconnect(); }
        }, { rootMargin: '200px' });
        io.observe(el);
        return () => io.disconnect();
    }, [visible]);
    return <div ref={ref} style={visible ? undefined : { height: alto }}>{visible ? children : null}</div>;
};

/** Mini-mapa Leaflet recortado al bbox del módulo, con la capa WMS "NDVI Agro"
 *  de Sentinel Hub ya usada en el mapa principal de GeoMonitor.tsx (mismo
 *  sentinelInstanceId, mismos tiles en vivo) — no genera ni guarda ninguna
 *  imagen nueva, solo reutiliza la config WMS ya validada. maxCloudCoverage
 *  40 y ventana de 30 días, igual criterio que el resto de capas Sentinel de
 *  este proyecto (ver sentinelWmsParams en GeoMonitor.tsx). */
const MiniMapaNdviAgro: React.FC<{ numeroModulo: number; instanceId: string }> = ({ numeroModulo, instanceId }) => {
    const bbox = bboxDeModulo(numeroModulo);
    // Los hooks van ANTES de cualquier return: un `return null` previo al useMemo rompe la regla de hooks
    // cuando el módulo cambia entre uno con bbox y otro sin él.
    const [wmsParams] = useState(() => ({
        layers: '9_NDVI_AGRO',
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        maxcc: 40,
        // El watermark "Copernicus" viene quemado en el tile por defecto en
        // CDSE (plan gratuito) — showlogo=false lo suprime vía parámetro WMS
        // estándar de Sentinel Hub, sin tocar la instancia ni el proveedor.
        showlogo: false,
        time: `${new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)}/${new Date().toISOString().slice(0, 10)}`,
    }));
    if (!bbox) return null;
    const center: [number, number] = [(bbox.minLat + bbox.maxLat) / 2, (bbox.minLon + bbox.maxLon) / 2];
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
            <TileLayer url={CARTO_TILE_URL} />
            <WMSTileLayer
                url={sentinelWmsUrl(instanceId)}
                params={wmsParams as unknown as WMSParams}
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
    const [errorCarga, setErrorCarga] = useState<string | null>(null);
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
        // Un fallo de lectura NO es "todavía no hay datos": se informa aparte, con reintento.
        setErrorCarga(error ? error.message : null);
        setFilas(error || !data ? [] : (data as NdviModuloFila[]));
    }, []);

    const cargarInicial = useCallback(() => {
        setCargando(true);
        return recargar().finally(() => setCargando(false));
    }, [recargar]);

    useEffect(() => {
        let cancelado = false;
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
            const resultados = (data?.resultados || []) as { insertado?: boolean }[];
            const insertados = resultados.filter(r => r.insertado).length;
            setResultadoSync(`Actualizado: ${insertados}/${resultados.length} módulos con dato nuevo para ${data?.mes ?? 'el mes actual'}.`);
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

    // Serie de los últimos 6 meses (hasta el elegido) por módulo, para la sparkline de cada tarjeta.
    const serieSpark = useMemo(() => {
        const hasta = meses.filter(m => m <= mesTarjetas).slice(-MESES_SPARK);
        const mapa = new Map<number, (number | null)[]>();
        for (const mod of MODULOS_SRL) {
            const porMes = new Map(filas.filter(f => f.numero_modulo === mod).map(f => [f.mes, f.ndvi_medio]));
            mapa.set(mod, hasta.map(m => porMes.get(m) ?? null));
        }
        return { hasta, mapa };
    }, [filas, meses, mesTarjetas]);

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
            legend: { data: series.map(s => s.name), textStyle: { color: '#cbd5e1', fontSize: 12 }, top: 0 },
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: meses, axisLabel: { color: '#cbd5e1', fontSize: 12 }, axisLine: { lineStyle: { color: '#334155' } } },
            yAxis: { type: 'value', min: 0, max: 0.8, axisLabel: { color: '#cbd5e1', fontSize: 12 }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.1)' } } },
            series,
        };
    }, [filas, meses]);

    const abrirDetalle = (n: number) => setModuloDetalle(n);

    return (
        <div className="vaso-screen-overlay">
            <div className="vaso-container animate-in-zoom">
                <div className="vaso-scroll-content">
                    <header className="vaso-header ndvi-panel-header">
                        <div className="vaso-title-group ndvi-panel-title-group">
                            <div className="vaso-badge">GEO-MONITOR · TELEDETECCIÓN</div>
                            <h2>NDVI MENSUAL POR MÓDULO</h2>
                            <div className="vaso-coords" title="Vigor vegetativo agregado, calculado con el polígono exacto de cada módulo (Sentinel Hub, Statistical API)">
                                Vigor vegetativo por módulo · polígono exacto · Sentinel Hub
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
                            <button type="button" className="vaso-close" onClick={onClose} aria-label="Cerrar NDVI mensual por módulo">×</button>
                        </div>
                    </header>

                    {resultadoSync && (
                        <div className="ndvi-sync-msg glass" role="status">{resultadoSync}</div>
                    )}

                    {cargando ? (
                        <div className="ndvi-skeleton-fila" role="status" aria-label="Cargando histórico de NDVI">
                            {MODULOS_SRL.map(m => <div key={m} className="ndvi-skeleton" />)}
                        </div>
                    ) : errorCarga ? (
                        <div className="ndvi-error" role="alert">
                            <span>No se pudo leer el histórico de NDVI ({errorCarga}). Esto no significa que no haya datos.</span>
                            <button type="button" className="ndvi-btn" onClick={() => void cargarInicial()}>Reintentar</button>
                        </div>
                    ) : filas.length === 0 ? (
                        <div className="ndvi-empty-state">
                            <Satellite size={28} />
                            <p>Todavía no hay datos históricos. El cron corre el día 3 de cada mes, o usa "Actualizar ahora" para calcular el mes en curso.</p>
                        </div>
                    ) : (
                        <>
                            <div className="ndvi-controles">
                                <SelectorChips etiqueta="Mes (tarjetas)" valor={mesTarjetas} onChange={setMesTarjetas}
                                    opciones={meses.map(m => ({ valor: m, texto: m }))} />
                                <p className="ndvi-nota">
                                    Los números son del mes elegido. La imagen de cada tarjeta es la referencia satelital de los últimos 30 días.
                                </p>
                            </div>
                            <div className="vaso-stats-grid">
                                {MODULOS_SRL.map(numeroModulo => {
                                    const ultimo = ultimoPorModulo.get(numeroModulo);
                                    const clase = claseNdvi(ultimo?.ndvi_medio);
                                    const delta = ultimo?.delta_ndvi ?? null;
                                    const etiquetaAria = ultimo
                                        ? `Módulo ${numeroModulo}, NDVI ${fmt(ultimo.ndvi_medio, 2)}, ${clase?.etiqueta ?? 'sin clase'}${delta != null ? `, ${delta >= 0 ? 'sube' : 'baja'} ${fmt(Math.abs(delta), 3)} contra el mes anterior` : ''}. Abrir ficha técnica.`
                                        : `Módulo ${numeroModulo}, sin dato en ${mesTarjetas}. Abrir ficha técnica.`;
                                    return (
                                        <div
                                            key={numeroModulo}
                                            className="vaso-stat-card glass ndvi-modulo-card-clickable"
                                            style={{ borderTop: `3px solid ${COLOR_MODULO_SRL[numeroModulo]}` }}
                                            role="button"
                                            tabIndex={0}
                                            aria-label={etiquetaAria}
                                            onClick={() => abrirDetalle(numeroModulo)}
                                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirDetalle(numeroModulo); } }}
                                            title={`Ver ficha técnica del Módulo ${numeroModulo}`}
                                        >
                                            <div className="ndvi-card-top">
                                                <div className="vaso-stat-label">Módulo {numeroModulo}</div>
                                                {clase && (
                                                    <span className="ndvi-clase" style={{ ['--c' as string]: clase.color }} title={clase.significado}>
                                                        <i aria-hidden="true" />{clase.etiqueta}
                                                    </span>
                                                )}
                                            </div>
                                            {ultimo ? (
                                                <>
                                                    <div className="ndvi-card-valor">
                                                        <span className="ndvi-card-num">{fmt(ultimo.ndvi_medio, 2)}<small>NDVI</small></span>
                                                        <SparklineNdvi valores={serieSpark.mapa.get(numeroModulo) ?? []}
                                                            etiqueta={`Tendencia NDVI del Módulo ${numeroModulo}, ${serieSpark.hasta.join(', ')}`} />
                                                    </div>
                                                    <div className="ndvi-card-meta">
                                                        {delta != null ? (
                                                            <span className={`ndvi-delta ${delta >= 0 ? 'ndvi-delta-sube' : 'ndvi-delta-baja'}`}>
                                                                {delta >= 0 ? <TrendingUp size={13} aria-hidden="true" /> : <TrendingDown size={13} aria-hidden="true" />}
                                                                {delta >= 0 ? '+' : '−'}{fmt(Math.abs(delta), 3)} <span style={{ fontWeight: 400 }}>vs mes anterior</span>
                                                            </span>
                                                        ) : <span>Sin mes anterior para comparar</span>}
                                                        <br />Kc ≈ {fmt(ultimo.kc_estimado, 2)} · {ultimo.mes}
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="ndvi-card-sd">S/D — sin dato en {mesTarjetas}</div>
                                            )}
                                            <div className="ndvi-minimap-wrap" style={{ marginTop: 10 }}>
                                                {sentinelInstanceId ? (
                                                    <Diferido alto={140}>
                                                        <MiniMapaNdviAgro numeroModulo={numeroModulo} instanceId={sentinelInstanceId} />
                                                    </Diferido>
                                                ) : (
                                                    <div className="ndvi-minimap ndvi-minimap-sd">Sentinel Hub no configurado</div>
                                                )}
                                                {sentinelInstanceId && <span className="ndvi-minimap-et">Imagen: últimos 30 días</span>}
                                            </div>
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
