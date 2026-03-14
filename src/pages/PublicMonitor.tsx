
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, ZoomControl, Marker } from 'react-leaflet';
import { supabase } from '../lib/supabase';
import { useHydricEvents } from '../hooks/useHydricEvents';
import { Droplets, Timer, Clock, AlertCircle, Activity } from 'lucide-react';
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
    const [isTelemetryVisible, setIsTelemetryVisible] = useState(false);
    const [isDockVisible, setIsDockVisible] = useState(false);
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

            setPresasData(pData || []);

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
                baseEscalas.unshift({
                    id: 'presa-boquilla',
                    nombre: 'PRESA LA BOQUILLA',
                    km: -36,
                    nivel_actual: presaReading?.extraccion_total || 0,
                    estado: activeEvent.hora_apertura_real ? 'OPERANDO' : 'ESPERANDO',
                    ultima_telemetria: presaReading ? new Date(presaReading.fecha).getTime() : null,
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

    // SIMULACIÓN ELIMINADA: El cronómetro y el avance están congelados hasta registrar datos reales.
    useEffect(() => {
        // No se realiza ninguna acción de estimación temporal. 
        // El avance ahora es puramente reactivo a la telemetría field-confirmed.
    }, []);

    // El avance del frente depende exclusivamente de telemetría confirmada o tracking de llenado
    const displayMaxKm = useMemo(() => {
        if (!activeEvent || activeEvent.evento_tipo !== 'LLENADO') return 113;
        return realMaxKm;
    }, [realMaxKm, activeEvent]);

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

    // 4. Calculate Dynamic Target Estimation
    const nextTargetInfo = useMemo(() => {
        if (!escalas || escalas.length === 0) return { name: "Buscando...", hours: 0, mins: 0 };
        
        // Find the first scale that is geographically ahead of our current water front
        const sorted = [...escalas].sort((a,b) => a.km - b.km);
        const nextScale = sorted.find(e => e.km > displayMaxKm);
        
        if (!nextScale) return { name: "PRESA FR. I. MADERO", hours: 0, mins: 0 };

        // Distance remaining to that specific checkpoint
        const distRemaining = nextScale.km - displayMaxKm;
        
        // Time To Arrival (Velocity = 4.2 km/h)
        const totalHours = distRemaining / 4.2;
        const hr = Math.floor(totalHours);
        const min = Math.floor((totalHours - hr) * 60);

        return {
            name: nextScale.nombre.toUpperCase(),
            hours: hr,
            mins: min
        };
    }, [escalas, displayMaxKm]);

    // 5. Elapsed Time since Effective Start
    const elapsedTimeInfo = useMemo(() => {
        if (!activeEvent?.hora_apertura_real) return { hours: 0, mins: 0 };
        const start = new Date(activeEvent.hora_apertura_real).getTime();
        const diffMs = Date.now() - start;
        const totalHours = Math.max(0, diffMs / (1000 * 3600));
        const hr = Math.floor(totalHours);
        const min = Math.floor((totalHours - hr) * 60);
        return { hours: hr, mins: min };
    }, [activeEvent, displayMaxKm]);

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
                <span className="cycle-top-label">CICLO AGRÍCOLA 2026</span>
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

            {/* Prediction Info Badge */}
            {activeEvent?.evento_tipo === 'LLENADO' && isPredictionVisible && (
                <div className="prediction-badge animate-in">
                    <div className="pulse-mini"></div>
                    <span className="prediction-text">
                        <span className="prediction-label">AVANCE DEL FRENTE: </span> 
                        {(((displayMaxKm + 36) / (113 + 36)) * 100).toFixed(0)}% 
                        <span className="prediction-divider">|</span> 
                        <span className="prediction-label">PRÓXIMO A {nextTargetInfo.name}: </span>
                        {nextTargetInfo.hours > 0 ? `${nextTargetInfo.hours}H ` : ''}{nextTargetInfo.mins}M
                    </span>
                    <button className="panel-toggle-mini" onClick={() => setIsPredictionVisible(false)} title="Ocultar avance">×</button>
                </div>
            )}

            {/* Right Side Info Floating Card - Analítica de Seguimiento Agrupada */}
            {activeEvent?.evento_tipo === 'LLENADO' && isTelemetryVisible && (
                <div className="telemetry-floating-card animate-in" style={{ animationDelay: '0.6s' }}>
                    <div className="telemetry-floating-header">
                        <div className="telemetry-floating-title">
                            <Activity size={14} color="#06b6d4" /> Resumen de Fuentes (Presas)
                        </div>
                        <button className="panel-toggle-mini" onClick={() => setIsTelemetryVisible(false)} title="Ocultar resumen">×</button>
                    </div>
                    
                    {/* Agrupación de Fuentes: Boquilla y Madero */}
                    <div className="fuentes-summary-grid">
                        {presasData.length > 0 ? (
                            presasData.map(p => (
                                <div className="fuente-item-premium" key={p.id}>
                                    <div className="fuente-dot" style={{ backgroundColor: p.presas?.nombre_corto === 'PLB' ? '#3b82f6' : '#a78bfa' }}></div>
                                    <div className="fuente-info">
                                        <span className="fuente-name">{p.presas?.nombre?.toUpperCase()}</span>
                                        <span className="fuente-status">{p.extraccion_total > 0 ? 'SUMINISTRO ACTIVO' : 'CERRADA'}</span>
                                    </div>
                                    <span className="fuente-val">{p.extraccion_total?.toFixed(2) || '0.00'} <small className="fuente-val-unit">m³/s</small></span>
                                </div>
                            ))
                        ) : (
                            <>
                                <div className="fuente-item-premium">
                                    <div className="fuente-dot" style={{ background: '#3b82f6' }}></div>
                                    <div className="fuente-info">
                                        <span className="fuente-name">LA BOQUILLA</span>
                                        <span className="fuente-status">SIN TELEMETRÍA</span>
                                    </div>
                                    <span className="fuente-val">0.00 <small>m³/s</small></span>
                                </div>
                                <div className="fuente-item-premium">
                                    <div className="fuente-dot" style={{ background: '#a78bfa' }}></div>
                                    <div className="fuente-info">
                                        <span className="fuente-name">FR. I. MADERO</span>
                                        <span className="fuente-status">SIN TELEMETRÍA</span>
                                    </div>
                                    <span className="fuente-val">0.00 <small>m³/s</small></span>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="tf-divider"></div>

                    <div className="tf-stat-row">
                        <span className="tf-stat-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Timer size={14}/> Suministro Efectivo</span>
                        <span className="tf-stat-value">{displayMaxKm > 0 ? `${elapsedTimeInfo.hours}H ${elapsedTimeInfo.mins}M` : 'EN ESPERA'}</span>
                    </div>

                    <div className="tf-stat-row">
                        <span className="tf-stat-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Clock size={14}/> {displayMaxKm > 0 ? `Estimado a ${nextTargetInfo.name}` : 'A la espera de Obra de Toma'}</span>
                        <span className="tf-stat-value" style={{ color: '#fbbf24' }}>
                            {displayMaxKm > 0 ? (
                                <>
                                    {nextTargetInfo.hours > 0 ? `${nextTargetInfo.hours}H ` : ''}{nextTargetInfo.mins}M
                                </>
                            ) : '--:--'}
                        </span>
                    </div>

                    <div className="tf-alert-box">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', fontWeight: 'bold' }}>
                            <AlertCircle size={12} color="#06b6d4" /> ACTUALIZACIÓN TÉCNICA
                        </div>
                        Los puntos de control se actualizan automáticamente al recibir validación de los inspectores en campo vía SICA Capture.
                    </div>
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
                                    {esc.nivel_actual && (
                                        <div className="tooltip-payload">
                                            <Droplets size={12} color={statusColor} />
                                            <span className="tooltip-value">{esc.nivel_actual.toFixed(2)} m</span>
                                        </div>
                                    )}
                                </div>
                            </Tooltip>
                        </CircleMarker>
                    ))}

                    <ZoomControl position="bottomright" />
                </MapContainer>
            </div>

            {/* Bottom Dock */}
            {isDockVisible ? (
                <div className="info-cards-dock animate-in" style={{ animationDelay: '0.4s' }}>
                    <button className="dock-close-btn" onClick={() => setIsDockVisible(false)} title="Cerrar tablero">×</button>
                    {/* Section 1: Inflow Info */}
                    <div className="dock-section summary-card-large">
                        <div className="managerial-card-header">
                            <span className="card-label">SUMINISTRO Y BALANCE HÍDRICO</span>
                            <div className="health-badge-premium" style={{ borderColor: executiveMetrics.healthColor }}>
                                <div className="health-dot" style={{ background: executiveMetrics.healthColor }}></div>
                                {executiveMetrics.healthStatus}
                            </div>
                        </div>
                        <div className="summary-gasto">
                            <span className="gasto-value">
                                {executiveMetrics.totalReal.toFixed(2)}
                                <span className="gasto-unit">m³/s REAL</span>
                            </span>
                            <div className="summary-info-row">
                                <span className="summary-info-title">📊 PROGRESO TOTAL (RED GLOBAL): <span className="summary-info-value" style={{ color: statusColor }}>{(((displayMaxKm + 36) / (113 + 36)) * 100).toFixed(1)}%</span></span>
                            </div>
                        </div>
                        {/* Mini Chart Mockup with Hydro-Sync Context */}
                        <div className="mini-chart-bars-gerencial">
                            {[40, 45, 52, 58, 62, 70, 75, 82, 88, 92, 95, 100].map((h, i) => {
                                const isAnomaly = executiveMetrics.efficiency < 85 && i > 8;
                                return (
                                    <div 
                                        key={i} 
                                        className={`mini-bar ${isAnomaly ? 'anomaly' : ''}`}
                                        style={{ 
                                            height: `${(h * ((displayMaxKm + 36)/(113 + 36)))}%`, 
                                            opacity: i/12 + 0.3,
                                            background: isAnomaly ? '#ef4444' : (i > 8 ? 'var(--neon-cyan)' : 'rgba(6, 182, 212, 0.4)')
                                        }}
                                    ></div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Section 2: Checkpoints Grid - Visualización compacta de toda la red de escalas */}
                    <div className="dock-section" style={{ flex: 1, overflow: 'hidden' }}>
                        <div className="dock-section-header">
                            <span className="card-label">RED DE PUNTOS DE CONTROL (SINCRO-ESTADÍSTICA)</span>
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

            {/* Floating Re-open buttons for mobile */}
            <div className="floating-ui-controls">
                {!isPredictionVisible && (
                    <button className="control-btn-mini" onClick={() => setIsPredictionVisible(true)} title="Mostrar avance">
                        <Timer size={16} />
                    </button>
                )}
                {!isTelemetryVisible && (
                    <button className="control-btn-mini" onClick={() => setIsTelemetryVisible(true)} title="Mostrar resumen">
                        <Activity size={16} />
                    </button>
                )}
            </div>
        </div>
    );
};

export default PublicMonitor;
