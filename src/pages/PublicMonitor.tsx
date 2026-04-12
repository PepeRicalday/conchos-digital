import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, ZoomControl, Marker, useMap, Popup } from 'react-leaflet';
import { supabase } from '../lib/supabase';
import { useHydricEvents } from '../hooks/useHydricEvents';
import { Timer, Activity, Clock, ArrowRightCircle, MapPin, Waves, X } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './PublicMonitor.css';
import { formatDate } from '../utils/dateHelpers';
import type { MovimientoPresaConNombreRow } from '../types/sica.types';
import { calcIEC, iecColor } from '../utils/canalIndex';
import { onTable } from '../lib/realtimeHub';
import CanalReport from '../components/CanalReport';
import { exportEscalasCSV } from '../utils/exportCanal';

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
    gasto_actual?: number | null;
    apertura_actual?: number | null;
    puertas_abiertas?: number;
    pzas_radiales?: number;
    ancho?: number;
    nivel_max_operativo?: number | null;
    capacidad_max?: number | null;
    delta_12h?: number | null;          // tendencia en 12h (m) — positivo=sube, negativo=baja
}

// ── ESTADO DE TELEMETRÍA (5 niveles) ────────────────────────────────────
export type TelemetriaEstado = 'VIVO' | 'RETRASADO' | 'ALERTA' | 'CRITICO' | 'FUERA_DE_LINEA';

function telemetriaEstado(ultimaTelemetria?: number | null): TelemetriaEstado {
    if (!ultimaTelemetria) return 'FUERA_DE_LINEA';
    const minutos = (Date.now() - ultimaTelemetria) / 60_000;
    if (minutos <  30)   return 'VIVO';
    if (minutos < 120)   return 'RETRASADO';
    if (minutos < 480)   return 'ALERTA';
    if (minutos < 1440)  return 'CRITICO';
    return 'FUERA_DE_LINEA';
}


function telemetriaLabel(estado: TelemetriaEstado): string {
    switch (estado) {
        case 'VIVO':          return 'Vivo';
        case 'RETRASADO':     return 'Retrasado';
        case 'ALERTA':        return 'Sin señal +2h';
        case 'CRITICO':       return 'Sin señal +8h';
        case 'FUERA_DE_LINEA':return 'Fuera de línea';
    }
}

// ── COLOR DE ALERTA POR ESCALA (reutilizado en mapa y perfil) ───────────
function escalaAlertColor(e: EscalaData, coherencia?: any): string {
    const nivel = e.nivel_actual ?? 0;
    if (nivel <= 0) return '#475569'; // sin datos
    const nivelMax = e.nivel_max_operativo ?? 3.5;
    const pct = nivelMax > 0 ? nivel / nivelMax : 0;
    const coh = coherencia?.puntos?.find((p: any) => p.id === e.id);
    if (coh && !coh.coherente) return '#ef4444';
    if (pct >= 0.92) return '#ef4444';
    if (pct >= 0.80) return '#f59e0b';
    if (nivel >= 2.8) return '#22c55e';
    return '#38bdf8';
}

// ── PERFIL LONGITUDINAL DEL CANAL (ESTABILIZACIÓN) ──────────────────────
interface FGVStep { km: number; y: number; q: number; remanso: string; pct_bordo: number; alerta: boolean; critico: boolean; }

const CanalLongitudinalProfile: React.FC<{
  escalas: EscalaData[];
  coherencia: any;
  fgvProfile?: FGVStep[] | null;
  fgvLoading?: boolean;
}> = ({ escalas, coherencia, fgvProfile, fgvLoading }) => {
  const W = 800, H = 190;
  const PAD_L = 42, PAD_R = 32, PAD_T = 38, PAD_B = 30;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const KM_MAX = 104;
  const Y_MIN = 1.5, Y_MAX = 4.4;

  const xS = (km: number) => PAD_L + (Math.max(0, Math.min(km, KM_MAX)) / KM_MAX) * plotW;
  const yS = (y: number) => PAD_T + plotH - ((Math.max(Y_MIN, Math.min(y, Y_MAX)) - Y_MIN) / (Y_MAX - Y_MIN)) * plotH;

  const pts = escalas
    .filter(e => e.km >= 0 && e.km <= 104 && (e.nivel_actual ?? 0) > 0.1)
    .sort((a, b) => a.km - b.km);

  const trendArrow = (e: EscalaData): { symbol: string; color: string } => {
    const d = e.delta_12h ?? 0;
    if (d > 0.01)  return { symbol: '▲', color: '#ef4444' };
    if (d < -0.01) return { symbol: '▼', color: '#22c55e' };
    return { symbol: '—', color: '#475569' };
  };

  const base = PAD_T + plotH;
  const waterPoly = pts.length >= 2
    ? [`${xS(pts[0].km)},${base}`,
       ...pts.map(e => `${xS(e.km)},${yS(e.nivel_actual ?? 0)}`),
       `${xS(pts[pts.length - 1].km)},${base}`].join(' ')
    : '';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id="cpWater" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#38bdf8" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="cpCrit" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#ef4444" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.04" />
        </linearGradient>
        <filter id="cpGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Fondo oscuro */}
      <rect width={W} height={H} fill="#070e1c" />

      {/* Zona crítica: > 3.5m */}
      <rect x={PAD_L} y={yS(Y_MAX)} width={plotW} height={yS(3.5) - yS(Y_MAX)} fill="url(#cpCrit)" />
      {/* Zona alerta: 3.2–3.5m */}
      <rect x={PAD_L} y={yS(3.5)} width={plotW} height={yS(3.2) - yS(3.5)} fill="rgba(245,158,11,0.07)" />
      {/* Zona operativa: 2.8–3.2m */}
      <rect x={PAD_L} y={yS(3.2)} width={plotW} height={yS(2.8) - yS(3.2)} fill="rgba(34,197,94,0.08)" />
      {/* Zona baja: < 2.8m */}
      <rect x={PAD_L} y={yS(2.8)} width={plotW} height={yS(Y_MIN) - yS(2.8)} fill="rgba(56,189,248,0.04)" />

      {/* Grid horizontal */}
      {[2.0, 2.5, 3.0, 3.5, 4.0].map(y => (
        <line key={y} x1={PAD_L} y1={yS(y)} x2={PAD_L + plotW} y2={yS(y)}
          stroke="#111e34" strokeWidth={y % 1 === 0 ? 0.9 : 0.5} />
      ))}

      {/* Grid vertical en KM principales */}
      {[0, 23, 34, 57, 80, 104].map(km => (
        <line key={km} x1={xS(km)} y1={PAD_T} x2={xS(km)} y2={base}
          stroke="#111e34" strokeWidth="0.7" strokeDasharray="3,6" />
      ))}

      {/* Línea de referencia 3.5m */}
      <line x1={PAD_L} y1={yS(3.5)} x2={PAD_L + plotW} y2={yS(3.5)}
        stroke="#f59e0b" strokeWidth="1" strokeDasharray="7,5" opacity="0.65" />
      <rect x={PAD_L + plotW - 30} y={yS(3.5) - 6} width={30} height={10} fill="#f59e0b" opacity="0.15" rx="2" />
      <text x={PAD_L + plotW - 15} y={yS(3.5) + 2} fill="#f59e0b" fontSize="6" textAnchor="middle" fontFamily="monospace" fontWeight="bold">LÍM 3.5</text>

      {/* Línea de referencia 2.8m */}
      <line x1={PAD_L} y1={yS(2.8)} x2={PAD_L + plotW} y2={yS(2.8)}
        stroke="#22c55e" strokeWidth="1" strokeDasharray="7,5" opacity="0.55" />
      <rect x={PAD_L + plotW - 30} y={yS(2.8) - 6} width={30} height={10} fill="#22c55e" opacity="0.12" rx="2" />
      <text x={PAD_L + plotW - 15} y={yS(2.8) + 2} fill="#22c55e" fontSize="6" textAnchor="middle" fontFamily="monospace" fontWeight="bold">MÍN 2.8</text>

      {/* Relleno de agua bajo el perfil */}
      {pts.length >= 2 && <polygon points={waterPoly} fill="url(#cpWater)" />}

      {/* Perfil — sombra */}
      {pts.length >= 2 && (
        <polyline
          points={pts.map(e => `${xS(e.km)},${yS(e.nivel_actual ?? 0)}`).join(' ')}
          fill="none" stroke="rgba(56,189,248,0.14)" strokeWidth="7"
          strokeLinejoin="round" strokeLinecap="round"
        />
      )}
      {/* Perfil — línea principal */}
      {pts.length >= 2 && (
        <polyline
          points={pts.map(e => `${xS(e.km)},${yS(e.nivel_actual ?? 0)}`).join(' ')}
          fill="none" stroke="rgba(56,189,248,0.55)" strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round"
        />
      )}

      {/* Ejes */}
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={base} stroke="#1e2f45" strokeWidth="1" />
      <line x1={PAD_L} y1={base} x2={PAD_L + plotW} y2={base} stroke="#1e2f45" strokeWidth="1" />

      {/* Y-axis labels */}
      {[2.0, 2.5, 3.0, 3.5, 4.0].map(y => (
        <text key={y} x={PAD_L - 5} y={yS(y) + 2.5}
          fill="#3d546e" fontSize="7.5" textAnchor="end" fontFamily="monospace">{y.toFixed(1)}</text>
      ))}
      <text x={PAD_L - 28} y={PAD_T + plotH / 2}
        fill="#2d3f55" fontSize="7" textAnchor="middle" fontFamily="monospace"
        transform={`rotate(-90, ${PAD_L - 28}, ${PAD_T + plotH / 2})`}>m</text>

      {/* KM axis labels */}
      {[0, 23, 34, 57, 80, 104].map(km => (
        <g key={km}>
          <line x1={xS(km)} y1={base} x2={xS(km)} y2={base + 4} stroke="#1e2f45" strokeWidth="1" />
          <text x={xS(km)} y={H - 6} fill="#3d546e" fontSize="7.5" textAnchor="middle" fontFamily="monospace">K{km}</text>
        </g>
      ))}

      {/* ── Capa FGV — superficie libre simulada ── */}
      {fgvProfile && fgvProfile.length >= 2 && (() => {
        const fpts = fgvProfile.filter(s => s.km >= 0 && s.km <= KM_MAX);

        // Relleno FGV
        const fBase = base;
        const fWaterPoly = [
          `${xS(fpts[0].km)},${fBase}`,
          ...fpts.map(s => `${xS(s.km)},${yS(s.y)}`),
          `${xS(fpts[fpts.length - 1].km)},${fBase}`,
        ].join(' ');

        // Saltos hidráulicos: transición M2 → M1
        const jumps: number[] = [];
        for (let i = 1; i < fpts.length; i++) {
          if (fpts[i - 1].remanso === 'M2' && fpts[i].remanso === 'M1') {
            jumps.push((fpts[i - 1].km + fpts[i].km) / 2);
          }
        }

        return (
          <g opacity="0.85">
            {/* Relleno translúcido FGV */}
            <polygon points={fWaterPoly} fill="rgba(251,191,36,0.06)" />

            {/* Línea FGV — sombra */}
            <polyline
              points={fpts.map(s => `${xS(s.km)},${yS(s.y)}`).join(' ')}
              fill="none" stroke="rgba(251,191,36,0.12)" strokeWidth="6"
              strokeLinejoin="round"
            />
            {/* Línea FGV — principal (punteada) */}
            <polyline
              points={fpts.map(s => `${xS(s.km)},${yS(s.y)}`).join(' ')}
              fill="none" stroke="#fbbf24" strokeWidth="1.5"
              strokeDasharray="6,4" strokeLinejoin="round"
            />

            {/* Marcadores de alerta FGV (pct_bordo ≥ 75%) */}
            {fpts.filter(s => s.alerta && !s.critico).map((s, i) => (
              <circle key={`fa${i}`} cx={xS(s.km)} cy={yS(s.y)} r={3}
                fill="#f97316" stroke="#070e1c" strokeWidth="1" opacity="0.9" />
            ))}

            {/* Marcadores críticos FGV (pct_bordo ≥ 92%) */}
            {fpts.filter(s => s.critico).map((s, i) => (
              <circle key={`fc${i}`} cx={xS(s.km)} cy={yS(s.y)} r={4}
                fill="#ef4444" stroke="#070e1c" strokeWidth="1.2" />
            ))}

            {/* Saltos hidráulicos */}
            {jumps.map((km, i) => (
              <g key={`hj${i}`} filter="url(#cpGlow)">
                <line x1={xS(km)} y1={PAD_T + 4} x2={xS(km)} y2={base}
                  stroke="#f97316" strokeWidth="1.5" strokeDasharray="3,3" opacity="0.7" />
                <rect x={xS(km) - 14} y={PAD_T + 4} width={28} height={10}
                  fill="#f97316" opacity="0.18" rx="2" />
                <text x={xS(km)} y={PAD_T + 11} fill="#f97316" fontSize="6"
                  textAnchor="middle" fontFamily="monospace" fontWeight="bold">SALTO</text>
              </g>
            ))}
          </g>
        );
      })()}

      {/* Spinner FGV cargando */}
      {fgvLoading && (
        <text x={W / 2} y={PAD_T + plotH / 2} fill="#fbbf24" fontSize="9"
          textAnchor="middle" fontFamily="monospace" opacity="0.7">
          Calculando perfil FGV…
        </text>
      )}

      {/* Puntos con nivel, halo, tendencia */}
      {pts.map((e) => {
        const x = xS(e.km);
        const y = yS(e.nivel_actual ?? 0);
        const col = escalaAlertColor(e, coherencia);
        const { symbol, color: tColor } = trendArrow(e);
        const nearTop = y < PAD_T + 20;
        const lY = nearTop ? y + 22 : y - 13;

        return (
          <g key={e.id} filter="url(#cpGlow)">
            {/* Drop line */}
            <line x1={x} y1={y + 6} x2={x} y2={base} stroke={col} strokeWidth="1" opacity="0.18" />
            {/* Halo exterior */}
            <circle cx={x} cy={y} r={10} fill={col} opacity="0.10" />
            {/* Halo medio */}
            <circle cx={x} cy={y} r={6.5} fill={col} opacity="0.18" />
            {/* Punto principal */}
            <circle cx={x} cy={y} r={5} fill={col} stroke="#070e1c" strokeWidth="1.8" />
            {/* Brillo */}
            <circle cx={x - 1.5} cy={y - 1.8} r={1.5} fill="rgba(255,255,255,0.45)" />
            {/* Valor */}
            <text x={x} y={lY} fill={col} fontSize="9" textAnchor="middle"
              fontFamily="monospace" fontWeight="bold" letterSpacing="-0.3">
              {(e.nivel_actual ?? 0).toFixed(2)}
            </text>
            {/* Tendencia */}
            <text x={x + 8} y={lY} fill={tColor} fontSize="8" textAnchor="start" fontFamily="monospace">
              {symbol}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

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
    const [showPerfilModal, setShowPerfilModal] = useState(false);
    const [fgvData, setFgvData] = useState<any>(null);
    const [fgvLoading, setFgvLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [currentTime, setCurrentTime] = useState(() => Date.now());
    const [anchorTimes, setAnchorTimes] = useState<Record<number, string>>({});

    // 0. Update internal clock for reactive calculations
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(Date.now()), 15000);
        return () => clearInterval(timer);
    }, []);


    // 1. Fetch Canal Geometry (sessionStorage cache — estático, no cambia por sesión)
    useEffect(() => {
        const loadGeo = async () => {
            const fetchOrCache = async (url: string, key: string) => {
                const cached = sessionStorage.getItem(key);
                if (cached) {
                    try { return JSON.parse(cached); } catch { /* ignore */ }
                }
                const res = await fetch(url).then(r => r.json()).catch(() => null);
                if (res) sessionStorage.setItem(key, JSON.stringify(res));
                return res;
            };
            const [canRes, rioRes] = await Promise.all([
                fetchOrCache('/geo/canal_conchos.geojson', 'geo_canal'),
                fetchOrCache('/geo/rio_conchos.geojson',   'geo_rio'),
            ]);
            if (canRes) setGeoCanal(canRes);
            if (rioRes) setGeoRio(rioRes);
        };
        loadGeo();
    }, []);

    // 2. Fetch Escalas & Wave Data (todos los fetches en paralelo)
    const fetchData = useCallback(async () => {
        try {
            const todayDate  = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
            const eventStart = activeEvent?.fecha_inicio || `${todayDate}T00:00:00`;
            const isLlenado  = activeEvent?.evento_tipo === 'LLENADO';

            const [
                { data: escData },
                { data: pData },
                { data: summaryDelta },
                { data: readings },
                { data: mData },
                trackResult,
            ] = await Promise.all([
                supabase
                    .from('escalas')
                    .select('id, nombre, km, latitud, longitud, pzas_radiales, ancho, alto, nivel_max_operativo, capacidad_max')
                    .order('km'),
                supabase
                    .from('lecturas_presas')
                    .select('*, presas:presa_id (nombre, nombre_corto)')
                    .order('fecha', { ascending: false })
                    .order('creado_en', { ascending: false }),
                supabase
                    .from('resumen_escalas_diario')
                    .select('escala_id, delta_12h')
                    .eq('fecha', todayDate),
                supabase
                    .from('lecturas_escalas')
                    .select('escala_id, nivel_m, nivel_abajo_m, fecha, hora_lectura, apertura_radiales_m, radiales_json, gasto_calculado_m3s, creado_en')
                    .gte('creado_en', eventStart)
                    .order('creado_en', { ascending: false })
                    .limit(500),
                supabase
                    .from('movimientos_presas')
                    .select('*, presas:presa_id (nombre_corto)')
                    .order('fecha_hora', { ascending: false })
                    .limit(5),
                isLlenado && activeEvent?.id
                    ? supabase
                        .from('sica_llenado_seguimiento')
                        .select('km, hora_real')
                        .eq('evento_id', activeEvent.id)
                        .not('hora_real', 'is', null)
                        .order('km', { ascending: false })
                    : Promise.resolve({ data: null }),
            ]);

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

            // delta_12h map
            const deltaMap = new Map<string, number>();
            (summaryDelta || []).forEach((r: any) => {
                if (r.delta_12h != null) deltaMap.set(r.escala_id, r.delta_12h);
            });

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
            // con la lectura más reciente de cada escala (sin filtro de tiempo de evento)
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

            // 4. Confirmed progress from Llenado Tracker (ya obtenido en Promise.all)
            let maxKmConfirmed = -36;
            if (activeEvent?.evento_tipo === 'LLENADO') {
                const trackData = (trackResult as any).data as { km: string; hora_real: string }[] | null;
                const newAnchors: Record<number, string> = {};

                trackData?.forEach(td => {
                    const kmNum = parseFloat(td.km);
                    if (kmNum > maxKmConfirmed) maxKmConfirmed = kmNum;
                    if (!newAnchors[kmNum]) {
                        newAnchors[kmNum] = td.hora_real;
                        sessionStorage.setItem(`anchor_time_${kmNum}`, td.hora_real);
                    }
                });
                
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
                const reading = readingsMap.get(e.id);
                const nivel = reading?.nivel;
                let estado: any = 'ESPERANDO';
                
                if (nivel !== undefined && nivel > 0) estado = 'OPERANDO';
                else if (realMaxKm !== undefined && e.km <= realMaxKm) estado = 'OPERANDO';

                const timestamp = reading?.timestamp || null;

                // ── Apertura real desde radiales_json ─────────────────────────
                // apertura_radiales_m es legacy (queda en 0 cuando el operador usa
                // la interfaz de compuertas individuales). La fuente real es radiales_json.
                const radialesArr = Array.isArray(reading?.radiales_json) ? reading!.radiales_json : [];
                const aperturaTotal = radialesArr.reduce((s: number, v: any) => {
                    if (typeof v === 'object' && v !== null && v.apertura_m !== undefined)
                        return s + Number(v.apertura_m);
                    return s + (parseFloat(String(v)) || 0);
                }, 0);
                const puertasAbiertas = radialesArr.filter((v: any) => {
                    const ap = typeof v === 'object' ? Number(v.apertura_m || 0) : parseFloat(String(v));
                    return ap > 0;
                }).length;
                const aperturaFinal = aperturaTotal > 0 ? aperturaTotal : (reading?.apertura || null);

                // ── Coherencia física (solo ESTABILIZACIÓN) ───────────────────
                // En ESTABILIZACIÓN el flujo en cualquier punto del canal no puede
                // superar el gasto de presa. Si gasto_calculado_m3s (rating curve
                // Manning a nivel lleno) supera presa × 1.1, es un artefacto del
                // nivel alto residual del LLENADO — no representa flujo real.
                let gastoFinal: number | null = reading?.gasto_real ?? null;
                if (!flowStartTime && gastoFinal !== null) {
                    const qPresaRef = Number(mData?.[0]?.gasto_m3s || finalPresas[0]?.extraccion_total || 0);
                    if (qPresaRef > 0 && gastoFinal > qPresaRef * 1.1) {
                        gastoFinal = null;
                    }
                }

                return {
                    ...e,
                    nivel_actual:          nivel,
                    gasto_actual:          gastoFinal,
                    apertura_actual:       aperturaFinal,
                    puertas_abiertas:      puertasAbiertas > 0 ? puertasAbiertas : undefined,
                    nivel_max_operativo:   (e as any).nivel_max_operativo ?? null,
                    capacidad_max:         (e as any).capacidad_max       ?? null,
                    delta_12h:             deltaMap.get(e.id) ?? null,
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
            
            // Priority 1: Real gauged/calculated flow from field (SICA Capture)
            // Priority 2: Theoretical radial gate model (Cd=0.6)
            let currentFlowAtZero = zeroReading?.gasto_real || 0;

            if (currentFlowAtZero === 0 && zeroReading?.apertura > 0) {
                const Cd = 0.6;
                const hArriba = zeroReading.nivel || 0;
                const hAbajo = zeroReading.nivel_abajo || 0;
                const cargaH = hAbajo > 0 ? Math.max(0, hArriba - hAbajo) : hArriba;
                const areaTotal = pzas * ancho * zeroReading.apertura;
                currentFlowAtZero = Cd * areaTotal * Math.sqrt(2 * 9.81 * cargaH);
            }

            // Coherencia física: K0 no puede superar el gasto de presa × 1.1
            const qPresaK0 = Number(mData?.[0]?.gasto_m3s || finalPresas[0]?.extraccion_total || 0);
            if (!flowStartTime && qPresaK0 > 0 && currentFlowAtZero > qPresaK0 * 1.1) {
                currentFlowAtZero = 0;
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

        // Realtime: refresca al instante cuando llegan nuevas lecturas
        const unsubEscalas  = onTable('lecturas_escalas',   '*', fetchData);
        const unsubPresas   = onTable('lecturas_presas',    '*', fetchData);
        const unsubMov      = onTable('movimientos_presas', '*', fetchData);
        const unsubSeguim   = onTable('sica_llenado_seguimiento', 'UPDATE', fetchData);

        // Fallback polling cada 5 min (cubre reconexiones y gaps de Realtime)
        const interval = setInterval(fetchData, 300_000);

        return () => {
            unsubEscalas();
            unsubPresas();
            unsubMov();
            unsubSeguim();
            clearInterval(interval);
        };
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

    // ── IEC — Índice de Estado del Canal ─────────────────────────────────────
    const iecData = useMemo(() => {
        if (!coherenciaCanal || !isEstabilizacion) return null;
        const escalasConDatos = escalas.filter(e => e.nivel_actual !== null && e.nivel_max_operativo !== null);
        const escalasEnCritico = escalasConDatos.filter(e => {
            const pct = (e.nivel_actual ?? 0) / (e.nivel_max_operativo ?? 3.5);
            return pct >= 0.92;
        }).length;
        return calcIEC({
            eficiencia:       coherenciaCanal.eficiencia ?? 0,
            n_coherentes:     coherenciaCanal.nCoherentes,
            total_puntos:     coherenciaCanal.totalPuntos,
            q_fuga_total:     0,
            q_entrada:        coherenciaCanal.qK0Medido,
            escalas_criticas: escalasEnCritico,
            total_escalas:    escalasConDatos.length,
        });
    }, [coherenciaCanal, escalas, isEstabilizacion]);

    // ── IEC Histórico (localStorage, buffer 30 días) ──────────────────────────
    const IEC_LS_KEY = 'iec_historico_v1';
    const iecHistorico = useMemo((): { fecha: string; iec: number; sem: string }[] => {
        try { return JSON.parse(localStorage.getItem(IEC_LS_KEY) ?? '[]'); } catch { return []; }
    }, []);

    useEffect(() => {
        if (!iecData) return;
        const hoy = new Date().toLocaleDateString('en-CA');
        try {
            const hist: { fecha: string; iec: number; sem: string }[] =
                JSON.parse(localStorage.getItem(IEC_LS_KEY) ?? '[]');
            const filtered = hist.filter(h => h.fecha !== hoy);
            const updated = [...filtered, { fecha: hoy, iec: iecData.iec, sem: iecData.semaforo }]
                .sort((a, b) => a.fecha.localeCompare(b.fecha))
                .slice(-30); // últimos 30 días
            localStorage.setItem(IEC_LS_KEY, JSON.stringify(updated));
        } catch { /* ignore */ }
    }, [iecData]);

    const iecBreakdownRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = iecBreakdownRef.current;
        if (!el || !iecData) return;
        el.style.setProperty('--iec-color', iecColor(iecData.semaforo));
        el.style.setProperty('--iec-pef',   `${(iecData.p_eficiencia / 30) * 100}%`);
        el.style.setProperty('--iec-pcoh',  `${(iecData.p_coherencia / 25) * 100}%`);
        el.style.setProperty('--iec-pfug',  `${(iecData.p_fugas      / 25) * 100}%`);
        el.style.setProperty('--iec-pcrit', `${(iecData.p_criticos   / 20) * 100}%`);
    }, [iecData]);

    // ── Motor hidráulico FGV — se invoca al abrir el modal de perfil ────────
    useEffect(() => {
        if (!showPerfilModal || !coherenciaCanal || !isEstabilizacion) return;
        if (fgvData) return; // ya cargado en esta sesión de modal

        setFgvLoading(true);
        const tomas = escalas
            .filter(e => e.km >= 0 && e.km <= 104 && (e.apertura_actual ?? 0) > 0 && (e.gasto_actual ?? 0) > 0)
            .map(e => ({ km: e.km, q_m3s: e.gasto_actual! }));

        const escalasConDatos = escalas.filter(e => e.nivel_actual !== null && e.nivel_max_operativo !== null);
        const escalasEnCritico = escalasConDatos.filter(e =>
            (e.nivel_actual ?? 0) / (e.nivel_max_operativo ?? 3.5) >= 0.92
        ).length;

        supabase.functions.invoke('hydraulic-engine', {
            body: {
                q:                 coherenciaCanal.qK0Medido,
                km_inicio:         0,
                km_fin:            104,
                tomas,
                eficiencia:        coherenciaCanal.eficiencia ?? 0,
                n_coherentes:      coherenciaCanal.nCoherentes,
                total_puntos:      coherenciaCanal.totalPuntos,
                q_fuga_total:      0,
                escalas_criticas:  escalasEnCritico,
                total_escalas:     escalasConDatos.length,
            },
        }).then(({ data, error }) => {
            if (!error && data) setFgvData(data);
        }).finally(() => setFgvLoading(false));
    }, [showPerfilModal, coherenciaCanal, isEstabilizacion]);

    // Limpiar cache FGV cuando cambian los datos de campo
    useEffect(() => { setFgvData(null); }, [coherenciaCanal]);

    // Canal segmentado por color de alerta (modo ESTABILIZACIÓN)
    const canalAlertSegments = useMemo(() => {
        if (!isEstabilizacion || canalDistData.length === 0 || escalas.length === 0) return [];

        const sorted = [...escalas]
            .filter(e => typeof e.km === 'number')
            .sort((a, b) => a.km - b.km);

        if (sorted.length === 0) return [];

        const maxKm = canalDistData[canalDistData.length - 1]?.dist ?? 104;
        // N escalas → N+1 segments: [0→km0], [km0→km1], …, [km_{N-1}→maxKm]
        const breakpoints = [0, ...sorted.map(e => e.km), maxKm];
        // Color for segment i: downstream escala (sorted[i]), last segment reuses sorted[N-1]
        const colors = [
            ...sorted.map(e => escalaAlertColor(e, coherenciaCanal)),
            escalaAlertColor(sorted[sorted.length - 1], coherenciaCanal),
        ];

        const segments: { coords: [number, number][]; color: string }[] = [];
        for (let i = 0; i < breakpoints.length - 1; i++) {
            const fromKm = breakpoints[i];
            const toKm   = breakpoints[i + 1];
            const color  = colors[i] ?? '#64748b';
            const coords = canalDistData
                .filter(d => d.dist >= fromKm && d.dist <= toKm)
                .map(d => [d.lat, d.lng] as [number, number]);
            if (coords.length >= 2) segments.push({ coords, color });
        }
        return segments;
    }, [isEstabilizacion, canalDistData, escalas, coherenciaCanal]);

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
                        type="button"
                        className="phb-system-btn"
                        onClick={() => window.location.href = '/'}
                        title="Ir al sistema completo"
                    >
                        <Activity size={12} />
                    </button>
                    <div className="phb-version">v{__V2_APP_VERSION__}</div>
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
                        <button type="button" className="panel-toggle-mini" onClick={() => setIsPredictionVisible(false)} title="Cerrar panel">×</button>
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

                    {/* Tramos del canal coloreados por alerta (modo ESTABILIZACIÓN) */}
                    {canalAlertSegments.map((seg, i) => (
                        <Polyline
                            key={`seg-${i}`}
                            positions={seg.coords}
                            color={seg.color}
                            weight={6}
                            opacity={0.85}
                        />
                    ))}

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
                            fillColor={esc.km <= displayMaxKm
                                ? (isEstabilizacion ? escalaAlertColor(esc, coherenciaCanal) : statusColor)
                                : '#1e293b'}
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
                                    const tsAge      = esc.ultima_telemetria ? (Date.now() - esc.ultima_telemetria) / 60000 : null;
                                    const telEstado  = telemetriaEstado(esc.ultima_telemetria);
                                    const telTxt     = telemetriaLabel(telEstado);

                                    // Badge de estado operativo
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
                                            {/* Nombre + indicador de señal */}
                                            <div className="scp-nombre-row">
                                                <p className="scp-nombre">{esc.nombre}</p>
                                                <span
                                                    className="scp-signal"
                                                    data-tel={telEstado}
                                                    title={telTxt}
                                                />
                                            </div>

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
                                                    {apertura > 0 && (
                                                        <div className="scp-metric">
                                                            <span className="scp-metric-label">APERTURA ACUM.</span>
                                                            <span className="scp-metric-val">{apertura.toFixed(2)}</span>
                                                            <span className="scp-metric-unit">
                                                                m
                                                                {esc.puertas_abiertas != null && esc.pzas_radiales != null
                                                                    ? ` · ${esc.puertas_abiertas}/${esc.pzas_radiales} comp.`
                                                                    : esc.pzas_radiales != null
                                                                        ? ` · ${esc.pzas_radiales} comp.`
                                                                        : ''}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Timestamp + estado señal */}
                                            <div className="scp-footer">
                                                <span className="scp-footer-time" data-tel={telEstado}>
                                                    {tiempoLectura}
                                                </span>
                                                <span className="scp-footer-signal" data-tel={telEstado}>
                                                    {telTxt}
                                                </span>
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
                    <button type="button" className="dock-close-btn" onClick={() => setIsDockVisible(false)} title="Cerrar tablero">×</button>
                    
                    {/* Panel izquierdo: Balance / Panorama + Fuentes fusionados */}
                    <div className="dock-section dock-panel-left">
                        {!isEstabilizacion ? (
                            // ── Vista LLENADO ──
                            <>
                                <div className="dock-panel-header">
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
                                {/* Fuentes en LLENADO */}
                                <div className="dock-panel-footer">
                                    {presasData.map(p => (
                                        <span key={p.id} className="dpf-item">
                                            <span className="dpf-label">{p.presas?.nombre_corto?.toUpperCase() || 'PRESA'}</span>
                                            <span className="dpf-val">{p.extraccion_total?.toFixed(1)} m³/s</span>
                                        </span>
                                    ))}
                                    {damMovements[0]?.fecha_hora && (
                                        <span className="dpf-item">
                                            <span className="dpf-label">MOV.</span>
                                            <span className="dpf-val">
                                                {formatDate(damMovements[0].fecha_hora, { day: '2-digit', month: 'short' })}
                                                {' '}
                                                {new Date(damMovements[0].fecha_hora).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Chihuahua' })}
                                            </span>
                                        </span>
                                    )}
                                </div>
                            </>
                        ) : (
                            // ── Vista ESTABILIZACIÓN ──
                            <>
                                {/* Header: título + badge + botón perfil */}
                                <div className="dock-panel-header">
                                    <span className="card-label">PANORAMA DEL CANAL</span>
                                    {iecData && (
                                        <div
                                            className="health-badge-premium iec-badge"
                                            style={{ borderColor: iecColor(iecData.semaforo) }}
                                            title={`IEC ${iecData.iec}/100 — ${iecData.texto}\nEficiencia: ${iecData.p_eficiencia}/30 pts\nCoherencia: ${iecData.p_coherencia}/25 pts\nFugas: ${iecData.p_fugas}/25 pts\nCríticos: ${iecData.p_criticos}/20 pts`}
                                        >
                                            <div className="health-dot" style={{ background: iecColor(iecData.semaforo) }}></div>
                                            <span className="iec-score">{iecData.iec}</span>
                                            <span className="iec-label">IEC</span>
                                        </div>
                                    )}
                                    <button type="button" className="perfil-inline-btn" onClick={() => setShowPerfilModal(true)} title="Ver perfil hidráulico">
                                        <Waves size={12} />
                                        <span>PERFIL</span>
                                        <span className="ptb-badge">●</span>
                                    </button>
                                </div>

                                {/* Cadena de flujo */}
                                {coherenciaCanal ? (
                                    <div className="coherencia-flow-chain">
                                        <div className="cfc-node">
                                            <span className="cfc-label">PRESA</span>
                                            <span className="cfc-val">{coherenciaCanal.qPresa.toFixed(1)}</span>
                                            <span className="cfc-unit">m³/s</span>
                                        </div>
                                        <div className="cfc-arrow">
                                            <span className="cfc-loss">{coherenciaCanal.perdidaRio !== null ? `−${coherenciaCanal.perdidaRio.toFixed(1)}` : '—'}</span>
                                            <span className="cfc-dist">36km río</span>
                                        </div>
                                        <div className="cfc-node">
                                            <span className="cfc-label">K0+000</span>
                                            <span className="cfc-val">{coherenciaCanal.qK0Medido.toFixed(1)}</span>
                                            <span className="cfc-unit">m³/s</span>
                                        </div>
                                        <div className="cfc-arrow">
                                            <span className="cfc-loss">{coherenciaCanal.perdidaCanal !== null ? `−${coherenciaCanal.perdidaCanal.toFixed(1)}` : '—'}</span>
                                            <span className="cfc-dist">104km canal</span>
                                        </div>
                                        <div className="cfc-node">
                                            <span className="cfc-label">K104</span>
                                            <span className="cfc-val">{coherenciaCanal.qFinal.toFixed(1)}</span>
                                            <span className="cfc-unit">m³/s</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="coherencia-sin-datos">Sin lecturas de gasto disponibles hoy</div>
                                )}

                                {/* IEC — Desglose de componentes en español */}
                                {iecData && (
                                    <div className="iec-breakdown" ref={iecBreakdownRef}>
                                        <div className="iec-breakdown-row">
                                            <span className="iec-bd-title">ÍNDICE DE ESTADO DEL CANAL</span>
                                            <span className="iec-bd-total">{iecData.iec}/100</span>
                                        </div>
                                        <div className="iec-bd-bars">
                                            <div className="iec-bd-item">
                                                <span className="iec-bd-label">Eficiencia</span>
                                                <div className="iec-bd-track"><div className="iec-bd-fill iec-fill-ef" /></div>
                                                <span className="iec-bd-pts">{iecData.p_eficiencia}<small>/30</small></span>
                                            </div>
                                            <div className="iec-bd-item">
                                                <span className="iec-bd-label">Coherencia</span>
                                                <div className="iec-bd-track"><div className="iec-bd-fill iec-fill-coh" /></div>
                                                <span className="iec-bd-pts">{iecData.p_coherencia}<small>/25</small></span>
                                            </div>
                                            <div className="iec-bd-item">
                                                <span className="iec-bd-label">Sin fugas</span>
                                                <div className="iec-bd-track"><div className="iec-bd-fill iec-fill-fug" /></div>
                                                <span className="iec-bd-pts">{iecData.p_fugas}<small>/25</small></span>
                                            </div>
                                            <div className="iec-bd-item">
                                                <span className="iec-bd-label">Nivel canal</span>
                                                <div className="iec-bd-track"><div className="iec-bd-fill iec-fill-crit" /></div>
                                                <span className="iec-bd-pts">{iecData.p_criticos}<small>/20</small></span>
                                            </div>
                                        </div>
                                        <div className="iec-bd-texto">{iecData.texto}</div>
                                    </div>
                                )}

                                {/* IEC histórico — sparkline 30 días */}
                                {iecHistorico.length >= 2 && (
                                    <div className="iec-sparkline-wrap">
                                        <span className="iec-sp-label">IEC 30 días</span>
                                        <svg className="iec-sparkline" viewBox="0 0 120 28" preserveAspectRatio="none">
                                            {iecHistorico.map((h, i, arr) => {
                                                const x1 = (i / (arr.length - 1)) * 118 + 1;
                                                const y1 = 26 - (h.iec / 100) * 24;
                                                if (i === 0) return null;
                                                const prev = arr[i - 1];
                                                const x0 = ((i - 1) / (arr.length - 1)) * 118 + 1;
                                                const y0 = 26 - (prev.iec / 100) * 24;
                                                const col = h.sem === 'VERDE' ? '#22c55e' : h.sem === 'AMARILLO' ? '#f59e0b' : '#ef4444';
                                                return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={col} strokeWidth="1.5" strokeLinecap="round" />;
                                            })}
                                            {iecHistorico.length > 0 && (() => {
                                                const last = iecHistorico[iecHistorico.length - 1];
                                                const x = 119;
                                                const y = 26 - (last.iec / 100) * 24;
                                                const col = last.sem === 'VERDE' ? '#22c55e' : last.sem === 'AMARILLO' ? '#f59e0b' : '#ef4444';
                                                return <circle cx={x} cy={y} r="2.5" fill={col} />;
                                            })()}
                                        </svg>
                                        <span className="iec-sp-val">{iecHistorico[iecHistorico.length - 1]?.iec ?? '—'}</span>
                                    </div>
                                )}

                                {/* Acciones: Reporte PDF + CSV */}
                                {(iecData && coherenciaCanal) && (
                                    <div className="dock-action-row">
                                        <button
                                            type="button"
                                            className="dock-action-btn"
                                            onClick={() => setShowReport(true)}
                                            title="Generar reporte gerencial PDF"
                                        >
                                            Reporte PDF
                                        </button>
                                        <button
                                            type="button"
                                            className="dock-action-btn dock-action-btn--csv"
                                            onClick={() => exportEscalasCSV(escalas)}
                                            title="Exportar telemetría a CSV"
                                        >
                                            Exportar CSV
                                        </button>
                                    </div>
                                )}

                                {/* Footer: fuente + movimiento + coherencia en una línea */}
                                <div className="dock-panel-footer">
                                    {presasData.map(p => (
                                        <span key={p.id} className="dpf-item">
                                            <span className="dpf-label">{p.presas?.nombre_corto?.toUpperCase() || 'PRESA'}</span>
                                            <span className="dpf-val">{p.extraccion_total?.toFixed(1)} m³/s</span>
                                        </span>
                                    ))}
                                    {damMovements[0]?.fecha_hora && (
                                        <span className="dpf-item">
                                            <span className="dpf-label">MOV.</span>
                                            <span className="dpf-val">
                                                {formatDate(damMovements[0].fecha_hora, { day: '2-digit', month: 'short' })}
                                                {' '}
                                                {new Date(damMovements[0].fecha_hora).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Chihuahua' })}
                                            </span>
                                        </span>
                                    )}
                                    {coherenciaCanal && (
                                        <span className="dpf-item dpf-coh">
                                            <span className="dpf-val">{coherenciaCanal.nCoherentes}/{coherenciaCanal.totalPuntos} coherentes</span>
                                        </span>
                                    )}
                                </div>
                            </>
                        )}
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
                                                        <span className="cpc-apertura">
                                                            ⊿ {(e.apertura_actual ?? 0).toFixed(2)}m
                                                            {e.puertas_abiertas != null && e.pzas_radiales != null
                                                                ? ` (${e.puertas_abiertas}/${e.pzas_radiales})`
                                                                : ''}
                                                        </span>
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

            {/* Reporte gerencial PDF */}
            {showReport && iecData && coherenciaCanal && (
                <CanalReport
                    coherencia={coherenciaCanal}
                    iec={iecData}
                    escalas={escalas}
                    fgv={fgvData ?? null}
                    onClose={() => setShowReport(false)}
                />
            )}

            {/* Modal — Perfil Longitudinal */}
            {showPerfilModal && (
                <div className="perfil-modal-overlay" onClick={() => setShowPerfilModal(false)}>
                    <div className="perfil-modal" onClick={e => e.stopPropagation()}>
                        <div className="perfil-modal-header">
                            <div className="perfil-modal-title">
                                <Waves size={15} className="perfil-modal-icon" />
                                <span className="perfil-modal-title-text">PERFIL HIDRÁULICO — CANAL CONCHOS</span>
                                <span className="ptb-badge">● EN VIVO</span>
                            </div>
                            <button type="button" className="perfil-modal-close" title="Cerrar perfil" aria-label="Cerrar perfil" onClick={() => setShowPerfilModal(false)}>
                                <X size={16} />
                            </button>
                        </div>
                        <div className="perfil-modal-body">
                            <div className="perfil-svg-scroll">
                                <CanalLongitudinalProfile
                                    escalas={escalas}
                                    coherencia={coherenciaCanal}
                                    fgvProfile={fgvData?.profile}
                                    fgvLoading={fgvLoading}
                                />
                            </div>
                            <div className="canal-profile-legend">
                                <span className="cpl-item cpl-green">Operativo 2.8–3.2m</span>
                                <span className="cpl-item cpl-amber">Alerta &gt;3.2m</span>
                                <span className="cpl-item cpl-red">Crítico / Incoherente</span>
                                <span className="cpl-item cpl-blue">Sin rango op.</span>
                                <span className="cpl-item cpl-trend">▲ sube · ▼ baja · — estable (Δ12h)</span>
                                {fgvData && <span className="cpl-item cpl-fgv">— — FGV simulado</span>}
                                {fgvData?.criticos?.length > 0 && <span className="cpl-item cpl-jump">| Salto hidráulico</span>}
                            </div>
                            {fgvData && (
                                <div className="fgv-summary-bar">
                                    <span>Q entrada: <b>{fgvData.q_entrada?.toFixed(1)} m³/s</b></span>
                                    <span>Q salida: <b>{fgvData.q_salida?.toFixed(1)} m³/s</b></span>
                                    <span>Ef. conducción: <b>{fgvData.eficiencia_conduccion?.toFixed(1)}%</b></span>
                                    <span>Tránsito: <b>{fgvData.transit_time_h?.toFixed(1)} h</b></span>
                                    {fgvData.criticos?.length > 0 && (
                                        <span className="fgv-alert">⚠ {fgvData.criticos.length} punto(s) crítico(s)</span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className="floating-ui-controls-v2">
                {!isPredictionVisible && activeEvent?.evento_tipo === 'LLENADO' && (
                    <button type="button" className="control-btn-premium" onClick={() => setIsPredictionVisible(true)} title="Mostrar avance del frente">
                        <Timer size={18} />
                        <span className="btn-label">TRAYECTO</span>
                    </button>
                )}
                {isEstabilizacion && (
                    <button type="button" className="control-btn-premium" onClick={() => setShowPerfilModal(true)} title="Perfil hidráulico del canal">
                        <Waves size={18} />
                        <span className="btn-label">PERFIL</span>
                    </button>
                )}
                {!isDockVisible && (
                    <button type="button" className="control-btn-premium" onClick={() => setIsDockVisible(true)} title="Mostrar tablero">
                        <Activity size={18} />
                        <span className="btn-label">TABLERO</span>
                    </button>
                )}
            </div>
        </div>
    );
};

export default PublicMonitor;
