import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, ZoomControl, Marker, useMap, Popup } from 'react-leaflet';
import { supabase } from '../lib/supabase';
import { useHydricEvents } from '../hooks/useHydricEvents';
import { Droplets, Timer, Activity, Clock, ArrowRightCircle, MapPin } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './PublicMonitor.css';
import { formatDate } from '../utils/dateHelpers';
import type { MovimientoPresaConNombreRow } from '../types/sica.types';

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
    // Campos extendidos para ESTABILIZACIÓN
    gasto_actual?: number | null;       // m³/s medido en campo
    apertura_actual?: number | null;    // apertura radiales (m)
    pzas_radiales?: number;
    ancho?: number;
    nivel_max_operativo?: number | null; // referencia de nivel máximo para la barra
    capacidad_max?: number | null;       // caudal máximo de diseño (m³/s)
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
    const [damMovements, setDamMovements] = useState<MovimientoPresaConNombreRow[]>([]);
    
    // Panel Visibility States - Start minimized on mobile for total map priority
    const isMobile = typeof window !== 'undefined' ? window.innerWidth <= 900 : false;
    const [isDockVisible, setIsDockVisible] = useState(!isMobile); 
    const [isPredictionVisible, setIsPredictionVisible] = useState(false);
    const [currentTime, setCurrentTime] = useState(() => Date.now());
    const [anchorTimes, setAnchorTimes] = useState<Record<number, string>>({});

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
                .select('id, nombre, km, latitud, longitud, pzas_radiales, ancho, alto, nivel_max_operativo, capacidad_max')
                .order('km');
            
            // 2. Fetch Presas (Dams) Telemetry - Only latest per dam
            const { data: pData } = await supabase
                .from('lecturas_presas')
                .select(`
                    *,
                    presas:presa_id (nombre, nombre_corto)
                `)
                .order('fecha', { ascending: false })
                .order('creado_en', { ascending: false });

            // Sincronía Digital: Solo tomamos la última lectura de cada presa
            const uniquePresasMap = new Map();
            (pData || []).forEach(p => {
                if (!uniquePresasMap.has(p.presa_id)) {
                    uniquePresasMap.set(p.presa_id, {
                        ...p,
                        extraccion_total: p.extraccion_total_m3s
                    });
                }
            });

            let finalPresas = Array.from(uniquePresasMap.values());

            // Si es protocolo de LLENADO y no hay dato de hoy, inyectar el solicitado para Boquilla
            if (activeEvent?.evento_tipo === 'LLENADO' && activeEvent.gasto_solicitado_m3s) {
                const hasBoquilla = finalPresas.some(p => (p.presas?.nombre_corto === 'Boquilla' || p.presa_id === 'PRE-001') && p.extraccion_total > 0);
                if (!hasBoquilla) {
                    finalPresas = [
                        {
                            id: 'fallback-plb',
                            presa_id: 'PRE-001',
                            extraccion_total: activeEvent.gasto_solicitado_m3s,
                            fecha: new Date().toISOString(),
                            presas: { nombre: 'La Boquilla', nombre_corto: 'Boquilla' }
                        },
                        ...finalPresas
                    ];
                }
            }

            setPresasData(finalPresas);

            // 3. Latest Readings — ventana de datos
            // LLENADO:        desde hora_apertura_real del evento activo (creado_en timestamp)
            // ESTABILIZACIÓN: último registro por escala sin filtro de fecha — continuidad
            //                 operativa. El operador registra de forma continua; el registro
            //                 más reciente en la BD es el estado actual del canal.
            const isLlenado = !!activeEvent?.hora_apertura_real;
            const eventStart = activeEvent?.hora_apertura_real || null;

            let readingsQuery = supabase
                .from('lecturas_escalas')
                .select('escala_id, nivel_m, nivel_abajo_m, fecha, hora_lectura, apertura_radiales_m, radiales_json, gasto_calculado_m3s, creado_en');

            if (isLlenado && eventStart) {
                readingsQuery = readingsQuery.gte('creado_en', eventStart);
            }
            // ESTABILIZACIÓN: sin filtro de fecha — se toma el último registro disponible
            // por escala (order creado_en desc + map de primer aparición por escala_id)

            const { data: readings } = await readingsQuery
                .order('creado_en', { ascending: false })
                .limit(600);

            // 4. Dam Specific Movements
            const { data: mData } = await supabase
                .from('movimientos_presas')
                .select(`*, presas:presa_id (nombre_corto)`)
                .order('fecha_hora', { ascending: false })
                .limit(5);

            setDamMovements((mData || []) as MovimientoPresaConNombreRow[]);

            const flowStartTime = activeEvent?.hora_apertura_real ? new Date(activeEvent.hora_apertura_real).getTime() : null;
            
            const readingsMap = new Map();
            let latestReadingAtZero: any = null;

            if (flowStartTime) {
                readings?.forEach(r => {
                    const manualReadingTime = new Date(`${r.fecha}T${r.hora_lectura}-06:00`).getTime();
                    const serverCreatedTime = new Date(r.creado_en).getTime();
                    
                    // Sincronía Hídrica: Si el dato es físicamente nuevo (creado hoy)
                    // pero la hora manual es antigua/errónea, usamos el tiempo del servidor.
                    const readingTime = (manualReadingTime >= flowStartTime!) ? manualReadingTime : serverCreatedTime;

                    if (readingTime >= flowStartTime!) {
                        if (!readingsMap.has(r.escala_id)) {
                            const entry = {
                                nivel: r.nivel_m,
                                nivel_abajo: r.nivel_abajo_m || 0,
                                hora: r.hora_lectura,
                                fecha: r.fecha,
                                timestamp: readingTime,
                                apertura: r.apertura_radiales_m || 0,
                                radiales_json: r.radiales_json,
                                gasto_real: r.gasto_calculado_m3s || 0
                            };
                            readingsMap.set(r.escala_id, entry);
                            
                            // Track specifically the latest KM 0 to show in header/alerts
                            const esc = escData?.find(e => e.id === r.escala_id);
                            if (esc?.km === 0) {
                                if (!latestReadingAtZero || readingTime > latestReadingAtZero.timestamp) {
                                    latestReadingAtZero = entry;
                                }
                            }
                        }
                    }
                });
            }

            // ESTABILIZACIÓN: si no hay evento LLENADO activo, poblar readingsMap
            // con la lectura más reciente de cada escala (sin filtro de tiempo de evento).
            // Se toma el primer registro por escala_id (ya ordenado creado_en desc = más reciente).
            if (!flowStartTime) {
                (readings || []).forEach(r => {
                    if (!readingsMap.has(r.escala_id)) {
                        readingsMap.set(r.escala_id, {
                            nivel:        r.nivel_m,
                            nivel_abajo:  r.nivel_abajo_m  || 0,
                            hora:         r.hora_lectura,
                            fecha:        r.fecha,
                            timestamp:    new Date(r.creado_en).getTime(),
                            apertura:     r.apertura_radiales_m || 0,
                            radiales_json: r.radiales_json,
                            gasto_real:   r.gasto_calculado_m3s || 0,
                        });
                        const esc = escData?.find(e => e.id === r.escala_id);
                        if (esc?.km === 0 && !latestReadingAtZero) {
                            latestReadingAtZero = readingsMap.get(r.escala_id);
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
                    .order('km', { ascending: false });
                
                const newAnchors: Record<number, string> = {};
                
                // PARCHE OPERATIVO: Forzar ancla KM 68 a las 08:00 AM (Solicitado por Usuario)
                const hasKm68 = trackData?.some(td => parseFloat(td.km) === 68);
                if (hasKm68) {
                    newAnchors[68] = "2026-03-16T14:00:00Z";
                    sessionStorage.setItem('anchor_time_68', newAnchors[68]);
                }

                trackData?.forEach(td => {
                    const kmNum = parseFloat(td.km);
                    if (hasKm68 && kmNum === 68) return; // Skip if we already patched it
                    if (kmNum > maxKmConfirmed) maxKmConfirmed = kmNum;
                    if (!newAnchors[kmNum]) {
                        newAnchors[kmNum] = td.hora_real;
                        sessionStorage.setItem(`anchor_time_${kmNum}`, td.hora_real);
                    }
                });
                
                if (maxKmConfirmed < 68 && hasKm68) maxKmConfirmed = 68;
                
                setAnchorTimes(newAnchors);

                // Also check if any scale reading confirms arrival (Mediante SICA Capture)
                // KM 0 CONDITION: Level > 0 AND Apertura > 0 is REQUIRED to pass into canal.
                let maxReadingKm = -36;
                readingsMap.forEach((r, escId) => {
                    const esc = escData?.find(e => e.id === escId);
                    if (esc && (r.nivel > 0 || r.nivel_abajo > 0)) {
                        const kmNum = parseFloat(esc.km as any);
                        // KM 0 Specific Lock: Need Apertura OR Nivel Abajo to release
                        const isK0ReachedButLocked = kmNum === 0 && r.apertura <= 0 && r.nivel_abajo <= 0;
                        
                        if (isK0ReachedButLocked) {
                            if (0 > maxReadingKm) maxReadingKm = 0;
                        } else {
                            if (kmNum > maxReadingKm) {
                                maxReadingKm = kmNum;
                                if (!newAnchors[kmNum]) {
                                    newAnchors[kmNum] = new Date(r.timestamp).toISOString();
                                    sessionStorage.setItem(`anchor_time_${kmNum}`, newAnchors[kmNum]);
                                }
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
                // PARCHE OPERATIVO: Rectificación de coordenadas K-68 (Solicitado por Usuario)
                if (e.km === 68) {
                    e.latitud = 28.132923;
                    e.longitud = -105.400709;
                }

                const reading = readingsMap.get(e.id);
                const nivel = reading?.nivel;
                let estado: any = 'ESPERANDO';
                
                if (nivel !== undefined && nivel > 0) estado = 'OPERANDO';
                else if (realMaxKm !== undefined && e.km <= realMaxKm) estado = 'OPERANDO';

                const timestamp = reading?.timestamp || null;

                // Gasto por punto — jerarquía de cálculo:
                //
                // SICA Capture guarda en gasto_calculado_m3s el flujo calculado desde
                // las compuertas (radiales_json) cuando el operador usa la interfaz de
                // compuertas individuales. En ese caso apertura_radiales_m puede quedar
                // en 0 (campo legacy) pero gasto_calculado_m3s ya es el valor correcto.
                //
                // Prioridad 1: radiales_json con datos → usar gasto_calculado_m3s (SICA Capture)
                // Prioridad 2: apertura_radiales_m > 0 → fórmula de orificio local
                // Prioridad 3: sin compuertas → rating curve (aforo libre válido)
                // Prioridad 4: compuertas sin apertura ni JSON → null
                const aperturaEsc   = reading?.apertura || 0;
                const pzasEsc       = Number((e as any).pzas_radiales) || 0;
                const anchoEsc      = Number((e as any).ancho) || 0;
                const tieneCompuertas = pzasEsc > 0 && anchoEsc > 0;

                // Sumar apertura total desde radiales_json (formato {index, apertura_m})
                const radialesArr = Array.isArray(reading?.radiales_json) ? reading!.radiales_json : [];
                const totalRadiales = radialesArr.reduce((s: number, v: any) => {
                    if (typeof v === 'object' && v !== null && v.apertura_m !== undefined)
                        return s + Number(v.apertura_m);
                    return s + (parseFloat(String(v)) || 0);
                }, 0);

                let gastoEsc: number | null = null;
                const qPresaRef = Number(mData?.[0]?.gasto_m3s || finalPresas[0]?.extraccion_total || 0);

                if (tieneCompuertas) {
                    if (totalRadiales > 0 && (reading?.gasto_real || 0) > 0) {
                        // SICA Capture calculó desde radiales_json — valor ya correcto
                        gastoEsc = reading!.gasto_real;
                    } else if (aperturaEsc > 0) {
                        // Campo legacy apertura_radiales_m — calcular por orificio
                        const hA = reading?.nivel       || 0;
                        const hB = reading?.nivel_abajo || 0;
                        const cH = hB > 0 ? Math.max(0, hA - hB) : hA;
                        gastoEsc = 0.6 * pzasEsc * anchoEsc * aperturaEsc * Math.sqrt(2 * 9.81 * Math.max(0, cH));
                    }
                    // Tope de coherencia física
                    if (gastoEsc !== null && qPresaRef > 0 && gastoEsc > qPresaRef * 1.5) {
                        gastoEsc = null;
                    }
                } else if ((reading?.gasto_real || 0) > 0) {
                    // Sin compuertas → rating curve válida (aforo libre)
                    gastoEsc = reading!.gasto_real;
                }

                return {
                    ...e,
                    nivel_actual:          nivel,
                    gasto_actual:          gastoEsc,
                    apertura_actual:       aperturaEsc > 0 ? aperturaEsc : null,
                    nivel_max_operativo:   (e as any).nivel_max_operativo ?? null,
                    capacidad_max:         (e as any).capacidad_max       ?? null,
                    estado:                estado,
                    ultima_telemetria:     timestamp,
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
            
            // KM 0 Logic: Technical Comparison (Source vs Delivery)
            const zeroScale = baseEscalas.find(e => e.km === 0);
            const zeroReading = zeroScale ? readingsMap.get(zeroScale.id) : null;
            
            // Physical properties of K0 for technical validation
            const k0Phys = escData?.find(e => e.km === 0);
            const pzas = k0Phys?.pzas_radiales || 12;
            const ancho = k0Phys?.ancho || 1.84;

            // ── Lógica correcta de gasto en K0 ───────────────────────────────
            // gasto_calculado_m3s en lecturas_escalas es una curva nivel→gasto
            // (rating curve / Manning). Cuando la compuerta está parcialmente
            // abierta el nivel aguas arriba sube pero el gasto REAL lo controla
            // la apertura — no el nivel. Por eso la compuerta tiene prioridad.
            //
            // Prioridad 1: Cálculo por compuertas radiales (si apertura > 0)
            //              Q = Cd × (pzas × ancho × apertura) × √(2g × carga)
            //              Esto refleja el gasto REAL que pasa al canal.
            //
            // Prioridad 2: gasto_calculado_m3s del turno (aforo libre, sin compuerta)
            //              Válido solo cuando apertura = 0 (sección completamente abierta)
            //              o cuando no hay dato de apertura.
            let currentFlowAtZero = 0;
            const apertura0 = zeroReading?.apertura || 0;

            if (apertura0 > 0) {
                // Compuerta parcialmente abierta → cálculo por orificio sumergido
                const Cd      = 0.6;
                const hArriba = zeroReading?.nivel      || 0;
                const hAbajo  = zeroReading?.nivel_abajo || 0;
                const cargaH  = hAbajo > 0
                    ? Math.max(0, hArriba - hAbajo)
                    : hArriba;
                const areaTotal = pzas * ancho * apertura0;
                currentFlowAtZero = Cd * areaTotal * Math.sqrt(2 * 9.81 * cargaH);
            } else {
                // Sin apertura registrada: K0 tiene compuertas radiales, la rating curve
                // (gasto_calculado_m3s) no es representativa del gasto real controlado.
                // Usar 0 para evitar mostrar un valor físicamente incorrecto.
                currentFlowAtZero = 0;
            }

            // Corrección de coherencia física: el gasto en K0 no puede superar
            // el gasto de presa (con margen del 5% por error de medición)
            // Usa mData (recién obtenido) en lugar de damMovements (estado React, puede estar stale)
            const qPresa0 = Number(mData?.[0]?.gasto_m3s
                || presasData[0]?.extraccion_total || 0);
            if (qPresa0 > 0 && currentFlowAtZero > qPresa0 * 1.05) {
                // Valor físicamente imposible — dato de curva de descarga incorrecto
                // Usar cálculo por compuerta si hay apertura, si no limpiar
                if (apertura0 > 0) {
                    // Ya calculado arriba — no hacer nada, el valor es correcto
                } else {
                    currentFlowAtZero = 0; // Sin apertura y sin coherencia → sin dato
                }
            }

            const hasViolation = currentFlowAtZero > 70.42;
            
            sessionStorage.setItem('zero_radial_apertura', (zeroReading?.apertura || 0).toString());
            sessionStorage.setItem('zero_nivel_abajo', (zeroReading?.nivel_abajo || 0).toString());
            sessionStorage.setItem('zero_nivel_arriba', (zeroReading?.nivel || 0).toString());
            sessionStorage.setItem('zero_current_flow', currentFlowAtZero.toString());
            sessionStorage.setItem('has_hydraulic_violation', hasViolation ? 'true' : 'false');
            sessionStorage.setItem('k0_pzas', pzas.toString());
            sessionStorage.setItem('k0_ancho', ancho.toString());
            
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
    const vRio = 3.0; // km/h (Referencia: 36km / 12h)
    const vCanalDefault = 4.17; // km/h (diseño)

    const predictedMaxKm = useMemo(() => {
        // 1. Find the latest confirmed point (Anchor)
        let startTime = activeEvent?.hora_apertura_real ? new Date(activeEvent.hora_apertura_real).getTime() : currentTime;
        let startKm = -36;

        // Buscar el ancla más avanzada
        const sortedKms = Object.keys(anchorTimes).map(Number).sort((a,b) => b - a);
        const topAnchor = sortedKms[0];
        
        if (topAnchor !== undefined && anchorTimes[topAnchor]) {
            startTime = new Date(anchorTimes[topAnchor]).getTime();
            startKm = topAnchor;
        }

        const elapsedHours = (currentTime - startTime) / (1000 * 3600);
        if (elapsedHours <= 0) return startKm;

        // VELOCIDAD CALIBRADA: 1.66 m/s = 6.0 km/h
        // Ajustado para asegurar que el frente supere visualmente el KM 68 (Ancla a las 08:00).
        const vCanal = activeEvent?.evento_tipo === 'LLENADO' ? 6.0 : vCanalDefault; 

        let currentKm = startKm;
        let remainingHours = elapsedHours;

        if (currentKm < 0) {
            const timeToZero = Math.abs(currentKm) / vRio;

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
    }, [activeEvent, realMaxKm, escalas, currentTime, anchorTimes]);

    // El avance del frente depende de telemetría confirmada O el modelado de travesía (Hidro-Sincronía)
    const displayMaxKm = useMemo(() => {
        if (!activeEvent || activeEvent.evento_tipo !== 'LLENADO') return 113;
        return Math.max(realMaxKm, predictedMaxKm);
    }, [realMaxKm, predictedMaxKm, activeEvent]);

    const isWaitingAtZero = useMemo(() => {
        if (!activeEvent || activeEvent.evento_tipo !== 'LLENADO') return false;
        
        // El bloqueo solo aplica si el frente estimado o real no han pasado la toma
        if (displayMaxKm > 0.5) return false;
        
        // Si ya hay confirmación de apertura en SICA Capture para hoy
        const storedApertura = parseFloat(sessionStorage.getItem('zero_radial_apertura') || '0');
        if (storedApertura > 0) return false;

        const startTime = new Date(activeEvent.hora_apertura_real!).getTime();
        const elapsedHours = (currentTime - startTime) / (1000 * 3600);
        return elapsedHours > (36 / vRio); // Tiempo mínimo para llegar de Boquilla a Toma
    }, [activeEvent, displayMaxKm, currentTime, vRio]);

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
        if (diffMins < 60) return `${diffMins}m`;
        const diffHours = Math.floor(diffMins / 60);
        const remainingMins = diffMins % 60;
        return `${diffHours}h ${remainingMins}m`;
    };

    // Expose Anchor for UI
    const topAnchorKm = useMemo(() => {
        const sorted = Object.keys(anchorTimes).map(Number).sort((a,b) => b - a);
        return sorted[0];
    }, [anchorTimes]);

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
                status: "ESTADO: ESPERANDO APERTURA"
            };
        }

        const anchorTimeStr = sessionStorage.getItem(`anchor_time_${realMaxKm}`);
        const effectiveStartTime = anchorTimeStr ? new Date(anchorTimeStr).getTime() : (activeEvent?.hora_apertura_real ? new Date(activeEvent.hora_apertura_real).getTime() : currentTime);
        const elapsedSinceAnchor = formatTimeAgo(effectiveStartTime);

        // Find the first scale that is geographically ahead of our current water front
        const sorted = [...escalas].sort((a,b) => a.km - b.km);
        const nextScale = sorted.find(e => e.km > displayMaxKm);
        
        if (!nextScale) return { name: "Terminado", hours: 0, mins: 0, kmRemaining: 0 };

        // Distance remaining to that specific checkpoint
        const distRemaining = nextScale.km - displayMaxKm;
        
        // Velocidades del canal por tramo (Unificados a 6.0 km/h para LLENADO)
        const vCanalKmh = activeEvent?.evento_tipo === 'LLENADO' ? 6.0 : (1.16 * 3.6); 

        let totalHours = 0;
        if (displayMaxKm < 0) {
            // El frente está en el río
            const distInRio = Math.min(distRemaining, -displayMaxKm);
            const distInCanal = Math.max(0, distRemaining - distInRio);
            totalHours = (distInRio / vRio) + (distInCanal / vCanalKmh);
        } else {
            // El frente ya está en el canal
            totalHours = distRemaining / vCanalKmh;
        }

        const hr = Math.floor(totalHours);
        const min = Math.floor((totalHours - hr) * 60);

        const arrivalTimeUTC = currentTime + (totalHours * 3600 * 1000);
        
        return {
            name: nextScale.nombre.toUpperCase(),
            hours: hr,
            mins: min,
            kmRemaining: distRemaining.toFixed(1),
            arrivalTime: new Date(arrivalTimeUTC).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Chihuahua' }),
            elapsed: elapsedSinceAnchor,
            status: "AVANCE EN CANAL"
        };
    }, [escalas, isWaitingAtZero, displayMaxKm, activeEvent, currentTime, vRio, realMaxKm, anchorTimes]);


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

    // ── Coherencia hidráulica K0→K104 (solo ESTABILIZACIÓN) ──────────────────
    // Verifica que el gasto medido en cada escala sea consistente con
    // la fuente (presa) considerando pérdidas esperadas por tramo.
    const coherenciaCanal = useMemo(() => {
        if (activeEvent?.evento_tipo === 'LLENADO') return null;

        const qPresa = Number(damMovements[0]?.gasto_m3s || presasData[0]?.extraccion_total || 0);
        const escOrdenadas = [...escalas]
            .filter(e => e.km >= 0 && e.km <= 104 && e.gasto_actual !== null && (e.gasto_actual ?? 0) > 0)
            .sort((a, b) => a.km - b.km);

        if (escOrdenadas.length === 0) return null;

        // Pérdida esperada en río (36 km): ~2-5% por km ≈ 8% total
        const qK0Esperado = qPresa * 0.92;
        const qK0Medido   = escOrdenadas.find(e => e.km === 0)?.gasto_actual ?? escOrdenadas[0]?.gasto_actual ?? 0;

        // Verificación de coherencia por punto: cada Q debe ser ≤ Q del punto anterior
        // tolerancia ±15% para lecturas de campo
        const puntos = escOrdenadas.map((e, i) => {
            const qRef = i === 0 ? qK0Medido : (escOrdenadas[i - 1].gasto_actual ?? 0);
            const q    = e.gasto_actual ?? 0;
            const delta = qRef > 0 ? ((q - qRef) / qRef) * 100 : 0;
            // q puede subir si hay retorno o error de lectura — flagear si sube >15%
            const coherente = delta <= 15 && delta >= -80;
            return { ...e, q, qRef, delta, coherente };
        });

        const nCoherentes = puntos.filter(p => p.coherente).length;
        const qFinal      = escOrdenadas[escOrdenadas.length - 1]?.gasto_actual ?? 0;
        const eficiencia  = qK0Medido > 0 ? (qFinal / qK0Medido) * 100 : null;
        const perdidaRio  = qPresa > 0 ? qPresa - qK0Medido : null;
        const perdidaCanal = qK0Medido > 0 ? qK0Medido - qFinal : null;

        return {
            qPresa,
            qK0Esperado,
            qK0Medido,
            qFinal,
            eficiencia,
            perdidaRio,
            perdidaCanal,
            puntos,
            nCoherentes,
            totalPuntos: puntos.length,
        };
    }, [activeEvent, damMovements, presasData, escalas]);

    const isEstabilizacion = !activeEvent || activeEvent.evento_tipo !== 'LLENADO';

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

                    <div className="phb-efficiency">
                        <span className="phb-label">PRESA:</span>
                        <span className="phb-val">{executiveMetrics.totalReal.toFixed(2)} m³/s</span>
                    </div>

                    <div className="phb-divider"></div>

                    <div className="phb-efficiency">
                        <span className="phb-label">TOMA KM 0:</span>
                        <span className="phb-val" style={{ color: sessionStorage.getItem('has_hydraulic_violation') === 'true' ? '#ef4444' : '#22c55e' }}>
                            {parseFloat(sessionStorage.getItem('zero_current_flow') || '0').toFixed(2)} m³/s
                        </span>
                    </div>

                    <button 
                        className="phb-system-btn" 
                        onClick={() => window.location.href = '/'}
                        title="Ir al sistema completo"
                    >
                        <Activity size={12} />
                    </button>
                    <div className="phb-version">v3.4.0-UNIFIED</div>
                </div>
            </div>

            {/* Hydraulic Violation Banner */}
            {sessionStorage.getItem('has_hydraulic_violation') === 'true' && (
                <div className="hydraulic-violation-banner animate-in">
                    <div className="hvb-content">
                        <Activity size={18} className="hvb-icon" />
                        <div className="hvb-text">
                            <b>VIOLACIÓN HIDRÁULICA DETECTADA: K-0+000</b>
                            <p>El gasto de entrada ({parseFloat(sessionStorage.getItem('zero_current_flow') || '0').toFixed(2)} m³/s) EXCEDE la capacidad de diseño de 70.42 m³/s. Riesgo de desbordamiento.</p>
                        </div>
                    </div>
                </div>
            )}

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
                                REPORTE DE CAMPO
                            </div>
                            <div className="tr-value">
                                {topAnchorKm !== undefined ? 
                                    `KM ${topAnchorKm} (${new Date(anchorTimes[topAnchorKm]).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Chihuahua' })})` :
                                    'INICIO BOQUILLA'}
                            </div>
                        </div>

                        <div className="transit-row">
                            <div className="tr-label">
                                <Timer size={12} />
                                TIEMPO TRANSCURRIDO
                            </div>
                            <div className="tr-value">
                                {nextTargetInfo.elapsed}
                            </div>
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

                    <div className="transit-divider"></div>

                    {/* Professional Hydraulic Balance Section */}
                    <div className="balance-section technical">
                        <h4 className="balance-title technical-title">
                            <Activity size={14} />
                            BALANCE HIDRÁULICO: FUENTE - KM 0+000
                        </h4>
                        
                        <div className="technical-comparison-container">
                            {/* Source: Dam */}
                            <div className="tech-item source">
                                <div className="tech-label">EXTRACCIÓN PRESA</div>
                                <div className="tech-main-val">
                                    {Number(damMovements[0]?.gasto_m3s || executiveMetrics.totalReal).toFixed(2)}
                                    <small>m³/s</small>
                                </div>
                                <div className="tech-sub">FUENTE: BOQUILLA</div>
                            </div>

                            <div className="tech-arrow">
                                <ArrowRightCircle size={20} />
                                <span className="tech-dist">36 KM</span>
                            </div>

                            {/* Delivery: KM 0 */}
                            <div className="tech-item delivery">
                                <div className="tech-label">ENTREGA KM 0+000</div>
                                <div className="tech-main-val">
                                    {parseFloat(sessionStorage.getItem('zero_current_flow') || '0').toFixed(2)}
                                    <small>m³/s</small>
                                </div>
                                <div className="tech-sub" style={{ color: '#22d3ee' }}>RADIALES SICA</div>
                            </div>
                        </div>

                        <div className="radial-behavior-box">
                            <div className="rb-header">COMPORTAMIENTO DE RADIALES (K-0)</div>
                            <div className="rb-grid">
                                <div className="rb-stat">
                                    <span className="rb-st-label">NIVEL (H)</span>
                                    <span className="rb-st-val">{parseFloat(sessionStorage.getItem('zero_nivel_arriba') || '0').toFixed(2)}m</span>
                                </div>
                                <div className="rb-stat">
                                    <span className="rb-st-label">APERTURA (w)</span>
                                    <span className="rb-st-val">{parseFloat(sessionStorage.getItem('zero_radial_apertura') || '0').toFixed(2)}m</span>
                                </div>
                                <div className="rb-stat">
                                    <span className="rb-st-label">TOTAL Pz</span>
                                    <span className="rb-st-val">{sessionStorage.getItem('k0_pzas')} x {sessionStorage.getItem('k0_ancho')}m</span>
                                </div>
                            </div>
                        </div>

                        <div className="balance-summary-tech">
                            <div className="bst-item">
                                <span className="bst-label">PÉRDIDA EN TRÁNSITO</span>
                                <span className="bst-val" style={{ color: (Number(damMovements[0]?.gasto_m3s || executiveMetrics.totalReal) - Number(sessionStorage.getItem('zero_current_flow'))) > 5 ? '#ef4444' : '#22c55e' }}>
                                    {(Number(damMovements[0]?.gasto_m3s || executiveMetrics.totalReal) - Number(sessionStorage.getItem('zero_current_flow'))).toFixed(2)} m³/s
                                </span>
                            </div>
                            <div className="bst-item">
                                <span className="bst-label">EFICIENCIA GLOBAL</span>
                                <span className="bst-val highlight">
                                    {Number(damMovements[0]?.gasto_m3s || executiveMetrics.totalReal) > 0 
                                        ? ((Number(sessionStorage.getItem('zero_current_flow')) / Number(damMovements[0]?.gasto_m3s || executiveMetrics.totalReal)) * 100).toFixed(1) 
                                        : '0.0'}%
                                </span>
                            </div>
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
                                    <b className="tooltip-name">
                                        {isWaitingAtZero ? 'ESTADO: ESPERANDO TOMA 0+000' : 
                                         displayMaxKm > 0 ? `FRENTE DE AVANCE: KM ${displayMaxKm.toFixed(1)}` : 
                                         'TRÁNSITO: RÍO CONCHOS'}
                                    </b>
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
                            <Popup className="custom-popup sica-cp-popup">
                                {(() => {
                                    const nivel      = esc.nivel_actual ?? 0;
                                    const nivelMax   = esc.nivel_max_operativo && esc.nivel_max_operativo > 0 ? esc.nivel_max_operativo : null;
                                    const nivelPct   = nivelMax ? Math.min(100, (nivel / nivelMax) * 100) : null;
                                    const barColor   = nivelPct === null ? '#38bdf8' : nivelPct >= 95 ? '#ef4444' : nivelPct >= 80 ? '#f59e0b' : '#38bdf8';
                                    const gasto      = esc.gasto_actual ?? 0;
                                    const apertura   = esc.apertura_actual ?? 0;
                                    const tsAge      = esc.ultima_telemetria ? (Date.now() - esc.ultima_telemetria) / 60000 : null; // minutos
                                    const tsStale    = tsAge !== null && tsAge > 480; // > 8 horas
                                    const tsColor    = tsStale ? '#f59e0b' : '#475569';

                                    // Badge de estado legible para público
                                    let badgeLabel = 'SIN DATOS';
                                    let badgeColor = '#475569';
                                    if (esc.estado === 'OPERANDO' && nivel > 0) {
                                        if (gasto > 0) { badgeLabel = 'OPERANDO'; badgeColor = '#22c55e'; }
                                        else           { badgeLabel = 'SIN FLUJO'; badgeColor = '#f59e0b'; }
                                    } else if (esc.estado === 'LLENADO') {
                                        badgeLabel = 'EN LLENADO'; badgeColor = '#06b6d4';
                                    } else if (nivel > 0) {
                                        badgeLabel = 'CON NIVEL'; badgeColor = '#38bdf8';
                                    }

                                    // Formato tiempo humano
                                    const tiempoLectura = tsAge === null ? 'Sin datos'
                                        : tsAge < 1    ? 'Hace menos de 1 min'
                                        : tsAge < 60   ? `Hace ${Math.floor(tsAge)} min`
                                        : tsAge < 1440 ? `Hace ${Math.floor(tsAge / 60)}h ${Math.floor(tsAge % 60)}min`
                                        : 'Más de un día';

                                    return (
                                        <div className="scp-root">
                                            {/* Header */}
                                            <div className="scp-header">
                                                <span className="scp-km">KM {esc.km.toFixed(1)}</span>
                                                <span className="scp-badge" style={{ '--badge-color': badgeColor } as React.CSSProperties}>
                                                    {badgeLabel}
                                                </span>
                                            </div>
                                            <p className="scp-nombre">{esc.nombre}</p>

                                            {/* Nivel con barra */}
                                            <div className="scp-section">
                                                <span className="scp-field-label">NIVEL DE AGUA</span>
                                                <div className="scp-bar-row">
                                                    <div className="scp-bar-track">
                                                        <div className="scp-bar-fill" style={{ '--bar-w': nivelPct !== null ? `${nivelPct}%` : '0%', '--bar-color': barColor } as React.CSSProperties} />
                                                    </div>
                                                    <span className="scp-bar-val" style={{ '--bar-color': barColor } as React.CSSProperties}>{nivel.toFixed(2)} m</span>
                                                </div>
                                                {nivelMax && (
                                                    <span className="scp-ref">capacidad {nivelMax.toFixed(2)} m</span>
                                                )}
                                            </div>

                                            {/* Gasto y apertura en dos columnas */}
                                            {(gasto > 0 || apertura > 0) && (
                                                <div className="scp-metrics">
                                                    {gasto > 0 && (
                                                        <div className="scp-metric">
                                                            <span className="scp-metric-label">FLUJO MEDIDO</span>
                                                            <span className="scp-metric-val">{gasto.toFixed(2)}</span>
                                                            <span className="scp-metric-unit">m³/s</span>
                                                        </div>
                                                    )}
                                                    {apertura > 0 && (() => {
                                                        const pzas = esc.pzas_radiales && esc.pzas_radiales > 0 ? esc.pzas_radiales : 1;
                                                        const totalApertura = pzas * apertura;
                                                        return (
                                                            <div className="scp-metric">
                                                                <span className="scp-metric-label">APERTURA TOTAL</span>
                                                                <span className="scp-metric-val">{totalApertura.toFixed(2)}</span>
                                                                <span className="scp-metric-unit">m ({pzas} × {apertura.toFixed(2)}m)</span>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            )}

                                            {/* Timestamp */}
                                            <div className="scp-footer">
                                                <span className={`scp-footer-time${tsStale ? ' scp-footer-stale' : ''}`}>{tiempoLectura}</span>
                                            </div>
                                        </div>
                                    );
                                })()}
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
                    
                    {/* Section 1: Global Balance — LLENADO mantiene vista original, ESTABILIZACIÓN muestra coherencia */}
                    <div className="dock-section summary-card-large">
                        {!isEstabilizacion ? (
                            // ── Vista LLENADO (original, sin cambios) ──
                            <>
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
                            </>
                        ) : (
                            // ── Vista ESTABILIZACIÓN — Coherencia presa→K104 ──
                            <>
                                <div className="managerial-card-header">
                                    <span className="card-label">PANORAMA DEL CANAL</span>
                                    <div className="health-badge-premium" style={{ borderColor: coherenciaCanal ? (coherenciaCanal.eficiencia !== null && coherenciaCanal.eficiencia >= 88 ? '#22c55e' : coherenciaCanal.eficiencia !== null && coherenciaCanal.eficiencia >= 80 ? '#eab308' : '#ef4444') : '#475569' }}>
                                        <div className="health-dot" style={{ background: coherenciaCanal ? (coherenciaCanal.eficiencia !== null && coherenciaCanal.eficiencia >= 88 ? '#22c55e' : '#eab308') : '#475569' }}></div>
                                        {coherenciaCanal?.eficiencia !== null && coherenciaCanal?.eficiencia !== undefined ? `EF. ${coherenciaCanal.eficiencia.toFixed(1)}%` : 'SIN DATOS'}
                                    </div>
                                </div>
                                {coherenciaCanal ? (
                                    <div className="coherencia-flow-chain">
                                        {/* Presa */}
                                        <div className="cfc-node">
                                            <span className="cfc-label">PRESA</span>
                                            <span className="cfc-val">{coherenciaCanal.qPresa.toFixed(1)}</span>
                                            <span className="cfc-unit">m³/s</span>
                                        </div>
                                        <div className="cfc-arrow">
                                            <span className="cfc-loss">{coherenciaCanal.perdidaRio !== null ? `−${coherenciaCanal.perdidaRio.toFixed(1)}` : '—'}</span>
                                            <span className="cfc-dist">36km río</span>
                                        </div>
                                        {/* K0 */}
                                        <div className="cfc-node">
                                            <span className="cfc-label">K0+000</span>
                                            <span className="cfc-val">{coherenciaCanal.qK0Medido.toFixed(1)}</span>
                                            <span className="cfc-unit">m³/s</span>
                                        </div>
                                        <div className="cfc-arrow">
                                            <span className="cfc-loss">{coherenciaCanal.perdidaCanal !== null ? `−${coherenciaCanal.perdidaCanal.toFixed(1)}` : '—'}</span>
                                            <span className="cfc-dist">104km canal</span>
                                        </div>
                                        {/* K104 */}
                                        <div className="cfc-node">
                                            <span className="cfc-label">K104</span>
                                            <span className="cfc-val">{coherenciaCanal.qFinal.toFixed(1)}</span>
                                            <span className="cfc-unit">m³/s</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="coherencia-sin-datos">
                                        Sin lecturas de gasto disponibles hoy
                                    </div>
                                )}
                                {coherenciaCanal && (
                                    <div className="coherencia-resumen">
                                        <span>{coherenciaCanal.nCoherentes}/{coherenciaCanal.totalPuntos} puntos coherentes</span>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Section 2: Sources Detail (Center) - Integrated from floating card */}
                    <div className="dock-section sources-card-section">
                        <div className="dock-section-header">
                            <span className="card-label">FUENTES ACTIVAS</span>
                        </div>
                        <div className="fuentes-summary-grid-dock">
                            {presasData.map(p => (
                                <div className="fuente-dock-mini" key={p.id}>
                                    <span className="fdm-name">{p.presas?.nombre_corto?.toUpperCase() || 'PRESA'}</span>
                                    <span className="fdm-val">{p.extraccion_total?.toFixed(2)} <small>m³/s</small></span>
                                </div>
                            ))}
                            <div className="fuente-dock-mini time">
                                <span className="fdm-name">MOVIMIENTO</span>
                                <span className="fdm-val">
                                    {damMovements[0]?.fecha_hora ?
                                        formatDate(damMovements[0].fecha_hora, { day: '2-digit', month: 'short' }) + ' ' +
                                        new Date(damMovements[0].fecha_hora).toLocaleTimeString('es-MX', {
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
                                .sort((a, b) => a.km - b.km)
                                .map((e) => {
                                    // Coherencia individual: marcar punto incoherente
                                    const puntoCoh = coherenciaCanal?.puntos.find(p => p.id === e.id);
                                    const incoherente = puntoCoh && !puntoCoh.coherente;
                                    const hasFlow = isEstabilizacion && (e.gasto_actual ?? 0) > 0;
                                    return (
                                    <div
                                        className={`checkpoint-card-compact ${e.km <= displayMaxKm ? 'active' : ''} ${incoherente ? 'cpc-incoherente' : ''}`}
                                        key={e.id}
                                    >
                                        <div className="cpc-km">{e.km.toFixed(1)} <small>KM</small></div>
                                        <div className="cpc-body">
                                            <span className="cpc-name">{e.nombre}</span>
                                            <div className="cpc-data">
                                                <span className="cpc-value">{e.nivel_actual?.toFixed(2) || '0.00'}</span>
                                                <small className="cpc-unit">m</small>
                                            </div>
                                            {/* ESTABILIZACIÓN: mostrar gasto y apertura si disponibles */}
                                            {isEstabilizacion && (
                                                <div className="cpc-extra">
                                                    {hasFlow && (
                                                        <span className="cpc-gasto">{(e.gasto_actual ?? 0).toFixed(2)} m³/s</span>
                                                    )}
                                                    {(e.apertura_actual ?? 0) > 0 && (
                                                        <span className="cpc-apertura">⊿ {(e.apertura_actual ?? 0).toFixed(2)}m</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <div className="cpc-status-bar">
                                            <div
                                                className="cpc-progress"
                                                style={{
                                                    width: isEstabilizacion
                                                        ? (hasFlow ? `${Math.min(100, ((e.gasto_actual ?? 0) / Math.max(coherenciaCanal?.qK0Medido ?? 1, 1)) * 100)}%` : '0%')
                                                        : (e.km <= displayMaxKm ? '100%' : '0%'),
                                                    background: incoherente ? '#ef4444' : (e.estado === 'OPERANDO' ? '#22c55e' : statusColor)
                                                }}
                                            />
                                        </div>
                                        <div className="cpc-time">{formatTimeAgo(e.ultima_telemetria)}</div>
                                    </div>
                                    );
                                })}
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
