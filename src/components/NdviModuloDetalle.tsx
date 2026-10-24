import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { WMSParams } from 'leaflet';
import { X, MapPin, Layers, Ruler, Activity, CalendarRange, TrendingUp, TrendingDown } from 'lucide-react';
import { MapContainer, WMSTileLayer, GeoJSON } from 'react-leaflet';
import ReactECharts from 'echarts-for-react';
import 'leaflet/dist/leaflet.css';
import './NdviModuloDetalle.css';
import './ndvi/ndviVisual.css';
import { supabase } from '../lib/supabase';
import { COLOR_MODULO_SRL, numeroGeojsonDeSRL } from '../utils/modulosSRL';
import { bboxDeModulo } from '../utils/modulosBbox';
import { sentinelWmsUrl } from '../utils/sentinelWms';
import { cargarContornosModulos } from '../utils/contornosModulos';
import { calculaIndicesSrl, volumenAcumuladoPorModuloHm3, type IndiceSrl } from '../utils/indicesSrl';
import { inicioCiclo } from '../utils/informeNdviConfig';
import { NDVI_RANGO, ROTULO_METODO_NDVI, cargarSerieNdviV2, filasDeSerie, type FilaNdviSerie } from '../utils/ndviSerie';
import { MESES_CORTOS, MESES_LARGOS, ejeMeses, UMBRAL_COBERTURA_ACTIVA, aniosDeMeses, anioDe, bandaMensual12, serieAnio12, serieIndice12 } from '../utils/ndviGrafica';
import { colorAnioPrevio } from '../utils/ndviInteranual';
import { fmt } from '../utils/formato';
import { useModalA11y } from './historico/useModalA11y';
import { SelectorChips } from './ndvi/SelectorChips';

interface NdviModuloDetalleProps {
    numeroModulo: number;
    instanceId: string;
    /** Mes ('AAAA-MM') que muestra la ficha: el elegido en el panel. Sin él (o sin dato ese mes) la ficha muestra S/D, nunca otro mes. */
    mes?: string;
    onClose: () => void;
}

const FONDO_TOOLTIP = { backgroundColor: '#0f172a', borderColor: '#334155', textStyle: { color: '#f1f5f9', fontSize: 13 } };

/** Ficha técnica de un módulo: contorno EXACTO leído de los contornos oficiales
 *  (mismo archivo que pinta el mapa principal de GeoMonitor.tsx, mismo mapeo
 *  numeroGeojsonDeSRL — no la geometría simplificada de la Edge Function, que
 *  vive solo del lado servidor) + capa WMS NDVI Agro de fondo + histórico
 *  propio del módulo leído de ndvi_modulo_mensual_v2 (mediana mensual con máscara de nubes). */
export const NdviModuloDetalle: React.FC<NdviModuloDetalleProps> = ({ numeroModulo, instanceId, mes, onClose }) => {
    const dialogoRef = useRef<HTMLDivElement>(null);
    // Diálogo modal: foco inicial, Tab atrapado, Escape cierra y el foco vuelve a la tarjeta que lo abrió.
    useModalA11y(dialogoRef, true, onClose);

    const [contorno, setContorno] = useState<GeoJSON.Feature | null>(null);
    const [cargandoContorno, setCargandoContorno] = useState(true);
    const [filas, setFilas] = useState<FilaNdviSerie[]>([]);
    const [cargandoDatos, setCargandoDatos] = useState(true);
    const [reducir] = useState(() => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

    const color = COLOR_MODULO_SRL[numeroModulo] ?? '#94a3b8';
    const bbox = bboxDeModulo(numeroModulo);

    useEffect(() => {
        // El estado nace en `true` y la ficha se monta al abrirse: no hace falta re-fijarlo aquí (setState síncrono en efecto).
        let cancelado = false;
        cargarContornosModulos()
            .then((fc) => {
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
        cargarSerieNdviV2(supabase, numeroModulo).then(({ filas: v2, error }) => {
            if (cancelado) return;
            setFilas(error ? [] : filasDeSerie(v2));
            setCargandoDatos(false);
        });
        return () => { cancelado = true; };
    }, [numeroModulo]);

    // La ficha muestra el MES ELEGIDO en el panel; si el módulo no tiene dato ese mes queda S/D (no se usa el último mes).
    const mesFicha = mes || (filas.length ? filas[filas.length - 1].mes : '');
    const ultimo = filas.find(f => f.mes === mesFicha) ?? null;
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
        volumenAcumuladoPorModuloHm3(ultimo.mes, inicioCiclo(ultimo.mes)).then(({ porModulo, ultimoMesEsParcial }) => {
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

    // Año de la gráfica: el del mes elegido (o el último con dato); se puede cambiar.
    const [anioElegido, setAnioElegido] = useState<number | null>(null);
    const meses = useMemo(() => [...new Set(filas.map(f => f.mes))].sort(), [filas]);
    const anios = useMemo(() => aniosDeMeses(meses), [meses]);
    const anioGrafica = anioElegido != null && anios.includes(anioElegido) ? anioElegido : (mesFicha ? anioDe(mesFicha) : anios[anios.length - 1]);
    const previos = useMemo(() => anios.filter(a => a !== anioGrafica), [anios, anioGrafica]);
    const banda = useMemo(() => bandaMensual12(filas, numeroModulo, anios, anioGrafica), [filas, numeroModulo, anios, anioGrafica]);
    const conBanda = banda.every(b => b.p10 != null && b.p90 != null);
    const idxMes = mesFicha && anioDe(mesFicha) === anioGrafica ? Number(mesFicha.slice(5, 7)) - 1 : -1;

    const chartOption = useMemo(() => {
        const series: Record<string, unknown>[] = [];
        if (conBanda) {
            series.push({ name: 'base', type: 'line', stack: 'banda', symbol: 'none', silent: true, lineStyle: { opacity: 0 }, tooltip: { show: false }, data: banda.map(b => b.p10) });
            series.push({ name: 'Banda típica (p10–p90)', type: 'line', stack: 'banda', symbol: 'none', silent: true, lineStyle: { opacity: 0 }, tooltip: { show: false },
                areaStyle: { color: 'rgba(148,163,184,0.22)' }, data: banda.map(b => (b.p90 as number) - (b.p10 as number)) });
        }
        previos.forEach((a, i) => {
            const c = colorAnioPrevio(i, previos.length);
            series.push({ name: String(a), type: 'line', connectNulls: false, symbol: 'circle', symbolSize: 4, lineStyle: { width: 1.4, color: c }, itemStyle: { color: c }, z: 2,
                data: serieAnio12(filas, numeroModulo, a) });
        });
        series.push({
            name: String(anioGrafica), type: 'line', connectNulls: false, symbol: 'circle', symbolSize: 8, z: 5,
            lineStyle: { width: 3.5, color }, itemStyle: { color, borderColor: '#0f172a', borderWidth: 2 },
            data: serieAnio12(filas, numeroModulo, anioGrafica),
            markLine: {
                silent: true, symbol: 'none', animation: false, lineStyle: { color: '#fbbf24', type: 'dashed', width: 1 },
                label: { formatter: '0.30', color: '#fbbf24', fontSize: 12, position: 'insideEndTop' },
                data: [{ yAxis: UMBRAL_COBERTURA_ACTIVA }, ...(idxMes >= 0 ? [{ xAxis: MESES_CORTOS[idxMes], lineStyle: { color: '#e2e8f0', type: 'solid', width: 1 }, label: { show: false } }] : [])],
            },
        });
        return {
            backgroundColor: 'transparent', animation: !reducir,
            aria: { enabled: true, label: { description: `NDVI mensual del ${nombreModulo} en ${anioGrafica}, de enero a diciembre, con los años previos y su banda típica.` } },
            grid: { left: 46, right: 16, top: 12, bottom: 30 },
            tooltip: { trigger: 'axis', confine: true, ...FONDO_TOOLTIP, valueFormatter: (v: unknown) => (typeof v === 'number' ? v.toFixed(3) : 'S/D') },
            xAxis: ejeMeses(window.innerWidth < 600),
            yAxis: { type: 'value', min: NDVI_RANGO[0], max: NDVI_RANGO[1], interval: 0.2, axisLabel: { color: '#cbd5e1', fontSize: 12, formatter: (v: number) => v.toFixed(1) }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)' } } },
            series,
        };
    }, [filas, numeroModulo, anioGrafica, previos, banda, conBanda, color, idxMes, reducir, nombreModulo]);

    // ICV / IHR por mes del año mostrado (el IEHP necesita volumen mensual, que no existe: se queda en las tarjetas del mes).
    const opcionIndices = useMemo(() => {
        const base = { type: 'line', connectNulls: false, symbolSize: 7 };
        return {
            backgroundColor: 'transparent', animation: !reducir,
            aria: { enabled: true, label: { description: `ICV e IHR mensuales del ${nombreModulo} en ${anioGrafica}, escala de 0 a 100.` } },
            grid: { left: 46, right: 16, top: 34, bottom: 30 },
            legend: { top: 0, textStyle: { color: '#cbd5e1', fontSize: 12 }, itemWidth: 22 },
            tooltip: { trigger: 'axis', confine: true, ...FONDO_TOOLTIP, valueFormatter: (v: unknown) => (typeof v === 'number' ? String(v) : 'S/D') },
            xAxis: ejeMeses(window.innerWidth < 600),
            yAxis: { type: 'value', min: 0, max: 100, interval: 25, axisLabel: { color: '#cbd5e1', fontSize: 12 }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)' } } },
            series: [
                { ...base, name: 'ICV (condición vegetativa)', symbol: 'circle', lineStyle: { width: 2.5, color }, itemStyle: { color }, data: serieIndice12(filas, 'icv', anioGrafica) },
                { ...base, name: 'IHR (homogeneidad del riego)', symbol: 'rect', lineStyle: { width: 2, color: '#e2e8f0', type: 'dashed' }, itemStyle: { color: '#e2e8f0' }, data: serieIndice12(filas, 'ihr', anioGrafica) },
            ],
        };
    }, [filas, anioGrafica, color, reducir, nombreModulo]);

    const center: [number, number] = bbox ? [(bbox.minLat + bbox.maxLat) / 2, (bbox.minLon + bbox.maxLon) / 2] : [28, -105.4];
    const mesLegible = mesFicha ? `${MESES_LARGOS[Number(mesFicha.slice(5, 7)) - 1]} ${mesFicha.slice(0, 4)}` : 'sin mes';

    return (
        <div className="ndvi-detalle-overlay">
            <div className="ndvi-detalle-container animate-in-zoom" ref={dialogoRef} role="dialog" aria-modal="true" aria-labelledby="ndvi-detalle-titulo" tabIndex={-1}>
                <div className="ndvi-detalle-scroll">
                    <header className="ndvi-detalle-header">
                        <div className="ndvi-detalle-title-group">
                            <div className="ndvi-detalle-badge" style={{ color, borderColor: `${color}99` }}>Ficha técnica del módulo de riego</div>
                            <h2 id="ndvi-detalle-titulo">{nombreModulo}</h2>
                            <div className="ndvi-detalle-sub">Contorno oficial del módulo y capa NDVI Agro de Sentinel Hub</div>
                        </div>
                        <button type="button" className="ndvi-detalle-close" onClick={onClose} aria-label={`Cerrar la ficha del ${nombreModulo}`}><X size={20} aria-hidden="true" /></button>
                    </header>

                    <div className="ndvi-detalle-body">
                        <div className="ndvi-detalle-map-card glass">
                            <MapContainer center={center} zoom={11} className="ndvi-detalle-map" attributionControl={false} scrollWheelZoom={false}>
                                {instanceId && (
                                    <WMSTileLayer
                                        url={sentinelWmsUrl(instanceId)}
                                        params={wmsParams as unknown as WMSParams}
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
                                            data={contorno}
                                            style={{ color: '#ffffff', weight: 6, fillOpacity: 0, opacity: 0.9 }}
                                        />
                                        <GeoJSON
                                            key={`contorno-${numeroModulo}`}
                                            data={contorno}
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
                                    <span className="ndvi-detalle-stat-label"><Layers size={13} aria-hidden="true" /> NDVI (mediana)</span>
                                    <span className="ndvi-detalle-stat-value">{ultimo ? ultimo.ndvi_medio.toFixed(3) : 'S/D'}</span>
                                </div>
                                <div className="ndvi-detalle-stat">
                                    <span className="ndvi-detalle-stat-label"><Activity size={13} aria-hidden="true" /> Rango (mín–máx)</span>
                                    <span className="ndvi-detalle-stat-value">
                                        {ultimo && ultimo.ndvi_min != null && ultimo.ndvi_max != null
                                            ? `${ultimo.ndvi_min.toFixed(2)} – ${ultimo.ndvi_max.toFixed(2)}`
                                            : 'S/D'}
                                    </span>
                                </div>
                                <div className="ndvi-detalle-stat">
                                    <span className="ndvi-detalle-stat-label"><Ruler size={13} aria-hidden="true" /> Superficie</span>
                                    <span className="ndvi-detalle-stat-value">
                                        {ultimo?.superficie_ha != null ? `${ultimo.superficie_ha.toLocaleString()} ha` : 'S/D'}
                                    </span>
                                </div>
                                <div className="ndvi-detalle-stat">
                                    <span className="ndvi-detalle-stat-label"><MapPin size={13} aria-hidden="true" /> Desviación estándar</span>
                                    <span className="ndvi-detalle-stat-value">{ultimo?.ndvi_desv != null ? ultimo.ndvi_desv.toFixed(3) : 'S/D'}</span>
                                </div>
                                <div className="ndvi-detalle-stat">
                                    <span className="ndvi-detalle-stat-label"><CalendarRange size={13} aria-hidden="true" /> Ventana analizada</span>
                                    <span className="ndvi-detalle-stat-value ndvi-detalle-stat-value-sm">
                                        {ultimo?.ventana_desde && ultimo.ventana_hasta ? `${ultimo.ventana_desde.slice(0, 10)} → ${ultimo.ventana_hasta.slice(0, 10)}` : 'S/D'}
                                    </span>
                                </div>
                                <div className="ndvi-detalle-stat">
                                    <span className="ndvi-detalle-stat-label"><Activity size={13} aria-hidden="true" /> Muestras válidas</span>
                                    <span className="ndvi-detalle-stat-value">{ultimo?.muestras_validas?.toLocaleString() ?? 'S/D'}</span>
                                </div>
                                <div className="ndvi-detalle-stat">
                                    <span className="ndvi-detalle-stat-label"><Layers size={13} aria-hidden="true" /> Kc estimado (NDVI→Kc)</span>
                                    <span className="ndvi-detalle-stat-value">{ultimo?.kc_estimado != null ? ultimo.kc_estimado.toFixed(2) : 'S/D'}</span>
                                </div>
                                <div className="ndvi-detalle-stat">
                                    <span className="ndvi-detalle-stat-label"><Activity size={13} aria-hidden="true" /> Cambio contra el mes anterior</span>
                                    {ultimo?.delta_ndvi != null ? (
                                        <span className={`ndvi-detalle-stat-value ndvi-delta ${ultimo.delta_ndvi >= 0 ? 'ndvi-delta-sube' : 'ndvi-delta-baja'}`}>
                                            {ultimo.delta_ndvi >= 0 ? <TrendingUp size={16} aria-hidden="true" /> : <TrendingDown size={16} aria-hidden="true" />}
                                            {ultimo.delta_ndvi >= 0 ? '+' : '−'}{fmt(Math.abs(ultimo.delta_ndvi), 3)}
                                        </span>
                                    ) : <span className="ndvi-detalle-stat-value">S/D</span>}
                                </div>
                            </div>
                            <div className="ndvi-detalle-nota">
                                {mesFicha ? `Mes mostrado: ${mesFicha}. ` : ''}{ROTULO_METODO_NDVI}. Nubosidad máxima admitida: {ultimo?.nubosidad_max_pct ?? 40} %. Estadísticas
                                sobre el polígono exacto del módulo (Statistical API, Sentinel Hub): es la frontera del módulo, no una parcela, y sirve para comparar un año con otro.
                            </div>
                        </div>
                    </div>

                    <div className="ndvi-detalle-indices-card glass">
                        <div className="ndvi-detalle-chart-title">Índices institucionales del {nombreModulo}, {mesLegible}</div>
                        <div className="ndvi-detalle-indices-grid">
                            {indices.map(ix => (
                                <div key={ix.clave} className="ndvi-indice-card" style={{ borderColor: `${ix.color}55` }}>
                                    <div className="ndvi-indice-header">
                                        <span className="ndvi-indice-clave">{ix.clave}</span>
                                        <span className="ndvi-indice-etiqueta"><i style={{ background: ix.color }} aria-hidden="true" />{ix.etiqueta}</span>
                                    </div>
                                    <div className="ndvi-indice-valor">
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
                        <div className="ndvi-detalle-chart-cab">
                            <div className="ndvi-detalle-chart-title">NDVI mensual del {nombreModulo}</div>
                            {anios.length > 0 && <SelectorChips etiqueta="Año" valor={String(anioGrafica)} onChange={v => setAnioElegido(Number(v))} opciones={anios.map(a => ({ valor: String(a), texto: String(a) }))} />}
                        </div>
                        {cargandoDatos ? (
                            <div className="ndvi-detalle-vacio" role="status">Cargando histórico…</div>
                        ) : filas.length === 0 ? (
                            <div className="ndvi-detalle-vacio">Sin datos históricos para este módulo (S/D).</div>
                        ) : (
                            <>
                                <ReactECharts option={chartOption} className="ndvi-detalle-echarts" style={{ width: '100%' }} notMerge />
                                <p className="ndvi-nota">
                                    {anioGrafica} va en el color del módulo y los años previos en azules más finos.{' '}
                                    {conBanda ? 'La zona gris es la banda típica (p10–p90) de los otros años.' : 'Sin banda típica: hacen falta al menos 3 años de referencia en cada mes.'}{' '}
                                    La línea punteada ámbar es el NDVI 0.30 (cobertura activa). Un mes sin lectura queda como hueco.
                                </p>
                            </>
                        )}
                    </div>

                    {!cargandoDatos && filas.length > 0 && (
                        <div className="ndvi-detalle-chart-card glass">
                            <div className="ndvi-detalle-chart-title">ICV e IHR por mes, {anioGrafica}</div>
                            <ReactECharts option={opcionIndices} className="ndvi-detalle-echarts ndvi-detalle-echarts-bajo" style={{ width: '100%' }} notMerge />
                            <p className="ndvi-nota">El IEHP no se grafica por mes: necesita volumen entregado mensual, que no está cargado; se muestra solo en las tarjetas del mes. Un IHR de 0 no es falta de dato: con NDVI bajo, la dispersión iguala o supera al NDVI medio y el índice llega a su piso.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default NdviModuloDetalle;
