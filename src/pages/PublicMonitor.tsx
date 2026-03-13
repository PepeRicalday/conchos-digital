
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, ZoomControl, Marker } from 'react-leaflet';
import { supabase } from '../lib/supabase';
import { useHydricEvents } from '../hooks/useHydricEvents';
import { Droplets, TrendingUp, Timer, Clock, AlertCircle, Activity } from 'lucide-react';
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

const PublicMonitor: React.FC = () => {
    const { activeEvent } = useHydricEvents();
    const [escalas, setEscalas] = useState<EscalaData[]>([]);
    const [geoCanal, setGeoCanal] = useState<any>(null);
    const [realMaxKm, setRealMaxKm] = useState<number>(0);
    const [estMaxKm, setEstMaxKm] = useState<number>(0);

    // 1. Fetch Canal Geometry
    useEffect(() => {
        fetch('/geo/canal_conchos.geojson')
            .then(r => r.json())
            .then(data => {
                setGeoCanal(data);
            })
            .catch(err => console.error("Error loading canal geojson", err));
    }, []);

    // 2. Fetch Escalas & Wave Data
    const fetchData = useCallback(async () => {
        try {
            // Escalas Base
            const { data: escData } = await supabase
                .from('escalas')
                .select('id, nombre, km, latitud, longitud')
                .order('km');
            
            // Latest Readings for today
            const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Chihuahua' });
            const { data: readings } = await supabase
                .from('lecturas_escalas')
                .select('escala_id, nivel_m, fecha, hora_lectura')
                .eq('fecha', today)
                .order('hora_lectura', { ascending: false });

            const readingsMap = new Map();
            readings?.forEach(r => {
                if (!readingsMap.has(r.escala_id)) {
                    readingsMap.set(r.escala_id, {
                        nivel: r.nivel_m,
                        hora: r.hora_lectura,
                        fecha: r.fecha
                    });
                }
            });

            // Highest KM based on telemetry
            let maxTelemetryKm = 0;
            (escData || []).forEach(e => {
                const reading = readingsMap.get(e.id);
                if (reading?.nivel !== undefined && reading.nivel > 0 && e.km > maxTelemetryKm) {
                    maxTelemetryKm = e.km;
                }
            });

            // Calculate estimated KM based on velocity (aprox 4.2 km/h)
            let calculatedEstKm = 0;
            let finalRealMax = 0;
            if (activeEvent?.evento_tipo === 'LLENADO' && activeEvent.fecha_inicio) {
                const startTime = new Date(activeEvent.fecha_inicio).getTime();
                const now = Date.now();
                const elapsedHours = (now - startTime) / (1000 * 3600);
                const velocity = 4.2; // km/h (standard for Conchos filling)
                calculatedEstKm = Math.min(113, elapsedHours * velocity);

                    // Get Real Data (from tracking logs, if any)
                    const { data: waveData } = await supabase
                        .from('sica_llenado_seguimiento')
                        .select('km')
                        .eq('evento_id', activeEvent.id)
                        .not('hora_real', 'is', null)
                        .order('km', { ascending: false })
                        .limit(1)
                        .maybeSingle();
                    
                    finalRealMax = Math.max(waveData?.km || 0, maxTelemetryKm);
                    setRealMaxKm(finalRealMax);
                } else if (activeEvent?.evento_tipo === 'ESTABILIZACION') {
                    finalRealMax = 113;
                    setRealMaxKm(113);
                    calculatedEstKm = 113;
                } else {
                    finalRealMax = 113;
                    setRealMaxKm(113);
                    calculatedEstKm = 113;
                }
                
                // If telemetry max is somehow further ahead than the time calculation, use it.
                // This forces the "Avance del Frente" to snap to the latest confirmed field reading
                setEstMaxKm(Math.max(calculatedEstKm, finalRealMax));

            setEscalas((escData || []).map(e => {
                const reading = readingsMap.get(e.id);
                const nivel = reading?.nivel;
                let estado: any = 'ESPERANDO';
                
                // Prioritize real telemetry: if there's a level reading, water has arrived.
                if (nivel !== undefined && nivel > 0) estado = 'OPERANDO';
                else if (e.km <= realMaxKm) estado = 'OPERANDO';
                else if (e.km <= estMaxKm) estado = 'LLENADO';

                // Parse exact telemetry timestamp
                let timestamp = null;
                if (reading?.fecha && reading?.hora) {
                    timestamp = new Date(`${reading.fecha}T${reading.hora}-06:00`).getTime();
                }

                return {
                    ...e,
                    nivel_actual: nivel,
                    estado: estado,
                    ultima_telemetria: timestamp
                };
            }));
            
        } catch (err) {
            console.error("PublicMonitor fetch error", err);
        }
    }, [activeEvent]);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60000); // 1 min refresh
        return () => clearInterval(interval);
    }, [fetchData]);

    // Constant tick for smooth estimate animation (respecting real data gaps)
    useEffect(() => {
        if (activeEvent?.evento_tipo === 'LLENADO' && activeEvent.fecha_inicio) {
            const tick = setInterval(() => {
                const startTime = new Date(activeEvent.fecha_inicio!).getTime();
                const elapsedHours = (Date.now() - startTime) / (1000 * 3600);
                const velocity = 4.2;
                const calculated = Math.min(113, elapsedHours * velocity);
                // We use function state update to ensure we always have the latest 'estMaxKm'
                // and we will NEVER drop below what was already established. 
                setEstMaxKm(prevEst => Math.max(prevEst, calculated, realMaxKm));
            }, 10000); // Update estimate every 10s
            return () => clearInterval(tick);
        }
    }, [activeEvent, realMaxKm]);

    const displayMaxKm = useMemo(() => Math.max(realMaxKm, estMaxKm), [realMaxKm, estMaxKm]);

    // 3. Map Geometry Helpers
    const getPathSegment = useCallback((maxKm: number) => {
        if (!geoCanal || !geoCanal.features?.[0] || !escalas.length) return [];
        const coords = geoCanal.features[0].geometry.coordinates;

        // Use the official scales as physical anchors on the map
        const sortedEscalas = [...escalas]
            .filter(e => typeof e.latitud === 'number' && typeof e.longitud === 'number')
            .sort((a,b) => a.km - b.km);
            
        if (sortedEscalas.length === 0) return [];

        let prevScale = sortedEscalas[0];
        let nextScale = sortedEscalas[sortedEscalas.length - 1];

        // Find which two checkpoints the current advance is between
        for (let i = 0; i < sortedEscalas.length - 1; i++) {
             if (maxKm >= sortedEscalas[i].km && maxKm <= sortedEscalas[i+1].km) {
                 prevScale = sortedEscalas[i];
                 nextScale = sortedEscalas[i+1];
                 break;
             }
        }
        if (maxKm >= nextScale.km) {
            prevScale = nextScale;
        }

        // Helper to find the closest vertex on the canal polyline to a specific geo-coordinate
        const getClosestIndex = (lat: number, lon: number) => {
             let minD = Infinity;
             let idx = 0;
             for (let i = 0; i < coords.length; i++) {
                 const [clon, clat] = coords[i];
                 if (typeof clon === 'number' && typeof clat === 'number') {
                     // Fast euclidean distance approximation is enough for vertex matching
                     const d = Math.pow(clat - lat, 2) + Math.pow(clon - lon, 2);
                     if (d < minD) { minD = d; idx = i; }
                 }
             }
             return idx;
        };

        const prevIdx = getClosestIndex(prevScale.latitud!, prevScale.longitud!);
        let targetIdx = prevIdx;

        // Interpolate the exact array index between the two closest real-world checkpoints
        if (prevScale !== nextScale) {
             const nextIdx = getClosestIndex(nextScale.latitud!, nextScale.longitud!);
             const fraction = (maxKm - prevScale.km) / (nextScale.km - prevScale.km);
             targetIdx = prevIdx + Math.floor((nextIdx - prevIdx) * Math.max(0, Math.min(1, fraction)));
        } else if (maxKm > prevScale.km) {
             // If advancing past the final known scale, extrapolate to end of geometry
             const fraction = (maxKm - prevScale.km) / (113 - prevScale.km);
             targetIdx = prevIdx + Math.floor((coords.length - 1 - prevIdx) * fraction);
        }

        return coords.slice(0, Math.max(1, targetIdx)) // Give at least 1 point
            .filter((c: any) => c && typeof c[0] === 'number' && typeof c[1] === 'number')
            .map((c: any) => [c[1], c[0]]); // Leaflet uses [lat, lng]
    }, [geoCanal, escalas]);

    const canalFullLength = useMemo(() => getPathSegment(113), [getPathSegment]);
    const hydratedPath = useMemo(() => getPathSegment(displayMaxKm), [getPathSegment, displayMaxKm]);
    
    // Position for the Pulse Marker
    const frontCoords = useMemo(() => {
        if (hydratedPath.length === 0) return [28.530, -105.655]; // Boquilla approx start
        const last = hydratedPath[hydratedPath.length - 1];
        if (!last || typeof last[0] !== 'number' || typeof last[1] !== 'number') return [28.530, -105.655];
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
        if (!escalas || escalas.length === 0) return { name: "LA CRUZ", hours: 0, mins: 0 };
        
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

    // 5. Calculate Time Elapsed
    const elapsedTimeInfo = useMemo(() => {
        if (!activeEvent?.fecha_inicio) return { hours: 0, mins: 0 };
        const startTime = new Date(activeEvent.fecha_inicio).getTime();
        const diffMs = Date.now() - startTime;
        const totalHours = Math.max(0, diffMs / (1000 * 3600));
        const hr = Math.floor(totalHours);
        const min = Math.floor((totalHours - hr) * 60);
        return { hours: hr, mins: min };
    }, [activeEvent, estMaxKm]); // estMaxKm updates every 10s, ensuring this re-renders

    return (
        <div className="public-monitor-container">
            {/* Header */}
            <div className="public-header animate-in">
                <span className="cycle-top-label">CICLO AGRÍCOLA 2026</span>
                <div className="protocol-badge-premium">
                    <img src="/logos/logo-srl.png" alt="SRL Conchos" style={{ height: '45px', objectFit: 'contain' }} />
                    
                    <div className="status-dot-outer" style={{ marginLeft: '10px', marginRight: '5px' }}>
                        <div className="status-dot-pulse" style={{ borderColor: statusColor }}></div>
                        <div className="status-dot-inner" style={{ background: statusColor }}></div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', paddingRight: '15px', borderRight: '1px solid rgba(255,255,255,0.1)' }}>
                        <span className="protocol-subtitle">Seguimiento de Suministro Público · SICA Telemetría v3.1</span>
                        <span className="protocol-title">ESTADO DEL CANAL: <span style={{ color: statusColor }}>{protocolLabel}</span></span>
                    </div>

                    <img src="/logos/SICA005.png" alt="SICA 005" style={{ height: '45px', width: '45px', objectFit: 'cover', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.1)' }} />
                </div>
            </div>

            {/* Prediction Info Badge */}
            {activeEvent?.evento_tipo === 'LLENADO' && (
                <div className="prediction-badge animate-in" style={{ animationDelay: '0.2s' }}>
                    <div className="pulse-mini"></div>
                    <span>
                        <span style={{ opacity: 0.7 }}>AVANCE DEL FRENTE: </span> 
                        {((displayMaxKm/113)*100).toFixed(0)}% 
                        <span style={{ margin: '0 10px', opacity: 0.3 }}>|</span> 
                        <span style={{ opacity: 0.7 }}>PRÓXIMO A {nextTargetInfo.name}: </span>
                        {nextTargetInfo.hours > 0 ? `${nextTargetInfo.hours}H ` : ''}{nextTargetInfo.mins}M
                    </span>
                </div>
            )}

            {/* Right Side Info Floating Card */}
            {activeEvent?.evento_tipo === 'LLENADO' && (
                <div className="telemetry-floating-card animate-in" style={{ animationDelay: '0.6s' }}>
                    <div className="telemetry-floating-title">
                        <Activity size={14} color="#06b6d4" /> Análitica de Seguimiento
                    </div>
                    
                    <div className="tf-stat-row">
                        <span className="tf-stat-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Timer size={14}/> T. Transcurrido</span>
                        <span className="tf-stat-value">{elapsedTimeInfo.hours}H {elapsedTimeInfo.mins}M</span>
                    </div>

                    <div className="tf-stat-row">
                        <span className="tf-stat-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Clock size={14}/> Llegada a {nextTargetInfo.name}</span>
                        <span className="tf-stat-value" style={{ color: '#fbbf24', textShadow: '0 0 10px rgba(251, 191, 36, 0.4)' }}>
                            {nextTargetInfo.hours > 0 ? `${nextTargetInfo.hours}H ` : ''}{nextTargetInfo.mins}M
                        </span>
                    </div>

                    <div className="tf-alert-box">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', fontWeight: 'bold' }}>
                            <AlertCircle size={12} color="#06b6d4" /> RECEPCIÓN ACTIVA
                        </div>
                        Las escalas iniciales como el K-0 continúan recibiendo actualizaciones de nivel posteriores a la llegada del agua para evaluar la curva de estabilización y tirante volumétrico.
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
                    
                    {/* Canal Inactivo */}
                    <Polyline 
                        positions={canalFullLength} 
                        color="rgba(255,255,255,0.08)" 
                        weight={4} 
                        className="canal-path-base"
                    />

                    {/* Canal Activo (Animated Stream) */}
                    <Polyline 
                        positions={hydratedPath} 
                        color={statusColor} 
                        weight={6} 
                        className="canal-path-active"
                    />

                    {/* Front de Agua Marker */}
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
                                <div style={{ minWidth: '120px' }}>
                                    <div style={{ fontSize: '10px', textTransform: 'uppercase', opacity: 0.7 }}>{esc.km.toFixed(1)} KM</div>
                                    <b style={{ fontSize: '12px' }}>{esc.nombre}</b>
                                    {esc.nivel_actual && (
                                        <div style={{ marginTop: '5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                            <Droplets size={12} color={statusColor} />
                                            <span style={{ fontSize: '14px', fontWeight: 800 }}>{esc.nivel_actual.toFixed(2)} m</span>
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
            <div className="info-cards-dock animate-in" style={{ animationDelay: '0.4s' }}>
                {/* Section 1: Inflow Info */}
                <div className="dock-section summary-card-large">
                    <span className="card-label">SUMINISTRO ACTUAL</span>
                    <div className="summary-gasto">
                        <span className="gasto-value">
                            {activeEvent?.gasto_solicitado_m3s?.toFixed(2) || '45.00'}
                            <span className="gasto-unit">m³/s</span>
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
                            <span className="card-title" style={{ fontSize: '1.3rem', fontWeight: 600 }}>Avance de Llenado: <span style={{ color: statusColor, fontWeight: 800 }}>{((displayMaxKm/113)*100).toFixed(1)}%</span></span>
                        </div>
                    </div>
                    {/* Mini Chart Mockup */}
                    <div className="mini-chart-bars">
                        {[40, 45, 52, 58, 62, 70, 75, 82, 88, 92, 95, 100].map((h, i) => (
                            <div 
                                key={i} 
                                className="mini-bar" 
                                style={{ 
                                    height: `${(h * (displayMaxKm/113))}%`, 
                                    opacity: i/12 + 0.2,
                                    background: i > 8 ? 'var(--neon-cyan)' : 'rgba(6, 182, 212, 0.4)'
                                }}
                            ></div>
                        ))}
                    </div>
                </div>

                {/* Section 2: Checkpoints Grid */}
                <div className="dock-section" style={{ flex: 1 }}>
                    <span className="card-label">CHECKPOINTS RECIENTES (ÚLTIMOS 3)</span>
                    <div className="checkpoints-grid">
                        {escalas
                            .filter(e => e.km <= displayMaxKm + 10)
                            .slice(0, 3) // Show the first 3 relevant checkpoints from left to right
                            .map((e, idx) => (
                            <div className="checkpoint-card-premium" key={e.id}>
                                <div className="cp-header">
                                    <span className="cp-title">{idx + 1}. {e.nombre}</span>
                                    <span className={`cp-status-tag status-${e.estado?.toLowerCase()}`}>
                                        {e.estado}
                                    </span>
                                </div>
                                <div className="cp-data-row">
                                    <span className="cp-label">Nivel Actual</span>
                                    <span className="cp-value">{e.nivel_actual?.toFixed(2) || '0.00'}<span style={{ fontSize: '0.9rem', color: '#64748b', marginLeft: '4px' }}>m</span></span>
                                </div>
                                <div className="cp-trend-box">
                                    <TrendingUp size={14} color={e.nivel_actual ? statusColor : '#475569'} />
                                    <div style={{ flex: 1, height: '2px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px' }}>
                                        <div style={{ width: e.nivel_actual ? '70%' : '0%', height: '100%', background: statusColor }}></div>
                                    </div>
                                    <span className="telemetry-tag">TELEMETRÍA: {formatTimeAgo(e.ultima_telemetria)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PublicMonitor;
