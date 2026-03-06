import { Map as MapIcon, Activity, Crosshair, Layers, Wifi, TrendingUp, ShieldCheck, Droplets, Gauge, TriangleAlert, Maximize, Minimize, Upload } from 'lucide-react';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, Tooltip, GeoJSON, Polyline } from 'react-leaflet';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import clsx from 'clsx';
import './GeoMonitor.css';
import { supabase } from '../lib/supabase';
import { ShapefileImporter, type GeoLayer } from '../components/ShapefileImporter';
import { useAuth } from '../context/AuthContext';

// Fix for Leaflet icons in React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Removed unused createIcon function

const presaIcon = L.divIcon({
    className: 'geo-custom-marker',
    html: `<div style="
        width:28px;height:28px;border-radius:6px;
        background:linear-gradient(135deg,#3b82f6,#1d4ed8);
        border:2px solid rgba(255,255,255,0.9);
        box-shadow:0 0 12px #3b82f6aa;
        display:flex;align-items:center;justify-content:center;
        font-size:14px;
    ">💧</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
});

const aforoIcon = L.divIcon({
    className: 'geo-custom-marker',
    html: `<div style="
        width:22px;height:22px;border-radius:50%;
        background:linear-gradient(135deg,#f59e0b,#d97706);
        border:2px solid rgba(255,255,255,0.9);
        box-shadow:0 0 12px #f59e0baa;
        display:flex;align-items:center;justify-content:center;
        font-size:11px;
    ">🌊</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
});

// Tipos
interface EscalaData {
    id: string; nombre: string; km: number;
    latitud: number; longitud: number;
    nivel_min_operativo: number; nivel_max_operativo: number;
    capacidad_max: number; seccion_id: string;
    ancho: number; alto: number; pzas_radiales: number;
    nivel_actual?: number; delta_12h?: number; estado?: string;
}
interface PresaData {
    presa_id: string; nombre: string; latitud: number; longitud: number;
    almacenamiento_mm3: number; porcentaje_llenado: number;
    extraccion_total_m3s: number; fecha: string;
}
interface AforoData {
    id: string; nombre_punto: string; latitud: number; longitud: number;
}
interface TomaData {
    id: string;
    nombre: string;
    latitud: number;
    longitud: number;
    estado: string;
    caudal?: number;
    km?: number;
    modulo?: string;
}
interface SeccionData {
    id: string; nombre: string; km_inicio: number; km_fin: number; color: string;
}
interface OperStats {
    tomas_abiertas: number; tomas_cerradas: number; gasto_distribuido_m3s: number;
}

// Distancia en KM entre dos puntos (Haversine)
function haversineDist(lon1: number, lat1: number, lon2: number, lat2: number) {
    const R = 6371; // Radio de la tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

const GeoMonitor = () => {
    const { profile } = useAuth();
    const isGerente = profile?.rol === 'SRL';
    const [currentTime, setCurrentTime] = useState(new Date());
    const [mapReady, setMapReady] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Data States
    const [escalas, setEscalas] = useState<EscalaData[]>([]);
    const [presas, setPresas] = useState<PresaData[]>([]);
    const [aforos, setAforos] = useState<AforoData[]>([]);
    const [tomas, setTomas] = useState<TomaData[]>([]);
    const [secciones, setSecciones] = useState<SeccionData[]>([]);
    const [operStats, setOperStats] = useState<OperStats>({ tomas_abiertas: 0, tomas_cerradas: 0, gasto_distribuido_m3s: 0 });
    const [tomasVaradas, setTomasVaradas] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // GeoJSON Layers (Shapes)
    const [geoModulos, setGeoModulos] = useState<GeoJSON.FeatureCollection | null>(null);
    const [geoPresas, setGeoPresas] = useState<GeoJSON.FeatureCollection | null>(null);
    const [geoCanal, setGeoCanal] = useState<GeoJSON.FeatureCollection | null>(null);
    const [customLayers, setCustomLayers] = useState<GeoLayer[]>([]);
    const [showImporter, setShowImporter] = useState(false);
    const [geoKey, setGeoKey] = useState(0); // Force re-render on geojson change

    // Layer Toggles
    const [layers, setLayers] = useState({
        canal: true,
        escalas: true,
        tomas: true,
        alertas: true,
        modulos: true,
        presasShape: true,
    });

    const toggleLayer = (key: keyof typeof layers) => {
        setLayers(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // Cargar GeoJSON estáticos desde /public/geo/
    useEffect(() => {
        const loadGeoFiles = async () => {
            try {
                const [modRes, preRes, canRes] = await Promise.all([
                    fetch('/geo/modulos.geojson').then(r => r.ok ? r.json() : null).catch(() => null),
                    fetch('/geo/presas.geojson').then(r => r.ok ? r.json() : null).catch(() => null),
                    fetch('/geo/canal_conchos.geojson').then(r => r.ok ? r.json() : null).catch(() => null),
                ]);
                if (modRes) setGeoModulos(modRes);
                if (preRes) setGeoPresas(preRes);
                if (canRes) setGeoCanal(canRes);
                setGeoKey(k => k + 1);
            } catch (e) {
                console.warn('GeoJSON load warning:', e);
            }
        };
        loadGeoFiles();
    }, []);

    const handleLayerImported = (layer: GeoLayer) => {
        // Si es un tipo predefinido, reemplazar la capa correspondiente
        if (layer.type === 'modulos') {
            setGeoModulos(layer.geojson);
        } else if (layer.type === 'presas') {
            setGeoPresas(layer.geojson);
        } else if (layer.type === 'canal') {
            setGeoCanal(layer.geojson);
        } else {
            setCustomLayers(prev => [...prev, layer]);
        }
        setGeoKey(k => k + 1);
    };

    // Data Fetching (Prioridad 1)
    const fetchAllData = useCallback(async () => {
        try {
            const todayStr = new Date().toISOString().split('T')[0];

            // 1. Escalas base
            const { data: escData } = await supabase.from('escalas')
                .select('id, nombre, km, latitud, longitud, nivel_min_operativo, nivel_max_operativo, capacidad_max, seccion_id, ancho, alto, pzas_radiales, coeficiente_descarga, exponente_n')
                .eq('activa', true).order('km');

            // 2. Resumen diario — traer los más recientes por cada escala (sin filtrar por fecha)
            const { data: resData } = await supabase.from('resumen_escalas_diario')
                .select('escala_id, nivel_actual, delta_12h, estado, fecha, lectura_am, lectura_pm')
                .order('fecha', { ascending: false });

            // Tomar solo el registro más reciente por escala_id
            const resMap = new Map<string, any>();
            resData?.forEach((r: any) => {
                if (!resMap.has(r.escala_id)) resMap.set(r.escala_id, r);
            });

            // Merge: todas las escalas para el perfil long., solo las con coords para el mapa
            const allMerged = (escData || []).map((e: any) => {
                const r = resMap.get(e.id);
                return {
                    ...e,
                    nivel_actual: r?.nivel_actual !== null && r?.nivel_actual !== undefined ? parseFloat(r.nivel_actual) : undefined,
                    delta_12h: r?.delta_12h !== null && r?.delta_12h !== undefined ? parseFloat(r.delta_12h) : undefined,
                    estado: r?.estado || 'sin_datos',
                    fecha_lectura: r?.fecha || null,
                };
            });
            // Solo las que tienen coordenadas van al mapa
            setEscalas(allMerged);

            // 2. Presas
            const { data: lpData } = await supabase
                .from('lecturas_presas')
                .select('presa_id, almacenamiento_mm3, porcentaje_llenado, extraccion_total_m3s, fecha, presas(nombre, latitud, longitud)')
                .order('fecha', { ascending: false })
                .limit(3);

            const presasMap = new Map<string, PresaData>();
            (lpData || []).forEach((lp: any) => {
                if (!presasMap.has(lp.presa_id) && lp.presas?.latitud) {
                    presasMap.set(lp.presa_id, {
                        presa_id: lp.presa_id, nombre: lp.presas.nombre,
                        latitud: parseFloat(lp.presas.latitud), longitud: parseFloat(lp.presas.longitud),
                        almacenamiento_mm3: parseFloat(lp.almacenamiento_mm3 || 0),
                        porcentaje_llenado: parseFloat(lp.porcentaje_llenado || 0),
                        extraccion_total_m3s: parseFloat(lp.extraccion_total_m3s || 0),
                        fecha: lp.fecha,
                    });
                }
            });
            setPresas(Array.from(presasMap.values()));

            // 3. Puntos de Aforo
            const { data: afData } = await supabase.from('aforos_control').select('id, nombre_punto, latitud, longitud');
            setAforos((afData || []).filter((a: any) => a.latitud && a.longitud).map((a: any) => ({
                ...a, latitud: parseFloat(a.latitud), longitud: parseFloat(a.longitud)
            })));

            // 4. Secciones
            const { data: secData } = await supabase.from('secciones').select('id, nombre, km_inicio, km_fin, color').order('km_inicio');
            setSecciones((secData || []).map((s: any) => ({
                ...s, km_inicio: parseFloat(s.km_inicio), km_fin: parseFloat(s.km_fin)
            })));

            // 5. Operación del día
            const { data: opData } = await supabase.rpc('get_today_operation_stats').maybeSingle();
            if (opData) setOperStats(opData as OperStats);
            else {
                // Fallback manual query
                const { data: rData } = await supabase.from('reportes_operacion').select('estado, caudal_promedio').eq('fecha', todayStr);
                if (rData) {
                    const open = rData.filter((r: any) => ['inicio', 'continua', 'reabierto', 'modificacion'].includes(r.estado));
                    setOperStats({
                        tomas_abiertas: open.length,
                        tomas_cerradas: rData.length - open.length,
                        gasto_distribuido_m3s: open.reduce((s: number, r: any) => s + parseFloat(r.caudal_promedio || 0), 0)
                    });
                }
            }

            // 6. Tomas Varadas
            const { data: tvData } = await supabase.from('vw_alertas_tomas_varadas').select('*');
            if (tvData) setTomasVaradas(tvData);

            // 7. Puntos de Entrega (Tomas) y su estado actual
            const { data: peData } = await supabase.from('puntos_entrega')
                .select('id, nombre, km, coords_x, coords_y, modulo_id');

            const { data: roData } = await supabase.from('reportes_operacion')
                .select('punto_id, estado, caudal_promedio')
                .eq('fecha', todayStr);

            const roMap = new Map();
            roData?.forEach(r => roMap.set(r.punto_id, r));

            const mergedTomas = (peData || [])
                .filter(p => p.coords_x && p.coords_y)
                .map(p => ({
                    id: p.id,
                    nombre: p.nombre,
                    latitud: parseFloat(p.coords_y as any),
                    longitud: parseFloat(p.coords_x as any),
                    km: p.km ? parseFloat(p.km as any) : undefined,
                    modulo: p.modulo_id,
                    estado: roMap.get(p.id)?.estado || 'cierre',
                    caudal: roMap.get(p.id)?.caudal_promedio ? parseFloat(roMap.get(p.id).caudal_promedio) : 0
                }));
            setTomas(mergedTomas);

        } catch (e) {
            console.error('GeoMonitor fetch error:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        setTimeout(() => setMapReady(true), 100);
        fetchAllData();
        // Auto-refresh cada 60 segundos
        const refreshInterval = setInterval(fetchAllData, 60000);
        return () => { clearInterval(timer); clearInterval(refreshInterval); };
    }, [fetchAllData]);

    // Fullscreen Toggle (Prioridad 4)
    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen?.();
            setIsFullscreen(true);
        } else {
            document.exitFullscreen?.();
            setIsFullscreen(false);
        }
    };

    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);
    // Convertir el Shapefile real del Canal (geoCanal) en Secciones Coloreadas
    const canalSegmentsGeoref = useMemo(() => {
        if (!geoCanal || !secciones.length) return [];
        const feature = geoCanal.features?.[0];
        if (!feature || feature.geometry.type !== 'LineString') return [];

        const coords = feature.geometry.coordinates as [number, number][]; // [lng, lat]
        if (!coords || coords.length === 0) return [];

        let totalDist = 0;
        const distData = [{ lat: coords[0][1], lng: coords[0][0], dist: 0 }];
        for (let i = 1; i < coords.length; i++) {
            const p1 = coords[i - 1]; // [lng, lat]
            const p2 = coords[i];     // [lng, lat]
            const d = haversineDist(p1[0], p1[1], p2[0], p2[1]);
            totalDist += d;
            distData.push({ lat: p2[1], lng: p2[0], dist: totalDist });
        }

        // Ajuste contra la longitud oficial de 104 km para alinear escalas (Regla de 3)
        const corrFactor = totalDist > 0 ? 104 / totalDist : 1;
        distData.forEach(d => d.dist *= corrFactor);

        return secciones.map(sec => {
            const segPoints = distData
                .filter(d => d.dist >= sec.km_inicio && d.dist <= sec.km_fin)
                .map(d => [d.lat, d.lng] as [number, number]);

            return { ...sec, points: segPoints };
        });
    }, [geoCanal, secciones]);

    // KPIs vinculados a datos reales de SICA
    // Nivel de entrada: K-23 (primera escala)
    const escalaEntrada = escalas.find(e => e.km <= 30 && e.nivel_actual !== undefined);
    const escalaSalida = [...escalas].reverse().find(e => e.km >= 87 && e.nivel_actual !== undefined);
    const nivelEntrada = escalaEntrada?.nivel_actual;
    const nivelSalida = escalaSalida?.nivel_actual;

    // Gasto calculado Q = Cd * H^n (fórmula de garganta larga)
    const calcGasto = (esc: EscalaData | undefined): number | undefined => {
        if (!esc || esc.nivel_actual === undefined) return undefined;
        const Cd = (esc as any).coeficiente_descarga || 1.84;
        const n = (esc as any).exponente_n || 1.52;
        return Cd * Math.pow(esc.nivel_actual, n);
    };
    const gastoEntrada = calcGasto(escalaEntrada);
    const gastoSalida = calcGasto(escalaSalida);
    const gaugeValue = nivelEntrada ?? 0;

    const chartGaugeOptions = {
        series: [{
            type: 'gauge', center: ['50%', '55%'],
            startAngle: 200, endAngle: -20, min: 0, max: 4, splitNumber: 8,
            progress: {
                show: true, width: 12,
                itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: '#0ea5e9' }, { offset: 1, color: '#3b82f6' }]) }
            },
            pointer: { show: true, length: '60%', width: 4, itemStyle: { color: '#22d3ee' } },
            axisLine: { lineStyle: { width: 12, color: [[0.6, '#1e40af'], [0.8, '#f59e0b'], [1, '#ef4444']] } },
            axisTick: { show: false },
            splitLine: { distance: -18, length: 12, lineStyle: { color: 'rgba(51, 65, 85, 0.8)', width: 2 } },
            axisLabel: { distance: 12, color: '#94a3b8', fontSize: 10, fontFamily: 'monospace' },
            detail: { valueAnimation: true, formatter: '{value}', color: '#fff', fontSize: 28, fontWeight: 900, offsetCenter: [0, '10%'] },
            data: [{ value: parseFloat(gaugeValue.toFixed(2)), name: `${escalaEntrada?.nombre || 'K-23'} — Nivel (m)` }],
            title: { offsetCenter: [0, '70%'], color: '#22d3ee', fontSize: 10, fontFamily: 'monospace' }
        }]
    };

    // Perfil Longitudinal (Prioridad 3.2)
    const profileOptions = {
        backgroundColor: 'transparent',
        grid: { left: 35, right: 10, top: 10, bottom: 22 },
        xAxis: {
            type: 'category' as const,
            data: escalas.map(e => `K${Math.round(e.km)}`),
            axisLabel: { color: '#64748b', fontSize: 8, rotate: 45 },
            axisLine: { lineStyle: { color: '#334155' } },
        },
        yAxis: {
            type: 'value' as const,
            axisLabel: { color: '#64748b', fontSize: 9, formatter: '{value}m' },
            axisLine: { show: false },
            splitLine: { lineStyle: { color: '#1e293b' } },
        },
        series: [{
            data: escalas.map(e => e.nivel_actual ?? 0),
            type: 'line' as const,
            smooth: true,
            symbol: 'circle',
            symbolSize: 6,
            lineStyle: { color: '#22d3ee', width: 2 },
            itemStyle: { color: '#22d3ee', borderColor: '#0f172a', borderWidth: 2 },
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: 'rgba(34, 211, 238, 0.25)' },
                    { offset: 1, color: 'rgba(34, 211, 238, 0.02)' }
                ])
            },
        }],
        tooltip: {
            trigger: 'axis' as const,
            backgroundColor: '#0f172a',
            borderColor: '#334155',
            textStyle: { color: '#e2e8f0', fontSize: 11 },
            formatter: (params: any) => {
                const p = params[0];
                const esc = escalas[p.dataIndex];
                return `<b>${esc?.nombre}</b><br/>Nivel: <span style="color:#22d3ee;font-weight:bold">${p.value} m</span><br/>Km: ${esc?.km}`;
            }
        },
    };

    // KPI calculations vinculados a SICA
    const perdidaPct = (gastoEntrada && gastoSalida && gastoEntrada > 0)
        ? ((gastoEntrada - gastoSalida) / gastoEntrada * 100).toFixed(1)
        : (nivelEntrada && nivelSalida && nivelEntrada > 0)
            ? ((nivelEntrada - nivelSalida) / nivelEntrada * 100).toFixed(1)
            : null;
    const eficiencia = perdidaPct ? (100 - parseFloat(perdidaPct)).toFixed(1) : null;
    const gastoDistribuido = operStats.gasto_distribuido_m3s;

    // Events
    const liveEvents = [
        ...tomasVaradas.map((tv: any) => ({
            time: `Hace ${tv.dias_varada} ${tv.dias_varada === 1 ? 'día' : 'días'}`,
            type: 'TOMA VARADA', title: `Sin continuidad (${tv.ultimo_estado})`,
            location: tv.punto_nombre, status: 'status-critical'
        })),
        ...presas.filter(p => p.porcentaje_llenado < 40).map(p => ({
            time: p.fecha, type: 'ALMACENAMIENTO',
            title: `${p.nombre} al ${p.porcentaje_llenado.toFixed(1)}%`,
            location: 'Red Mayor', status: 'status-warning'
        })),
        { time: 'En Vivo', type: 'SYNC', title: `${escalas.length} Escalas enlazadas`, location: 'Sistema General', status: 'status-success' },
        { time: 'Tiempo Real', type: 'DISTRIBUCIÓN', title: `${operStats.tomas_abiertas} tomas operando`, location: 'Canal Principal', status: 'status-info' },
    ];

    const mapCenter: [number, number] = [28.02, -105.42];

    return (
        <div className={clsx('geo-monitor-container', isFullscreen && 'geo-fullscreen')} ref={containerRef}>
            <div className="geo-background-grid"></div>

            {/* HEADER */}
            <header className="geo-header">
                <div className="geo-header-left">
                    <div className="geo-icon-wrapper">
                        <MapIcon color="#22d3ee" size={28} />
                    </div>
                    <div>
                        <h1 className="geo-title" style={{ fontSize: '1.4rem' }}>
                            GEO-MONITOR <span className="font-light">| CENTRO VISUAL</span>
                        </h1>
                        <p className="geo-subtitle">
                            Canal Principal Conchos — DR-005
                        </p>
                    </div>
                </div>
                <div className="geo-header-right">
                    <div className="geo-time-display">
                        <div className="geo-time">{currentTime.toLocaleTimeString('es-MX', { hour12: false })}</div>
                        <div className="geo-date">{currentTime.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}</div>
                    </div>
                    <div className="geo-divider"></div>
                    <div className="geo-status-badges">
                        <span className="geo-badge live">
                            <span className="pulse-dot"></span>
                            LIVE: {loading ? 'CARGANDO...' : 'ENLAZADO'}
                        </span>
                        <span className="geo-badge satellite">
                            <Wifi size={12} /> {escalas.length} ESCALAS
                        </span>
                    </div>
                    {/* Fullscreen Toggle (Prioridad 4.3) */}
                    <button className="geo-fullscreen-btn" onClick={toggleFullscreen} title={isFullscreen ? 'Salir Pantalla Completa' : 'Modo Video Wall'}>
                        {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                    </button>
                </div>
            </header>

            <div className="geo-main-content">
                {/* LEFT: LAYER CONTROLS (Prioridad 2) */}
                <div className="geo-sidebar-controls">
                    <button
                        className={clsx('geo-control-btn', layers.canal ? 'active' : 'default')}
                        onClick={() => toggleLayer('canal')}
                        title="Trazado del Canal por Secciones"
                    >
                        <Layers size={22} />
                        {layers.canal && <span className="geo-indicator-dot"></span>}
                    </button>
                    <button
                        className={clsx('geo-control-btn', layers.escalas ? 'active' : 'default')}
                        onClick={() => toggleLayer('escalas')}
                        title="Escalas y Puntos de Aforo"
                    >
                        <Crosshair size={22} />
                        {layers.escalas && <span className="geo-indicator-dot"></span>}
                    </button>
                    <button
                        className={clsx('geo-control-btn', layers.tomas ? 'active' : 'default')}
                        onClick={() => toggleLayer('tomas')}
                        title="Presas y Tomas Activas"
                    >
                        <Droplets size={22} />
                        {layers.tomas && <span className="geo-indicator-dot"></span>}
                    </button>
                    <button
                        className={clsx('geo-control-btn', layers.modulos ? 'active' : 'default')}
                        onClick={() => toggleLayer('modulos')}
                        title="Polígonos de Módulos de Riego"
                    >
                        <MapIcon size={22} />
                        {layers.modulos && <span className="geo-indicator-dot" style={{ background: '#8b5cf6' }}></span>}
                    </button>
                    <button
                        className={clsx('geo-control-btn', layers.presasShape ? 'active' : 'default')}
                        onClick={() => toggleLayer('presasShape')}
                        title="Polígonos de Vasos de Presas"
                    >
                        <Droplets size={22} />
                        {layers.presasShape && <span className="geo-indicator-dot" style={{ background: '#1d4ed8' }}></span>}
                    </button>
                    <button
                        className={clsx('geo-control-btn', layers.alertas ? 'shield' : 'default')}
                        onClick={() => toggleLayer('alertas')}
                        title="Alertas y Anomalías"
                    >
                        <ShieldCheck size={22} />
                        {layers.alertas && tomasVaradas.length > 0 && (
                            <span className="geo-alert-badge">{tomasVaradas.length}</span>
                        )}
                    </button>
                    {/* Botón de Importar Shapefile (Solo Gerente SRL) */}
                    {isGerente && (
                        <button
                            className="geo-control-btn default"
                            onClick={() => setShowImporter(true)}
                            title="Importar Shapefile / GeoJSON"
                            style={{ borderTop: '1px solid rgba(100,116,139,0.3)', marginTop: 4, paddingTop: 12 }}
                        >
                            <Upload size={20} />
                        </button>
                    )}
                </div>

                {/* CENTER: MAP (Prioridad 1 + 2) */}
                <div className="geo-map-container">
                    <div className="geo-map-inner">
                        {mapReady && (
                            <MapContainer
                                center={mapCenter} zoom={10}
                                style={{ height: '100%', width: '100%', background: '#0f172a' }}
                                zoomControl={false} attributionControl={false}
                            >
                                <TileLayer
                                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                                    maxZoom={19}
                                />

                                {/* GeoJSON: Polígonos de Módulos */}
                                {layers.modulos && geoModulos && (
                                    <GeoJSON
                                        key={`mod-${geoKey}`}
                                        data={geoModulos}
                                        style={(feature) => ({
                                            color: feature?.properties?.color || '#3b82f6',
                                            weight: 2,
                                            fillColor: feature?.properties?.color || '#3b82f6',
                                            fillOpacity: feature?.properties?.fill_opacity || 0.15,
                                            dashArray: '5, 5',
                                        })}
                                        onEachFeature={(feature, layer) => {
                                            if (feature.properties) {
                                                const p = feature.properties;
                                                layer.bindPopup(`
                                                    <div style="font-family:monospace;min-width:180px">
                                                        <strong style="font-size:13px;color:${p.color}">${p.nombre}</strong>
                                                        <div style="font-size:11px;color:#666;margin:4px 0">Módulo ${p.numero_modulo}</div>
                                                        <div style="font-size:11px">Superficie: <b>${p.superficie_ha?.toLocaleString()} ha</b></div>
                                                    </div>
                                                `);
                                                layer.bindTooltip(p.nombre, { sticky: true, className: 'geo-tooltip-custom' });
                                            }
                                        }}
                                    />
                                )}

                                {/* GeoJSON: Polígonos de Presas */}
                                {layers.presasShape && geoPresas && (
                                    <GeoJSON
                                        key={`pre-${geoKey}`}
                                        data={geoPresas}
                                        style={(feature) => ({
                                            color: feature?.properties?.color || '#1d4ed8',
                                            weight: 2,
                                            fillColor: feature?.properties?.color || '#1d4ed8',
                                            fillOpacity: feature?.properties?.fill_opacity || 0.25,
                                        })}
                                        onEachFeature={(feature, layer) => {
                                            if (feature.properties) {
                                                const p = feature.properties;
                                                layer.bindPopup(`
                                                    <div style="font-family:monospace;min-width:180px">
                                                        <strong style="font-size:13px;color:${p.color}">${p.nombre}</strong>
                                                        <div style="font-size:11px;margin-top:4px">Capacidad: <b>${p.capacidad_mm3} Mm³</b></div>
                                                    </div>
                                                `);
                                                layer.bindTooltip(p.nombre, { sticky: true });
                                            }
                                        }}
                                    />
                                )}

                                {/* GeoJSON: Canal Principal (línea gruesa) */}
                                {layers.canal && geoCanal && (
                                    <GeoJSON
                                        key={`can-${geoKey}`}
                                        data={geoCanal}
                                        style={() => ({
                                            color: '#22d3ee',
                                            weight: 4,
                                            opacity: 0.8,
                                        })}
                                        onEachFeature={(feature, layer) => {
                                            if (feature.properties) {
                                                layer.bindTooltip(`Canal Principal Conchos (${feature.properties.longitud_km || 104} km)`, { sticky: true });
                                            }
                                        }}
                                    />
                                )}

                                {/* Capas personalizadas importadas */}
                                {customLayers.filter(cl => cl.visible).map(cl => (
                                    <GeoJSON
                                        key={cl.id}
                                        data={cl.geojson}
                                        style={() => ({
                                            color: cl.color,
                                            weight: 2,
                                            fillColor: cl.color,
                                            fillOpacity: cl.fillOpacity,
                                        })}
                                        onEachFeature={(feature, layer) => {
                                            if (feature.properties) {
                                                const html = Object.entries(feature.properties)
                                                    .map(([k, v]) => `<div style="font-size:10px"><b>${k}:</b> ${v}</div>`)
                                                    .join('');
                                                layer.bindPopup(`<div style="font-family:monospace;max-width:250px">${html}</div>`);
                                            }
                                        }}
                                    />
                                ))}

                                {/* Secciones del Canal Georreferenciado (Shapefile dividido por km) */}
                                {layers.canal && canalSegmentsGeoref.map(seg => (
                                    seg.points.length > 0 && (
                                        <Polyline
                                            key={seg.id}
                                            positions={seg.points}
                                            color={seg.color}
                                            weight={5}
                                            opacity={0.85}
                                        >
                                            <Tooltip sticky>
                                                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                                                    <b style={{ color: seg.color }}>{seg.nombre}</b><br />
                                                    Km {seg.km_inicio} → {seg.km_fin}
                                                </span>
                                            </Tooltip>
                                        </Polyline>
                                    )
                                ))}

                                {/* Escalas del Canal (solo con coordenadas) */}
                                {layers.escalas && escalas.filter(e => e.latitud && e.longitud).map(esc => (
                                    <CircleMarker
                                        key={esc.id}
                                        center={[esc.latitud, esc.longitud]}
                                        radius={7}
                                        fillColor={esc.estado === 'critico' ? '#ef4444' : esc.estado === 'alerta' ? '#f59e0b' : '#22d3ee'}
                                        color="rgba(255,255,255,0.8)"
                                        weight={2}
                                        fillOpacity={0.9}
                                    >
                                        <Tooltip direction="top" offset={[0, -8]}>
                                            <div style={{ fontFamily: 'monospace', fontSize: 11, minWidth: 140 }}>
                                                <b>{esc.nombre}</b> (Km {esc.km})<br />
                                                {esc.nivel_actual !== undefined ? (
                                                    <>
                                                        Nivel: <span style={{ color: '#22d3ee', fontWeight: 'bold' }}>{esc.nivel_actual} m</span><br />
                                                        Δ12h: <span style={{ color: (esc.delta_12h ?? 0) > 0 ? '#10b981' : '#ef4444' }}>{esc.delta_12h ?? 0} m</span><br />
                                                    </>
                                                ) : (
                                                    <span style={{ color: '#64748b' }}>Sin lectura hoy</span>
                                                )}
                                                {esc.pzas_radiales > 0 && (
                                                    <span style={{ fontSize: 9, color: '#94a3b8' }}>{esc.pzas_radiales} radiales ({esc.ancho}×{esc.alto}m)</span>
                                                )}
                                            </div>
                                        </Tooltip>
                                        <Popup>
                                            <div style={{ fontFamily: 'monospace', minWidth: 160 }}>
                                                <strong style={{ fontSize: 13 }}>{esc.nombre}</strong>
                                                <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>Km {esc.km} | Sección {esc.seccion_id}</div>
                                                <table style={{ fontSize: 11, width: '100%' }}>
                                                    <tbody>
                                                        <tr><td>Nivel Actual:</td><td style={{ fontWeight: 'bold', color: '#0ea5e9' }}>{esc.nivel_actual ?? '—'} m</td></tr>
                                                        <tr><td>Rango Oper.:</td><td>{esc.nivel_min_operativo}–{esc.nivel_max_operativo} m</td></tr>
                                                        <tr><td>Δ12h:</td><td style={{ color: (esc.delta_12h ?? 0) >= 0 ? '#16a34a' : '#dc2626' }}>{esc.delta_12h ?? '—'} m</td></tr>
                                                        {esc.pzas_radiales > 0 && (
                                                            <tr><td>Radiales:</td><td>{esc.pzas_radiales} pzas ({esc.ancho}×{esc.alto}m)</td></tr>
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </Popup>
                                    </CircleMarker>
                                ))}

                                {/* Prioridad 1.2: Puntos de Aforo */}
                                {layers.escalas && aforos.map(af => (
                                    <Marker key={af.id} position={[af.latitud, af.longitud]} icon={aforoIcon}>
                                        <Tooltip direction="top" offset={[0, -12]}>
                                            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                                                <b>📐 {af.nombre_punto}</b><br />
                                                Punto de Aforo Oficial
                                            </span>
                                        </Tooltip>
                                    </Marker>
                                ))}

                                {/* Prioridad 1.1: Presas */}
                                {layers.tomas && presas.map(p => (
                                    <Marker key={p.presa_id} position={[p.latitud, p.longitud]} icon={presaIcon}>
                                        <Tooltip direction="top" offset={[0, -16]} permanent>
                                            <span style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 'bold' }}>
                                                {p.porcentaje_llenado.toFixed(0)}%
                                            </span>
                                        </Tooltip>
                                        <Popup>
                                            <div style={{ fontFamily: 'monospace', minWidth: 180 }}>
                                                <strong style={{ fontSize: 13, color: '#1d4ed8' }}>{p.nombre}</strong>
                                                <div style={{ fontSize: 10, color: '#888', marginBottom: 6 }}>Última lectura: {p.fecha}</div>
                                                <div style={{ background: '#f0f9ff', borderRadius: 6, padding: 8, marginBottom: 4 }}>
                                                    <div style={{ fontSize: 11 }}>Almacenamiento: <b>{p.almacenamiento_mm3.toFixed(1)} Mm³</b></div>
                                                    <div style={{ width: '100%', height: 8, background: '#e2e8f0', borderRadius: 4, marginTop: 4 }}>
                                                        <div style={{
                                                            width: `${Math.min(p.porcentaje_llenado, 100)}%`, height: '100%',
                                                            background: p.porcentaje_llenado > 70 ? '#3b82f6' : p.porcentaje_llenado > 40 ? '#f59e0b' : '#ef4444',
                                                            borderRadius: 4
                                                        }}></div>
                                                    </div>
                                                    <div style={{ fontSize: 11, marginTop: 4 }}>Llenado: <b>{p.porcentaje_llenado.toFixed(1)}%</b></div>
                                                </div>
                                                <div style={{ fontSize: 11 }}>Extracción: <b>{p.extraccion_total_m3s} m³/s</b></div>
                                            </div>
                                        </Popup>
                                    </Marker>
                                ))}

                                {/* Puntos de Entrega (Tomas) */}
                                {layers.tomas && tomas.map(t => (
                                    <CircleMarker
                                        key={t.id}
                                        center={[t.latitud, t.longitud]}
                                        radius={t.estado !== 'cierre' ? 5 : 4}
                                        fillColor={t.estado === 'cierre' ? '#64748b' : '#22c55e'}
                                        color="white"
                                        weight={1}
                                        fillOpacity={0.8}
                                    >
                                        <Tooltip direction="top" offset={[0, -5]}>
                                            <div style={{ fontFamily: 'monospace', fontSize: 10 }}>
                                                <b>{t.nombre}</b><br />
                                                Estado: <span style={{ color: t.estado === 'cierre' ? '#94a3b8' : '#4ade80' }}>
                                                    {t.estado === 'cierre' ? 'CERRADA' : 'ABIERTA'}
                                                </span><br />
                                                {t.estado !== 'cierre' && <span>Q: {t.caudal?.toFixed(1)} LPS</span>}
                                            </div>
                                        </Tooltip>
                                        <Popup>
                                            <div style={{ fontFamily: 'monospace', minWidth: 160 }}>
                                                <strong style={{ fontSize: 13 }}>{t.nombre}</strong>
                                                <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                                                    Modulo: {t.modulo} | Km: {t.km?.toFixed(3)}
                                                </div>
                                                <div style={{ padding: '4px 8px', borderRadius: 4, background: t.estado === 'cierre' ? '#f1f5f9' : '#f0fdf4', fontSize: 11 }}>
                                                    Estado: <b>{t.estado.toUpperCase()}</b><br />
                                                    {t.estado !== 'cierre' && <div>Caudal: <b>{t.caudal?.toFixed(1)} LPS</b></div>}
                                                </div>
                                            </div>
                                        </Popup>
                                    </CircleMarker>
                                ))}
                            </MapContainer>
                        )}
                    </div>

                    {/* Map UI Overlay */}
                    <div className="geo-map-overlay-layer">
                        <div className="geo-map-tag">
                            <span>SECCIONES: {secciones.length} | ESCALAS: {escalas.filter(e => e.nivel_actual !== undefined).length}/{escalas.length} | MÓDULOS: {geoModulos?.features?.length || 0} | PRESAS: {presas.length}</span>
                        </div>
                        <div className="geo-map-crosshair" style={{ opacity: 0.1 }}>
                            <Crosshair size={40} />
                        </div>
                        <div className="geo-map-coords">
                            <span>Lon: {mapCenter[1].toFixed(4)}</span>
                            <div className="geo-coords-divider"></div>
                            <span>Lat: {mapCenter[0].toFixed(4)}</span>
                        </div>
                    </div>
                </div>

                {/* RIGHT: KPIs + CHARTS + FEED (Prioridad 3) */}
                <div className="geo-stats-panel">

                    {/* KPI Cards vinculados a SICA */}
                    <div className="geo-kpi-grid">
                        <div className="geo-kpi-card">
                            <div className="geo-kpi-label">
                                <Gauge size={12} /> Nivel Entrada ({escalaEntrada?.nombre || 'K-23'})
                            </div>
                            <div className="geo-kpi-value cyan">
                                {nivelEntrada?.toFixed(2) ?? '—'} <small>m</small>
                            </div>
                            {gastoEntrada && <div style={{ fontSize: 9, color: '#64748b', marginTop: 2, fontFamily: 'monospace' }}>Q: {gastoEntrada.toFixed(2)} m³/s</div>}
                        </div>
                        <div className="geo-kpi-card">
                            <div className="geo-kpi-label">
                                <Gauge size={12} /> Nivel Salida ({escalaSalida?.nombre || 'K-94'})
                            </div>
                            <div className="geo-kpi-value">
                                {nivelSalida?.toFixed(2) ?? '—'} <small>m</small>
                            </div>
                            {gastoSalida && <div style={{ fontSize: 9, color: '#64748b', marginTop: 2, fontFamily: 'monospace' }}>Q: {gastoSalida.toFixed(2)} m³/s</div>}
                        </div>
                        <div className="geo-kpi-card">
                            <div className="geo-kpi-label">
                                <TrendingUp size={12} /> Eficiencia
                            </div>
                            <div className={clsx('geo-kpi-value', eficiencia && parseFloat(eficiencia) >= 90 ? 'green' : eficiencia ? 'red' : '')}>
                                {eficiencia ?? '—'}<small>%</small>
                            </div>
                        </div>
                        <div className="geo-kpi-card">
                            <div className="geo-kpi-label">
                                <TriangleAlert size={12} /> Pérdida
                            </div>
                            <div className={clsx('geo-kpi-value', perdidaPct && parseFloat(perdidaPct) > 10 ? 'red' : 'green')}>
                                {perdidaPct ?? '—'}<small>%</small>
                            </div>
                        </div>
                    </div>

                    {/* Tomas Status Mini (Prioridad 3.1) */}
                    <div className="geo-tomas-bar">
                        <div className="geo-tomas-item open">
                            <span className="geo-tomas-count">{operStats.tomas_abiertas}</span>
                            <span className="geo-tomas-label">Abiertas</span>
                        </div>
                        <div className="geo-tomas-item closed">
                            <span className="geo-tomas-count">{operStats.tomas_cerradas}</span>
                            <span className="geo-tomas-label">Cerradas</span>
                        </div>
                        <div className="geo-tomas-item" style={{ background: 'rgba(34, 211, 238, 0.1)' }}>
                            <span className="geo-tomas-count" style={{ color: '#22d3ee' }}>
                                {gastoDistribuido.toFixed(1)} <small style={{ fontSize: '10px' }}>m³/s</small>
                            </span>
                            <span className="geo-tomas-label">Distribuido</span>
                        </div>
                        <div className="geo-tomas-item alert">
                            <span className="geo-tomas-count">{tomasVaradas.length}</span>
                            <span className="geo-tomas-label">Varadas</span>
                        </div>
                    </div>

                    {/* Gauge Chart */}
                    <div className="geo-chart-card">
                        <div className="geo-stat-header">
                            <span className="geo-stat-title">Nivel: {escalaEntrada?.nombre || 'K-23'}</span>
                            <TrendingUp size={14} className="geo-stat-icon" />
                        </div>
                        <div className="geo-chart-wrapper">
                            <ReactECharts option={chartGaugeOptions} style={{ height: '140px', width: '100%' }} opts={{ renderer: 'svg' }} />
                        </div>
                    </div>

                    {/* Perfil Longitudinal (Prioridad 3.2) */}
                    <div className="geo-chart-card">
                        <div className="geo-stat-header">
                            <span className="geo-stat-title">Perfil Longitudinal</span>
                            <Activity size={14} className="geo-stat-icon" />
                        </div>
                        <div className="geo-chart-wrapper">
                            <ReactECharts
                                option={profileOptions}
                                style={{ height: '120px', width: '100%' }}
                                opts={{ renderer: 'svg' }}
                            />
                        </div>
                    </div>

                    {/* Bitácora Operativa */}
                    <div className="geo-registry-box">
                        <div className="geo-registry-header">
                            <h3 className="geo-registry-title">
                                <Activity size={14} className="geo-registry-icon" />
                                Bitácora en Vivo
                            </h3>
                            <span className="geo-pulse-indicator"></span>
                        </div>
                        <div className="geo-registry-list">
                            {liveEvents.map((ev, idx) => (
                                <div key={idx} className={clsx('geo-event-item', ev.status)}>
                                    <div className="geo-event-node"></div>
                                    <div className="geo-event-card">
                                        <div className="geo-event-card-header">
                                            <span className="geo-event-time">{ev.time}</span>
                                            <span className="geo-event-type">{ev.type}</span>
                                        </div>
                                        <h4 className="geo-event-title">{ev.title}</h4>
                                        <p className="geo-event-location">
                                            <MapIcon size={10} /> {ev.location}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Shapefile Importer Modal */}
            {showImporter && (
                <ShapefileImporter
                    onLayerImported={handleLayerImported}
                    onClose={() => setShowImporter(false)}
                />
            )}
        </div>
    );
};

export default GeoMonitor;
