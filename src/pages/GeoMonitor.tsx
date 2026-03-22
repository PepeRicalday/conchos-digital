import { Map as MapIcon, Activity, Crosshair, Layers, Wifi, TrendingUp, ShieldCheck, Droplets, Gauge, TriangleAlert, Maximize, Minimize, Upload, AlertTriangle, X } from 'lucide-react';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, WMSTileLayer, Marker, Popup, CircleMarker, Tooltip, GeoJSON, Polyline } from 'react-leaflet';
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
import { PresaVasoMonitor } from '../components/PresaVasoMonitor';
import { useMetadataStore } from '../store/useMetadataStore';

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
    apertura_radiales_m?: number;
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
    const [operStats] = useState<OperStats>({ tomas_abiertas: 0, tomas_cerradas: 0, gasto_distribuido_m3s: 0 });
    const [tomasVaradas, setTomasVaradas] = useState<VwAlertaTomaVaradaRow[]>([]);
    const [latestAforos, setLatestAforos] = useState<Record<string, any>>({});
    const [totalDemandaProgramada, setTotalDemandaProgramada] = useState(0);
    const [loading, setLoading] = useState(true);
    const [showVaso, setShowVaso] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);

    // Eventos Hidro-Sincrónicos
    const { activeEvent } = useHydricEvents();
    const [maxKmLlenado, setMaxKmLlenado] = useState<number>(1000);

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

        // VELOCIDAD CALIBRADA: 1.66 m/s = 6.0 km/h
        // Ajustado para asegurar que el frente supere visualmente el KM 68 (Ancla a las 08:00).
        const vRio = 3.0; // km/h
        const vCanal = activeEvent?.evento_tipo === 'LLENADO' ? 6.0 : (1.16 * 3.6); 

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

    // GeoJSON Layers (Shapes)
    const [geoModulos, setGeoModulos] = useState<GeoJSON.FeatureCollection | null>(null);
    const [geoPresas, setGeoPresas] = useState<GeoJSON.FeatureCollection | null>(null);
    const [geoCanal, setGeoCanal] = useState<GeoJSON.FeatureCollection | null>(null);
    const [geoRio, setGeoRio] = useState<GeoJSON.FeatureCollection | null>(null);
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
        rioShape: true,
        mostrarAforosQ: true,
        mostrarAperturas: true,
    });

    const [baseLayer, setBaseLayer] = useState<'standard' | 'satellite' | 'eos'>(() => {
        return (localStorage.getItem('geo_base_layer') as any) || 'satellite';
    });
    const [eosUrl, setEosUrl] = useState<string>(() => {
        return localStorage.getItem('geo_eos_url') || '';
    }); // Para almacenar la URL WMS de EOS

    useEffect(() => {
        localStorage.setItem('geo_base_layer', baseLayer);
    }, [baseLayer]);

    useEffect(() => {
        if (eosUrl) localStorage.setItem('geo_eos_url', eosUrl);
    }, [eosUrl]);

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
                if (modRes) setGeoModulos(modRes);
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
                supabase.from('lecturas_presas').select('presa_id, almacenamiento_mm3, porcentaje_llenado, extraccion_total_m3s, fecha').order('fecha', { ascending: false }).limit(3),
                supabase.from('aforos').select('punto_control_id, gasto_calculado_m3s, fecha, hora_inicio').gte('fecha', fiveDaysAgoStr).order('fecha', { ascending: false }).order('hora_inicio', { ascending: false }),
                supabase.from('vw_alertas_tomas_varadas').select('*'),
                supabase.from('reportes_operacion').select('punto_id, estado, caudal_promedio, hora_apertura, volumen_acumulado', { count: 'exact' }).eq('fecha', todayStr),
                supabase.from('reportes_diarios').select('punto_id, volumen_total_mm3, hora_apertura, hora_cierre, caudal_promedio_m3s').gte('fecha', fiveDaysAgoStr),
                supabase.from('modulos').select('id, caudal_objetivo')
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
                        extraccion_total_m3s: extraccion, fecha: lp.fecha
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
            roData?.forEach(r => roMap.set(r.punto_id, r));

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

        } catch (e) {
            console.error('GeoMonitor fetch error:', e);
        } finally {
            setLoading(false);
        }
    }, [activeEvent]);


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

    if (gastoEntrada && gastoEntrada > 0) {
        // Agua "Utilizada" = Lo que sale (K-104) + Lo que se entregó a las tomas
        const sumaAprovechamiento = (gastoSalida || 0) + gastoDistribuido;
        
        // Eficiencia Técnica %
        eficienciaReal = (sumaAprovechamiento / gastoEntrada) * 100;
        
        // Pérdida (Infiltración, evaporación, fugas)
        const perdidaM3s = gastoEntrada - sumaAprovechamiento;
        perdidaPct = (((perdidaM3s ?? 0) / gastoEntrada) * 100).toFixed(1);
        eficienciaTxt = (eficienciaReal ?? 0).toFixed(1);
    } else {
        eficienciaReal = totalDemandaProgramada > 0 ? (gastoDistribuido / totalDemandaProgramada) * 100 : 0;
        eficienciaTxt = (eficienciaReal ?? 0).toFixed(1);
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
                        { offset: 0, color: '#06b6d4' }, 
                        { offset: 1, color: '#22d3ee' }
                    ]) 
                }
            },
            pointer: { 
                show: true, length: '65%', width: 5, 
                itemStyle: { color: '#0ea5e9' } 
            },
            axisLine: { 
                lineStyle: { 
                    width: 14, 
                    color: [[0.7, '#ef4444'], [0.85, '#f59e0b'], [1, '#10b981']] 
                } 
            },
            axisTick: { show: false },
            splitLine: { distance: -18, length: 12, lineStyle: { color: 'rgba(255, 255, 255, 0.1)', width: 2 } },
            axisLabel: { distance: 18, color: '#475569', fontSize: 10, fontFamily: 'var(--geo-font-mono)' },
            detail: { 
                valueAnimation: true, 
                formatter: '{value}%', 
                color: '#fff', 
                fontSize: 28, 
                fontWeight: 900, 
                offsetCenter: [0, '25%'], 
                fontFamily: 'var(--geo-font-mono)' 
            },
            data: [{ 
                value: parseFloat(eficienciaReal.toFixed(1)), 
                name: 'Salud Operacional' 
            }],
            title: { 
                offsetCenter: [0, '75%'], 
                color: '#94a3b8', 
                fontSize: 10, 
                fontFamily: 'var(--geo-font-sans)', 
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
            axisLabel: { color: '#475569', fontSize: 8, rotate: 0, fontWeight: 700 },
            axisLine: { lineStyle: { color: 'rgba(51, 65, 85, 0.3)' } },
            axisTick: { show: false }
        },
        yAxis: {
            type: 'value' as const,
            min: 0,
            max: 4.5,
            axisLabel: { color: '#475569', fontSize: 9, formatter: '{value}m', fontFamily: 'var(--geo-font-mono)' },
            axisLine: { show: false },
            splitLine: { lineStyle: { color: 'rgba(51, 65, 85, 0.1)', type: 'dashed' } },
        },
        series: [
            {
                name: 'Nivel Óptimo',
                type: 'line',
                data: escalas.map(() => 3.2), // Línea Ideal
                symbol: 'none',
                lineStyle: { color: 'rgba(16, 185, 129, 0.2)', width: 1, type: 'dashed' },
                markArea: {
                    silent: true,
                    itemStyle: { color: 'rgba(16, 185, 129, 0.03)' },
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
                        { offset: 0, color: '#06b6d4' },
                        { offset: 1, color: '#3b82f6' }
                    ]), 
                    width: 4,
                    shadowBlur: 10,
                    shadowColor: 'rgba(6, 182, 212, 0.4)'
                },
                itemStyle: { 
                    color: '#fff', 
                    borderColor: '#22d3ee', 
                    borderWidth: 2,
                    shadowBlur: 5,
                    shadowColor: 'rgba(0,0,0,0.5)'
                },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(6, 182, 212, 0.3)' },
                        { offset: 1, color: 'rgba(6, 182, 212, 0)' }
                    ])
                }
            }
        ],
        tooltip: {
            trigger: 'axis' as const,
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            borderColor: '#22d3ee',
            padding: [10, 15],
            textStyle: { color: '#f8fafc', fontSize: 12, fontFamily: 'var(--geo-font-sans)' },
            formatter: (params: any) => {
                const dataIndex = params[0].dataIndex;
                const esc = escalas[dataIndex];
                const level = esc?.nivel_actual;
                const status = (level ?? 0) > 3.4 
                    ? 'CRÍTICO (+)' 
                    : (level ?? 0) < (activeEvent?.evento_tipo === 'LLENADO' ? 0.1 : 2.8) 
                        ? 'CRÍTICO (-)' 
                        : 'ÓPTIMO';
                const statusColor = (status === 'ÓPTIMO' || (status === 'CRÍTICO (-)' && activeEvent?.evento_tipo === 'LLENADO')) ? '#10b981' : '#ef4444';
                
                return `
                    <div style="min-width: 140px">
                        <div style="font-weight: 800; font-size: 14px; margin-bottom: 4px; color: #fff">${esc?.nombre} <small style="color: #64748b">KM ${esc?.km}</small></div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px">
                            <span style="color: #94a3b8; font-size: 10px; font-weight: 700">ESTADO</span>
                            <span style="color: ${statusColor}; font-size: 10px; font-weight: 900">${status}</span>
                        </div>
                        <div style="background: rgba(255,255,255,0.05); padding: 8px; border-radius: 6px; display: flex; align-items: baseline; gap: 4px">
                            <span style="color: #22d3ee; font-size: 20px; font-weight: 900; font-family: var(--geo-font-mono)">${level ?? '—'}</span>
                            <span style="color: #64748b; font-size: 12px; font-weight: 600">metros</span>
                        </div>
                    </div>
                `;
            }
        },
    };

    const miniHistoryOptions = {
        backgroundColor: 'transparent',
        grid: { left: 5, right: 5, top: 5, bottom: 5 },
        xAxis: { type: 'category', show: false },
        yAxis: { type: 'value', show: false },
        series: [{
            data: [2.1, 2.3, 2.2, 2.5, 2.4, 2.6, 2.5],
            type: 'line', smooth: true, symbol: 'none',
            lineStyle: { color: '#22d3ee', width: 2 },
            areaStyle: { color: 'rgba(34, 211, 238, 0.1)' }
        }]
    };

    const fullHistoryOptions = {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(2, 6, 23, 0.9)', borderColor: '#1e293b', textStyle: { color: '#f8fafc', fontSize: 11, fontFamily: 'monospace' } },
        grid: { left: 40, right: 20, top: 40, bottom: 30 },
        xAxis: { type: 'category', data: ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'], axisLabel: { color: '#64748b', fontSize: 10, fontWeight: 'bold' } },
        yAxis: { type: 'value', axisLabel: { color: '#64748b', fontSize: 10, fontFamily: 'monospace' }, splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } } },
        series: [{
            name: selectedPoint?.type === 'escala' ? 'Nivel (m)' : selectedPoint?.type === 'toma' ? 'Caudal (m³/s)' : 'Extracción',
            data: [2.1, 2.3, 2.2, 2.5, 2.4, 2.6, 2.5, 2.4, 2.3, 2.2, 2.4, 2.5],
            type: 'line', smooth: true, symbol: 'circle', symbolSize: 8,
            lineStyle: { color: '#22d3ee', width: 3, shadowColor: 'rgba(34, 211, 238, 0.5)', shadowBlur: 10 },
            itemStyle: { color: '#22d3ee', borderColor: '#020617', borderWidth: 2 },
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
                        {layers.modulos && <span className="geo-indicator-dot geo-indicator-purple"></span>}
                    </button>
                    <button
                        className={clsx('geo-control-btn', layers.presasShape ? 'active' : 'default')}
                        onClick={() => toggleLayer('presasShape')}
                        title="Polígonos de Vasos de Presas"
                    >
                        <Droplets size={22} />
                        {layers.presasShape && <span className="geo-indicator-dot geo-indicator-blue"></span>}
                    </button>
                    <button
                        className={clsx('geo-control-btn', layers.rioShape ? 'active' : 'default')}
                        onClick={() => toggleLayer('rioShape')}
                        title="Trazado del Río Conchos"
                    >
                        <Activity size={22} className="geo-icon-blue" />
                        {layers.rioShape && <span className="geo-indicator-dot geo-indicator-blue"></span>}
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
                            className="geo-control-btn default geo-btn-import"
                            onClick={() => setShowImporter(true)}
                            title="Importar Shapefile / GeoJSON"
                        >
                            <Upload size={20} />
                        </button>
                    )}

                    <div className="geo-divider-h"></div>

                    {/* Visual Toggles (User Request Improvements) */}
                    <button
                        className={clsx('geo-control-btn', layers.mostrarAforosQ ? 'active' : 'default')}
                        onClick={() => toggleLayer('mostrarAforosQ')}
                        title="Ver Gastos de Aforos de Control"
                    >
                        <TrendingUp size={20} className={layers.mostrarAforosQ ? 'geo-icon-amber' : ''} />
                        {layers.mostrarAforosQ && <span className="geo-indicator-dot geo-indicator-amber"></span>}
                    </button>
                    <button
                        className={clsx('geo-control-btn', layers.mostrarAperturas ? 'active' : 'default')}
                        onClick={() => toggleLayer('mostrarAperturas')}
                        title="Ver Apertura de Compuertas"
                    >
                        <Gauge size={20} className={layers.mostrarAperturas ? 'geo-icon-teal' : ''} />
                        {layers.mostrarAperturas && <span className="geo-indicator-dot geo-indicator-teal"></span>}
                    </button>

                    <div className="geo-layer-divider" style={{ height: '1px', background: 'rgba(255,255,255,0.05)', margin: '8px 4px' }}></div>

                    {/* Base Layer Selector */}
                    <button
                        className={clsx('geo-control-btn', baseLayer === 'standard' ? 'active' : 'default')}
                        onClick={() => setBaseLayer('standard')}
                        title="Mapa Estándar"
                    >
                        <MapIcon size={20} />
                    </button>
                    <button
                        className={clsx('geo-control-btn', baseLayer === 'satellite' ? 'active' : 'default')}
                        onClick={() => setBaseLayer('satellite')}
                        title="Satélite ArcGIS"
                    >
                        <Layers size={20} />
                    </button>
                    <button
                        className={clsx('geo-control-btn', baseLayer === 'eos' ? 'active' : 'default')}
                        onClick={() => {
                            if (baseLayer === 'eos') {
                                // Si ya estamos en EOS, preguntar si quiere cambiar la URL
                                const url = prompt("Cambiar WMS URL de EOS LandViewer (deja vacío para mantener la actual):", eosUrl);
                                if (url) {
                                    if (url && (url.includes('landviewer/es?') || url.includes('landviewer/en?'))) {
                                        alert("¡Atención! Has pegado la URL del navegador. Para que el mapa funcione, necesitas la 'URL de Integración WMS' que se encuentra en el menú de integración de EOS.");
                                    }
                                    setEosUrl(url);
                                }
                            } else {
                                if (!eosUrl) {
                                    const url = prompt("Introduce tu WMS URL de EOS LandViewer:", eosUrl);
                                    if (url) {
                                        if (url.includes('landviewer/es?') || url.includes('landviewer/en?')) {
                                            alert("¡Atención! Has pegado la URL del navegador. Para que el mapa funcione, necesitas la 'URL de Integración WMS' que se encuentra en el menú de integración de EOS.");
                                        }
                                        setEosUrl(url);
                                    }
                                }
                                setBaseLayer('eos');
                            }
                        }}
                        title={eosUrl ? "Cambiar / Activar EOS LandViewer" : "Activar EOS LandViewer (Requiere WMS URL)"}
                    >
                        <Wifi size={20} className={baseLayer === 'eos' ? 'text-amber-400' : ''} />
                        {baseLayer === 'eos' && <span className="geo-indicator-dot" style={{ background: '#f59e0b' }}></span>}
                    </button>
                </div>

                {/* CENTER: MAP (Prioridad 1 + 2) */}
                <div className="geo-map-container" style={{ position: 'relative' }}>
                    <div className="geo-map-inner">
                        {/* Protocol HUD Banner */}
                        {activeEvent && (
                            <div className={clsx(
                                'geo-event-banner',
                                activeEvent.evento_tipo === 'LLENADO' && 'geo-event-bg-llenado',
                                activeEvent.evento_tipo === 'ESTABILIZACION' && 'geo-event-bg-estabilizacion',
                                activeEvent.evento_tipo === 'CONTINGENCIA_LLUVIA' && 'geo-event-bg-contingencia',
                                activeEvent.evento_tipo === 'ANOMALIA_BAJA' && 'geo-event-bg-anomalia',
                                !['LLENADO', 'ESTABILIZACION', 'CONTINGENCIA_LLUVIA', 'ANOMALIA_BAJA'].includes(activeEvent.evento_tipo) && 'geo-event-bg-alerta'
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
                                                : 'Procesando...'} | Sincronizando con Canaleros.
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
                                                    <div style="font-family:var(--geo-font-sans);min-width:180px">
                                                        <strong style="font-size:14px;font-weight:800;color:${p.color}">${p.nombre}</strong>
                                                        <div style="font-size:11px;color:#cbd5e1;margin:4px 0;text-transform:uppercase;letter-spacing:0.05em">Módulo ${p.numero_modulo}</div>
                                                        <div style="font-size:12px;font-family:var(--geo-font-mono)">Superficie: <b style="color:#fff">${p.superficie_ha?.toLocaleString()} ha</b></div>
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
                                                Arribo actual: Km {(maxKmLlenado ?? 0).toFixed(1)}
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
                                                <div className="detail-stat full" style={{ marginTop: 8, padding: '12px 10px', background: 'rgba(15, 23, 42, 0.6)', borderRadius: 8, border: '1px solid rgba(30, 41, 59, 1)' }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                                                        <Layers size={12} className="text-cyan-400" />
                                                        Control de Represa ({selectedPoint.data.pzas_radiales} Compuertas)
                                                    </label>
                                                    
                                                    {/* Representación Gráfica de Compuertas Radiales */}
                                                    <div style={{ display: 'flex', gap: 6, marginBottom: 16, justifyContent: 'center', height: '44px' }}>
                                                        {Array.from({ length: selectedPoint.data.pzas_radiales }).map((_, i) => {
                                                            const apertura = parseFloat(selectedPoint.data.apertura_radiales_m || 0);
                                                            const altoMax = parseFloat(selectedPoint.data.alto || 3);
                                                            const fillPct = Math.min(100, Math.max(0, (apertura / altoMax) * 100));
                                                            
                                                            return (
                                                                <div key={i} style={{ 
                                                                    flex: 1, 
                                                                    maxWidth: '28px',
                                                                    background: '#020617', 
                                                                    border: '1px solid #1e293b', 
                                                                    borderRadius: '2px', 
                                                                    position: 'relative', 
                                                                    overflow: 'hidden',
                                                                    boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)'
                                                                }}>
                                                                    {/* Background Agua */}
                                                                    <div style={{ width: '100%', height: '100%', background: 'rgba(34, 211, 238, 0.05)', position: 'absolute' }}></div>
                                                                    
                                                                    {/* Cortina Mecánica (de arriba hacia abajo) */}
                                                                    <div style={{
                                                                        width: '100%',
                                                                        height: `${100 - fillPct}%`,
                                                                        background: 'linear-gradient(to bottom, #64748b, #334155)',
                                                                        position: 'absolute',
                                                                        top: 0,
                                                                        borderBottom: '3px solid #94a3b8',
                                                                        zIndex: 1,
                                                                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)'
                                                                    }}>
                                                                        <div style={{ borderBottom: '1px solid rgba(0,0,0,0.2)', borderTop: '1px solid rgba(255,255,255,0.05)', height: '40%', width: '100%', marginTop: '30%' }}></div>
                                                                    </div>
                                                                    
                                                                    {/* Flujo de Agua (la apertura por debajo) */}
                                                                    <div className="water-flow-anim" style={{
                                                                        width: '100%',
                                                                        height: `${fillPct}%`,
                                                                        background: fillPct > 0 ? 'linear-gradient(to bottom, rgba(34, 211, 238, 0.6), rgba(14, 165, 233, 0.9))' : 'transparent',
                                                                        position: 'absolute',
                                                                        bottom: 0,
                                                                        zIndex: 2,
                                                                        borderTop: fillPct > 0 ? '1px solid rgba(255,255,255,0.3)' : 'none'
                                                                    }}></div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>

                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', padding: '0 4px' }}>
                                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                            <span style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Apertura Prom.</span>
                                                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                                                                <span style={{ fontSize: 18, fontWeight: 900, color: '#22d3ee', lineHeight: 1 }}>{selectedPoint.data.apertura_radiales_m || '0.00'}</span>
                                                                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>m</span>
                                                            </div>
                                                        </div>
                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                                            <span style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Descarga Est.</span>
                                                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                                                                <span style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc', lineHeight: 1 }}>{calcGasto(selectedPoint.data)?.toFixed(2) ?? '0.00'}</span>
                                                                <span style={{ fontSize: 9, color: '#64748b', fontWeight: 600 }}>m³/s</span>
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
                                            <div className="detail-stat full" style={{ marginTop: 8, padding: 8, background: 'rgba(34, 211, 238, 0.05)', borderRadius: 8, border: '1px solid rgba(34, 211, 238, 0.1)' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                        <span style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Volumen Entregado (m³)</span>
                                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 2 }}>
                                                            <span style={{ fontSize: 18, fontWeight: 900, color: '#22d3ee', fontFamily: 'monospace' }}>
                                                                {Math.round((selectedPoint.data.volumen_acumulado || 0) * 1000000).toLocaleString()}
                                                            </span>
                                                            <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>m³</span>
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
                                    <label>Tendencia Reciente (12h)</label>
                                    <div style={{ height: '40px' }}>
                                        <ReactECharts option={miniHistoryOptions} style={{ height: '100%', width: '100%' }} />
                                    </div>
                                </div>

                                <div className="geo-detail-actions">
                                    {selectedPoint.type === 'presa' && (
                                        <button
                                            className="geo-action-btn primary"
                                            onClick={() => setShowVaso(true)}
                                        >
                                            <Maximize size={14} /> Analizar Vaso Satelital
                                        </button>
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
                            {gastoEntrada && <div style={{ fontSize: 9, color: '#64748b', marginTop: 2, fontFamily: 'monospace' }}>Q: {(gastoEntrada ?? 0).toFixed(2)} m³/s</div>}
                        </div>
                        <div className="geo-kpi-card" onClick={() => escalaSalida && handleSelect('escala', escalaSalida)}>
                            <div className="geo-kpi-label">
                                <Gauge size={12} /> Nivel Salida ({escalaSalida?.nombre || 'K-94'})
                            </div>
                            <div className="geo-kpi-value">
                                {nivelSalida?.toFixed(2) ?? '—'} <small>m</small>
                            </div>
                            {gastoSalida && <div style={{ fontSize: 9, color: '#64748b', marginTop: 2, fontFamily: 'monospace' }}>Q: {(gastoSalida ?? 0).toFixed(2)} m³/s</div>}
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
                        <div className="geo-tomas-item split-glass" style={{ background: 'rgba(15, 23, 42, 0.4)', padding: '6px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                                <span className="geo-tomas-count" style={{ color: '#22d3ee', fontFamily: 'monospace', fontSize: '1.2rem', lineHeight: 1.2 }}>
                                    {(gastoDistribuido ?? 0).toFixed(1)} <small style={{ fontSize: '0.6rem', color: '#94a3b8' }}>m³/s</small>
                                </span>
                                <div style={{ height: '1px', width: '80%', background: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />
                                <span style={{ color: '#64748b', fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: 1 }}>
                                    {(totalDemandaProgramada ?? 0).toFixed(1)} <small style={{ fontSize: '0.55rem' }}>m³/s</small>
                                </span>
                            </div>
                            <span className="geo-tomas-label" style={{ marginTop: '4px', fontSize: '9px', letterSpacing: '0.05em' }}>BALANCE (REAL / PROG)</span>
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
                                <span className="geo-stat-title">SALUD OPERACIONAL GLOBAL</span>
                                <p style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', marginTop: '2px' }}>Eficiencia Hidráulica del Sistema</p>
                            </div>
                            <Activity size={14} className="geo-stat-icon" style={{ color: eficienciaReal >= 90 ? '#10b981' : '#f59e0b' }} />
                        </div>
                        <div className="geo-chart-wrapper" style={{ marginTop: '-15px' }}>
                            <ReactECharts option={chartGaugeOptions} style={{ height: '180px', width: '100%' }} opts={{ renderer: 'svg' }} />
                        </div>
                    </div>

                    {/* Perfil Longitudinal Premium (Prioridad 3.2) */}
                    <div className="geo-chart-card">
                        <div className="geo-stat-header" style={{ marginBottom: '12px' }}>
                            <div>
                                <span className="geo-stat-title">PERFIL HIDRÁULICO DIGITAL</span>
                                <p style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', marginTop: '2px' }}>Comportamiento Dinámico del Canal</p>
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

            {/* Vaso Monitor Overlay */}
            {showVaso && selectedPoint?.type === 'presa' && (
                <PresaVasoMonitor
                    data={{
                        nombre: selectedPoint.data.nombre,
                        nivel_msnm: (selectedPoint.data.presa_id === 'BOQUILLA' ? 1317.40 : 1240.20), // Mock data or from actual readings
                        almacenamiento_mm3: selectedPoint.data.almacenamiento_mm3,
                        porcentaje: selectedPoint.data.porcentaje_llenado,
                        extraccion_m3s: selectedPoint.data.extraccion_total_m3s,
                        nivel_nma: (selectedPoint.data.presa_id === 'BOQUILLA' ? 1317.0 : 1242.0),
                        capacidad_total: 2893.5, // Mm3
                        presa_id: selectedPoint.data.presa_id
                    }}
                    onClose={() => setShowVaso(false)}
                />
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
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">Historial Operativo (24 Horas Recientes)</p>
                                </div>
                            </div>
                            <button className="p-2 bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors" onClick={() => setShowHistoryModal(false)}>
                                <X size={18} className="text-slate-400" />
                            </button>
                        </div>
                        <div className="h-[400px] w-full mt-4">
                            <ReactECharts option={fullHistoryOptions} style={{ height: '100%', width: '100%' }} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GeoMonitor;
