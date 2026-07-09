import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, ZoomControl, Marker, useMap, Popup } from 'react-leaflet';
import { supabase } from '../lib/supabase';
import { useHydricEvents } from '../hooks/useHydricEvents';
import { Timer, Activity, Clock, ArrowRightCircle, MapPin, Waves, X, AlertTriangle, Download, Copy } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './PublicMonitor.css';
import { formatDate } from '../utils/dateHelpers';
import type { MovimientoPresaConNombreRow, RegistroAlertaRow } from '../types/sica.types';
import { calcIEC, iecColor } from '../utils/canalIndex';
import { calcRadialFlow, M1_FACTORS, getM1Factor } from '../utils/hydraulics';
import { onTable } from '../lib/realtimeHub';
import InformeOperativo from '../components/InformeOperativo';
import { exportEscalasCSV } from '../utils/exportCanal';
import { toast } from 'sonner';
import TendenciasPanel from '../components/TendenciasPanel';
import {
  serieNivelesDiaria, serieNivelesLectura, indiceNivelesDiario, serieVolumenTramos,
  serieCompuertas, serieGasto,
  type SerieEscala, type SerieTramo, type SerieCompuerta, type SerieGasto, type SeriePunto,
  type LecturaEscala as TndLectura, type ResumenDiario as TndResumen,
  type TramoGeom, type EntregaModulo as TndEntrega,
} from '../utils/tendencias';

// Escalas de referencia: tienen nivel pero no controlan Q (sin compuerta propia).
const ESC_SIN_CONTROL = new Set(['K-64', 'K-94+200']);

// λ de referencia (calibración histórica v3.6b, skill_hidraulica_v37.md).
// Se usa SOLO como fallback del predictor "what-if" cuando el balance en vivo
// no es confiable (telemetría vencida) y por tanto la λ dinámica es null.
// Nunca se presenta como medición en vivo: el panel muestra "S/D" en ese caso.
const LAMBDA_REF = 0.00703; // m³/s·km⁻¹

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
    nivel_abajo?: number | null;        // H↓ aguas abajo (m) — diferencial para Q radial
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


// Edad legible (min → "45 min" / "10.4 h"). null → "s/d".
function fmtAge(min: number | null): string {
    if (min === null) return 's/d';
    return min < 60 ? `${Math.round(min)} min` : `${(min / 60).toFixed(1)} h`;
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

// React.memo: el perfil se redibuja solo cuando cambian escalas/coherencia/FGV,
// no con cada tick del reloj del monitor.
const CanalLongitudinalProfile = React.memo(({ escalas, coherencia, fgvProfile, fgvLoading }: {
  escalas: EscalaData[];
  coherencia: any;
  fgvProfile?: FGVStep[] | null;
  fgvLoading?: boolean;
}) => {
  const W = 800, H = 190;
  const PAD_L = 42, PAD_R = 32, PAD_T = 38, PAD_B = 30;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const KM_MAX = 104;
  const Y_MIN = 1.5;

  const pts = escalas
    .filter(e => e.km >= 0 && e.km <= 104 && (e.nivel_actual ?? 0) > 0.1)
    .sort((a, b) => a.km - b.km);

  // Y_MAX adaptativo: deja margen sobre el bordo más alto y el nivel más alto
  // para que ni la línea de bordo ni la zona crítica queden recortadas.
  const maxBordo = Math.max(0, ...escalas.map(e => e.nivel_max_operativo ?? 0));
  const maxNivel = Math.max(0, ...pts.map(e => e.nivel_actual ?? 0));
  const Y_MAX = Math.max(4.4, Math.ceil((Math.max(maxBordo, maxNivel) + 0.3) * 2) / 2);

  const xS = (km: number) => PAD_L + (Math.max(0, Math.min(km, KM_MAX)) / KM_MAX) * plotW;
  const yS = (y: number) => PAD_T + plotH - ((Math.max(Y_MIN, Math.min(y, Y_MAX)) - Y_MIN) / (Y_MAX - Y_MIN)) * plotH;

  // ── Bordo libre REAL por escala ─────────────────────────────────────────
  // Antes el fondo crítico/alerta era una banda horizontal fija (3.5/3.2m) para
  // TODO el canal. Pero cada escala tiene su propio nivel_max_operativo: 3.0m en
  // K-0 y 3.0m en K-104 NO representan el mismo riesgo de desbordamiento. Aquí
  // construimos la línea de bordo siguiendo el techo real de cada escala, y las
  // zonas de riesgo se dibujan RELATIVAS a ese techo (no a un umbral global).
  const bordoPts = escalas
    .filter(e => e.km >= 0 && e.km <= 104 && (e.nivel_max_operativo ?? 0) > 0.1)
    .sort((a, b) => a.km - b.km)
    .map(e => ({ km: e.km, bordo: e.nivel_max_operativo as number }));
  const hasBordo = bordoPts.length >= 2;
  // Banda de ALERTA = 80–100% del bordo; CRÍTICO = >100% del bordo.
  const ALERTA_FRAC = 0.80;

  // ── Frescura de telemetría ──────────────────────────────────────────────
  // Coherente con el banner "TELEMETRÍA VENCIDA" del panel SKILL. Si la lectura
  // más reciente supera 4 h, el perfil dibuja datos históricos: lo atenuamos y
  // congelamos la animación de flujo para no insinuar operación en vivo.
  const STALE_MIN = 240;
  const ptAgeMin = (e: EscalaData): number | null =>
    e.ultima_telemetria ? (Date.now() - e.ultima_telemetria) / 60000 : null;
  const edadMin = pts.reduce<number | null>((min, e) => {
    const a = ptAgeMin(e);
    if (a === null) return min;
    return min === null || a < min ? a : min;
  }, null);
  const perfilStale = edadMin === null || edadMin > STALE_MIN;
  const edadTxt = edadMin === null ? 'sin lectura'
    : edadMin < 60 ? `${Math.round(edadMin)} min`
    : `${(edadMin / 60).toFixed(1)} h`;
  const bordoLine   = hasBordo ? bordoPts.map(b => `${xS(b.km)},${yS(b.bordo)}`).join(' ') : '';
  const alertaLine  = hasBordo ? bordoPts.map(b => `${xS(b.km)},${yS(b.bordo * ALERTA_FRAC)}`).join(' ') : '';

  const trendArrow = (e: EscalaData): { symbol: string; color: string } => {
    const d = e.delta_12h ?? 0;
    if (d > 0.01)  return { symbol: '▲', color: '#ef4444' };
    if (d < -0.01) return { symbol: '▼', color: '#22c55e' };
    return { symbol: '—', color: '#475569' };
  };

  // ── Spline Catmull-Rom → curva suave (superficie de agua fluida) ─────────
  // Convierte una serie de puntos [x,y] en un path SVG con curvas Bézier que
  // pasan por todos los puntos. Da el aspecto de lámina de agua continua en
  // lugar de segmentos rectos quebrados.
  const smoothPath = (xy: [number, number][]): string => {
    if (xy.length < 2) return '';
    if (xy.length === 2) return `M ${xy[0][0]},${xy[0][1]} L ${xy[1][0]},${xy[1][1]}`;
    const t = 0.5; // tensión
    let d = `M ${xy[0][0]},${xy[0][1]}`;
    for (let i = 0; i < xy.length - 1; i++) {
      const p0 = xy[i === 0 ? 0 : i - 1];
      const p1 = xy[i];
      const p2 = xy[i + 1];
      const p3 = xy[i + 2 < xy.length ? i + 2 : i + 1];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6 * t * 2;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6 * t * 2;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6 * t * 2;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6 * t * 2;
      d += ` C ${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
    }
    return d;
  };

  const base = PAD_T + plotH;
  const waterXY: [number, number][] = pts.map(e => [xS(e.km), yS(e.nivel_actual ?? 0)]);
  const waterLinePath = smoothPath(waterXY);
  const waterAreaPath = pts.length >= 2
    ? `${waterLinePath} L ${xS(pts[pts.length - 1].km)},${base} L ${xS(pts[0].km)},${base} Z`
    : '';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        {/* Cuerpo de agua — degradado vertical glassy */}
        <linearGradient id="cpWater" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#22d3ee" stopOpacity="0.34" />
          <stop offset="45%"  stopColor="#38bdf8" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.02" />
        </linearGradient>
        {/* Línea de superficie — degradado horizontal (entrada → salida) */}
        <linearGradient id="cpSurface" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#67e8f9" />
          <stop offset="55%"  stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#818cf8" />
        </linearGradient>
        {/* Brillo móvil que recorre la superficie (sensación de flujo) */}
        <linearGradient id="cpFlow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#ffffff" stopOpacity="0" />
          <stop offset="50%"  stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          <animate attributeName="x1" values="-0.3;1" dur="4.5s" repeatCount="indefinite" />
          <animate attributeName="x2" values="0;1.3" dur="4.5s" repeatCount="indefinite" />
        </linearGradient>
        <linearGradient id="cpCrit" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#ef4444" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.03" />
        </linearGradient>
        {/* Vignette del lienzo */}
        <radialGradient id="cpVignette" cx="50%" cy="40%" r="75%">
          <stop offset="60%" stopColor="#070e1c" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.55" />
        </radialGradient>
        <filter id="cpGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {/* Glow suave para la línea de superficie */}
        <filter id="cpLineGlow" x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="bg" />
          <feMerge><feMergeNode in="bg" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Fondo oscuro */}
      <rect width={W} height={H} fill="#070e1c" />

      {/* ── Zonas de riesgo RELATIVAS al bordo real de cada escala ──────────
           El techo de riesgo sigue el nivel_max_operativo punto a punto, no un
           umbral global. Así el riesgo de desbordamiento es comparable a lo
           largo de todo el canal aunque las escalas tengan distinta altura. */}
      {hasBordo ? (
        <>
          {/* Zona CRÍTICA: por encima de la línea de bordo (riesgo de rebose) */}
          <polygon
            points={`${xS(bordoPts[0].km)},${PAD_T} ${bordoLine} ${xS(bordoPts[bordoPts.length - 1].km)},${PAD_T}`}
            fill="url(#cpCrit)" />
          {/* Zona ALERTA: banda entre 80% del bordo y el bordo */}
          <polygon
            points={`${alertaLine} ${bordoPts.slice().reverse().map(b => `${xS(b.km)},${yS(b.bordo)}`).join(' ')}`}
            fill="rgba(245,158,11,0.08)" />
        </>
      ) : (
        // Fallback al esquema fijo solo si no hay bordo definido en ninguna escala
        <>
          <rect x={PAD_L} y={yS(Y_MAX)} width={plotW} height={yS(3.5) - yS(Y_MAX)} fill="url(#cpCrit)" />
          <rect x={PAD_L} y={yS(3.5)} width={plotW} height={yS(3.2) - yS(3.5)} fill="rgba(245,158,11,0.07)" />
        </>
      )}

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

      {/* Línea de BORDO real por escala (techo de seguridad) — curva suave */}
      {hasBordo && (
        <>
          <path d={smoothPath(bordoPts.map(b => [xS(b.km), yS(b.bordo)]))}
            fill="none" stroke="#ef4444" strokeWidth="1.4"
            strokeDasharray="7,5" opacity="0.75" strokeLinejoin="round" />
          <rect x={PAD_L + plotW - 34} y={yS(bordoPts[bordoPts.length - 1].bordo) - 6} width={34} height={10}
            fill="#ef4444" opacity="0.15" rx="2" />
          <text x={PAD_L + plotW - 17} y={yS(bordoPts[bordoPts.length - 1].bordo) + 2}
            fill="#ef4444" fontSize="6" textAnchor="middle" fontFamily="monospace" fontWeight="bold">BORDO</text>
          {/* Línea de alerta = 80% del bordo */}
          <path d={smoothPath(bordoPts.map(b => [xS(b.km), yS(b.bordo * ALERTA_FRAC)]))}
            fill="none" stroke="#f59e0b" strokeWidth="0.9"
            strokeDasharray="4,4" opacity="0.45" strokeLinejoin="round" />
        </>
      )}

      {/* Cuerpo de agua + superficie — atenuados si la telemetría está vencida */}
      <g opacity={perfilStale ? 0.42 : 1}>
        {/* Cuerpo de agua — relleno glassy con curva suave */}
        {pts.length >= 2 && <path d={waterAreaPath} fill="url(#cpWater)" />}

        {/* Superficie — halo suave */}
        {pts.length >= 2 && (
          <path d={waterLinePath} fill="none" stroke="rgba(56,189,248,0.16)"
            strokeWidth="7.5" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {/* Superficie — línea principal. En vivo: degradado + glow. Vencida:
            gris punteado para señalar que es un perfil histórico, no actual. */}
        {pts.length >= 2 && (
          perfilStale ? (
            <path d={waterLinePath} fill="none" stroke="#64748b" strokeWidth="2"
              strokeDasharray="5,4" strokeLinejoin="round" strokeLinecap="round" />
          ) : (
            <path d={waterLinePath} fill="none" stroke="url(#cpSurface)" strokeWidth="2.4"
              strokeLinejoin="round" strokeLinecap="round" filter="url(#cpLineGlow)" />
          )
        )}
        {/* Brillo móvil + partícula de flujo — SOLO en vivo (congelado si vencido) */}
        {pts.length >= 2 && !perfilStale && (
          <path d={waterLinePath} fill="none" stroke="url(#cpFlow)" strokeWidth="2.6"
            strokeLinejoin="round" strokeLinecap="round" />
        )}
        {pts.length >= 2 && !perfilStale && waterLinePath && (
          <circle r="2.4" fill="#ffffff" opacity="0.85">
            <animateMotion dur="4.5s" repeatCount="indefinite" path={waterLinePath} rotate="auto" />
            <animate attributeName="opacity" values="0;0.9;0" dur="4.5s" repeatCount="indefinite" />
          </circle>
        )}
      </g>

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
        const baseCol = escalaAlertColor(e, coherencia);
        const age = ptAgeMin(e);
        const ptStale = age === null || age > STALE_MIN;
        // Punto vencido: color desaturado (gris) para no afirmar alerta en vivo.
        const col = ptStale ? '#64748b' : baseCol;
        const isCrit = !ptStale && baseCol === '#ef4444';
        const { symbol, color: tColor } = trendArrow(e);
        const nearTop = y < PAD_T + 20;
        const lY = nearTop ? y + 22 : y - 14;

        return (
          <g key={e.id} filter="url(#cpGlow)">
            {/* Drop line al lecho */}
            <line x1={x} y1={y + 6} x2={x} y2={base} stroke={col} strokeWidth="1" opacity="0.18" />
            {/* Anillo de pulso animado solo en puntos críticos EN VIVO */}
            {isCrit && (
              <circle cx={x} cy={y} r={6} fill="none" stroke={col} strokeWidth="1.4">
                <animate attributeName="r" values="6;13;6" dur="2.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;0;0.7" dur="2.2s" repeatCount="indefinite" />
              </circle>
            )}
            {/* Halo exterior */}
            <circle cx={x} cy={y} r={10} fill={col} opacity={ptStale ? 0.06 : 0.10} />
            {/* Halo medio */}
            <circle cx={x} cy={y} r={6.5} fill={col} opacity={ptStale ? 0.12 : 0.20} />
            {/* Punto principal — relleno si en vivo, hueco si vencido */}
            <circle cx={x} cy={y} r={5}
              fill={ptStale ? '#0a1426' : col}
              stroke={col} strokeWidth={ptStale ? 1.6 : 1.8}
              strokeDasharray={ptStale ? '2,1.5' : undefined}>
              <title>{`${e.nombre} · nivel ${(e.nivel_actual ?? 0).toFixed(2)} m${e.nivel_max_operativo ? ` / bordo ${e.nivel_max_operativo.toFixed(2)} m` : ''} · ${age === null ? 'sin lectura' : age < 60 ? `hace ${Math.round(age)} min` : `hace ${(age / 60).toFixed(1)} h`}`}</title>
            </circle>
            {/* Brillo especular — solo en vivo */}
            {!ptStale && <circle cx={x - 1.5} cy={y - 1.8} r={1.5} fill="rgba(255,255,255,0.55)" />}
            {/* Etiqueta de valor — pastilla de fondo para legibilidad */}
            <g>
              <rect x={x - 13} y={lY - 8} width={26} height={11} rx={3}
                fill="#0a1426" opacity="0.78" />
              <text x={x} y={lY} fill={col} fontSize="9" textAnchor="middle"
                fontFamily="monospace" fontWeight="bold" letterSpacing="-0.3">
                {(e.nivel_actual ?? 0).toFixed(2)}
              </text>
            </g>
            {/* Tendencia */}
            <text x={x + 15} y={lY} fill={tColor} fontSize="8" textAnchor="start" fontFamily="monospace">
              {symbol}
            </text>
          </g>
        );
      })}

      {/* Indicador de dirección de flujo — eje superior */}
      {pts.length >= 2 && (
        <g opacity="0.5">
          <text x={PAD_L} y={PAD_T - 6} fill="#475569" fontSize="6.5"
            fontFamily="monospace" fontWeight="bold" letterSpacing="0.5">K-0 ENTRADA</text>
          <text x={PAD_L + plotW} y={PAD_T - 6} fill="#475569" fontSize="6.5"
            textAnchor="end" fontFamily="monospace" fontWeight="bold" letterSpacing="0.5">K-104 SALIDA →</text>
        </g>
      )}

      {/* Badge de frescura de telemetría — centrado arriba */}
      {pts.length >= 2 && (() => {
        const cx = PAD_L + plotW / 2;
        const live = !perfilStale;
        const fill = live ? '#22c55e' : '#64748b';
        const label = live ? `EN VIVO · ${edadTxt}` : `PERFIL HISTÓRICO · ${edadTxt}`;
        const bw = label.length * 4.2 + 18;
        return (
          <g>
            <rect x={cx - bw / 2} y={PAD_T - 11} width={bw} height={11} rx={5.5}
              fill={live ? 'rgba(34,197,94,0.12)' : 'rgba(100,116,139,0.14)'}
              stroke={live ? 'rgba(34,197,94,0.4)' : 'rgba(100,116,139,0.35)'} strokeWidth="0.6" />
            <circle cx={cx - bw / 2 + 8} cy={PAD_T - 5.5} r={2} fill={fill}>
              {live && <animate attributeName="opacity" values="1;0.3;1" dur="1.8s" repeatCount="indefinite" />}
            </circle>
            <text x={cx + 4} y={PAD_T - 2.5} fill={fill} fontSize="6.5"
              textAnchor="middle" fontFamily="monospace" fontWeight="bold" letterSpacing="0.3">
              {label}
            </text>
          </g>
        );
      })()}

      {/* Vignette del lienzo (profundidad) */}
      <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill="url(#cpVignette)" pointerEvents="none" />
    </svg>
  );
});

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
    const [dockTab, setDockTab] = useState<'resumen' | 'canal' | 'alertas' | 'skill' | 'tendencias'>('resumen');

    // ── Pestaña TENDENCIAS: rango, granularidad y series históricas ──────────
    const hoyISO = new Date().toISOString().slice(0, 10);
    const hace7 = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const [tndDesde, setTndDesde] = useState(hace7);
    const [tndHasta, setTndHasta] = useState(hoyISO);
    const [tndGran, setTndGran] = useState<'diaria' | 'lectura'>('diaria');
    const [tndLoading, setTndLoading] = useState(false);
    const [tndData, setTndData] = useState<{
        niveles: SerieEscala[]; volTramos: SerieTramo[]; volTotal: SeriePunto[];
        compuertas: SerieCompuerta[]; gasto: SerieGasto;
    }>({ niveles: [], volTramos: [], volTotal: [], compuertas: [], gasto: { entrada: [], salida: [], entregas: [], perdidas: [] } });
    // Callback estable: TendenciasPanel está memoizado; una arrow inline aquí
    // invalidaría el memo en cada render del monitor (reloj de 60 s, mapa, etc.).
    const onTndRango = useCallback((d: string, h: string) => { setTndDesde(d); setTndHasta(h); }, []);
    const [snapshotCopied, setSnapshotCopied] = useState(false);
    const [showSkillInforme, setShowSkillInforme] = useState(false);
    const [modelQ0, setModelQ0] = useState('');
    const [modelResult, setModelResult] = useState<null | { q104: number; qZonas: number; perdidasLin: number; ef: number; transitH: number }>(null);
    const [isPredictionVisible, setIsPredictionVisible] = useState(false);
    const [showPerfilModal, setShowPerfilModal] = useState(false);
    const [fgvData, setFgvData] = useState<any>(null);
    const [fgvLoading, setFgvLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [currentTime, setCurrentTime] = useState(() => Date.now());
    const [anchorTimes, setAnchorTimes] = useState<Record<number, string>>({});
    const [activeAlertas, setActiveAlertas] = useState<Pick<RegistroAlertaRow, 'id' | 'tipo_riesgo' | 'titulo' | 'mensaje' | 'fecha_deteccion'>[]>([]);
    const [volInterescalas, setVolInterescalas] = useState<any[]>([]);
    const [volZonas, setVolZonas] = useState<any[]>([]);
    const [tomasActivas, setTomasActivas] = useState<any[]>([]);
    const [balanceModulos, setBalanceModulos] = useState<any[]>([]);
    const [entregasHoy, setEntregasHoy] = useState<any[]>([]);
    const [balanceTramos, setBalanceTramos] = useState<any[]>([]);
    const [flowAtZero, setFlowAtZero] = useState<number>(0);
    // Aggregate all zones per module: DOTAC from primary, consumption summed across ALL zones
    const modulosResumen = useMemo(() => {
        const byMod = new Map<string, any>();
        for (const b of balanceModulos) {
            if (!byMod.has(b.modulo_id)) {
                byMod.set(b.modulo_id, {
                    modulo_id: b.modulo_id,
                    modulo_nombre: b.modulo_nombre,
                    codigo_corto: b.codigo_corto,
                    zona_codigo: '',
                    vol_base_m3: 0,
                    vol_base_consumido_m3: 0,
                    vol_adicional_consumido_m3: 0,
                });
            }
            const m = byMod.get(b.modulo_id)!;
            if (b.es_primaria) {
                m.zona_codigo = b.zona_codigo;
                m.vol_base_m3 = b.vol_base_m3 ?? 0;
            }
            m.vol_base_consumido_m3 += b.vol_base_consumido_m3 ?? 0;
            m.vol_adicional_consumido_m3 += b.vol_adicional_consumido_m3 ?? 0;
        }
        return Array.from(byMod.values()).map(m => ({
            ...m,
            vol_base_disponible_m3: m.vol_base_m3 - m.vol_base_consumido_m3,
            pct_base_consumido: m.vol_base_m3 > 0 ? (m.vol_base_consumido_m3 / m.vol_base_m3 * 100) : 0,
            estado_volumen: m.vol_base_m3 > 0
                ? m.vol_base_consumido_m3 >= m.vol_base_m3 ? 'base_agotado'
                  : m.vol_base_consumido_m3 >= m.vol_base_m3 * 0.85 ? 'alerta_base'
                  : 'normal'
                : 'normal',
        }));
    }, [balanceModulos]);

    // 0. Update internal clock for reactive calculations
    // 60 s (antes 15 s): cada tick re-renderiza TODO el árbol (mapa Leaflet, paneles,
    // SVGs) y recalcula ~5 useMemo pesados. La UI muestra edades con precisión de
    // minutos ("hace 5h 1m"), así que 15 s eran 4× re-renders sin beneficio visible.
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(Date.now()), 60_000);
        return () => clearInterval(timer);
    }, []);

    // 0b. TENDENCIAS: carga histórica por rango+granularidad (solo con la pestaña activa)
    useEffect(() => {
        if (dockTab !== 'tendencias') return;
        let cancel = false;
        const cargar = async () => {
            setTndLoading(true);
            try {
                // Paginación con .range(): la API REST de Supabase corta a 1000 filas
                // POR PETICIÓN, ignorando .limit() mayores. Un rango amplio (mar–jul)
                // supera ese tope; sin paginar, .order desc dejaba fuera marzo/abril.
                const PAGE = 1000;
                const fetchAll = async <T,>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> => {
                    const acc: T[] = [];
                    for (let from = 0; ; from += PAGE) {
                        const { data } = await build(from, from + PAGE - 1);
                        const rows = data || [];
                        acc.push(...rows);
                        if (rows.length < PAGE) break;   // última página
                    }
                    return acc;
                };

                const [escRes, tramoRes] = await Promise.all([
                    supabase.from('escalas').select('id, nombre, km, nivel_max_operativo').order('km'),
                    supabase.from('vol_interescalas').select('esc_up_id, esc_up, km_up, esc_down_id, esc_down, km_down, longitud_km, ancho_canal_m, vol_m3, nivel_up_m, nivel_down_m'),
                ]);
                const escalasGeom = (escRes.data || []) as { id: string; nombre: string; km: number; nivel_max_operativo: number | null }[];
                const tramos = (tramoRes.data || []) as TramoGeom[];

                // Lecturas de campo (nivel ↑↓, compuertas, gasto) — paginado, filtra autogeneradas
                const lecRaw = await fetchAll<TndLectura & { responsable?: string; notas?: string }>((from, to) =>
                    supabase.from('lecturas_escalas')
                        .select('escala_id, fecha, hora_lectura, nivel_m, nivel_abajo_m, gasto_calculado_m3s, gasto_metodo, radiales_json, creado_en, responsable, notas')
                        .gte('fecha', tndDesde).lte('fecha', tndHasta)
                        .order('creado_en', { ascending: true }).range(from, to));
                const lecturas = lecRaw
                    .filter(r => !/chronos|autogenerad|medianoche/i.test((r.responsable || '') + (r.notas || '')));

                // Resumen diario (serie de nivel por escala, paginado) + entregas
                const [resRaw, { data: entRaw }] = await Promise.all([
                    fetchAll<Record<string, unknown>>((from, to) =>
                        supabase.from('resumen_escalas_diario').select('escala_id, fecha, lectura_am, hora_am, lectura_pm, hora_pm, nivel_actual')
                            .gte('fecha', tndDesde).lte('fecha', tndHasta).order('fecha', { ascending: true }).range(from, to)),
                    supabase.from('entregas_modulo').select('modulo_id, zona_id, tipo_entrega, gasto_m3s, fecha')
                        .gte('fecha', tndDesde).lte('fecha', tndHasta).gt('gasto_m3s', 0),
                ]);
                const resumen: TndResumen[] = resRaw.map((r: Record<string, unknown>) => ({
                    escala_id: r.escala_id as string, fecha: r.fecha as string,
                    nivel_am: (r.lectura_am as number) ?? null, nivel_pm: (r.lectura_pm as number) ?? null,
                    nivel_actual: (r.nivel_actual as number) ?? null,
                }));
                const entregas = (entRaw || []) as TndEntrega[];

                // Series
                const niveles = tndGran === 'diaria'
                    ? serieNivelesDiaria(resumen, escalasGeom)
                    : serieNivelesLectura(lecturas, escalasGeom);
                const { idx, fechas } = indiceNivelesDiario(resumen);
                const { series: volTramos, totalPorFecha: volTotal } = serieVolumenTramos(tramos, idx, fechas);
                const compuertas = serieCompuertas(lecturas, escalasGeom);
                const gasto = serieGasto(lecturas, escalasGeom, entregas, fechas.length ? fechas : [tndHasta]);

                if (!cancel) setTndData({ niveles, volTramos, volTotal, compuertas, gasto });
            } catch (e) {
                if (!cancel) toast.error('No se pudo cargar el histórico de tendencias');
                console.error('[TENDENCIAS]', e);
            } finally {
                if (!cancel) setTndLoading(false);
            }
        };
        cargar();
        return () => { cancel = true; };
    }, [dockTab, tndDesde, tndHasta, tndGran]);


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

            // ── RPC agregada fn_monitor_snapshot: 1 request en vez de 6 ──────
            // Feature-detect con caché de sesión: si la función aún no existe en
            // la BD (migración 20260709100000 pendiente de aplicar), se marca 'no'
            // y NO se vuelve a intentar en esta sesión → fallback sin costo extra.
            let escData: any[] | null | undefined, pData: any[] | null | undefined,
                summaryDelta: any[] | null | undefined, readings: any[] | null | undefined,
                mData: any[] | null | undefined, trackResult: { data: any } = { data: null };
            let usedRpc = false;
            if (sessionStorage.getItem('rpc_monitor_snapshot') !== 'no') {
                const { data: snap, error: rpcErr } = await supabase.rpc('fn_monitor_snapshot', {
                    p_event_start: eventStart,
                    p_evento_id: (isLlenado && activeEvent?.id) ? activeEvent.id : null,
                });
                if (!rpcErr && snap) {
                    usedRpc = true;
                    escData      = snap.escalas;
                    pData        = snap.lecturas_presas;
                    summaryDelta = snap.resumen_delta;
                    readings     = snap.lecturas_escalas;
                    mData        = snap.movimientos;
                    trackResult  = { data: snap.llenado_seguimiento };
                } else {
                    sessionStorage.setItem('rpc_monitor_snapshot', 'no');
                }
            }

            if (!usedRpc) {
            const [
                { data: escData2 },
                { data: pData2 },
                { data: summaryDelta2 },
                { data: readings2 },
                { data: mData2 },
                trackResult2,
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
                    .select('escala_id, nivel_m, nivel_abajo_m, fecha, hora_lectura, apertura_radiales_m, radiales_json, gasto_calculado_m3s, gasto_metodo, creado_en')
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
            escData = escData2; pData = pData2; summaryDelta = summaryDelta2;
            readings = readings2; mData = mData2; trackResult = trackResult2;
            } // fin fallback sin RPC

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

            // delta_12h map (Histórico en DB)
            const deltaMap = new Map<string, number>();
            (summaryDelta || []).forEach((r: any) => {
                if (r.delta_12h != null) deltaMap.set(r.escala_id, r.delta_12h);
            });

            // Darle vida inmediata a la tendencia: Live Delta inyectado en RAM sin costo DB.
            // Extraemos la diferencia entre el registro número 1 y el número 2 de las lecturas recientes
            const latestLevels = new Map<string, number>();
            const liveDeltaMap = new Map<string, number>();
            (readings || []).forEach((r: any) => {
                if (!latestLevels.has(r.escala_id)) {
                    latestLevels.set(r.escala_id, r.nivel_m);
                } else if (!liveDeltaMap.has(r.escala_id)) {
                    const currentLevel = latestLevels.get(r.escala_id)!;
                    const prevLevel = r.nivel_m;
                    liveDeltaMap.set(r.escala_id, currentLevel - prevLevel);
                }
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
                            const esc = escData?.find(e => e.id === r.escala_id);
                            // Si el operador eligió curva nivel-gasto (robusta ante compuertas
                            // taponadas), respetar ese valor en vez de recalcular con la fórmula
                            // de orificio/radiales, que sobreestima cuando hay azolve.
                            const gasto_recalc = r.gasto_metodo === 'curva_nivel'
                                ? (r.gasto_calculado_m3s || 0)
                                : esc?.pzas_radiales
                                ? calcRadialFlow(
                                    r.nivel_m,
                                    r.nivel_abajo_m || 0,
                                    r.radiales_json,
                                    esc.ancho,
                                    esc.pzas_radiales,
                                    esc.nombre,
                                    esc.km
                                  )
                                : (r.gasto_calculado_m3s || 0);
                            const entry = {
                                nivel: r.nivel_m,
                                nivel_abajo: r.nivel_abajo_m || 0,
                                hora: r.hora_lectura,
                                fecha: r.fecha,
                                timestamp: readingTime,
                                apertura: r.apertura_radiales_m || 0,
                                radiales_json: r.radiales_json,
                                gasto_real: gasto_recalc
                            };
                            readingsMap.set(r.escala_id, entry);

                            // Track specifically the latest KM 0 to show in header/alerts
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
                        const manualReadingTime = new Date(`${r.fecha}T${r.hora_lectura}-06:00`).getTime();
                        const esc = escData?.find(e => e.id === r.escala_id);
                        const gasto_recalc = r.gasto_metodo === 'curva_nivel'
                            ? (r.gasto_calculado_m3s || 0)
                            : esc?.pzas_radiales
                            ? calcRadialFlow(
                                r.nivel_m,
                                r.nivel_abajo_m || 0,
                                r.radiales_json,
                                esc.ancho,
                                esc.pzas_radiales,
                                esc.nombre,
                                esc.km
                              )
                            : (r.gasto_calculado_m3s || 0);
                        readingsMap.set(r.escala_id, {
                            nivel:        r.nivel_m,
                            nivel_abajo:  r.nivel_abajo_m  || 0,
                            hora:         r.hora_lectura,
                            fecha:        r.fecha,
                            timestamp:    manualReadingTime,
                            apertura:     r.apertura_radiales_m || 0,
                            radiales_json: r.radiales_json,
                            gasto_real:   gasto_recalc,
                        });
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

                // ── Coherencia física: solo contra capacidad de diseño ────────
                // No comparar vs gasto de presa: el canal puede evacuar volumen
                // almacenado en el tramo Boquilla→K0 (36km), produciendo Q_k0 > Q_presa.
                const gastoFinal: number | null = reading?.gasto_real ?? null;

                return {
                    ...e,
                    nivel_actual:          nivel,
                    nivel_abajo:           reading?.nivel_abajo ?? null,
                    gasto_actual:          gastoFinal,
                    apertura_actual:       aperturaFinal,
                    puertas_abiertas:      puertasAbiertas > 0 ? puertasAbiertas : undefined,
                    nivel_max_operativo:   (e as any).nivel_max_operativo ?? null,
                    capacidad_max:         (e as any).capacidad_max       ?? null,
                    delta_12h:             (liveDeltaMap.has(e.id) && liveDeltaMap.get(e.id) !== 0) ? liveDeltaMap.get(e.id) : (deltaMap.get(e.id) ?? null),
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
                    // Date.now() directo (no currentTime): currentTime cambia cada tick del
                    // reloj y, como dependencia de este useCallback, hacía que fetchData
                    // cambiara de identidad en cada tick → el useEffect de suscripciones
                    // destruía/recreaba 4 canales Realtime y RE-EJECUTABA el batch completo
                    // de queries cada 15 s (≈15× el tráfico diseñado de 5 min).
                    ultima_telemetria: extraccionReal > 0 ? new Date(presaReading!.fecha).getTime() : Date.now(),
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
                // Usa calcRadialFlow con M1 y radiales_json individuales (igual que path principal)
                currentFlowAtZero = calcRadialFlow(
                    zeroReading.nivel || 0,
                    zeroReading.nivel_abajo || 0,
                    zeroReading.radiales_json,
                    ancho,
                    pzas,
                    k0Phys?.nombre,
                    0
                );
            }

            // Sin check vs presa — K0 puede superar Q_presa por almacenamiento en tramo 36km
            const hasViolation = currentFlowAtZero > 70.42;
            
            sessionStorage.setItem('zero_radial_apertura', (zeroReading?.apertura || 0).toString());
            sessionStorage.setItem('zero_nivel_abajo', (zeroReading?.nivel_abajo || 0).toString());
            sessionStorage.setItem('zero_nivel_arriba', (zeroReading?.nivel || 0).toString());
            sessionStorage.setItem('has_hydraulic_violation', hasViolation ? 'true' : 'false');
            sessionStorage.setItem('k0_pzas', pzas.toString());
            sessionStorage.setItem('k0_ancho', ancho.toString());
            setFlowAtZero(currentFlowAtZero);
            
        } catch (err) {
            console.error("PublicMonitor fetch error", err);
        }
    }, [activeEvent]);

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

    // ── Alertas activas — últimas 5, con toast Realtime para críticas ────
    useEffect(() => {
        const fetchAlertas = async () => {
            const { data } = await supabase
                .from('registro_alertas')
                .select('id, tipo_riesgo, titulo, mensaje, fecha_deteccion')
                .eq('resuelta', false)
                .order('fecha_deteccion', { ascending: false })
                .limit(5);
            if (data) setActiveAlertas(data as any);
        };
        fetchAlertas();

        const unsubAlertas = onTable('registro_alertas', 'INSERT', (payload) => {
            fetchAlertas();
            const row = payload.new as RegistroAlertaRow;
            if (row?.tipo_riesgo === 'critical') {
                toast.error(`🚨 ${row.titulo}`, {
                    description: row.mensaje?.slice(0, 120),
                    duration: 8000,
                });
            } else if (row?.tipo_riesgo === 'warning') {
                toast.warning(`⚠️ ${row.titulo}`, {
                    description: row.mensaje?.slice(0, 120),
                    duration: 6000,
                });
            }
        });

        return () => unsubAlertas();
    }, []);

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

        // Modelo A: v = 5.3 × Q^0.15 km/h (calibrado campo 23/04/2026)
        const qK0vis = escalas.find(e => e.km === 0)?.gasto_actual ?? 20;
        const vCanal = activeEvent?.evento_tipo === 'LLENADO'
            ? 5.3 * Math.pow(Math.max(qK0vis, 0.5), 0.15)
            : vCanalDefault;

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

    // Segmento del canal que aún no ha sido alcanzado por el frente de ola (LLENADO).
    // Se renderiza como trazo punteado oscuro para indicar el tramo por recorrer.
    const dryPath = useMemo(() => {
        if (!activeEvent || activeEvent.evento_tipo !== 'LLENADO') return [];
        const fromKm = Math.max(0, displayMaxKm);
        return canalDistData
            .filter(d => d.dist >= fromKm)
            .map(d => [d.lat, d.lng] as [number, number]);
    }, [activeEvent, canalDistData, displayMaxKm]);
    
    // Position for the Pulse Marker
    const frontCoords = useMemo(() => {
        if (hydratedPath.length === 0) return [27.545, -105.414]; // Presa approx start
        const last = hydratedPath[hydratedPath.length - 1];
        if (!last || typeof last[0] !== 'number' || typeof last[1] !== 'number') return [27.545, -105.414];
        return last;
    }, [hydratedPath]);

    // ── MODO DE VISUALIZACIÓN — discriminante explícito por tipo de evento ──
    // Reemplaza la condición binaria LLENADO / !LLENADO. Cada modo tiene
    // identidad propia: etiqueta pública, color semáforo e ícono de cabecera.
    type ModoVisualizacion = 'LLENADO' | 'ESTABILIZACION' | 'CONTINGENCIA' | 'VACIADO' | 'ANOMALIA' | 'SIN_EVENTO';

    const MODO_CONFIG: Record<ModoVisualizacion, { label: string; color: string; kpi0Label: string }> = {
        LLENADO:        { label: 'LLENADO EN TRÁNSITO',   color: '#06b6d4', kpi0Label: 'ENTREGA KM 0:' },
        ESTABILIZACION: { label: 'DISTRIBUCIÓN ACTIVA',   color: '#22c55e', kpi0Label: 'FLUJO K0+000:' },
        CONTINGENCIA:   { label: 'CONTINGENCIA — LLUVIA', color: '#f59e0b', kpi0Label: 'FLUJO K0+000:' },
        VACIADO:        { label: 'VACIADO CONTROLADO',    color: '#a855f7', kpi0Label: 'FLUJO K0+000:' },
        ANOMALIA:       { label: 'ANOMALÍA DETECTADA',    color: '#ef4444', kpi0Label: 'FLUJO K0+000:' },
        SIN_EVENTO:     { label: 'MONITOREO CONTINUO',    color: '#22c55e', kpi0Label: 'FLUJO K0+000:' },
    };

    const modoVisualizacion: ModoVisualizacion = !activeEvent
        ? 'SIN_EVENTO'
        : activeEvent.evento_tipo === 'LLENADO'             ? 'LLENADO'
        : activeEvent.evento_tipo === 'ESTABILIZACION'      ? 'ESTABILIZACION'
        : activeEvent.evento_tipo === 'CONTINGENCIA_LLUVIA' ? 'CONTINGENCIA'
        : activeEvent.evento_tipo === 'VACIADO'             ? 'VACIADO'
        : 'ANOMALIA';

    const modoActual = MODO_CONFIG[modoVisualizacion];
    const protocolLabel = modoActual.label;
    const statusColor   = modoActual.color;

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

        // Modelo A — celeridad dinámica calibrada campo 23/04/2026
        // v_onda = 5.3 × Q^0.15 km/h  (error histórico ±12% en K-23, K-104)
        // ESTABILIZACIÓN: mantiene 1.16 m/s (velocidad media Manning observada)
        const qK0 = escalas.find(e => e.km === 0)?.gasto_actual ?? 20;
        const vCanalKmh = activeEvent?.evento_tipo === 'LLENADO'
            ? 5.3 * Math.pow(Math.max(qK0, 0.5), 0.15)
            : 1.16 * 3.6;

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
            status: "AVANCE EN CANAL",
            vOndaKmh: +vCanalKmh.toFixed(1),
            qK0Usado: +qK0.toFixed(1),
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
        // Solo lecturas de gasto FRESCAS (<4 h). Una lectura vencida no debe
        // alimentar eficiencia/pérdidas/IEC y presentarse como estado en vivo
        // (mismo criterio que el panel SKILL y el perfil hidráulico).
        const STALE_MIN = 240;
        const esFresco = (e: EscalaData) =>
            e.ultima_telemetria != null && (Date.now() - e.ultima_telemetria) / 60000 <= STALE_MIN;
        const escOrdenadas = [...escalas]
            .filter(e => e.km >= 0 && e.km <= 104 && e.gasto_actual !== null && (e.gasto_actual ?? 0) > 0 && esFresco(e))
            .sort((a, b) => a.km - b.km);

        if (escOrdenadas.length === 0) return null;

        // Pérdida esperada en río (36 km): ~2-5% por km ≈ 8% total
        const qK0Esperado = qPresa * 0.92;
        const escK0   = escOrdenadas.find(e => e.km === 0);
        const escK104 = escOrdenadas.find(e => e.km >= 104);
        // qK0Medido = SOLO el gasto real de K-0. Si K-0 no tiene lectura fresca,
        // NO sustituir por escOrdenadas[0]: ese fallback rotulaba el caudal de
        // otra escala (la primera fresca) como "K0+000" → la cadena PANORAMA
        // mostraba 9.9 mientras la tarjeta de K-0 mostraba su valor real 21.6.
        const k0Disponible = !!escK0;
        const qK0Medido = escK0?.gasto_actual ?? 0;

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
        // qFinal = caudal de salida REAL. Si no hay lectura fresca en K-104, no
        // existe "salida del canal" medida; usamos el último punto disponible
        // pero marcamos el tramo como parcial para no llamarlo eficiencia total.
        const ultimo      = escOrdenadas[escOrdenadas.length - 1];
        const qFinal      = ultimo?.gasto_actual ?? 0;
        const tramoCompleto = !!escK0 && !!escK104;   // ¿K-0 y K-104 ambos medidos?
        // Eficiencia de conducción SOLO válida de extremo a extremo (K-0→K-104).
        // Antes: qFinal/qK0 con un solo punto daba 100% imposible presentado como real.
        const eficiencia  = (tramoCompleto && qK0Medido > 0) ? (qFinal / qK0Medido) * 100 : null;
        const perdidaRio  = (escK0 && qPresa > 0) ? qPresa - qK0Medido : null;
        const perdidaCanal = (tramoCompleto && qK0Medido > 0) ? qK0Medido - qFinal : null;

        return {
            qPresa,
            qK0Esperado,
            qK0Medido,
            k0Disponible,
            qFinal,
            tramoCompleto,
            kmFinal: ultimo?.km ?? null,
            eficiencia,
            perdidaRio,
            perdidaCanal,
            puntos,
            nCoherentes,
            totalPuntos: puntos.length,
        };
    }, [activeEvent, damMovements, presasData, escalas, currentTime]);

    // isEstabilizacion: true para ESTABILIZACION y SIN_EVENTO (comportamiento visual idéntico).
    // No incluye CONTINGENCIA/VACIADO/ANOMALIA — esos modos conservan el mapa de alertas
    // pero podrán tener su propia capa de indicadores en futuras iteraciones.
    const isEstabilizacion = modoVisualizacion === 'ESTABILIZACION'
                          || modoVisualizacion === 'SIN_EVENTO'
                          || modoVisualizacion === 'CONTINGENCIA'
                          || modoVisualizacion === 'VACIADO'
                          || modoVisualizacion === 'ANOMALIA';

    // ── IEC — Índice de Estado del Canal ─────────────────────────────────────
    const iecData = useMemo(() => {
        if (!coherenciaCanal || !isEstabilizacion) return null;
        // El IEC pondera la eficiencia de conducción (30/100 pts). Sin medición
        // extremo a extremo (K-0→K-104 frescos) esa eficiencia es null; calcular
        // el IEC con eficiencia=0 daría un puntaje artificialmente bajo presentado
        // como real. En ese caso no publicamos IEC (el badge simplemente no aparece).
        if (coherenciaCanal.eficiencia === null) return null;
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

    // ── Skill Snapshot — datos actuales para extracción por Claude ───────────
    // Se recalcula cada vez que `escalas` cambia (suscripción Realtime activa).
    // Fetch vol_interescalas, vol_zonas y tomas activas — refresco cada 5 min
    useEffect(() => {
        const fetchVolumetria = async () => {
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chihuahua' }).format(new Date());
            const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chihuahua' })
                .format(new Date(Date.now() - 86_400_000));
            const [viRes, vzRes, tomasRes, bmRes, ehRes] = await Promise.all([
                supabase.from('vol_interescalas')
                    .select('esc_up, km_up, esc_down, km_down, longitud_km, nivel_up_m, nivel_down_m, nivel_ini_m, nivel_fin_m, ancho_canal_m, vol_m3, vol_mm3')
                    .order('km_up', { ascending: true }),
                supabase.from('vol_zonas')
                    .select('codigo, zona_nombre, km_inicio, km_fin, n_tramos, nivel_medio_m, tirante_diseno_m, bordo_libre_m, y_capacidad_m, vol_actual_m3, vol_actual_mm3, vol_diseno_m3, vol_capacidad_m3, pct_llenado')
                    .order('km_inicio', { ascending: true }),
                supabase.from('reportes_operacion')
                    .select('*, puntos_entrega(nombre, km)')
                    .eq('fecha', today)
                    .in('estado', ['inicio', 'continua', 'reabierto', 'modificacion']),
                supabase.from('balance_volumen_modulo')
                    .select('modulo_id, modulo_nombre, codigo_corto, zona_id, zona_codigo, zona_nombre, es_primaria, ciclo_id, vol_base_m3, vol_base_consumido_m3, vol_adicional_consumido_m3, vol_total_consumido_m3, vol_base_disponible_m3, pct_base_consumido, estado_volumen, ultimo_adicional_fecha')
                    .order('modulo_id', { ascending: true }),
                // Igual que sica-capture Monitor: fecha >= ayer, gasto > 0, orden desc → deduplicar más reciente
                supabase.from('entregas_modulo')
                    .select('modulo_id, zona_id, tipo_entrega, gasto_lps, gasto_m3s, volumen_m3, hora_inicio, hora_fin, estado_operativo, motivo_adicional, fecha')
                    .gte('fecha', yesterday)
                    .gt('gasto_m3s', 0)
                    .order('fecha', { ascending: false }),
            ]);
            if (!viRes.error)    setVolInterescalas(viRes.data  || []);
            if (!vzRes.error)    setVolZonas(vzRes.data         || []);
            if (!tomasRes.error) setTomasActivas(tomasRes.data  || []);
            if (!bmRes.error)    setBalanceModulos(bmRes.data   || []);
            if (!ehRes.error) {
                // Deduplicar: más reciente por modulo_id + zona_id + tipo_entrega
                const latestMap = new Map<string, any>();
                for (const e of (ehRes.data || [])) {
                    const key = `${e.modulo_id}_${e.zona_id ?? ''}_${e.tipo_entrega}`;
                    if (!latestMap.has(key)) latestMap.set(key, e);
                }
                setEntregasHoy(Array.from(latestMap.values()));
            }

            // Balance hidrico por tramo — detecta fugas y extracciones no registradas
            const btRes = await supabase.rpc('fn_balance_hidrico_tramos', { p_fecha: today });
            if (!btRes.error) setBalanceTramos(btRes.data || []);

        };
        fetchVolumetria();
        const interval = setInterval(fetchVolumetria, 5 * 60 * 1000);
        // Refrescar también cuando llega una nueva lectura de escala (misma fuente que vol_interescalas)
        const unsubVol = onTable('lecturas_escalas', 'INSERT', fetchVolumetria);
        return () => { clearInterval(interval); unsubVol(); };
    }, []);

    const skillSnapshot = useMemo(() => {
        // ── DOS conceptos de "zona" distintos — no confundirlos ──────────────
        //  1) VOLUMEN almacenado: límites geométricos de zonas_canal (vía vol_zonas):
        //     Z1 0–48.42, Z2 48.42–67.32, Z3 67.32–71.91, Z4 79.025–104.
        //     Esas fronteras NO caen en escalas → no sirven para diferencial de Q.
        //  2) Q EXTRAÍDO por zona: escalas de control de extracción (skill v3.7):
        //     Z1 K-23→K-29, Z2 K-34→K-44, Z3 K-54→K-68, Z4 K-79+025→K-94+057.
        //     El caudal de zona = Q_entrada − Q_salida entre ese par de escalas.
        // Antes se mezclaban: se buscaba escala en los km de zonas_canal (48.42…),
        // que nunca existe → q_real siempre null → balance nunca válido.
        // Solo usar Q de una escala si su telemetría es reciente (<4h = 240 min).
        // Si está FUERA_DE_LINEA/CRITICO, tratar como null para no contaminar el balance.
        const MAX_STALE_MIN = 240;
        const escalaFresh = (km: number) => {
            const e = escalas.find(e => Math.abs(e.km - km) < 0.5);
            if (!e || !e.ultima_telemetria) return null;
            const mins = (Date.now() - e.ultima_telemetria) / 60000;
            return mins <= MAX_STALE_MIN ? e : null;
        };
        // Último dato CONOCIDO de una escala, sin filtro de frescura. Devuelve el
        // gasto medido y su antigüedad (min) para mostrarlo como "histórico" cuando
        // la lectura fresca no existe — referencia atenuada, no medición en vivo.
        const escalaUlt = (km: number): { gasto: number; ageMin: number } | null => {
            const e = escalas.find(e => Math.abs(e.km - km) < 0.5);
            if (!e || !e.ultima_telemetria || (e.gasto_actual ?? 0) <= 0) return null;
            return { gasto: e.gasto_actual as number, ageMin: (Date.now() - e.ultima_telemetria) / 60000 };
        };
        const ZONAS_CONTROL = [
            { codigo: 'Z1', km_in: 23,     km_out: 29,     q_obj: 2.400 },
            { codigo: 'Z2', km_in: 34,     km_out: 44,     q_obj: 2.750 },
            { codigo: 'Z3', km_in: 54,     km_out: 68,     q_obj: 4.635 },
            { codigo: 'Z4', km_in: 79.025, km_out: 94.057, q_obj: 4.200 },
        ];
        // ── Q EXTRAÍDO POR ZONA = Σ ENTREGAS reales a usuarios ──────────────────
        // FUENTE CORRECTA: la extracción de una zona es el agua ENTREGADA a sus
        // módulos (entregas_modulo, base+adicional), capturada en campo.
        //
        // NO usar el diferencial entre escalas (Q_in − Q_out): ese diferencial
        // incluye las FUGAS del tramo (azolve, infiltración) y NO es extracción a
        // usuarios. Sumarlo inflaba Q_zonas a ~39 m³/s (> Q0=34), dando pérdidas
        // NEGATIVAS imposibles. El diferencial ya se usa aparte como detector de
        // fugas ("FUGA ALTA"), no debe entrar al balance de extracción.
        const zonaIdToCodigo = new Map<string, string>(
            volZonas.map((v: any) => [v.zona_id as string, v.codigo as string])
        );
        const entregasPorZona = new Map<string, number>();   // codigo Zn → Q m³/s
        for (const e of entregasHoy) {
            const cod = e.zona_id ? zonaIdToCodigo.get(e.zona_id) : undefined;
            if (!cod) continue;
            entregasPorZona.set(cod, (entregasPorZona.get(cod) ?? 0) + Number(e.gasto_m3s ?? 0));
        }
        const ZONAS_SKILL = ZONAS_CONTROL.map(z => {
            // escalas de control: solo para etiquetar y para el detector de fugas,
            // NO para el Q extraído del balance.
            const escIn  = escalaFresh(z.km_in);
            const escOut = escalaFresh(z.km_out);
            // Q extraído = suma de entregas de hoy de la zona (extracción real).
            const q_ent = entregasPorZona.get(z.codigo);
            const q_real  = q_ent && q_ent > 0 ? +q_ent.toFixed(3) : null;
            const q_fuente: 'entregas' | null = q_real !== null ? 'entregas' : null;
            // Volumen/pct/nivel: de vol_zonas (BD), emparejado por código de zona.
            const vz = volZonas.find(v => v.codigo === z.codigo);
            return {
                nombre:        z.codigo,
                // km_ini/km_fin = escalas de CONTROL de Q (no las fronteras geométricas
                // de vol_zonas). escala_in/out lo dejan explícito en el snapshot.
                km_ini:        z.km_in,
                km_fin:        z.km_out,
                escala_in:     escIn?.nombre  ?? `K-${z.km_in}`,
                escala_out:    escOut?.nombre ?? `K-${z.km_out}`,
                q_objetivo:    z.q_obj,
                q_real:        q_real !== null ? +q_real.toFixed(3) : null,
                q_fuente,                          // 'entregas' | null
                q_real_stale:  q_real === null,   // true si la zona no tiene entregas hoy
                vol_mm3:       vz?.vol_actual_mm3 != null ? +Number(vz.vol_actual_mm3).toFixed(4) : null,
                pct_llenado:   vz?.pct_llenado    != null ? +Number(vz.pct_llenado).toFixed(1)    : null,
                nivel_medio_m: vz?.nivel_medio_m  != null ? +Number(vz.nivel_medio_m).toFixed(3)  : null,
                n_tramos:      vz?.n_tramos        != null ? +Number(vz.n_tramos)                  : null,
            };
        });
        const Q_ZONAS_OBJ  = ZONAS_SKILL.reduce((s, z) => s + z.q_objetivo, 0);
        // Extracciones de zona MEDIDAS: solo suma zonas con q_real real (telemetría
        // en ambas escalas frontera). Las zonas sin medición quedan fuera del balance
        // — NO se sustituyen por q_objetivo, para no mezclar caudal medido con diseño.
        const N_ZONAS_ESPERADAS = 4;   // Z1–Z4
        const zonasMedidas  = ZONAS_SKILL.filter(z => z.q_real !== null);
        const Q_ZONAS_REAL  = zonasMedidas.reduce((s, z) => s + (z.q_real ?? 0), 0);
        // Completas solo si las 4 zonas tienen Q extraído MEDIDO (ambas escalas de
        // control frescas y con gasto). Sin las 4, el balance global no es confiable.
        const zonasCompletas = zonasMedidas.length === N_ZONAS_ESPERADAS;
        const q0   = escalaFresh(0)?.gasto_actual   ?? null;   // null cuando STALE
        const q104 = escalaFresh(104)?.gasto_actual ?? null;   // null cuando STALE
        // Último dato conocido (histórico) — solo para PRESENTACIÓN cuando no hay
        // lectura fresca. Nunca entra al balance (perdidas/eficiencia/λ).
        const q0Ult   = escalaUlt(0);
        const q104Ult = escalaUlt(104);
        // El balance Q0 − Q104 − Q_zonas tiene DOS modos:
        //  • 'vivo'    : K-0, K-104 y las 4 zonas frescas (<4h). Medición confiable.
        //  • 'parcial' : K-0 fresco + 4 zonas medidas (telemetría o entregas), pero
        //                K-104 usa el último dato conocido. Es una REFERENCIA, no una
        //                medición en vivo — se marca como tal en el panel.
        // Sin K-0 fresco o sin las 4 zonas, no hay balance (todo → S/D): no podemos
        // inventar la entrada ni la mitad de las extracciones.
        const q104Bal = q104 ?? (q104Ult ? q104Ult.gasto : null);   // fresco o histórico
        const balanceValido = q0 !== null && q104 !== null && zonasCompletas;     // 'vivo'
        const balanceParcial = !balanceValido && q0 !== null && q104Bal !== null && zonasCompletas;
        const balanceModo: 'vivo' | 'parcial' | null =
            balanceValido ? 'vivo' : balanceParcial ? 'parcial' : null;
        const q104Calc = balanceValido ? q104 : (balanceParcial ? q104Bal : null);
        const perdidas   = balanceModo ? q0! - q104Calc! - Q_ZONAS_REAL : null;
        const eficiencia = (balanceModo && q0! > 0) ? (q0! - Math.max(0, perdidas!)) / q0! * 100 : null;
        // λ dinámica = null cuando no hay balance. Antes caía a 0, lo que el panel
        // mostraba como "0.00000" — un valor que se lee como "pérdidas nulas medidas"
        // cuando en realidad NO hay medición. Mantenerlo null lo deja consistente.
        const lambda     = (perdidas !== null && q0! > 0) ? perdidas / 104 : null;

        const checkpoints = escalas
            .filter(e => e.km >= 0 && e.km <= 104)
            .sort((a, b) => a.km - b.km)
            .map(e => {
                const bl = e.nivel_max_operativo ? +(e.nivel_max_operativo - (e.nivel_actual ?? 0)).toFixed(3) : null;
                const ts_min = e.ultima_telemetria ? +((Date.now() - e.ultima_telemetria) / 60000).toFixed(0) : null;
                const telEst: TelemetriaEstado = telemetriaEstado(e.ultima_telemetria);
                return {
                    nombre:          e.nombre,
                    km:              e.km,
                    hA:              +(e.nivel_actual ?? 0).toFixed(3),
                    hB:              e.nivel_abajo != null ? +e.nivel_abajo.toFixed(3) : null,
                    q:               +(e.gasto_actual  ?? 0).toFixed(3),
                    m1:              +getM1Factor(e.nombre, e.km).toFixed(4),
                    apertura:        +(e.apertura_actual ?? 0).toFixed(3),
                    puertas_abiertas: e.puertas_abiertas ?? 0,
                    nivel_max:       e.nivel_max_operativo ?? null,
                    bl,
                    alerta:          bl !== null && bl < 0 ? 'NIVEL_CRITICO' : bl !== null && bl < 0.10 ? 'PRECAUCION' : null,
                    ts_min,
                    tel_estado:      telEst,
                };
            });

        const alertas = checkpoints.filter(c => c.alerta);

        // ── Estado de telemetría agregado (para banner gerencial) ───────────
        // Clasifica el estado GLOBAL del sistema para no mostrar "EN VIVO" cuando
        // en realidad todos los valores están S/D. Distingue tres situaciones que
        // antes se confundían en un muro de "0 / S/D":
        //   • frescos  : lecturas <60 min (operación normal, datos confiables)
        //   • atrasados: lecturas 60–240 min (datos útiles pero envejeciendo)
        //   • stale    : lecturas >240 min o sin telemetría (no confiable)
        const conTel    = checkpoints.filter(c => c.ts_min !== null);
        const frescos   = conTel.filter(c => (c.ts_min ?? 0) < 60).length;
        const atrasados = conTel.filter(c => (c.ts_min ?? 0) >= 60 && (c.ts_min ?? 0) <= MAX_STALE_MIN).length;
        const stale     = checkpoints.filter(c => c.ts_min === null || (c.ts_min ?? 0) > MAX_STALE_MIN).length;
        const sinFlujo  = conTel.filter(c => c.q <= 0).length;   // nivel presente pero sin gasto
        // Edad de la lectura más reciente del sistema (min). null si nada reportó.
        const tsMin = conTel.reduce<number | null>((min, c) => {
            const t = c.ts_min ?? Infinity;
            return min === null || t < min ? t : min;
        }, null);
        // El estado GLOBAL debe reflejar la COBERTURA de frescura, no la mejor
        // lectura. Antes usaba tsMin (la escala más nueva) → mostraba "EN VIVO·2min"
        // aunque 8/14 escalas estuvieran vencidas y casi todos los tramos en S/D.
        // Ahora pondera cuántas escalas están realmente vigentes (<4h):
        //   EN_VIVO  : ≥80% vigentes y la mayoría <60 min
        //   ATRASADO : ≥50% vigentes (datos parciales pero utilizables)
        //   STALE    : <50% vigentes (como aquí: solo 6/14 → balance no confiable)
        const total       = checkpoints.length;
        const vigentes    = frescos + atrasados;                 // escalas <4h
        const pctVigentes = total > 0 ? vigentes / total : 0;
        const pctFrescos  = total > 0 ? frescos / total : 0;
        const telemetria_estado_global =
            conTel.length === 0      ? 'OFFLINE'
            : pctVigentes < 0.5      ? 'STALE'
            : pctFrescos  >= 0.8     ? 'EN_VIVO'
            : 'ATRASADO';
        const telemetria = {
            estado: telemetria_estado_global,
            total,
            vigentes,
            pct_vigentes: +(pctVigentes * 100).toFixed(0),
            frescos, atrasados, stale, sin_flujo: sinFlujo,
            edad_min_reciente: tsMin,
            balance_valido: balanceValido,
        };

        return {
            meta: {
                version:    '3.7',
                generado:   new Date().toISOString(),
                canal:      'Canal Principal Conchos',
                distrito:   'DR-005 Delicias',
                calibracion: '01/06/2026',
            },
            telemetria,
            constantes: { Cd: 0.62, Cv: 1.84, g: 9.81, Cd_gl: 1.84, n_gl: 1.52, MIN_H: 0.01, n_man: 0.015, C_ONDA: 0.80, F_ATEN: 0.27, lambda: +(lambda ?? LAMBDA_REF).toFixed(5) },
            M1_FACTORS,
            zonas: ZONAS_SKILL,
            Q_ZONAS_REAL:  +Q_ZONAS_REAL.toFixed(3),
            Q_ZONAS_TOTAL: +Q_ZONAS_OBJ.toFixed(3),
            Q_ZONAS_MEDIDAS: zonasMedidas.length,   // cuántas de las 4 zonas tienen extracción medida
            balance: {
                Q0:             q0 !== null ? +q0.toFixed(3) : null,
                Q104:           q104 !== null ? +q104.toFixed(3) : null,
                // Último dato conocido (histórico) — referencia atenuada cuando Q0/Q104
                // son null por telemetría vencida. NO entra al balance.
                Q0_hist:        q0Ult   ? +q0Ult.gasto.toFixed(3)   : null,
                Q0_age_min:     q0Ult   ? Math.round(q0Ult.ageMin)   : null,
                Q104_hist:      q104Ult ? +q104Ult.gasto.toFixed(3) : null,
                Q104_age_min:   q104Ult ? Math.round(q104Ult.ageMin) : null,
                Q_extracciones: +Q_ZONAS_REAL.toFixed(3),
                perdidas:       perdidas !== null ? +perdidas.toFixed(3) : null,
                eficiencia:     eficiencia !== null ? +eficiencia.toFixed(1) : null,
                lambda:         lambda !== null ? +lambda.toFixed(5) : null,
                balance_valido: balanceValido,
                balance_modo:   balanceModo,        // 'vivo' | 'parcial' | null
                zonas_completas: zonasCompletas,
            },
            alertas_nivel: alertas.map(c => ({ nombre: c.nombre, km: c.km, hA: c.hA, bl: c.bl, tipo: c.alerta })),
            checkpoints,
            // ── Volumetría hidráulica ──────────────────────────────────
            vol_interescalas: volInterescalas,
            vol_zonas: volZonas,
            // ── Balance dotación vs consumo por módulo ─────────────────
            modulos_balance: modulosResumen.map(b => ({
                    modulo:          b.modulo_nombre,
                    codigo:          b.codigo_corto,
                    zona:            b.zona_codigo,
                    dotacion_Mm3:    +(b.vol_base_m3 / 1e6).toFixed(3),
                    consumido_Mm3:   +(b.vol_base_consumido_m3 / 1e6).toFixed(4),
                    adicional_Mm3:   +(b.vol_adicional_consumido_m3 / 1e6).toFixed(4),
                    disponible_Mm3:  +((b.vol_base_disponible_m3 ?? 0) / 1e6).toFixed(4),
                    pct:             +(b.pct_base_consumido ?? 0).toFixed(2),
                    estado:          b.estado_volumen,
                })),
            // ── Presas estado actual ───────────────────────────────────
            presas: presasData.map(p => ({
                nombre:           p.presas?.nombre       ?? p.presas?.nombre_corto ?? '—',
                almacenamiento_mm3: +(p.almacenamiento_mm3 ?? 0).toFixed(3),
                porcentaje_llenado: +(p.porcentaje_llenado ?? 0).toFixed(1),
                extraccion_m3s:   +(p.extraccion_total_m3s ?? p.extraccion_total ?? 0).toFixed(3),
                escala_msnm:      +(p.escala_msnm ?? 0).toFixed(3),
                fecha:            p.fecha,
            })),
            // ── Tomas activas hoy ──────────────────────────────────────
            tomas_activas: tomasActivas.map(t => ({
                nombre:   t.puntos_entrega?.nombre ?? '—',
                km:       t.puntos_entrega?.km     ?? null,
                estado:   t.estado,
                caudal_ls: +(t.caudal_promedio ?? 0).toFixed(1),
                caudal_m3s: +((t.caudal_promedio ?? 0) / 1000).toFixed(4),
            })),
            // ── Entregas hoy por módulo ────────────────────────────────
            entregas_hoy: (() => {
                const seenSK = new Set<string>();
                const pairs2: { mid: string; zid: string | null }[] = [];
                for (const e of entregasHoy) {
                    const k = `${e.modulo_id}_${e.zona_id ?? ''}`;
                    if (!seenSK.has(k)) { seenSK.add(k); pairs2.push({ mid: e.modulo_id, zid: e.zona_id ?? null }); }
                }
                return pairs2.map(({ mid, zid }) => {
                    const metaPrimary = balanceModulos.find(b => b.modulo_id === mid && b.es_primaria);
                    const metaZone = balanceModulos.find(b => b.modulo_id === mid && (zid ? b.zona_id === zid : b.es_primaria)) ?? metaPrimary;
                    const base = entregasHoy.find(e => e.modulo_id === mid && (zid ? e.zona_id === zid : true) && e.tipo_entrega === 'base');
                    const adic = entregasHoy.find(e => e.modulo_id === mid && (zid ? e.zona_id === zid : true) && e.tipo_entrega === 'adicional');
                    return {
                        modulo:          metaPrimary?.modulo_nombre ?? mid,
                        codigo:          metaPrimary?.codigo_corto  ?? mid,
                        zona:            metaZone?.zona_codigo       ?? '—',
                        base_m3:         base ? +(base.volumen_m3).toFixed(2)  : null,
                        base_m3s:        base ? +(base.gasto_m3s).toFixed(4)   : null,
                        base_lps:        base ? +(base.gasto_lps).toFixed(2)   : null,
                        base_horario:    base ? `${base.hora_inicio ?? '—'}–${base.hora_fin ?? '—'}` : null,
                        adic_m3:         adic ? +(adic.volumen_m3).toFixed(2)  : null,
                        adic_m3s:        adic ? +(adic.gasto_m3s).toFixed(4)   : null,
                        adic_lps:        adic ? +(adic.gasto_lps).toFixed(2)   : null,
                        motivo:          adic?.motivo_adicional ?? null,
                        total_m3:        +((base?.volumen_m3 ?? 0) + (adic?.volumen_m3 ?? 0)).toFixed(2),
                    };
                });
            })(),
            evento_activo: activeEvent ? {
                id:              activeEvent.id,
                tipo:            activeEvent.evento_tipo,
                fecha_inicio:    activeEvent.fecha_inicio,
                gasto_solicitado: activeEvent.gasto_solicitado_m3s ?? null,
                hora_apertura:   activeEvent.hora_apertura_real ?? null,
                autorizado_por:  activeEvent.autorizado_por ?? null,
                notas:           activeEvent.notas ?? null,
            } : null,
            timestamp: new Date().toISOString(),
        };
    }, [escalas, volInterescalas, volZonas, balanceModulos, entregasHoy, presasData, tomasActivas, activeEvent]);

    // Cerrar el modal de perfil con Escape (accesibilidad de teclado)
    useEffect(() => {
        if (!showPerfilModal) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowPerfilModal(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [showPerfilModal]);

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
        // Las abstracciones abruptas causan divergencia matemática (Picos) en la Ecuación de Energía
        // al integrar flujos subcríticos hacia aguas abajo sin incluir estructuras de control (radiales).
        // Por ello, en el Monitor Público enviamos un canal libre teórico.
        const tomas: any[] = [];

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

    // Tag de estado de telemetría reutilizable — única fuente de verdad para
    // todas las pestañas del dock (RESUMEN/CANAL/ALERTAS/SKILL). Antes cada
    // pestaña mostraba un "● EN VIVO / MONITOREO TOTAL ACTIVO" fijo que
    // contradecía el estado real cuando la telemetría estaba vencida.
    const renderStateTag = (liveLabel?: string) => {
        const t = skillSnapshot.telemetria;
        const cfg =
            t.estado === 'EN_VIVO'  ? { cls: 'dsk-state--live',  dot: '●', txt: liveLabel ?? 'EN VIVO' } :
            t.estado === 'ATRASADO' ? { cls: 'dsk-state--warn',  dot: '◐', txt: 'DATOS ATRASADOS' } :
            t.estado === 'STALE'    ? { cls: 'dsk-state--stale', dot: '○', txt: 'TELEMETRÍA VENCIDA' } :
                                      { cls: 'dsk-state--off',   dot: '⊘', txt: 'SIN TELEMETRÍA' };
        const edad = t.edad_min_reciente;
        const edadTxt = edad === null ? '—' : edad < 60 ? `${edad} min` : `${(edad / 60).toFixed(1)} h`;
        // Sufijo = COBERTURA de escalas vigentes (no la edad de la mejor lectura,
        // que daba "EN VIVO·2min" con 8/14 vencidas). En EN_VIVO sí muestra edad.
        const sufijo = t.estado === 'EN_VIVO' ? edadTxt : `${t.vigentes}/${t.total} vigentes`;
        return (
            <span className={`telemetry-tag dsk-state-tag ${cfg.cls}`}
                  title={`${t.vigentes}/${t.total} escalas vigentes (<4 h) · ${t.frescos} frescas <1h / ${t.atrasados} 1–4h / ${t.stale} vencidas · lectura más nueva hace ${edadTxt}`}>
                {cfg.dot} {cfg.txt} · {sufijo}
            </span>
        );
    };

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
                        <span className="phb-label">{modoActual.kpi0Label}</span>
                        <span className="phb-val" style={{ color: sessionStorage.getItem('has_hydraulic_violation') === 'true' ? '#ef4444' : statusColor }}>
                            {flowAtZero.toFixed(2)} m³/s
                        </span>
                    </div>

                    {/* KPI meta de entrega — solo en ESTABILIZACIÓN cuando hay gasto solicitado */}
                    {(modoVisualizacion === 'ESTABILIZACION' || modoVisualizacion === 'SIN_EVENTO') &&
                     activeEvent?.gasto_solicitado_m3s && activeEvent.gasto_solicitado_m3s > 0 && (
                        <div className="phb-efficiency">
                            <span className="phb-label">META:</span>
                            <span className="phb-val" style={{ color: '#64748b' }}>
                                {activeEvent.gasto_solicitado_m3s.toFixed(1)} m³/s
                            </span>
                        </div>
                    )}

                    <button
                        type="button"
                        className="phb-system-btn"
                        onClick={() => window.location.href = '/'}
                        title="Ir al sistema completo"
                        aria-label="Ir al sistema completo"
                    >
                        <Activity size={12} />
                    </button>
                    <div className="phb-version">v{__V2_APP_VERSION__}</div>
                </div>
            </div>

            {/* Banner de estado extraordinario — CONTINGENCIA / VACIADO / ANOMALIA */}
            {(modoVisualizacion === 'CONTINGENCIA' || modoVisualizacion === 'VACIADO' || modoVisualizacion === 'ANOMALIA') && (
                <div
                    className="hydraulic-violation-banner hvb-modo-extra animate-in"
                    style={{ '--modo-color': modoActual.color } as React.CSSProperties}
                >
                    <div className="hvb-content">
                        <Activity size={18} className="hvb-icon hvb-modo-icon" />
                        <div className="hvb-text">
                            <b className="hvb-modo-label">{modoActual.label}</b>
                            {activeEvent?.notas && <p>{activeEvent.notas}</p>}
                        </div>
                    </div>
                </div>
            )}

            {/* Hydraulic Violation Banner */}
            {sessionStorage.getItem('has_hydraulic_violation') === 'true' && (
                <div className="hydraulic-violation-banner animate-in">
                    <div className="hvb-content">
                        <Activity size={18} className="hvb-icon" />
                        <div className="hvb-text">
                            <b>VIOLACIÓN HIDRÁULICA DETECTADA: K-0+000</b>
                            <p>El gasto de entrada ({flowAtZero.toFixed(2)} m³/s) EXCEDE la capacidad de diseño de 70.42 m³/s. Riesgo de desbordamiento.</p>
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

                        {nextTargetInfo.vOndaKmh != null && (
                        <div className="transit-row transit-row--onda">
                            <div className="tr-label">
                                〜 V ONDA
                            </div>
                            <div className="tr-value tr-value--onda">
                                {nextTargetInfo.vOndaKmh} km/h
                                <span className="tr-onda-q"> · Q={nextTargetInfo.qK0Usado} m³/s</span>
                            </div>
                        </div>
                        )}
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
                                    {flowAtZero.toFixed(2)}
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
                                <span className="bst-val" style={{ color: (Number(damMovements[0]?.gasto_m3s || executiveMetrics.totalReal) - flowAtZero) > 5 ? '#ef4444' : '#22c55e' }}>
                                    {(Number(damMovements[0]?.gasto_m3s || executiveMetrics.totalReal) - flowAtZero).toFixed(2)} m³/s
                                </span>
                            </div>
                            <div className="bst-item">
                                <span className="bst-label">EFICIENCIA GLOBAL</span>
                                <span className="bst-val highlight">
                                    {Number(damMovements[0]?.gasto_m3s || executiveMetrics.totalReal) > 0 
                                        ? ((flowAtZero / Number(damMovements[0]?.gasto_m3s || executiveMetrics.totalReal)) * 100).toFixed(1) 
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

                    {/* Canal Seco — tramo por recorrer (solo LLENADO) */}
                    {activeEvent?.evento_tipo === 'LLENADO' && dryPath.length >= 2 && (
                        <Polyline
                            positions={dryPath}
                            color="#1e3a5f"
                            weight={3}
                            dashArray="6,10"
                            opacity={0.65}
                            className="canal-path-dry"
                        />
                    )}

                    {/* Canal Activo (Stream) — segmento hidratado con efecto de flujo */}
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

                    {/* Escalas de Puntos — con mini-badge de nivel y clases de estado */}
                    {escalas.filter(esc => typeof esc.latitud === 'number' && typeof esc.longitud === 'number').map(esc => {
                        // Valores compartidos entre CircleMarker props, Tooltip y Popup
                        const nivel     = esc.nivel_actual ?? 0;
                        const nivelMax  = esc.nivel_max_operativo && esc.nivel_max_operativo > 0 ? esc.nivel_max_operativo : null;
                        const nivelPct  = nivelMax ? Math.min(100, (nivel / nivelMax) * 100) : null;
                        const barColor  = nivelPct === null ? '#38bdf8' : nivelPct >= 95 ? '#ef4444' : nivelPct >= 80 ? '#f59e0b' : '#38bdf8';
                        const gasto     = esc.gasto_actual ?? 0;
                        const apertura  = esc.apertura_actual ?? 0;
                        const telEstado = telemetriaEstado(esc.ultima_telemetria);
                        const telTxt    = telemetriaLabel(telEstado);
                        const tsAge     = esc.ultima_telemetria ? (Date.now() - esc.ultima_telemetria) / 60000 : null;
                        const delta     = esc.delta_12h ?? 0;
                        const trendSym  = delta > 0.01 ? '▲' : delta < -0.01 ? '▼' : '—';

                        // Color del marcador en mapa
                        const alertColor = esc.km <= displayMaxKm
                            ? (isEstabilizacion ? escalaAlertColor(esc, coherenciaCanal) : statusColor)
                            : '#1e293b';

                        // Offline solo cuando la escala YA reportó alguna vez pero perdió señal.
                        // Si ultima_telemetria es null nunca tuvo dato → mostrar con opacidad plena.
                        const hasEverReported = esc.ultima_telemetria !== null;
                        const isOffline = hasEverReported && telEstado === 'FUERA_DE_LINEA';

                        // Clase CSS para animaciones de estado
                        const markerClass = [
                            isOffline ? 'esc-offline' : '',
                            nivelPct !== null && nivelPct >= 92 ? 'esc-critical' : '',
                            nivelPct !== null && nivelPct >= 80 && nivelPct < 92 ? 'esc-warning' : '',
                        ].filter(Boolean).join(' ') || undefined;

                        // Badge operativo en popup
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

                        const tiempoLectura = tsAge === null ? 'Sin datos'
                            : tsAge < 1    ? 'Hace menos de 1 min'
                            : tsAge < 60   ? `Hace ${Math.floor(tsAge)} min`
                            : tsAge < 1440 ? `Hace ${Math.floor(tsAge / 60)}h ${Math.floor(tsAge % 60)}min`
                            : 'Más de un día';

                        return (
                            <CircleMarker
                                key={esc.id}
                                center={[esc.latitud!, esc.longitud!]}
                                radius={esc.km <= displayMaxKm ? 6 : 4}
                                fillColor={alertColor}
                                color={isOffline ? '#475569' : '#fff'}
                                weight={1.5}
                                fillOpacity={isOffline ? 0.35 : 1}
                                className={markerClass}
                            >
                                <Popup className="custom-popup sica-cp-popup">
                                    <div className="scp-root">
                                        <div className="scp-header">
                                            <span className="scp-km">KM {esc.km.toFixed(1)}</span>
                                            <span className="scp-badge" style={{ '--badge-color': badgeColor } as React.CSSProperties}>
                                                {badgeLabel}
                                            </span>
                                        </div>
                                        <div className="scp-nombre-row">
                                            <p className="scp-nombre">{esc.nombre}</p>
                                            <span className="scp-signal" data-tel={telEstado} title={telTxt} />
                                        </div>
                                        <div className="scp-section">
                                            <span className="scp-field-label">NIVEL DE AGUA</span>
                                            <div className="scp-bar-row">
                                                <div className="scp-bar-track">
                                                    <div className="scp-bar-fill" style={{ '--bar-w': nivelPct !== null ? `${nivelPct}%` : '0%', '--bar-color': barColor } as React.CSSProperties} />
                                                </div>
                                                <span className="scp-bar-val" style={{ '--bar-color': barColor } as React.CSSProperties}>{nivel.toFixed(2)} m</span>
                                            </div>
                                            {nivelMax && <span className="scp-ref">capacidad {nivelMax.toFixed(2)} m</span>}
                                        </div>
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
                                                            m{esc.puertas_abiertas != null && esc.pzas_radiales != null
                                                                ? ` · ${esc.puertas_abiertas}/${esc.pzas_radiales} comp.`
                                                                : esc.pzas_radiales != null ? ` · ${esc.pzas_radiales} comp.` : ''}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <div className="scp-footer">
                                            <span className="scp-footer-time" data-tel={telEstado}>{tiempoLectura}</span>
                                            <span className="scp-footer-signal" data-tel={telEstado}>{telTxt}</span>
                                        </div>
                                    </div>
                                </Popup>

                                {/* Mini-badge permanente cuando hay nivel; tooltip hover cuando no hay datos */}
                                <Tooltip
                                    className={nivel > 0 ? 'esc-level-badge' : 'custom-tooltip'}
                                    direction="top"
                                    offset={[0, -8]}
                                    permanent={nivel > 0}
                                    interactive={false}
                                    opacity={nivel > 0 ? 1 : 0.9}
                                >
                                    {nivel > 0
                                        ? <span className="elb-content">
                                            <span className="elb-val">{nivel.toFixed(2)}m</span>
                                            <span className="elb-arrow" data-dir={delta > 0.01 ? 'up' : delta < -0.01 ? 'down' : 'flat'}>{trendSym}</span>
                                          </span>
                                        : <span>{esc.nombre}</span>
                                    }
                                </Tooltip>
                            </CircleMarker>
                        );
                    })}

                    <ZoomControl position="bottomright" />
                </MapContainer>

                {/* ── Leyenda de mapa — overlay persistente ── */}
                <div className="map-legend">
                    {isEstabilizacion ? (
                        <>
                            <div className="ml-title">NIVEL DE AGUA</div>
                            <div className="ml-item">
                                <span className="ml-dot ml-dot--critico" />
                                <span>Crítico ≥ 92%</span>
                            </div>
                            <div className="ml-item">
                                <span className="ml-dot ml-dot--alerta" />
                                <span>Alerta ≥ 80%</span>
                            </div>
                            <div className="ml-item">
                                <span className="ml-dot ml-dot--normal" />
                                <span>Normal</span>
                            </div>
                            <div className="ml-item">
                                <span className="ml-dot ml-dot--bajo" />
                                <span>Flujo bajo</span>
                            </div>
                            <div className="ml-item">
                                <span className="ml-dot ml-dot--sin" />
                                <span>Sin datos</span>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="ml-title">FRENTE DE AVANCE</div>
                            <div className="ml-item">
                                <span className="ml-line ml-line--activo" />
                                <span>Hidratado</span>
                            </div>
                            <div className="ml-item">
                                <span className="ml-line ml-line--seco" />
                                <span>Por recorrer</span>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ── HUD Barra de Progreso — solo en LLENADO ─────────────────── */}
            {modoVisualizacion === 'LLENADO' && (
                <div className="hud-progress">
                    <div className="hud-endpoints">
                        <span>PRESA</span>
                        <span>K104</span>
                    </div>
                    <div className="hud-track">
                        {/* Segmento completado */}
                        <div
                            className="hud-fill"
                            style={{ '--fill-pct': `${Math.max(0, Math.min(100, ((displayMaxKm + 36) / 140) * 100)).toFixed(1)}%` } as React.CSSProperties}
                        />
                        {/* Marcas de km clave */}
                        {([0, 23, 34, 57, 80, 104] as const).map(km => (
                            <div
                                key={km}
                                className={`hud-mark${km <= displayMaxKm ? ' hud-mark--done' : ''}`}
                                style={{ '--mark-left': `${(((km + 36) / 140) * 100).toFixed(1)}%` } as React.CSSProperties}
                            >
                                <div className="hud-tick" />
                                <span className="hud-km-label">K{km}</span>
                            </div>
                        ))}
                        {/* Marcador del frente de ola */}
                        {displayMaxKm >= -36 && (
                            <div
                                className="hud-front"
                                style={{ '--front-left': `${Math.max(0, Math.min(100, ((displayMaxKm + 36) / 140) * 100)).toFixed(1)}%` } as React.CSSProperties}
                            >
                                <div className="hud-front-pulse" />
                                <div className="hud-front-label">
                                    {displayMaxKm >= 0 ? `KM ${displayMaxKm.toFixed(0)}` : 'RÍO'}
                                    {nextTargetInfo.arrivalTime && nextTargetInfo.arrivalTime !== 'PENDIENTE'
                                        ? ` · ${nextTargetInfo.arrivalTime}`
                                        : ''}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Bottom Dock - Balanced layout to avoid 'heavy right' look */}
            {isDockVisible ? (
                <div className="info-cards-dock animate-in" style={{ animationDelay: '0.4s' }}>
                    <button type="button" className="dock-close-btn" onClick={() => setIsDockVisible(false)} title="Cerrar tablero">×</button>

                    {/* ── Barra de pestañas ── */}
                    <div className="dock-tabs">
                        <button
                            type="button"
                            className={`dock-tab${dockTab === 'resumen' ? ' dock-tab--active' : ''}`}
                            onClick={() => setDockTab('resumen')}
                        >
                            {isEstabilizacion ? 'PANORAMA' : 'BALANCE'}
                        </button>
                        <button
                            type="button"
                            className={`dock-tab${dockTab === 'canal' ? ' dock-tab--active' : ''}`}
                            onClick={() => setDockTab('canal')}
                        >
                            CANAL
                        </button>
                        <button
                            type="button"
                            className={`dock-tab${dockTab === 'alertas' ? ' dock-tab--active' : ''}`}
                            onClick={() => setDockTab('alertas')}
                        >
                            ALERTAS
                            {activeAlertas.length > 0 && (
                                <span className="dock-tab-badge">{activeAlertas.length}</span>
                            )}
                        </button>
                        <button
                            type="button"
                            className={`dock-tab dock-tab--skill${dockTab === 'skill' ? ' dock-tab--active' : ''}`}
                            onClick={() => setDockTab('skill')}
                            title="Datos actuales para modelación con Claude"
                        >
                            DATOS
                        </button>
                        <button
                            type="button"
                            className={`dock-tab${dockTab === 'tendencias' ? ' dock-tab--active' : ''}`}
                            onClick={() => setDockTab('tendencias')}
                            title="Análisis histórico por periodo: escalas, tramos, compuertas, gasto"
                        >
                            TENDENCIAS
                        </button>
                    </div>

                    {/* ── Pestaña RESUMEN (anterior dock-panel-left) ── */}
                    {dockTab === 'resumen' && (
                    <>
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
                                        <span className="summary-info-title">📊 PROGRESO: <span className="summary-info-value" style={{ color: statusColor }}>{Math.max(0, Math.min(100, ((displayMaxKm + 36) / 140) * 100)).toFixed(1)}%</span></span>
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
                                            <span className="cfc-val" title={coherenciaCanal.k0Disponible ? undefined : 'K-0 sin lectura de gasto fresca (<4 h)'}>
                                                {coherenciaCanal.k0Disponible ? coherenciaCanal.qK0Medido.toFixed(1) : 'S/D'}
                                            </span>
                                            <span className="cfc-unit">m³/s</span>
                                        </div>
                                        <div className="cfc-arrow">
                                            <span className="cfc-loss">{coherenciaCanal.perdidaCanal !== null ? `−${coherenciaCanal.perdidaCanal.toFixed(1)}` : '—'}</span>
                                            <span className="cfc-dist">{coherenciaCanal.tramoCompleto ? '104km canal' : `hasta K${coherenciaCanal.kmFinal ?? '?'}`}</span>
                                        </div>
                                        <div className="cfc-node">
                                            <span className="cfc-label">{coherenciaCanal.tramoCompleto ? 'K104' : `K${coherenciaCanal.kmFinal ?? '?'}`}</span>
                                            <span className="cfc-val">{coherenciaCanal.qFinal.toFixed(1)}</span>
                                            <span className="cfc-unit">m³/s</span>
                                        </div>
                                    </div>
                                ) : (
                                    // Criterio real: frescura <4h (no "hoy") — decirlo evita contradecir a CANAL/DATOS
                                    <div className="coherencia-sin-datos">Sin lecturas de gasto frescas (&lt;4 h) — el último dato conocido está en la pestaña DATOS</div>
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

                    {/* ── Checkpoints siempre visibles en RESUMEN (layout original) ── */}
                    <div className="dock-section checkpoints-section">
                        <div className="dock-section-header">
                            <span className="card-label">RED DE PUNTOS DE CONTROL</span>
                            {renderStateTag('MONITOREO ACTIVO')}
                        </div>
                        <div className="checkpoints-scroll-container">
                            {escalas
                                .sort((a, b) => a.km - b.km)
                                .map((e) => {
                                    // Coherencia individual: marcar punto incoherente
                                    const puntoCoh = coherenciaCanal?.puntos.find(p => p.id === e.id);
                                    const incoherente = puntoCoh && !puntoCoh.coherente;
                                    const hasFlow = isEstabilizacion && !ESC_SIN_CONTROL.has(e.nombre) && (e.gasto_actual ?? 0) > 0;
                                    return (
                                    <div
                                        className={`checkpoint-card-compact ${e.km <= displayMaxKm ? 'active' : ''} ${incoherente ? 'cpc-incoherente' : ''}`}
                                        key={e.id}
                                    >
                                        <div className="cpc-km">{e.km.toFixed(1)} <small>KM</small></div>
                                        <div className="cpc-body">
                                            <span className="cpc-name">{e.nombre}</span>
                                            <div className="cpc-data" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <span className="cpc-value">{e.nivel_actual?.toFixed(2) || '0.00'}</span>
                                                <small className="cpc-unit">m</small>
                                                {(() => {
                                                    // Tendencia solo con lectura fresca (<4h): un "— 0.00" sobre
                                                    // datos de 20h sugiere estabilidad EN VIVO que nadie midió.
                                                    const ageMin = e.ultima_telemetria ? (Date.now() - e.ultima_telemetria) / 60000 : Infinity;
                                                    if (ageMin > 240) return (
                                                        <span style={{ color: '#64748b', fontSize: '11px' }} title="Tendencia 12h no disponible — telemetría vencida (>4 h)">·</span>
                                                    );
                                                    const d = e.delta_12h ?? 0;
                                                    const tChar = d > 0.01 ? '▲' : d < -0.01 ? '▼' : '—';
                                                    const tCol = d > 0.01 ? '#ef4444' : d < -0.01 ? '#22c55e' : '#cbd5e1';
                                                    return (
                                                        <span style={{ color: tCol, fontSize: '12px', fontWeight: '900', textShadow: '0 0 4px rgba(0,0,0,0.8)' }} title={`Tendencia 12h: ${d > 0 ? '+' : ''}${d.toFixed(2)}m`}>
                                                            {tChar} {Math.abs(d).toFixed(2)}
                                                        </span>
                                                    );
                                                })()}
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
                    </>
                    )}

                    {/* ── Pestaña CANAL (checkpoints standalone — móvil usa esta vista) ── */}
                    {dockTab === 'canal' && (
                    <div className="dock-section checkpoints-section">
                        <div className="dock-section-header">
                            <span className="card-label">RED DE PUNTOS DE CONTROL</span>
                            {renderStateTag('MONITOREO ACTIVO')}
                        </div>
                        <div className="checkpoints-scroll-container">
                            {escalas
                                .sort((a, b) => a.km - b.km)
                                .map((e) => {
                                    const puntoCoh = coherenciaCanal?.puntos.find(p => p.id === e.id);
                                    const incoherente = puntoCoh && !puntoCoh.coherente;
                                    const hasFlow = isEstabilizacion && !ESC_SIN_CONTROL.has(e.nombre) && (e.gasto_actual ?? 0) > 0;
                                    return (
                                    <div
                                        className={`checkpoint-card-compact ${e.km <= displayMaxKm ? 'active' : ''} ${incoherente ? 'cpc-incoherente' : ''}`}
                                        key={e.id}
                                    >
                                        <div className="cpc-km">{e.km.toFixed(1)} <small>KM</small></div>
                                        <div className="cpc-body">
                                            <span className="cpc-name">{e.nombre}</span>
                                            <div className="cpc-data" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <span className="cpc-value">{e.nivel_actual?.toFixed(2) || '0.00'}</span>
                                                <small className="cpc-unit">m</small>
                                                {(() => {
                                                    // Tendencia solo con lectura fresca (<4h): un "— 0.00" sobre
                                                    // datos de 20h sugiere estabilidad EN VIVO que nadie midió.
                                                    const ageMin = e.ultima_telemetria ? (Date.now() - e.ultima_telemetria) / 60000 : Infinity;
                                                    if (ageMin > 240) return (
                                                        <span style={{ color: '#64748b', fontSize: '11px' }} title="Tendencia 12h no disponible — telemetría vencida (>4 h)">·</span>
                                                    );
                                                    const d = e.delta_12h ?? 0;
                                                    const tChar = d > 0.01 ? '▲' : d < -0.01 ? '▼' : '—';
                                                    const tCol = d > 0.01 ? '#ef4444' : d < -0.01 ? '#22c55e' : '#cbd5e1';
                                                    return (
                                                        <span style={{ color: tCol, fontSize: '12px', fontWeight: '900', textShadow: '0 0 4px rgba(0,0,0,0.8)' }} title={`Tendencia 12h: ${d > 0 ? '+' : ''}${d.toFixed(2)}m`}>
                                                            {tChar} {Math.abs(d).toFixed(2)}
                                                        </span>
                                                    );
                                                })()}
                                            </div>
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
                    )}

                    {/* ── Pestaña ALERTAS ── */}
                    {dockTab === 'alertas' && (
                    <div className="dock-section dock-alertas-panel">
                        <div className="dock-section-header">
                            <span className="card-label">ALERTAS ACTIVAS</span>
                            {renderStateTag()}
                        </div>
                        {activeAlertas.length === 0 ? (
                            <div className="dap-empty">
                                <span className="dap-empty-icon">✓</span>
                                <span>Sin alertas activas</span>
                            </div>
                        ) : (
                            <div className="dap-list">
                                {activeAlertas.map(a => (
                                    <div key={a.id} className={`dap-item dap-item--${a.tipo_riesgo}`}>
                                        <AlertTriangle size={12} className="dap-icon" />
                                        <div className="dap-body">
                                            <span className="dap-titulo">{a.titulo}</span>
                                            <span className="dap-fecha">
                                                {new Date(a.fecha_deteccion).toLocaleString('es-MX', {
                                                    day: '2-digit', month: 'short',
                                                    hour: '2-digit', minute: '2-digit',
                                                    hour12: true, timeZone: 'America/Chihuahua'
                                                })}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="dap-footer">
                            <a href="/alertas" className="dap-link">Ver módulo Alertas →</a>
                        </div>
                    </div>
                    )}

                    {/* ── Pestaña DATOS ACTUALES — Snapshot para Claude/Skill ── */}
                    {dockTab === 'skill' && (
                    <div className="dock-section dock-skill-panel">
                        <div className="dock-section-header">
                            <span className="card-label">DATOS ACTUALES — SKILL v3.7</span>
                            {renderStateTag()}
                        </div>

                        {/* Banner de estado gerencial — explica el porqué de los S/D */}
                        {skillSnapshot.telemetria.estado !== 'EN_VIVO' && (
                            <div className={`dsk-state-banner dsk-state-banner--${
                                skillSnapshot.telemetria.estado === 'ATRASADO' ? 'warn' :
                                skillSnapshot.telemetria.estado === 'OFFLINE' ? 'off' : 'stale'}`}>
                                <span className="dsk-sb-icon">
                                    {skillSnapshot.telemetria.estado === 'ATRASADO' ? '◐' :
                                     skillSnapshot.telemetria.estado === 'OFFLINE'  ? '⊘' : '○'}
                                </span>
                                <div className="dsk-sb-text">
                                    <strong>
                                        {skillSnapshot.telemetria.estado === 'ATRASADO'
                                            ? 'Telemetría envejeciendo — balance de referencia'
                                            : skillSnapshot.telemetria.estado === 'OFFLINE'
                                            ? 'Sin lecturas activas — panel en espera de campo'
                                            : 'Telemetría vencida (>4 h) — balance no confiable'}
                                    </strong>
                                    <span>
                                        {skillSnapshot.telemetria.frescos} frescos · {skillSnapshot.telemetria.atrasados} atrasados · {skillSnapshot.telemetria.stale} vencidos
                                        {skillSnapshot.telemetria.sin_flujo > 0 && ` · ${skillSnapshot.telemetria.sin_flujo} sin gasto (solo nivel)`}
                                        {' '}de {skillSnapshot.telemetria.total} escalas.
                                        {' '}El balance global K-0/K-104 requiere lecturas &lt;4 h en ambos extremos y las 4 zonas.
                                        {' '}Los valores en gris son el último dato conocido (referencia, no medición en vivo).
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Contenido scrolleable */}
                        <div className="dsk-scroll-body">

                        {/* Balance global — translate="no": evita que el navegador
                            traduzca "S/D" (Sin Dato) a "Dakota del Sur" y otros
                            términos técnicos si el usuario fuerza traducción. */}
                        <div className="dsk-balance-row notranslate" translate="no">
                            <div className="dsk-bal-item">
                                <span className="dsk-bal-label">K-0 ENTRADA</span>
                                {skillSnapshot.balance.Q0 !== null
                                    ? <span className="dsk-bal-val dsk-val--green">{skillSnapshot.balance.Q0.toFixed(3)}</span>
                                    : skillSnapshot.balance.Q0_hist !== null
                                    ? <span className="dsk-bal-val dsk-val--hist" title={`Sin telemetría fresca (>4h). Último dato conocido hace ${fmtAge(skillSnapshot.balance.Q0_age_min)} — referencia, no medición en vivo.`}>{skillSnapshot.balance.Q0_hist.toFixed(3)}<small className="dsk-bal-age"> ·{fmtAge(skillSnapshot.balance.Q0_age_min)}</small></span>
                                    : <span className="dsk-bal-val dsk-val--red" title="K-0 sin telemetría &gt;4h">S/D</span>
                                }
                                <span className="dsk-bal-unit">m³/s</span>
                            </div>
                            <div className="dsk-bal-item">
                                <span className="dsk-bal-label">K-104 SALIDA</span>
                                {skillSnapshot.balance.Q104 !== null
                                    ? <span className="dsk-bal-val dsk-val--blue">{skillSnapshot.balance.Q104.toFixed(3)}</span>
                                    : skillSnapshot.balance.Q104_hist !== null
                                    ? <span className="dsk-bal-val dsk-val--hist" title={`Sin telemetría fresca (>4h). Último dato conocido hace ${fmtAge(skillSnapshot.balance.Q104_age_min)} — referencia, no medición en vivo.`}>{skillSnapshot.balance.Q104_hist.toFixed(3)}<small className="dsk-bal-age"> ·{fmtAge(skillSnapshot.balance.Q104_age_min)}</small></span>
                                    : <span className="dsk-bal-val dsk-val--red" title="Sin telemetría &gt;4h">S/D</span>
                                }
                                <span className="dsk-bal-unit">m³/s</span>
                            </div>
                            <div className="dsk-bal-item">
                                <span className="dsk-bal-label">EFICIENCIA</span>
                                {skillSnapshot.balance.eficiencia !== null
                                    ? <span className={`dsk-bal-val ${skillSnapshot.balance.eficiencia >= 95 ? 'dsk-val--green' : skillSnapshot.balance.eficiencia >= 90 ? 'dsk-val--amber' : 'dsk-val--red'}`} title={skillSnapshot.balance.balance_modo === 'parcial' ? 'Balance parcial: K-104 con último dato conocido (no en vivo)' : undefined}>{skillSnapshot.balance.eficiencia.toFixed(1)}%{skillSnapshot.balance.balance_modo === 'parcial' && <small className="dsk-bal-age"> ref</small>}</span>
                                    : <span className="dsk-bal-val dsk-val--red" title={`Balance no confiable — ${skillSnapshot.balance.Q0 === null ? 'K-0 sin dato' : skillSnapshot.balance.Q104 === null ? 'K-104 sin dato' : `solo ${skillSnapshot.Q_ZONAS_MEDIDAS}/4 zonas medidas`}`}>S/D</span>
                                }
                                <span className="dsk-bal-unit"></span>
                            </div>
                            <div className="dsk-bal-item">
                                <span className="dsk-bal-label">PÉRDIDAS</span>
                                {skillSnapshot.balance.perdidas !== null
                                    ? <span className="dsk-bal-val dsk-val--amber" title={skillSnapshot.balance.balance_modo === 'parcial' ? 'Balance parcial: K-104 con último dato conocido (no en vivo)' : undefined}>{skillSnapshot.balance.perdidas.toFixed(3)}{skillSnapshot.balance.balance_modo === 'parcial' && <small className="dsk-bal-age"> ref</small>}</span>
                                    : <span className="dsk-bal-val dsk-val--red" title={`Balance no confiable — ${skillSnapshot.balance.Q0 === null ? 'K-0 sin dato' : skillSnapshot.balance.Q104 === null ? 'K-104 sin dato' : `solo ${skillSnapshot.Q_ZONAS_MEDIDAS}/4 zonas medidas`}`}>S/D</span>
                                }
                                <span className="dsk-bal-unit">m³/s</span>
                            </div>
                            <div className="dsk-bal-item">
                                <span className="dsk-bal-label">λ /km</span>
                                {skillSnapshot.balance.lambda !== null
                                    ? <span className="dsk-bal-val" title={skillSnapshot.balance.balance_modo === 'parcial' ? 'Balance parcial: K-104 con último dato conocido (no en vivo)' : undefined}>{skillSnapshot.balance.lambda.toFixed(5)}{skillSnapshot.balance.balance_modo === 'parcial' && <small className="dsk-bal-age"> ref</small>}</span>
                                    : <span className="dsk-bal-val dsk-val--red" title={`Balance no confiable — ${skillSnapshot.balance.Q0 === null ? 'K-0 sin dato' : skillSnapshot.balance.Q104 === null ? 'K-104 sin dato' : `solo ${skillSnapshot.Q_ZONAS_MEDIDAS}/4 zonas medidas`}`}>S/D</span>
                                }
                                <span className="dsk-bal-unit">m³/s·km⁻¹</span>
                            </div>
                        </div>

                        {/* Alertas de nivel */}
                        {skillSnapshot.alertas_nivel.length > 0 && (
                            <div className="dsk-alerts-strip">
                                {skillSnapshot.alertas_nivel.map(a => (
                                    <span key={a.nombre} className={`dsk-alert-tag ${a.tipo === 'NIVEL_CRITICO' ? 'dsk-alert--red' : 'dsk-alert--amber'}`}>
                                        ⚠ {a.nombre} BL={a.bl}m
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Tabla de checkpoints */}
                        <div className="dsk-table-wrap">
                            <table className="dsk-table">
                                <thead>
                                    <tr>
                                        <th>PUNTO</th>
                                        <th>KM</th>
                                        <th>H↑ (m)</th>
                                        <th>H↓ (m)</th>
                                        <th>Q (m³/s)</th>
                                        <th>M1</th>
                                        <th>AP (m)</th>
                                        <th>BL</th>
                                        <th>TEL</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {skillSnapshot.checkpoints.map(c => {
                                        const tsMin = c.ts_min;
                                        const telCls = tsMin === null ? 'dsk-tel--offline'
                                            : tsMin < 60  ? 'dsk-tel--ok'
                                            : tsMin < 120 ? 'dsk-tel--warn'
                                            : 'dsk-tel--critico';
                                        const telLabel = tsMin === null ? '—'
                                            : tsMin < 60  ? `${tsMin}m`
                                            : tsMin < 120 ? `${tsMin}m`
                                            : `${Math.round(tsMin / 60)}h`;
                                        return (
                                            <tr key={c.nombre} className={c.alerta === 'NIVEL_CRITICO' ? 'dsk-tr--critico' : c.alerta === 'PRECAUCION' ? 'dsk-tr--warn' : ''}>
                                                <td className="dsk-td-nombre">{c.nombre}</td>
                                                <td className="dsk-td-num">{c.km}</td>
                                                <td className="dsk-td-num">{c.hA.toFixed(3)}</td>
                                                <td className="dsk-td-num">{c.hB !== null && c.hB !== undefined ? c.hB.toFixed(3) : '—'}</td>
                                                <td className={`dsk-td-num ${c.q > 0 ? 'dsk-td--q' : 'dsk-td--zero'}`}
                                                    title={c.q > 0 ? undefined : (c.ts_min === null ? 'Sin telemetría' : 'Nivel reportado, sin medición de gasto')}>
                                                    {c.q > 0 ? c.q.toFixed(3) : '—'}</td>
                                                <td className="dsk-td-num dsk-td--m1">{c.m1.toFixed(4)}</td>
                                                <td className="dsk-td-num">{c.apertura > 0 ? c.apertura.toFixed(3) : '—'}</td>
                                                <td className={`dsk-td-num ${c.bl !== null && c.bl < 0 ? 'dsk-td--red' : c.bl !== null && c.bl < 0.10 ? 'dsk-td--amber' : ''}`}>
                                                    {c.bl !== null ? c.bl.toFixed(3) : '—'}
                                                </td>
                                                <td className={`dsk-td-num ${telCls}`}>{telLabel}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Volumen por tramo interescala */}
                        {volInterescalas.length > 0 && (
                        <div className="dsk-section-block">
                            <div className="dsk-sub-header">VOLUMEN EN CANAL — TRAMOS INTERESCALA</div>

                            {/* Aviso de aforo urgente — escalas vencidas que bloquean el balance.
                                Prioriza las más antiguas; con ellas frescas, sus tramos se recalculan. */}
                            {(() => {
                                const vencidas = skillSnapshot.checkpoints
                                    .filter(c => (c.ts_min === null || c.ts_min > 240) && !ESC_SIN_CONTROL.has(c.nombre))
                                    .map(c => ({ nombre: c.nombre, ts: c.ts_min }))
                                    .sort((a, b) => (b.ts ?? 1e9) - (a.ts ?? 1e9));
                                if (vencidas.length === 0) return null;
                                const fmt = (m: number | null) => m == null ? 'sin lectura' : m < 60 ? `${m} min` : `${(m / 60).toFixed(1)} h`;
                                // Críticas = sin lectura o >12 h (las que más bloquean)
                                const criticas = vencidas.filter(v => v.ts === null || (v.ts ?? 0) > 720);
                                return (
                                    <div className="dsk-aforo-aviso">
                                        <span className="dsk-aforo-icon">📡</span>
                                        <div className="dsk-aforo-text">
                                            <strong>{vencidas.length} escala{vencidas.length > 1 ? 's' : ''} requiere{vencidas.length > 1 ? 'n' : ''} aforo</strong>
                                            <span className="dsk-aforo-list">
                                                {vencidas.map(v => (
                                                    <span key={v.nombre} className={`dsk-aforo-chip ${v.ts === null || (v.ts ?? 0) > 720 ? 'dsk-aforo-chip--crit' : ''}`}>
                                                        {v.nombre} · {fmt(v.ts)}
                                                    </span>
                                                ))}
                                            </span>
                                            {criticas.length > 0 && (
                                                <span className="dsk-aforo-nota">
                                                    ⚠ {criticas.map(c => c.nombre).join(', ')} sin reportar &gt;12 h — bloquean el balance de sus tramos.
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Strip de alertas de fuga — excluye tramos con escalas STALE (>4h) o escalas de referencia sin control de gasto */}
                            {(() => {
                                const escStale = new Set(
                                    skillSnapshot.checkpoints
                                        .filter(c => c.ts_min === null || c.ts_min > 240)
                                        .map(c => c.nombre)
                                );
                                const tramosConfiables = balanceTramos.filter((b: any) => {
                                    if (ESC_SIN_CONTROL.has(b.escala_entrada) || ESC_SIN_CONTROL.has(b.escala_salida)) return false;
                                    if (escStale.has(b.escala_entrada) || escStale.has(b.escala_salida)) return false;
                                    return b.estado_balance === 'FUGA_ALTA' || b.estado_balance === 'FUGA_MEDIA';
                                });
                                const tramosStaleOSifon = balanceTramos.filter((b: any) =>
                                    (b.estado_balance === 'INCONSISTENCIA' || b.estado_balance === 'FUGA_ALTA') &&
                                    (ESC_SIN_CONTROL.has(b.escala_entrada) || ESC_SIN_CONTROL.has(b.escala_salida) ||
                                     escStale.has(b.escala_entrada) || escStale.has(b.escala_salida))
                                );
                                return (
                                    <>
                                    {tramosConfiables.length > 0 && (
                                        <div className="bt-alert-strip">
                                            {tramosConfiables.map((b: any) => (
                                                <div key={b.km_inicio} className={`bt-alert-item bt-alert--${b.estado_balance === 'FUGA_ALTA' ? 'alta' : 'media'}`}>
                                                    <span className="bt-alert-badge">{b.estado_balance === 'FUGA_ALTA' ? '⚠ FUGA ALTA' : '· FUGA MEDIA'}</span>
                                                    <span className="bt-alert-tramo">{b.escala_entrada} → {b.escala_salida}</span>
                                                    <span className="bt-alert-q">{Number(b.q_fuga_detectada).toFixed(3)} m³/s no contabilizados</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {tramosStaleOSifon.length > 0 && (
                                        <div className="bt-alert-strip">
                                            {tramosStaleOSifon.map((b: any) => (
                                                <div key={'stale-'+b.km_inicio} className="bt-alert-item bt-alert--stale">
                                                    <span className="bt-alert-badge">⊘ SIN DATO</span>
                                                    <span className="bt-alert-tramo">{b.escala_entrada} → {b.escala_salida}</span>
                                                    <span className="bt-alert-q">telemetría fuera de línea — balance no confiable</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    </>
                                );
                            })()}

                            <div className="dsk-table-wrap">
                                <table className="dsk-table">
                                    <thead>
                                        <tr>
                                            <th>TRAMO</th>
                                            <th>L (km)</th>
                                            <th title="H↑ escala entrada — nivel aguas arriba de compuerta">H↑ ent (m)</th>
                                            <th title="H↓ escala entrada — nivel real inicio de tramo, aguas abajo de compuerta">H↓ ent (m)</th>
                                            <th title="H↑ escala salida — nivel real fin de tramo, aguas arriba de siguiente compuerta">H↑ sal (m)</th>
                                            <th>Vol (m³)</th>
                                            <th>Mm³</th>
                                            <th>Q↑ (m³/s)</th>
                                            <th>Q↓ (m³/s)</th>
                                            <th>Fuga (m³/s)</th>
                                            <th>Balance</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(() => {
                                            const ESC_SIN_CONTROL_TB = new Set(['K-64', 'K-94+200']);
                                            // Antigüedad (min) por escala — para indicar CUÁL falta y desde cuándo,
                                            // en vez de un "S/D" genérico que no dice qué hay que medir.
                                            const edadMap = new Map<string, number | null>(
                                                skillSnapshot.checkpoints.map(c => [c.nombre, c.ts_min])
                                            );
                                            const edadTxt = (n: string) => {
                                                const m = edadMap.get(n);
                                                if (m == null) return 'sin lectura';
                                                return m < 60 ? `${m} min` : `${(m / 60).toFixed(1)} h`;
                                            };
                                            const esVencida = (n: string) => {
                                                const m = edadMap.get(n);
                                                return m == null || m > 240;
                                            };
                                            return volInterescalas.map((v: any) => {
                                            const bt = balanceTramos.find(b => Math.abs(Number(b.km_inicio) - Number(v.km_up)) < 0.1);
                                            const esSinControl = ESC_SIN_CONTROL_TB.has(v.esc_up) || ESC_SIN_CONTROL_TB.has(v.esc_down);
                                            // ¿Qué escala(s) frontera están vencidas? — para el detalle del motivo
                                            const upVenc = esVencida(v.esc_up);
                                            const dnVenc = esVencida(v.esc_down);
                                            const esStale = upVenc || dnVenc;
                                            const sinDato = esSinControl || esStale;
                                            // Motivo legible de por qué el balance no es confiable
                                            const motivo = esSinControl
                                                ? 'Escala de referencia sin control de gasto'
                                                : upVenc && dnVenc
                                                ? `Ambas escalas vencidas (${v.esc_up} ${edadTxt(v.esc_up)}, ${v.esc_down} ${edadTxt(v.esc_down)})`
                                                : upVenc
                                                ? `Entrada ${v.esc_up} sin lectura fresca (${edadTxt(v.esc_up)})`
                                                : dnVenc
                                                ? `Salida ${v.esc_down} sin lectura fresca (${edadTxt(v.esc_down)})`
                                                : '';
                                            const estadoClass = sinDato ? 'bt-estado--stale'
                                                : bt?.estado_balance === 'FUGA_ALTA' ? 'bt-estado--alta'
                                                : bt?.estado_balance === 'FUGA_MEDIA' ? 'bt-estado--media'
                                                : bt?.estado_balance === 'INCONSISTENCIA' ? 'bt-estado--inconsistencia'
                                                : bt ? 'bt-estado--ok' : '';
                                            const rowClass = sinDato ? 'bt-row--stale'
                                                : bt?.estado_balance === 'FUGA_ALTA' ? 'bt-row--alta' : '';
                                            return (
                                            <tr key={v.km_up} className={rowClass} title={motivo || undefined}>
                                                <td className="dsk-td-tramo">{v.esc_up} → {v.esc_down}</td>
                                                <td className="dsk-td-num">{Number(v.longitud_km).toFixed(3)}</td>
                                                {/* Niveles y volumen SIEMPRE se muestran: dependen del tirante
                                                    medido, no del gasto fresco. Aunque el balance de fuga no
                                                    sea confiable, el almacenamiento del tramo sí es útil. */}
                                                <td className="dsk-td-num dsk-td--ref" title="H↑ escala entrada (remanso aguas arriba de compuerta)">{v.nivel_up_m != null ? Number(v.nivel_up_m).toFixed(3) : '—'}</td>
                                                <td className="dsk-td-num" title="H↓ escala entrada — inicio real del tramo">{v.nivel_ini_m != null ? Number(v.nivel_ini_m).toFixed(3) : '—'}</td>
                                                <td className="dsk-td-num" title="H↑ escala salida — fin real del tramo">{v.nivel_fin_m != null ? Number(v.nivel_fin_m).toFixed(3) : '—'}</td>
                                                <td className="dsk-td-num dsk-td--q">{v.vol_m3 != null ? Number(v.vol_m3).toLocaleString('es-MX') : '—'}</td>
                                                <td className="dsk-td-num">{v.vol_mm3 != null ? Number(v.vol_mm3).toFixed(4) : '—'}</td>
                                                {/* Q y fuga: ocultos solo si NO son confiables (gasto viejo daría
                                                    fugas imposibles de ±37 m³/s). El ⊘ lleva tooltip con el motivo. */}
                                                <td className="dsk-td-num" title={sinDato ? motivo : undefined}>{sinDato ? '⊘' : bt ? Number(bt.q_entrada_m3s).toFixed(3) : '—'}</td>
                                                <td className="dsk-td-num" title={sinDato ? motivo : undefined}>{sinDato ? '⊘' : bt ? Number(bt.q_salida_m3s).toFixed(3) : '—'}</td>
                                                <td className="dsk-td-num" title={sinDato ? motivo : undefined}>{sinDato ? '⊘' : bt ? Number(bt.q_fuga_detectada).toFixed(3) : '—'}</td>
                                                <td className={`dsk-td-num bt-estado ${estadoClass}`} title={motivo || undefined}>
                                                    {sinDato ? (esSinControl ? 'REF' : esStale ? '⏳ STALE' : 'S/D') : (bt?.estado_balance ?? '—')}
                                                </td>
                                            </tr>
                                            );
                                        });
                                        })()}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        )}

                        {/* Almacenamiento por zona Z1–Z4 */}
                        {volZonas.length > 0 && (
                        <div className="dsk-section-block">
                            <div className="dsk-sub-header">ALMACENAMIENTO POR ZONA</div>
                            {/* Alertas de zona — vaciándose (<40%) Y sobrellenado (≥90%).
                                Una zona al 100% (riesgo de desbordamiento) es tan crítica como
                                una al 20%; antes solo se alertaban las zonas bajas. */}
                            {volZonas.some((z: any) => { const p = Number(z.pct_llenado ?? 0); return p < 40 || p >= 90; }) && (
                                <div className="bt-alert-strip" style={{marginBottom:'6px'}}>
                                    {volZonas
                                        .filter((z: any) => { const p = Number(z.pct_llenado ?? 0); return p < 40 || p >= 90; })
                                        .map((z: any) => {
                                            const pct = Number(z.pct_llenado ?? 0);
                                            const sev = pct >= 100 || pct < 20 ? 'alta' : 'media';
                                            const badge =
                                                pct >= 100 ? '⚠ ZONA LLENA'
                                                : pct >= 90 ? '· ZONA ALTA'
                                                : pct < 20  ? '⚠ ZONA CRÍTICA'
                                                : '· ZONA BAJA';
                                            return (
                                                <div key={z.codigo} className={`bt-alert-item bt-alert--${sev}`}>
                                                    <span className="bt-alert-badge">{badge}</span>
                                                    <span className="bt-alert-tramo">{z.codigo} — {z.zona_nombre}</span>
                                                    <span className="bt-alert-q">{pct.toFixed(1)}% · {Number(z.vol_actual_mm3).toFixed(4)} Mm³</span>
                                                </div>
                                            );
                                        })}
                                </div>
                            )}
                            <div className="dsk-zonas-grid">
                                {volZonas.map((z: any) => {
                                    const pct = Math.min(Number(z.pct_llenado ?? 0), 100);
                                    const color = pct >= 90 ? '#ef4444' : pct >= 75 ? '#f97316' : pct < 20 ? '#ef4444' : pct < 40 ? '#f97316' : '#22c55e';
                                    return (
                                        <div key={z.codigo} className="dsk-zona-card">
                                            <div className="dsk-zona-header">
                                                <span className="dsk-zona-code">{z.codigo}</span>
                                                <span className="dsk-zona-pct" style={{color}}>{pct.toFixed(1)}%</span>
                                            </div>
                                            <div className="dsk-zona-bar-bg">
                                                <div className="dsk-zona-bar-fill" style={{width:`${pct}%`, backgroundColor: color}} />
                                            </div>
                                            <div className="dsk-zona-stats">
                                                <span>Vol: {Number(z.vol_actual_mm3).toFixed(4)} Mm³</span>
                                                <span>Niv: {Number(z.nivel_medio_m).toFixed(3)}m</span>
                                                <span>Cap: {Number(z.y_capacidad_m).toFixed(2)}m</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="dsk-zona-total">
                                Vol total canal: <strong>{volZonas.reduce((s: number, z: any) => s + Number(z.vol_actual_mm3 ?? 0), 0).toFixed(4)} Mm³</strong>
                            </div>
                        </div>
                        )}

                        {/* Balance dotación vs consumo por módulo */}
                        {modulosResumen.length > 0 && (
                        <div className="dsk-section-block">
                            <div className="dsk-sub-header">DOTACIÓN BASE vs CONSUMO — MÓDULOS</div>
                            <div className="dsk-table-wrap">
                                <table className="dsk-table">
                                    <thead>
                                        <tr>
                                            <th>MÓDULO</th>
                                            <th>ZONA</th>
                                            <th>DOTAC (Mm³)</th>
                                            <th>USADO (Mm³)</th>
                                            <th>ADIC (Mm³)</th>
                                            <th>DISP (Mm³)</th>
                                            <th>%</th>
                                            <th>ESTADO</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {modulosResumen.map((b: any) => {
                                            const estado = b.estado_volumen as string;
                                            const rowCls = estado === 'base_agotado' ? 'dsk-tr--critico' : estado === 'alerta_base' ? 'dsk-tr--warn' : '';
                                            const estadoLabel = estado === 'base_agotado' ? '🔴 Agotado' : estado === 'alerta_base' ? '⚠ Alerta' : '✓ Normal';
                                            return (
                                                <tr key={b.modulo_id} className={rowCls}>
                                                    <td className="dsk-td-nombre">{b.codigo_corto || b.modulo_nombre}</td>
                                                    <td className="dsk-td-num">{b.zona_codigo}</td>
                                                    <td className="dsk-td-num">{(b.vol_base_m3 / 1e6).toFixed(3)}</td>
                                                    <td className="dsk-td-num dsk-td--q">{(b.vol_base_consumido_m3 / 1e6).toFixed(4)}</td>
                                                    <td className="dsk-td-num">{(b.vol_adicional_consumido_m3 / 1e6).toFixed(4)}</td>
                                                    <td className={`dsk-td-num ${(b.vol_base_disponible_m3 ?? 0) < 0 ? 'dsk-td--red' : ''}`}>{((b.vol_base_disponible_m3 ?? 0) / 1e6).toFixed(4)}</td>
                                                    <td className="dsk-td-num">{Number(b.pct_base_consumido ?? 0).toFixed(2)}%</td>
                                                    <td className="dsk-td-nombre">{estadoLabel}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        )}

                        {/* Entregas del día por módulo — base y adicional */}
                        {entregasHoy.length > 0 && (
                        <div className="dsk-section-block">
                            <div className="dsk-sub-header">
                                ENTREGAS HOY — {new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' }).format(new Date())}
                            </div>
                            <div className="dsk-table-wrap">
                                <table className="dsk-table">
                                    <thead>
                                        <tr>
                                            <th rowSpan={2}>MÓDULO</th>
                                            <th rowSpan={2}>ZONA</th>
                                            <th colSpan={3} className="dsk-th-base">BASE</th>
                                            <th colSpan={3} className="dsk-th-adic">ADICIONAL</th>
                                            <th rowSpan={2}>TOTAL m³</th>
                                        </tr>
                                        <tr>
                                            <th className="dsk-th-base-sub">m³</th>
                                            <th className="dsk-th-base-sub">L/s</th>
                                            <th className="dsk-th-base-sub">HORARIO</th>
                                            <th className="dsk-th-adic-sub">m³</th>
                                            <th className="dsk-th-adic-sub">L/s</th>
                                            <th className="dsk-th-adic-sub">MOTIVO</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(() => {
                                            // Group by (modulo_id, zona_id) so multizone modules show one row per zone
                                            const seenKeys = new Set<string>();
                                            const pairs: { mid: string; zid: string | null }[] = [];
                                            for (const e of entregasHoy as any[]) {
                                                const k = `${e.modulo_id}_${e.zona_id ?? ''}`;
                                                if (!seenKeys.has(k)) { seenKeys.add(k); pairs.push({ mid: e.modulo_id, zid: e.zona_id ?? null }); }
                                            }
                                            return pairs.map(({ mid, zid }) => {
                                                const metaPrimary = balanceModulos.find(b => b.modulo_id === mid && b.es_primaria);
                                                const metaZone = balanceModulos.find(b => b.modulo_id === mid && (zid ? b.zona_id === zid : b.es_primaria)) ?? metaPrimary;
                                                const base = entregasHoy.find((e: any) => e.modulo_id === mid && (zid ? e.zona_id === zid : true) && e.tipo_entrega === 'base');
                                                const adic = entregasHoy.find((e: any) => e.modulo_id === mid && (zid ? e.zona_id === zid : true) && e.tipo_entrega === 'adicional');
                                                const total = (base?.volumen_m3 ?? 0) + (adic?.volumen_m3 ?? 0);
                                                return (
                                                    <tr key={`${mid}_${zid ?? ''}`}>
                                                        <td className="dsk-td-nombre">{metaPrimary?.codigo_corto ?? mid}</td>
                                                        <td className="dsk-td-num">{metaZone?.zona_codigo ?? '—'}</td>
                                                        {/* BASE */}
                                                        <td className="dsk-td-num dsk-td--q">{base ? Number(base.volumen_m3).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                                                        <td className="dsk-td-num">{base ? Number(base.gasto_lps).toFixed(1) : '—'}</td>
                                                        <td className="dsk-td-horario">{base ? `${base.hora_inicio ?? ''}${base.hora_inicio && base.hora_fin ? '–' : ''}${base.hora_fin ?? ''}` : '—'}</td>
                                                        {/* ADICIONAL */}
                                                        <td className={`dsk-td-num${adic ? ' dsk-td--adic' : ''}`}>{adic ? Number(adic.volumen_m3).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                                                        <td className={`dsk-td-num${adic ? ' dsk-td--adic' : ''}`}>{adic ? Number(adic.gasto_lps).toFixed(1) : '—'}</td>
                                                        <td className="dsk-td-motivo">{adic?.motivo_adicional ?? '—'}</td>
                                                        {/* TOTAL */}
                                                        <td className="dsk-td-num dsk-td--q">{total > 0 ? Number(total).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                                                    </tr>
                                                );
                                            });
                                        })()}
                                    </tbody>
                                    <tfoot>
                                        <tr>
                                            <td colSpan={2} className="dsk-td--total-label">TOTAL DÍA</td>
                                            <td className="dsk-td-num dsk-td--q">
                                                {Number(entregasHoy.filter((e: any) => e.tipo_entrega === 'base').reduce((s: number, e: any) => s + Number(e.volumen_m3), 0)).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                            <td colSpan={2} />
                                            <td className="dsk-td-num dsk-td--adic">
                                                {Number(entregasHoy.filter((e: any) => e.tipo_entrega === 'adicional').reduce((s: number, e: any) => s + Number(e.volumen_m3), 0)).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                            <td colSpan={2} />
                                            <td className="dsk-td-num dsk-td--q">
                                                {Number(entregasHoy.reduce((s: number, e: any) => s + Number(e.volumen_m3), 0)).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                        )}

                        {/* Calibración M1 — estado actual */}
                        <div className="dsk-section-block">
                            <div className="dsk-sub-header">CALIBRACIÓN M1 — ESTADO ACTUAL (SKILL v3.7)</div>
                            <div className="dsk-table-wrap">
                                <table className="dsk-table">
                                    <thead>
                                        <tr><th>ESCALA</th><th>M1</th><th>FUENTE</th><th>ESTADO</th></tr>
                                    </thead>
                                    <tbody>
                                        {skillSnapshot.checkpoints.map(c => {
                                            // Derivar fuente y estado desde el valor M1 y el nombre
                                            // Fuente y estado se calculan desde los datos reales en hydraulics.ts
                                            const m1src =
                                                c.nombre === 'K-0+000'  ? 'Aforo molinete 01/06/2026' :
                                                c.nombre === 'K-23'     ? 'Estimado estructural' :
                                                c.nombre === 'K-54'     ? 'Aforo 27/04/2026' :
                                                c.nombre === 'K-62'     ? 'Aforo 27/04/2026' :
                                                c.nombre === 'K-104'    ? 'Ancla salida' :
                                                c.nombre === 'K-64'     ? 'Escala referencia' :
                                                c.nombre === 'K-94+200' ? 'Escala referencia' :
                                                'Aforo anterior';
                                            // Prioridad: estados nombrados explícitos (curados) ANTES que la
                                            // heurística M1>1.5. Si no, una escala marcada VERIFICAR con M1>1.5
                                            // se mostraría como PENDIENTE y nunca llegaría a VERIFICAR.
                                            const est =
                                                c.nombre === 'K-64' || c.nombre === 'K-94+200' ? 'REFERENCIA' :
                                                c.nombre === 'K-0+000'  ? 'RECIENTE' :
                                                c.nombre === 'K-29' || c.nombre === 'K-68' || c.nombre === 'K-87+549' ? 'VERIFICAR' :
                                                c.m1 > 1.5              ? 'PENDIENTE' :
                                                'OK';
                                            return (
                                                <tr key={c.nombre} className={est === 'PENDIENTE' ? 'dsk-tr--warn' : est === 'RECIENTE' ? 'dsk-tr--reciente' : est === 'REFERENCIA' ? 'bt-row--stale' : ''}>
                                                    <td className="dsk-td-nombre">{c.nombre}</td>
                                                    <td className="dsk-td-num dsk-td--m1">{c.m1.toFixed(4)}</td>
                                                    <td className="dsk-td-src">{m1src}</td>
                                                    <td className={`dsk-td-num ${est==='RECIENTE'?'dsk-val--green':est==='PENDIENTE'?'dsk-val--amber':est==='VERIFICAR'?'dsk-val--amber':est==='REFERENCIA'?'bt-estado--stale':''}`}>
                                                        {est==='RECIENTE'?'✓ Reciente':est==='PENDIENTE'?'⚠ Pendiente':est==='VERIFICAR'?'? Verificar':est==='REFERENCIA'?'· Referencia':'✓ OK'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <div className="dsk-nota">Cd=0.62 fijo · Cd_eff = Cd×M1 · PENDIENTE = sin aforo de campo · Recalibrar si SICA diverge &gt;5% vs aforo</div>
                        </div>

                        {/* Modelación Paralela */}
                        <div className="dsk-section-block">
                            <div className="dsk-sub-header">MODELACIÓN PARALELA — TRÁNSITO CANAL</div>
                            <div className="dsk-model-form">
                                <div className="dsk-model-input-row">
                                    <label className="dsk-model-label">Q entrada K-0 (m³/s)</label>
                                    <input
                                        type="number"
                                        className="dsk-model-input"
                                        value={modelQ0}
                                        onChange={e => setModelQ0(e.target.value)}
                                        placeholder={(skillSnapshot.balance.Q0 ?? 28).toFixed(3)}
                                        step="0.5"
                                        min="0"
                                        max="70"
                                    />
                                    <button
                                        type="button"
                                        className="dsk-btn dsk-btn--calc"
                                        onClick={() => {
                                            const q0 = parseFloat(modelQ0) || skillSnapshot.balance.Q0 || 28;
                                            // λ en vivo si el balance es confiable; si no, λ de referencia
                                            // calibrada (el simulador necesita un valor numérico).
                                            const lambda = skillSnapshot.balance.lambda ?? LAMBDA_REF;
                                            const qZonas = skillSnapshot.Q_ZONAS_REAL;
                                            const perdidasLin = lambda * 104;
                                            const q104 = Math.max(0, q0 - perdidasLin - qZonas);
                                            const ef = q0 > 0 ? (q0 - Math.max(0, perdidasLin)) / q0 * 100 : 0;
                                            const transitH = 13.87 / Math.sqrt(Math.max(q0, 1) / 28);
                                            setModelResult({ q104, qZonas, perdidasLin, ef, transitH });
                                        }}
                                    >
                                        Calcular
                                    </button>
                                </div>
                                {modelResult && (
                                    <div className="dsk-model-results">
                                        <div className="dsk-model-res-item">
                                            <span className="dsk-model-res-label">Extracciones Z1–Z4</span>
                                            <span className="dsk-model-res-val dsk-val--amber">{modelResult.qZonas.toFixed(3)} m³/s</span>
                                        </div>
                                        <div className="dsk-model-res-item">
                                            <span className="dsk-model-res-label">Pérdidas lineales (λ×104)</span>
                                            <span className="dsk-model-res-val dsk-val--amber">{modelResult.perdidasLin.toFixed(3)} m³/s</span>
                                        </div>
                                        <div className="dsk-model-res-item">
                                            <span className="dsk-model-res-label">Q estimado K-104</span>
                                            <span className="dsk-model-res-val dsk-val--blue">{modelResult.q104.toFixed(3)} m³/s</span>
                                        </div>
                                        <div className="dsk-model-res-item">
                                            <span className="dsk-model-res-label">Eficiencia conducción</span>
                                            <span className={`dsk-model-res-val ${modelResult.ef >= 95 ? 'dsk-val--green' : modelResult.ef >= 90 ? 'dsk-val--amber' : 'dsk-val--red'}`}>
                                                {modelResult.ef.toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="dsk-model-res-item">
                                            <span className="dsk-model-res-label">Tránsito K-0→K-104</span>
                                            <span className="dsk-model-res-val">{modelResult.transitH.toFixed(1)} h ({Math.round(modelResult.transitH * 60)} min)</span>
                                        </div>
                                    </div>
                                )}
                                <div className="dsk-nota">Q₁₀₄ = Q₀ − Q_zonas − λ×104 · Q_zonas={skillSnapshot.Q_ZONAS_REAL.toFixed(3)} m³/s · λ={(skillSnapshot.balance.lambda ?? LAMBDA_REF).toFixed(5)} m³/s·km⁻¹{skillSnapshot.balance.lambda === null ? ' (ref.)' : ''} · Tránsito ∝ 1/√(Q₀/28) calibrado a 8 min/km</div>
                            </div>
                        </div>

                        {/* Informe Skill — colapsable */}
                        <div className="dsk-section-block">
                            <button
                                type="button"
                                className="dsk-sub-header dsk-sub-header--toggle"
                                onClick={() => setShowSkillInforme(v => !v)}
                                aria-expanded={showSkillInforme ? 'true' : 'false'}
                            >
                                INFORME SKILL v3.7 — MÓDULOS Y METODOLOGÍA {showSkillInforme ? '▲' : '▼'}
                            </button>
                            {showSkillInforme && (
                                <div className="dsk-skill-informe">
                                    <div className="dsk-informe-section">
                                        <div className="dsk-informe-title">FÓRMULA BASE — GASTO POR COMPUERTA</div>
                                        <div className="dsk-informe-formula">Q = Cd × M1 × b × Σ(apertura_i) × √(2g·ΔH)</div>
                                        <div className="dsk-informe-params">Cd=0.62 · g=9.81 m/s² · b=ancho por compuerta · M1=factor calibración por escala</div>
                                    </div>
                                    <div className="dsk-informe-section">
                                        <div className="dsk-informe-title">MÓDULOS OPERATIVOS</div>
                                        <div className="dsk-modulos-grid">
                                            {/* Descripción de tramo por módulo (metadato estático);
                                                la ZONA se toma de balance_volumen_modulo (BD) para que
                                                nunca contradiga la tabla DOTACIÓN de arriba. */}
                                            {([
                                                { cod:'MOD-001', codCorto:'M1',  desc:'K-0 → K-23 · Derivaciones norte' },
                                                { cod:'MOD-002', codCorto:'M2',  desc:'K-23 → K-29 · Zona baja Conchos' },
                                                { cod:'MOD-003', codCorto:'M3',  desc:'K-29 → K-44 · Gravedad centro' },
                                                { cod:'MOD-004', codCorto:'M4',  desc:'K-44 → K-62 · Riego tradicional' },
                                                { cod:'MOD-005', codCorto:'M5',  desc:'K-62 → K-79 · Gravedad sur' },
                                                { cod:'MOD-006', codCorto:'M6',  desc:'K-79 → K-104 · Cola canal' },
                                            ] as { cod: string; codCorto: string; desc: string }[]).map(m => {
                                                const live = modulosResumen.find(r => r.codigo_corto === m.codCorto || r.modulo_id === m.cod);
                                                const zona = live?.zona_codigo || '—';
                                                return (
                                                <div key={m.cod} className="dsk-modulo-tag">
                                                    <span className="dsk-mod-code">{m.cod}</span>
                                                    <span className="dsk-mod-zona">{zona}</span>
                                                    <span className="dsk-mod-desc">{m.desc}</span>
                                                </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div className="dsk-informe-section">
                                        <div className="dsk-informe-title">INSTRUCCIONES CLAVE</div>
                                        <ul className="dsk-informe-list">
                                            <li>BL &lt; 0 = CRÍTICO: reducir entradas de inmediato</li>
                                            <li>BL 0–10 cm = PRECAUCIÓN: monitoreo continuo</li>
                                            <li>M1 &gt; 1.5 indica desgaste probable o calibración pendiente</li>
                                            <li>λ objetivo: &lt; 0.0004 m³/s·km⁻¹ (eficiencia de conducción normal)</li>
                                            <li>Aforo de campo requerido cada 30 días por escala</li>
                                            <li>Tránsito K-0 → K-104: ~14 h a Q=28 m³/s</li>
                                            <li>Recalibrar M1 cuando SICA diverge &gt;5% vs aforo</li>
                                        </ul>
                                    </div>
                                </div>
                            )}
                        </div>

                        </div>{/* /dsk-scroll-body */}

                        {/* Timestamp y acciones */}
                        <div className="dsk-footer">
                            <span className="dsk-ts">
                                {(() => {
                                    const d = new Date(skillSnapshot.timestamp);
                                    const tzLabel = d.toLocaleTimeString('es-MX', { timeZoneName: 'short', timeZone: 'America/Chihuahua' }).split(' ').pop() ?? 'CDT';
                                    const hhmm = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'America/Chihuahua' });
                                    return `Snapshot: ${hhmm} ${tzLabel}`;
                                })()}
                            </span>
                            <div className="dsk-actions">
                                <button
                                    type="button"
                                    className={`dsk-btn ${snapshotCopied ? 'dsk-btn--copied' : ''}`}
                                    onClick={() => {
                                        navigator.clipboard.writeText(JSON.stringify(skillSnapshot, null, 2));
                                        setSnapshotCopied(true);
                                        setTimeout(() => setSnapshotCopied(false), 2000);
                                    }}
                                    title="Copiar JSON al portapapeles para usar en Claude"
                                >
                                    <Copy size={11} />
                                    {snapshotCopied ? 'Copiado!' : 'Copiar JSON'}
                                </button>
                                <button
                                    type="button"
                                    className="dsk-btn dsk-btn--download"
                                    onClick={() => {
                                        const now = new Date();
                                        const cdtStr = now.toLocaleString('sv-SE', { timeZone: 'America/Chihuahua' })
                                            .replace(' ', '_').replace(/:/, 'h').replace(':', 'm').replace(/:\d+$/, '');
                                        const tzLabel = now.toLocaleTimeString('es-MX', { timeZoneName: 'short', timeZone: 'America/Chihuahua' }).split(' ').pop()?.toLowerCase() ?? 'cdt';
                                        const eventoTag = skillSnapshot.evento_activo ? `_${skillSnapshot.evento_activo.tipo.toLowerCase()}` : '_operacion';
                                        const blob = new Blob([JSON.stringify(skillSnapshot, null, 2)], { type: 'application/json' });
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement('a');
                                        a.href = url;
                                        a.download = `snapshot_${cdtStr}_${tzLabel}${eventoTag}.json`;
                                        a.click();
                                        URL.revokeObjectURL(url);
                                    }}
                                    title="Descargar snapshot JSON"
                                >
                                    <Download size={11} />
                                    Snapshot
                                </button>
                                <button
                                    type="button"
                                    className="dsk-btn dsk-btn--skill-md"
                                    onClick={() => {
                                        const a = document.createElement('a');
                                        a.href = '/datos/skill_hidraulica_v37.md';
                                        a.download = 'skill_hidraulica_v37.md';
                                        a.click();
                                    }}
                                    title="Descargar skill hidráulica completa v3.7"
                                >
                                    <Download size={11} />
                                    Skill v3.7
                                </button>
                            </div>
                        </div>
                    </div>
                    )}

                    {/* ── Pestaña TENDENCIAS ── */}
                    {/* Mismo wrapper que DATOS: .dock-skill-panel acota la altura
                        (calc(100vh - 160px)) y convierte a .dsk-scroll-body en el
                        área scrolleable real. Sin él, el contenido crece sin límite
                        y el scroll nunca se activa. */}
                    {dockTab === 'tendencias' && (
                    <div className="dock-section dock-skill-panel">
                        <div className="dock-section-header">
                            <span className="card-label">TENDENCIAS — ANÁLISIS POR PERIODO</span>
                        </div>
                        <div className="dsk-scroll-body">
                            <TendenciasPanel
                                loading={tndLoading}
                                rangoDesde={tndDesde} rangoHasta={tndHasta}
                                granularidad={tndGran}
                                onRango={onTndRango}
                                onGranularidad={setTndGran}
                                niveles={tndData.niveles}
                                volTramos={tndData.volTramos}
                                volTotal={tndData.volTotal}
                                compuertas={tndData.compuertas}
                                gasto={tndData.gasto}
                            />
                        </div>
                    </div>
                    )}

                </div>
            ) : (
                <button type="button" className="dock-minimized animate-in" onClick={() => setIsDockVisible(true)}>
                    <Activity size={20} />
                    <span>VER TABLERO TÉCNICO</span>
                </button>
            )}

            {/* Informe Operativo Diario PDF */}
            {showReport && iecData && coherenciaCanal && (
                <InformeOperativo
                    escalas={escalas}
                    coherencia={coherenciaCanal}
                    iec={iecData}
                    entregasHoy={entregasHoy}
                    balanceModulos={balanceModulos}
                    volZonas={volZonas}
                    presasData={presasData}
                    onClose={() => setShowReport(false)}
                />
            )}

            {/* Modal — Perfil Longitudinal */}
            {showPerfilModal && (
                <div className="perfil-modal-overlay" onClick={() => setShowPerfilModal(false)}>
                    <div className="perfil-modal" onClick={e => e.stopPropagation()}
                        role="dialog" aria-modal="true" aria-labelledby="perfil-modal-title">
                        <div className="perfil-modal-header">
                            <div className="perfil-modal-title">
                                <Waves size={15} className="perfil-modal-icon" />
                                <span id="perfil-modal-title" className="perfil-modal-title-text">PERFIL HIDRÁULICO — CANAL CONCHOS</span>
                                {renderStateTag()}
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
                                <span className="cpl-item cpl-green">Operativo (&lt;80% bordo)</span>
                                <span className="cpl-item cpl-amber">Alerta (80–92% bordo)</span>
                                <span className="cpl-item cpl-red">Crítico (&gt;92%) / Incoherente</span>
                                <span className="cpl-item cpl-blue">Bajo / sin rango op.</span>
                                <span className="cpl-item cpl-bordo">— — Bordo real por escala</span>
                                <span className="cpl-item cpl-trend">▲ sube · ▼ baja · — estable (Δ12h)</span>
                                {fgvData && <span className="cpl-item cpl-fgv" title="Superficie libre calculada por el modelo de Flujo Gradualmente Variado para el caudal actual">— — FGV · perfil teórico (modelo)</span>}
                                {fgvData?.criticos?.length > 0 && <span className="cpl-item cpl-jump">| Salto hidráulico</span>}
                            </div>
                            {fgvData && (
                                <div className="fgv-stat-grid">
                                    <div className="fgv-stat">
                                        <span className="fgv-stat-label">Q ENTRADA</span>
                                        <span className="fgv-stat-val fgv-stat--cyan">{fgvData.q_entrada != null ? fgvData.q_entrada.toFixed(1) : '—'}<small>m³/s</small></span>
                                    </div>
                                    <div className="fgv-stat">
                                        <span className="fgv-stat-label">Q SALIDA</span>
                                        <span className="fgv-stat-val fgv-stat--blue">{fgvData.q_salida != null ? fgvData.q_salida.toFixed(1) : '—'}<small>m³/s</small></span>
                                    </div>
                                    <div className="fgv-stat">
                                        <span className="fgv-stat-label">EF. CONDUCCIÓN</span>
                                        <span className={`fgv-stat-val ${fgvData.eficiencia_conduccion == null ? '' : fgvData.eficiencia_conduccion >= 95 ? 'fgv-stat--green' : fgvData.eficiencia_conduccion >= 90 ? 'fgv-stat--amber' : 'fgv-stat--red'}`}>
                                            {fgvData.eficiencia_conduccion != null ? fgvData.eficiencia_conduccion.toFixed(1) : '—'}<small>%</small>
                                        </span>
                                    </div>
                                    <div className="fgv-stat">
                                        <span className="fgv-stat-label">TRÁNSITO K-0→104</span>
                                        <span className="fgv-stat-val">{fgvData.transit_time_h != null ? fgvData.transit_time_h.toFixed(1) : '—'}<small>h</small></span>
                                    </div>
                                    {fgvData.criticos?.length > 0 && (
                                        <div className="fgv-stat fgv-stat--critbox">
                                            <span className="fgv-stat-label">PUNTOS CRÍTICOS</span>
                                            <span className="fgv-stat-val fgv-stat--red">⚠ {fgvData.criticos.length}</span>
                                        </div>
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
