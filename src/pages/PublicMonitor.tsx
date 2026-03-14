import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, ZoomControl, Marker } from 'react-leaflet';
import { supabase } from '../lib/supabase';
import { useHydricEvents } from '../hooks/useHydricEvents';
import { Droplets, Timer, Activity, AlertCircle, TrendingUp, Gauge, Activity as ActivityIcon } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './PublicMonitor.css';

// Custom Marker for Water Front
const waterFrontIcon = L.divIcon({
    className: 'water-front-marker',
    html: `
        <div class="pulse-waves">
            <div class="wave"></div>
            <div class="wave wave-delay-1"></div>
            <div class="wave wave-delay-2"></div>
            <div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); width:12px; height:12px; background:#22d3ee; border-radius:50%; border:2px solid #fff; box-shadow:0 0 10px #22d3ee; z-index:10;"></div>
        </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
});

interface EscalaData {
    id: string;
    nombre: string;
    km: number;
    latitud?: number;
    longitud?: number;
    nivel_actual?: number;
    estado?: 'OPERANDO' | 'LLENADO' | 'ESPERANDO';
    ultima_telemetria?: number | null;
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

const PublicMonitor: React.FC = () => {
    const { activeEvent } = useHydricEvents();
    const [escalas, setEscalas] = useState<EscalaData[]>([]);
    const [geoCanal, setGeoCanal] = useState<any>(null);
    const [geoRio, setGeoRio] = useState<any>(null);
    const [realMaxKm, setRealMaxKm] = useState<number>(-36);
    const [presasData, setPresasData] = useState<any[]>([]);
    
    // Panel Visibility States - Start deactivated for professional clean view
    const [isDockVisible, setIsDockVisible] = useState(true); // Open by default for better data exposure
    const [isPredictionVisible, setIsPredictionVisible] = useState(false);


    // 1. Fetch Canal Geometry
    useEffect(() => {
        const loadGeo = async () => {
            const [canRes, rioRes] = await Promise.all([
                fetch('/geo/canal_conchos.geojson').then(r => r.json()).catch(() => null),
                fetch('/geo/rio_conchos.geojson').then(r => r.json()).catch(() => null)
            ]);
            if (canRes) setGeoCanal(canRes);
            if (rioRes) setGeoRio(rioRes);
        };
        loadGeo();
    }, []);

    // 2. Fetch Escalas & Wave Data
    const fetchData = useCallback(async () => {
        try {
            // Escalas Base
            const { data: escData } = await supabase
                .from('escalas')
                .select('id, nombre, km, latitud, longitud')
                .order('km');
            
            // 2. Fetch Presas (Dams) Telemetry
            const { data: pData } = await supabase
                .from('registros_presas')
                .select(`
                    *,
                    presas:presa_id (nombre, nombre_corto)
                `)
                .order('fecha', { ascending: false })
                .limit(4); // Ultimos registros de Boquilla y Madero

            // Sincronía Digital: Fallback si no hay telemetría reciente pero hay protocolo activo
            let finalPresas = pData || [];
            if (activeEvent?.evento_tipo === 'LLENADO' && activeEvent.gasto_solicitado_m3s) {
                const hasBoquilla = finalPresas.some(p => p.presas?.nombre_corto === 'PLB' && p.extraccion_total > 0);
                if (!hasBoquilla) {
                    // Inject synthetic record for Boquilla during LLENADO
                    finalPresas = [
                        {
                            id: 'fallback-plb',
                            presa_id: 'PRE-001',
                            extraccion_total: activeEvent.gasto_solicitado_m3s,
                            fecha: new Date().toISOString(),
                            presas: { nombre: 'La Boquilla', nombre_corto: 'PLB' }
                        },
                        ...finalPresas
                    ];
                }
            }

            setPresasData(finalPresas);

            // 3. Latest Readings for today
            const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Chihuahua' });
            const { data: readings } = await supabase
                .from('lecturas_escalas')
                .select('escala_id, nivel_m, fecha, hora_lectura')
                .eq('fecha', today)
                .order('hora_lectura', { ascending: false });

            // Anchor of Truth: Only show water if the dam has actually opened (hora_apertura_real)
            // If not opened, everything is ZERO.
            const flowStartTime = activeEvent?.hora_apertura_real ? new Date(activeEvent.hora_apertura_real).getTime() : null;
            
            const readingsMap = new Map();
            if (flowStartTime) {
                readings?.forEach(r => {
                    const readingTime = new Date(`${r.fecha}T${r.hora_lectura}-06:00`).getTime();
                    // Only accept if it's within the CURRENT active flow window
                    if (readingTime >= flowStartTime) {
                        if (!readingsMap.has(r.escala_id)) {
                            readingsMap.set(r.escala_id, {
                                nivel: r.nivel_m,
                                hora: r.hora_lectura,
                                fecha: r.fecha,
                                timestamp: readingTime
                            });
                        }
                    }
                });
            }

            // 4. Fetch confirmed progress from Llenado Tracker
            if (activeEvent?.evento_tipo === 'LLENADO') {
                const { data: trackData } = await supabase
                    .from('sica_llenado_seguimiento')
                    .select('km')
                    .eq('evento_id', activeEvent.id)
                    .not('hora_real', 'is', null)
                    .order('km', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                
                if (trackData) {
                    setRealMaxKm(trackData.km);
                    // Anchor Logic: If we have confirmed data, we can also fetch the exact time of that confirmation
                    // to potentially use as a new reference for future predictions.
                    const { data: latestConfirm } = await supabase
                        .from('sica_llenado_seguimiento')
                        .select('hora_real')
                        .eq('evento_id', activeEvent.id)
                        .eq('km', trackData.km)
                        .maybeSingle();
                    
                    if (latestConfirm?.hora_real) {
                        // Store this for prediction anchoring
                        sessionStorage.setItem(`anchor_time_${trackData.km}`, latestConfirm.hora_real);
                    }
                } else if (activeEvent.hora_apertura_real) {
                    setRealMaxKm(-36); // Started at dam
                } else {
                    setRealMaxKm(-36); // Default start
                }
            } else {
                setRealMaxKm(113); // Full flow if not in filling
            }

            const baseEscalas = (escData || []).map(e => {
                const reading = readingsMap.get(e.id);
                const nivel = reading?.nivel;
                let estado: any = 'ESPERANDO';
                
                if (nivel !== undefined && nivel > 0) estado = 'OPERANDO';
                else if (realMaxKm !== undefined && e.km <= realMaxKm) estado = 'OPERANDO';

                let timestamp = reading?.timestamp || null;

                return {
                    ...e,
                    nivel_actual: nivel,
                    estado: estado,
                    ultima_telemetria: timestamp,
                    fuente: e.km === 0 ? 'BOQUILLA' : e.km > 100 ? 'MADERO' : null
                };
            });

            if (activeEvent?.evento_tipo === 'LLENADO') {
                const presaReading = (pData || []).find((p: any) => p.presas?.nombre_corto === 'PLB');
                const extraccionReal = presaReading?.extraccion_total || 0;
                const extraccionFallback = activeEvent.gasto_solicitado_m3s || 30;

                baseEscalas.unshift({
                    id: 'presa-boquilla',
                    nombre: 'PRESA LA BOQUILLA',
                    km: -36,
                    nivel_actual: extraccionReal > 0 ? extraccionReal : extraccionFallback,
                    estado: activeEvent.hora_apertura_real ? 'OPERANDO' : 'ESPERANDO',
                    ultima_telemetria: extraccionReal > 0 ? new Date(presaReading!.fecha).getTime() : Date.now(),
                    latitud: 27.545,
                    longitud: -105.414
                } as any);
            }

            setEscalas(baseEscalas);
            
        } catch (err) {
            console.error("PublicMonitor fetch error", err);
        }
    }, [activeEvent]);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60000); // 1 min refresh
        return () => clearInterval(interval);
    }, [fetchData]);

    // 5. Predicted Front Position (Hydra Engine Logic)
    const predictedMaxKm = useMemo(() => {
        if (!activeEvent?.hora_apertura_real) return -36;
        
        // 1. Find the latest confirmed point (Anchor)
        // We look into the scales data which is updated by fetchData
        const confirmedScales = escalas.filter(e => e.estado === 'OPERANDO' && e.km <= realMaxKm);
        const lastAnchor = confirmedScales.length > 0 ? confirmedScales[confirmedScales.length - 1] : null;

        let startTime = new Date(activeEvent.hora_apertura_real).getTime();
        let startKm = -36;

        if (lastAnchor) {
            const anchorTimeStr = sessionStorage.getItem(`anchor_time_${lastAnchor.km}`);
            if (anchorTimeStr) {
                startTime = new Date(anchorTimeStr).getTime();
                startKm = lastAnchor.km;
            }
        }

        const elapsedHours = (Date.now() - startTime) / (1000 * 3600);
        if (elapsedHours <= 0) return startKm;

        // 2. Velocity Calculation (Reference: 12 Hours for 36KM = 3 KM/H for the river)
        // This is the "reference data" requested by the user.
        const vRio = 3.0; // km/h (36km / 12h)
        const vCanal = 1.16 * 3.6; // km/h (design value for canal)

        let currentKm = startKm;
        let remainingHours = elapsedHours;

        if (currentKm < 0) {
            // Still in the river stretch
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
            // Progress into the canal
            currentKm += remainingHours * vCanal;
        }

        return Math.min(currentKm, 113);
    }, [activeEvent, realMaxKm, escalas]);

    // El avance del frente depende de telemetría confirmada O el modelado de travesía (Hidro-Sincronía)
    const displayMaxKm = useMemo(() => {
        if (!activeEvent || activeEvent.evento_tipo !== 'LLENADO') return 113;
        // Priorizamos la predicción si es mayor que lo confirmado, para reflejar el "modelado de llegada"
        return Math.max(realMaxKm, predictedMaxKm);
    }, [realMaxKm, predictedMaxKm, activeEvent]);

    // Mapeo de distancias para el Río (GeoMonitor style)
    const rioDistData = useMemo(() => {
        if (!geoRio) return [];
        const coords = geoRio.features?.[0]?.geometry?.coordinates as [number, number][];
        if (!coords) return [];
        let total = 0;
        const data = [{ lat: coords[0][1], lng: coords[0][0], dist: -36 }];
        for (let i = 1; i < coords.length; i++) {
            const d = haversineDist(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1]);
            total += d;
            data.push({ lat: coords[i][1], lng: coords[i][0], dist: -36 + total });
        }
        const factor = total > 0 ? 36 / total : 1;
        data.forEach(d => d.dist = -36 + (d.dist + 36) * factor);
        return data;
    }, [geoRio]);

    const canalDistData = useMemo(() => {
        if (!geoCanal) return [];
        const coords = geoCanal.features?.[0]?.geometry?.coordinates as [number, number][];
        if (!coords) return [];
        let total = 0;
        const data = [{ lat: coords[0][1], lng: coords[0][0], dist: 0 }];
        for (let i = 1; i < coords.length; i++) {
            const d = haversineDist(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1]);
            total += d;
            data.push({ lat: coords[i][1], lng: coords[i][0], dist: total });
        }
        const factor = total > 0 ? 104 / total : 1;
        data.forEach(d => d.dist *= factor);
        return data;
    }, [geoCanal]);

    const rioFullLength = useMemo(() => rioDistData.map(d => [d.lat, d.lng] as [number, number]), [rioDistData]);
    const canalFullLength = useMemo(() => canalDistData.map(d => [d.lat, d.lng] as [number, number]), [canalDistData]);
    
    const hydratedPath = useMemo(() => {
        const rioPart = rioDistData.filter(d => d.dist <= displayMaxKm).map(d => [d.lat, d.lng] as [number, number]);
        const canalPart = displayMaxKm > 0 ? canalDistData.filter(d => d.dist <= displayMaxKm).map(d => [d.lat, d.lng] as [number, number]) : [];
        return [...rioPart, ...canalPart];
    }, [rioDistData, canalDistData, displayMaxKm]);
    
    // Position for the Pulse Marker
    const frontCoords = useMemo(() => {
        if (hydratedPath.length === 0) return [27.545, -105.414]; // Presa approx start
        const last = hydratedPath[hydratedPath.length - 1];
        if (!last || typeof last[0] !== 'number' || typeof last[1] !== 'number') return [27.545, -105.414];
        return last;
    }, [hydratedPath]);

    const protocolLabel = activeEvent?.evento_tipo || 'OPERACIÓN NORMAL';
    const statusColor = activeEvent?.evento_tipo === 'LLENADO' ? '#06b6d4' : '#22c55e';

    // Helper to format exact time ago for telemetry
    const formatTimeAgo = (timestamp?: number | null) => {
        if (!timestamp) return 'SIN DATOS';
        const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
        if (diffSeconds < 60) return `HACE ${diffSeconds}s`;
        const diffMins = Math.floor(diffSeconds / 60);
        if (diffMins < 60) return `HACE ${diffMins}m`;
        const diffHours = Math.floor(diffMins / 60);
        return `HACE ${diffHours}h`;
    };

    // 4. Calculate Dynamic Target Estimation (Hydra Engine Logic)
    const nextTargetInfo = useMemo(() => {
        if (!escalas || escalas.length === 0) return { name: "Buscando...", hours: 0, mins: 0, kmRemaining: 0 };
        
        // Find the first scale that is geographically ahead of our current water front
        const sorted = [...escalas].sort((a,b) => a.km - b.km);
        const nextScale = sorted.find(e => e.km > displayMaxKm);
        
        if (!nextScale) return { name: "Terminado", hours: 0, mins: 0, kmRemaining: 0 };

        // Distance remaining to that specific checkpoint
        const distRemaining = nextScale.km - displayMaxKm;
        
        // Velocidades del canal por tramo (Unificados con Regla 12h)
        const vRioKmh = 3.0; // Referencia: 36km / 12h
        const vCanalKmh = 1.16 * 3.6; // km/h (diseño)

        let totalHours = 0;
        if (displayMaxKm < 0) {
            // El frente está en el río
            const distInRio = Math.min(distRemaining, -displayMaxKm);
            const distInCanal = Math.max(0, distRemaining - distInRio);
            totalHours = (distInRio / vRioKmh) + (distInCanal / vCanalKmh);
        } else {
            // El frente ya está en el canal
            totalHours = distRemaining / vCanalKmh;
        }

        const hr = Math.floor(totalHours);
        const min = Math.floor((totalHours - hr) * 60);

        return {
            name: nextScale.nombre.toUpperCase(),
            hours: hr,
            mins: min,
            kmRemaining: distRemaining.toFixed(1)
        };
    }, [escalas, displayMaxKm, activeEvent]);


    // 6. Executive/Managerial Metrics
    const executiveMetrics = useMemo(() => {
        const totalRequested = activeEvent?.gasto_solicitado_m3s || 0;
        let totalReal = 0;
        presasData.forEach(p => { totalReal += (p.extraccion_total || 0); });
        
        const efficiency = totalRequested > 0 ? (totalReal / totalRequested) * 100 : 0;
        const healthStatus = efficiency > 95 ? 'OPTIMO' : efficiency > 85 ? 'PRECAUCIÓN' : 'REVISIÓN';
        const healthColor = efficiency > 95 ? '#22c55e' : efficiency > 85 ? '#eab308' : '#ef4444';

        return {
            totalReal,
            efficiency,
            healthStatus,
            healthColor
        };
    }, [activeEvent, presasData]);

    return (
        <div className="public-monitor-container">
            {/* Header */}
            <div className="public-header animate-in">
                <div className="header-top-row">
                    <button 
                        className="back-to-dashboard-btn" 
                        onClick={() => window.location.href = '/'}
                        title="Regresar a Conchos Digital"
                    >
                        <Activity size={16} /> REGRESAR A SISTEMA
                    </button>
                    <span className="cycle-top-label">CICLO AGRÍCOLA 2026</span>
                </div>
                
                <div className="protocol-badge-premium">
                    <img src="/logos/logo-srl.png" alt="SRL Conchos" className="logo-srl-header" />
                    
                    <div className="status-dot-container">
                        <div className="status-dot-pulse" style={{ borderColor: statusColor }}></div>
                        <div className="status-dot-inner" style={{ background: statusColor }}></div>
                    </div>

                    <div className="protocol-text-container">
                        <span className="protocol-subtitle">Seguimiento de Suministro Público · SICA Telemetría v3.1</span>
                        <span className="protocol-title">ESTADO DEL CANAL: <span className="protocol-status-label" style={{ color: statusColor }}>{protocolLabel}</span></span>
                    </div>

                    <div className="executive-vitals-divider"></div>

                    <div className="executive-vitals">
                        <div className="vital-item">
                            <span className="vital-label">EFICIENCIA</span>
                            <span className="vital-value" style={{ color: executiveMetrics.healthColor }}>{executiveMetrics.efficiency.toFixed(1)}%</span>
                        </div>
                        <div className="vital-item">
                            <span className="vital-label">STATUS</span>
                            <span className="vital-value">{executiveMetrics.healthStatus}</span>
                        </div>
                    </div>

                    <img src="/logos/SICA005.png" alt="SICA 005" className="logo-sica-header" />
                </div>
            </div>

            {/* Predicted position badge - Floating over map */}
            {activeEvent?.evento_tipo === 'LLENADO' && isPredictionVisible && (
                <div className="prediction-badge animate-in">
                    <div className="pulse-mini"></div>
                    <span className="prediction-text">
                        <span className="prediction-label">PRÓXIMO: {nextTargetInfo.name} </span>
                        {nextTargetInfo.hours > 0 ? `${nextTargetInfo.hours}H ` : ''}{nextTargetInfo.mins}M
                    </span>
                    <button className="panel-toggle-mini" onClick={() => setIsPredictionVisible(false)}>×</button>
                </div>
            )}

            {/* Map Wrapper */}
            <div className="public-map-wrapper">
                <MapContainer 
                    center={[28.25, -105.45]} 
                    zoom={10} 
                    zoomControl={false}
                    style={{ height: "100%", width: "100%" }}
                >
                    <TileLayer
                        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                        attribution='&copy; CARTO'
                    />
                    
                    {/* Río y Canal Inactivo */}
                    <Polyline 
                        positions={rioFullLength} 
                        color="rgba(255,255,255,0.08)" 
                        weight={4} 
                    />
                    <Polyline 
                        positions={canalFullLength} 
                        color="rgba(255,255,255,0.08)" 
                        weight={4} 
                        className="canal-path-base"
                    />

                    {/* Canal Activo (Stream) - Solo visible si hay avance real confirmado */}
                    {activeEvent?.evento_tipo === 'LLENADO' && (
                        <Polyline 
                            positions={hydratedPath} 
                            color={statusColor} 
                            weight={6} 
                            className="canal-path-active"
                        />
                    )}

                    {/* Front de Agua Marker - Solo visible si hay avance real confirmado */}
                    {activeEvent?.evento_tipo === 'LLENADO' && typeof frontCoords[0] === 'number' && typeof frontCoords[1] === 'number' && (
                        <Marker position={frontCoords as any} icon={waterFrontIcon} />
                    )}

                    {/* Escalas Relevantes */}
                    {escalas.filter(esc => typeof esc.latitud === 'number' && typeof esc.longitud === 'number' && esc.km <= displayMaxKm + 20).map(esc => (
                        <CircleMarker
                            key={esc.id}
                            center={[esc.latitud!, esc.longitud!]}
                            radius={esc.km <= displayMaxKm ? 6 : 4}
                            fillColor={esc.km <= displayMaxKm ? statusColor : '#1e293b'}
                            color="#fff"
                            weight={1.5}
                            fillOpacity={1}
                        >
                            <Tooltip className="custom-tooltip" direction="top" offset={[0, -10]}>
                                <div className="tooltip-content">
                                    <div className="tooltip-km">{esc.km.toFixed(1)} KM</div>
                                    <b className="tooltip-name">{esc.nombre}</b>
                                    {esc.nivel_actual !== undefined && (
                                        <div className="tooltip-payload">
                                            <Droplets size={12} color={statusColor} />
                                            <span className="tooltip-value">
                                                {esc.nivel_actual.toFixed(2)} {esc.km < 0 ? 'm³/s' : 'm'}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </Tooltip>
                        </CircleMarker>
                    ))}

                    <ZoomControl position="bottomright" />
                </MapContainer>
            </div>

            {/* Bottom Dock - Balanced layout to avoid 'heavy right' look */}
            {isDockVisible ? (
                <div className="info-cards-dock animate-in" style={{ animationDelay: '0.4s' }}>
                    <button className="dock-close-btn" onClick={() => setIsDockVisible(false)} title="Cerrar tablero">×</button>
                    
                    {/* Section 1: Global Balance (Left) */}
                    <div className="dock-section summary-card-large">
                        <div className="managerial-card-header">
                            <span className="card-label">BALANCE HÍDRICO</span>
                            <div className="health-badge-premium" style={{ borderColor: executiveMetrics.healthColor }}>
                                <div className="health-dot" style={{ background: executiveMetrics.healthColor }}></div>
                                {executiveMetrics.healthStatus}
                            </div>
                        </div>
                        <div className="summary-gasto">
                            <span className="gasto-value">
                                {executiveMetrics.totalReal.toFixed(2)}
                                <span className="gasto-unit">m³/s</span>
                            </span>
                            <div className="summary-info-row">
                                <span className="summary-info-title">📊 PROGRESO: <span className="summary-info-value" style={{ color: statusColor }}>{(((displayMaxKm + 36) / (113 + 36)) * 100).toFixed(1)}%</span></span>
                            </div>
                        </div>
                    </div>

                    {/* Section 2: Sources Detail (Center) - Integrated from floating card */}
                    <div className="dock-section sources-card-section">
                        <div className="dock-section-header">
                            <span className="card-label">FUENTES ACTIVAS</span>
                        </div>
                        <div className="fuentes-summary-grid-dock">
                            {presasData.map(p => (
                                <div className="fuente-dock-mini" key={p.id}>
                                    <span className="fdm-name">{p.presas?.nombre_corto === 'PLB' ? 'BOQUILLA' : 'MADERO'}</span>
                                    <span className="fdm-val">{p.extraccion_total?.toFixed(2)} <small>m³/s</small></span>
                                </div>
                            ))}
                            <div className="fuente-dock-mini time">
                                <span className="fdm-name">INICIO</span>
                                <span className="fdm-val">
                                    {activeEvent?.hora_apertura_real ? 
                                        new Date(activeEvent.hora_apertura_real).toLocaleTimeString('es-MX', { 
                                            hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Chihuahua' 
                                        }) : '--:--'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Section 2: Checkpoints Grid - Visualización compacta de toda la red de escalas */}
                    <div className="dock-section" style={{ flex: 1, overflow: 'hidden' }}>
                        <div className="dock-section-header">
                            <span className="card-label">RED DE PUNTOS DE CONTROL</span>
                            <span className="telemetry-tag" style={{ color: statusColor }}>● MONITOREO TOTAL ACTIVO</span>
                        </div>
                        <div className="checkpoints-scroll-container">
                            {escalas
                                .sort((a, b) => a.km - b.km) // Orden natural del canal para lectura fluida
                                .map((e) => (
                                <div className={`checkpoint-card-compact ${e.km <= displayMaxKm ? 'active' : ''}`} key={e.id}>
                                    <div className="cpc-km">{e.km.toFixed(1)} <small>KM</small></div>
                                    <div className="cpc-body">
                                        <span className="cpc-name">{e.nombre}</span>
                                        <div className="cpc-data">
                                            <span className="cpc-value">{e.nivel_actual?.toFixed(2) || '0.00'}</span>
                                            <small className="cpc-unit">m</small>
                                        </div>
                                    </div>
                                    <div className="cpc-status-bar">
                                        <div 
                                            className="cpc-progress" 
                                            style={{ 
                                                width: e.km <= displayMaxKm ? '100%' : '0%',
                                                background: e.estado === 'OPERANDO' ? '#22c55e' : statusColor
                                            }}
                                        ></div>
                                    </div>
                                    <div className="cpc-time">{formatTimeAgo(e.ultima_telemetria)}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="dock-minimized animate-in" onClick={() => setIsDockVisible(true)}>
                    <Activity size={20} />
                    <span>VER TABLERO TÉCNICO</span>
                </div>
            )}

            <div className="floating-ui-controls-v2">
                {!isPredictionVisible && activeEvent?.evento_tipo === 'LLENADO' && (
                    <button className="control-btn-premium" onClick={() => setIsPredictionVisible(true)} title="Mostrar avance del frente">
                        <Timer size={18} />
                        <span className="btn-label">TRAYECTO</span>
                    </button>
                )}
                {!isDockVisible && (
                    <button className="control-btn-premium" onClick={() => setIsDockVisible(true)} title="Mostrar tablero">
                        <Activity size={18} />
                        <span className="btn-label">TABLERO</span>
                    </button>
                )}
            </div>
        </div>
    );
};

export default PublicMonitor;
