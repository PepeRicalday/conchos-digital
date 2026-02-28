import { Map as MapIcon, Activity, Crosshair, Layers, Wifi, TrendingUp, Zap, ShieldCheck } from 'lucide-react';
import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import clsx from 'clsx';
import './GeoMonitor.css';

// Fix para los iconos de leaflet en react
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Mock Data Hídrico
const CANAL_PRINCIPAL: [number, number][] = [
    [27.9254, -105.5123],
    [27.9500, -105.4900],
    [27.9800, -105.4500],
    [28.0200, -105.4100],
    [28.0600, -105.3800],
];

const TOMAS_ACTIVAS = [
    { id: 1, pos: [27.9500, -105.4900] as [number, number], name: "Toma Lateral 12", flow: "5.2 m³/s" },
    { id: 2, pos: [28.0200, -105.4100] as [number, number], name: "Represa Km 42", flow: "12.8 m³/s", alert: true }
];

const GeoMonitor = () => {
    // Simulando datos en tiempo real
    const [currentTime, setCurrentTime] = useState(new Date());
    const [mapReady, setMapReady] = useState(false);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        // Pequeño delay para asegurar que el DOM del mapa toma las dimensiones correctas
        setTimeout(() => setMapReady(true), 100);
        return () => clearInterval(timer);
    }, []);

    const mockEvents = [
        { time: 'Hace 2 min', type: 'Alarma', title: 'Anomalía de Flujo detectada', location: 'Canal Principal, Km 42+100', status: 'status-critical' },
        { time: 'Hace 15 min', type: 'Ajuste', title: 'Escala Recalibrada por OP-07', location: 'Toma Lateral 12', status: 'status-info' },
        { time: 'Hace 38 min', type: 'Estable', title: 'Sincronización Satelital OK', location: 'Red Mayor General', status: 'status-success' },
        { time: 'Hace 1 hora', type: 'Operación', title: 'Apertura de Compuerta (30%)', location: 'Presa Francisco I. Madero', status: 'status-warning' },
    ];

    // Centro geográfico aproximado del Distrito 005 (Delicias/Boquilla)
    const mapCenter: [number, number] = [27.9800, -105.4500];

    const chartGaugeOptions = {
        series: [
            {
                type: 'gauge',
                center: ['50%', '55%'],
                startAngle: 200,
                endAngle: -20,
                min: 0,
                max: 60,
                splitNumber: 6,
                progress: {
                    show: true,
                    width: 12,
                    itemStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                            { offset: 0, color: '#0ea5e9' },
                            { offset: 1, color: '#3b82f6' }
                        ])
                    }
                },
                pointer: { show: false },
                axisLine: {
                    lineStyle: {
                        width: 12,
                        color: [[1, 'rgba(15, 23, 42, 0.8)']]
                    }
                },
                axisTick: { show: false },
                splitLine: {
                    distance: -18,
                    length: 12,
                    lineStyle: { color: 'rgba(51, 65, 85, 0.8)', width: 2 }
                },
                axisLabel: {
                    distance: 12,
                    color: '#94a3b8',
                    fontSize: 10,
                    fontFamily: 'monospace'
                },
                detail: {
                    valueAnimation: true,
                    formatter: '{value}',
                    color: '#fff',
                    fontSize: 28,
                    fontWeight: 900,
                    offsetCenter: [0, '10%']
                },
                data: [{ value: 45.2, name: 'Gasto m³/s' }],
                title: {
                    offsetCenter: [0, '65%'],
                    color: '#22d3ee',
                    fontSize: 12,
                    fontFamily: 'monospace'
                }
            }
        ]
    };

    return (
        <div className="geo-monitor-container">
            {/* Grid de fondo decorativo general */}
            <div className="geo-background-grid"></div>

            {/* HEADER TIPO COMMAND CENTER */}
            <header className="geo-header">
                <div className="geo-header-left">
                    <div className="geo-icon-wrapper">
                        <MapIcon color="#22d3ee" size={32} />
                    </div>
                    <div>
                        <h1 className="geo-title">
                            GEO-MONITOR <span className="font-light">| VIDEO WALL</span>
                        </h1>
                        <p className="geo-subtitle">
                            Centro de Monitoreo Interactivo SDR-005
                        </p>
                    </div>
                </div>

                <div className="geo-header-right">
                    <div className="geo-time-display">
                        <div className="geo-time">
                            {currentTime.toLocaleTimeString('es-MX', { hour12: false })}
                        </div>
                        <div className="geo-date">
                            {currentTime.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}
                        </div>
                    </div>

                    <div className="geo-divider"></div>

                    <div className="geo-status-badges">
                        <span className="geo-badge live">
                            <span className="pulse-dot"></span>
                            LIVE SYNC: ACTIVO
                        </span>
                        <span className="geo-badge satellite">
                            <Wifi size={12} /> SATÉLITE ENLAZADO
                        </span>
                    </div>
                </div>
            </header>

            <div className="geo-main-content">
                {/* LEFT: TOOLS CONTROLS */}
                <div className="geo-sidebar-controls">
                    <button className="geo-control-btn active">
                        <Layers size={22} />
                        <span className="geo-indicator-dot"></span>
                    </button>
                    <button className="geo-control-btn default">
                        <Crosshair size={22} />
                    </button>
                    <button className="geo-control-btn default">
                        <Activity size={22} />
                    </button>

                    <button className="geo-control-btn shield">
                        <ShieldCheck size={22} />
                    </button>
                </div>

                {/* CENTER: LEAFLET MAP AREA */}
                <div className="geo-map-container">
                    <div className="geo-map-inner">
                        {mapReady && (
                            <MapContainer
                                center={mapCenter}
                                zoom={10}
                                style={{ height: '100%', width: '100%', background: '#0f172a' }}
                                zoomControl={false}
                                attributionControl={false}
                            >
                                {/* Esri World Imagery */}
                                <TileLayer
                                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                                    maxZoom={19}
                                />

                                {/* Overlay Opcional Oscuro para resaltar los trazados (CyberPunk Map style) */}
                                <div className="geo-map-overlay-layer" style={{ backgroundColor: 'rgba(15, 23, 42, 0.4)', mixBlendMode: 'multiply' }}></div>

                                {/* Trazado del Canal Principal Simulado */}
                                <Polyline
                                    positions={CANAL_PRINCIPAL}
                                    color="#0ea5e9"
                                    weight={5}
                                    opacity={0.8}
                                    dashArray="10, 10"
                                />

                                {/* Marcadores Reactivos */}
                                {TOMAS_ACTIVAS.map(toma => (
                                    <Marker key={toma.id} position={toma.pos}>
                                        <Popup>
                                            <div style={{ fontFamily: 'monospace' }}>
                                                <strong>{toma.name}</strong><br />
                                                Gasto Local: <span style={{ color: '#0ea5e9', fontWeight: 'bold' }}>{toma.flow}</span>
                                                {toma.alert && (
                                                    <div style={{ color: '#ef4444', fontWeight: 'bold', marginTop: '4px', fontSize: '10px', textTransform: 'uppercase' }}>
                                                        ⚠️ Revisión Requerida
                                                    </div>
                                                )}
                                            </div>
                                        </Popup>
                                    </Marker>
                                ))}
                            </MapContainer>
                        )}
                    </div>

                    {/* UI Overlay on Map (Puntero central, Scale info, etc) */}
                    <div className="geo-map-overlay-layer">
                        <div className="geo-map-tag">
                            <span>CAPA: ESRI SATÉLITE</span>
                        </div>

                        <div className="geo-map-crosshair">
                            <Crosshair size={40} />
                        </div>

                        <div className="geo-map-coords">
                            <span>Lon: {mapCenter[1].toFixed(4)}</span>
                            <div className="geo-coords-divider"></div>
                            <span>Lat: {mapCenter[0].toFixed(4)}</span>
                        </div>
                    </div>
                </div>

                {/* RIGHT: REAL-TIME FEED & STATS */}
                <div className="geo-stats-panel">

                    {/* Grafico Potente en vez del simple texto */}
                    <div className="geo-chart-card">
                        <div className="geo-stat-header">
                            <span className="geo-stat-title">Flujo Maestral Actual</span>
                            <TrendingUp size={14} className="geo-stat-icon" />
                        </div>
                        <div className="geo-chart-wrapper">
                            <ReactECharts
                                option={chartGaugeOptions}
                                style={{ height: '180px', width: '100%' }}
                                opts={{ renderer: 'svg' }}
                            />
                        </div>
                        <div className="geo-stat-footer" style={{ marginTop: '-10px' }}>
                            <span className="geo-stat-diff">+1.2% Capacidad</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Max Diseño: 60 m³/s</span>
                        </div>
                    </div>

                    {/* Operational Registry Box */}
                    <div className="geo-registry-box">
                        <div className="geo-registry-header">
                            <h3 className="geo-registry-title">
                                <Activity size={14} className="geo-registry-icon" />
                                Bitácora Operativa
                            </h3>
                            <span className="geo-pulse-indicator"></span>
                        </div>

                        <div className="geo-registry-list">
                            {mockEvents.map((ev, idx) => (
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
                        <div className="geo-registry-footer">
                            <button className="geo-registry-expand-btn">
                                Expandir Registro →
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GeoMonitor;
