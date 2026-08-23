import React, { useMemo, useState, useEffect } from 'react';
import { Droplets, Gauge, Activity, AlertTriangle, TrendingUp, ChevronLeft, ChevronRight, Info, Satellite, RefreshCw, CalendarRange, FileText } from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import './PresaVasoMonitor.css';
import { detectaSuperficieVaso, type SuperficieVaso } from '../utils/mapaSatelital';
import { supabase } from '../lib/supabase';
import InformeVasoInstitucional from './InformeVasoInstitucional';

interface GeometriaVasoFila {
    fecha_escena: string;
    area_km2: number;
    perimetro_km: number;
    num_islas: number;
    ratio_elongacion: number | null;
    delta_area_km2: number | null;
    pct_del_maximo_ciclo: number | null;
    contorno_geojson: { type: 'Polygon'; coordinates: [number, number][][] };
}

interface CurvaPunto { elevacion_msnm: number; volumen_mm3: number; area_ha: number | null }

/** SVG "d" para un anillo GeoJSON [lon,lat][] proyectado a coordenadas de
 *  pantalla equirrectangulares, con corrección de aspecto por cos(latCentral)
 *  (a esta latitud 1° de longitud cubre menos distancia real que 1° de
 *  latitud — sin la corrección el vaso se ve estirado horizontalmente). */
function anilloASvgPath(
    anillo: [number, number][],
    bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number; cosLat: number },
    w: number,
    h: number
): string {
    const spanLon = (bbox.maxLon - bbox.minLon) * bbox.cosLat;
    const spanLat = bbox.maxLat - bbox.minLat;
    const escala = Math.min(w / spanLon, h / spanLat);
    const offX = (w - spanLon * escala) / 2;
    const offY = (h - spanLat * escala) / 2;
    const pts = anillo.map(([lon, lat]) => {
        const x = offX + (lon - bbox.minLon) * bbox.cosLat * escala;
        const y = offY + (bbox.maxLat - lat) * escala; // Y invertida: lat mayor = arriba
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M${pts.join('L')}Z`;
}

/** Bbox equirrectangular común a partir de N anillos exteriores GeoJSON, con
 *  margen del 10% — usado tanto por el mini-mapa de 2 fechas como por la
 *  galería mensual, para que todos los contornos de una misma presa se
 *  dibujen sobre el mismo marco y sean comparables entre sí a simple vista. */
function calculaBboxComun(anillosExteriores: [number, number][][]) {
    const lons = anillosExteriores.flat().map(([lon]) => lon);
    const lats = anillosExteriores.flat().map(([, lat]) => lat);
    const minLonRaw = Math.min(...lons), maxLonRaw = Math.max(...lons);
    const minLatRaw = Math.min(...lats), maxLatRaw = Math.max(...lats);
    const margenLon = (maxLonRaw - minLonRaw) * 0.1 || 0.01;
    const margenLat = (maxLatRaw - minLatRaw) * 0.1 || 0.01;
    return {
        minLon: minLonRaw - margenLon, maxLon: maxLonRaw + margenLon,
        minLat: minLatRaw - margenLat, maxLat: maxLatRaw + margenLat,
        cosLat: Math.cos((minLatRaw + maxLatRaw) / 2 * Math.PI / 180),
    };
}

/** Un solo "d" con todos los anillos del polígono (exterior + islas) para
 *  dibujar con fill-rule="evenodd" en un único <path> — así las islas se
 *  recortan del relleno del cuerpo de agua en vez de sobre-pintarse. */
function poligonoASvgPath(
    coordinates: [number, number][][],
    bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number; cosLat: number },
    w: number,
    h: number,
    areaMinIslaPx2 = 6
): string {
    return coordinates
        .map((anillo, i) => {
            if (i === 0) return anilloASvgPath(anillo, bbox, w, h);
            // Islas: descarta las que quedarían microscópicas al dibujar,
            // para no saturar el mini-mapa con puntos ilegibles.
            const path = anilloASvgPath(anillo, bbox, w, h);
            const xs = anillo.map(([lon]) => lon);
            const spanLonPx = (Math.max(...xs) - Math.min(...xs)) * bbox.cosLat * Math.min(w / ((bbox.maxLon - bbox.minLon) * bbox.cosLat), h / (bbox.maxLat - bbox.minLat));
            return spanLonPx * spanLonPx >= areaMinIslaPx2 ? path : '';
        })
        .filter(Boolean)
        .join(' ');
}

// presa_id (tabla `presas`) → nombre usado en VASOS_CONOCIDOS (mapaSatelital.ts).
// Antes GeoMonitor comparaba contra el literal 'BOQUILLA', que nunca coincide
// con el presa_id real ('PRE-001'/'PRE-002') — ver informe de auditoría.
const NOMBRE_VASO_POR_PRESA_ID: Record<string, string> = {
    'PRE-001': 'La Boquilla',
    'PRE-002': 'Fco. I. Madero',
};

interface PresaVasoMonitorProps {
    data: {
        nombre: string;
        nivel_msnm: number | null;
        almacenamiento_mm3: number;
        porcentaje: number;
        extraccion_m3s: number;
        nivel_nma: number | null; // Nivel Máximo de Aguas — de elevacion_corona_msnm si no hay NAME propio
        capacidad_total: number | null;
        presa_id: string;
        curva?: CurvaPunto[];
    };
    /** Qué sección enfocar al abrir: 'satelital' (NDWI del día, default) o
     *  'ciclo' (comparativa mensual histórica) — evita que el usuario tenga
     *  que bajar manualmente en un modal largo cuando entra desde el botón
     *  dedicado "Evolución del Ciclo". */
    seccionInicial?: 'satelital' | 'ciclo';
    onClose: () => void;
}

// Interpola volumen (Mm3) para una elevación dada usando la curva real de la
// presa (curvas_capacidad). Si no hay curva, retorna null — nunca un número
// inventado (antes: factor Mm3/metro hardcodeado por presa_id).
function volumenPorElevacion(curva: CurvaPunto[] | undefined, elevacion: number): number | null {
    if (!curva || curva.length < 2) return null;
    const pts = [...curva].sort((a, b) => a.elevacion_msnm - b.elevacion_msnm);
    if (elevacion <= pts[0].elevacion_msnm) return pts[0].volumen_mm3;
    if (elevacion >= pts[pts.length - 1].elevacion_msnm) return pts[pts.length - 1].volumen_mm3;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (elevacion >= a.elevacion_msnm && elevacion <= b.elevacion_msnm) {
            const t = (elevacion - a.elevacion_msnm) / (b.elevacion_msnm - a.elevacion_msnm);
            return a.volumen_mm3 + t * (b.volumen_mm3 - a.volumen_mm3);
        }
    }
    return null;
}

export const PresaVasoMonitor: React.FC<PresaVasoMonitorProps> = ({ data, seccionInicial = 'satelital', onClose }) => {
    const tieneNivel = data.nivel_msnm !== null;
    const tieneCurva = (data.curva?.length ?? 0) >= 2;

    // Estado para simulación interactiva — arranca en el nivel real si existe,
    // o en 0 (deshabilitado) si no hay lectura del día.
    const [simNivel, setSimNivel] = useState(data.nivel_msnm ?? 0);

    // Cálculos dinámicos basados en el nivel. Usa la curva real elevación→volumen
    // de la presa (curvas_capacidad) cuando está disponible; si no, no inventa un
    // factor Mm3/metro — el volumen simulado se muestra como "S/D".
    const stats = useMemo(() => {
        const diff = data.nivel_msnm !== null ? simNivel - data.nivel_msnm : 0;
        const nuevoAlmacenamiento = tieneCurva
            ? volumenPorElevacion(data.curva, simNivel)
            : (Math.abs(diff) < 0.001 ? data.almacenamiento_mm3 : null);
        const nuevoPorcentaje = (nuevoAlmacenamiento !== null && data.capacidad_total)
            ? Math.min(100, (nuevoAlmacenamiento / data.capacidad_total) * 100)
            : null;

        // Área expuesta (simulación visual, solo si hay NMA de referencia)
        const areaExpuestaFactor = data.nivel_nma !== null ? Math.max(0, data.nivel_nma - simNivel) * 12 : 0;

        return {
            almacenamiento: nuevoAlmacenamiento,
            porcentaje: nuevoPorcentaje,
            areaExpuesta: areaExpuestaFactor,
            isSimulated: Math.abs(diff) > 0.01
        };
    }, [simNivel, data, tieneCurva]);

    // Manejo de Vaso (Fase 2, auditoría ago-2026): superficie de agua estimada
    // por NDWI sobre imagen satelital reciente, para comparar contra la captura
    // diaria real (porcentaje_llenado) — antes esto no existía, el visor solo
    // mostraba una foto fija de una sola fecha (boquilla_5marzo.webp) sin
    // importar la presa ni el día seleccionados.
    const nombreVaso = NOMBRE_VASO_POR_PRESA_ID[data.presa_id];
    const [superficieVaso, setSuperficieVaso] = useState<SuperficieVaso | null>(null);
    const [cargandoNdwi, setCargandoNdwi] = useState(false);
    const [errorNdwi, setErrorNdwi] = useState(false);

    const cargarSuperficie = React.useCallback(() => {
        if (!nombreVaso) return;
        setCargandoNdwi(true);
        setErrorNdwi(false);
        detectaSuperficieVaso(nombreVaso)
            .then(res => {
                if (res) setSuperficieVaso(res);
                else setErrorNdwi(true);
            })
            .catch(() => setErrorNdwi(true))
            .finally(() => setCargandoNdwi(false));
    }, [nombreVaso]);

    useEffect(() => {
        cargarSuperficie();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.presa_id]);

    // Manejo de Vaso — histórico mensual (Fase 3): a diferencia del NDWI de
    // arriba (recalculado en el cliente cada vez que se abre el modal, sin
    // memoria de meses anteriores), esto lee vaso_geometria_historico —
    // poblada por el cron mensual sentinel-ndwi-vaso-sync, ya con área,
    // perímetro y KPI derivados calculados server-side. Comparativa
    // apertura-de-ciclo vs. más reciente + serie mensual de área/perímetro.
    const [historicoVaso, setHistoricoVaso] = useState<GeometriaVasoFila[]>([]);
    const [cargandoHistorico, setCargandoHistorico] = useState(false);

    useEffect(() => {
        let cancelado = false;
        setCargandoHistorico(true);
        supabase
            .from('vaso_geometria_historico')
            .select('fecha_escena, area_km2, perimetro_km, num_islas, ratio_elongacion, delta_area_km2, pct_del_maximo_ciclo, contorno_geojson')
            .eq('presa_id', data.presa_id)
            .order('fecha_escena', { ascending: true })
            .then(({ data: filas, error }) => {
                if (cancelado) return;
                setHistoricoVaso(error || !filas ? [] : (filas as GeometriaVasoFila[]));
                setCargandoHistorico(false);
            });
        return () => { cancelado = true; };
    }, [data.presa_id]);

    const primeraDelCiclo = historicoVaso[0] ?? null;
    const masReciente = historicoVaso.length ? historicoVaso[historicoVaso.length - 1] : null;

    // Selección de los dos meses a comparar en el mini-mapa y las tarjetas —
    // por defecto apertura de ciclo (0) vs. más reciente (último índice),
    // pero el usuario puede elegir cualquier otro par ya presente en
    // historicoVaso. Se reinicia cuando cambia la presa o llega un nuevo
    // largo de histórico (evita índices fuera de rango).
    const [idxBase, setIdxBase] = useState(0);
    const [idxComparado, setIdxComparado] = useState(0);
    useEffect(() => {
        if (!historicoVaso.length) return;
        setIdxBase(0);
        setIdxComparado(historicoVaso.length - 1);
    }, [data.presa_id, historicoVaso.length]);

    const filaBase = historicoVaso[idxBase] ?? primeraDelCiclo;
    const filaComparada = historicoVaso[idxComparado] ?? masReciente;
    const deltaAreaCiclo = filaBase && filaComparada ? filaComparada.area_km2 - filaBase.area_km2 : null;
    const deltaPerimetroCiclo = filaBase && filaComparada ? filaComparada.perimetro_km - filaBase.perimetro_km : null;

    const opcionesSerieMensual = useMemo(() => {
        if (!historicoVaso.length) return null;
        const fechas = historicoVaso.map(f =>
            new Date(f.fecha_escena).toLocaleDateString('es-MX', { month: 'short', year: '2-digit', timeZone: 'America/Chihuahua' })
        );
        return {
            grid: { left: 50, right: 50, top: 30, bottom: 30 },
            tooltip: { trigger: 'axis' },
            legend: { data: ['Área (km²)', 'Perímetro (km)'], textStyle: { color: '#94a3b8', fontSize: 10 }, top: 0 },
            xAxis: { type: 'category', data: fechas, axisLabel: { color: '#64748b', fontSize: 10 } },
            yAxis: [
                { type: 'value', name: 'km²', position: 'left', axisLabel: { color: '#22d3ee', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.1)' } } },
                { type: 'value', name: 'km', position: 'right', axisLabel: { color: '#a78bfa', fontSize: 10 }, splitLine: { show: false } },
            ],
            series: [
                {
                    name: 'Área (km²)', type: 'line', yAxisIndex: 0, smooth: true,
                    data: historicoVaso.map(f => f.area_km2),
                    lineStyle: { color: '#22d3ee', width: 2 },
                    itemStyle: { color: '#22d3ee' },
                    areaStyle: { color: 'rgba(34,211,238,0.08)' },
                    // Un hueco en la serie (mes sin dato confiable) debe verse
                    // como corte, no como interpolación silenciosa — echarts
                    // ya rompe la línea en null por defecto sin config extra.
                    connectNulls: false,
                },
                {
                    name: 'Perímetro (km)', type: 'line', yAxisIndex: 1, smooth: true,
                    data: historicoVaso.map(f => f.perimetro_km),
                    lineStyle: { color: '#a78bfa', width: 2, type: 'dashed' },
                    itemStyle: { color: '#a78bfa' },
                    connectNulls: false,
                },
            ],
        };
    }, [historicoVaso]);

    // Mini-mapa comparativo (apertura de ciclo vs. más reciente): un solo
    // SVG con ambos contornos superpuestos sobre un bbox común (unión de los
    // dos anillos exteriores + margen), en vez de Leaflet — evita cargar un
    // mapa interactivo completo para mostrar dos siluetas fijas dentro de un
    // modal ya largo.
    const mapaComparativo = useMemo(() => {
        if (!filaBase || !filaComparada) return null;
        const W = 640, H = 380;
        const bbox = calculaBboxComun([filaBase.contorno_geojson.coordinates[0], filaComparada.contorno_geojson.coordinates[0]]);
        return {
            W, H,
            pathBase: poligonoASvgPath(filaBase.contorno_geojson.coordinates, bbox, W, H),
            pathComparado: poligonoASvgPath(filaComparada.contorno_geojson.coordinates, bbox, W, H),
        };
    }, [filaBase, filaComparada]);

    // Galería mensual: un mini-mapa por cada mes del histórico, todos sobre
    // el MISMO bbox (unión de todos los meses, no solo 2) para que la
    // progresión completa del ciclo se pueda comparar a simple vista en una
    // tira horizontal, sin tener que elegir pares uno a uno.
    const galeriaMensual = useMemo(() => {
        if (historicoVaso.length < 1) return null;
        const W = 220, H = 150;
        const bbox = calculaBboxComun(historicoVaso.map(f => f.contorno_geojson.coordinates[0]));
        return historicoVaso.map(f => ({
            fecha_escena: f.fecha_escena,
            area_km2: f.area_km2,
            perimetro_km: f.perimetro_km,
            path: poligonoASvgPath(f.contorno_geojson.coordinates, bbox, W, H),
            W, H,
        }));
    }, [historicoVaso]);

    // Informe institucional (SRL Conchos / SICA 005): documento HTML compartible
    // con tendencia, polígonos y KPIs de todo el histórico de la presa —
    // reutiliza los mismos datos ya cargados en historicoVaso, sin fetch propio.
    const [mostrarInforme, setMostrarInforme] = useState(false);

    // Scroll automático a la sección de ciclo cuando se entra por el botón
    // dedicado "Evolución del Ciclo" — el modal es largo (varias secciones
    // apiladas) y sin esto el usuario tendría que bajar manualmente cada vez.
    const seccionCicloRef = React.useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (seccionInicial === 'ciclo' && seccionCicloRef.current) {
            seccionCicloRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        // Se dispara una sola vez al montar con esta prop — no en cada
        // render, para no pelear con el scroll manual del usuario después.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="vaso-screen-overlay">
            <div className="vaso-container animate-in-zoom">
                {/* Background Satellite Image with Dynamic Mask.
                    Fase 2: usa el recorte NDWI reciente del vaso (detectaSuperficieVaso)
                    cuando está disponible; antes era siempre la misma foto fija de una
                    sola fecha (boquilla_5marzo.webp), sin importar presa ni día. */}
                <div className="vaso-map-bg">
                    <img
                        src={superficieVaso?.dataURI || '/boquilla_5marzo.webp'}
                        alt={`Vaso de la Presa ${data.nombre} - Imagen Satelital`}
                        className="vaso-base-img"
                        style={{ filter: `brightness(${0.4 + ((stats.porcentaje ?? 50) / 200)}) contrast(1.1)` }}
                    />

                    {/* SVG MASK INTERACTIVA: Simula el espejo de agua moviéndose */}
                    <svg className="vaso-water-mask" viewBox="0 0 1000 600" preserveAspectRatio="none">
                        <defs>
                            <filter id="glow">
                                <feGaussianBlur stdDeviation="5" result="coloredBlur" />
                                <feMerge>
                                    <feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                        </defs>
                        <path
                            d="M150,300 Q300,150 500,200 T850,300 Q700,450 500,400 T150,300"
                            fill="rgba(34, 211, 238, 0.2)"
                            stroke="#22d3ee"
                            strokeWidth="2"
                            style={{
                                transform: `scale(${0.5 + ((stats.porcentaje ?? 50) / 180)})`,
                                transformOrigin: 'center',
                                transition: 'all 0.5s ease-out',
                                filter: 'url(#glow)'
                            }}
                        />
                    </svg>

                    <div className="vaso-scanline"></div>

                    {/* Ancla visual fija sobre la imagen satelital de fondo — vive
                        aquí (no dentro de vaso-scroll-content) porque su top:50%
                        se referencia contra el viewport del modal, no contra la
                        altura acumulada del contenido apilable. */}
                    <div className="vaso-map-tag tag-cortina" style={{ top: '50%', left: '88%' }}>
                        <div className="tag-line"></div>
                        <div className="tag-content">CORTINA</div>
                    </div>
                </div>

                {/* UI OVERLAYS — envueltas en un contenedor scrolleable: antes
                    vaso-container tenía overflow:hidden y altura fija (90vh),
                    así que con 5+ secciones apiladas (simulador, KPIs, análisis
                    técnico, NDWI, evolución de ciclo) el contenido que excedía
                    la altura visible se cortaba sin ningún scroll posible —
                    causa real de que la sección nueva de "Evolución del Ciclo"
                    fuera invisible sin importar cuánto se bajara. El fondo
                    satelital (vaso-map-bg) queda fuera de este contenedor para
                    seguir cubriendo todo el modal como fondo fijo. */}
                <div className="vaso-scroll-content">
                <header className="vaso-header">
                    <div className="vaso-title-group">
                        <div className="vaso-badge">SITUACIÓN E INTERACTIVIDAD DE VASO</div>
                        <h2>{data.nombre.toUpperCase()}</h2>
                        <div className="vaso-coords">
                            LECTURA OFICIAL: {tieneNivel ? `${data.nivel_msnm!.toFixed(2)} msnm` : 'S/D — sin lectura del día'}
                        </div>
                    </div>
                    <button className="vaso-close" onClick={onClose}>×</button>
                </header>

                {/* CONTROLES DE SIMULACIÓN INTERACTIVA — deshabilitado sin lectura real de ancla */}
                <div className="vaso-sim-controls glass">
                    <div className="sim-header">
                        <Activity size={16} /> SIMULADOR DE IMPACTO HIDRÁULICO
                    </div>
                    <div className="sim-body">
                        {!tieneNivel ? (
                            <div className="sim-value-display" style={{ opacity: 0.6 }}>
                                Sin lectura oficial del día — simulador no disponible.
                            </div>
                        ) : (
                            <>
                                <div className="sim-slider-group">
                                    <label>Ajustar Nivel Manualmente (msnm)</label>
                                    <div className="sim-input-row">
                                        <button onClick={() => setSimNivel(s => s - 0.5)}><ChevronLeft /></button>
                                        <input
                                            type="range"
                                            min={data.nivel_msnm! - 10}
                                            max={(data.nivel_nma ?? data.nivel_msnm! + 5) + 2}
                                            step="0.1"
                                            value={simNivel}
                                            onChange={(e) => setSimNivel(parseFloat(e.target.value))}
                                        />
                                        <button onClick={() => setSimNivel(s => s + 0.5)}><ChevronRight /></button>
                                    </div>
                                    <div className="sim-value-display">
                                        <strong>{(simNivel ?? 0).toFixed(2)}</strong> <small>msnm</small>
                                    </div>
                                </div>
                                {stats.isSimulated && (
                                    <button className="sim-reset-btn" onClick={() => setSimNivel(data.nivel_msnm!)}>
                                        Restablecer a Lectura Real
                                    </button>
                                )}
                                {!tieneCurva && (
                                    <div className="sim-value-display" style={{ fontSize: 10, opacity: 0.6, marginTop: 6 }}>
                                        Sin curva elevación-capacidad cargada para esta presa: el volumen simulado no se puede estimar.
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* KPI SQUARES (DINÁMICOS) */}
                <div className="vaso-stats-grid">
                    <div className={clsx('vaso-stat-card glass', stats.isSimulated && 'simulated-highlight')}>
                        <div className="vaso-stat-label">
                            <Gauge size={14} /> VOLUMEN {stats.isSimulated ? 'INTERACTIVO' : 'REGISTRADO'}
                        </div>
                        <div className="vaso-stat-value">
                            {stats.almacenamiento !== null ? stats.almacenamiento.toLocaleString(undefined, { maximumFractionDigits: 1 }) : 'S/D'} <small>Mm³</small>
                        </div>
                        <div className="vaso-stat-footer">
                            CAP. TOTAL: {data.capacidad_total !== null ? `${data.capacidad_total} Mm³` : 'S/D'}
                        </div>
                    </div>

                    <div className="vaso-stat-card glass">
                        <div className="vaso-stat-label">
                            <Droplets size={14} /> PORCENTAJE LLENADO
                        </div>
                        <div className="vaso-stat-value">
                            {stats.porcentaje !== null ? stats.porcentaje.toFixed(1) : 'S/D'} <small>{stats.porcentaje !== null ? '%' : ''}</small>
                        </div>
                        <div className="vaso-stat-progress">
                            <div className="vaso-progress-bar">
                                <div className="vaso-progress-fill" style={{ width: `${stats.porcentaje ?? 0}%` }}></div>
                            </div>
                        </div>
                    </div>

                    <div className="vaso-stat-card glass">
                        <div className="vaso-stat-label">
                            <Info size={14} /> ESTADO DEL EMBALSE
                        </div>
                        <div className="vaso-stat-value" style={{ fontSize: '1.5rem', marginTop: '10px' }}>
                            {stats.porcentaje === null ? 'S/D' : stats.porcentaje < 20 ? 'CRÍTICO' : stats.porcentaje < 40 ? 'BAJO' : 'NORMAL'}
                        </div>
                        <div className="vaso-stat-footer status-active">
                            <span className="pulse-dot"></span> MONITOREO ACTIVO
                        </div>
                    </div>
                </div>

                {/* ANALYTICS: PERFIL DE IMPACTO */}
                <div className="vaso-analytics glass">
                    <div className="vaso-analytics-header">
                        <TrendingUp size={16} /> ANÁLISIS TÉCNICO DE SUPERFICIE
                    </div>
                    <div className="vaso-analytics-body">
                        <div className="vaso-alert-box">
                            <AlertTriangle size={20} className={stats.porcentaje !== null && stats.porcentaje < 30 ? 'text-red-500' : 'text-amber-500'} />
                            <div className="vaso-alert-text">
                                {stats.isSimulated ? (
                                    <span>Simulando impacto de <strong>{(simNivel - (data.nivel_msnm ?? 0)).toFixed(2)}m</strong> sobre la lectura base de hoy.</span>
                                ) : tieneNivel ? (
                                    <span>Situación operativa estable basada en el aforo de entrada de la SRL.</span>
                                ) : (
                                    <span>Todavía no se ha capturado la lectura de nivel de hoy en campo.</span>
                                )}
                            </div>
                        </div>
                        {data.nivel_nma !== null && (
                            <div className="vaso-prediction">
                                Diferencia vs NMA: <strong>{(data.nivel_nma - simNivel).toFixed(2)}m</strong> de "anillo de sequía" expuesto.
                            </div>
                        )}
                    </div>
                </div>

                {/* VISTA RÁPIDA DE SUPERFICIE — recalculada en el cliente cada
                    vez que se abre el modal, sin memoria de meses anteriores.
                    Badge "APROXIMADO" la distingue de la sección de abajo, que
                    usa geometría validada y persistida server-side. */}
                <div className="vaso-analytics glass">
                    <div className="vaso-analytics-header">
                        <Satellite size={16} /> VISTA RÁPIDA DE SUPERFICIE — ESTIMACIÓN EN VIVO
                        <span className="vaso-confiabilidad-badge aproximado">APROXIMADO</span>
                        <button
                            className="sim-reset-btn"
                            style={{ marginLeft: 'auto', padding: '4px 10px' }}
                            onClick={cargarSuperficie}
                            disabled={cargandoNdwi || !nombreVaso}
                            title="Recalcular superficie de agua por imagen satelital reciente"
                        >
                            <RefreshCw size={12} className={cargandoNdwi ? 'animate-spin' : ''} />
                        </button>
                    </div>
                    <div className="vaso-analytics-body">
                        {!nombreVaso ? (
                            <div className="vaso-prediction" style={{ opacity: 0.6 }}>
                                Esta presa no tiene coordenadas de vaso configuradas para detección satelital.
                            </div>
                        ) : cargandoNdwi ? (
                            <div className="vaso-prediction" style={{ opacity: 0.7 }}>Analizando imagen satelital reciente…</div>
                        ) : errorNdwi ? (
                            <div className="vaso-prediction" style={{ opacity: 0.7 }}>
                                No hay una imagen satelital reciente y despejada para esta presa — vuelve a intentarlo
                                en unos minutos o consulta la evolución del ciclo abajo, que sí conserva meses pasados.
                            </div>
                        ) : superficieVaso ? (
                            <>
                                <div className="vaso-ndwi-compare">
                                    <div className="vaso-ndwi-col">
                                        <span className="vaso-ndwi-label">Superficie estimada (hoy)</span>
                                        <span className="vaso-ndwi-value">{superficieVaso.areaKm2.toFixed(1)} <small>km²</small></span>
                                    </div>
                                    <div className="vaso-ndwi-col">
                                        <span className="vaso-ndwi-label">Llenado capturado (campo)</span>
                                        <span className="vaso-ndwi-value">
                                            {stats.porcentaje !== null ? stats.porcentaje.toFixed(1) : 'S/D'} <small>{stats.porcentaje !== null ? '%' : ''}</small>
                                        </span>
                                    </div>
                                </div>
                                <div className="vaso-prediction" style={{ fontSize: 10.5, opacity: 0.65, marginTop: 8 }}>
                                    Cálculo rápido sobre imaginería visual (ArcGIS World Imagery, sin banda infrarroja real) —
                                    útil como referencia del día, no como medición certificada. Cobertura de imagen: {(superficieVaso.cobertura * 100).toFixed(0)}%.
                                    Para cifras validadas por sensor multiespectral, ver la evolución del ciclo abajo.
                                </div>
                            </>
                        ) : null}
                    </div>
                </div>

                {/* EVOLUCIÓN DEL VASO — HISTÓRICO VALIDADO (Fase 3): comparativa
                    apertura de ciclo vs. más reciente + serie de área/perímetro
                    por mes, leída de vaso_geometria_historico (poblada por el
                    cron mensual sentinel-ndwi-vaso-sync). A diferencia de la
                    vista rápida de arriba, esto tiene memoria de meses pasados
                    y usa geometría vectorizada y validada (marching squares +
                    tabla de Bourke) sobre banda infrarroja real de Sentinel-2. */}
                <div className="vaso-analytics glass" ref={seccionCicloRef}>
                    <div className="vaso-analytics-header">
                        <CalendarRange size={16} /> EVOLUCIÓN DEL VASO — HISTÓRICO VALIDADO (SENTINEL-2)
                        <span className="vaso-confiabilidad-badge validado">VALIDADO</span>
                        {historicoVaso.length > 0 && (
                            <button
                                className="sim-reset-btn"
                                style={{ marginLeft: 'auto', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6 }}
                                onClick={() => setMostrarInforme(true)}
                                title="Generar informe institucional SRL Conchos / SICA 005"
                            >
                                <FileText size={12} /> Informe Institucional
                            </button>
                        )}
                    </div>
                    <div className="vaso-analytics-body" style={{ gridTemplateColumns: '1fr' }}>
                        {cargandoHistorico ? (
                            <div className="vaso-prediction" style={{ opacity: 0.7 }}>Cargando histórico de vaso…</div>
                        ) : !historicoVaso.length ? (
                            <div className="vaso-prediction" style={{ opacity: 0.6 }}>
                                Todavía no hay meses registrados para esta presa — el sincronizador mensual de Sentinel-2
                                empezará a llenar esta línea de tiempo con la próxima escena despejada disponible.
                            </div>
                        ) : (
                            <>
                                {galeriaMensual && (
                                    <div className="vaso-galeria-mensual">
                                        <div className="vaso-galeria-titulo">Una imagen por mes, todas sobre el mismo encuadre</div>
                                        <div className="vaso-galeria-tira">
                                            {galeriaMensual.map((mes) => (
                                                <div className="vaso-galeria-item" key={mes.fecha_escena}>
                                                    <svg viewBox={`0 0 ${mes.W} ${mes.H}`} width="100%" height="auto" role="img"
                                                        aria-label={`Contorno del vaso en ${new Date(mes.fecha_escena).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}`}>
                                                        <rect x="0" y="0" width={mes.W} height={mes.H} fill="rgba(255,255,255,0.02)" />
                                                        <path d={mes.path} fill="rgba(34,211,238,0.22)" stroke="#22d3ee" strokeWidth="1.5" fillRule="evenodd" />
                                                    </svg>
                                                    <div className="vaso-galeria-fecha">
                                                        {new Date(mes.fecha_escena).toLocaleDateString('es-MX', { month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' })}
                                                    </div>
                                                    <div className="vaso-galeria-kpi">{mes.area_km2.toFixed(1)} km²</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="vaso-prediction" style={{ fontSize: 12, opacity: 0.85, marginBottom: '1rem' }}>
                                    Para más detalle, compara cualquier par de meses entre sí — por defecto, apertura del
                                    ciclo agrícola contra la imagen más reciente disponible.
                                </div>

                                {historicoVaso.length > 1 && (
                                    <div className="vaso-mes-selectores">
                                        <label className="vaso-mes-selector">
                                            <span>Comparar desde</span>
                                            <select value={idxBase} onChange={(e) => setIdxBase(Number(e.target.value))}>
                                                {historicoVaso.map((f, i) => (
                                                    <option key={f.fecha_escena} value={i}>
                                                        {new Date(f.fecha_escena).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'America/Chihuahua' })}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className="vaso-mes-selector">
                                            <span>Hasta</span>
                                            <select value={idxComparado} onChange={(e) => setIdxComparado(Number(e.target.value))}>
                                                {historicoVaso.map((f, i) => (
                                                    <option key={f.fecha_escena} value={i}>
                                                        {new Date(f.fecha_escena).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'America/Chihuahua' })}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>
                                )}

                                {mapaComparativo && filaBase && filaComparada && (
                                    <div className="vaso-mapa-comparativo">
                                        <svg viewBox={`0 0 ${mapaComparativo.W} ${mapaComparativo.H}`} width="100%" height="auto" role="img"
                                            aria-label={`Contorno del vaso en ${new Date(filaBase.fecha_escena).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })} comparado con ${new Date(filaComparada.fecha_escena).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}`}>
                                            <path d={mapaComparativo.pathBase} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="6 4" fillRule="evenodd" />
                                            <path d={mapaComparativo.pathComparado} fill="rgba(34,211,238,0.18)" stroke="#22d3ee" strokeWidth="2.5" fillRule="evenodd" />
                                        </svg>
                                        <div className="vaso-mapa-leyenda">
                                            <span className="leyenda-item">
                                                <span className="leyenda-swatch marzo"></span>
                                                {new Date(filaBase.fecha_escena).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' })}
                                            </span>
                                            <span className="leyenda-item">
                                                <span className="leyenda-swatch reciente"></span>
                                                {new Date(filaComparada.fecha_escena).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' })}
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {filaBase && filaComparada && (
                                    <div className="vaso-ndwi-compare" style={{ marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                                        <div className="vaso-ndwi-col">
                                            <span className="vaso-ndwi-label">
                                                {new Date(filaBase.fecha_escena).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' })}
                                            </span>
                                            <span className="vaso-ndwi-value">{filaBase.area_km2.toFixed(1)} <small>km²</small></span>
                                            <span className="vaso-ndwi-label" style={{ fontWeight: 500, textTransform: 'none' }}>
                                                perímetro {filaBase.perimetro_km.toFixed(0)} km
                                                {filaBase.num_islas > 0 && ` · ${filaBase.num_islas} banco${filaBase.num_islas === 1 ? '' : 's'} de tierra expuestos`}
                                            </span>
                                        </div>
                                        <div className="vaso-ndwi-col">
                                            <span className="vaso-ndwi-label">
                                                {new Date(filaComparada.fecha_escena).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' })}
                                            </span>
                                            <span className="vaso-ndwi-value">{filaComparada.area_km2.toFixed(1)} <small>km²</small></span>
                                            <span className="vaso-ndwi-label" style={{ fontWeight: 500, textTransform: 'none' }}>
                                                perímetro {filaComparada.perimetro_km.toFixed(0)} km
                                                {filaComparada.num_islas > 0 && ` · ${filaComparada.num_islas} banco${filaComparada.num_islas === 1 ? '' : 's'} de tierra expuestos`}
                                            </span>
                                        </div>
                                        {deltaAreaCiclo !== null && deltaPerimetroCiclo !== null && (
                                            <div className="vaso-ndwi-col">
                                                <span className="vaso-ndwi-label">Variación entre ambos meses</span>
                                                <span className="vaso-ndwi-value" style={{ color: deltaAreaCiclo < 0 ? '#f59e0b' : '#10b981', fontSize: '1.1rem' }}>
                                                    {deltaAreaCiclo >= 0 ? '+' : ''}{deltaAreaCiclo.toFixed(1)} km²
                                                </span>
                                                <span className="vaso-ndwi-label" style={{ fontWeight: 500, textTransform: 'none' }}>
                                                    perímetro {deltaPerimetroCiclo >= 0 ? '+' : ''}{deltaPerimetroCiclo.toFixed(0)} km
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {filaComparada?.pct_del_maximo_ciclo !== null && filaComparada?.pct_del_maximo_ciclo !== undefined && (
                                    <div className="vaso-prediction" style={{ fontSize: 11.5, opacity: 0.8, marginBottom: '1rem' }}>
                                        La superficie del mes de llegada equivale al <strong>{filaComparada.pct_del_maximo_ciclo.toFixed(0)}%</strong> del
                                        máximo alcanzado por el vaso en lo que va del ciclo agrícola.
                                    </div>
                                )}

                                {opcionesSerieMensual && (
                                    <ReactECharts option={opcionesSerieMensual} style={{ height: '220px', width: '100%' }} opts={{ renderer: 'svg' }} />
                                )}
                                <div className="vaso-prediction" style={{ fontSize: 10.5, opacity: 0.65, marginTop: 8 }}>
                                    Área neta (bancos de tierra excluidos) y perímetro real vía NDWI de Sentinel-2 (10-20m/pixel),
                                    vectorizado con marching squares. Un hueco en la línea indica un mes sin escena confiable
                                    por nubosidad excesiva — nunca se registra como cero.
                                </div>
                            </>
                        )}
                    </div>
                </div>

                </div>
            </div>

            {mostrarInforme && (
                <InformeVasoInstitucional
                    nombrePresa={data.nombre}
                    historico={historicoVaso}
                    onClose={() => setMostrarInforme(false)}
                />
            )}
        </div>
    );
};

const clsx = (...classes: any[]) => classes.filter(Boolean).join(' ');
