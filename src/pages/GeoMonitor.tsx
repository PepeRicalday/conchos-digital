import { Map as MapIcon, Activity, Crosshair, Layers, Wifi, TrendingUp, ShieldCheck, Droplets, Gauge, TriangleAlert, Maximize, Minimize, Upload, AlertTriangle, X, CloudRain, Satellite, PanelRight, CalendarRange, Box } from 'lucide-react';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, WMSTileLayer, Marker, Popup, CircleMarker, Tooltip, GeoJSON, Polyline, useMapEvents } from 'react-leaflet';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import clsx from 'clsx';
import './GeoMonitor.css';
import { supabase } from '../lib/supabase';
import { onTable } from '../lib/realtimeHub';
import { getTodayString, addDays, formatTime, formatDate } from '../utils/dateHelpers';
import type { VwAlertaTomaVaradaRow } from '../types/sica.types';
import { ShapefileImporter, type GeoLayer } from '../components/ShapefileImporter';
import { useAuth } from '../context/AuthContext';
import { useHydricEvents } from '../hooks/useHydricEvents';
import { useClimaEstaciones } from '../hooks/useClimaEstaciones';
import { esModuloSRL, moduloSRLde } from '../utils/modulosSRL';
import { MODULOS_BBOX } from '../utils/modulosBbox';
import { sentinelWmsUrl } from '../utils/sentinelWms';
import { WAVE_CELERITY_MS, WAVE_CELERITY_CONFIANZA } from '../utils/hydraulics';
import { PresaVasoMonitor } from '../components/PresaVasoMonitor';
import { NdviModulosPanel } from '../components/NdviModulosPanel';
import { WindyMapModal } from '../components/WindyMapModal';
import { useMetadataStore } from '../store/useMetadataStore';
import { useNavigate } from 'react-router-dom';

// Fix for Leaflet icons in React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Removed unused createIcon function

const BASE_LAYER_LABEL: Record<'standard' | 'satellite' | 'eos' | 'sentinel', string> = {
    standard: 'Mapa Estándar',
    satellite: 'Satélite ArcGIS',
    eos: 'EOS LandViewer',
    sentinel: 'Sentinel Hub',
};

// Tiles fallidos consecutivos (dentro de la misma carga, ver
// sentinelTileErrorCount) antes de asumir que el WMS de Sentinel Hub está
// caído y caer a satélite ArcGIS. Un mosaico real con zoom/pan pide varias
// decenas de tiles por carga, y es normal que unos pocos fallen por timeout
// de red o por caer en el borde de la escena disponible sin que la cuenta
// esté realmente caída — con el umbral en 4 eso bastaba para expulsar al
// usuario de Sentinel Hub segundos después de activarlo (reportado ago-2026:
// "aparece unos segundos y se cierra"). 14 tolera ese ruido y sigue
// detectando una cuenta vencida/instance ID inválido, que falla TODOS los
// tiles casi de inmediato.
const SENTINEL_TILEERROR_UMBRAL = 14;

type LayerKey = 'canal' | 'escalas' | 'tomas' | 'estaciones' | 'modulos' | 'presasShape'
    | 'rioShape' | 'alertas' | 'mostrarAforosQ' | 'mostrarAperturas' | 'lotes';

interface SidebarButtonConfig {
    key: LayerKey;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    title: string;
    iconClassName?: string;
    indicatorClass?: string;
    /** 'alertas' usa una clase de estado propia ('shield') en vez de 'active'. */
    activeClass?: string;
}

interface SidebarGroupConfig {
    id: string;
    label: string;
    buttons: SidebarButtonConfig[];
}

// Los 10 toggles de contenido, agrupados por función real (no por orden de
// aparición histórico): topología de red activa, overlays geoespaciales
// estáticos, monitoreo de clima/riesgo, e indicadores de operación puntual.
const SIDEBAR_GROUPS: SidebarGroupConfig[] = [
    {
        id: 'red-hidraulica',
        label: 'Red hidráulica',
        buttons: [
            { key: 'canal', icon: Layers, title: 'Trazado del Canal por Secciones' },
            { key: 'escalas', icon: Crosshair, title: 'Escalas y Puntos de Aforo' },
            { key: 'tomas', icon: Droplets, title: 'Presas y Tomas Activas' },
            { key: 'rioShape', icon: Activity, title: 'Trazado del Río Conchos', iconClassName: 'geo-icon-blue', indicatorClass: 'geo-indicator-blue' },
        ],
    },
    {
        id: 'capas-geoespaciales',
        label: 'Polígonos',
        buttons: [
            { key: 'modulos', icon: MapIcon, title: 'Polígonos de Módulos de Riego', indicatorClass: 'geo-indicator-purple' },
            { key: 'presasShape', icon: Droplets, title: 'Polígonos de Vasos de Presas', indicatorClass: 'geo-indicator-blue' },
            { key: 'lotes', icon: Crosshair, title: 'Lotes de Productores (catastro) — visible desde zoom 13', indicatorClass: 'geo-indicator-amber' },
        ],
    },
    {
        id: 'clima-alertas',
        label: 'Monitoreo',
        buttons: [
            { key: 'estaciones', icon: CloudRain, title: 'Estaciones climáticas (WeatherLink)' },
            { key: 'alertas', icon: ShieldCheck, title: 'Alertas y Anomalías', activeClass: 'shield' },
        ],
    },
    {
        id: 'indicadores',
        label: 'Indicadores',
        buttons: [
            { key: 'mostrarAforosQ', icon: TrendingUp, title: 'Ver Gastos de Aforos de Control', iconClassName: 'geo-icon-amber', indicatorClass: 'geo-indicator-amber' },
            { key: 'mostrarAperturas', icon: Gauge, title: 'Ver Apertura de Compuertas', iconClassName: 'geo-icon-teal', indicatorClass: 'geo-indicator-teal' },
        ],
    },
];

const SIDEBAR_ICON_SIZE = 19;

// Zoom mínimo para cargar/mostrar la capa de lotes: a niveles más alejados
// ~5,200 polígonos no se distinguen unos de otros y solo saturan el mapa.
const LOTES_MIN_ZOOM = 13;

// Bbox real de cada archivo lotes_modulo_N.geojson (calculado de la geometría
// convertida) — permite cargar solo los módulos que intersectan el viewport
// visible en vez de los 6 archivos (3.3 MB) de golpe al activar la capa.
// Fuente única de verdad: src/utils/modulosBbox.ts (también usada por el NDVI
// de Clima.tsx, que cobra por área consultada a Sentinel Hub).
const LOTES_MODULO_BBOX = MODULOS_BBOX;

interface ViewportBounds { minLon: number; minLat: number; maxLon: number; maxLat: number }

function bboxIntersecta(a: ViewportBounds, b: { minLon: number; minLat: number; maxLon: number; maxLat: number }): boolean {
    return a.minLon <= b.maxLon && a.maxLon >= b.minLon && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

/** Reporta zoom + bounds del mapa Leaflet al estado de React — usado para
 *  decidir qué módulos de lotes cargar bajo demanda sin montar un mapa nuevo. */
function MapViewportWatcher({ onChange }: { onChange: (zoom: number, bounds: ViewportBounds) => void }) {
    const map = useMapEvents({
        zoomend: () => {
            const b = map.getBounds();
            onChange(map.getZoom(), { minLon: b.getWest(), minLat: b.getSouth(), maxLon: b.getEast(), maxLat: b.getNorth() });
        },
        moveend: () => {
            const b = map.getBounds();
            onChange(map.getZoom(), { minLon: b.getWest(), minLat: b.getSouth(), maxLon: b.getEast(), maxLat: b.getNorth() });
        },
    });
    // moveend/zoomend no disparan al montar — se reporta el viewport inicial
    // una vez para que la capa de lotes funcione sin que el usuario mueva el mapa antes.
    useEffect(() => {
        const b = map.getBounds();
        onChange(map.getZoom(), { minLon: b.getWest(), minLat: b.getSouth(), maxLon: b.getEast(), maxLat: b.getNorth() });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
}

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
    apertura_radiales_m?: number;
}
interface PresaData {
    presa_id: string; nombre: string; latitud: number; longitud: number;
    almacenamiento_mm3: number; porcentaje_llenado: number;
    extraccion_total_m3s: number; fecha: string;
    // Fase 1: nivel real del vaso (msnm) y metadatos de capacidad — antes
    // GeoMonitor los hardcodeaba por presa_id en vez de leerlos de la BD.
    escala_msnm: number | null;
    capacidad_max: number | null;
    elevacion_corona_msnm: number | null;
    curvas_capacidad: { elevacion_msnm: number; volumen_mm3: number; area_ha: number | null }[];
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
    volumen_acumulado?: number;
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
    const navigate = useNavigate();
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
    const [tomasVaradas, setTomasVaradas] = useState<VwAlertaTomaVaradaRow[]>([]);
    const [latestAforos, setLatestAforos] = useState<Record<string, any>>({});
    const [totalDemandaProgramada, setTotalDemandaProgramada] = useState(0);
    // Caudal objetivo por módulo (id 'MOD-N' → { nombre, caudal_objetivo }),
    // usado para cruzar contra la ETo de la estación climática asignada a ese
    // módulo (Fase 4, auditoría ago-2026: antes la ETo solo se mostraba suelta
    // en un tooltip, sin relacionarse con ninguna demanda).
    const [modulosCaudalObjetivo, setModulosCaudalObjetivo] = useState<Record<string, { nombre: string; caudal_objetivo: number }>>({});
    const [loading, setLoading] = useState(true);
    const [showVaso, setShowVaso] = useState(false);
    // Qué sección debe enfocar PresaVasoMonitor al abrirse — 'satelital' (NDWI
    // del día, comportamiento previo), 'ciclo' (comparativa mensual, botón
    // dedicado para no obligar a bajar manualmente en un modal largo) o
    // 'relieve3d' (visor 3D con terreno real/hillshade — antes solo alcanzable
    // bajando hasta Evolución del Vaso y haciendo clic en "Ver en 3D"; con
    // este acceso directo desde el mapa, PresaVasoMonitor activa el visor
    // automáticamente al abrir en vez de requerir ese clic adicional).
    const [seccionVasoInicial, setSeccionVasoInicial] = useState<'satelital' | 'ciclo' | 'relieve3d'>('satelital');
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    // Sección dedicada de NDVI mensual por módulo (histórico, polígono exacto
    // vía sentinel-ndvi-modulo-sync) — separada del NDVI puntual bajo-demanda
    // de consultarNdviModulo/moduloNdvi (clic en el polígono), que sigue intacto.
    const [showNdviModulos, setShowNdviModulos] = useState(false);

    // Eventos Hidro-Sincrónicos
    const { activeEvent } = useHydricEvents();
    const { estaciones: estacionesClima } = useClimaEstaciones();
    const [maxKmLlenado, setMaxKmLlenado] = useState<number>(1000);

    // Fase 5 (auditoría ago-2026): ETA calibrado dinámicamente (Modelo A,
    // fn_celeridad_onda_ms) desde vw_prediccion_arribo_escalas — la misma vista
    // que ya usa ArrivalPredictor.tsx y que Canaleros retroalimenta al confirmar
    // arribo real. Se muestra JUNTO a la velocidad visual local (predictedMaxKm),
    // no la reemplaza: cambiar el frente animado en sí requiere coordinación con
    // Canaleros durante protocolos en curso (ver notas de riesgo del informe).
    interface EtaCalibrado { nombre: string; km: number; hora_arribo_estimada: string; v_onda_kmh: number }
    const [etaCalibrado, setEtaCalibrado] = useState<EtaCalibrado | null>(null);

    useEffect(() => {
        if (activeEvent?.evento_tipo !== 'LLENADO') { setEtaCalibrado(null); return; }
        let cancelado = false;
        const cargar = async () => {
            const { data } = await supabase
                .from('vw_prediccion_arribo_escalas')
                .select('nombre, km, hora_arribo_estimada, v_onda_kmh')
                .order('km', { ascending: true });
            if (cancelado || !data) return;
            // Próxima escala aguas abajo del frente confirmado (maxKmLlenado).
            const siguiente = data.find((d: any) => d.km > maxKmLlenado);
            setEtaCalibrado(siguiente ? {
                nombre: siguiente.nombre, km: siguiente.km,
                hora_arribo_estimada: siguiente.hora_arribo_estimada, v_onda_kmh: siguiente.v_onda_kmh,
            } : null);
        };
        cargar();
        const interval = setInterval(cargar, 60_000);
        return () => { cancelado = true; clearInterval(interval); };
    }, [activeEvent, maxKmLlenado]);

    // Fetch Max KM for LLENADO
    useEffect(() => {
        if (activeEvent?.evento_tipo === 'LLENADO') {
            const fetchMaxKm = async () => {
                const { data } = await supabase
                    .from('sica_llenado_seguimiento')
                    .select('km')
                    .eq('evento_id', activeEvent.id)
                    .not('hora_real', 'is', null)
                    .order('km', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                if (data) {
                    setMaxKmLlenado(data.km || 0);
                    // Anchor Logic: Save confirmation time for prediction
                    const { data: latestConfirm } = await supabase
                        .from('sica_llenado_seguimiento')
                        .select('hora_real')
                        .eq('evento_id', activeEvent.id)
                        .eq('km', data.km)
                        .maybeSingle();
                    if (latestConfirm?.hora_real) {
                        sessionStorage.setItem(`anchor_time_${data.km}`, latestConfirm.hora_real);
                    }
                }
                else if (activeEvent.hora_apertura_real) setMaxKmLlenado(-36); // Started at dam
                else setMaxKmLlenado(-36);
            };
            fetchMaxKm();

            const unsubWave = onTable('sica_llenado_seguimiento', 'UPDATE', fetchMaxKm);
            return () => unsubWave();
        } else {
            setMaxKmLlenado(1000); // Allow all KM if not filling
        }
    }, [activeEvent]);

    // 5. Predicted Front Position (Hydra Engine Logic)
    const predictedMaxKm = useMemo(() => {
        if (activeEvent?.evento_tipo !== 'LLENADO' || !activeEvent.hora_apertura_real) return -36;
        
        // Anchor logic
        let startTime = new Date(activeEvent.hora_apertura_real).getTime();
        let startKm = -36;

        if (maxKmLlenado > -36 && maxKmLlenado < 1000) {
            const anchorTimeStr = sessionStorage.getItem(`anchor_time_${maxKmLlenado}`);
            if (anchorTimeStr) {
                startTime = new Date(anchorTimeStr).getTime();
                startKm = maxKmLlenado;
            }
        }

        const elapsedHours = (currentTime.getTime() - startTime) / (1000 * 3600);
        if (elapsedHours <= 0) return startKm;

        // NOTA (auditoría Geo-Monitor, ago-2026): esta NO es la celeridad de onda
        // calibrada con datos de campo — esa es WAVE_CELERITY_MS = 0.80 m/s
        // (2.88 km/h, hydraulics.ts, confianza declarada: WAVE_CELERITY_CONFIANZA).
        // vCanal = 6.0 km/h es una velocidad ajustada visualmente para que el
        // frente animado alcance el KM 68 a una hora ancla determinada — casi el
        // doble de la calibrada. Se mantiene así deliberadamente (cambiarla altera
        // la posición del frente durante protocolos de llenado en curso; requiere
        // coordinación con Canaleros antes de ajustar). WAVE_CELERITY_MS queda
        // importada y disponible para quien decida reconciliar ambos valores.
        void WAVE_CELERITY_MS; void WAVE_CELERITY_CONFIANZA;
        const vRio = 3.0; // km/h
        const vCanal = activeEvent?.evento_tipo === 'LLENADO' ? 6.0 : (1.16 * 3.6); // km/h — velocidad visual, no BC-07

        let currentKm = startKm;
        let remainingHours = elapsedHours;

        if (currentKm < 0) {
            const distToZero = Math.abs(currentKm);
            const timeToZero = distToZero / vRio;
            if (remainingHours <= timeToZero) {
                currentKm += remainingHours * vRio;
                remainingHours = 0;
            } else {
                currentKm = 0;
                remainingHours -= timeToZero;
            }
        }

        if (remainingHours > 0) {
            currentKm += remainingHours * vCanal;
        }

        return Math.min(currentKm, 113);
    }, [activeEvent, maxKmLlenado, currentTime]);

    const effectiveMaxKm = useMemo(() => {
        if (activeEvent?.evento_tipo !== 'LLENADO') return 1000;
        return Math.max(maxKmLlenado, predictedMaxKm);
    }, [activeEvent, maxKmLlenado, predictedMaxKm]);

    // NDVI agregado por módulo (Fase 4, auditoría ago-2026): bajo demanda al
    // hacer clic en un polígono de módulo, vía Statistical API de Sentinel Hub.
    // Por módulo y no por lote — la Statistical API cobra por cálculo, y una
    // llamada por cada uno de los ~5,200 lotes sería inviable en costo.
    interface ModuloNdviResult {
        numeroModulo: number; nombre: string; superficieHa: number | null; cargando: boolean; error: string | null;
        ndvi_medio: number | null; ndvi_min: number | null; ndvi_max: number | null;
        muestras_validas: number | null; hasta: string | null;
    }
    const [moduloNdvi, setModuloNdvi] = useState<ModuloNdviResult | null>(null);

    const consultarNdviModulo = useCallback(async (numeroModulo: number, nombre: string, superficieHa: number | null, coords: [number, number][]) => {
        setModuloNdvi({ numeroModulo, nombre, superficieHa, cargando: true, error: null, ndvi_medio: null, ndvi_min: null, ndvi_max: null, muestras_validas: null, hasta: null });
        try {
            const lons = coords.map(c => c[0]), lats = coords.map(c => c[1]);
            const minLon = Math.min(...lons), maxLon = Math.max(...lons);
            const minLat = Math.min(...lats), maxLat = Math.max(...lats);
            const { data, error } = await supabase.functions.invoke('sentinel-ndvi-modulo', {
                body: { minLon, minLat, maxLon, maxLat, diasVentana: 30 },
            });
            if (error || data?.error) {
                setModuloNdvi(prev => prev && { ...prev, cargando: false, error: error?.message || data?.error || 'Error desconocido' });
                return;
            }
            if (!data?.encontrada) {
                setModuloNdvi(prev => prev && { ...prev, cargando: false, error: data?.mensaje || 'Sin escenas disponibles' });
                return;
            }
            setModuloNdvi(prev => prev && {
                ...prev, cargando: false, error: null,
                ndvi_medio: data.ndvi_medio, ndvi_min: data.ndvi_min, ndvi_max: data.ndvi_max,
                muestras_validas: data.muestras_validas, hasta: data.hasta,
            });
        } catch (e) {
            setModuloNdvi(prev => prev && { ...prev, cargando: false, error: String(e) });
        }
    }, []);

    // Balance ETo vs. demanda programada del módulo actualmente mostrado en el
    // panel de NDVI (mismo trigger de clic sobre el polígono — no hace falta
    // un segundo botón). Usa la estación climática ya asignada a ese módulo
    // (EstacionClima.modulo_id) y la superficie del polígono para convertir
    // ETo (mm/día) a caudal equivalente (m³/s): Q = ETo·Superficie·10/86400.
    const balanceEtoModulo = useMemo(() => {
        if (!moduloNdvi) return null;
        const moduloId = `MOD-${moduloNdvi.numeroModulo}`;
        const estacion = estacionesClima.find(e => e.modulo_id === moduloId);
        const eto = estacion?.lectura?.eto_mm ?? estacion?.lectura?.et_dia_mm ?? null;
        const cad = modulosCaudalObjetivo[moduloId];
        if (!estacion || eto === null || !cad) return { estacion: estacion ?? null, eto, disponible: false as const };

        const superficieHa = moduloNdvi.superficieHa;
        if (!superficieHa) return { estacion, eto, disponible: false as const };

        const demandaEtoM3s = (eto * superficieHa * 10) / 86400;
        const balance = cad.caudal_objetivo - demandaEtoM3s; // + = superávit, - = déficit
        return {
            disponible: true as const,
            estacion, eto, superficieHa,
            demandaEtoM3s, caudalObjetivo: cad.caudal_objetivo, balance,
        };
    }, [moduloNdvi, estacionesClima, modulosCaudalObjetivo]);

    // Alerta anticipada de lluvia 48h (Fase 4, auditoría ago-2026): el pronóstico
    // ya se sincroniza cada hora (clima-pronostico-sync) y ya llega a la app vía
    // useClimaEstaciones, pero solo era visible en el módulo Clima — no había
    // puente hacia el HUD de protocolo, donde el operador decide apertura/cierre.
    const alertaLluvia48h = useMemo(() => {
        let maxProbPct: number | null = null;
        let horaMaxProb: string | null = null;
        let mmAcumulado48h = 0;
        for (const est of estacionesClima) {
            for (const h of est.pronosticoSerie) {
                if (h.horizonte_h == null || h.horizonte_h < 0 || h.horizonte_h > 48) continue;
                if (h.precip_prob_pct != null && (maxProbPct === null || h.precip_prob_pct > maxProbPct)) {
                    maxProbPct = h.precip_prob_pct;
                    horaMaxProb = h.valido_en;
                }
                mmAcumulado48h += h.precip_mm ?? 0;
            }
        }
        return { maxProbPct, horaMaxProb, mmAcumulado48h };
    }, [estacionesClima]);

    // Layer Toggles — declarado antes de modulosLotesVisibles (más abajo), que
    // lee layers.lotes: moverlo después causaba "Cannot access 'layers' before
    // initialization" (temporal dead zone) al montar Geo-Monitor.
    const [layers, setLayers] = useState({
        canal: true,
        escalas: true,
        tomas: true,
        alertas: true,
        modulos: true,
        presasShape: true,
        rioShape: true,
        mostrarAforosQ: true,
        mostrarAperturas: true,
        estaciones: true,
        // Apaga por defecto: ~5,200 lotes en 6 archivos (3.3 MB) no deben
        // descargarse en cada visita a Geo-Monitor — el usuario la activa
        // explícitamente y solo entonces se cargan bajo demanda.
        lotes: false,
    });

    // GeoJSON Layers (Shapes)
    const [geoModulos, setGeoModulos] = useState<GeoJSON.FeatureCollection | null>(null);
    const [geoPresas, setGeoPresas] = useState<GeoJSON.FeatureCollection | null>(null);
    const [geoCanal, setGeoCanal] = useState<GeoJSON.FeatureCollection | null>(null);
    const [geoRio, setGeoRio] = useState<GeoJSON.FeatureCollection | null>(null);
    const [customLayers, setCustomLayers] = useState<GeoLayer[]>([]);
    const [showImporter, setShowImporter] = useState(false);
    const [showWindy, setShowWindy] = useState(false);
    const [geoKey, setGeoKey] = useState(0); // Force re-render on geojson change

    // Lotes (catastro de productores): carga bajo demanda, solo módulos
    // visibles en el viewport y solo a partir de LOTES_MIN_ZOOM. Cache por
    // módulo para no re-descargar al hacer pan/zoom dentro de la misma zona.
    const [mapZoom, setMapZoom] = useState(10);
    const [mapBounds, setMapBounds] = useState<ViewportBounds | null>(null);
    const [geoLotesPorModulo, setGeoLotesPorModulo] = useState<Record<number, GeoJSON.FeatureCollection>>({});
    const lotesEnCarga = useRef<Set<number>>(new Set());

    const modulosLotesVisibles = useMemo(() => {
        if (!layers.lotes || mapZoom < LOTES_MIN_ZOOM || !mapBounds) return [];
        return LOTES_MODULO_BBOX.filter(m => bboxIntersecta(mapBounds, m)).map(m => m.modulo);
    }, [layers.lotes, mapZoom, mapBounds]);

    useEffect(() => {
        for (const modulo of modulosLotesVisibles) {
            if (geoLotesPorModulo[modulo] || lotesEnCarga.current.has(modulo)) continue;
            lotesEnCarga.current.add(modulo);
            fetch(`/geo/lotes_modulo_${modulo}.geojson`)
                .then(r => r.ok ? r.json() : null)
                .then((fc: GeoJSON.FeatureCollection | null) => {
                    if (fc) setGeoLotesPorModulo(prev => ({ ...prev, [modulo]: fc }));
                })
                .catch(() => { /* módulo sin capa de lotes disponible: se omite en silencio */ })
                .finally(() => lotesEnCarga.current.delete(modulo));
        }
    }, [modulosLotesVisibles, geoLotesPorModulo]);

    // Panel de KPIs (.geo-stats-panel): columna fija en escritorio, drawer
    // deslizable en tablet (≤1024px) activado por este estado.
    const [statsOpen, setStatsOpen] = useState(false);

    // Centro de referencia del mapa (Canal Principal Conchos), también usado
    // para consultar el Catalog API de Sentinel Hub (qué escena cubre este punto).
    const mapCenter: [number, number] = [28.02, -105.42];

    const [baseLayer, setBaseLayer] = useState<'standard' | 'satellite' | 'eos' | 'sentinel'>(() => {
        return (localStorage.getItem('geo_base_layer') as any) || 'satellite';
    });
    const [eosUrl, setEosUrl] = useState<string>(() => {
        return localStorage.getItem('geo_eos_url') || '';
    }); // Para almacenar la URL WMS de EOS

    // Sentinel Hub (Copernicus): instance ID de configuration WMS del usuario +
    // capa temática activa. TRUE_COLOR = imagen natural, NDVI = vigor vegetativo,
    // MOISTURE_INDEX = humedad de suelo/vegetación — capas predefinidas del
    // "Sentinel Hub custom scripts repository", disponibles en cualquier
    // configuration WMS estándar creada en el dashboard de Sentinel Hub.
    const [sentinelInstanceId, setSentinelInstanceId] = useState<string>(() => {
        return (
            localStorage.getItem('geo_sentinel_instance_id') ||
            import.meta.env.VITE_SENTINEL_INSTANCE_ID ||
            ''
        );
    });
    const [sentinelLayer, setSentinelLayer] = useState<'1_TRUE_COLOR' | '3_NDVI' | '7_NDWI' | '9_NDVI_AGRO'>(() => {
        const saved = localStorage.getItem('geo_sentinel_layer');
        const validas = ['1_TRUE_COLOR', '3_NDVI', '7_NDWI', '9_NDVI_AGRO'];
        // Guarda contra nombres de capa de una versión anterior (p. ej. 'NDVI'
        // sin prefijo numérico) que ya no existen en la configuration WMS real.
        return (validas.includes(saved ?? '') ? saved : '3_NDVI') as '1_TRUE_COLOR' | '3_NDVI' | '7_NDWI' | '9_NDVI_AGRO';
    });
    // 'reciente' = último día disponible aunque tenga nubes; 'legible' = la
    // imagen más clara de los últimos 30 días (comportamiento previo por defecto).
    const [sentinelModo, setSentinelModo] = useState<'reciente' | 'legible'>(() => {
        return (localStorage.getItem('geo_sentinel_modo') as any) || 'legible';
    });
    // Metadatos de la escena mostrada (fecha real + nubosidad), resueltos vía
    // sentinel-catalog-search — el WMS por sí solo no expone qué fecha eligió.
    const [sentinelEscena, setSentinelEscena] = useState<{
        fecha: string | null; nubosidad: number | null; cargando: boolean; error: string | null;
    }>({ fecha: null, nubosidad: null, cargando: false, error: null });

    // Estado de la cuenta de Sentinel Hub (tabla sentinel_hub_status, escrita
    // por la edge function sentinel-status vía cron cada 6h). Se lee sola vez
    // al montar — NO golpea Sentinel Hub directo, así que no cuesta cuota.
    // Sirve para el banner "Sentinel disponible de nuevo" cuando el usuario
    // está en satélite (por el fallback de tileerror) y el servicio ya
    // volvió — la capa NUNCA cambia sola, solo se avisa.
    const [sentinelHubStatus, setSentinelHubStatus] = useState<{
        disponible: boolean; mensaje: string | null;
        processing_units_usadas: number | null; processing_units_limite: number | null;
        ultima_verificacion: string | null; ultima_vez_disponible: string | null;
    } | null>(null);
    const [verificandoSentinelHub, setVerificandoSentinelHub] = useState(false);

    // Contador de tiles fallidos del WMS de Sentinel — un solo tileerror NO
    // basta para asumir que el servicio está caído: un mosaico satelital
    // normal descarga docenas de tiles por vista, y es común que 1-2 fallen
    // por timeout de red o por caer justo en el borde de la escena
    // disponible, sin que el resto del servicio esté afectado. Antes,
    // cualquier tileerror aislado tiraba baseLayer a 'satellite' de
    // inmediato, lo que hacía parecer que Sentinel Hub "se apagaba solo"
    // segundos después de activarlo. Ahora solo se cae a satélite si varios
    // tiles fallan seguidos (SENTINEL_TILEERROR_UMBRAL), señal más confiable
    // de que la cuenta/instance ID realmente no está sirviendo nada.
    const sentinelTileErrorCount = useRef(0);

    const recargarSentinelHubStatus = useCallback(async () => {
        const { data } = await supabase
            .from('sentinel_hub_status')
            .select('disponible, mensaje, processing_units_usadas, processing_units_limite, ultima_verificacion, ultima_vez_disponible')
            .limit(1)
            .maybeSingle();
        if (data) setSentinelHubStatus(data as typeof sentinelHubStatus);
    }, []);

    useEffect(() => { recargarSentinelHubStatus(); }, [recargarSentinelHubStatus]);

    const verificarSentinelHubAhora = useCallback(async () => {
        setVerificandoSentinelHub(true);
        try {
            await supabase.functions.invoke('sentinel-status', { body: {} });
        } finally {
            await recargarSentinelHubStatus();
            setVerificandoSentinelHub(false);
        }
    }, [recargarSentinelHubStatus]);

    // Menú desplegable de capa base: un botón, no cuatro, para no saturar la
    // columna de controles (que ya tiene 11 toggles de contenido).
    // El menú se posiciona `fixed` con coordenadas calculadas del botón —
    // `.geo-main-content` tiene overflow:hidden (para contener el mapa), así
    // que un `absolute` anidado ahí adentro se recorta y queda invisible.
    const [baseLayerMenuOpen, setBaseLayerMenuOpen] = useState(false);
    // 'top' ancla el menú creciendo hacia abajo desde el botón; 'bottom' lo
    // ancla creciendo hacia arriba — necesario porque el botón vive al fondo
    // del sidebar, y el menú (con los chips de Sentinel Hub + fecha) puede
    // medir más que el espacio libre hacia abajo y salirse de la pantalla.
    const [baseLayerMenuPos, setBaseLayerMenuPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
    const baseLayerMenuRef = useRef<HTMLDivElement>(null);
    const baseLayerTriggerRef = useRef<HTMLButtonElement>(null);

    const openBaseLayerMenu = () => {
        const rect = baseLayerTriggerRef.current?.getBoundingClientRect();
        if (rect) {
            const espacioAbajo = window.innerHeight - rect.top;
            const left = rect.right + 8;
            // Estimado generoso (el menú de Sentinel Hub con chips + fecha
            // puede superar 300px); si no cabe hacia abajo, se ancla al piso
            // de la ventana y crece hacia arriba desde ahí.
            if (espacioAbajo < 320) {
                setBaseLayerMenuPos({ left, bottom: window.innerHeight - rect.bottom });
            } else {
                setBaseLayerMenuPos({ left, top: rect.top });
            }
        }
        setBaseLayerMenuOpen(v => !v);
    };

    useEffect(() => {
        if (!baseLayerMenuOpen) return;
        const onClickOutside = (e: MouseEvent) => {
            if (baseLayerMenuRef.current && !baseLayerMenuRef.current.contains(e.target as Node)
                && baseLayerTriggerRef.current && !baseLayerTriggerRef.current.contains(e.target as Node)) {
                setBaseLayerMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [baseLayerMenuOpen]);

    useEffect(() => {
        localStorage.setItem('geo_base_layer', baseLayer);
    }, [baseLayer]);

    useEffect(() => {
        if (eosUrl) localStorage.setItem('geo_eos_url', eosUrl);
    }, [eosUrl]);

    useEffect(() => {
        if (sentinelInstanceId) localStorage.setItem('geo_sentinel_instance_id', sentinelInstanceId);
    }, [sentinelInstanceId]);

    // Memoizado: si `params` se recalcula en cada render (GeoMonitor re-renderiza
    // seguido por datos en vivo), react-leaflet lo ve como "cambiado" y refresca
    // la capa WMS entera — tiles se descargan de nuevo y el fondo parpadea.
    const sentinelWmsParams = useMemo(() => {
        const diasVentana = sentinelModo === 'reciente' ? 3 : 30;
        const params: Record<string, unknown> = {
            layers: sentinelLayer,
            format: 'image/png',
            transparent: true,
            version: '1.3.0',
            time: `${new Date(Date.now() - diasVentana * 86400000).toISOString().slice(0, 10)}/${new Date().toISOString().slice(0, 10)}`,
        };
        // 'reciente' no filtra por nubosidad: prioriza que sea de hoy/ayer aunque
        // salga nublada — filtrar aquí forzaría a Sentinel Hub a buscar más atrás.
        if (sentinelModo === 'legible') params.maxcc = 40;
        return params;
    }, [sentinelLayer, sentinelModo]);

    useEffect(() => {
        localStorage.setItem('geo_sentinel_layer', sentinelLayer);
    }, [sentinelLayer]);

    useEffect(() => {
        localStorage.setItem('geo_sentinel_modo', sentinelModo);
    }, [sentinelModo]);

    // Fecha real de la escena mostrada: el WMS solo pinta el tile, no dice qué
    // día eligió dentro del rango — se resuelve aparte vía Catalog API (OAuth,
    // por eso corre en una Edge Function y no directo desde el navegador).
    useEffect(() => {
        if (baseLayer !== 'sentinel' || !sentinelInstanceId) return;
        let cancelado = false;
        setSentinelEscena(prev => ({ ...prev, cargando: true, error: null }));

        supabase.functions.invoke('sentinel-catalog-search', {
            body: { lat: mapCenter[0], lon: mapCenter[1], modo: sentinelModo },
        }).then(({ data, error }) => {
            if (cancelado) return;
            if (error || data?.error) {
                setSentinelEscena({ fecha: null, nubosidad: null, cargando: false, error: error?.message || data?.error || 'Error desconocido' });
                return;
            }
            if (!data?.encontrada) {
                setSentinelEscena({ fecha: null, nubosidad: null, cargando: false, error: data?.mensaje || 'Sin escenas disponibles' });
                return;
            }
            setSentinelEscena({ fecha: data.fecha_captura, nubosidad: data.nubosidad_pct, cargando: false, error: null });
        }).catch((err) => {
            if (!cancelado) setSentinelEscena({ fecha: null, nubosidad: null, cargando: false, error: String(err) });
        });

        return () => { cancelado = true; };
    }, [baseLayer, sentinelInstanceId, sentinelModo]);

    const toggleLayer = (key: keyof typeof layers) => {
        setLayers(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // Cargar GeoJSON estáticos desde /public/geo/
    useEffect(() => {
        const loadGeoFiles = async () => {
            try {
                const [modRes, preRes, canRes, rioRes] = await Promise.all([
                    fetch('/geo/modulos.geojson').then(r => r.ok ? r.json() : null).catch(() => null),
                    fetch('/geo/presas.geojson').then(r => r.ok ? r.json() : null).catch(() => null),
                    fetch('/geo/canal_conchos.geojson').then(r => r.ok ? r.json() : null).catch(() => null),
                    fetch('/geo/rio_conchos.geojson').then(r => r.ok ? r.json() : null).catch(() => null),
                ]);
                // El geojson trae los NOMBRES cambiados; se filtra a los 6 módulos
                // de la SRL Conchos y se corrige nombre/número/color con el mapeo real.
                if (modRes?.features) {
                    const feats = (modRes.features as GeoJSON.Feature[])
                        .filter(f => esModuloSRL(Number(f.properties?.numero_modulo)))
                        .map(f => {
                            const m = moduloSRLde(Number(f.properties?.numero_modulo))!;
                            return { ...f, properties: { ...f.properties, nombre: m.nombre, numero_modulo: m.numero, color: m.color } };
                        });
                    setGeoModulos({ ...modRes, features: feats });
                } else if (modRes) setGeoModulos(modRes);
                if (preRes) setGeoPresas(preRes);
                if (canRes) setGeoCanal(canRes);
                if (rioRes) setGeoRio(rioRes);
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

    // Selection & Filter States
    const [selectedPoint, setSelectedPoint] = useState<{ type: 'escala' | 'toma' | 'presa'; data: any } | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState<'all' | 'open' | 'closed' | 'alert'>('all');

    // Filtered data
    const filteredTomas = useMemo(() => {
        let list = tomas;
        if (activeFilter === 'open') list = list.filter(t => t.estado !== 'cierre');
        if (activeFilter === 'closed') list = list.filter(t => t.estado === 'cierre');
        if (activeFilter === 'alert') {
            const varadasIds = new Set(tomasVaradas.map(tv => tv.punto_id));
            list = list.filter(t => varadasIds.has(t.id));
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            list = list.filter(t => t.nombre.toLowerCase().includes(q) || (t.km?.toString()?.includes(q) || false));
        }
        return list;
    }, [tomas, activeFilter, searchQuery, tomasVaradas]);

    // Selection Handler Helper
    const handleSelect = (type: 'escala' | 'toma' | 'presa', data: any) => {
        setSelectedPoint({ type, data });
    };

    // Historial real del punto seleccionado (Fase 1: reemplaza la serie ficticia
    // fija que se mostraba sin importar qué escala/toma/presa se hubiera elegido).
    // Granularidad real disponible: lecturas_escalas/lecturas_presas traen una
    // lectura por día (no series intradía), y reportes_diarios es una vista por
    // día — así que el historial es "últimos N días", no "24 horas".
    const [historySeries, setHistorySeries] = useState<{ labels: string[]; values: number[]; unit: string; seriesName: string } | null>(null);
    const [historyLoading, setHistoryLoading] = useState(false);

    useEffect(() => {
        if (!selectedPoint) { setHistorySeries(null); return; }
        let cancelado = false;
        setHistoryLoading(true);

        const cargarHistorial = async () => {
            const fechaDesde = addDays(getTodayString(), -14);
            try {
                if (selectedPoint.type === 'escala') {
                    const { data } = await supabase
                        .from('lecturas_escalas')
                        .select('fecha, nivel_m')
                        .eq('escala_id', selectedPoint.data.id)
                        .gte('fecha', fechaDesde)
                        .order('fecha', { ascending: true });
                    if (cancelado) return;
                    setHistorySeries({
                        labels: (data || []).map(d => formatDate(new Date(d.fecha + 'T00:00:00'), { day: '2-digit', month: 'short' })),
                        values: (data || []).map(d => parseFloat(String(d.nivel_m ?? 0))),
                        unit: 'm', seriesName: 'Nivel (m)',
                    });
                } else if (selectedPoint.type === 'presa') {
                    const { data } = await supabase
                        .from('lecturas_presas')
                        .select('fecha, porcentaje_llenado')
                        .eq('presa_id', selectedPoint.data.presa_id)
                        .gte('fecha', fechaDesde)
                        .order('fecha', { ascending: true });
                    if (cancelado) return;
                    setHistorySeries({
                        labels: (data || []).map(d => formatDate(new Date(d.fecha + 'T00:00:00'), { day: '2-digit', month: 'short' })),
                        values: (data || []).map(d => parseFloat(String(d.porcentaje_llenado ?? 0))),
                        unit: '%', seriesName: 'Llenado (%)',
                    });
                } else {
                    // toma: reportes_diarios es la única fuente con granularidad diaria real
                    const { data } = await supabase
                        .from('reportes_diarios')
                        .select('fecha, caudal_promedio_m3s')
                        .eq('punto_id', selectedPoint.data.id)
                        .gte('fecha', fechaDesde)
                        .order('fecha', { ascending: true });
                    if (cancelado) return;
                    setHistorySeries({
                        labels: (data || []).map(d => formatDate(new Date((d.fecha ?? '') + 'T00:00:00'), { day: '2-digit', month: 'short' })),
                        values: (data || []).map(d => parseFloat(String(d.caudal_promedio_m3s ?? 0))),
                        unit: 'm³/s', seriesName: 'Caudal (m³/s)',
                    });
                }
            } catch (e) {
                console.error('Error cargando historial:', e);
                if (!cancelado) setHistorySeries({ labels: [], values: [], unit: '', seriesName: '' });
            } finally {
                if (!cancelado) setHistoryLoading(false);
            }
        };
        cargarHistorial();
        return () => { cancelado = true; };
    }, [selectedPoint]);

    // Data Fetching (Prioridad 1)
    const fetchAllData = useCallback(async () => {
        try {
            // P2-9: addDays usa noon-UTC como ancla — correcto durante cambio de horario
            const todayStr = getTodayString();
            const fiveDaysAgoStr = addDays(todayStr, -7);
            
            const metaStore = useMetadataStore.getState();
            if (!metaStore.last_fetched) await metaStore.fetchMetadata();

            const [
                { data: resData },
                { data: lecData },
                { data: lpData },
                { data: afData },
                { data: tvData },
                { data: roData },
                { data: rdVolData },
                { data: modStaticData }
            ] = await Promise.all([
                supabase.from('resumen_escalas_diario').select('escala_id, nivel_actual, delta_12h, estado, fecha, lectura_am, lectura_pm').gte('fecha', fiveDaysAgoStr).order('fecha', { ascending: false }),
                supabase.from('lecturas_escalas').select('escala_id, apertura_radiales_m, fecha, hora_lectura').gte('fecha', fiveDaysAgoStr).order('fecha', { ascending: false }).order('hora_lectura', { ascending: false }),
                supabase.from('lecturas_presas').select('presa_id, almacenamiento_mm3, porcentaje_llenado, extraccion_total_m3s, escala_msnm, fecha').order('fecha', { ascending: false }).limit(3),
                supabase.from('aforos').select('punto_control_id, gasto_calculado_m3s, fecha, hora_inicio').gte('fecha', fiveDaysAgoStr).order('fecha', { ascending: false }).order('hora_inicio', { ascending: false }),
                supabase.from('vw_alertas_tomas_varadas').select('*'),
                supabase.from('reportes_operacion').select('punto_id, estado, caudal_promedio, hora_apertura, volumen_acumulado', { count: 'exact' }).eq('fecha', todayStr),
                supabase.from('reportes_diarios').select('punto_id, volumen_total_mm3, hora_apertura, hora_cierre, caudal_promedio_m3s').gte('fecha', fiveDaysAgoStr),
                supabase.from('modulos').select('id, nombre, caudal_objetivo')
            ]);
            
            const escData = metaStore.escalas;
            const afMedData = metaStore.aforos_control;
            const secData = metaStore.secciones;
            const peData = metaStore.puntos_entrega;

            // 1. Process Escalas
            const resMap = new Map();
            resData?.forEach((r: any) => {
                if (!resMap.has(r.escala_id)) {
                    const isDataValid = !activeEvent?.hora_apertura_real || 
                                       new Date(r.fecha + 'T00:00:00Z') >= new Date(activeEvent.hora_apertura_real.split('T')[0] + 'T00:00:00Z');
                    if (isDataValid) resMap.set(r.escala_id, r);
                }
            });

            const apMap = new Map<string, number>();
            lecData?.forEach(l => {
                if (!apMap.has(l.escala_id)) {
                    const lTime = new Date(`${l.fecha}T${l.hora_lectura}`);
                    const aTime = activeEvent?.hora_apertura_real ? new Date(activeEvent.hora_apertura_real) : new Date(0);
                    if (lTime >= aTime) apMap.set(l.escala_id, parseFloat(l.apertura_radiales_m || 0));
                }
            });

            setEscalas((escData || []).map((e: any) => ({
                ...e,
                nivel_actual: resMap.get(e.id)?.nivel_actual !== undefined ? parseFloat(resMap.get(e.id).nivel_actual) : undefined,
                delta_12h: resMap.get(e.id)?.delta_12h !== undefined ? parseFloat(resMap.get(e.id).delta_12h) : undefined,
                estado: resMap.get(e.id)?.estado || 'sin_datos',
                fecha_lectura: resMap.get(e.id)?.fecha || null,
                apertura_radiales_m: apMap.get(e.id) || 0,
            })));

            // 2. Process Presas
            const pMap = new Map<string, PresaData>();
            (lpData || []).forEach((lp: any) => {
                const meta = metaStore.presas.find(p => p.id === lp.presa_id);
                if (!pMap.has(lp.presa_id) && meta?.latitud) {
                    let extraccion = parseFloat(lp.extraccion_total_m3s || 0);
                    if (lp.presa_id === 'PRE-001' && activeEvent?.evento_tipo === 'LLENADO' && extraccion === 0) extraccion = activeEvent.gasto_solicitado_m3s || 30;
                    pMap.set(lp.presa_id, {
                        presa_id: lp.presa_id, nombre: meta.nombre,
                        latitud: meta.latitud ?? 0, longitud: meta.longitud ?? 0,
                        almacenamiento_mm3: Number(lp.almacenamiento_mm3 || 0),
                        porcentaje_llenado: Number(lp.porcentaje_llenado || 0),
                        extraccion_total_m3s: extraccion, fecha: lp.fecha,
                        escala_msnm: lp.escala_msnm !== null && lp.escala_msnm !== undefined ? Number(lp.escala_msnm) : null,
                        capacidad_max: meta.capacidad_max ?? null,
                        elevacion_corona_msnm: meta.elevacion_corona_msnm ?? null,
                        curvas_capacidad: (meta.curvas_capacidad || []).map(c => ({
                            elevacion_msnm: Number(c.elevacion_msnm), volumen_mm3: Number(c.volumen_mm3),
                            area_ha: c.area_ha !== null ? Number(c.area_ha) : null,
                        })),
                    });
                }
            });
            setPresas(Array.from(pMap.values()));

            // 3. Process Aforos (Merging meta coords with dynamic data)
            const afResult: Record<string, any> = {};
            (afData || []).forEach((a: any) => {
                if (!afResult[a.punto_control_id]) {
                    const meta = afMedData.find(m => m.id === a.punto_control_id);
                    if (meta) {
                        afResult[a.punto_control_id] = { ...a, latitud: meta.latitud ?? 0, longitud: meta.longitud ?? 0 };
                    }
                }
            });
            setLatestAforos(afResult);
            setAforos(Object.values(afResult));

            // 4. Process Secciones
            setSecciones((secData || []).map((s: any) => ({
                ...s, km_inicio: parseFloat(s.km_inicio), km_fin: parseFloat(s.km_fin)
            })));
            if (tvData) setTomasVaradas(tvData as VwAlertaTomaVaradaRow[]);

            // 5. Process Tomas
            const ptVolMap = new Map();
            const now = new Date();
            rdVolData?.forEach(r => {
                let vol = parseFloat(r.volumen_total_mm3 || 0);
                if (vol <= 0 && r.caudal_promedio_m3s > 0 && r.hora_apertura) {
                    const tStart = new Date(r.hora_apertura);
                    const diffHours = Math.max(0, (now.getTime() - tStart.getTime()) / (1000 * 3600));
                    vol = (r.caudal_promedio_m3s * 3600 * diffHours) / 1000000.0;
                }
                ptVolMap.set(r.punto_id, (ptVolMap.get(r.punto_id) || 0) + vol);
            });

            const roMap = new Map();
            const estadosAbiertos = new Set(['inicio', 'continua', 'reabierto', 'modificacion']);
            let tomasAbiertas = 0, gastoDistribuido = 0;
            roData?.forEach(r => {
                roMap.set(r.punto_id, r);
                if (estadosAbiertos.has(r.estado)) {
                    tomasAbiertas++;
                    gastoDistribuido += Number(r.caudal_promedio || 0);
                }
            });
            // Cerradas = total puntos de entrega (tomas) − las que están abiertas hoy
            const totalTomasPuntos = (peData || []).filter(p => p.coords_x && p.coords_y).length;
            const tomasCerradas = Math.max(0, totalTomasPuntos - tomasAbiertas);
            setOperStats({ tomas_abiertas: tomasAbiertas, tomas_cerradas: tomasCerradas, gasto_distribuido_m3s: gastoDistribuido });

            setTomas((peData || []).filter(p => p.coords_x && p.coords_y).map(p => {
                const sObj = roMap.get(p.id);
                const flow = sObj?.caudal_promedio ? parseFloat(sObj.caudal_promedio) : 0;
                return {
                    id: p.id, nombre: p.nombre, latitud: p.coords_y ?? 0, longitud: p.coords_x ?? 0,
                    km: p.km ?? undefined, modulo: p.modulo_id ?? undefined, estado: sObj?.estado || 'cierre',
                    caudal: flow, volumen_acumulado: ptVolMap.get(p.id) || 0
                };
            }));

            // 6. Stats & Demand
            const totalDemanda = (modStaticData || []).reduce((acc, curr) => acc + (parseFloat(curr.caudal_objetivo) || 0), 0);
            setTotalDemandaProgramada(totalDemanda);

            const caudalPorModulo: Record<string, { nombre: string; caudal_objetivo: number }> = {};
            (modStaticData || []).forEach((m: any) => {
                caudalPorModulo[m.id] = { nombre: m.nombre, caudal_objetivo: parseFloat(m.caudal_objetivo) || 0 };
            });
            setModulosCaudalObjetivo(caudalPorModulo);

        } catch (e) {
            console.error('GeoMonitor fetch error:', e);
        } finally {
            setLoading(false);
        }
        // Deps por CAMPO primitivo, no [activeEvent]: useHydricEvents entrega un
        // objeto nuevo (nueva referencia) en cada fetch aunque el protocolo activo
        // no haya cambiado — con [activeEvent] como dependencia, fetchAllData se
        // recreaba en cada uno de esos fetches, lo que reiniciaba el useEffect de
        // suscripciones realtime de abajo (desmonta+remonta las 5 suscripciones y
        // dispara un fetch completo) sin que hubiera ningún cambio real que
        // justificarlo — causa del "cada ventana se recarga periódicamente".
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeEvent?.evento_tipo, activeEvent?.hora_apertura_real, activeEvent?.gasto_solicitado_m3s]);

    // Reloj del header: separado del efecto de datos de abajo porque
    // fetchAllData se recrea (useCallback con dep [activeEvent]) cada vez que
    // useHydricEvents entrega un objeto activeEvent nuevo — Supabase devuelve
    // una referencia nueva en cada fetch aunque el protocolo activo no haya
    // cambiado (mismo id, mismos campos). Si el timer viviera en el mismo
    // efecto que las suscripciones realtime (deps [fetchAllData]), cada
    // cambio de referencia de activeEvent reiniciaba TODO: timer, fetch
    // completo y las 5 suscripciones — el "cada ventana se recarga
    // periódicamente" reportado. 60s (antes 1s): formatTime solo muestra
    // hora:minuto, sin segundos, así que 1s eran 60× re-renders del árbol
    // completo (mapa Leaflet con cientos de marcadores/popups + varios
    // useMemo pesados) sin ningún cambio visible en el reloj.
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        setTimeout(() => setMapReady(true), 100);
        fetchAllData();

        // Realtime: refresca al instante cuando llegan nuevas lecturas.
        // resumen_escalas_diario y reportes_diarios son VISTAS (no suscribibles
        // directo en Supabase Realtime) — quedan cubiertas indirectamente porque
        // se derivan de lecturas_escalas y reportes_operacion, ambas escuchadas aquí.
        const unsubEscalas = onTable('lecturas_escalas', '*', fetchAllData);
        const unsubPresas = onTable('lecturas_presas', '*', fetchAllData);
        const unsubAforos = onTable('aforos', '*', fetchAllData);
        const unsubReportes = onTable('reportes_operacion', '*', fetchAllData);
        const unsubModulos = onTable('modulos', '*', fetchAllData);

        // Fallback polling cada 5 min (cubre reconexiones, gaps de Realtime y las
        // dos vistas — vw_alertas_tomas_varadas y resumen_escalas_diario/reportes_diarios
        // cuando cambian por causas que sus tablas base no reflejan de inmediato).
        const refreshInterval = setInterval(fetchAllData, 300_000);

        return () => {
            clearInterval(refreshInterval);
            unsubEscalas();
            unsubPresas();
            unsubAforos();
            unsubReportes();
            unsubModulos();
        };
    }, [fetchAllData]);

    // Fullscreen Toggle (Prioridad 4) — CSS-only (position:fixed vía la
    // clase .geo-fullscreen), NO la Fullscreen API del navegador. Dos
    // intentos previos con Element.requestFullscreen + fallback webkit-
    // prefixed confirmaron en campo que Safari en iOS/iPadOS restringe esa
    // API casi exclusivamente a <video> — un <div> arbitrario nunca entra
    // en fullscreen real ahí, con o sin prefijo (iPadOS 16.4+). El toggle
    // de estado por sí solo, sin llamar a ninguna API del navegador,
    // funciona igual en iPad, iPhone, desktop y cualquier navegador.
    const toggleFullscreen = () => setIsFullscreen(v => !v);
    // Mapeo de distancias para el Río Conchos (36 km)
    const rioDistData = useMemo(() => {
        if (!geoRio) return [];
        const feature = geoRio.features?.[0];
        if (!feature || feature.geometry.type !== 'LineString') return [];

        const coords = feature.geometry.coordinates as [number, number][];
        if (!coords.length) return [];

        let totalDist = 0;
        const data = [{ lat: coords[0][1], lng: coords[0][0], dist: -36 }];
        for (let i = 1; i < coords.length; i++) {
            const d = haversineDist(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1]);
            totalDist += d;
            data.push({ lat: coords[i][1], lng: coords[i][0], dist: -36 + totalDist });
        }

        const corrFactor = totalDist > 0 ? 36 / totalDist : 1;
        data.forEach(d => {
            const actualDist = (d.dist + 36) * corrFactor;
            d.dist = -36 + actualDist;
        });
        return data;
    }, [geoRio]);

    // Mapeo de distancias para el Canal Conchos (104 km)
    const canalDistData = useMemo(() => {
        if (!geoCanal) return [];
        const feature = geoCanal.features?.[0];
        if (!feature || feature.geometry.type !== 'LineString') return [];

        const coords = feature.geometry.coordinates as [number, number][];
        if (!coords.length) return [];

        let totalDist = 0;
        const data = [{ lat: coords[0][1], lng: coords[0][0], dist: 0 }];
        for (let i = 1; i < coords.length; i++) {
            const d = haversineDist(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1]);
            totalDist += d;
            data.push({ lat: coords[i][1], lng: coords[i][0], dist: totalDist });
        }

        const corrFactor = totalDist > 0 ? 104 / totalDist : 1;
        data.forEach(d => d.dist *= corrFactor);
        return data;
    }, [geoCanal]);

    const canalSegmentsGeoref = useMemo(() => {
        if (!canalDistData.length || !secciones.length) return [];
        return secciones.map(sec => {
            const segPoints = canalDistData
                .filter(d => d.dist >= sec.km_inicio && d.dist <= sec.km_fin)
                .map(d => [d.lat, d.lng] as [number, number]);
            return { ...sec, points: segPoints };
        });
    }, [canalDistData, secciones]);

    // Calcular la onda visible de llenado (Río + Canal)
    const llenadoWaveGeoref = useMemo(() => {
        if (activeEvent?.evento_tipo !== 'LLENADO') return [];

        // 1. Puntos del Río que han sido alcanzados
        const rioWave = rioDistData
            .filter(d => d.dist <= effectiveMaxKm)
            .map(d => [d.lat, d.lng] as [number, number]);

        // 2. Puntos del Canal que han sido alcanzados (si effectiveMaxKm > 0)
        const canalWave = effectiveMaxKm > 0 
            ? canalDistData
                .filter(d => d.dist <= effectiveMaxKm)
                .map(d => [d.lat, d.lng] as [number, number])
            : [];

        return [...rioWave, ...canalWave];
    }, [rioDistData, canalDistData, activeEvent, effectiveMaxKm]);

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
    
    // Cálculo de Salud Operativa Global (MEJ-5) y Eficiencia/Pérdida
    let eficienciaReal = 0;
    let perdidaPct: string | null = null;
    let eficienciaTxt: string | null = null;
    const gastoDistribuido = operStats.gasto_distribuido_m3s;

    if (gastoEntrada && gastoEntrada > 0 && gastoSalida !== undefined) {
        // Eficiencia de Conducción: basada solo en lecturas de escala (consistencia temporal)
        // E = (Q_entrada - Q_salida) / Q_entrada — fracción del caudal que fue captada por el sistema
        // Q_tomas no se usa aquí porque sus promedios diarios son temporalmente inconsistentes con Q instantáneo de escala
        const captado = gastoEntrada - gastoSalida;
        eficienciaReal = Math.min(100, Math.max(0, (captado / gastoEntrada) * 100));
        eficienciaTxt = eficienciaReal.toFixed(1);

        // Pérdida = complemento de la eficiencia de conducción (misma medición, otra lectura)
        perdidaPct = (100 - eficienciaReal).toFixed(1);
    } else if (gastoEntrada && gastoEntrada > 0) {
        eficienciaReal = Math.min(100, totalDemandaProgramada > 0 ? (gastoDistribuido / totalDemandaProgramada) * 100 : 0);
        eficienciaTxt = eficienciaReal.toFixed(1);
    }

    const chartGaugeOptions = {
        series: [{
            type: 'gauge',
            center: ['50%', '60%'],
            startAngle: 210,
            endAngle: -30,
            min: 0,
            max: 120,
            splitNumber: 6,
            progress: {
                show: true, width: 14, roundCap: true,
                itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                        { offset: 0, color: '#0e7490' },
                        { offset: 1, color: '#22d3ee' }
                    ])
                }
            },
            pointer: {
                show: true, length: '65%', width: 5,
                itemStyle: { color: '#22d3ee' }
            },
            axisLine: {
                lineStyle: {
                    width: 14,
                    color: [[0.7, '#ef4565'], [0.85, '#f5a623'], [1, '#34d399']]
                }
            },
            axisTick: { show: false },
            splitLine: { distance: -18, length: 12, lineStyle: { color: 'rgba(255, 255, 255, 0.1)', width: 2 } },
            axisLabel: { distance: 18, color: '#526079', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
            detail: {
                valueAnimation: true,
                formatter: '{value}%',
                color: '#f4f8fc',
                fontSize: 28,
                fontWeight: 800,
                offsetCenter: [0, '25%'],
                fontFamily: 'JetBrains Mono, monospace'
            },
            data: [{
                value: parseFloat(eficienciaReal.toFixed(1)),
                name: 'Salud Operacional'
            }],
            title: {
                offsetCenter: [0, '75%'],
                color: '#7c8ba3',
                fontSize: 10,
                fontFamily: 'Manrope, sans-serif',
                fontWeight: 700,
                textTransform: 'uppercase'
            }
        }]
    };

    // Perfil Longitudinal Premium (Prioridad 3.2)
    const profileOptions = {
        backgroundColor: 'transparent',
        grid: { left: 35, right: 15, top: 20, bottom: 25 },
        xAxis: {
            type: 'category' as const,
            data: escalas.map(e => `K${Math.round(e.km)}`),
            axisLabel: { color: '#526079', fontSize: 8, rotate: 0, fontWeight: 700 },
            axisLine: { lineStyle: { color: 'rgba(28, 43, 66, 0.6)' } },
            axisTick: { show: false }
        },
        yAxis: {
            type: 'value' as const,
            min: 0,
            max: 4.5,
            axisLabel: { color: '#526079', fontSize: 9, formatter: '{value}m', fontFamily: 'JetBrains Mono, monospace' },
            axisLine: { show: false },
            splitLine: { lineStyle: { color: 'rgba(28, 43, 66, 0.5)', type: 'dashed' } },
        },
        series: [
            {
                name: 'Nivel Óptimo',
                type: 'line',
                data: escalas.map(() => 3.2), // Línea Ideal
                symbol: 'none',
                lineStyle: { color: 'rgba(52, 211, 153, 0.2)', width: 1, type: 'dashed' },
                markArea: {
                    silent: true,
                    itemStyle: { color: 'rgba(52, 211, 153, 0.03)' },
                    data: activeEvent?.evento_tipo === 'LLENADO'
                        ? [[{ yAxis: 0.1 }, { yAxis: 3.4 }]] // Rango amplio en llenado
                        : [[{ yAxis: 2.8 }, { yAxis: 3.4 }]]
                }
            },
            {
                data: escalas.map(e => e.nivel_actual ?? 0),
                type: 'line' as const,
                smooth: true,
                symbol: 'circle',
                symbolSize: 8,
                lineStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                        { offset: 0, color: '#0e7490' },
                        { offset: 1, color: '#22d3ee' }
                    ]),
                    width: 3,
                },
                itemStyle: {
                    color: '#f4f8fc',
                    borderColor: '#22d3ee',
                    borderWidth: 2,
                },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(34, 211, 238, 0.25)' },
                        { offset: 1, color: 'rgba(34, 211, 238, 0)' }
                    ])
                }
            }
        ],
        tooltip: {
            trigger: 'axis' as const,
            backgroundColor: 'rgba(12, 23, 41, 0.97)',
            borderColor: '#1c2b42',
            padding: [10, 15],
            textStyle: { color: '#f4f8fc', fontSize: 12, fontFamily: 'var(--geo-font-sans)' },
            formatter: (params: any) => {
                const dataIndex = params[0].dataIndex;
                const esc = escalas[dataIndex];
                const level = esc?.nivel_actual;
                const status = (level ?? 0) > 3.4
                    ? 'CRÍTICO (+)'
                    : (level ?? 0) < (activeEvent?.evento_tipo === 'LLENADO' ? 0.1 : 2.8)
                        ? 'CRÍTICO (-)'
                        : 'ÓPTIMO';
                const statusColor = (status === 'ÓPTIMO' || (status === 'CRÍTICO (-)' && activeEvent?.evento_tipo === 'LLENADO')) ? '#34d399' : '#ef4565';

                return `
                    <div style="min-width: 140px">
                        <div style="font-weight: 800; font-size: 14px; margin-bottom: 4px; color: #f4f8fc">${esc?.nombre} <small style="color: #7c8ba3">KM ${esc?.km}</small></div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px">
                            <span style="color: #7c8ba3; font-size: 10px; font-weight: 700">ESTADO</span>
                            <span style="color: ${statusColor}; font-size: 10px; font-weight: 900">${status}</span>
                        </div>
                        <div style="background: rgba(255,255,255,0.05); padding: 8px; border-radius: 6px; display: flex; align-items: baseline; gap: 4px">
                            <span style="color: #22d3ee; font-size: 20px; font-weight: 900; font-family: var(--geo-font-mono)">${level ?? '—'}</span>
                            <span style="color: #7c8ba3; font-size: 12px; font-weight: 600">metros</span>
                        </div>
                    </div>
                `;
            }
        },
    };

    const miniHistoryOptions = {
        backgroundColor: 'transparent',
        grid: { left: 5, right: 5, top: 5, bottom: 5 },
        xAxis: { type: 'category', show: false, data: historySeries?.labels ?? [] },
        yAxis: { type: 'value', show: false },
        series: [{
            data: historySeries?.values ?? [],
            type: 'line', smooth: true, symbol: 'none',
            lineStyle: { color: '#22d3ee', width: 2 },
            areaStyle: { color: 'rgba(34, 211, 238, 0.1)' }
        }]
    };

    const fullHistoryOptions = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis', backgroundColor: 'rgba(12, 23, 41, 0.95)', borderColor: '#1c2b42',
            textStyle: { color: '#f4f8fc', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
            valueFormatter: (v: number) => `${v} ${historySeries?.unit ?? ''}`,
        },
        grid: { left: 40, right: 20, top: 40, bottom: 30 },
        xAxis: { type: 'category', data: historySeries?.labels ?? [], axisLabel: { color: '#7c8ba3', fontSize: 10, fontWeight: 'bold' } },
        yAxis: { type: 'value', axisLabel: { color: '#7c8ba3', fontSize: 10, fontFamily: 'JetBrains Mono, monospace', formatter: `{value} ${historySeries?.unit ?? ''}` }, splitLine: { lineStyle: { color: '#1c2b42', type: 'dashed' } } },
        series: [{
            name: historySeries?.seriesName ?? '',
            data: historySeries?.values ?? [],
            type: 'line', smooth: true, symbol: 'circle', symbolSize: 8,
            lineStyle: { color: '#22d3ee', width: 3 },
            itemStyle: { color: '#22d3ee', borderColor: '#050b16', borderWidth: 2 },
            areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(34, 211, 238, 0.3)' }, { offset: 1, color: 'rgba(34, 211, 238, 0.0)' }] } }
        }]
    };

    // Events
    const liveEvents = useMemo(() => [
        ...tomasVaradas.map((tv: any) => ({
            time: `Hace ${tv.dias_varada} ${tv.dias_varada === 1 ? 'día' : 'días'}`,
            type: 'TOMA VARADA', title: `Sin continuidad (${tv.ultimo_estado})`,
            location: tv.punto_nombre, status: 'status-critical',
            point: { type: 'toma' as const, id: tv.punto_id }
        })),
        ...presas.filter(p => p.porcentaje_llenado < 40).map(p => ({
            time: p.fecha, type: 'ALMACENAMIENTO',
            title: `${p.nombre} al ${(p.porcentaje_llenado ?? 0).toFixed(1)}%`,
            location: 'Red Mayor', status: 'status-warning',
            point: { type: 'presa' as const, id: p.presa_id }
        })),
        { time: 'En Vivo', type: 'SYNC', title: `${escalas.length} Escalas enlazadas`, location: 'Sistema General', status: 'status-success', point: null },
        { time: 'Tiempo Real', type: 'DISTRIBUCIÓN', title: `${operStats.tomas_abiertas} tomas operando`, location: 'Canal Principal', status: 'status-info', point: null },
    ], [tomasVaradas, presas, escalas, operStats]);

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
                        <h1 className="geo-title">
                            GEO-MONITOR <span className="font-light">CENTRO VISUAL</span>
                        </h1>
                        <p className="geo-subtitle">
                            Canal Principal Conchos — DR-005
                        </p>
                    </div>
                </div>
                <div className="geo-search-container">
                    <div className="geo-search-bar">
                        <Activity size={14} className="geo-search-icon" />
                        <input
                            type="text"
                            placeholder="Buscar dispositivo (Escala, KM, Toma)..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        {searchQuery && (
                            <button className="geo-search-clear" onClick={() => setSearchQuery('')}>×</button>
                        )}
                    </div>
                </div>
                <div className="geo-header-right">
                    <div className="geo-time-display">
                        <div className="geo-time">{formatTime(currentTime, 'es-MX')}</div>
                        <div className="geo-date">{formatDate(currentTime, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}</div>
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
                    {/* Toggle del panel de KPIs en tablet (≤1024px): en escritorio el
                        panel es una columna fija y este botón se oculta por CSS. */}
                    <button
                        className={clsx('geo-fullscreen-btn', 'geo-stats-toggle-btn', statsOpen && 'active')}
                        onClick={() => setStatsOpen(v => !v)}
                        title={statsOpen ? 'Ocultar panel de indicadores' : 'Ver panel de indicadores'}
                    >
                        <PanelRight size={18} />
                    </button>
                    {/* Enlace a Tendencias (Monitor Público) — Fase 5: antes eran islas
                        sin navegación cruzada pese a operar sobre el mismo canal; ahí vive
                        el histórico de volumen por tramo y gasto entrada/salida/pérdidas
                        con mejor granularidad que el historial de Geo-Monitor. */}
                    <button
                        className="geo-fullscreen-btn"
                        onClick={() => navigate('/monitor-publico?tab=tendencias')}
                        title="Ver Tendencias históricas (Monitor Público)"
                    >
                        <TrendingUp size={18} />
                    </button>
                    {/* Fullscreen Toggle (Prioridad 4.3) */}
                    <button className="geo-fullscreen-btn" onClick={toggleFullscreen} title={isFullscreen ? 'Salir Pantalla Completa' : 'Modo Video Wall'}>
                        {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                    </button>
                </div>
            </header>

            <div className="geo-main-content">
                {/* LEFT: LAYER CONTROLS (Prioridad 2) */}
                <div className="geo-sidebar-controls">
                <div className="geo-sidebar-scroll">
                    {SIDEBAR_GROUPS.map((group, groupIdx) => (
                        <React.Fragment key={group.id}>
                            {groupIdx > 0 && <div className="geo-divider-h"></div>}
                            <div className="geo-control-group" role="toolbar" aria-label={group.label}>
                                <span className="geo-group-label" aria-hidden="true">{group.label}</span>
                                {group.buttons.map(({ key, icon: Icon, title, iconClassName, indicatorClass, activeClass }) => {
                                    const isOn = layers[key];
                                    return (
                                        <button
                                            key={key}
                                            className={clsx('geo-control-btn', isOn ? (activeClass ?? 'active') : 'default')}
                                            onClick={() => toggleLayer(key)}
                                            title={title}
                                            aria-label={title}
                                            aria-pressed={isOn}
                                        >
                                            <Icon size={SIDEBAR_ICON_SIZE} className={isOn ? iconClassName : undefined} />
                                            {isOn && key === 'alertas' && tomasVaradas.length > 0 && (
                                                <span className="geo-alert-badge">{tomasVaradas.length}</span>
                                            )}
                                            {isOn && key !== 'alertas' && (
                                                <span className={clsx('geo-indicator-dot', indicatorClass)}></span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </React.Fragment>
                    ))}

                    {/* NDVI mensual por módulo — sección dedicada (histórico, polígono
                        exacto), acción puntual que abre un panel a pantalla completa,
                        no un toggle de capa — se mantiene fuera de los grupos, igual
                        criterio que el botón de Importar de abajo. */}
                    <div className="geo-divider-h"></div>
                    <button
                        className="geo-control-btn default"
                        onClick={() => setShowNdviModulos(true)}
                        title="NDVI mensual por módulo (histórico)"
                        aria-label="Ver NDVI mensual por módulo"
                    >
                        <TrendingUp size={SIDEBAR_ICON_SIZE} />
                    </button>

                    {/* Botón de Importar Shapefile (Solo Gerente SRL) — acción puntual,
                        no un toggle de capa, se mantiene fuera de los grupos. */}
                    {isGerente && (
                        <>
                            <div className="geo-divider-h"></div>
                            <button
                                className="geo-control-btn default geo-btn-import"
                                onClick={() => setShowImporter(true)}
                                title="Importar Shapefile / GeoJSON"
                                aria-label="Importar Shapefile o GeoJSON"
                            >
                                <Upload size={16} />
                            </button>
                        </>
                    )}
                </div>
                <div className="geo-sidebar-fade" aria-hidden="true"></div>

                <div className="geo-layer-divider-base"></div>

                {/* Base Layer Selector: un solo botón con menú desplegable — las 4
                    capas base son mutuamente excluyentes, no necesitan 4 íconos
                    sueltos compitiendo por espacio con los toggles de contenido. */}
                <div className="geo-baselayer-wrap">
                    <button
                        ref={baseLayerTriggerRef}
                        className={clsx('geo-control-btn', 'geo-baselayer-trigger', baseLayerMenuOpen ? 'active' : 'default')}
                        onClick={openBaseLayerMenu}
                        title={`Capa base: ${BASE_LAYER_LABEL[baseLayer]} (clic para elegir)`}
                        aria-label={`Capa base: ${BASE_LAYER_LABEL[baseLayer]}. Clic para elegir otra.`}
                        aria-haspopup="menu"
                        aria-expanded={baseLayerMenuOpen}
                    >
                        {baseLayer === 'standard' && <MapIcon size={20} />}
                        {baseLayer === 'satellite' && <Layers size={20} />}
                        {baseLayer === 'eos' && <Wifi size={20} className="text-amber-400" />}
                        {baseLayer === 'sentinel' && <Satellite size={20} className="text-emerald-400" />}
                        <span className="geo-baselayer-status-dot" style={{
                            background: baseLayer === 'eos' ? '#f59e0b' : baseLayer === 'sentinel' ? '#10b981' : 'var(--geo-neon-cyan)'
                        }}></span>
                    </button>

                    {baseLayerMenuOpen && (
                        <div
                            className="geo-baselayer-menu"
                            ref={baseLayerMenuRef}
                            style={{
                                position: 'fixed',
                                left: baseLayerMenuPos.left,
                                top: baseLayerMenuPos.top,
                                bottom: baseLayerMenuPos.bottom,
                                maxHeight: 'calc(100vh - 24px)',
                                overflowY: 'auto',
                            }}
                        >
                            <button
                                className={clsx('geo-baselayer-option', baseLayer === 'standard' && 'active')}
                                onClick={() => { setBaseLayer('standard'); setBaseLayerMenuOpen(false); }}
                            >
                                <MapIcon size={16} /> Mapa Estándar
                            </button>
                            <button
                                className={clsx('geo-baselayer-option', baseLayer === 'satellite' && 'active')}
                                onClick={() => { setBaseLayer('satellite'); setBaseLayerMenuOpen(false); }}
                            >
                                <Layers size={16} /> Satélite ArcGIS
                            </button>
                            <button
                                className={clsx('geo-baselayer-option', baseLayer === 'eos' && 'active')}
                                onClick={() => {
                                    if (!eosUrl) {
                                        const url = prompt("Introduce tu WMS URL de EOS LandViewer:", eosUrl);
                                        if (url) {
                                            if (url.includes('landviewer/es?') || url.includes('landviewer/en?')) {
                                                alert("¡Atención! Has pegado la URL del navegador. Para que el mapa funcione, necesitas la 'URL de Integración WMS' que se encuentra en el menú de integración de EOS.");
                                            }
                                            setEosUrl(url);
                                        } else {
                                            return;
                                        }
                                    }
                                    setBaseLayer('eos');
                                    setBaseLayerMenuOpen(false);
                                }}
                            >
                                <Wifi size={16} /> EOS LandViewer
                                {eosUrl && (
                                    <span
                                        className="geo-baselayer-config"
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const url = prompt("Cambiar WMS URL de EOS LandViewer:", eosUrl);
                                            if (url) setEosUrl(url);
                                        }}
                                        title="Cambiar URL"
                                    >
                                        editar
                                    </span>
                                )}
                            </button>
                            {/* <div>, no <button>: las sub-opciones de abajo (capa temática,
                                modo, "verificar ahora") son ellas mismas controles interactivos
                                (role="button") — anidarlas dentro de un <button> real es HTML
                                inválido y el navegador puede burbujear su clic nativo hacia este
                                contenedor incluso con stopPropagation() en el evento de React,
                                disparando este onClick también y produciendo comportarse de forma
                                errática (los chips "parecían cerrarse solos" al pulsarlos). */}
                            <div
                                role="button"
                                tabIndex={0}
                                className={clsx('geo-baselayer-option', baseLayer === 'sentinel' && 'active')}
                                onClick={() => {
                                    if (!sentinelInstanceId) {
                                        const id = prompt(
                                            "Introduce tu Instance ID de Sentinel Hub (Dashboard → Configuration Utility → WMS):",
                                            sentinelInstanceId
                                        );
                                        if (!id) return;
                                        setSentinelInstanceId(id.trim());
                                    }
                                    setBaseLayer('sentinel');
                                    // A diferencia de las demás capas base, Sentinel Hub despliega
                                    // sub-opciones (capa temática, modo, fecha de escena) dentro de
                                    // este mismo menú — cerrarlo aquí las ocultaba antes de que el
                                    // usuario pudiera verlas o hacer clic en ellas.
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.currentTarget.click(); } }}
                            >
                                <Satellite size={16} /> Sentinel Hub
                                <span className="geo-baselayer-sublayers geo-baselayer-status-row">
                                    {sentinelHubStatus && (
                                        <span
                                            className={clsx('geo-baselayer-chip', sentinelHubStatus.disponible ? 'active' : 'geo-baselayer-chip-alerta')}
                                            title={sentinelHubStatus.mensaje ?? undefined}
                                        >
                                            {sentinelHubStatus.disponible ? 'Cuenta activa' : 'Cuenta vencida'}
                                        </span>
                                    )}
                                    <span
                                        className="geo-baselayer-chip"
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => { e.stopPropagation(); if (!verificandoSentinelHub) verificarSentinelHubAhora(); }}
                                        title="Probar el WMS de Sentinel Hub ahora, sin esperar al chequeo automático cada 6h"
                                    >
                                        {verificandoSentinelHub ? 'verificando…' : 'verificar ahora'}
                                    </span>
                                </span>
                                {baseLayer === 'sentinel' && (
                                    <>
                                        <span className="geo-baselayer-sublayers geo-baselayer-sublayers-wrap">
                                            {(['1_TRUE_COLOR', '3_NDVI', '9_NDVI_AGRO', '7_NDWI'] as const).map(l => (
                                                <span
                                                    key={l}
                                                    className={clsx('geo-baselayer-chip', sentinelLayer === l && 'active')}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={(e) => { e.stopPropagation(); setSentinelLayer(l); }}
                                                    title={l === '9_NDVI_AGRO' ? 'NDVI de alto contraste por bandas — mejor para distinguir zonas con y sin vegetación' : undefined}
                                                >
                                                    {l === '1_TRUE_COLOR' ? 'Color real' : l === '3_NDVI' ? 'NDVI' : l === '9_NDVI_AGRO' ? 'NDVI agro' : 'Humedad (NDWI)'}
                                                </span>
                                            ))}
                                        </span>
                                        <span className="geo-baselayer-sublayers">
                                            {(['reciente', 'legible'] as const).map(m => (
                                                <span
                                                    key={m}
                                                    className={clsx('geo-baselayer-chip', sentinelModo === m && 'active')}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={(e) => { e.stopPropagation(); setSentinelModo(m); }}
                                                    title={m === 'reciente' ? 'Última imagen disponible (últimos 3 días), aunque tenga nubes' : 'Imagen más clara de los últimos 30 días'}
                                                >
                                                    {m === 'reciente' ? 'Más reciente' : 'Más legible'}
                                                </span>
                                            ))}
                                        </span>
                                        <span className="geo-baselayer-fecha">
                                            {sentinelEscena.cargando && 'Buscando escena…'}
                                            {!sentinelEscena.cargando && sentinelEscena.error && `Sin dato de fecha: ${sentinelEscena.error}`}
                                            {!sentinelEscena.cargando && !sentinelEscena.error && sentinelEscena.fecha && (
                                                `${new Date(sentinelEscena.fecha).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Chihuahua' })}`
                                                + (sentinelEscena.nubosidad != null ? ` · nubes ${Math.round(sentinelEscena.nubosidad)}%` : '')
                                            )}
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Mapa animado (Windy.com): acción puntual que abre un modal ajeno
                    al mapa Leaflet, no un toggle de capa — se mantiene fuera de
                    SIDEBAR_GROUPS y del selector de capa base, mismo criterio que
                    ya distingue el botón de importar shapefile. */}
                <button
                    className="geo-control-btn default"
                    onClick={() => setShowWindy(true)}
                    title="Mapa animado de nubosidad y precipitación (Windy.com)"
                >
                    <Satellite size={SIDEBAR_ICON_SIZE} />
                </button>
                </div>

                {/* CENTER: MAP (Prioridad 1 + 2) */}
                <div className="geo-map-container" style={{ position: 'relative' }}>
                    <div className="geo-map-inner">
                        {/* Aviso "Sentinel Hub disponible de nuevo": solo cuando la capa
                            activa NO es 'sentinel' (se cayó a satélite por tileerror, o el
                            usuario nunca la activó) y la última verificación dice que el
                            servicio ya responde. Nunca cambia la capa por sí solo — cuida
                            la cuota, la reactivación es decisión del usuario. */}
                        {baseLayer !== 'sentinel' && sentinelHubStatus?.disponible && (
                            <div className="geo-sentinel-date-badge" style={{ borderColor: 'rgba(16,185,129,0.5)' }}>
                                <Satellite size={13} className="text-emerald-400" />
                                <span>
                                    Sentinel Hub disponible de nuevo
                                    {sentinelHubStatus.ultima_vez_disponible && (
                                        ` · desde ${new Date(sentinelHubStatus.ultima_vez_disponible).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Chihuahua' })}`
                                    )}
                                    {sentinelHubStatus.processing_units_usadas != null && (
                                        ` · PU usadas este mes: ${Math.round(sentinelHubStatus.processing_units_usadas)}`
                                    )}
                                </span>
                                <span
                                    className="geo-sentinel-date-modo"
                                    style={{ cursor: 'pointer' }}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setBaseLayer('sentinel')}
                                    title="Activar capa Sentinel Hub"
                                >
                                    Activar
                                </span>
                            </div>
                        )}
                        {/* Badge de fecha de la escena Sentinel Hub activa — visible sin
                            depender de que el menú desplegable esté abierto. */}
                        {baseLayer === 'sentinel' && sentinelInstanceId && (
                            <div className="geo-sentinel-date-badge">
                                <Satellite size={13} className="text-emerald-400" />
                                <span>
                                    {sentinelEscena.cargando && 'Buscando escena…'}
                                    {!sentinelEscena.cargando && sentinelEscena.error && 'Sin escena en el rango'}
                                    {!sentinelEscena.cargando && !sentinelEscena.error && sentinelEscena.fecha && (
                                        <>
                                            {new Date(sentinelEscena.fecha).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Chihuahua' })}
                                            {sentinelEscena.nubosidad != null && ` · nubes ${Math.round(sentinelEscena.nubosidad)}%`}
                                        </>
                                    )}
                                </span>
                                <span className="geo-sentinel-date-modo">
                                    {sentinelModo === 'reciente' ? 'Más reciente' : 'Más legible'}
                                </span>
                            </div>
                        )}
                        {/* Leyenda de rango NDVI: sin esto, el rojo/naranja dominante de suelo
                            desnudo o vigor bajo se lee como "alerta" en vez de como la paleta
                            estándar del proveedor — solo aplica a las capas NDVI, no a TRUE_COLOR/NDWI. */}
                        {baseLayer === 'sentinel' && sentinelInstanceId && (sentinelLayer === '3_NDVI' || sentinelLayer === '9_NDVI_AGRO') && (
                            <div className="geo-ndvi-legend">
                                <span className="geo-ndvi-legend-label">NDVI</span>
                                <div className="geo-ndvi-legend-bar" />
                                <div className="geo-ndvi-legend-scale">
                                    <span>Suelo / vigor bajo</span>
                                    <span>Vigor alto</span>
                                </div>
                            </div>
                        )}
                        {/* Aviso de zoom insuficiente: la capa está activada pero a este nivel
                            de acercamiento ~5,200 lotes se verían como ruido — se explica en vez
                            de dejar la capa "activa" sin mostrar nada, sin dar pista al usuario. */}
                        {layers.lotes && mapZoom < LOTES_MIN_ZOOM && (
                            <div className="geo-lotes-zoom-badge">
                                <Crosshair size={13} className="text-amber-400" />
                                <span>Acerca el mapa para ver lotes (zoom {mapZoom}/{LOTES_MIN_ZOOM})</span>
                            </div>
                        )}
                        {/* Resultado de NDVI por módulo (Fase 4): panel flotante, se cierra con X.
                            No usa el geo-detail-panel de escala/toma/presa a propósito — evita
                            acoplar esta consulta puntual a esa lógica de selección más compleja. */}
                        {moduloNdvi && (
                            <div className="geo-ndvi-modulo-panel">
                                <div className="geo-ndvi-modulo-header">
                                    <span>NDVI — {moduloNdvi.nombre}</span>
                                    <button onClick={() => setModuloNdvi(null)} title="Cerrar">×</button>
                                </div>
                                {moduloNdvi.cargando && <div className="geo-ndvi-modulo-body">Calculando NDVI del área…</div>}
                                {!moduloNdvi.cargando && moduloNdvi.error && (
                                    <div className="geo-ndvi-modulo-body error">{moduloNdvi.error}</div>
                                )}
                                {!moduloNdvi.cargando && !moduloNdvi.error && moduloNdvi.ndvi_medio !== null && (
                                    <div className="geo-ndvi-modulo-body">
                                        <div className="geo-ndvi-modulo-value">
                                            {moduloNdvi.ndvi_medio.toFixed(3)}
                                            <small>NDVI medio</small>
                                        </div>
                                        <div className="geo-ndvi-modulo-range">
                                            rango {moduloNdvi.ndvi_min?.toFixed(2)} – {moduloNdvi.ndvi_max?.toFixed(2)}
                                            {moduloNdvi.muestras_validas != null && ` · ${moduloNdvi.muestras_validas.toLocaleString()} muestras`}
                                        </div>
                                        <div className="geo-ndvi-modulo-note">
                                            Últimos 30 días{moduloNdvi.hasta ? `, hasta ${new Date(moduloNdvi.hasta).toLocaleDateString('es-MX')}` : ''}.
                                            Agregado sobre el área del módulo completo, no por lote individual.
                                        </div>
                                    </div>
                                )}

                                {/* Balance ETo vs. demanda programada — Fase 4. Antes la ETo de
                                    las estaciones climáticas solo se veía suelta en un tooltip. */}
                                <div className="geo-ndvi-modulo-divider" />
                                <div className="geo-ndvi-modulo-body">
                                    <div className="geo-eto-title">Balance hídrico estimado (ETo)</div>
                                    {!balanceEtoModulo?.estacion && (
                                        <div className="geo-ndvi-modulo-note">Sin estación climática asignada a este módulo.</div>
                                    )}
                                    {balanceEtoModulo?.estacion && balanceEtoModulo.eto === null && (
                                        <div className="geo-ndvi-modulo-note">Estación {balanceEtoModulo.estacion.nombre} sin lectura de ETo reciente.</div>
                                    )}
                                    {balanceEtoModulo?.estacion && balanceEtoModulo.eto !== null && !balanceEtoModulo.disponible && (
                                        <div className="geo-ndvi-modulo-note">
                                            ETo: {balanceEtoModulo.eto.toFixed(2)} mm/día ({balanceEtoModulo.estacion.nombre}).
                                            Sin superficie o caudal objetivo del módulo para calcular el balance.
                                        </div>
                                    )}
                                    {balanceEtoModulo?.disponible && (
                                        <>
                                            <div className={clsx('geo-eto-balance-value', balanceEtoModulo.balance >= 0 ? 'positivo' : 'negativo')}>
                                                {balanceEtoModulo.balance >= 0 ? '+' : ''}{balanceEtoModulo.balance.toFixed(2)}
                                                <small>m³/s {balanceEtoModulo.balance >= 0 ? 'superávit' : 'déficit'}</small>
                                            </div>
                                            <div className="geo-ndvi-modulo-range">
                                                Objetivo {balanceEtoModulo.caudalObjetivo.toFixed(2)} m³/s vs. demanda ETo {balanceEtoModulo.demandaEtoM3s.toFixed(2)} m³/s
                                            </div>
                                            <div className="geo-ndvi-modulo-note">
                                                ETo {balanceEtoModulo.eto.toFixed(2)} mm/día ({balanceEtoModulo.estacion!.nombre}) ×
                                                {' '}{balanceEtoModulo.superficieHa?.toLocaleString()} ha de superficie del módulo.
                                                Estimación agregada, no sustituye la demanda real por cultivo/lote.
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}
                        {/* Alerta anticipada de lluvia (Fase 4): solo se muestra si hay
                            probabilidad relevante en las próximas 48h — en días despejados
                            no agrega ruido al mapa. Sirve de contexto para decisiones de
                            apertura/cierre ANTES de una contingencia por lluvia. */}
                        {alertaLluvia48h.maxProbPct != null && alertaLluvia48h.maxProbPct >= 40 && (
                            <div
                                className={clsx('geo-lluvia-badge', alertaLluvia48h.maxProbPct >= 70 && 'alta')}
                                style={activeEvent ? { top: 58 } : undefined}
                            >
                                <CloudRain size={13} />
                                <span>
                                    Lluvia {Math.round(alertaLluvia48h.maxProbPct)}% prob. en 48h
                                    {alertaLluvia48h.horaMaxProb && ` · pico ${new Date(alertaLluvia48h.horaMaxProb).toLocaleString('es-MX', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Chihuahua' })}`}
                                </span>
                            </div>
                        )}
                        {/* Protocol HUD Banner */}
                        {activeEvent && (
                            <div className={clsx(
                                'geo-event-banner',
                                !activeEvent.hora_apertura_real && 'geo-event-bg-pendiente',
                                activeEvent.hora_apertura_real && activeEvent.evento_tipo === 'LLENADO' && 'geo-event-bg-llenado',
                                activeEvent.hora_apertura_real && activeEvent.evento_tipo === 'ESTABILIZACION' && 'geo-event-bg-estabilizacion',
                                activeEvent.hora_apertura_real && activeEvent.evento_tipo === 'CONTINGENCIA_LLUVIA' && 'geo-event-bg-contingencia',
                                activeEvent.hora_apertura_real && activeEvent.evento_tipo === 'ANOMALIA_BAJA' && 'geo-event-bg-anomalia',
                                activeEvent.hora_apertura_real && !['LLENADO', 'ESTABILIZACION', 'CONTINGENCIA_LLUVIA', 'ANOMALIA_BAJA'].includes(activeEvent.evento_tipo) && 'geo-event-bg-alerta'
                            )}>
                                <div className="flex items-center gap-3">
                                    {activeEvent.evento_tipo === 'LLENADO' ? <Droplets size={20} /> : <AlertTriangle size={20} />}
                                    <div>
                                        <div className="text-[13px] font-black tracking-[2px] uppercase">
                                            PROTOCOLO: {activeEvent.evento_tipo.replace('_', ' ')}
                                        </div>
                                        <div className="geo-event-banner-info">
                                            Inicio: {activeEvent.hora_apertura_real ?
                                                new Date(activeEvent.hora_apertura_real).toLocaleTimeString('es-MX', {
                                                    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Chihuahua'
                                                }) + ' (LOCAL)'
                                                : 'Pendiente de confirmación en campo...'} | Sincronizando con Canaleros.
                                        </div>
                                    </div>
                                </div>
                                {activeEvent.evento_tipo === 'LLENADO' && (
                                    <div className="geo-event-banner-right">
                                        <div className="geo-event-banner-label">Avance de Onda (Frente)</div>
                                        <div className="geo-event-banner-km">KM {(maxKmLlenado ?? 0).toFixed(3)}</div>
                                    </div>
                                )}
                            </div>
                        )}

                        {mapReady && (
                            <MapContainer
                                center={mapCenter} zoom={10}
                                className="geo-map-leaflet"
                                zoomControl={false} attributionControl={false}
                            >
                                <MapViewportWatcher onChange={(zoom, bounds) => { setMapZoom(zoom); setMapBounds(bounds); }} />
                                {baseLayer === 'satellite' && (
                                    <TileLayer
                                        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                                        maxZoom={19}
                                    />
                                )}
                                {baseLayer === 'standard' && (
                                    <TileLayer
                                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                        maxZoom={19}
                                    />
                                )}
                                {baseLayer === 'eos' && eosUrl && (
                                    <React.Fragment>
                                        {(() => {
                                            try {
                                                const isWms = (eosUrl || '').toLowerCase().includes('service=wms') || (eosUrl || '').toLowerCase().includes('/wms/');
                                                if (isWms) {
                                                    const urlObj = new URL(eosUrl);
                                                    return (
                                                        <WMSTileLayer
                                                            url={eosUrl.split('?')[0]}
                                                            params={{
                                                                layers: urlObj.searchParams.get('layers') || '',
                                                                format: 'image/png',
                                                                transparent: true,
                                                                version: '1.1.1',
                                                                ...Object.fromEntries(urlObj.searchParams.entries())
                                                            } as any}
                                                            maxZoom={19}
                                                            attribution="© EOS LandViewer"
                                                        />
                                                    );
                                                }
                                                return (
                                                    <TileLayer
                                                        url={eosUrl}
                                                        maxZoom={19}
                                                        attribution="© EOS LandViewer"
                                                    />
                                                );
                                            } catch (e) {
                                                console.error("Invalid EOS URL", e);
                                                return null;
                                            }
                                        })()}
                                    </React.Fragment>
                                )}
                                {baseLayer === 'sentinel' && sentinelInstanceId && (
                                    // El WMS de Sentinel es transparent=true: donde no hay escena
                                    // que cumpla la ventana de tiempo/nubosidad (borde de cobertura,
                                    // franja sin pasada reciente) esos tiles devuelven PNG
                                    // transparente — sin una capa debajo, el mapa se ve negro en
                                    // esa zona (reportado sep-2026: "aparece en las esquinas pero el
                                    // centro, donde está el canal, se queda negro"). Mismo fallback
                                    // de satélite ArcGIS que ya usa 'satellite' arriba. zIndex fijo:
                                    // por defecto react-leaflet asigna 1 a ambos panes (este y el WMS
                                    // de abajo) y dentro de Leaflet dos panes con el mismo z-index
                                    // quedan en orden de montaje, no garantizado tras un remount por
                                    // `key` — el WMS podía terminar PINTADO DEBAJO de este fondo
                                    // aunque sus tiles cargaran bien (reportado sep-2026: el chip de
                                    // capa cambiaba de activo pero el mapa seguía viéndose igual).
                                    <TileLayer
                                        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                                        maxZoom={19}
                                        zIndex={0}
                                    />
                                )}
                                {baseLayer === 'sentinel' && sentinelInstanceId && (
                                    <WMSTileLayer
                                        key={`sentinel-${sentinelLayer}`}
                                        url={sentinelWmsUrl(sentinelInstanceId)}
                                        params={sentinelWmsParams as any}
                                        maxZoom={19}
                                        zIndex={1}
                                        attribution="© Copernicus Sentinel Hub"
                                        eventHandlers={{
                                            loading: () => { sentinelTileErrorCount.current = 0; },
                                            tileerror: () => {
                                                // Un tile aislado que falla (timeout de red, borde de la
                                                // escena disponible) no significa que el servicio esté
                                                // caído — solo se asume eso, y se cae a satélite ArcGIS
                                                // (sin key, ya validado), cuando fallan varios tiles
                                                // seguidos de la MISMA carga (ver SENTINEL_TILEERROR_UMBRAL).
                                                sentinelTileErrorCount.current += 1;
                                                if (sentinelTileErrorCount.current < SENTINEL_TILEERROR_UMBRAL) return;
                                                setSentinelEscena(prev => ({ ...prev, error: prev.error || 'WMS de Sentinel Hub no disponible — usando satélite de respaldo' }));
                                                setBaseLayer('satellite');
                                            },
                                        }}
                                    />
                                )}

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
                                                const btnId = `ndvi-btn-mod-${p.numero_modulo}`;
                                                layer.bindPopup(`
                                                    <div style="font-family:var(--geo-font-sans);min-width:180px">
                                                        <strong style="font-size:14px;font-weight:800;color:${p.color}">${p.nombre}</strong>
                                                        <div style="font-size:11px;color:#cbd5e1;margin:4px 0;text-transform:uppercase;letter-spacing:0.05em">Módulo ${p.numero_modulo}</div>
                                                        <div style="font-size:12px;font-family:var(--geo-font-mono)">Superficie: <b style="color:#fff">${p.superficie_ha?.toLocaleString()} ha</b></div>
                                                        <button id="${btnId}" style="margin-top:8px;width:100%;padding:6px 8px;border-radius:6px;border:1px solid rgba(34,211,238,0.4);background:rgba(34,211,238,0.12);color:#22d3ee;font-size:11px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:0.04em">
                                                            Consultar NDVI del área
                                                        </button>
                                                    </div>
                                                `);
                                                // El botón vive dentro del popup HTML de Leaflet (fuera del árbol React),
                                                // así que se engancha el listener cuando el popup se abre — no antes,
                                                // porque el nodo aún no existe en el DOM.
                                                const geometry = feature.geometry;
                                                layer.on('popupopen', () => {
                                                    const btn = document.getElementById(btnId);
                                                    if (btn && geometry.type === 'Polygon') {
                                                        const ring = geometry.coordinates[0] as [number, number][];
                                                        btn.onclick = () => consultarNdviModulo(
                                                            p.numero_modulo, p.nombre, p.superficie_ha ?? null, ring,
                                                        );
                                                    }
                                                });
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
                                                    <div style="font-family:var(--geo-font-sans);min-width:180px">
                                                        <strong style="font-size:14px;font-weight:800;color:${p.color}">${p.nombre}</strong>
                                                        <div style="font-size:12px;margin-top:4px;color:#94a3b8">Capacidad: <b style="color:#fff;font-family:var(--geo-font-mono)">${p.capacidad_mm3} Mm³</b></div>
                                                    </div>
                                                `);
                                                layer.bindTooltip(p.nombre, { sticky: true });
                                            }
                                        }}
                                    />
                                )}

                                {/* GeoJSON: Lotes de productores (catastro) — cargado bajo demanda por
                                    módulo visible, solo desde LOTES_MIN_ZOOM. El nombre del productor
                                    (dato personal) solo se muestra a rol SRL; el resto ve cultivo y
                                    superficie sin identificar al titular (ver informe de auditoría). */}
                                {layers.lotes && mapZoom >= LOTES_MIN_ZOOM && modulosLotesVisibles.map(modulo => {
                                    const fc = geoLotesPorModulo[modulo];
                                    if (!fc) return null;
                                    return (
                                        <GeoJSON
                                            key={`lotes-${modulo}-${geoKey}`}
                                            data={fc}
                                            style={() => ({
                                                color: '#f5a623',
                                                weight: 1,
                                                fillColor: '#f5a623',
                                                fillOpacity: 0.08,
                                            })}
                                            onEachFeature={(feature, layer) => {
                                                const p = feature.properties;
                                                if (!p) return;
                                                const productorHtml = isGerente
                                                    ? `<div style="font-size:12px;color:#cbd5e1;margin-top:2px">${p.productor || 'Sin productor registrado'}</div>`
                                                    : '';
                                                layer.bindPopup(`
                                                    <div style="font-family:var(--geo-font-sans);min-width:190px">
                                                        <strong style="font-size:13px;font-weight:800;color:#f5a623">Lote ${p.idparcela ?? ''} — Módulo ${p.modulo}</strong>
                                                        ${productorHtml}
                                                        <div style="font-size:11px;color:#94a3b8;margin-top:6px;text-transform:uppercase;letter-spacing:0.04em">Cultivo</div>
                                                        <div style="font-size:12px;color:#fff">${p.cultivo || 'Sin registrar'}</div>
                                                        <div style="font-size:11px;font-family:var(--geo-font-mono);margin-top:6px">
                                                            Superficie física: <b style="color:#fff">${p.superficie_fisica_ha ?? '—'} ha</b><br/>
                                                            Superficie de riego: <b style="color:#fff">${p.superficie_riego_ha ?? '—'} ha</b>
                                                        </div>
                                                    </div>
                                                `);
                                                layer.bindTooltip(`Lote ${p.idparcela ?? ''}${p.cultivo ? ' · ' + p.cultivo : ''}`, { sticky: true });
                                            }}
                                        />
                                    );
                                })}

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

                                {/* GeoJSON: Río Conchos (tramo de río natural) */}
                                {layers.rioShape && geoRio && (
                                    <GeoJSON
                                        key={`rio-${geoKey}`}
                                        data={geoRio}
                                        style={() => ({
                                            color: '#3b82f6', // azul primario (río)
                                            weight: 6,
                                            opacity: 0.9,
                                        })}
                                        onEachFeature={(_, layer) => {
                                            layer.bindTooltip(`Río Conchos (Segmento Boquilla → K0)`, { sticky: true });
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

                                {/* MEJ-3: Onda de Llenado en Digital Twin */}
                                {layers.canal && llenadoWaveGeoref.length > 0 && (
                                    <Polyline
                                        positions={llenadoWaveGeoref}
                                        color="#06b6d4" // cyan-500
                                        weight={8}
                                        opacity={0.9}
                                        className="animate-pulse"
                                        pathOptions={{ 
                                            lineCap: 'round', 
                                            lineJoin: 'round'
                                        }}
                                    >
                                        <Tooltip sticky>
                                            <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 'bold', color: '#06b6d4' }}>
                                                🌊 FRENTE DE AGUA<br />
                                                Confirmado (campo): Km {(maxKmLlenado ?? 0).toFixed(1)}<br />
                                                {predictedMaxKm > maxKmLlenado && (
                                                    <span style={{ color: '#94a3b8', fontWeight: 'normal' }}>
                                                        Proyectado (visual): Km {predictedMaxKm.toFixed(1)}<br />
                                                    </span>
                                                )}
                                                {etaCalibrado && (
                                                    <span style={{ color: '#34d399', fontWeight: 'normal' }}>
                                                        Próx. escala calibrada: {etaCalibrado.nombre} (Km {etaCalibrado.km}) ·{' '}
                                                        {new Date(etaCalibrado.hora_arribo_estimada).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Chihuahua' })}
                                                        {' '}· {etaCalibrado.v_onda_kmh.toFixed(1)} km/h
                                                    </span>
                                                )}
                                            </span>
                                        </Tooltip>
                                    </Polyline>
                                )}

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
                                        eventHandlers={{
                                            click: () => handleSelect('escala', esc)
                                        }}
                                    >
                                        <Tooltip direction="top" offset={[0, -8]}>
                                            <div className="geo-tooltip-content">
                                                <b>{esc.nombre}</b> (Km {esc.km})<br />
                                                {esc.nivel_actual !== undefined ? (
                                                    <>
                                                        Nivel: <span className="geo-text-highlight">{esc.nivel_actual} m</span><br />
                                                        Δ12h: <span className={(esc.delta_12h ?? 0) > 0 ? 'geo-text-success' : 'geo-text-danger'}>{esc.delta_12h ?? 0} m</span><br />
                                                    </>
                                                ) : (
                                                    <span className="text-slate-500">Sin lectura hoy</span>
                                                )}
                                                {layers.mostrarAperturas && esc.pzas_radiales > 0 && (
                                                    <div className="geo-apertura-badge">
                                                        <span className="text-[9px] text-slate-400">Apertura Compuertas:</span><br />
                                                        <b className="text-white text-[13px]">{(esc.apertura_radiales_m || 0) > 0 ? `${(esc.apertura_radiales_m || 0).toFixed(2)} m` : 'CERRADAS'}</b>
                                                        <div className="text-[8px] text-slate-500">{esc.pzas_radiales} radiales ({esc.ancho}×{esc.alto}m)</div>
                                                    </div>
                                                )}
                                            </div>
                                        </Tooltip>
                                    </CircleMarker>
                                ))}

                                 {/* Prioridad 1.2: Puntos de Aforo */}
                                {layers.escalas && aforos.map(af => {
                                    const m = latestAforos[af.id];
                                    return (
                                        <Marker key={af.id} position={[af.latitud, af.longitud]} icon={aforoIcon}>
                                            <Tooltip direction="top" offset={[0, -12]}>
                                                <div className="geo-aforo-tooltip">
                                                    <b className="geo-icon-amber">📐 {af.nombre_punto}</b><br />
                                                    <span className="text-[9px]">Histórico de Aforo de Control</span><br />
                                                    {layers.mostrarAforosQ && m ? (
                                                        <div className="geo-aforo-badge">
                                                            Gasto: <b className="text-white text-[14px]">{m.gasto_calculado_m3s?.toFixed(2)} <small>m³/s</small></b><br />
                                                            <span className="text-[8px]">{m.fecha} @ {m.hora_inicio}</span>
                                                        </div>
                                                    ) : (
                                                        <span className="text-slate-500 text-[9px]">{layers.mostrarAforosQ ? 'Sin mediciones recientes' : ''}</span>
                                                    )}
                                                </div>
                                            </Tooltip>
                                        </Marker>
                                    );
                                })}

                                {/* Prioridad 1.1: Presas */}
                                {layers.tomas && presas.map(p => (
                                    <Marker key={p.presa_id} position={[p.latitud, p.longitud]} icon={presaIcon}>
                                        <Tooltip direction="top" offset={[0, -16]} permanent>
                                            <span className="font-mono text-[10px] font-bold">
                                                {(p.porcentaje_llenado ?? 0).toFixed(0)}%
                                            </span>
                                        </Tooltip>
                                        <Popup>
                                            <div className="geo-presa-popup">
                                                <strong className="text-[13px] geo-icon-blue">{p.nombre}</strong>
                                                <div className="text-[10px] text-slate-400 mb-1.5">Última lectura: {p.fecha}</div>
                                                <div className="geo-presa-stat-box">
                                                    <div className="text-[11px]">Almacenamiento: <b>{(p.almacenamiento_mm3 ?? 0).toFixed(1)} Mm³</b></div>
                                                    <div className="geo-progress-bg">
                                                        <div 
                                                            className="geo-progress-bar"
                                                            style={{
                                                                width: `${Math.min(p.porcentaje_llenado, 100)}%`,
                                                                background: p.porcentaje_llenado > 70 ? '#3b82f6' : p.porcentaje_llenado > 40 ? '#f59e0b' : '#ef4444',
                                                            }}
                                                        />
                                                    </div>
                                                    <div className="text-[11px] mt-1">Llenado: <b>{(p.porcentaje_llenado ?? 0).toFixed(1)}%</b></div>
                                                </div>
                                                <div className="text-[11px]">Extracción: <b>{p.extraccion_total_m3s} m³/s</b></div>
                                            </div>
                                        </Popup>
                                    </Marker>
                                ))}

                                {/* Puntos de Entrega (Tomas) */}
                                {layers.tomas && filteredTomas.map(t => {
                                    const isBlocked = activeEvent?.evento_tipo === 'LLENADO' && (t.km === undefined || t.km > maxKmLlenado);
                                    const lockFillColor = '#64748b'; // Gray for empty/locked logic
                                    
                                    return (
                                    <CircleMarker
                                        key={t.id}
                                        center={[t.latitud, t.longitud]}
                                        radius={t.estado !== 'cierre' && !isBlocked ? 7 : 5}
                                        fillColor={isBlocked ? lockFillColor : (t.estado === 'cierre' ? '#475569' : '#22c55e')}
                                        color={isBlocked ? '#cbd5e1' : (t.estado === 'cierre' ? 'rgba(255,255,255,0.4)' : '#fff')}
                                        weight={t.estado !== 'cierre' ? 2 : 1}
                                        fillOpacity={isBlocked ? 0.3 : (t.estado === 'cierre' ? 0.6 : 0.9)}
                                        eventHandlers={{
                                            click: () => handleSelect('toma', t)
                                        }}
                                    >
                                        <Tooltip direction="top" offset={[0, -5]}>
                                            <div style={{ fontFamily: 'monospace', fontSize: 10 }}>
                                                <b>{isBlocked ? '🔒 ' : ''}{t.nombre}</b><br />
                                                Estado: <span style={{ color: isBlocked ? '#94a3b8' : (t.estado === 'cierre' ? '#94a3b8' : '#4ade80') }}>
                                                </span><br />
                                                {!isBlocked && t.estado !== 'cierre' && <span>Q: {t.caudal?.toFixed(3)} m³/s</span>}
                                            </div>
                                        </Tooltip>
                                        <Popup>
                                            <div style={{ fontFamily: 'monospace', minWidth: 160 }}>
                                                <strong style={{ fontSize: 13 }}>{t.nombre}</strong>
                                                <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                                                    Modulo: {t.modulo} | Km: {t.km?.toFixed(3)}
                                                </div>
                                                <div style={{ padding: '4px 8px', borderRadius: 4, background: isBlocked ? '#f8fafc' : (t.estado === 'cierre' ? '#f1f5f9' : '#f0fdf4'), fontSize: 11 }}>
                                                    Estado: <b className={isBlocked ? 'text-slate-500' : ''}>{isBlocked ? 'ESPERANDO ARRIBO' : t.estado.toUpperCase()}</b><br />
                                                    {!isBlocked && t.estado !== 'cierre' && <div>Caudal: <b>{t.caudal?.toFixed(3)} m³/s</b></div>}
                                                </div>
                                            </div>
                                        </Popup>
                                    </CircleMarker>
                                )})}

                                {/* Estaciones climáticas WeatherLink */}
                                {layers.estaciones && estacionesClima.map(e => {
                                    const l = e.lectura;
                                    const col = e.enLinea ? '#38bdf8' : '#64748b';
                                    return (
                                        <CircleMarker
                                            key={`est-${e.id}`}
                                            center={[e.latitud, e.longitud]}
                                            radius={8}
                                            fillColor={col}
                                            color="#fff"
                                            weight={2}
                                            fillOpacity={e.enLinea ? 0.85 : 0.5}
                                        >
                                            <Tooltip direction="top" offset={[0, -6]}>
                                                <div style={{ fontFamily: 'monospace', fontSize: 10 }}>
                                                    <b>🌦️ {e.nombre}</b>{e.enLinea ? '' : ' (sin datos)'}<br />
                                                    {l?.temp_c != null && <span>{l.temp_c.toFixed(1)}°C · {l.hum_rel_pct != null ? Math.round(l.hum_rel_pct) : '—'}% HR</span>}
                                                </div>
                                            </Tooltip>
                                            <Popup>
                                                <div style={{ fontFamily: 'monospace', minWidth: 180 }}>
                                                    <strong style={{ fontSize: 13 }}>🌦️ {e.nombre}</strong>
                                                    <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                                                        Estación WeatherLink #{e.station_id} · {e.enLinea ? 'en línea' : (e.edadHoras != null ? `${Math.round(e.edadHoras)} h sin datos` : 'sin datos')}
                                                    </div>
                                                    {l ? (
                                                        <div style={{ padding: '4px 8px', borderRadius: 4, background: '#f0f9ff', fontSize: 11, lineHeight: 1.6 }}>
                                                            <div>🌡️ Temp: <b>{l.temp_c != null ? l.temp_c.toFixed(1) : '—'} °C</b></div>
                                                            <div>💧 Humedad: <b>{l.hum_rel_pct != null ? Math.round(l.hum_rel_pct) : '—'} %</b></div>
                                                            <div>💨 Viento: <b>{l.viento_ms != null ? l.viento_ms.toFixed(1) : '—'} m/s</b></div>
                                                            <div>🌧️ Lluvia día: <b>{l.lluvia_dia_mm != null ? l.lluvia_dia_mm.toFixed(1) : '—'} mm</b></div>
                                                            <div>🌿 ETₒ: <b>{l.eto_mm != null ? l.eto_mm.toFixed(2) : (l.et_dia_mm != null ? l.et_dia_mm.toFixed(2) : '—')} mm/día</b></div>
                                                        </div>
                                                    ) : <div style={{ fontSize: 11, color: '#999' }}>Sin lecturas registradas.</div>}
                                                </div>
                                            </Popup>
                                        </CircleMarker>
                                    );
                                })}
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
                <div className={clsx('geo-stats-panel', statsOpen && 'open')}>

                    {/* Element Detail Panel (Selected Element) */}
                    {selectedPoint && (
                        <div className="geo-detail-panel animate-in">
                            <div className="geo-detail-header">
                                <div className="geo-detail-title-group">
                                    {selectedPoint.type === 'escala' && <Gauge size={16} className="cyan" />}
                                    {selectedPoint.type === 'toma' && <Droplets size={16} className="green" />}
                                    {selectedPoint.type === 'presa' && <Droplets size={16} className="blue" />}
                                    <h3>{selectedPoint.data?.nombre || 'Elemento sin nombre'}</h3>
                                </div>
                                <button className="geo-detail-close" onClick={() => setSelectedPoint(null)}>×</button>
                            </div>

                            <div className="geo-detail-content">
                                <div className="geo-detail-id-tag">
                                    <span>UID: {(selectedPoint.data.id || '').substring(0, 8).toUpperCase() || (selectedPoint.data.presa_id || '').substring(0, 8).toUpperCase()}</span>
                                    <span>KM: {selectedPoint.data.km?.toFixed(3) || '0.000'}</span>
                                </div>

                                <div className="geo-detail-stats">
                                    {selectedPoint.type === 'escala' && (
                                        <>
                                            <div className="detail-stat">
                                                <label>Nivel Actual</label>
                                                <strong>{selectedPoint.data.nivel_actual ?? '—'} <small>m</small></strong>
                                            </div>
                                            <div className="detail-stat">
                                                <label>Gasto Calc.</label>
                                                <strong>{calcGasto(selectedPoint.data)?.toFixed(2) ?? '—'} <small>m³/s</small></strong>
                                            </div>
                                            {selectedPoint.data?.pzas_radiales > 0 && (
                                                <div className="detail-stat full geo-gate-panel">
                                                    <label className="geo-gate-panel-label">
                                                        <Layers size={12} className="text-cyan-400" />
                                                        Control de Represa ({selectedPoint.data.pzas_radiales} Compuertas)
                                                    </label>

                                                    {/* Representación Gráfica de Compuertas Radiales */}
                                                    <div className="geo-gate-row">
                                                        {Array.from({ length: selectedPoint.data.pzas_radiales }).map((_, i) => {
                                                            const apertura = parseFloat(selectedPoint.data.apertura_radiales_m || 0);
                                                            const altoMax = parseFloat(selectedPoint.data.alto || 3);
                                                            const fillPct = Math.min(100, Math.max(0, (apertura / altoMax) * 100));

                                                            return (
                                                                <div key={i} className="geo-gate-cell">
                                                                    {/* Background Agua */}
                                                                    <div className="geo-gate-water-bg"></div>

                                                                    {/* Cortina Mecánica (de arriba hacia abajo) */}
                                                                    <div className="geo-gate-curtain" style={{ height: `${100 - fillPct}%` }}>
                                                                        <div className="geo-gate-curtain-seam"></div>
                                                                    </div>

                                                                    {/* Flujo de Agua (la apertura por debajo) */}
                                                                    <div
                                                                        className="water-flow-anim geo-gate-flow"
                                                                        style={{
                                                                            height: `${fillPct}%`,
                                                                            background: fillPct > 0 ? 'linear-gradient(to bottom, rgba(34, 211, 238, 0.6), rgba(14, 165, 233, 0.9))' : 'transparent',
                                                                            borderTop: fillPct > 0 ? '1px solid rgba(255,255,255,0.3)' : 'none'
                                                                        }}
                                                                    ></div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>

                                                    <div className="geo-gate-stats">
                                                        <div className="geo-gate-stat">
                                                            <span className="geo-gate-stat-label">Apertura Prom.</span>
                                                            <div className="geo-gate-stat-value">
                                                                <span className="num cyan">{selectedPoint.data.apertura_radiales_m || '0.00'}</span>
                                                                <span className="unit">m</span>
                                                            </div>
                                                        </div>
                                                        <div className="geo-gate-stat align-end">
                                                            <span className="geo-gate-stat-label">Descarga Est.</span>
                                                            <div className="geo-gate-stat-value">
                                                                <span className="num">{calcGasto(selectedPoint.data)?.toFixed(2) ?? '0.00'}</span>
                                                                <span className="unit">m³/s</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                    {selectedPoint.type === 'toma' && (
                                        <>
                                            <div className="detail-stat">
                                                <label>Gasto (m³/s)</label>
                                                <strong>{selectedPoint.data.caudal?.toFixed(3) ?? '0.000'} <small className="text-slate-500 lowercase font-bold">m³/s</small></strong>
                                            </div>
                                            <div className="detail-stat full geo-volume-panel">
                                                <div className="geo-volume-row">
                                                    <div>
                                                        <span className="geo-gate-stat-label">Volumen Entregado (m³)</span>
                                                        <div className="geo-gate-stat-value" style={{ marginTop: 2 }}>
                                                            <span className="num cyan mono">
                                                                {Math.round((selectedPoint.data.volumen_acumulado || 0) * 1000000).toLocaleString()}
                                                            </span>
                                                            <span className="unit">m³</span>
                                                        </div>
                                                    </div>
                                                    <Layers size={16} className="text-cyan-600" opacity={0.5} />
                                                </div>
                                            </div>
                                        </>
                                    )}
                                    {selectedPoint.type === 'presa' && (
                                        <>
                                            <div className="detail-stat">
                                                <label>Llenado</label>
                                                <strong>{(selectedPoint.data.porcentaje_llenado ?? 0).toFixed(1)} <small>%</small></strong>
                                            </div>
                                            <div className="detail-stat">
                                                <label>Extracción</label>
                                                <strong>{(selectedPoint.data.extraccion_total_m3s ?? 0).toFixed(2)} <small>m³/s</small></strong>
                                            </div>
                                        </>
                                    )}
                                </div>

                                <div className="geo-detail-chart">
                                    <label>Tendencia Reciente (14 días)</label>
                                    <div style={{ height: '40px' }}>
                                        {historySeries?.values.length ? (
                                            <ReactECharts option={miniHistoryOptions} style={{ height: '100%', width: '100%' }} />
                                        ) : (
                                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', fontSize: 10, color: 'var(--geo-text-3)' }}>
                                                {historyLoading ? 'Cargando…' : 'Sin lecturas recientes'}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="geo-detail-actions">
                                    {selectedPoint.type === 'presa' && (
                                        <>
                                            <button
                                                className="geo-action-btn primary"
                                                onClick={() => { setSeccionVasoInicial('satelital'); setShowVaso(true); }}
                                            >
                                                <Maximize size={14} /> Analizar Vaso Satelital
                                            </button>
                                            <button
                                                className="geo-action-btn primary"
                                                onClick={() => { setSeccionVasoInicial('ciclo'); setShowVaso(true); }}
                                            >
                                                <CalendarRange size={14} /> Evolución del Ciclo
                                            </button>
                                            <button
                                                className="geo-action-btn primary"
                                                onClick={() => { setSeccionVasoInicial('relieve3d'); setShowVaso(true); }}
                                            >
                                                <Box size={14} /> Ver Relieve 3D
                                            </button>
                                        </>
                                    )}
                                    <button className="geo-action-btn primary" onClick={() => setShowHistoryModal(true)}>Ver historial completo</button>
                                    <button className="geo-action-btn">Reportar anomalía</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* KPI Cards vinculados a SICA */}
                    <div className="geo-kpi-grid">
                        <div className="geo-kpi-card" onClick={() => escalaEntrada && handleSelect('escala', escalaEntrada)}>
                            <div className="geo-kpi-label">
                                <Gauge size={12} /> Nivel Entrada ({escalaEntrada?.nombre || 'K-23'})
                            </div>
                            <div className="geo-kpi-value cyan">
                                {nivelEntrada?.toFixed(2) ?? '—'} <small>m</small>
                            </div>
                            {gastoEntrada && <div className="geo-kpi-sub">Q: {(gastoEntrada ?? 0).toFixed(2)} m³/s</div>}
                        </div>
                        <div className="geo-kpi-card" onClick={() => escalaSalida && handleSelect('escala', escalaSalida)}>
                            <div className="geo-kpi-label">
                                <Gauge size={12} /> Nivel Salida ({escalaSalida?.nombre || 'K-94'})
                            </div>
                            <div className="geo-kpi-value">
                                {nivelSalida?.toFixed(2) ?? '—'} <small>m</small>
                            </div>
                            {gastoSalida && <div className="geo-kpi-sub">Q: {(gastoSalida ?? 0).toFixed(2)} m³/s</div>}
                        </div>
                        <div className="geo-kpi-card">
                            <div className="geo-kpi-label">
                                <TrendingUp size={12} /> Eficiencia
                            </div>
                            <div className={clsx('geo-kpi-value', eficienciaTxt && parseFloat(eficienciaTxt) >= 90 ? 'green' : eficienciaTxt ? 'red' : '')}>
                                {eficienciaTxt ?? '—'}<small>%</small>
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

                    {/* Tomas Status Mini (Prioridad 3.1) con Filtros */}
                    <div className="geo-tomas-bar">
                        <div
                            className={clsx('geo-tomas-item open filter-btn', activeFilter === 'open' && 'active')}
                            onClick={() => setActiveFilter(activeFilter === 'open' ? 'all' : 'open')}
                        >
                            <span className="geo-tomas-count">{operStats.tomas_abiertas}</span>
                            <span className="geo-tomas-label">Abiertas</span>
                        </div>
                        <div
                            className={clsx('geo-tomas-item closed filter-btn', activeFilter === 'closed' && 'active')}
                            onClick={() => setActiveFilter(activeFilter === 'closed' ? 'all' : 'closed')}
                        >
                            <span className="geo-tomas-count">{operStats.tomas_cerradas}</span>
                            <span className="geo-tomas-label">Cerradas</span>
                        </div>
                        <div className="geo-tomas-item balance">
                            <span className="geo-balance-real">
                                {operStats.tomas_abiertas > 0 ? (gastoDistribuido ?? 0).toFixed(1) : '—'} <small>m³/s</small>
                            </span>
                            <div className="geo-balance-rule" />
                            <span className="geo-balance-prog">
                                {totalDemandaProgramada > 0 ? totalDemandaProgramada.toFixed(1) : '—'} <small>m³/s</small>
                            </span>
                            <span className="geo-tomas-label" style={{ marginTop: 4 }}>Balance (real / prog)</span>
                        </div>
                        <div
                            className={clsx('geo-tomas-item alert filter-btn', activeFilter === 'alert' && 'active')}
                            onClick={() => setActiveFilter(activeFilter === 'alert' ? 'all' : 'alert')}
                        >
                            <span className="geo-tomas-count">{tomasVaradas.length}</span>
                            <span className="geo-tomas-label">Varadas</span>
                        </div>
                    </div>

                    {/* Global Operational Health (MEJ-5) */}
                    <div className="geo-chart-card">
                        <div className="geo-stat-header">
                            <div>
                                <span className="geo-stat-title">Salud operacional global</span>
                                <p className="geo-stat-caption">Eficiencia hidráulica del sistema</p>
                            </div>
                            <Activity size={14} className="geo-stat-icon" style={{ color: eficienciaReal >= 90 ? '#34d399' : '#f5a623' }} />
                        </div>
                        <div className="geo-chart-wrapper" style={{ marginTop: '-15px' }}>
                            <ReactECharts option={chartGaugeOptions} style={{ height: '180px', width: '100%' }} opts={{ renderer: 'svg' }} />
                        </div>
                    </div>

                    {/* Perfil Longitudinal Premium (Prioridad 3.2) */}
                    <div className="geo-chart-card">
                        <div className="geo-stat-header" style={{ marginBottom: '12px' }}>
                            <div>
                                <span className="geo-stat-title">Perfil hidráulico digital</span>
                                <p className="geo-stat-caption">Comportamiento dinámico del canal</p>
                            </div>
                            <TrendingUp size={14} className="geo-stat-icon" />
                        </div>
                        <div className="geo-chart-wrapper">
                            <ReactECharts
                                option={profileOptions}
                                style={{ height: '150px', width: '100%' }}
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
                                    <div className="geo-event-card" onClick={() => {
                                        if (ev.point) {
                                            const point: any = ev.point;
                                            const list = point.type === 'toma' ? tomas : point.type === 'escala' ? escalas : presas;
                                            const d = (list as any[]).find(x => (x.id || x.presa_id) === point.id);
                                            if (d) handleSelect(point.type, d);
                                        }
                                    }}>
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

            {/* Vaso Monitor Overlay — Fase 1: nivel, capacidad y curva reales de
                lecturas_presas/presas/curvas_capacidad; "S/D" si falta el dato,
                nunca un valor fijo por presa_id (ver informe de auditoría). */}
            {showVaso && selectedPoint?.type === 'presa' && (
                <PresaVasoMonitor
                    data={{
                        nombre: selectedPoint.data.nombre,
                        nivel_msnm: selectedPoint.data.escala_msnm,
                        almacenamiento_mm3: selectedPoint.data.almacenamiento_mm3,
                        porcentaje: selectedPoint.data.porcentaje_llenado,
                        extraccion_m3s: selectedPoint.data.extraccion_total_m3s,
                        nivel_nma: selectedPoint.data.elevacion_corona_msnm,
                        capacidad_total: selectedPoint.data.capacidad_max,
                        presa_id: selectedPoint.data.presa_id,
                        curva: selectedPoint.data.curvas_capacidad,
                    }}
                    seccionInicial={seccionVasoInicial}
                    onClose={() => setShowVaso(false)}
                />
            )}

            {/* NDVI mensual por módulo — histórico (Fase 4b): panel dedicado,
                independiente del NDVI puntual bajo-demanda de consultarNdviModulo. */}
            {showNdviModulos && (
                <NdviModulosPanel onClose={() => setShowNdviModulos(false)} />
            )}

            {/* Modal de Historial Completo */}
            {showHistoryModal && selectedPoint && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in" onClick={() => setShowHistoryModal(false)}>
                    <div className="glass-card shadow-2xl p-6 w-full max-w-4xl border-white/10" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6 pb-4 border-b border-white/5">
                            <div className="flex items-center gap-3">
                                <Activity size={24} className="text-primary" />
                                <div>
                                    <h2 className="text-xl font-black text-white uppercase tracking-wider">{selectedPoint.data.nombre}</h2>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">Historial Operativo (Últimos 14 Días)</p>
                                </div>
                            </div>
                            <button className="p-2 bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors" onClick={() => setShowHistoryModal(false)}>
                                <X size={18} className="text-slate-400" />
                            </button>
                        </div>
                        <div className="h-[400px] w-full mt-4">
                            {historyLoading ? (
                                <div className="h-full w-full flex items-center justify-center text-slate-500 text-sm">Cargando historial…</div>
                            ) : !historySeries?.values.length ? (
                                <div className="h-full w-full flex items-center justify-center text-slate-500 text-sm">Sin lecturas registradas en los últimos 14 días</div>
                            ) : (
                                <ReactECharts option={fullHistoryOptions} style={{ height: '100%', width: '100%' }} />
                            )}
                        </div>
                    </div>
                </div>
            )}

            <WindyMapModal
                abierto={showWindy}
                onCerrar={() => setShowWindy(false)}
                lat={mapCenter[0]}
                lon={mapCenter[1]}
                titulo="GeoMonitor — Mapa animado"
            />
        </div>
    );
};

export default GeoMonitor;
