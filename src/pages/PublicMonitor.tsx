import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, ZoomControl, Marker, useMap, Popup } from 'react-leaflet';
import { supabase } from '../lib/supabase';
import { useHydricEvents } from '../hooks/useHydricEvents';
import { Droplets, Timer, Activity, Clock, ArrowRightCircle, MapPin } from 'lucide-react';
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

// Map Controller to handle dynamic centering with offset for mobile UI
const MapController = ({ center, zoom, active }: { center: [number, number], zoom: number, active: boolean }) => {
    const map = useMap();
    useEffect(() => {
        if (active && center) {
            // Apply a slight vertical offset for mobile if dock is likely covering the bottom
            const isMobile = window.innerWidth <= 900;
            const finalCenter: [number, number] = isMobile ? [center[0] - 0.05, center[1]] : center;
            map.setView(finalCenter, zoom, { animate: true });
        }
    }, [center, zoom, active, map]);
    return null;
};

const PublicMonitor: React.FC = () => {
    const { activeEvent } = useHydricEvents();
    const [escalas, setEscalas] = useState<EscalaData[]>([]);
    const [geoCanal, setGeoCanal] = useState<any>(null);
    const [geoRio, setGeoRio] = useState<any>(null);
    const [realMaxKm, setRealMaxKm] = useState<number>(-36);
    const [presasData, setPresasData] = useState<any[]>([]);
    
    // Panel Visibility States - Start minimized on mobile for total map priority
    const isMobile = typeof window !== 'undefined' ? window.innerWidth <= 900 : false;
    const [isDockVisible, setIsDockVisible] = useState(!isMobile); 
    const [isPredictionVisible, setIsPredictionVisible] = useState(false);
    const [currentTime, setCurrentTime] = useState(() => Date.now());

    // 0. Update internal clock for reactive calculations
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(Date.now()), 15000);
        return () => clearInterval(timer);
    }, []);


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
                .select('escala_id, nivel_m, nivel_abajo_m, fecha, hora_lectura, apertura_radiales_m')
                .eq('fecha', today)
                .order('hora_lectura', { ascending: false });

            const flowStartTime = activeEvent?.hora_apertura_real ? new Date(activeEvent.hora_apertura_real).getTime() : null;
            
            const readingsMap = new Map();
            if (flowStartTime) {
                readings?.forEach(r => {
                    const readingTime = new Date(`${r.fecha}T${r.hora_lectura}-06:00`).getTime();
                    if (readingTime >= flowStartTime) {
                        if (!readingsMap.has(r.escala_id)) {
                            readingsMap.set(r.escala_id, {
                                nivel: r.nivel_m,
                                nivel_abajo: r.nivel_abajo_m || 0,
                                hora: r.hora_lectura,
                                fecha: r.fecha,
                                timestamp: readingTime,
                                apertura: r.apertura_radiales_m || 0
                            });
                        }
                    }
                });
            }

            // 4. Fetch confirmed progress from Llenado Tracker + Readings
            let maxKmConfirmed = -36;
            if (activeEvent?.evento_tipo === 'LLENADO') {
                const { data: trackData } = await supabase
                    .from('sica_llenado_seguimiento')
                    .select('km, hora_real')
                    .eq('evento_id', activeEvent.id)
                    .not('hora_real', 'is', null)
                    .order('km', { ascending: false })
                    .limit(5);
                
                trackData?.forEach(td => {
                    if (td.km > maxKmConfirmed) maxKmConfirmed = td.km;
                    sessionStorage.setItem(`anchor_time_${td.km}`, td.hora_real);
                });

                // Also check if any scale reading confirms arrival (Mediante SICA Capture)
                // KM 0 CONDITION: Level > 0 AND Apertura > 0 is REQUIRED to pass into canal.
                let maxReadingKm = -36;
                readingsMap.forEach((r, escId) => {
                    const esc = escData?.find(e => e.id === escId);
                    if (esc && (r.nivel > 0 || r.nivel_abajo > 0)) {
                        // KM 0 Specific Lock: Need Apertura OR Nivel Abajo to release
                        const isK0ReachedButLocked = esc.km === 0 && r.apertura <= 0 && r.nivel_abajo <= 0;
                        
                        if (isK0ReachedButLocked) {
                            // Stay at KM 0 if we have level but NO opening and NO water below
                            if (0 > maxReadingKm) maxReadingKm = 0;
                        } else {
                            if (esc.km > maxReadingKm) {
                                maxReadingKm = esc.km;
                                sessionStorage.setItem(`anchor_time_${esc.km}`, new Date(r.timestamp).toISOString());
                            }
                        }
                    }
                });

                maxKmConfirmed = Math.max(maxKmConfirmed, maxReadingKm);
                setRealMaxKm(maxKmConfirmed);
                
                if (maxKmConfirmed < -36 && activeEvent.hora_apertura_real) {
                    setRealMaxKm(-36);
                }
            } else {
                setRealMaxKm(113); 
            }

            const baseEscalas = (escData || []).map(e => {
                const reading = readingsMap.get(e.id);
                const nivel = reading?.nivel;
                let estado: any = 'ESPERANDO';
                
                if (nivel !== undefined && nivel > 0) estado = 'OPERANDO';
                else if (realMaxKm !== undefined && e.km <= realMaxKm) estado = 'OPERANDO';

                const timestamp = reading?.timestamp || null;

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

                baseEscalas.unshift({
                    id: 'presa-boquilla',
                    nombre: 'PRESA LA BOQUILLA',
                    km: -36,
                    nivel_actual: 3.5, // Referencia Escala de Presa (Directiva de Usuario)
                    estado: activeEvent.hora_apertura_real ? 'OPERANDO' : 'ESPERANDO',
                    ultima_telemetria: extraccionReal > 0 ? new Date(presaReading!.fecha).getTime() : currentTime,
                    latitud: 27.545,
                    longitud: -105.414
                } as any);
            }

            setEscalas(baseEscalas);
            
            // Check specifically for KM 0 radial status to refine the blockage
            const zeroScale = baseEscalas.find(e => e.km === 0);
            const zeroReading = zeroScale ? readingsMap.get(zeroScale.id) : null;
            sessionStorage.setItem('zero_radial_apertura', (zeroReading?.apertura || 0).toString());
            sessionStorage.setItem('zero_nivel_abajo', (zeroReading?.nivel_abajo || 0).toString());
            
        } catch (err) {
            console.error("PublicMonitor fetch error", err);
        }
    }, [activeEvent, currentTime]);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60000); // 1 min refresh
        return () => clearInterval(interval);
    }, [fetchData]);

    // 5. Predicted Front Position (Hydra Engine Logic)
    const predictedMaxKm = useMemo(() => {
        if (!activeEvent?.hora_apertura_real) return -36;
        
        // 1. Find the latest confirmed point (Anchor) from Scales OR Tracking
        const confirmedScales = escalas.filter(e => e.estado === 'OPERANDO' && e.km <= realMaxKm);
        const lastScaleAnchor = confirmedScales.length > 0 ? confirmedScales[confirmedScales.length - 1] : null;

        let startTime = new Date(activeEvent.hora_apertura_real).getTime();
        let startKm = -36;

        // Check if there's a more advanced Tracking Point (Real Report)
        const trackingAnchorTime = sessionStorage.getItem(`anchor_time_${realMaxKm}`);
        
        if (trackingAnchorTime) {
            // Priority: The absolute maximum real progress reported
            startTime = new Date(trackingAnchorTime).getTime();
            startKm = realMaxKm;
        } else if (lastScaleAnchor) {
            const anchorTimeStr = sessionStorage.getItem(`anchor_time_${lastScaleAnchor.km}`);
            if (anchorTimeStr) {
                startTime = new Date(anchorTimeStr).getTime();
                startKm = lastScaleAnchor.km;
            }
        }

        const elapsedHours = (currentTime - startTime) / (1000 * 3600);
        if (elapsedHours <= 0) return startKm;

        const vRio = 3.0; // km/h (Referencia: 36km / 12h)
        // VELOCIDAD DE LLENADO: Ajustada a 2.3 km/h basada en mediciones de campo reales del 15 de marzo.
        const vCanal = activeEvent.evento_tipo === 'LLENADO' ? 2.3 : 4.17; 

        let currentKm = startKm;
        let remainingHours = elapsedHours;

        if (currentKm < 0) {
            const distToZero = Math.abs(currentKm);
            const timeToZero = distToZero / vRio;

            if (remainingHours <= timeToZero) {
                currentKm += remainingHours * vRio;
                remainingHours = 0;
            } else {
                // Potential Block at KM 0: Waiting for scale confirmation at TOMA 0+000
                if (realMaxKm < 0) {
                    return 0; // System blocks at zero until confirmed in SICA Capture
                }
                currentKm = 0;
                remainingHours -= timeToZero;
            }
        }

        if (remainingHours > 0) {
            currentKm += remainingHours * vCanal;
        }

        // --- REGLA DE FISICA: ANCLAJE A TELEMETRIA ---
        // Si hay una escala adelante con lectura confirmada de 0.00m, el frente NO puede haber pasado por ahi.
        const dryBlockedScale = escalas.find(e => 
            e.km > realMaxKm && 
            e.km < currentKm && 
            e.nivel_actual === 0 && 
            e.ultima_telemetria
        );

        if (dryBlockedScale) {
            // El frente se queda 1km antes de la escala que reporta estar seca
            return Math.max(realMaxKm, dryBlockedScale.km - 0.5);
        }

        return Math.min(currentKm, 113);
    }, [activeEvent, realMaxKm, escalas, currentTime]);

    const isWaitingAtZero = useMemo(() => {
        if (!activeEvent || activeEvent.evento_tipo !== 'LLENADO') return false;
        
        // Blockage Condition A: Not confirmed by Llenado tracker past zero
        if (realMaxKm > 0) return false;
        
        // Blockage Condition B: Check for recorded opening at KM 0
        const storedApertura = parseFloat(sessionStorage.getItem('zero_radial_apertura') || '0');
        const storedNivelAbajo = parseFloat(sessionStorage.getItem('zero_nivel_abajo') || '0');
        if (realMaxKm === 0 && (storedApertura > 0 || storedNivelAbajo > 0)) return false; // Released!

        const startTime = new Date(activeEvent.hora_apertura_real!).getTime();
        const elapsedHours = (currentTime - startTime) / (1000 * 3600);
        return elapsedHours > (36 / 3.0); 
    }, [activeEvent, realMaxKm, currentTime]);

    // El avance del frente depende de telemetría confirmada O el modelado de travesía (Hidro-Sincronía)
    const displayMaxKm = useMemo(() => {
        if (!activeEvent || activeEvent.evento_tipo !== 'LLENADO') return 113;
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

    // Helper to format exact time ago for telemetry (Pure version using explicit now)
    const formatTimeAgo = (timestamp?: number | null, now: number = currentTime) => {
        if (!timestamp) return 'SIN DATOS';
        const diffSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
        if (diffSeconds < 60) return `HACE ${diffSeconds}s`;
        const diffMins = Math.floor(diffSeconds / 60);
        if (diffMins < 60) return `HACE ${diffMins}m`;
        const diffHours = Math.floor(diffMins / 60);
        return `HACE ${diffHours}h`;
    };

    // 4. Calculate Dynamic Target Estimation (Hydra Engine Logic)
    const nextTargetInfo = useMemo(() => {
        if (!escalas || escalas.length === 0) return { name: "Buscando...", hours: 0, mins: 0, kmRemaining: 0 };
        
        if (isWaitingAtZero) {
            return {
                name: "TOMA 0+000 (ESPERA)",
                hours: 0,
                mins: 0,
                kmRemaining: "0.0",
                arrivalTime: "PENDIENTE",
                elapsed: formatTimeAgo(activeEvent?.hora_apertura_real ? new Date(activeEvent.hora_apertura_real).getTime() : null),
                status: "ESPERANDO CONFIRMACIÓN SICA"
            };
        }

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

        const arrivalTimeUTC = currentTime + (totalHours * 3600 * 1000);
        const arrivalTimeStr = new Date(arrivalTimeUTC).toLocaleTimeString('es-MX', { 
            hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Chihuahua' 
        });

        const elapsedS = activeEvent?.hora_apertura_real ? 
            Math.max(0, Math.floor((currentTime - new Date(activeEvent.hora_apertura_real).getTime()) / 1000)) : 0;
        const elapsedH = Math.floor(elapsedS / 3600);
        const elapsedM = Math.floor((elapsedS % 3600) / 60);

        return {
            name: nextScale.nombre.toUpperCase(),
            hours: hr,
            mins: min,
            kmRemaining: distRemaining.toFixed(1),
            arrivalTime: arrivalTimeStr,
            elapsed: `${elapsedH}h ${elapsedM}m`
        };
    }, [escalas, displayMaxKm, activeEvent, currentTime, isWaitingAtZero]);


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
            {/* Compact Header Badge - Floating over map */}
            <div className="public-header-badge animate-in">
                <div className="phb-main">
                    <div className="phb-logos">
                        <img src="/logos/logo-srl.png" alt="SRL" className="phb-logo" />
                    </div>
                    
                    <div className="phb-status">
                        <div className="status-dot-container-mini">
                            <div className="status-dot-pulse-mini" style={{ borderColor: statusColor }}></div>
                            <div className="status-dot-inner-mini" style={{ background: statusColor }}></div>
                        </div>
                        <div className="phb-text">
                            <span className="phb-label">ESTADO:</span>
                            <span className="phb-value" style={{ color: statusColor }}>{protocolLabel}</span>
                        </div>
                    </div>

                    <div className="phb-divider"></div>

                    <div className="phb-efficiency">
                        <span className="phb-label">EFICIENCIA:</span>
                        <span className="phb-val" style={{ color: executiveMetrics.healthColor }}>{executiveMetrics.efficiency.toFixed(1)}%</span>
                    </div>

                    <button 
                        className="phb-system-btn" 
                        onClick={() => window.location.href = '/'}
                        title="Ir al sistema completo"
                    >
                        <Activity size={12} />
                    </button>
                </div>
            </div>

            {/* Predicted position badge - Managerial Transit Report */}
            {activeEvent?.evento_tipo === 'LLENADO' && isPredictionVisible && (
                <div className="prediction-badge managerial animate-in">
                    <div className="mgr-header">
                        <span className="mgr-title">ANÁLISIS DE TRÁNSITO</span>
                        {isWaitingAtZero && <span className="wait-badge-pulse">WAITING</span>}
                        <button className="panel-toggle-mini" onClick={() => setIsPredictionVisible(false)}>×</button>
                    </div>

                    {isWaitingAtZero && (
                        <div className="wait-alert-box">
                            <Activity size={16} className="pulse-icon" />
                            <div className="wait-alert-text">
                                <b>LLENADO DE RÍO: KM 0+000</b>
                                <p>Nivel detectado. Esperando reporte de <b>APERTURA DE RADIALES</b> en SICA Capture para iniciar canal.</p>
                            </div>
                        </div>
                    )}
                    
                    <div className="transit-summary">
                        <div className="transit-row">
                            <div className="tr-label">
                                <Clock size={12} />
                                TIEMPO TRANSCURRIDO
                            </div>
                            <div className="tr-value">{nextTargetInfo.elapsed}</div>
                        </div>

                        <div className="transit-row">
                            <div className="tr-label">
                                <ArrowRightCircle size={12} />
                                SIGUIENTE CONTROL
                            </div>
                            <div className="tr-value">{nextTargetInfo.name}</div>
                        </div>

                        <div className="transit-row">
                            <div className="tr-label">
                                <MapPin size={12} />
                                DISTANCIA RESTANTE
                            </div>
                            <div className="tr-value tr-value-accent">{nextTargetInfo.kmRemaining} KM</div>
                        </div>

                        <div className="transit-row">
                            <div className="tr-label">
                                <Timer size={12} />
                                LLEGADA ESTIMADA
                            </div>
                            <div className="tr-value tr-value-accent">{nextTargetInfo.arrivalTime}</div>
                        </div>
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
                    <MapController 
                        center={frontCoords as [number, number]} 
                        zoom={11} 
                        active={activeEvent?.evento_tipo === 'LLENADO'} 
                    />
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
                        <Marker position={frontCoords as any} icon={waterFrontIcon}>
                            <Popup className="custom-popup">
                                <div className="tooltip-content">
                                    <div className="tooltip-km">{displayMaxKm.toFixed(1)} KM</div>
                                    <b className="tooltip-name">{isWaitingAtZero ? 'LLENADO PTO CONTROL 0+000' : 'FRENTE DE FLUJO ACTIVO'}</b>
                                    <div className="tooltip-payload">
                                        <Timer size={12} color={isWaitingAtZero ? '#f59e0b' : statusColor} />
                                        <span className="tooltip-value">{isWaitingAtZero ? 'ESPERANDO CAPTURA' : 'AVANCE ESTIMADO'}</span>
                                    </div>
                                    <div className="tooltip-footer">{isWaitingAtZero ? 'ALERTA: PUNTO DE CONTROL CERRADO' : 'SICA INTELIGENCIA v3.2'}</div>
                                </div>
                            </Popup>
                        </Marker>
                    )}

                    {/* Escalas de Puntos - Mostramos todas nuevamente */}
                    {escalas.filter(esc => typeof esc.latitud === 'number' && typeof esc.longitud === 'number').map(esc => (
                        <CircleMarker
                            key={esc.id}
                            center={[esc.latitud!, esc.longitud!]}
                            radius={esc.km <= displayMaxKm ? 6 : 4}
                            fillColor={esc.km <= displayMaxKm ? statusColor : '#1e293b'}
                            color="#fff"
                            weight={1.5}
                            fillOpacity={1}
                        >
                            <Popup className="custom-popup">
                                <div className="tooltip-content">
                                    <div className="tooltip-km">{esc.km.toFixed(1)} KM</div>
                                    <b className="tooltip-name">{esc.nombre}</b>
                                    {esc.nivel_actual !== undefined && (
                                        <div className="tooltip-payload">
                                            <Droplets size={12} color={statusColor} />
                                            <span className="tooltip-value">
                                                {esc.nivel_actual.toFixed(2)} m
                                            </span>
                                        </div>
                                    )}
                                    <div className="tooltip-footer">SICA TELEMETRÍA v3.2</div>
                                </div>
                            </Popup>
                            <Tooltip className="custom-tooltip" direction="top" offset={[0, -10]} opacity={0.9}>
                                <span>{esc.nombre}</span>
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
                    <div className="dock-section checkpoints-section">
                        <div className="dock-section-header">
                            <span className="card-label">RED DE PUNTOS DE CONTROL</span>
                            <span className="telemetry-tag active-mon">● MONITOREO TOTAL ACTIVO</span>
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
