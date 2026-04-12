import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Waves, Play, Pause, RotateCcw, FileText,
  AlertTriangle, AlertOctagon, CheckCircle,
  Clock, ArrowUp, ArrowDown, TrendingUp, TrendingDown,
  Droplets, Activity, Zap, Eye, EyeOff,
} from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import { supabase } from '../lib/supabase';
import { onTable } from '../lib/realtimeHub';
import { getTodayString, addDays, formatTime, formatDate } from '../utils/dateHelpers';
import SimulationReport from '../components/SimulationReport';
import { calcIEC, iecColor } from '../utils/canalIndex';
import './ModelingDashboard.css';

// ── CONSTANTES HIDRÁULICAS ──────────────────────────────────────────────
const G         = 9.81;
const MANNING_N = 0.015;
const PLANTILLA = 20;       // m — plantilla Canal Principal Conchos
const TALUD_Z   = 1.5;
const FREEBOARD = 3.2;      // m — bordo libre operativo
const CD_GATE   = 0.70;
const RIVER_KM  = 36;
const S0_CANAL  = 0.00016;
// LÍMITES OPERATIVOS DE ESCALA (nivel del agua en metros)
// Cada sección del canal puede tener límites diferentes según su función.
// K-0 a K-80: [2.80, 3.50] — tomas laterales necesitan carga mínima de 2.80m para servicio.
// K-104 (cola): [2.40, 2.55] — final del canal, opera con tirante menor sin tomas críticas.
function getOpLimits(km: number): { yMin: number; yMax: number } {
  if (km >= 100) return { yMin: 2.40, yMax: 2.55 };  // K-104 final del canal
  return { yMin: 2.80, yMax: 3.50 };                  // Red general
}

const DEFAULT_CPS = [
  { id: 'k0',   nombre: 'K-0  Inicio Canal',  km: 0,   pzas_radiales: 4, ancho: 12 },
  { id: 'k23',  nombre: 'K-23 Derivadora',    km: 23,  pzas_radiales: 3, ancho: 10 },
  { id: 'k34',  nombre: 'K-34 Compuerta',     km: 34,  pzas_radiales: 3, ancho: 10 },
  { id: 'k57',  nombre: 'K-57 Sección S3',    km: 57,  pzas_radiales: 2, ancho: 8  },
  { id: 'k80',  nombre: 'K-80 Sección S4',    km: 80,  pzas_radiales: 2, ancho: 8  },
  { id: 'k104', nombre: 'K-104 Final Canal',  km: 104, pzas_radiales: 1, ancho: 6  },
];

type EventType   = 'INCREMENTO' | 'DECREMENTO' | 'CORTE' | 'LLENADO';
type CPStatus    = 'ESTABLE' | 'ALERTA' | 'CRITICO';
type RemansoType = 'M1' | 'M2' | 'NORMAL';

interface ControlPoint {
  id: string; nombre: string; km: number;
  pzas_radiales: number; ancho: number;
  coeficiente_descarga?: number;  // Cd real por escala (de tabla escalas)
  nivel_max_op?: number;           // Nivel máximo operativo
}

interface CPResult {
  id: string; nombre: string; km: number;
  y_base: number; q_base: number; y_sim: number; q_sim: number;
  delta_y: number; remanso_type: RemansoType; status: CPStatus;
  transit_min: number; cumulative_min: number; arrival_time: string;
  celerity_ms: number; velocity_ms: number; froude_n: number;
  bordo_libre_pct: number; h_radial: number;
  // Técnico: parámetros hidráulicos de la compuerta
  head_base: number; head_sim: number; head_delta: number;
  cd_used: number; area_gate: number;
  // LÍMITES OPERATIVOS y apertura requerida para mantener escala en rango [2.8, 3.5]m
  y_target:           number;   // nivel objetivo operativo (clamped a [Y_MIN_OP, Y_MAX_OP])
  apertura_base:      number;   // apertura actual de la compuerta (m)
  apertura_requerida: number;   // apertura para mantener y_target con Q simulado
  delta_apertura:     number;   // apertura_requerida - apertura_base (+abrir, -cerrar)
  // Extracción real por puntos de entrega en este tramo (de reportes_diarios)
  q_extraido:      number;
  n_tomas_activas: number;
  // Geometría de diseño del tramo
  plantilla_m:      number;
  tirante_diseno_m: number;
  bordo_libre_m:    number;
  canal_depth_m:    number;
  capacidad_diseno_m3s: number;
  pct_capacidad_diseno: number;
  // Ancla de compuerta
  q_gate_m3s:   number | null;
  gate_anchored: boolean;
  // Propagación temporal del frente de onda
  wave_pct:        number;
  wave_arrived:    boolean;
  maniobra_time:   string;
}

// Datos de telemetría base por punto de control (de SICA Capture)
interface CPTelemetry {
  delta_12h:    number;
  lectura_am:   number | null;
  lectura_pm:   number | null;
  hora_am:      string | null;
  hora_pm:      string | null;
  gasto_medido: number | null;
  apertura_real: number | null;   // apertura_radiales_m de lecturas_escalas
}

// Punto de entrega activo con volumen del día (de reportes_diarios + puntos_entrega)
interface DeliveryData {
  punto_id:      string;
  nombre:        string;
  km:            number;   // posición en el canal
  tipo:          string;   // 'toma' | 'lateral' | 'carcamo'
  caudal_m3s:    number;   // caudal promedio extraído hoy (m³/s)
  volumen_mm3:   number;   // volumen acumulado hoy (Mm³)
  hora_apertura: string | null;
  estado:        string;
  modulo_nombre: string | null;
  is_active:     boolean;  // apertura activa en este momento (sin hora_cierre)
}

// Estado de fuente de datos
interface DataStatus {
  dam:              boolean;  // true = movimientos_presas / lecturas_presas en vivo
  gates:            boolean;  // true = apertura_radiales_m de SICA Capture
  levels:           boolean;  // true = lecturas AM o lecturas_escalas de hoy
  deliveries:       boolean;  // true = reportes_diarios del día disponibles
  timestamp:        string;
  damBaseValue:     number;   // Q del PRIMER movimiento del día (referencia hidráulica)
  damCurrentValue:  number;   // Q del ÚLTIMO movimiento del día (estado actual)
  damNivel:         string;   // escala msnm de la presa (o hora del primer movimiento)
  damFuente:        string;   // 'movimientos_presas' | 'lecturas_presas' | 'estimado'
  totalExtractionM3s: number; // suma total de caudales activos en puntos de entrega hoy
  qRealK0?:      number;  // gasto real medido en K-0+000 (SICA Capture)
  perfilFuente?: string;  // fuente_q_entrada del perfil hidráulico RPC
  perfilQ?:      number;  // q_m3s en K-0 del perfil hidráulico RPC
}

// Balance hídrico por tramo (fn_balance_hidrico_tramos)
interface BalanceTramo {
  km_inicio:           number;
  km_fin:              number;
  escala_entrada:      string;
  escala_salida:       string;
  q_entrada_m3s:       number;
  q_salida_m3s:        number;
  q_tomas_registradas: number;
  q_fuga_detectada:    number;
  estado_balance:      'FUGA_ALTA' | 'FUGA_MEDIA' | 'INCONSISTENCIA' | 'BALANCEADO';
}

// ── GEOMETRÍA POR TRAMO ──────────────────────────────────────────────────
interface TramoGeom {
  km_inicio:           number;
  km_fin:              number;
  plantilla_m:         number;
  talud_z:             number;
  rugosidad_n:         number;
  pendiente_s0:        number;
  tirante_diseno_m:    number;
  capacidad_diseno_m3s: number;
  bordo_libre_m:       number;
}

/** Devuelve la geometría del tramo que contiene el km dado.
 *  Si no hay dato para ese km usa los fallbacks globales. */
function findTramo(km: number, tramos: TramoGeom[]): TramoGeom {
  const t = tramos.find(t => km >= t.km_inicio && km <= t.km_fin);
  return t ?? {
    km_inicio: 0, km_fin: 999,
    plantilla_m: PLANTILLA, talud_z: TALUD_Z,
    rugosidad_n: MANNING_N, pendiente_s0: S0_CANAL,
    tirante_diseno_m: 2.5, capacidad_diseno_m3s: 62,
    bordo_libre_m: FREEBOARD,
  };
}

// ── HIDRÁULICA ──────────────────────────────────────────────────────────
function normalDepth(Q: number, S = S0_CANAL, b = PLANTILLA, z = TALUD_Z, n = MANNING_N): number {
  if (Q <= 0) return 0.1;
  let y = Math.max(0.2, Q / (b * 1.5));
  for (let i = 0; i < 50; i++) {
    const A  = (b + z * y) * y;
    const P  = b + 2 * y * Math.sqrt(1 + z * z);
    const R  = A / P;
    const Qc = (1 / n) * A * R ** (2 / 3) * Math.sqrt(S);
    if (Math.abs(Qc - Q) < 0.001) break;
    const dA = b + 2 * z * y;
    const dP = 2 * Math.sqrt(1 + z * z);
    const dR = (dA * P - A * dP) / (P * P);
    const dQ = (1 / n) * Math.sqrt(S) * (dA * R ** (2 / 3) + A * (2 / 3) * R ** (-1 / 3) * dR);
    if (Math.abs(dQ) < 1e-10) break;
    y = Math.max(0.05, y - (Qc - Q) / dQ);
  }
  return y;
}

/** Tirante crítico (Fr=1) por Newton-Raphson.
 *  F(y) = Q²·T(y) − g·A(y)³ = 0
 *  F'(y) = Q²·2z − 3g·A²·(b+2zy) */
function criticalDepth(Q: number, b = PLANTILLA, z = TALUD_Z): number {
  if (Q <= 0) return 0.1;
  let y = Math.max(0.1, Q / (b * 2));
  for (let i = 0; i < 50; i++) {
    const A = (b + z * y) * y;
    const T = b + 2 * z * y;
    const F = Q * Q * T - G * A * A * A;
    const dF = Q * Q * 2 * z - 3 * G * A * A * (b + 2 * z * y);
    if (Math.abs(F) < 0.001 || Math.abs(dF) < 1e-10) break;
    y = Math.max(0.05, y - F / dF);
  }
  return y;
}

function waveCelerity(y: number, b = PLANTILLA, z = TALUD_Z): number {
  const A = (b + z * y) * y;
  const T = b + 2 * z * y;
  return Math.sqrt(G * A / T);
}

function fmtTime(baseMin: number, addMin: number): string {
  const t = (baseMin + addMin) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}

// Convierte cualquier valor a número seguro. Si es null/undefined/"NaN"/Infinity
// devuelve el fallback para que nunca llegue un NaN al motor hidráulico ni a la UI.
function safeFloat(val: unknown, fallback = 0): number {
  const n = typeof val === 'number' ? val : parseFloat(String(val ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

function transitLabel(min: number): string {
  if (min < 1) return 'Inmediatamente';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h === 0 ? `${m} min` : `${h}h ${m < 10 ? '0' : ''}${m}min`;
}

function deltaLabel(dy: number): string {
  const cm = Math.abs((dy ?? 0) * 100);
  if (cm < 1.5) return 'Sin cambio';
  return `${(dy ?? 0) > 0 ? 'Sube' : 'Baja'} ${cm.toFixed(0)} cm`;
}

function statusColor(s: CPStatus): string {
  return s === 'CRITICO' ? '#ef4444' : s === 'ALERTA' ? '#f59e0b' : '#10b981';
}

// ── SECCIÓN TRANSVERSAL SVG — usa geometría real del tramo ──────────────
const CanalSection: React.FC<{
  yBase:     number;
  ySim:      number;
  plantilla?: number;
  talud?:    number;
  freeboard?: number;
}> = ({ yBase, ySim, plantilla = PLANTILLA, talud = TALUD_Z, freeboard = FREEBOARD }) => {
  const W = 240, H = 130;
  const CX = W / 2, BY = H - 18;
  const VPM = (H - 32) / freeboard;
  const HPM = (W - 40) / (plantilla + 2 * talud * freeboard);

  const bxL  = CX - (plantilla / 2) * HPM;
  const bxR  = CX + (plantilla / 2) * HPM;
  const fbY  = BY - freeboard * VPM;
  const fbxL = bxL - talud * freeboard * HPM;
  const fbxR = bxR + talud * freeboard * HPM;

  // Zona alerta (75%) y crítico (92%)
  const alertY = BY - (freeboard * 0.75) * VPM;
  const critY  = BY - (freeboard * 0.92) * VPM;

  const sY   = Math.max(0.05, Math.min(ySim,  freeboard));
  const bY   = Math.max(0.05, Math.min(yBase, freeboard));
  const swY  = BY - sY * VPM;
  const swxL = CX - (plantilla / 2 + talud * sY) * HPM;
  const swxR = CX + (plantilla / 2 + talud * sY) * HPM;
  const bwY  = BY - bY * VPM;
  const bwxL = CX - (plantilla / 2 + talud * bY) * HPM;
  const bwxR = CX + (plantilla / 2 + talud * bY) * HPM;

  const pct = sY / freeboard;
  const sc  = statusColor(pct > 0.92 ? 'CRITICO' : pct > 0.75 ? 'ALERTA' : 'ESTABLE');
  const borda = (freeboard - sY).toFixed(2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: H }}>
      <defs>
        <linearGradient id="waterGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={sc} stopOpacity="0.35" />
          <stop offset="100%" stopColor={sc} stopOpacity="0.06" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="#050e1a" rx="6" />
      {/* Zona crítica (92%) */}
      <rect x={fbxL} y={critY} width={fbxR - fbxL} height={alertY - critY}
        fill="rgba(239,68,68,0.06)" />
      {/* Zona alerta (75%-92%) */}
      <rect x={fbxL} y={alertY} width={fbxR - fbxL} height={BY - alertY - freeboard * 0.75 * VPM * 0.01}
        fill="rgba(245,158,11,0.04)" />
      {/* Taludes */}
      <polygon points={`${fbxL},${fbY} ${bxL},${BY} ${bxR},${BY} ${fbxR},${fbY}`}
        fill="rgba(30,41,59,0.5)" stroke="#334155" strokeWidth="1.5" />
      {/* Plantilla (fondo) */}
      <rect x={bxL} y={BY} width={bxR - bxL} height={5} fill="#1e293b" />
      {/* Agua simulada */}
      <polygon points={`${swxL},${swY} ${swxR},${swY} ${bxR},${BY} ${bxL},${BY}`}
        fill="url(#waterGrad)" />
      {/* Superficie simulada */}
      <line x1={swxL} y1={swY} x2={swxR} y2={swY} stroke={sc} strokeWidth="2.5"
        style={{ filter: `drop-shadow(0 0 3px ${sc}66)` }} />
      {/* Nivel base (punteado) */}
      {Math.abs(sY - bY) > 0.02 && (
        <line x1={bwxL} y1={bwY} x2={bwxR} y2={bwY} stroke="#38bdf8"
          strokeWidth="1.5" strokeDasharray="5,3" opacity="0.55" />
      )}
      {/* Línea alerta (75%) */}
      <line x1={fbxL + 4} y1={alertY} x2={fbxR - 4} y2={alertY}
        stroke="#d97706" strokeWidth="0.8" strokeDasharray="4,3" opacity="0.5" />
      {/* Bordo libre */}
      <line x1={fbxL} y1={fbY} x2={fbxR} y2={fbY}
        stroke="#ef4444" strokeWidth="1" strokeDasharray="6,4" opacity="0.5" />
      {/* Cota del agua */}
      <text x={swxR + 4} y={swY + 4} fill={sc} fontSize="9.5" fontFamily="monospace" fontWeight="bold">
        {ySim.toFixed(2)}m
      </text>
      {Math.abs(sY - bY) > 0.02 && (
        <text x={bwxR + 4} y={bwY + 4} fill="#38bdf8" fontSize="8" fontFamily="monospace">
          {yBase.toFixed(2)}m
        </text>
      )}
      {/* Bordo libre (cota máxima del canal) */}
      <text x={W - 6} y={fbY - 4} fill="#ef4444" fontSize="7.5" fontFamily="monospace" textAnchor="end">
        H={freeboard.toFixed(1)}m
      </text>
      <text x={W - 6} y={fbY + 9} fill={sc} fontSize="8" fontFamily="monospace" fontWeight="bold" textAnchor="end">
        ▲ {borda}m libre
      </text>
      {/* Info tramo */}
      <text x={CX} y={H - 4} fill="#334155" fontSize="7.5" fontFamily="monospace" textAnchor="middle">
        b={plantilla}m · z={talud}:1 · H={freeboard.toFixed(1)}m
      </text>
      {/* Barra % bordo libre */}
      <rect x={bxL} y={BY + 3} width={bxR - bxL} height={3} fill="#0d1f38" rx="1" />
      <rect x={bxL} y={BY + 3} width={(bxR - bxL) * Math.min(1, pct)} height={3}
        fill={sc} rx="1" />
    </svg>
  );
};

// ── FASE 3: MOTOR DE DECISIÓN HIDRÁULICA ────────────────────────────────
type DecisionPrioridad = 'URGENTE' | 'ALERTA' | 'INFO';
type DecisionTipo      = 'APERTURA' | 'CIERRE' | 'CAUDAL_PRESA' | 'MONITOREO' | 'OPERATIVO';

interface Decision {
  prioridad:     DecisionPrioridad;
  tipo:          DecisionTipo;
  punto:         string;
  km:            number;
  accion:        string;
  detalle:       string;
  valor_actual:  string;
  valor_meta:    string;
}

function generateDecisions(
  simResults:   CPResult[],
  qDam:         number,
  qBase:        number,
  gateBase:     Record<string, number>,
  cpTelemetry:  Record<string, CPTelemetry>,
  dataStatus:   DataStatus,
  eventType:    EventType,
): Decision[] {
  const decisions: Decision[] = [];
  const deltaQ = qDam - qBase;

  // R1: Sin telemetría de presa — incertidumbre en la base de simulación
  if (!dataStatus.dam) {
    decisions.push({
      prioridad: 'INFO', tipo: 'MONITOREO',
      punto: 'Sistema', km: 0,
      accion: 'Sin telemetría de Presa Boquilla',
      detalle: 'Simulación basada en estimados de escala K-0. Verificar conexión de datos.',
      valor_actual: dataStatus.damFuente, valor_meta: 'movimientos_presas',
    });
  }

  // R8: CORTE total — alerta de ola negativa (prioridad máxima, va primero)
  if (eventType === 'CORTE' && qDam < 5) {
    decisions.push({
      prioridad: 'URGENTE', tipo: 'OPERATIVO',
      punto: 'Canal completo', km: 0,
      accion: 'CORTE TOTAL — ola negativa en tránsito',
      detalle: 'Cerrar gradualmente todas las tomas de cabeza a cola para evitar daño en estructuras.',
      valor_actual: `${qDam.toFixed(1)} m³/s`,
      valor_meta: 'Cierre escalonado',
    });
  }

  simResults.forEach((r, idx) => {
    const gateActual = gateBase[r.id] ?? r.h_radial;
    const aperReq    = Math.min(3.0, Math.max(0.1, r.apertura_requerida));
    const aperDelta  = r.delta_apertura ?? (aperReq - gateActual);
    const tel        = cpTelemetry[r.id];

    // R2: Nivel CRÍTICO — acción inmediata
    if (r.status === 'CRITICO') {
      decisions.push({
        prioridad: 'URGENTE', tipo: deltaQ > 0 ? 'CAUDAL_PRESA' : 'APERTURA',
        punto: r.nombre, km: r.km,
        accion: deltaQ > 0
          ? `REDUCIR gasto o ABRIR ${r.nombre}`
          : `ABRIR compuerta ${r.nombre}`,
        detalle: `Bordo libre al ${r.bordo_libre_pct.toFixed(0)}% — margen restante ${(r.bordo_libre_m - r.y_sim).toFixed(2)} m`,
        valor_actual: `${r.y_sim.toFixed(2)} m`,
        valor_meta:   `< ${(r.bordo_libre_m * 0.75).toFixed(2)} m`,
      });
    }

    // R3: Nivel ALERTA
    else if (r.status === 'ALERTA') {
      decisions.push({
        prioridad: 'ALERTA', tipo: 'MONITOREO',
        punto: r.nombre, km: r.km,
        accion: `Vigilar escala ${r.nombre}`,
        detalle: `${r.bordo_libre_pct.toFixed(0)}% del bordo libre — tendencia ${r.delta_y > 0 ? 'ascendente' : 'descendente'}`,
        valor_actual: `${r.y_sim.toFixed(2)} m`,
        valor_meta:   `< ${(r.bordo_libre_m * 0.75).toFixed(2)} m`,
      });
    }

    // R4: Ajuste de apertura significativo requerido
    // Usa delta_apertura del motor (calculado con límites operativos [2.8, 3.5])
    if (Math.abs(deltaQ) > 0.5 && Math.abs(aperDelta) > 0.05) {
      decisions.push({
        prioridad: Math.abs(aperDelta) > 0.40 ? 'ALERTA' : 'INFO',
        tipo:      aperDelta > 0 ? 'APERTURA' : 'CIERRE',
        punto: r.nombre, km: r.km,
        accion: `${aperDelta > 0 ? 'ABRIR' : 'CERRAR'} radiales ${r.nombre}`,
        detalle: `Para mantener escala en ${(r.y_target ?? r.y_base).toFixed(2)} m [rango 2.80–3.50] con Q = ${r.q_sim.toFixed(1)} m³/s`,
        valor_actual: `${gateActual.toFixed(2)} m`,
        valor_meta:   `${aperReq.toFixed(2)} m (${aperDelta > 0 ? '+' : ''}${aperDelta.toFixed(2)} m)`,
      });
    }

    // R5: Tendencia 12h creciente sin incremento de presa
    if (tel?.delta_12h != null && tel.delta_12h > 0.025 && deltaQ <= 0) {
      decisions.push({
        prioridad: 'ALERTA', tipo: 'MONITOREO',
        punto: r.nombre, km: r.km,
        accion: `Escala en ascenso — ${r.nombre}`,
        detalle: `+${(tel.delta_12h * 100).toFixed(0)} cm en 12h sin incremento de gasto — posible restricción aguas abajo`,
        valor_actual: `+${(tel.delta_12h * 100).toFixed(0)} cm/12h`,
        valor_meta:   '< 1 cm/12h',
      });
    }

    // R6: Número de Froude elevado
    if (r.froude_n > 0.70) {
      decisions.push({
        prioridad: r.froude_n > 0.90 ? 'ALERTA' : 'INFO',
        tipo: 'MONITOREO',
        punto: r.nombre, km: r.km,
        accion: `Flujo acelerado en ${r.nombre}`,
        detalle: `Fr = ${r.froude_n.toFixed(3)} — riesgo de resalto hidráulico aguas abajo`,
        valor_actual: `Fr ${r.froude_n.toFixed(3)}`,
        valor_meta:   'Fr < 0.70',
      });
    }

    // R7: Pérdida excesiva entre tramos consecutivos
    if (idx > 0) {
      const prev     = simResults[idx - 1];
      const loss     = prev.q_sim - r.q_sim;
      const lossPct  = prev.q_sim > 0 ? loss / prev.q_sim : 0;
      if (lossPct > 0.20 && loss > 3) {
        decisions.push({
          prioridad: 'ALERTA', tipo: 'MONITOREO',
          punto: `K${prev.km}–K${r.km}`, km: r.km,
          accion: `Pérdida elevada tramo K${prev.km}–K${r.km}`,
          detalle: `−${loss.toFixed(1)} m³/s (${(lossPct * 100).toFixed(0)}%) — verificar tomas no reportadas o infiltración`,
          valor_actual: `−${(lossPct * 100).toFixed(0)}%`,
          valor_meta:   '< 20%',
        });
      }
    }
  });

  // R9: Sin decisiones — confirmar estabilidad del sistema
  if (decisions.length === 0) {
    decisions.push({
      prioridad: 'INFO', tipo: 'OPERATIVO',
      punto: 'Sistema', km: 0,
      accion: 'Sistema hidráulico estable',
      detalle: `Q = ${qDam.toFixed(1)} m³/s · Todos los puntos dentro de parámetros normales`,
      valor_actual: 'ESTABLE', valor_meta: 'ESTABLE',
    });
  }

  // Ordenar: URGENTE → ALERTA → INFO, luego por km
  const order: Record<DecisionPrioridad, number> = { URGENTE: 0, ALERTA: 1, INFO: 2 };
  decisions.sort((a, b) => order[a.prioridad] - order[b.prioridad] || a.km - b.km);
  return decisions;
}

// ── MOTOR DE SIMULACIÓN PURO (reutilizable para multi-escenario) ─────────
// currentTimeMin: hora actual del sistema en minutos desde medianoche
// simBaseMin: hora del ÚLTIMO movimiento de presa (no la hora del sistema)
function runSimulation(
  controlPoints:  ControlPoint[],
  qDamInit:       number,
  qBaseInit:      number,
  baseReadings:   Record<string, number>,
  gateOverrides:  Record<string, number>,
  gastoMedido:    Record<string, number>,
  deliveryPoints: DeliveryData[],
  tramoGeom:      TramoGeom[],
  riverTransit:   boolean,
  simBaseMin:     number,
  currentTimeMin: number,
): CPResult[] {
  let qCur     = qDamInit,  cumMin = 0;
  let qBaseCur = qBaseInit;

  // Minutos transcurridos desde el movimiento de presa hasta hora actual
  const elapsedMin = ((currentTimeMin - simBaseMin) + 1440) % 1440;

  if (riverTransit) {
    const vRio = 0.5 * Math.pow(Math.max(qDamInit, 1), 0.4) + 0.5;
    cumMin += (RIVER_KM * 1000 / vRio) / 60;
  }

  // Margen de anticipación para maniobra (minutos antes del arribo)
  const MANIOBRA_MARGEN_MIN = 30;

  return controlPoints.map((cp, idx) => {
    const kmCp   = safeFloat(cp.km, idx * 17);
    const kmPrev = idx === 0 ? 0 : safeFloat(controlPoints[idx - 1].km, (idx - 1) * 17);
    const dist   = Math.max(1, idx === 0 ? kmCp : kmCp - kmPrev);

    const kmMid    = idx === 0 ? kmCp : (kmPrev + kmCp) / 2;
    const tramo    = findTramo(kmMid, tramoGeom);
    const b_tramo  = tramo.plantilla_m;
    const z_tramo  = tramo.talud_z;
    const n_tramo  = tramo.rugosidad_n;
    const s_tramo  = tramo.pendiente_s0;
    const fb_tramo = tramo.bordo_libre_m;
    const qdis     = tramo.capacidad_diseno_m3s;

    const y_base = (baseReadings[cp.id] && baseReadings[cp.id] > 0.05)
      ? baseReadings[cp.id]
      : Math.max(0.3, 2.2 - idx * 0.04);

    // Cálculos hidráulicos con Q nuevo (estado final)
    const y_n   = normalDepth(qCur, s_tramo, b_tramo, z_tramo, n_tramo);
    const c     = waveCelerity(y_n, b_tramo, z_tramo);
    const A_n   = (b_tramo + z_tramo * y_n) * y_n;
    const v_n   = A_n > 0 ? qCur / A_n : 0;
    const Fr    = v_n / Math.max(0.001, Math.sqrt(G * Math.max(0.01, y_n)));

    // ── VELOCIDAD DE PROPAGACIÓN CALIBRADA EMPÍRICAMENTE ────────────────
    // En un canal regulado con compuertas cada ~10-20 km, la onda de maniobra
    // NO viaja a la velocidad cinemática teórica (v + c ≈ 5-6 m/s).
    // Las compuertas, cambios de sección y rugosidad frenan la propagación.
    // Calibración empírica con datos operativos del Canal Conchos:
    //   K-0 → K-23 (23 km): ~3h 00min ≈ 7.7 km/h ≈ 2.1 m/s
    //   K-0 → K-104 (104 km): ~13h 40min
    // Modelo: v_onda = 5.3 × Q^0.15 [km/h]
    //   v_onda(Q=28) = 5.3 × 28^0.15 ≈ 7.6 km/h → K23 en 3.0h ✓
    //   v_onda(Q=34) = 5.3 × 34^0.15 ≈ 7.9 km/h → K23 en 2.9h ✓
    const V_WAVE_BASE_KMH = 5.3;
    const v_wave_kmh = V_WAVE_BASE_KMH * Math.pow(Math.max(qCur, 1), 0.15);
    const travelSpd  = v_wave_kmh / 3.6; // convertir km/h → m/s
    const transit_min = (dist * 1000) / travelSpd / 60;

    const cd_used   = safeFloat(cp.coeficiente_descarga, CD_GATE) || CD_GATE;
    const pzas      = Math.max(1, safeFloat(cp.pzas_radiales, 1));
    const ancho     = Math.max(1, safeFloat(cp.ancho, 8));
    const has_real_gate = safeFloat(gateOverrides[cp.id], 0) > 0;
    const h_gate    = has_real_gate
      ? safeFloat(gateOverrides[cp.id], 1.25)
      : Math.max(0.3, pzas > 0 ? 1.25 : 1.0);
    const area_gate = Math.max(0.01, ancho * pzas * h_gate);

    const gm = safeFloat(gastoMedido[cp.id], 0);
    const q_gate_m3s: number | null = (gm > 0) ? +gm.toFixed(3) : null;

    const head_base  = Math.pow(Math.max(qBaseCur, 0.1) / (cd_used * area_gate), 2) / (2 * G);
    const head_sim   = Math.pow(Math.max(qCur,     0.1) / (cd_used * area_gate), 2) / (2 * G);
    const head_delta = head_sim - head_base;

    const td_tramo   = tramo.tirante_diseno_m;
    const canal_depth = td_tramo + fb_tramo;

    const y_sim_mn2  = normalDepth(qCur, s_tramo, b_tramo, z_tramo, n_tramo);

    // ── PISO DE SERVICIO: la escala simulada NO puede caer más del 10%     ──
    // ── de la escala actual real. Esto garantiza continuidad de servicio   ──
    // ── a tomas altas y laterales. La operación busca ESTABILIDAD, no     ──
    // ── equilibrio hidráulico puro (Manning).                             ──
    const { yMin: yMinOp, yMax: yMaxOp } = getOpLimits(kmCp);
    const y_floor_service = y_base * 0.90;   // máx 10% de caída permitida
    const y_floor = Math.max(yMinOp, y_floor_service);

    const y_sim_capped = Math.max(y_floor, Math.min(y_sim_mn2, canal_depth - 0.08));
    const y_sim_final = Math.max(0.1, Math.min(y_sim_capped, Math.max(y_base, yMaxOp)));

    // ── APERTURA REQUERIDA para MANTENER la escala estabilizada ──────────
    const y_target       = Math.max(y_floor, Math.min(yMaxOp, y_base));
    const sqrtHead       = Math.sqrt(2 * G * Math.max(0.01, y_target));
    const apertura_base  = has_real_gate ? h_gate : Math.max(0.3, h_gate);
    const apertura_requerida_raw = qCur / Math.max(0.001, cd_used * ancho * pzas * sqrtHead);
    const apertura_requerida = Math.max(0.05, Math.min(3.5, apertura_requerida_raw));
    const delta_apertura = apertura_requerida - apertura_base;

    cumMin += transit_min;

    // ── PROPAGACIÓN TEMPORAL: frente de onda ────────────────────────────
    const wave_arrived = cumMin <= elapsedMin;
    let wave_pct: number;
    if (wave_arrived) {
      wave_pct = 1.0;
    } else if (elapsedMin >= (cumMin - transit_min)) {
      wave_pct = Math.max(0, (elapsedMin - (cumMin - transit_min)) / Math.max(1, transit_min));
    } else {
      wave_pct = 0;
    }

    // y_sim = nivel estabilizado con piso de servicio (no Manning puro)
    const y_sim = y_sim_final;

    const delta_y      = y_sim - y_base;
    const remanso_type: RemansoType = delta_y > 0.08 ? 'M1' : delta_y < -0.08 ? 'M2' : 'NORMAL';
    const pct          = y_sim / canal_depth;

    // ── STATUS EXPANDIDO: estado FINAL (lo que sucederá), no estado actual ──
    let status: CPStatus;
    if (pct > 0.92) {
      status = 'CRITICO';
    } else if (pct > 0.75) {
      status = 'ALERTA';
    } else if (Math.abs(delta_y) > 0.50) {
      // Cambio grande (>50cm) incluso si el tirante final no es alto → ALERTA
      // porque un descenso de >50cm deja tomas sin carga hidráulica
      status = 'ALERTA';
    } else {
      status = 'ESTABLE';
    }

    // Hora sugerida de maniobra: arribo - margen de seguridad
    const maniobraMin = Math.max(0, cumMin - MANIOBRA_MARGEN_MIN);
    const maniobra_time = idx === 0 ? 'ORIGEN' : fmtTime(simBaseMin, maniobraMin);

    const hasDelivData    = deliveryPoints.length > 0;
    const conductionK     = hasDelivData ? 0.00012 : 0.00038;
    const conductionFloor = hasDelivData ? 0.97 : 0.85;
    const conductionFactor = Math.max(conductionFloor, 1 - dist * conductionK);

    const tomasEnTramo = deliveryPoints.filter(
      dp => dp.is_active && dp.caudal_m3s > 0 && dp.km > kmPrev && dp.km <= kmCp,
    );
    const q_extraido      = tomasEnTramo.reduce((s, dp) => s + safeFloat(dp.caudal_m3s, 0), 0);
    const n_tomas_activas = tomasEnTramo.length;

    // q_sim: caudal FINAL que llegará a este punto (para planificación operativa)
    const q_sim_arribo  = qCur;
    const q_base_arribo = qBaseCur;

    qCur     = Math.max(0.1, qCur     * conductionFactor - q_extraido);
    qBaseCur = Math.max(0.1, qBaseCur * conductionFactor - q_extraido);

    let gate_anchored = false;
    if (q_gate_m3s !== null && q_gate_m3s < qCur) {
      qCur = Math.max(0.1, q_gate_m3s);
      gate_anchored = true;
    }
    if (gate_anchored && q_gate_m3s !== null) {
      qBaseCur = Math.min(qBaseCur, q_gate_m3s);
    }

    return {
      id: cp.id, nombre: cp.nombre, km: kmCp,
      y_base, q_base: q_base_arribo, y_sim, q_sim: q_sim_arribo,
      delta_y, remanso_type, status,
      transit_min, cumulative_min: cumMin,
      arrival_time: fmtTime(simBaseMin, cumMin),
      celerity_ms: c, velocity_ms: v_n, froude_n: Fr,
      bordo_libre_pct: pct * 100, h_radial: h_gate,
      head_base, head_sim, head_delta, cd_used, area_gate,
      y_target, apertura_base, apertura_requerida, delta_apertura,
      q_extraido, n_tomas_activas,
      plantilla_m: b_tramo,
      tirante_diseno_m: td_tramo,
      bordo_libre_m: fb_tramo,
      canal_depth_m: canal_depth,
      capacidad_diseno_m3s: qdis,
      pct_capacidad_diseno: qdis > 0 ? Math.min(120, (q_sim_arribo / qdis) * 100) : 0,
      q_gate_m3s, gate_anchored,
      wave_pct, wave_arrived, maniobra_time,
    };
  });
}

// ── COMPONENTE PRINCIPAL ────────────────────────────────────────────────
const ModelingDashboard: React.FC = () => {
  const [controlPoints, setControlPoints] = useState<ControlPoint[]>([]);
  const [baseReadings,  setBaseReadings]  = useState<Record<string, number>>({});
  const [gateOverrides, setGateOverrides] = useState<Record<string, number>>({});
  // Aperturas REALES de SICA Capture (lectura original, no modificada)
  const [gateBase,      setGateBase]      = useState<Record<string, number>>({});
  // Telemetría por punto: tendencia, AM/PM, gasto medido, apertura real
  const [cpTelemetry,   setCpTelemetry]   = useState<Record<string, CPTelemetry>>({});
  // Puntos de entrega activos con volúmenes del día (reportes_diarios)
  const [deliveryPoints, setDeliveryPoints] = useState<DeliveryData[]>([]);
  // Estado de fuente de datos (live vs defaults)
  const [dataStatus,    setDataStatus]    = useState<DataStatus>({
    dam: false, gates: false, levels: false, deliveries: false,
    timestamp: '',
    damBaseValue: 0, damCurrentValue: 0,
    damNivel: '—', damFuente: 'estimado',
    totalExtractionM3s: 0,
  });
  // false hasta que fetchData complete al menos una carga exitosa
  const [dataLoaded,   setDataLoaded]   = useState(false);
  // Geometría real por tramo (perfil_hidraulico_canal)
  const [tramoGeom,    setTramoGeom]    = useState<TramoGeom[]>([]);
  // Perfil hidráulico real del RPC (fn_perfil_canal_completo) para línea ámbar
  const [perfilRpc,    setPerfilRpc]    = useState<any[]>([]);
  // Balance hídrico por tramo (fn_balance_hidrico_tramos)
  const [balanceTramos, setBalanceTramos] = useState<BalanceTramo[]>([]);

  const [qDam,         setQDam]         = useState(0);
  const [qBase,        setQBase]        = useState(0);
  const [riverTransit, setRiverTransit] = useState(false);
  const [eventType,    setEventType]    = useState<EventType>('INCREMENTO');

  const [timeDelta,   setTimeDelta]  = useState(0);
  const [isPlaying,   setIsPlaying]  = useState(false);
  // T₀ = hora del ÚLTIMO movimiento de presa (no hora de apertura de la pantalla)
  const [simBaseMin,  setSimBaseMin] = useState(new Date().getHours() * 60 + new Date().getMinutes());
  // Hora actual del sistema en minutos — se actualiza cada minuto para propagación de onda
  const [currentTimeMin, setCurrentTimeMin] = useState(new Date().getHours() * 60 + new Date().getMinutes());

  const [activeCP,    setActiveCP]   = useState('');
  const [showReport,  setShowReport] = useState(false);
  const [simpleMode,  setSimpleMode] = useState(true);

  // ── FETCH — Telemetría real: primer mov. del día como base hidráulica ──
  useEffect(() => {
    const fetchData = async () => {
      // 1. Puntos de control con Cd real por estructura
      const { data: cpData } = await supabase
        .from('escalas')
        .select('id, nombre, km, pzas_radiales, ancho, coeficiente_descarga, nivel_max_operativo')
        .gt('pzas_radiales', 0)
        .order('km', { ascending: true });

      // P2-9: addDays usa noon-UTC — correcto en cambio de horario (86400000ms no cubre DST)
      const today    = getTodayString();
      const tomorrow = addDays(today, 1);

      // 2. Todas las fuentes en paralelo — 9 queries simultáneas
      const [
        { data: summary },
        { data: rawAM },        // turno AM de hoy = estado base del canal
        { data: rawLatest },    // lecturas más recientes = estado actual
        { data: firstMovPresa },// PRIMER movimiento de presa del día → qBase
        { data: lastMovPresa }, // ÚLTIMO movimiento de presa del día → qDam inicial
        { data: lecturaHoy },   // lecturas_presas hoy (respaldo)
        { data: rawReportes },  // reportes_diarios hoy → volúmenes puntos de entrega
        { data: rawPuntos },    // puntos_entrega → km de cada toma/lateral
        { data: rawPerfil },    // perfil_hidraulico_canal → geometría real por tramo
        { data: rawPerfilRpc }, // fn_perfil_canal_completo → perfil hidráulico real
        { data: rawBalance },   // fn_balance_hidrico_tramos → fugas detectadas por tramo
      ] = await Promise.all([
        // Resumen diario con AM/PM y delta 12h
        supabase.from('resumen_escalas_diario')
          .select('escala_id, nivel_actual, gasto_calculado_m3s, delta_12h, lectura_am, lectura_pm, hora_am, hora_pm')
          .eq('fecha', today),

        // Lecturas AM de hoy: nivel base que corresponde al Q inicial
        supabase.from('lecturas_escalas')
          .select('escala_id, nivel_m, apertura_radiales_m, gasto_calculado_m3s')
          .eq('fecha', today)
          .eq('turno', 'am')
          .order('hora_lectura', { ascending: true })
          .limit(50),

        // Lecturas más recientes (cualquier día) para estado actual de aperturas
        supabase.from('lecturas_escalas')
          .select('escala_id, nivel_m, apertura_radiales_m, gasto_calculado_m3s')
          .order('fecha', { ascending: false })
          .order('hora_lectura', { ascending: false })
          .limit(100),

        // PRIMER movimiento de presa hoy = Q0 base de la simulación
        supabase.from('movimientos_presas')
          .select('gasto_m3s, fecha_hora, fuente_dato')
          .gte('fecha_hora', `${today}T00:00:00`)
          .lt('fecha_hora',  `${tomorrow}T00:00:00`)
          .order('fecha_hora', { ascending: true })
          .limit(1)
          .maybeSingle(),

        // ÚLTIMO movimiento de presa (estado actual real, puede ser de días anteriores)
        supabase.from('movimientos_presas')
          .select('gasto_m3s, fecha_hora, fuente_dato')
          .order('fecha_hora', { ascending: false })
          .limit(1)
          .maybeSingle(),

        // lecturas_presas de hoy (respaldo si no hay movimientos)
        supabase.from('lecturas_presas')
          .select('extraccion_total_m3s, escala_msnm, fecha')
          .eq('fecha', today)
          .maybeSingle(),

        // Reportes diarios de hoy — caudal y volumen entregado por punto de entrega
        // Solo registros del día actual para escenario más actualizado
        supabase.from('reportes_diarios')
          .select('punto_id, punto_nombre, caudal_promedio_m3s, volumen_total_mm3, hora_apertura, hora_cierre, estado, modulo_nombre')
          .eq('fecha', today),

        // Posición km de cada punto de entrega (necesaria para ubicarlos en el canal)
        supabase.from('puntos_entrega')
          .select('id, nombre, km, tipo')
          .not('km', 'is', null)
          .order('km', { ascending: true })
          .limit(300),

        // Geometría hidráulica real por tramo — Fase 1: reemplaza constantes globales
        supabase.from('perfil_hidraulico_canal')
          .select('km_inicio, km_fin, plantilla_m, talud_z, rugosidad_n, pendiente_s0, tirante_diseno_m, capacidad_diseno_m3s, bordo_libre_m')
          .order('km_inicio', { ascending: true }),

        // Perfil hidráulico real del canal (cascada Q + GVF SQL)
        supabase.rpc('fn_perfil_canal_completo', { p_fecha: today }),

        // Balance hídrico por tramo — fugas detectadas
        supabase.rpc('fn_balance_hidrico_tramos', { p_fecha: today }),
      ]);

      // 3. Construir lista de puntos de control — safeFloat en todos los campos numéricos
      // para blindar NaN cuando Supabase devuelve null en columnas numéricas (null*n = 0, undefined*n = NaN)
      const cps: ControlPoint[] = (cpData && cpData.length > 0)
        ? cpData
            .map(c => ({
              id: c.id,
              nombre: c.nombre || `K-${c.km}`,
              km: safeFloat(c.km, NaN),
              pzas_radiales: Math.max(1, safeFloat(c.pzas_radiales, 1)),
              ancho: Math.max(1, safeFloat(c.ancho, 8)),
              coeficiente_descarga: c.coeficiente_descarga != null
                ? safeFloat(c.coeficiente_descarga, CD_GATE) : undefined,
              nivel_max_op: c.nivel_max_operativo != null
                ? safeFloat(c.nivel_max_operativo, FREEBOARD) : undefined,
            }))
            .filter(c => Number.isFinite(c.km))  // elimina registros sin KM válido
        : [...DEFAULT_CPS];

      if (!cps.some(p => p.km >= 100)) {
        cps.push({ id: 'k104', nombre: 'K-104 Final Canal', km: 104, pzas_radiales: 1, ancho: 6 });
      }
      setControlPoints(cps);
      setActiveCP(cps[0]?.id ?? '');

      // 4. y_base = lecturas más actuales de SICA Capture
      // Prioridad: rawLatest (registro más reciente de hoy/ayer) > lectura_pm (resumen) > lectura_am > rawAM
      // Se filtra v > 0.05 para evitar que lecturas 0 o nulas contaminen la base hidráulica
      const lvlMap = new Map<string, number>();
      // 1º rawLatest — el registro más reciente disponible (lectura actual del canal)
      rawLatest?.forEach(r => {
        const v = safeFloat(r.nivel_m, NaN);
        if (Number.isFinite(v) && v > 0.05) lvlMap.set(r.escala_id, v);
      });
      // 2º lectura_pm del resumen (lectura de tarde, si rawLatest no tiene dato)
      summary?.forEach(r => {
        if (!lvlMap.has(r.escala_id)) {
          const v = safeFloat(r.lectura_pm, NaN);
          if (Number.isFinite(v) && v > 0.05) lvlMap.set(r.escala_id, v);
        }
      });
      // 3º lectura_am del resumen
      summary?.forEach(r => {
        if (!lvlMap.has(r.escala_id)) {
          const v = safeFloat(r.lectura_am, NaN);
          if (Number.isFinite(v) && v > 0.05) lvlMap.set(r.escala_id, v);
        }
      });
      // 4º rawAM como último respaldo
      rawAM?.forEach(r => {
        if (!lvlMap.has(r.escala_id)) {
          const v = safeFloat(r.nivel_m, NaN);
          if (Number.isFinite(v) && v > 0.05) lvlMap.set(r.escala_id, v);
        }
      });
      const rm: Record<string, number> = {};
      cps.forEach(cp => { if (lvlMap.has(cp.id)) rm[cp.id] = lvlMap.get(cp.id)!; });

      // Overlay: RPC nivel_real_m es más preciso que lecturas_escalas raw
      // (usa nivel_abajo_m en K0+000, aplica la misma lógica que el perfil SQL)
      let rpcQ: number | null = null;
      let rpcFuente: string | null = null;
      if (rawPerfilRpc && rawPerfilRpc.length > 0) {
        const firstRow = rawPerfilRpc[0] as any;
        const fq = safeFloat(firstRow?.q_m3s, 0);
        if (fq > 0) rpcQ = fq;
        rpcFuente = firstRow?.fuente_q_entrada ?? null;
        (rawPerfilRpc as any[]).forEach(row => {
          const rpcKm   = safeFloat(row.km_ref, NaN);
          const rpcNivel = safeFloat(row.nivel_real_m, NaN);
          if (!Number.isFinite(rpcKm) || !Number.isFinite(rpcNivel) || rpcNivel <= 0.05) return;
          const cp = cps.find(c => Math.abs(c.km - rpcKm) < 2.0);
          if (cp) rm[cp.id] = rpcNivel;
        });
      }

      setBaseReadings(rm);
      setPerfilRpc(rawPerfilRpc ?? []);
      setBalanceTramos(
        ((rawBalance ?? []) as any[]).map(r => ({
          km_inicio:           safeFloat(r.km_inicio, 0),
          km_fin:              safeFloat(r.km_fin, 0),
          escala_entrada:      r.escala_entrada ?? '',
          escala_salida:       r.escala_salida  ?? '',
          q_entrada_m3s:       safeFloat(r.q_entrada_m3s, 0),
          q_salida_m3s:        safeFloat(r.q_salida_m3s, 0),
          q_tomas_registradas: safeFloat(r.q_tomas_registradas, 0),
          q_fuga_detectada:    safeFloat(r.q_fuga_detectada, 0),
          estado_balance:      r.estado_balance ?? 'BALANCEADO',
        }))
      );
      const hasLevels = Object.keys(rm).length > 0;

      // 5. Aperturas — safeFloat en todos los parseos
      const gateMapAM = new Map<string, number>();
      rawAM?.forEach(r => {
        if (!gateMapAM.has(r.escala_id)) {
          const v = safeFloat(r.apertura_radiales_m, 0);
          if (v > 0) gateMapAM.set(r.escala_id, v);
        }
      });
      const gateMapCurrent = new Map<string, number>();
      rawLatest?.forEach(r => {
        if (!gateMapCurrent.has(r.escala_id)) {
          const v = safeFloat(r.apertura_radiales_m, 0);
          if (v > 0) gateMapCurrent.set(r.escala_id, v);
        }
      });
      cps.forEach(cp => {
        if (!gateMapAM.has(cp.id) && gateMapCurrent.has(cp.id)) {
          gateMapAM.set(cp.id, gateMapCurrent.get(cp.id)!);
        }
      });
      const gb: Record<string, number> = {};
      const go: Record<string, number> = {};
      cps.forEach(cp => {
        if (gateMapAM.has(cp.id))      gb[cp.id] = gateMapAM.get(cp.id)!;
        if (gateMapCurrent.has(cp.id)) go[cp.id] = gateMapCurrent.get(cp.id)!;
        else if (gateMapAM.has(cp.id)) go[cp.id] = gateMapAM.get(cp.id)!;
      });
      setGateBase(gb);
      setGateOverrides(go);
      const hasGates = Object.keys(go).length > 0;

      // 6. Telemetría — safeFloat en todos los campos numéricos
      const gastoMedidoMap = new Map<string, number>();
      rawLatest?.forEach(r => {
        if (!gastoMedidoMap.has(r.escala_id)) {
          const v = safeFloat(r.gasto_calculado_m3s, NaN);
          if (Number.isFinite(v)) gastoMedidoMap.set(r.escala_id, v);
        }
      });
      const telMap: Record<string, CPTelemetry> = {};
      cps.forEach(cp => {
        const s = summary?.find(r => r.escala_id === cp.id);
        const amV  = safeFloat(s?.lectura_am,  NaN);
        const pmV  = safeFloat(s?.lectura_pm,  NaN);
        const dV   = safeFloat(s?.delta_12h,   0);
        telMap[cp.id] = {
          delta_12h:    Number.isFinite(dV) ? dV : 0,
          lectura_am:   Number.isFinite(amV) ? amV : null,
          lectura_pm:   Number.isFinite(pmV) ? pmV : null,
          hora_am:      s?.hora_am ?? null,
          hora_pm:      s?.hora_pm ?? null,
          gasto_medido: gastoMedidoMap.get(cp.id) ?? null,
          apertura_real: gateMapCurrent.get(cp.id) ?? gateMapAM.get(cp.id) ?? null,
        };
      });
      setCpTelemetry(telMap);

      // 7. ── PUNTOS DE ENTREGA — volúmenes del día más actuales ────────
      // Fuente: reportes_diarios (VIEW) filtrado por hoy + km de puntos_entrega
      // Estados activos: inicio / continua / reabierto / modificacion (sin hora_cierre = sigue abierto)
      const ACTIVE_STATES = new Set(['inicio', 'continua', 'reabierto', 'modificacion']);
      const kmMap = new Map<string, number>();
      const tipoMap = new Map<string, string>();
      rawPuntos?.forEach(p => {
        const km = safeFloat(p.km, NaN);
        if (Number.isFinite(km)) {
          kmMap.set(p.id, km);
          if (p.tipo) tipoMap.set(p.id, p.tipo);
        }
      });

      const deliveries: DeliveryData[] = (rawReportes ?? [])
        .map(r => {
          const km = kmMap.get(r.punto_id ?? '') ?? NaN;
          const caudal = safeFloat(r.caudal_promedio_m3s, 0);
          const volumen = safeFloat(r.volumen_total_mm3, 0);
          const isActive = ACTIVE_STATES.has(r.estado ?? '') && !r.hora_cierre && caudal > 0;
          return {
            punto_id:      r.punto_id ?? '',
            nombre:        r.punto_nombre ?? r.punto_id ?? 'Toma s/n',
            km,
            tipo:          tipoMap.get(r.punto_id ?? '') ?? 'toma',
            caudal_m3s:    caudal,
            volumen_mm3:   volumen,
            hora_apertura: r.hora_apertura ?? null,
            estado:        r.estado ?? 'desconocido',
            modulo_nombre: r.modulo_nombre ?? null,
            is_active:     isActive,
          };
        })
        .filter(d => Number.isFinite(d.km))   // descartar tomas sin posición km
        .sort((a, b) => a.km - b.km);          // ordenar por km ascendente

      setDeliveryPoints(deliveries);
      const hasDeliveries = deliveries.length > 0;

      // 9. ── GEOMETRÍA POR TRAMO — perfil_hidraulico_canal ─────────────
      const tramos: TramoGeom[] = (rawPerfil ?? []).map(t => ({
        km_inicio:            safeFloat(t.km_inicio, 0),
        km_fin:               safeFloat(t.km_fin, 999),
        plantilla_m:          safeFloat(t.plantilla_m, PLANTILLA),
        talud_z:              safeFloat(t.talud_z, TALUD_Z),
        rugosidad_n:          safeFloat(t.rugosidad_n, MANNING_N),
        pendiente_s0:         safeFloat(t.pendiente_s0, S0_CANAL),
        tirante_diseno_m:     safeFloat(t.tirante_diseno_m, 2.5),
        capacidad_diseno_m3s: safeFloat(t.capacidad_diseno_m3s, 62),
        bordo_libre_m:        safeFloat(t.bordo_libre_m, FREEBOARD),
      }));
      setTramoGeom(tramos);
      const totalExtractionM3s = deliveries
        .filter(d => d.is_active)
        .reduce((s, d) => s + d.caudal_m3s, 0);

      // 8. ── GASTO PRESA — safeFloat + validación isFinite ─────────────
      const ts = formatTime(new Date());
      let qBaseVal = 62.4, qDamVal = 62.4;
      let damNivel = '—', damFuente = 'estimado';
      let damLive  = false;

      if (lastMovPresa?.gasto_m3s != null) {
        // La simulación utiliza el ÚLTIMO movimiento de presa como "Base"
        const base = safeFloat(lastMovPresa.gasto_m3s, 0);
        if (base > 0) {
          qBaseVal  = base;
          qDamVal   = base; // Ambos inician iguales (Delta 0 hasta que el usuario mueva el slider)
          damFuente = 'movimientos_presas';
          damLive   = true;
          damNivel  = lastMovPresa.fecha_hora
            ? formatTime(lastMovPresa.fecha_hora)
            : '—';
          // T₀ = hora del ÚLTIMO movimiento de presa
          if (lastMovPresa.fecha_hora) {
            const movDate = new Date(lastMovPresa.fecha_hora);
            if (!isNaN(movDate.getTime())) {
              setSimBaseMin(movDate.getHours() * 60 + movDate.getMinutes());
            }
          }
          // El tipo de evento se mantendrá en reposo hasta que el slider se mueva
        }
      } else if (firstMovPresa?.gasto_m3s != null) {
        // Fallback si por alguna razón falla lastMovPresa pero hay firstMovPresa
        const base = safeFloat(firstMovPresa.gasto_m3s, 0);
        if (base > 0) {
          qBaseVal  = base;
          qDamVal   = base;
          damFuente = 'movimientos_presas';
          damLive   = true;
        }
      }
      if (!damLive && lecturaHoy?.extraccion_total_m3s != null) {
        const ext = safeFloat(lecturaHoy.extraccion_total_m3s, 0);
        if (ext > 0) {
          qBaseVal  = ext;
          qDamVal   = ext;
          damFuente = 'lecturas_presas';
          damLive   = true;
          const nivelNum = safeFloat(lecturaHoy.escala_msnm, NaN);
          damNivel = Number.isFinite(nivelNum) ? nivelNum.toFixed(2) : '—';
        }
      }
      // Tier 3: perfil hidráulico RPC — Q ya calculado con cascada completa (aforo → compuerta → presa)
      if (!damLive && rpcQ && rpcQ > 0) {
        qBaseVal  = rpcQ;
        qDamVal   = rpcQ;
        damFuente = 'fn_perfil_canal_completo';
        damLive   = true;
      }
      if (!damLive) {
        // Tier 4: lectura directa K-0 (respaldo si RPC no disponible).
        // NOTA: gasto de K-0 ya incluye pérdidas del tramo río (~36 km), por lo que
        // se aplica corrección inversa ÷0.95 para estimar el gasto real en cabeza de presa.
        const q0Escala = safeFloat(gastoMedidoMap.get(cps[0]?.id ?? ''), NaN);
        if (Number.isFinite(q0Escala) && q0Escala > 0) {
          const q0Corregido = q0Escala / 0.95;
          qBaseVal = q0Corregido;
          qDamVal  = q0Corregido;
        }
        damFuente = 'estimado';

        // Tier 4: si la extracción total medida en tomas supera en >40% al estimado
        // de K-0, es más confiable usar la suma de tomas ÷ eficiencia de conducción.
        // Esto ocurre cuando gasto_calculado_m3s en K-0 está mal calibrado o es nulo.
        const totalExt = deliveries
          .filter(d => d.is_active)
          .reduce((s, d) => s + safeFloat(d.caudal_m3s, 0), 0);
        if (totalExt > qDamVal * 1.4) {
          const qFromTomas = totalExt / 0.88; // eficiencia conducción ~88%
          qBaseVal = qFromTomas;
          qDamVal  = qFromTomas;
        }
      }

      setQBase(qBaseVal);
      setQDam(qDamVal);
      const q0Escala = safeFloat(gastoMedidoMap.get(cps[0]?.id ?? 'k0'), NaN);

      setDataLoaded(true);
      setDataStatus({
        dam: damLive, gates: hasGates, levels: hasLevels, deliveries: hasDeliveries,
        timestamp: ts,
        damBaseValue:    qBaseVal,
        damCurrentValue: qDamVal,
        damNivel, damFuente,
        totalExtractionM3s,
        qRealK0:      Number.isFinite(q0Escala) ? q0Escala : undefined,
        perfilFuente: rpcFuente ?? undefined,
        perfilQ:      rpcQ     ?? undefined,
      });
    };
    fetchData();

    // ── Refresh parcial cada 5 min: solo las 2 queries dinámicas ─────────
    // reportes_diarios y puntos_entrega cambian con cada captura de SICA.
    // El resto (presa, escalas, geometría) usa realtime o carga inicial.
    const fetchDeliveries = async () => {
      const today = getTodayString();
      const ACTIVE_STATES = new Set(['inicio', 'continua', 'reabierto', 'modificacion']);
      const [{ data: rawReportes }, { data: rawPuntos }] = await Promise.all([
        supabase.from('reportes_diarios')
          .select('punto_id, punto_nombre, caudal_promedio_m3s, volumen_total_mm3, hora_apertura, hora_cierre, estado, modulo_nombre')
          .eq('fecha', today),
        supabase.from('puntos_entrega')
          .select('id, nombre, km, tipo')
          .not('km', 'is', null)
          .order('km', { ascending: true })
          .limit(300),
      ]);

      const kmMap   = new Map<string, number>();
      const tipoMap = new Map<string, string>();
      rawPuntos?.forEach(p => {
        const km = safeFloat(p.km, NaN);
        if (Number.isFinite(km)) {
          kmMap.set(p.id, km);
          if (p.tipo) tipoMap.set(p.id, p.tipo);
        }
      });

      const deliveries: DeliveryData[] = (rawReportes ?? [])
        .map(r => {
          const km     = kmMap.get(r.punto_id ?? '') ?? NaN;
          const caudal = safeFloat(r.caudal_promedio_m3s, 0);
          const volumen = safeFloat(r.volumen_total_mm3, 0);
          const isActive = ACTIVE_STATES.has(r.estado ?? '') && !r.hora_cierre && caudal > 0;
          return {
            punto_id: r.punto_id ?? '', nombre: r.punto_nombre ?? r.punto_id ?? 'Toma s/n',
            km, tipo: tipoMap.get(r.punto_id ?? '') ?? 'toma',
            caudal_m3s: caudal, volumen_mm3: volumen,
            hora_apertura: r.hora_apertura ?? null, estado: r.estado ?? 'desconocido',
            modulo_nombre: r.modulo_nombre ?? null, is_active: isActive,
          };
        })
        .filter(d => Number.isFinite(d.km))
        .sort((a, b) => a.km - b.km);

      setDeliveryPoints(deliveries);
      const totalExtractionM3s = deliveries.filter(d => d.is_active).reduce((s, d) => s + d.caudal_m3s, 0);
      setDataStatus(prev => ({
        ...prev,
        deliveries: deliveries.length > 0,
        totalExtractionM3s,
        timestamp: formatTime(new Date()),
      }));
    };

    const deliveryInterval = setInterval(fetchDeliveries, 300_000);

    // Suscripción realtime: cuando llega un nuevo movimiento de presa, recalcular
    const unsubPresa = onTable('movimientos_presas', 'INSERT', () => {
      console.log('🏔️ Nuevo movimiento de presa detectado. Recargando modelo...');
      fetchData();
    });

    // Suscripción realtime: cuando hay nuevas capturas manuales de escalas/compuertas
    const unsubEscalas = onTable('lecturas_escalas', 'INSERT', () => {
      console.log('💧 Nueva captura de escala SICA detectada. Recargando modelo...');
      fetchData();
    });

    // Suscripción realtime: cuando hay nuevas capturas de tomas activas
    const unsubReportes = onTable('reportes_diarios', 'INSERT', () => {
      console.log('🚰 Nueva alta de tomas SICA detectada. Recargando modelo...');
      fetchData();
    });

    // Suscripción realtime: cuando se aplica calibración Manning, refrescar geometría
    const unsubPerfil = onTable('perfil_hidraulico_canal', 'UPDATE', () => {
      console.log('📐 Perfil hidráulico actualizado. Recargando geometría...');
      fetchData();
    });

    return () => {
      unsubPresa();
      unsubEscalas();
      unsubReportes();
      unsubPerfil();
      clearInterval(deliveryInterval);
    };
  }, []);

  // ── TIMELINE PLAYER ──────────────────────────────────────────────────
  useEffect(() => {
    let t: ReturnType<typeof setInterval>;
    if (isPlaying) {
      t = setInterval(() => setTimeDelta(p => p >= 480 ? 0 : p + 2), 80);
    }
    return () => clearInterval(t);
  }, [isPlaying]);

  // ── RELOJ: actualizar currentTimeMin cada 60s para propagación de onda en tiempo real
  useEffect(() => {
    const tick = setInterval(() => {
      const now = new Date();
      setCurrentTimeMin(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => clearInterval(tick);
  }, []);

  // ── MOTOR HIDRÁULICO ─────────────────────────────────────────────────
  // gastoMedidoRecord: gasto_calculado_m3s de SICA por escala_id (ancla de compuerta)
  const gastoMedidoRecord = useMemo<Record<string, number>>(() => {
    const rec: Record<string, number> = {};
    Object.entries(cpTelemetry).forEach(([id, tel]) => {
      if (tel.gasto_medido != null && tel.gasto_medido > 0) rec[id] = tel.gasto_medido;
    });
    return rec;
  }, [cpTelemetry]);

  const simResults = useMemo<CPResult[]>(() => {
    if (!controlPoints.length || !dataLoaded) return [];
    return runSimulation(controlPoints, qDam, qBase, baseReadings, gateOverrides,
      gastoMedidoRecord, deliveryPoints, tramoGeom, riverTransit, simBaseMin, currentTimeMin);
  }, [controlPoints, baseReadings, gateOverrides, gastoMedidoRecord, qDam, qBase, riverTransit, simBaseMin, currentTimeMin, deliveryPoints, dataLoaded, tramoGeom]);

  // ── ESCENARIO B — segunda corrida del motor para comparación ─────────
  const [showScenarioB, setShowScenarioB] = useState(false);
  const [qDamB,         setQDamB]         = useState(0);

  // Modificaciones de tomas para escenario hipotético
  interface ScenarioMod { punto_id: string; nombre: string; km: number; nuevo_caudal: number; original: number; }
  const [scenarioMods,      setScenarioMods]      = useState<ScenarioMod[]>([]);
  const [scenarioRpcLoading, setScenarioRpcLoading] = useState(false);
  const [scenarioRpcRows,    setScenarioRpcRows]    = useState<any[]>([]);

  const simResultsB = useMemo<CPResult[]>(() => {
    if (!showScenarioB || !controlPoints.length || !dataLoaded) return [];
    // Aplicar overrides de tomas al motor cliente para feedback instantáneo
    const modDeliveries = deliveryPoints.map(d => {
      const mod = scenarioMods.find(m => m.punto_id === d.punto_id);
      return mod ? { ...d, caudal_m3s: mod.nuevo_caudal, is_active: mod.nuevo_caudal > 0 } : d;
    });
    return runSimulation(controlPoints, qDamB, qBase, baseReadings, gateOverrides,
      gastoMedidoRecord, modDeliveries, tramoGeom, riverTransit, simBaseMin, currentTimeMin);
  }, [showScenarioB, controlPoints, baseReadings, gateOverrides, gastoMedidoRecord, qDamB, qBase, riverTransit, simBaseMin, currentTimeMin, deliveryPoints, scenarioMods, dataLoaded, tramoGeom]);

  // ── FASE 3: MOTOR DE DECISIÓN ─────────────────────────────────────────
  const decisions = useMemo<Decision[]>(() => {
    if (!simResults.length) return [];
    return generateDecisions(simResults, qDam, qBase, gateBase, cpTelemetry, dataStatus, eventType);
  }, [simResults, qDam, qBase, gateBase, cpTelemetry, dataStatus, eventType]);

  // ── RPC: Simulación de escenario en servidor ──────────────────────────
  const runScenarioRpc = async () => {
    setScenarioRpcLoading(true);
    setScenarioRpcRows([]);
    const mods = scenarioMods.map(m => ({ punto_id: m.punto_id, nuevo_caudal_m3s: m.nuevo_caudal }));
    const { data, error } = await supabase.rpc('fn_simular_escenario_canal', {
      p_q_entrada_m3s:  qDamB > 0 ? qDamB : null,
      p_modificaciones: mods,
    });
    if (!error && data) setScenarioRpcRows(data as any[]);
    setScenarioRpcLoading(false);
  };

  // ── CUADRO DE MANIOBRA: Perfil Longitudinal + Diagrama Espacio-Tiempo ──
  const opsChartOption = useMemo(() => {
    if (!simResults.length) return {};

    // ── Datos Perfil Longitudinal (Grid 0) ────────────────────────────
    // Canal como continuo: km en X, tirante en Y-izq, Q en Y-der
    const kmData     = [0, ...simResults.map(r => r.km)];
    const yBaseData  = [simResults[0].y_base, ...simResults.map(r => r.y_base)];
    const ySimData   = [simResults[0].y_sim,  ...simResults.map(r => r.y_sim)];
    const qSimData   = [qDam,                 ...simResults.map(r => r.q_sim)];
    const bordoData  = kmData.map(km => {
      const tr = findTramo(km, tramoGeom);
      return tr.bordo_libre_m;
    });
    const capData    = kmData.map(km => {
      const tr = findTramo(km, tramoGeom);
      return tr.tirante_diseno_m;
    });
    // Tirante crítico (Fr=1) por tramo: yc = criticalDepth(Q, b, z)
    const ycData = kmData.map((km, i) => {
      const tr = findTramo(km, tramoGeom);
      return +criticalDepth(qSimData[i] ?? qDam, tr.plantilla_m, tr.talud_z).toFixed(3);
    });
    // Colores por estado_lectura del RPC (reemplaza statusColor Manning para escalas)
    const estadoColorMap: Record<string, string> = {
      CONSISTENTE:           '#22c55e',   // verde
      DESBORDAMIENTO:        '#ef4444',   // rojo
      ALERTA_DESBORDAMIENTO: '#f59e0b',   // ámbar
      SIN_LECTURA:           '#64748b',   // gris
      SIN_DATOS:             '#64748b',
    };
    // Mapa km_ref → { nivel_real_m, estado_lectura } del RPC
    const rpcByKm = new Map<number, { nivel: number; estado: string }>();
    (perfilRpc as any[]).forEach(row => {
      const km = safeFloat(row.km_ref, NaN);
      const nv = safeFloat(row.nivel_real_m, NaN);
      if (Number.isFinite(km)) rpcByKm.set(km, { nivel: nv, estado: row.estado_lectura ?? 'SIN_DATOS' });
    });
    // Serie ámbar: puntos [km_ref, nivel_real_m] del perfil SQL
    const rpcNivelSerie = (perfilRpc as any[])
      .map(row => {
        const km = safeFloat(row.km_ref, NaN);
        const nv = safeFloat(row.nivel_real_m, NaN);
        return Number.isFinite(km) && Number.isFinite(nv) && nv > 0.05 ? [km, +nv.toFixed(3)] : null;
      })
      .filter(Boolean) as [number, number][];

    // Color de cada punto de control: usa estado_lectura RPC si está disponible
    const colors = simResults.map(r => {
      const rpcRow = rpcByKm.get(r.km) ?? [...rpcByKm.entries()]
        .filter(([k]) => Math.abs(k - r.km) < 2)
        .sort((a, b) => Math.abs(a[0] - r.km) - Math.abs(b[0] - r.km))[0]?.[1];
      if (rpcRow) return estadoColorMap[rpcRow.estado] ?? statusColor(r.status);
      return statusColor(r.status);
    });

    // ── Ruta de onda: [tiempo_horas, km] — empieza en origen [0, 0] ──
    // Usando tiempos de tránsito reales del motor hidráulico
    const wavePath: [number, number][] = [
      [0, 0],
      ...simResults.map(r => [
        +((r.cumulative_min ?? 0) / 60).toFixed(3),
        r.km,
      ] as [number, number]),
    ];
    const maxHr = +(Math.max(8, wavePath[wavePath.length - 1][0]) * 1.08).toFixed(1);

    // ── Posición actual de la onda: interpolación lineal sobre wavePath ─
    // Garantiza que el marcador cae EXACTAMENTE sobre la trayectoria
    const tHr = timeDelta / 60;
    let curKm = 0;
    if (timeDelta > 0) {
      const lastPt = wavePath[wavePath.length - 1];
      if (tHr >= lastPt[0]) {
        curKm = 104;
      } else {
        for (let i = 1; i < wavePath.length; i++) {
          if (wavePath[i][0] >= tHr) {
            const span = wavePath[i][0] - wavePath[i - 1][0];
            const frac = span > 0 ? (tHr - wavePath[i - 1][0]) / span : 0;
            curKm = wavePath[i - 1][1] + frac * (wavePath[i][1] - wavePath[i - 1][1]);
            break;
          }
        }
      }
    }
    curKm = +curKm.toFixed(1);

    // ── Segmento completado (visible) vs pendiente (tenue) ───────────
    const completedPath: [number, number][] = [[0, 0]];
    for (const pt of wavePath.slice(1)) {
      if (pt[0] <= tHr) {
        completedPath.push(pt);
      } else {
        completedPath.push([tHr, curKm]);
        break;
      }
    }
    if (completedPath.length === 1 && timeDelta > 0) completedPath.push([tHr, curKm]);

    // ── Tooltip unificado ────────────────────────────────────────────
    const fmtTooltip = (params: any[]) => {
      if (!params?.length) return '';
      const p0 = params[0];
      // Grid 0 — perfil longitudinal (series indexadas por km)
      if (['Tirante Actual', 'Nivel Real SQL', 'Tirante Simulado', 'Caudal Q', 'Tirante Diseño', 'Bordo Libre', 'Tirante Crítico'].includes(p0.seriesName)) {
        if (!simResults.length) return '';
        const axisKm = p0.axisValue as number;
        const r = simResults.find(r2 => r2.km === axisKm) ?? simResults.reduce((best, r2) => Math.abs(r2.km - axisKm) < Math.abs(best.km - axisKm) ? r2 : best, simResults[0]);
        if (!r) return '';
        const dCm = Math.round((r.delta_y ?? 0) * 100);
        const sign = dCm >= 0 ? '+' : '';
        const movClr = dCm > 2 ? '#fbbf24' : dCm < -2 ? '#60a5fa' : '#94a3b8';
        const rpcRow = rpcByKm.get(r.km) ?? [...rpcByKm.entries()]
          .filter(([k]) => Math.abs(k - r.km) < 2)
          .sort((a, b) => Math.abs(a[0] - r.km) - Math.abs(b[0] - r.km))[0]?.[1];
        const estadoLabel = rpcRow?.estado ?? '—';
        const estadoClr   = estadoColorMap[estadoLabel] ?? '#64748b';
        return `<div style="font-family:monospace;font-size:11px;line-height:1.9;min-width:200px">
          <div style="color:#94a3b8;font-size:9px;border-bottom:1px solid #1e3a5f;padding-bottom:3px;margin-bottom:5px">${r.nombre} · KM ${r.km}</div>
          <div>Nivel real SQL&nbsp;&nbsp;<b style="color:#f59e0b">${rpcRow && Number.isFinite(rpcRow.nivel) ? rpcRow.nivel.toFixed(2)+' m' : '—'}</b>&nbsp;<span style="color:${estadoClr};font-size:9px">${estadoLabel}</span></div>
          <div>Tirante actual &nbsp;&nbsp;<b style="color:#38bdf8">${(r.y_base??0).toFixed(2)} m</b></div>
          <div>Tirante simulado<b style="color:${statusColor(r.status)}">&nbsp;${(r.y_sim??0).toFixed(2)} m</b></div>
          <div>Tirante crítico &nbsp;<b style="color:rgba(251,146,60,0.9)">${criticalDepth(r.q_sim, findTramo(r.km, tramoGeom).plantilla_m, findTramo(r.km, tramoGeom).talud_z).toFixed(2)} m</b>&nbsp;<span style="color:#475569;font-size:9px">(Fr=1)</span></div>
          <div>Variación &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<b style="color:${movClr}">${sign}${dCm} cm</b></div>
          <div>Q llegada &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<b style="color:#a78bfa">${(r.q_sim??0).toFixed(1)} m³/s</b></div>
          ${r.n_tomas_activas > 0 ? `<div style="color:#64748b;font-size:9px">−${r.q_extraido.toFixed(2)} m³/s · ${r.n_tomas_activas} tomas activas</div>` : ''}
          <div style="margin-top:3px;padding-top:3px;border-top:1px solid #1e3a5f">Arribo: <b style="color:#c084fc">${r.arrival_time} &nbsp;(T+${Math.round(r.cumulative_min??0)} min)</b></div>
        </div>`;
      }
      return '';
    };

    // Tirante máximo dinámico (bordo libre del primer tramo u 4m mínimo)
    const yMax = Math.max(4, ...bordoData) * 1.05;
    const qMax = Math.max(10, ...qSimData) * 1.15;

    return {
      animation: false,
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(4,11,22,0.97)',
        borderColor: '#1e3a5f', borderWidth: 1,
        textStyle: { color: '#e2e8f0', fontSize: 11 },
        formatter: fmtTooltip,
        axisPointer: { type: 'cross', crossStyle: { color: '#1e3a5f' } },
      },
      grid: [
        { top: 36, height: '40%', left: 68, right: 60 },
        { top: '58%', bottom: 50, left: 68, right: 60 },
      ],
      xAxis: [
        // Grid 0 — km del canal (continuo 0→104)
        {
          gridIndex: 0, type: 'value', min: 0, max: 110,
          name: 'Km del canal', nameLocation: 'middle', nameGap: 22,
          nameTextStyle: { color: '#334155', fontSize: 8 },
          axisLabel: { color: '#64748b', fontSize: 8, formatter: 'K{value}' },
          axisLine: { lineStyle: { color: '#1e3a5f' } },
          axisTick: { lineStyle: { color: '#1e3a5f' } },
          splitLine: { lineStyle: { color: 'rgba(30,58,95,0.3)', type: 'dashed' } },
        },
        // Grid 1 — tiempo en horas
        {
          gridIndex: 1, type: 'value', min: 0, max: maxHr,
          name: 'Tiempo desde el evento (horas)', nameLocation: 'middle', nameGap: 28,
          nameTextStyle: { color: '#334155', fontSize: 8 },
          axisLabel: {
            color: '#64748b', fontSize: 9,
            formatter: (v: number) => v === 0 ? 'T0' : `+${v}h`,
          },
          axisLine: { lineStyle: { color: '#1e3a5f' } },
          axisTick: { lineStyle: { color: '#1e3a5f' } },
          splitLine: { lineStyle: { color: 'rgba(30,58,95,0.4)', type: 'dashed' } },
        },
      ],
      yAxis: [
        // Grid 0 izq — tirante (m)
        {
          gridIndex: 0, type: 'value', name: 'Tirante (m)', min: 0, max: +yMax.toFixed(1),
          nameTextStyle: { color: '#334155', fontSize: 8, padding: [0, 0, 0, -22] },
          axisLabel: { color: '#64748b', fontSize: 8, formatter: '{value}m' },
          splitLine: { lineStyle: { color: '#080f1c', type: 'dashed' } },
          axisLine: { lineStyle: { color: '#1e3a5f' } },
        },
        // Grid 0 der — caudal (m³/s)
        {
          gridIndex: 0, type: 'value', name: 'Q (m³/s)', min: 0, max: +qMax.toFixed(0),
          nameTextStyle: { color: '#7c3aed', fontSize: 8 },
          axisLabel: { color: '#7c3aed', fontSize: 8, formatter: (v: number) => `${v}` },
          splitLine: { show: false },
          axisLine: { lineStyle: { color: '#3730a3' } },
          position: 'right',
        },
        // Grid 1 — kilómetro del canal
        {
          gridIndex: 1, type: 'value', name: 'Kilómetro del Canal', min: 0, max: 110,
          nameTextStyle: { color: '#334155', fontSize: 8 },
          axisLabel: { color: '#64748b', fontSize: 8, formatter: 'K{value}' },
          splitLine: { lineStyle: { color: '#080f1c', type: 'dashed' } },
          axisLine: { lineStyle: { color: '#1e3a5f' } },
          inverse: true,
        },
      ],
      series: [
        // ── GRID 0: Perfil Longitudinal Hidráulico ───────────────────

        // Bandas de fondo por estado_lectura del RPC (markArea por tramo)
        // z=0 — debajo de todas las líneas para no tapar datos
        {
          name: 'Bandas Tramo', type: 'line',
          xAxisIndex: 0, yAxisIndex: 0,
          data: [], showSymbol: false, lineStyle: { opacity: 0 }, z: 0,
          markArea: {
            silent: true,
            data: (() => {
              if (!perfilRpc.length) return [];
              const bandaColor: Record<string, string> = {
                CONSISTENTE:           'rgba(34,197,94,0.06)',
                DESBORDAMIENTO:        'rgba(239,68,68,0.11)',
                ALERTA_DESBORDAMIENTO: 'rgba(245,158,11,0.09)',
                SIN_LECTURA:           'rgba(100,116,139,0.04)',
                SIN_DATOS:             'rgba(100,116,139,0.04)',
              };
              const rows = (perfilRpc as any[])
                .filter(r => Number.isFinite(safeFloat(r.km_ref, NaN)))
                .sort((a, b) => safeFloat(a.km_ref) - safeFloat(b.km_ref));
              return rows.map((row, i) => {
                const kmFin   = safeFloat(row.km_ref);
                const kmIni   = i === 0 ? 0 : safeFloat(rows[i - 1].km_ref);
                const estado  = row.estado_lectura ?? 'SIN_DATOS';
                const color   = bandaColor[estado] ?? 'rgba(100,116,139,0.04)';
                return [
                  { xAxis: kmIni, itemStyle: { color } },
                  { xAxis: kmFin },
                ];
              });
            })(),
          },
        },

        // Franja bordo libre (capacidad total del canal por tramo)
        {
          name: 'Bordo Libre', type: 'line',
          xAxisIndex: 0, yAxisIndex: 0,
          data: kmData.map((km, i) => [km, bordoData[i]]),
          smooth: false, showSymbol: false, z: 1,
          lineStyle: { color: 'rgba(239,68,68,0.4)', width: 1, type: 'dashed' },
          areaStyle: {
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(239,68,68,0.0)' },
                { offset: 1, color: 'rgba(239,68,68,0.0)' },
              ],
            },
          },
          label: { show: false },
        },

        // Tirante crítico (Fr=1) — umbral de régimen supercrítico
        {
          name: 'Tirante Crítico', type: 'line',
          xAxisIndex: 0, yAxisIndex: 0,
          data: kmData.map((km, i) => [km, ycData[i]]),
          smooth: false, showSymbol: false, z: 2,
          lineStyle: { color: 'rgba(251,146,60,0.65)', width: 1.5, type: [6, 3] },
          label: { show: false },
        },

        // Tirante de diseño (línea de capacidad de diseño)
        {
          name: 'Tirante Diseño', type: 'line',
          xAxisIndex: 0, yAxisIndex: 0,
          data: kmData.map((km, i) => [km, capData[i]]),
          smooth: false, showSymbol: false, z: 2,
          lineStyle: { color: 'rgba(71,85,105,0.5)', width: 1, type: 'dotted' },
          label: { show: false },
        },

        // Área llenada — Tirante Actual (superficie de agua base)
        {
          name: 'Tirante Actual', type: 'line',
          xAxisIndex: 0, yAxisIndex: 0,
          data: kmData.map((km, i) => [km, yBaseData[i]]),
          smooth: true, showSymbol: false, z: 3,
          lineStyle: { color: '#38bdf8', width: 2, type: 'dashed', opacity: 0.7 },
          areaStyle: {
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(56,189,248,0.18)' },
                { offset: 1, color: 'rgba(56,189,248,0.04)' },
              ],
            },
          },
        },

        // Nivel Real SQL — puntos medidos del perfil hidráulico RPC (fn_perfil_canal_completo)
        // Línea ámbar: diferencia visible vs Tirante Actual (interpolado) y Simulado (Manning)
        {
          name: 'Nivel Real SQL', type: 'line',
          xAxisIndex: 0, yAxisIndex: 0,
          data: rpcNivelSerie,
          smooth: false, showSymbol: true, z: 5,
          symbol: 'diamond', symbolSize: 8,
          lineStyle: { color: '#f59e0b', width: 2, type: 'solid' },
          itemStyle: { color: '#f59e0b', borderColor: '#04080f', borderWidth: 1.5 },
          label: { show: false },
        },

        // Área llenada — Tirante Simulado (superficie de agua simulada)
        {
          name: 'Tirante Simulado', type: 'line',
          xAxisIndex: 0, yAxisIndex: 0,
          data: kmData.map((km, i) => [km, ySimData[i]]),
          smooth: true, showSymbol: false, z: 4,
          lineStyle: { color: '#2dd4bf', width: 2.5 },
          areaStyle: {
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(45,212,191,0.22)' },
                { offset: 1, color: 'rgba(45,212,191,0.04)' },
              ],
            },
          },
        },

        // Caudal Q (eje derecho, línea violeta)
        {
          name: 'Caudal Q', type: 'line',
          xAxisIndex: 0, yAxisIndex: 1,
          data: kmData.map((km, i) => [km, +(qSimData[i] ?? 0).toFixed(2)]),
          smooth: true, showSymbol: false, z: 3,
          lineStyle: { color: 'rgba(167,139,250,0.7)', width: 1.5, type: 'solid' },
          label: { show: false },
        },

        // Puntos de control: scatter sobre la línea simulada
        {
          name: 'Puntos de Control', type: 'scatter',
          xAxisIndex: 0, yAxisIndex: 0,
          data: simResults.map((r, i) => ({
            value: [r.km, r.y_sim],
            symbolSize: r.status === 'CRITICO' ? 13 : r.status === 'ALERTA' ? 10 : 8,
            itemStyle: {
              color: colors[i],
              borderColor: '#04080f', borderWidth: 1.5,
              shadowColor: colors[i], shadowBlur: 5,
            },
            label: {
              show: true,
              formatter: () => `K-${r.km}`,
              position: i % 2 === 0 ? 'top' : 'bottom',
              distance: 5, fontSize: 7.5, color: colors[i],
            },
          })),
          z: 6,
        },

        // Marcadores de puntos de entrega activos — UNA sola serie con todas las tomas
        {
          name: 'Tomas Activas', type: 'scatter',
          xAxisIndex: 0, yAxisIndex: 0,
          data: deliveryPoints
            .filter(d => d.is_active && Number.isFinite(d.km))
            .slice(0, 40)
            .map(d => ({ value: [d.km, 0.1], name: d.nombre })),
          symbolSize: 6, symbol: 'triangle',
          itemStyle: { color: '#fbbf24', opacity: 0.7 },
          label: { show: false }, z: 5,
          tooltip: { show: false },
        },

        // ── GRID 1: Diagrama Espacio-Tiempo ──────────────────────────
        // NOTA: yAxis[2] = km canal (gridIndex:1) — yAxis[1] es Q en Grid 0

        // Línea de trayectoria PREVISTA (segmento pendiente, tenue)
        {
          name: 'Trayectoria Prevista', type: 'line',
          xAxisIndex: 1, yAxisIndex: 2,
          data: wavePath,
          smooth: false, z: 3, showSymbol: false,
          lineStyle: { color: 'rgba(56,189,248,0.18)', width: 1.5, type: 'dashed' },
        },

        // Línea de trayectoria COMPLETADA (segmento recorrido, brillante)
        {
          name: 'Recorrido Completado', type: 'line',
          xAxisIndex: 1, yAxisIndex: 2,
          data: completedPath,
          smooth: false, z: 5, showSymbol: false,
          lineStyle: {
            color: '#fbbf24', width: 2.5,
            shadowColor: 'rgba(251,191,36,0.25)', shadowBlur: 8,
          },
          areaStyle: {
            color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
              colorStops: [
                { offset: 0, color: 'rgba(251,191,36,0.10)' },
                { offset: 1, color: 'rgba(251,191,36,0.02)' },
              ],
            },
          },
        },

        // Puntos de control: relleno=llegó, borde=pendiente
        {
          name: 'PuntosCP', type: 'scatter',
          xAxisIndex: 1, yAxisIndex: 2,
          data: wavePath.slice(1).map((pt, i) => {
            const r = simResults[i];
            const arrived = (r.cumulative_min ?? 0) <= timeDelta;
            return {
              value: pt,
              symbolSize: r.status === 'CRITICO' ? 14 : r.status === 'ALERTA' ? 11 : 9,
              itemStyle: arrived
                ? { color: colors[i], borderColor: '#04080f', borderWidth: 2 }
                : { color: 'transparent', borderColor: '#334155', borderWidth: 1.5 },
              label: {
                show: true,
                position: i % 2 === 0 ? 'right' : 'left',
                distance: 7, fontSize: 8,
                color: arrived ? colors[i] : '#374151',
                formatter: () => {
                  const km = `K-${r.km}`;
                  return arrived ? `${km}  ${r.arrival_time}` : `${km}  ~${r.arrival_time}`;
                },
              },
            };
          }),
          z: 6,
        },

        // Marcador del frente de onda actual (siempre presente, vacío cuando T=0)
        // Sin shadowBlur → sin parpadeo
        {
          name: 'Frente de Onda', type: 'scatter',
          xAxisIndex: 1, yAxisIndex: 2,
          data: timeDelta > 0 ? [[tHr, curKm]] : [],
          symbolSize: 13, symbol: 'circle', z: 8,
          itemStyle: {
            color: '#fbbf24',
            borderColor: '#040b16', borderWidth: 2,
          },
          label: {
            show: timeDelta > 0,
            position: 'right', distance: 9,
            fontSize: 9, fontWeight: 'bold', color: '#fbbf24',
            formatter: () => `◀ K-${curKm}  T+${timeDelta}min`,
          },
          // Línea vertical "ahora" — markLine sobre esta serie (válido en ECharts)
          markLine: {
            silent: true, symbol: 'none', z: 4,
            animation: false,
            data: timeDelta > 0 ? [{
              xAxis: tHr,
              lineStyle: { color: 'rgba(251,191,36,0.25)', width: 1, type: 'solid' },
              label: { show: false },
            }] : [],
          },
        },
      ],
    };
  }, [simResults, timeDelta, qDam, tramoGeom, deliveryPoints, perfilRpc]);

  // ── PANEL B: HIDROGRAMA DE GASTO ─────────────────────────────────────
  const qChartOption = useMemo(() => {
    if (!simResults.length && !perfilRpc.length) return {};

    // Q Real SQL (RPC) — ordenado por km_ref ascendente
    const rpcQSerie: [number, number][] = (perfilRpc as any[])
      .filter(r => safeFloat(r.km_ref, NaN) > 0 || r.km_ref === 0)
      .filter(r => Number.isFinite(safeFloat(r.km_ref, NaN)) && safeFloat(r.q_m3s, 0) > 0)
      .sort((a, b) => safeFloat(a.km_ref) - safeFloat(b.km_ref))
      .map(r => [safeFloat(r.km_ref), +safeFloat(r.q_m3s).toFixed(3)]);

    // Q Simulado Manning — origen en km=0 con qDam
    const simQSerie: [number, number][] = [
      [0, +qDam.toFixed(3)],
      ...simResults.map(r => [r.km, +r.q_sim.toFixed(3)] as [number, number]),
    ];

    // Q por apertura SICA — orificio real en escalas con datos de compuerta
    // Estos valores son la verdad física: lo que realmente pasa la compuerta
    const gateQSerie: { value: [number, number]; anchored: boolean }[] = simResults
      .filter(r => r.q_gate_m3s !== null)
      .map(r => ({ value: [r.km, r.q_gate_m3s as number], anchored: r.gate_anchored }));

    // Extracciones activas — barras descendentes en km de cada toma
    const extSerie = deliveryPoints
      .filter(d => d.is_active && d.caudal_m3s > 0 && Number.isFinite(d.km))
      .map(d => ({ value: [d.km, +d.caudal_m3s.toFixed(3)], name: d.nombre }));

    const allQ = [...rpcQSerie.map(p => p[1]), ...simQSerie.map(p => p[1])].filter(Boolean);
    const qMax = Math.max(10, ...allQ) * 1.15;
    const extMax = deliveryPoints.filter(d => d.is_active).reduce((s, d) => s + d.caudal_m3s, 0);
    const yMin  = -(Math.max(0.5, extMax) * 1.8);

    // Bandas de balance hídrico (markArea) sobre Panel B
    const balanceMarkArea = balanceTramos.length > 0 ? {
      silent: true,
      data: balanceTramos.map(bt => {
        const color = bt.estado_balance === 'FUGA_ALTA'    ? 'rgba(239,68,68,0.10)'
                    : bt.estado_balance === 'FUGA_MEDIA'   ? 'rgba(251,191,36,0.07)'
                    : bt.estado_balance === 'INCONSISTENCIA' ? 'rgba(96,165,250,0.07)'
                    : 'transparent';
        return [
          { xAxis: bt.km_inicio, itemStyle: { color } },
          { xAxis: bt.km_fin },
        ];
      }),
    } : undefined;

    return {
      animation: false,
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(4,11,22,0.97)',
        borderColor: '#1e3a5f', borderWidth: 1,
        textStyle: { color: '#e2e8f0', fontSize: 11 },
        axisPointer: { type: 'line', lineStyle: { color: '#1e3a5f' } },
        formatter: (params: any[]) => {
          if (!params?.length) return '';
          const km = params[0].axisValue as number;
          const bt = balanceTramos.find(b => km >= b.km_inicio && km <= b.km_fin);
          let html = `<div style="font-family:monospace;font-size:11px;line-height:1.8;min-width:180px">
            <div style="color:#94a3b8;font-size:9px;border-bottom:1px solid #1e3a5f;padding-bottom:2px;margin-bottom:4px">K-${km}</div>`;
          params.forEach(p => {
            if (p.seriesName === 'Q Real SQL' || p.seriesName === 'Q Simulado') {
              const val = Array.isArray(p.value) ? p.value[1] : p.value;
              html += `<div>${p.marker}${p.seriesName} <b>${(+val).toFixed(2)} m³/s</b></div>`;
            }
            if (p.seriesName === 'Q Apertura SICA') {
              const val = Array.isArray(p.value) ? p.value[1] : p.value;
              const r   = simResults.find(r2 => r2.km === (Array.isArray(p.value) ? p.value[0] : -1));
              html += `<div>${p.marker}Q Apertura SICA <b style="color:#fb923c">${(+val).toFixed(2)} m³/s</b>`;
              if (r?.gate_anchored) html += ` <span style="color:#ef4444;font-size:9px">⚠ limita cascada</span>`;
              html += `</div>`;
            }
          });
          const tomas = deliveryPoints.filter(d => d.is_active && Math.abs(d.km - km) < 4);
          if (tomas.length) {
            html += `<div style="color:#fbbf24;font-size:9px;margin-top:3px">`;
            tomas.forEach(t => { html += `↓ ${t.nombre}: ${t.caudal_m3s.toFixed(3)} m³/s<br/>`; });
            html += `</div>`;
          }
          if (bt && bt.q_fuga_detectada !== 0) {
            const fClr = bt.estado_balance === 'FUGA_ALTA'    ? '#ef4444'
                       : bt.estado_balance === 'FUGA_MEDIA'   ? '#f59e0b'
                       : bt.estado_balance === 'INCONSISTENCIA' ? '#60a5fa'
                       : '#22c55e';
            html += `<div style="color:${fClr};font-size:9px;margin-top:3px;border-top:1px solid #1e3a5f;padding-top:2px">`;
            html += `${bt.estado_balance}: ${bt.q_fuga_detectada > 0 ? '+' : ''}${bt.q_fuga_detectada.toFixed(2)} m³/s`;
            html += `<br/>Tomas reg.: ${bt.q_tomas_registradas.toFixed(2)} m³/s</div>`;
          }
          html += '</div>';
          return html;
        },
      },
      grid: { top: 28, bottom: 36, left: 58, right: 16 },
      xAxis: {
        type: 'value', min: 0, max: 110,
        axisLabel: { color: '#64748b', fontSize: 8, formatter: 'K{value}' },
        axisLine: { lineStyle: { color: '#1e3a5f' } },
        splitLine: { lineStyle: { color: 'rgba(30,58,95,0.3)', type: 'dashed' } },
      },
      yAxis: {
        type: 'value', name: 'Q (m³/s)', min: +yMin.toFixed(1), max: +qMax.toFixed(0),
        nameTextStyle: { color: '#334155', fontSize: 8 },
        axisLabel: { color: '#64748b', fontSize: 8, formatter: (v: number) => v >= 0 ? `${v}` : '' },
        splitLine: { lineStyle: { color: '#080f1c', type: 'dashed' } },
        axisLine: { lineStyle: { color: '#1e3a5f' } },
      },
      series: [
        // Referencia cero
        {
          name: 'Cero', type: 'line', data: [[0, 0], [110, 0]],
          showSymbol: false, z: 1,
          lineStyle: { color: 'rgba(100,116,139,0.25)', width: 1 },
        },
        // Q Simulado Manning (teal punteado)
        {
          name: 'Q Simulado', type: 'line', data: simQSerie,
          smooth: true, showSymbol: false, z: 3,
          lineStyle: { color: '#2dd4bf', width: 1.5, type: 'dashed' },
        },
        // Q Real SQL (ámbar sólido con diamantes)
        {
          name: 'Q Real SQL', type: 'line', data: rpcQSerie,
          smooth: false, showSymbol: true, symbolSize: 8, symbol: 'diamond', z: 5,
          lineStyle: { color: '#f59e0b', width: 2.5 },
          itemStyle: { color: '#f59e0b', borderColor: '#04080f', borderWidth: 1.5 },
        },
        // Extracciones activas (barras ámbar descendentes)
        {
          name: 'Extracciones', type: 'bar', data: extSerie,
          barMaxWidth: 5, z: 2,
          itemStyle: { color: 'rgba(251,191,36,0.55)', borderRadius: [2, 2, 0, 0] },
        },
        // Q por apertura SICA — cuadrados naranjas: verdad física de la compuerta
        {
          name: 'Q Apertura SICA', type: 'scatter',
          data: gateQSerie.map(g => ({
            value: g.value,
            itemStyle: {
              color: g.anchored ? '#ef4444' : '#fb923c',
              borderColor: '#04080f', borderWidth: 1.5,
            },
          })),
          symbolSize: 11, symbol: 'rect', z: 7,
          label: {
            show: true, position: 'top', fontSize: 8, fontWeight: 'bold',
            color: '#fb923c',
            formatter: (p: any) => `${(+p.value[1]).toFixed(1)}`,
          },
        },
        // Bandas de balance hídrico (markArea invisible, solo fondo coloreado)
        {
          name: 'Balance', type: 'line', data: [], showSymbol: false,
          lineStyle: { opacity: 0 }, z: 0,
          ...(balanceMarkArea ? { markArea: balanceMarkArea } : {}),
        },
      ],
    };
  }, [simResults, perfilRpc, deliveryPoints, qDam, balanceTramos]);

  // ── GLOBALS (necesarios antes de crossSectionOption) ─────────────────
  const activeCPResult = simResults.find(r => r.id === activeCP);
  const activeCPData   = controlPoints.find(c => c.id === activeCP);

  // ── ETAPA 5: SECCIÓN TRANSVERSAL INTERACTIVA ─────────────────────────
  const crossSectionOption = useMemo(() => {
    if (!activeCPResult) return {
      backgroundColor: 'transparent', animation: false,
      xAxis: { type: 'value', show: false },
      yAxis: { type: 'value', show: false },
      series: [],
    };

    // Guardia > 0: safeFloat devuelve el valor de BD aunque sea 0 (no usa fallback).
    // Si BD tiene 0, usar constantes razonables para que el trapecio siempre se dibuje.
    const b  = activeCPResult.plantilla_m  > 0 ? activeCPResult.plantilla_m  : PLANTILLA;
    const td = activeCPResult.tirante_diseno_m > 0 ? activeCPResult.tirante_diseno_m : 2.5;
    const fb = activeCPResult.bordo_libre_m > 0 ? activeCPResult.bordo_libre_m : 0.5;
    const cd = activeCPResult.canal_depth_m > 0 ? activeCPResult.canal_depth_m : (td + fb);
    const z  = Math.max(0.5, findTramo(activeCPResult.km, tramoGeom).talud_z);
    const yB = Math.max(0, activeCPResult.y_base);    // nivel actual
    const yS = Math.max(0, activeCPResult.y_sim);     // nivel simulado

    // Nivel Real SQL del RPC para este punto de control
    const rpcRow = (perfilRpc as any[]).find(r =>
      Math.abs(safeFloat(r.km_ref, NaN) - activeCPResult.km) < 2.0
    );
    const yR = rpcRow ? safeFloat(rpcRow.nivel_real_m, NaN) : NaN;

    // Coordenadas horizontales del trapecio a profundidad y
    const xL = (y: number) => -(b / 2 + z * y);
    const xR = (y: number) =>  (b / 2 + z * y);

    // Contorno del canal (talud izq → fondo → talud der)
    const canalContorno = [
      [xL(cd), cd], [xL(0), 0], [xR(0), 0], [xR(cd), cd],
    ];

    // Relleno de agua a una profundidad dada
    const waterPoly = (y: number): [number, number][] =>
      y > 0.05 ? [[xL(y), y], [xL(0), 0], [xR(0), 0], [xR(y), y]] : [];

    const xMax = Math.max(2, xR(cd) + 1);
    const yMax = Math.max(1, +(cd * 1.12).toFixed(2));

    return {
      animation: false,
      backgroundColor: 'transparent',
      tooltip: { show: false },
      grid: { top: 18, bottom: 28, left: 42, right: 12 },
      xAxis: {
        type: 'value', min: -xMax, max: xMax,
        axisLabel: { color: '#64748b', fontSize: 7, formatter: (v: number) => `${v.toFixed(0)}m` },
        axisLine: { lineStyle: { color: '#1e3a5f' } },
        splitLine: { show: false },
        axisTick: { lineStyle: { color: '#1e3a5f' } },
      },
      yAxis: {
        type: 'value', name: 'm', min: 0, max: yMax,
        nameTextStyle: { color: '#334155', fontSize: 7 },
        axisLabel: { color: '#64748b', fontSize: 7, formatter: '{value}' },
        splitLine: { lineStyle: { color: '#080f1c', type: 'dashed' } },
        axisLine: { lineStyle: { color: '#1e3a5f' } },
      },
      series: [
        // Terraplén (fondo del canal — relleno oscuro)
        {
          name: 'Canal', type: 'line', data: canalContorno,
          smooth: false, showSymbol: false, z: 1,
          lineStyle: { color: '#475569', width: 2 },
          areaStyle: { color: 'rgba(15,23,42,0.55)' },
        },
        // Agua simulada Manning (teal, relleno)
        {
          name: 'Agua Simulada', type: 'line', data: waterPoly(yS),
          smooth: false, showSymbol: false, z: 2,
          lineStyle: { color: '#2dd4bf', width: 1.5 },
          areaStyle: { color: 'rgba(45,212,191,0.15)' },
        },
        // Agua actual lecturas (cian punteado, relleno más tenue)
        {
          name: 'Agua Actual', type: 'line', data: waterPoly(yB),
          smooth: false, showSymbol: false, z: 3,
          lineStyle: { color: '#38bdf8', width: 1.5, type: 'dashed' },
          areaStyle: { color: 'rgba(56,189,248,0.10)' },
        },
        // Nivel Real SQL (ámbar, línea horizontal)
        ...(Number.isFinite(yR) && yR > 0.05 ? [{
          name: 'Nivel Real SQL', type: 'line' as const,
          data: [[xL(yR), yR], [xR(yR), yR]] as [number, number][],
          smooth: false, showSymbol: false, z: 4,
          lineStyle: { color: '#f59e0b', width: 2.5 },
        }] : []),
        // Tirante de diseño (gris punteado)
        {
          name: 'Diseño', type: 'line',
          data: [[xL(td), td], [xR(td), td]],
          smooth: false, showSymbol: false, z: 1,
          lineStyle: { color: 'rgba(71,85,105,0.6)', width: 1, type: 'dotted' },
        },
        // Bordo libre / tope del canal (rojo tenue)
        {
          name: 'Bordo Libre', type: 'line',
          data: [[xL(cd), cd], [xR(cd), cd]],
          smooth: false, showSymbol: false, z: 1,
          lineStyle: { color: 'rgba(239,68,68,0.45)', width: 1, type: 'dashed' },
        },
      ],
    };
  }, [activeCPResult, tramoGeom, perfilRpc]);

  // ── GLOBALS ──────────────────────────────────────────────────────────
  const firstCP      = simResults[0];
  const lastCP       = simResults[simResults.length - 1];
  const globalEff    = qDam > 0 && lastCP ? ((lastCP.q_sim ?? 0) / qDam) * 100 : 0;
  const iecSim = simResults.length > 0 ? calcIEC({
    eficiencia:       globalEff,
    n_coherentes:     simResults.filter(r => r.status === 'ESTABLE').length,
    total_puntos:     simResults.length,
    q_fuga_total:     0,
    q_entrada:        qDam,
    escalas_criticas: simResults.filter(r => r.status === 'CRITICO').length,
    total_escalas:    simResults.length,
  }) : null;

  const iecSimRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = iecSimRef.current;
    if (!el || !iecSim) return;
    el.style.setProperty('--iec-color',  iecColor(iecSim.semaforo));
    el.style.setProperty('--iec-pef',    `${(iecSim.p_eficiencia / 30) * 100}%`);
    el.style.setProperty('--iec-pcoh',   `${(iecSim.p_coherencia / 25) * 100}%`);
    el.style.setProperty('--iec-pfug',   `${(iecSim.p_fugas      / 25) * 100}%`);
    el.style.setProperty('--iec-pcrit',  `${(iecSim.p_criticos   / 20) * 100}%`);
  }, [iecSim]);

  const systemStatus: CPStatus = simResults.some(r => r.status === 'CRITICO')
    ? 'CRITICO' : simResults.some(r => r.status === 'ALERTA') ? 'ALERTA' : 'ESTABLE';
  const riverLagMin  = riverTransit
    ? (RIVER_KM * 1000 / (0.5 * Math.pow(Math.max(qDam, 1), 0.4) + 0.5)) / 60 : 0;

  const StatusIcon = ({ s }: { s: CPStatus }) =>
    s === 'CRITICO' ? <AlertOctagon size={14} /> :
    s === 'ALERTA'  ? <AlertTriangle size={14} /> :
    <CheckCircle size={14} />;

  // ── RENDER ───────────────────────────────────────────────────────────
  if (!dataLoaded) {
    return (
      <div className="sim-loading">
        <div>
          <Waves size={32} opacity={0.5} />
          <p>Cargando datos hidráulicos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sim-root">

      {showReport && (
        <SimulationReport
          scenario={{
            q_base:          qBase,
            q_sim:           qDam,
            isRiver:         riverTransit,
            startTime:       fmtTime(simBaseMin, 0),
            movimientoTime:  fmtTime(simBaseMin, 0),
            date:            formatDate(new Date()),
            eventType:       eventType,
            damFuente:       dataStatus.damFuente,
            damBaseValue:    dataStatus.damBaseValue,
            damCurrentValue: dataStatus.damCurrentValue,
            damNivel:           dataStatus.damNivel,
            totalExtractionM3s: dataStatus.totalExtractionM3s,
          }}
          results={simResults}
          gateBase={gateBase}
          deliveryPoints={deliveryPoints}
          onClose={() => setShowReport(false)}
        />
      )}

      {/* ── ENCABEZADO ─────────────────────────────────────────────── */}
      <header className="sim-header">
        <div className="sim-brand">
          <div className="sim-brand-icon"><Waves size={18} /></div>
          <div>
            <div className="sim-brand-title">SIMULADOR HIDRÁULICO</div>
            <div className="sim-brand-sub">Canal Principal Conchos · DR-005 · SICA</div>
          </div>
        </div>

        <div className="sim-kpi-row">
          <div className="sim-kpi">
            <div className="sim-kpi-label">Extracción Presa</div>
            <div className="sim-kpi-val" style={{ color: '#38bdf8' }}>{qDam.toFixed(1)}<span> m³/s</span></div>
          </div>
          <div className="sim-kpi">
            <div className="sim-kpi-label">Nivel K-0</div>
            <div className="sim-kpi-val" style={{ color: '#2dd4bf' }}>{firstCP ? (firstCP.y_sim ?? 0).toFixed(2) : '—'}<span> m</span></div>
          </div>
          <div className="sim-kpi">
            <div className="sim-kpi-label">Eficiencia Conducción</div>
            <div className="sim-kpi-val" style={{ color: globalEff >= 90 ? '#10b981' : globalEff >= 85 ? '#f59e0b' : '#ef4444' }}>
              {(globalEff ?? 0).toFixed(1)}<span>%</span>
            </div>
          </div>
          {iecSim && (
            <div
              className="sim-kpi sim-kpi-iec"
              ref={iecSimRef}
              title={`${iecSim.texto}\nEficiencia: ${iecSim.p_eficiencia}/30\nCoherencia: ${iecSim.p_coherencia}/25\nFugas: ${iecSim.p_fugas}/25\nNivel canal: ${iecSim.p_criticos}/20`}
            >
              <div className="sim-kpi-label">IEC Canal</div>
              <div className="sim-kpi-val sim-kpi-iec-val">{iecSim.iec}<span>/100</span></div>
              <div className="sim-kpi-iec-bars">
                <div className="sim-kpi-iec-bar iec-fill-ef" />
                <div className="sim-kpi-iec-bar iec-fill-coh" />
                <div className="sim-kpi-iec-bar iec-fill-fug" />
                <div className="sim-kpi-iec-bar iec-fill-crit" />
              </div>
            </div>
          )}
          <div className="sim-kpi">
            <div className="sim-kpi-label">Arribo K-104</div>
            <div className="sim-kpi-val" style={{ color: '#fbbf24' }}>{lastCP?.arrival_time ?? '—'}</div>
          </div>
          <div className="sim-kpi-status" style={{ background: `${statusColor(systemStatus)}1a`, borderColor: statusColor(systemStatus) }}>
            <span style={{ color: statusColor(systemStatus) }}><StatusIcon s={systemStatus} /></span>
            <span style={{ color: statusColor(systemStatus), fontWeight: 700 }}>{systemStatus}</span>
          </div>
        </div>

        <div className="sim-header-actions">
          <button className={`sim-mode-btn ${simpleMode ? 'active' : ''}`} onClick={() => setSimpleMode(!simpleMode)}>
            {simpleMode ? <Eye size={12} /> : <EyeOff size={12} />}
            {simpleMode ? 'Operativo' : 'Técnico'}
          </button>
          <button
            type="button"
            className={`sim-mode-btn ${showScenarioB ? 'active' : ''}`}
            onClick={() => {
              if (!showScenarioB) setQDamB(qDam);
              setShowScenarioB(v => !v);
            }}
          >
            <Activity size={12} /> Comparar
          </button>
          <button type="button" className="sim-report-btn" onClick={() => setShowReport(true)} disabled={simResults.length === 0}>
            <FileText size={12} /> Reporte PDF
          </button>
        </div>
      </header>

      {/* ── BARRA DE CONTROL ───────────────────────────────────────── */}
      <div className="sim-ctrl-bar">
        <div className="sim-event-group">
          <div className="sim-ctrl-label">TIPO DE MANIOBRA</div>
          <div className="sim-event-btns">
            {([
              { key: 'INCREMENTO' as EventType, icon: <TrendingUp size={11} />,  label: '+ Incremento', color: '#10b981' },
              { key: 'DECREMENTO' as EventType, icon: <TrendingDown size={11} />, label: '− Decremento', color: '#3b82f6' },
              { key: 'CORTE'      as EventType, icon: <Zap size={11} />,          label: '✂ Corte',      color: '#ef4444' },
              { key: 'LLENADO'    as EventType, icon: <Waves size={11} />,        label: '◯ Llenado',   color: '#a78bfa' },
            ]).map(ev => (
              <button
                key={ev.key}
                className={`sim-event-btn ${eventType === ev.key ? 'active' : ''}`}
                style={eventType === ev.key ? { borderColor: ev.color, color: ev.color, background: `${ev.color}22` } : {}}
                onClick={() => setEventType(ev.key)}
              >
                {ev.icon} {ev.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sim-flow-group">
          <div className="sim-ctrl-label">GASTO SIMULADO · PRESA LA BOQUILLA</div>
          {/* Contexto: base (inicio del día) → actual → simulado */}
          <div className="sim-flow-context">
            <span className="sim-ctx-item base">
              BASE&nbsp;{qBase.toFixed(1)}&nbsp;m³/s
            </span>
            <span className="sim-ctx-arrow">→</span>
            {dataStatus.damCurrentValue !== qBase && (
              <>
                <span className="sim-ctx-item current">
                  ACTUAL&nbsp;{dataStatus.damCurrentValue.toFixed(1)}&nbsp;m³/s
                </span>
                <span className="sim-ctx-arrow">→</span>
              </>
            )}
            <span className={`sim-ctx-item sim ${qDam > qBase ? 'up' : qDam < qBase ? 'dn' : 'eq'}`}>
              SIM&nbsp;{qDam.toFixed(1)}&nbsp;m³/s
            </span>
          </div>
          <div className="sim-flow-row">
            <span className="sim-flow-val">{qDam.toFixed(1)}</span>
            <span className="sim-flow-unit">m³/s</span>
            <input type="range" min={0} max={120} step={0.5} value={qDam}
              onChange={e => setQDam(+e.target.value)}
              className="sim-slider" title="Gasto de extracción presa" />
            <div className={`sim-delta-chip ${qDam > qBase ? 'pos' : qDam < qBase ? 'neg' : 'neu'}`}>
              {qDam > qBase ? <ArrowUp size={9} /> : qDam < qBase ? <ArrowDown size={9} /> : null}
              {qDam === qBase ? '= Base' : `${qDam > qBase ? '+' : ''}${(qDam - qBase).toFixed(1)} vs base`}
            </div>
          </div>
          <div className="sim-flow-hints">
            <span>0</span>
            <span style={{ color: '#64748b' }}>
              Q diseño 80 m³/s&nbsp;·&nbsp;
              {dataStatus.damFuente === 'movimientos_presas'
                ? `Fuente: mov. presa`
                : dataStatus.damFuente === 'lecturas_presas'
                  ? `Fuente: lect. presa`
                  : 'Sin telemetría — estimado'}
            </span>
            <span>120</span>
          </div>
        </div>

        <label className="sim-river-toggle">
          <input type="checkbox" checked={riverTransit} onChange={() => setRiverTransit(!riverTransit)} className="sim-checkbox" />
          <div>
            <div className="sim-river-label">Tránsito de Río</div>
            <div className="sim-river-sub">Presa → K-0 ({RIVER_KM} km){riverTransit ? ` · +${riverLagMin.toFixed(0)} min` : ''}</div>
          </div>
        </label>
      </div>

      {/* ── BANDA DE ESTADO DE TELEMETRÍA ──────────────────────────── */}
      <div className="sim-datasource-strip">
        <div className={`sim-ds-pill ${dataStatus.dam ? 'live' : 'default'}`}>
          <span className="sim-ds-dot" />
          <span className="sim-ds-label">PRESA · BOQUILLA</span>
          <span className="sim-ds-val">
            {dataStatus.dam ? (
              dataStatus.damBaseValue === dataStatus.damCurrentValue
                ? `${dataStatus.damBaseValue.toFixed(1)} m³/s · sin cambio hoy`
                : `Base ${dataStatus.damBaseValue.toFixed(1)} → Actual ${dataStatus.damCurrentValue.toFixed(1)} m³/s`
            ) : `${dataStatus.damBaseValue.toFixed(1)} m³/s (${dataStatus.damFuente})`}
          </span>
        </div>
        <div className={`sim-ds-pill ${dataStatus.gates ? 'live' : 'default'}`}>
          <span className="sim-ds-dot" />
          <span className="sim-ds-label">APERTURAS</span>
          <span className="sim-ds-val">
            {dataStatus.gates ? 'SICA Capture' : 'Valores por defecto'}
          </span>
        </div>
        <div className={`sim-ds-pill ${dataStatus.levels ? 'live' : 'default'}`}>
          <span className="sim-ds-dot" />
          <span className="sim-ds-label">ESCALAS</span>
          <span className="sim-ds-val">
            {dataStatus.levels
              ? `${Object.keys(baseReadings).length}/${controlPoints.length} puntos`
              : 'Sin telemetría'}
          </span>
        </div>
        <div className={`sim-ds-pill ${dataStatus.deliveries ? 'live' : 'default'}`}>
          <span className="sim-ds-dot" />
          <span className="sim-ds-label">TOMAS · ENTREGA</span>
          <span className="sim-ds-val">
            {dataStatus.deliveries
              ? `${deliveryPoints.filter(d => d.is_active).length} activas · −${dataStatus.totalExtractionM3s.toFixed(2)} m³/s`
              : 'Sin reporte del día'}
          </span>
        </div>
        <div className={`sim-ds-pill ${dataStatus.qRealK0 !== undefined ? 'live' : 'default'}`}>
          <span className="sim-ds-dot" />
          <span className="sim-ds-label">Q ENTRADA CANAL</span>
          <span className="sim-ds-val">
            {dataStatus.qRealK0 !== undefined
              ? `${dataStatus.qRealK0.toFixed(1)} m³/s · COMPUERTA K-0 (SICA Capture)`
              : dataStatus.perfilFuente
                ? `${(dataStatus.perfilQ ?? 0).toFixed(1)} m³/s · ${dataStatus.perfilFuente}`
                : 'Sin telemetría en K-0'}
          </span>
        </div>
        {dataStatus.timestamp && (
          <div className="sim-ds-ts">
            <Clock size={9} /> Actualizado {dataStatus.timestamp}
          </div>
        )}
      </div>

      {/* ── CUERPO ──────────────────────────────────────────────────── */}
      <main className="sim-body">

        {/* ─── IZQUIERDA: Tarjetas CP ─────────────────────────────── */}
        <aside className="sim-left">
          <div className="sim-panel-title"><Activity size={10} /> Puntos de Control</div>
          <div className="sim-cp-list">
            {controlPoints.map(cp => {
              const r  = simResults.find(s => s.id === cp.id);
              const dy = r?.delta_y ?? 0;
              const sc = statusColor(r?.status ?? 'ESTABLE');
              const isActive = activeCP === cp.id;
              return (
                <div
                  key={cp.id}
                  className={`sim-cp-card ${isActive ? 'active' : ''}`}
                  style={isActive ? { borderColor: sc, background: `${sc}0d` } : {}}
                  onClick={() => setActiveCP(cp.id)}
                >
                  <div className="sim-cp-card-top">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div className="sim-cp-dot" style={{ background: sc, boxShadow: `0 0 7px ${sc}` }} />
                      <div>
                        <div className="sim-cp-name">{cp.nombre}</div>
                        <div className="sim-cp-km">KM {cp.km} · {r?.remanso_type ?? 'NORMAL'}</div>
                      </div>
                    </div>
                    <div style={{ color: sc, fontSize: 8, fontWeight: 700 }}>{r?.status ?? '—'}</div>
                  </div>

                  {simpleMode ? (
                    <div className="sim-card-simple">
                      <div className="sim-card-levels">
                        <div>
                          <div className="sim-lvl-label">ACTUAL</div>
                          <div className="sim-lvl-val">{(r?.y_base ?? 0).toFixed(2)}<span>m</span></div>
                        </div>
                        <div className={`sim-arrow ${dy > 0.015 ? 'up' : dy < -0.015 ? 'down' : 'flat'}`}>
                          {dy > 0.015 ? <ArrowUp size={20} /> : dy < -0.015 ? <ArrowDown size={20} /> : <span style={{ fontSize: 16 }}>—</span>}
                        </div>
                        <div>
                          <div className="sim-lvl-label">SIMULADO</div>
                          <div className="sim-lvl-val" style={{ color: sc }}>{(r?.y_sim ?? 0).toFixed(2)}<span>m</span></div>
                        </div>
                      </div>
                      <div className="sim-card-info-row">
                        <span className="sim-delta-txt" style={{ color: Math.abs(dy) * 100 > 5 ? (dy > 0 ? '#fbbf24' : '#60a5fa') : '#475569' }}>
                          {deltaLabel(dy)}
                        </span>
                        <span className="sim-transit-txt"><Clock size={10} /> {transitLabel(r?.cumulative_min ?? 0)}</span>
                      </div>
                      <div className="sim-pct-bar">
                        <div className="sim-pct-fill" style={{
                          width: `${Math.min(100, r?.bordo_libre_pct ?? 0)}%`,
                          background: (r?.bordo_libre_pct ?? 0) > 92 ? '#ef4444' : (r?.bordo_libre_pct ?? 0) > 75 ? '#f59e0b' : '#10b981',
                        }} />
                      </div>
                      <div className="sim-pct-lbl">{(r?.bordo_libre_pct ?? 0).toFixed(0)}% del bordo libre</div>
                      {/* Extracción real en este tramo */}
                      {(r?.n_tomas_activas ?? 0) > 0 && (
                        <div className="sim-delivery-chip">
                          <Droplets size={8} />
                          {r!.n_tomas_activas} toma{r!.n_tomas_activas > 1 ? 's' : ''} ·
                          −{r!.q_extraido.toFixed(2)} m³/s entregado
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="sim-card-tech">
                      {[
                        ['y_base / y_sim', `${(r?.y_base ?? 0).toFixed(2)} / ${(r?.y_sim ?? 0).toFixed(2)} m`],
                        ['Δy (Remanso)',   `${(dy ?? 0) >= 0 ? '+' : ''}${(dy ?? 0).toFixed(3)} m`],
                        ['Q · V · Fr',    `${(r?.q_sim ?? 0).toFixed(1)} m³/s · ${(r?.velocity_ms ?? 0).toFixed(2)} · ${(r?.froude_n ?? 0).toFixed(3)}`],
                        ['Tomas activas',  `${r?.n_tomas_activas ?? 0} · −${(r?.q_extraido ?? 0).toFixed(2)} m³/s`],
                        ['Arribo',        r?.arrival_time ?? '—'],
                      ].map(([k, v]) => (
                        <div key={k} className="sim-tech-row">
                          <span>{k}</span><span>{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        {/* ─── CENTRO: Perfil + Timeline ──────────────────────────── */}
        <section className="sim-center">
          <div className="sim-profile-card">
            <div className="sim-profile-hdr">
              <span className="sim-profile-title">
                <Waves size={12} />
                {simpleMode ? 'Perfil Hidráulico · Tirante a lo Largo del Canal' : 'Perfil Longitudinal Hidráulico · Tirante y Caudal por KM'}
              </span>
              <div className="sim-profile-legend">
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: '#38bdf8', borderRadius: 0 }} /> Tirante Actual</span>
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: '#2dd4bf' }} /> Tirante Simulado</span>
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: '#a78bfa', borderRadius: 0 }} /> Caudal Q</span>
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: '#ef4444', borderRadius: 0, opacity: 0.5 }} /> Bordo Libre</span>
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: '#fbbf24', borderRadius: '50%' }} /> Frente de Onda</span>
                {simResults.some(r => r.remanso_type === 'M1') && <span className="sim-leg-tag tag-m1">▲ Incremento</span>}
                {simResults.some(r => r.remanso_type === 'M2') && <span className="sim-leg-tag tag-m2">▼ Decremento</span>}
              </div>
            </div>
            <div className="sim-chart-wrap">
              <ReactECharts option={opsChartOption} style={{ height: '100%', width: '100%' }} notMerge={true} />
            </div>
          </div>

          {/* ─── PANEL B: HIDROGRAMA DE GASTO ───────────────────── */}
          <div className="sim-qflow-card">
            <div className="sim-qflow-hdr">
              <span className="sim-qflow-title">
                <Droplets size={11} />
                Hidrograma de Gasto · Q Real vs Q Simulado a lo Largo del Canal
              </span>
              <div className="sim-profile-legend">
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: '#f59e0b', borderRadius: 2 }} /> Q Real SQL</span>
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: '#2dd4bf', borderRadius: 0 }} /> Q Simulado</span>
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: 'rgba(251,191,36,0.55)', borderRadius: 1 }} /> Extracciones</span>
                {dataStatus.perfilFuente && (
                  <span className="sim-leg sim-leg-fuente">
                    Fuente: {dataStatus.perfilFuente}
                  </span>
                )}
              </div>
            </div>
            <div className="sim-qflow-chart">
              <ReactECharts option={qChartOption} style={{ height: '100%', width: '100%' }} notMerge={true} />
            </div>
          </div>

          {/* ─── ETAPA 5: SECCIÓN TRANSVERSAL ──────────────────── */}
          {activeCPResult && (
            <div className="sim-cross-card">
              <div className="sim-qflow-hdr">
                <span className="sim-qflow-title">
                  <Activity size={11} />
                  Sección Transversal · {activeCPResult.nombre} · KM {activeCPResult.km}
                  &nbsp;·&nbsp;
                  Plantilla {activeCPResult.plantilla_m.toFixed(0)} m · Z {findTramo(activeCPResult.km, tramoGeom).talud_z}:1
                </span>
                <div className="sim-profile-legend">
                  <span className="sim-leg"><span className="sim-leg-dot sim-leg-dot--amber" /> Nivel Real SQL</span>
                  <span className="sim-leg"><span className="sim-leg-dot sim-leg-dot--cyan-line" /> Actual</span>
                  <span className="sim-leg"><span className="sim-leg-dot sim-leg-dot--teal" /> Simulado</span>
                  <span className="sim-leg sim-leg--muted">
                    y_real {Number.isFinite(activeCPResult.y_base) ? activeCPResult.y_base.toFixed(2) : '—'} m ·
                    y_sim {activeCPResult.y_sim.toFixed(2)} m ·
                    Δ {((activeCPResult.y_sim - activeCPResult.y_base) * 100).toFixed(0)} cm
                  </span>
                </div>
              </div>
              <div className="sim-cross-chart">
                <ReactECharts option={crossSectionOption} style={{ height: '155px', width: '100%' }} notMerge={true} lazyUpdate={false} />
              </div>
            </div>
          )}

          {/* ─── PANEL COMPARACIÓN DE ESCENARIOS (Fase 2) ────────── */}
          {showScenarioB && (
            <div className="sim-compare-card">
              <div className="sim-compare-hdr">
                <span className="sim-compare-title">
                  <Activity size={12} /> ¿QUÉ PASA SI? · Comparación de Escenarios
                </span>
                <button type="button" className="sim-compare-close" onClick={() => setShowScenarioB(false)}>✕</button>
              </div>

              {/* Controles del escenario B */}
              <div className="sim-compare-ctrl">
                <div className="sim-compare-scenarios">
                  <div className="sim-compare-scen scen-a">
                    <span className="sim-compare-scen-lbl">A · ACTUAL</span>
                    <span className="sim-compare-scen-val">{qDam.toFixed(1)} m³/s</span>
                  </div>
                  <span className="sim-compare-vs">VS</span>
                  <div className="sim-compare-scen scen-b">
                    <span className="sim-compare-scen-lbl">B · HIPOTÉTICO</span>
                    <div className="sim-compare-b-ctrl">
                      <span className="sim-compare-scen-val">{qDamB.toFixed(1)} m³/s</span>
                      <input type="range" min={0} max={120} step={0.5} value={qDamB}
                        onChange={e => setQDamB(+e.target.value)}
                        className="sim-compare-slider" title="Gasto escenario B" />
                      <div className="sim-preset-btns">
                        {[-25, -10, 0, +10, +25].map(pct => {
                          const target = Math.max(0, Math.min(120, Math.round((qDam * (1 + pct / 100)) * 2) / 2));
                          const isActive = Math.abs(qDamB - target) < 0.1;
                          return (
                            <button
                              key={pct}
                              type="button"
                              className={`sim-preset-btn ${isActive ? 'active' : ''}`}
                              onClick={() => setQDamB(target)}
                              title={`${target.toFixed(1)} m³/s`}
                            >
                              {pct === 0 ? '=A' : `${pct > 0 ? '+' : ''}${pct}%`}
                            </button>
                          );
                        })}
                      </div>
                      <div className={`sim-delta-chip ${qDamB > qDam ? 'pos' : qDamB < qDam ? 'neg' : 'neu'}`}>
                        {qDamB === qDam ? '= A' : `${qDamB > qDam ? '+' : ''}${(qDamB - qDam).toFixed(1)} vs A`}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tabla de comparación por punto de control */}
              <div className="sim-compare-table-wrap">
                <table className="sim-compare-table">
                  <thead>
                    <tr>
                      <th>Sección</th>
                      <th className="scen-a-col">Q · Esc A</th>
                      <th className="scen-b-col">Q · Esc B</th>
                      <th className="scen-a-col">Escala A</th>
                      <th className="scen-b-col">Escala B</th>
                      <th>Δ Escala</th>
                      <th className="scen-a-col">Arribo A</th>
                      <th className="scen-b-col">Arribo B</th>
                      <th>Estado A/B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simResults.map((rA, i) => {
                      const rB = simResultsB[i];
                      const dy  = rB ? rB.y_sim - rA.y_sim : 0;
                      const dq  = rB ? rB.q_sim - rA.q_sim : 0;
                      const scA = statusColor(rA.status);
                      const scB = rB ? statusColor(rB.status) : '#94a3b8';
                      const dyColor = Math.abs(dy) < 0.005 ? '#94a3b8' : dy > 0 ? '#fbbf24' : '#60a5fa';
                      return (
                        <tr key={rA.id} className={activeCP === rA.id ? 'active-row' : ''} onClick={() => setActiveCP(rA.id)}>
                          <td className="sim-compare-name">{rA.nombre.replace(/^(K-\d+)\s+/, '$1 ')}</td>
                          <td className="scen-a-col">{rA.q_sim.toFixed(1)}</td>
                          <td className="scen-b-col">{rB ? rB.q_sim.toFixed(1) : '—'}
                            {rB && Math.abs(dq) > 0.1 && (
                              <span className={`sim-compare-diff ${dq > 0 ? 'pos' : 'neg'}`}> {dq > 0 ? '+' : ''}{dq.toFixed(1)}</span>
                            )}
                          </td>
                          <td className="scen-a-col" style={{ color: scA }}>{rA.y_sim.toFixed(2)}m</td>
                          <td className="scen-b-col" style={{ color: scB }}>{rB ? `${rB.y_sim.toFixed(2)}m` : '—'}</td>
                          <td style={{ color: dyColor, fontWeight: 600 }}>
                            {rB ? `${dy >= 0 ? '+' : ''}${Math.round(dy * 100)} cm` : '—'}
                          </td>
                          <td className="scen-a-col">{rA.arrival_time}</td>
                          <td className="scen-b-col">{rB?.arrival_time ?? '—'}</td>
                          <td>
                            <span className="sim-compare-status" style={{ color: scA }}>{rA.status[0]}</span>
                            {rB && <span className="sim-compare-status-sep">/</span>}
                            {rB && <span className="sim-compare-status" style={{ color: scB }}>{rB.status[0]}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* ── Modificar tomas para el escenario ── */}
              {deliveryPoints.filter(d => d.is_active).length > 0 && (
                <div className="sim-mods-section">
                  <div className="sim-mods-hdr">
                    <span>MODIFICAR EXTRACCIONES · ESCENARIO B</span>
                    {scenarioMods.length > 0 && (
                      <button type="button" className="sim-mods-clear"
                        onClick={() => { setScenarioMods([]); setScenarioRpcRows([]); }}>
                        Limpiar todo
                      </button>
                    )}
                  </div>
                  <div className="sim-mods-list">
                    {deliveryPoints.filter(d => d.is_active).map(d => {
                      const mod = scenarioMods.find(m => m.punto_id === d.punto_id);
                      const val = mod !== undefined ? mod.nuevo_caudal : d.caudal_m3s;
                      const isClosed = val === 0;
                      return (
                        <div key={d.punto_id} className={`sim-mod-row ${mod ? 'modified' : ''}`}>
                          <span className="sim-mod-km">K{d.km.toFixed(1)}</span>
                          <span className="sim-mod-name">{d.nombre}</span>
                          <input
                            type="number" min={0} step={0.01}
                            value={val}
                            className="sim-mod-input"
                            title="Nuevo caudal m³/s"
                            onChange={e => {
                              const nv = Math.max(0, parseFloat(e.target.value) || 0);
                              setScenarioMods(prev => {
                                const without = prev.filter(m => m.punto_id !== d.punto_id);
                                if (Math.abs(nv - d.caudal_m3s) < 0.001) return without;
                                return [...without, { punto_id: d.punto_id, nombre: d.nombre, km: d.km, nuevo_caudal: nv, original: d.caudal_m3s }];
                              });
                              setScenarioRpcRows([]);
                            }}
                          />
                          <span className="sim-mod-unit">m³/s</span>
                          <button
                            type="button"
                            className={`sim-mod-close-btn ${isClosed ? 'closed' : ''}`}
                            title={isClosed ? 'Restaurar' : 'Cerrar toma'}
                            onClick={() => {
                              setScenarioMods(prev => {
                                const without = prev.filter(m => m.punto_id !== d.punto_id);
                                if (isClosed) return without;
                                return [...without, { punto_id: d.punto_id, nombre: d.nombre, km: d.km, nuevo_caudal: 0, original: d.caudal_m3s }];
                              });
                              setScenarioRpcRows([]);
                            }}
                          >
                            {isClosed ? '↺' : '✕'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className="sim-rpc-btn"
                    onClick={runScenarioRpc}
                    disabled={scenarioRpcLoading}
                  >
                    {scenarioRpcLoading
                      ? '⏳ Simulando...'
                      : `▶ Simular en servidor${scenarioMods.length > 0 ? ` (${scenarioMods.length} modif.)` : ''}`
                    }
                  </button>
                </div>
              )}

              {/* ── Resultados RPC servidor ── */}
              {scenarioRpcRows.length > 0 && (
                <div className="sim-rpc-results">
                  <div className="sim-mods-hdr">
                    <span>RESULTADO SERVIDOR · {scenarioRpcRows.length} TRAMOS</span>
                    <button type="button" className="sim-mods-clear" onClick={() => setScenarioRpcRows([])}>✕</button>
                  </div>
                  <div className="sim-compare-table-wrap">
                    <table className="sim-compare-table">
                      <thead>
                        <tr>
                          <th className="sim-rpc-th-left">Tramo</th>
                          <th>Q sal.</th>
                          <th>Tirante</th>
                          <th>Δ cm</th>
                          <th>Arribo</th>
                          <th>Fr</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scenarioRpcRows.map((row: any, i: number) => {
                          const dy = row.delta_y_cm ?? 0;
                          const fr = row.froude ?? 0;
                          return (
                            <tr key={i} className={row.tipo_punto === 'k104' ? 'active-row' : ''}>
                              <td className="sim-rpc-tramo-name">
                                {(row.nombre_tramo ?? '').split(' (')[0]}
                              </td>
                              <td className="sim-rpc-q">{(row.q_salida_m3s ?? 0).toFixed(1)}</td>
                              <td>{(row.y_normal_m ?? 0).toFixed(2)}m</td>
                              <td className={`sim-rpc-dy ${dy > 5 ? 'up' : dy < -5 ? 'dn' : ''}`}>
                                {dy >= 0 ? '+' : ''}{row.delta_y_cm ?? '—'}
                              </td>
                              <td className="sim-rpc-arribo">{row.hora_arribo ?? '—'}</td>
                              <td className={`sim-rpc-fr ${fr > 0.8 ? 'crit' : fr > 0.5 ? 'warn' : 'ok'}`}>
                                {fr.toFixed(2)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Resumen ejecutivo comparativo */}
              {simResultsB.length > 0 && (() => {
                const lastA = simResults[simResults.length - 1];
                const lastB = simResultsB[simResultsB.length - 1];
                const arrDiff = lastB.cumulative_min - lastA.cumulative_min;
                const effA = qDam > 0 ? (lastA.q_sim / qDam * 100) : 0;
                const effB = qDamB > 0 ? (lastB.q_sim / qDamB * 100) : 0;
                const critA = simResults.filter(r => r.status === 'CRITICO').length;
                const critB = simResultsB.filter(r => r.status === 'CRITICO').length;
                return (
                  <div className="sim-compare-summary">
                    <div className="sim-compare-sum-item">
                      <span className="sim-compare-sum-lbl">Arribo K-104</span>
                      <span className="sim-compare-sum-a">{lastA.arrival_time}</span>
                      <span className="sim-compare-sum-sep">→</span>
                      <span className="sim-compare-sum-b">{lastB.arrival_time}</span>
                      <span className={`sim-compare-sum-diff ${arrDiff > 0 ? 'slower' : 'faster'}`}>
                        {arrDiff >= 0 ? '+' : ''}{Math.round(arrDiff)} min
                      </span>
                    </div>
                    <div className="sim-compare-sum-item">
                      <span className="sim-compare-sum-lbl">Eficiencia conducción</span>
                      <span className="sim-compare-sum-a">{effA.toFixed(1)}%</span>
                      <span className="sim-compare-sum-sep">→</span>
                      <span className="sim-compare-sum-b">{effB.toFixed(1)}%</span>
                      <span className={`sim-compare-sum-diff ${effB >= effA ? 'better' : 'worse'}`}>
                        {(effB - effA) >= 0 ? '+' : ''}{(effB - effA).toFixed(1)}%
                      </span>
                    </div>
                    <div className="sim-eff-bars">
                      <div className="sim-eff-bar-row">
                        <span className="sim-eff-bar-lbl scen-a-col">A</span>
                        <div className="sim-eff-bar-track">
                          <div
                            className="sim-eff-bar-fill scen-a"
                            style={{ '--bar-w': `${Math.min(100, effA)}%` } as React.CSSProperties}
                            title={`Eficiencia A: ${effA.toFixed(1)}%`}
                          />
                        </div>
                        <span className="sim-eff-bar-val scen-a-col">{effA.toFixed(1)}%</span>
                      </div>
                      <div className="sim-eff-bar-row">
                        <span className="sim-eff-bar-lbl scen-b-col">B</span>
                        <div className="sim-eff-bar-track">
                          <div
                            className={`sim-eff-bar-fill scen-b ${effB >= effA ? 'better' : 'worse'}`}
                            style={{ '--bar-w': `${Math.min(100, effB)}%` } as React.CSSProperties}
                            title={`Eficiencia B: ${effB.toFixed(1)}%`}
                          />
                        </div>
                        <span className="sim-eff-bar-val scen-b-col">{effB.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="sim-compare-sum-item">
                      <span className="sim-compare-sum-lbl">Secciones críticas</span>
                      <span className="sim-compare-sum-a">{critA}</span>
                      <span className="sim-compare-sum-sep">→</span>
                      <span className="sim-compare-sum-b">{critB}</span>
                      <span className={`sim-compare-sum-diff ${critB <= critA ? 'better' : 'worse'}`}>
                        {critB - critA >= 0 ? '+' : ''}{critB - critA}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Timeline de tránsito */}
          <div className="sim-timeline-card">
            <div className="sim-tl-header">
              <div className="sim-player">
                <button type="button" className={`sim-play-btn ${isPlaying ? 'playing' : ''}`} onClick={() => setIsPlaying(!isPlaying)}>
                  {isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
                </button>
                <button type="button" title="Reiniciar animación" className="sim-reset-btn" onClick={() => { setTimeDelta(0); setIsPlaying(false); }}>
                  <RotateCcw size={12} />
                </button>
                <input type="range" min={0} max={480} value={timeDelta}
                  onChange={e => { setTimeDelta(+e.target.value); setIsPlaying(false); }}
                  className="sim-time-slider" title="Control de tiempo" />
                <span className="sim-time-lbl">
                  t+{timeDelta}min <span style={{ color: '#fbbf24' }}>({(timeDelta / 60).toFixed(1)}h)</span>
                </span>
              </div>
              <span className="sim-tl-label">Propagación de Onda · Arribo por Sección</span>
            </div>
            <div className="sim-track">
              <div className="sim-track-rail" />
              {simResults.map(r => {
                const pct     = (r.km / 104) * 100;
                const arrived = timeDelta >= r.cumulative_min;
                const sc      = statusColor(r.status);
                return (
                  <div key={r.id} className="sim-track-node" style={{ left: `${pct}%` }} onClick={() => setActiveCP(r.id)}>
                    <div className="sim-track-dot" style={{
                      background: arrived ? sc : '#1e3a5f',
                      boxShadow:  arrived ? `0 0 10px ${sc}` : 'none',
                      borderColor: sc,
                    }} />
                    <div className="sim-track-km">K{r.km}</div>
                    <div className="sim-track-time" style={{ color: arrived ? '#fbbf24' : '#475569' }}>{r.arrival_time}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ─── DERECHA: Detalle Punto Activo ──────────────────────── */}
        <aside className="sim-right">
          {activeCPResult && activeCPData ? (
            <>
              <div className="sim-panel-title"><Activity size={10} /> {activeCPData.nombre}</div>

              {/* Sección transversal */}
              <div className="sim-section-wrap">
                <div className="sim-section-lbl">Sección Transversal</div>
                <CanalSection
                  yBase={activeCPResult.y_base}
                  ySim={activeCPResult.y_sim}
                  plantilla={activeCPResult.plantilla_m || PLANTILLA}
                  talud={findTramo(activeCPResult.km, tramoGeom).talud_z}
                  freeboard={activeCPResult.canal_depth_m || FREEBOARD}
                />
                <div className="sim-section-leg">
                  <span><span style={{ display: 'inline-block', width: 10, height: 2, background: '#2dd4bf', verticalAlign: 'middle', marginRight: 4 }} />Simulado</span>
                  <span><span style={{ display: 'inline-block', width: 10, height: 2, background: '#38bdf8', opacity: 0.6, verticalAlign: 'middle', marginRight: 4 }} />Actual</span>
                  <span><span style={{ display: 'inline-block', width: 10, height: 2, background: '#ef4444', opacity: 0.6, verticalAlign: 'middle', marginRight: 4 }} />Bordo L.</span>
                </div>
              </div>

              {/* Apertura de compuerta — actual SICA vs requerida por simulación */}
              <div className="sim-gate-wrap">
                <div className="sim-gate-hdr">
                  <span>Apertura Radial</span>
                  <div className="sim-gate-badges">
                    {gateBase[activeCP] != null && (
                      <span className="sim-gate-base-badge">
                        SICA: {gateBase[activeCP].toFixed(2)}m
                      </span>
                    )}
                    <span className="sim-gate-val">{(gateOverrides[activeCP] ?? activeCPResult.h_radial ?? 0).toFixed(2)} m</span>
                  </div>
                </div>
                <input type="range" min={0.1} max={3} step={0.05}
                  value={gateOverrides[activeCP] ?? activeCPResult.h_radial}
                  onChange={e => setGateOverrides({ ...gateOverrides, [activeCP]: +e.target.value })}
                  className="sim-slider" title="Apertura de compuerta" />
                <div className="sim-gate-hints">
                  <span>0.1 m</span>
                  <span>{activeCPData.pzas_radiales} pzas · ancho {activeCPData.ancho}m · A={activeCPResult.area_gate.toFixed(1)}m²</span>
                  <span>3.0 m</span>
                </div>
                {/* Bloque de apertura requerida — lógica operativa canal */}
                {Math.abs(qDam - qBase) > 0.5 && (
                  <div className="sim-gate-required">
                    <div className="sim-gate-req-label">
                      {qDam > qBase ? '▲ INCREMENTO' : '▼ DECREMENTO'} · Ajuste operativo requerido
                    </div>
                    <div className="sim-gate-req-row">
                      <div className="sim-gate-req-item">
                        <span className="sim-gate-req-key">Apertura actual (SICA)</span>
                        <span className="sim-gate-req-val current">
                          {(gateBase[activeCP] ?? activeCPResult.h_radial ?? 0).toFixed(2)} m
                        </span>
                      </div>
                      <div className="sim-gate-req-arrow">
                        {activeCPResult.apertura_requerida > (gateBase[activeCP] ?? activeCPResult.h_radial ?? 0)
                          ? '→ ABRIR →' : '→ CERRAR →'}
                      </div>
                      <div className="sim-gate-req-item">
                        <span className="sim-gate-req-key">Apertura requerida</span>
                        <span className="sim-gate-req-val required">
                          {Math.min(3.0, Math.max(0.1, activeCPResult.apertura_requerida)).toFixed(2)} m
                        </span>
                      </div>
                    </div>
                    <div className="sim-gate-req-note">
                      Para mantener escala {activeCPResult.y_base.toFixed(2)}m con Q={activeCPResult.q_sim.toFixed(1)}m³/s
                    </div>
                    {activeCPResult.apertura_requerida > 3.0 && (
                      <div className="sim-gate-req-overflow">
                        <AlertOctagon size={9} /> Apertura calculada {activeCPResult.apertura_requerida.toFixed(2)}m excede límite físico (3.0m) — Q no puede mantenerse en esta escala
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Métricas */}
              {simpleMode ? (
                <div className="sim-metrics-simple">
                  {(() => {
                    const tel = cpTelemetry[activeCP];
                    const dy  = activeCPResult.delta_y;
                    const sc  = statusColor(activeCPResult.status);
                    const movClr = Math.abs(dy)*100 > 5 ? (dy > 0 ? '#f59e0b' : '#60a5fa') : '#94a3b8';
                    return [
                      [<Droplets size={13} />, 'Gasto en sección',    `${(activeCPResult.q_sim??0).toFixed(2)} m³/s`, '#38bdf8'],
                      [<Clock    size={13} />, 'Agua llega en',        transitLabel(activeCPResult.cumulative_min),     '#fbbf24'],
                      [dy > 0.01 ? <ArrowUp size={13}/> : dy < -0.01 ? <ArrowDown size={13}/> : <Activity size={13}/>,
                       'Variación de escala', deltaLabel(dy), movClr],
                      [<StatusIcon s={activeCPResult.status} />, 'Estado', activeCPResult.status, sc],
                      [<Waves size={13}/>, '% Bordo libre', `${(activeCPResult.bordo_libre_pct??0).toFixed(1)}%`, sc],
                      ...(tel?.delta_12h != null && Math.abs(tel.delta_12h) > 0.001 ? [
                        [tel.delta_12h > 0 ? <TrendingUp size={13}/> : <TrendingDown size={13}/>,
                         'Tendencia 12h (telemetría)',
                         `${tel.delta_12h > 0 ? '+' : ''}${(tel.delta_12h * 100).toFixed(0)} cm`,
                         tel.delta_12h > 0 ? '#fbbf24' : '#60a5fa'],
                      ] : []),
                    ] as [React.ReactNode, string, string, string][];
                  })().map(([icon, label, val, color], i) => (
                    <div key={i} className="sim-metric-row">
                      <span style={{ color: color }}>{icon}</span>
                      <span className="sim-metric-lbl">{label}</span>
                      <strong style={{ color }}>{val}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                /* ── MODO TÉCNICO: Análisis Hidráulico Completo ── */
                <div className="sim-hydraulic-analysis">

                  {/* Bloque 1: Condiciones Base (SICA Capture) */}
                  <div className="sim-hyd-block">
                    <div className="sim-hyd-block-title live">
                      <span className="sim-ds-dot" style={{ background: dataStatus.levels ? '#10b981' : '#6b7280' }} />
                      CONDICIONES BASE · SICA Capture
                    </div>
                    {(() => {
                      const tel = cpTelemetry[activeCP];
                      return [
                        ['Tirante base y₀',       `${(activeCPResult.y_base??0).toFixed(3)} m`,
                          dataStatus.levels ? '#38bdf8' : '#64748b'],
                        ['Apertura real radiales', gateBase[activeCP] != null
                          ? `${gateBase[activeCP].toFixed(3)} m  ×${activeCPData.pzas_radiales} pzas`
                          : 'Sin dato telemetría', gateBase[activeCP] != null ? '#38bdf8' : '#6b7280'],
                        ['Gasto medido SICA',      tel?.gasto_medido != null
                          ? `${tel.gasto_medido.toFixed(3)} m³/s`
                          : 'Sin dato telemetría', tel?.gasto_medido != null ? '#38bdf8' : '#6b7280'],
                        ['Lectura AM / PM',
                          tel?.lectura_am != null || tel?.lectura_pm != null
                          ? `${tel?.lectura_am?.toFixed(2) ?? '—'} / ${tel?.lectura_pm?.toFixed(2) ?? '—'} m`
                          : 'Sin lecturas del día', '#64748b'],
                        ['Tendencia 12h Δ',
                          tel?.delta_12h != null && Math.abs(tel.delta_12h) > 0.001
                          ? `${tel.delta_12h > 0 ? '+' : ''}${(tel.delta_12h * 100).toFixed(0)} cm`
                          : 'Estable (< 1 cm)', tel?.delta_12h && Math.abs(tel.delta_12h) > 0.001
                            ? (tel.delta_12h > 0 ? '#fbbf24' : '#60a5fa') : '#64748b'],
                      ] as [string, string, string][];
                    })().map(([k, v, c]) => (
                      <div key={k} className="sim-tech-row">
                        <span>{k}</span><span style={{ color: c }}>{v}</span>
                      </div>
                    ))}
                  </div>

                  {/* Bloque 2: Motor de Simulación */}
                  <div className="sim-hyd-block">
                    <div className="sim-hyd-block-title">
                      ESCENARIO SIMULADO · ΔQ = {(qDam - qBase) >= 0 ? '+' : ''}{(qDam - qBase).toFixed(2)} m³/s
                    </div>
                    {[
                      ['Motor hidráulico',    'Saint-Venant 1D + Orificio',  '#64748b'],
                      ['Fórmula',            'Δy = Q²/(Cd²·A²·2g) − Q₀²/(…)', '#475569'],
                      ['Q₀ (base presa)',    `${qBase.toFixed(3)} m³/s`,      '#38bdf8'],
                      ['Q (simulado)',       `${(activeCPResult.q_sim??0).toFixed(3)} m³/s`, '#2dd4bf'],
                      ['Cd (descarga)',      `${activeCPResult.cd_used.toFixed(3)}${activeCPData.coeficiente_descarga ? ' (real BD)' : ' (global)'}`, '#94a3b8'],
                      ['Área compuerta A',   `${activeCPResult.area_gate.toFixed(3)} m²`,    '#94a3b8'],
                      ['Carga base H₀',      `${(activeCPResult.head_base??0).toFixed(4)} m`, '#64748b'],
                      ['Carga simulada H',   `${(activeCPResult.head_sim??0).toFixed(4)} m`,  '#64748b'],
                      ['ΔH (carga orificio)',`${(activeCPResult.head_delta??0) >= 0 ? '+' : ''}${(activeCPResult.head_delta??0).toFixed(4)} m`, '#fbbf24'],
                      ['── Lógica operativa ──', '────────────────', '#1e3a5f'],
                      ['Nivel objetivo (y_target)', `${(activeCPResult.y_target??0).toFixed(3)} m  [${getOpLimits(activeCPResult.km).yMin.toFixed(2)} – ${getOpLimits(activeCPResult.km).yMax.toFixed(2)}]`, '#a78bfa'],
                      ['Apertura actual SICA', `${(activeCPResult.apertura_base??gateBase[activeCP]??activeCPResult.h_radial).toFixed(3)} m`, '#38bdf8'],
                      ['Apertura requerida',  `${activeCPResult.apertura_requerida.toFixed(3)} m`, '#fbbf24'],
                      ['Δ Apertura',          `${(activeCPResult.delta_apertura??0) >= 0 ? '+' : ''}${(activeCPResult.delta_apertura??0).toFixed(3)} m  ${(activeCPResult.delta_apertura??0) > 0.03 ? '▲ ABRIR' : (activeCPResult.delta_apertura??0) < -0.03 ? '▼ CERRAR' : 'Sin ajuste'}`, (activeCPResult.delta_apertura??0) > 0.03 ? '#f59e0b' : (activeCPResult.delta_apertura??0) < -0.03 ? '#3b82f6' : '#64748b'],
                    ].map(([k, v, c]) => (
                      <div key={k as string} className="sim-tech-row">
                        <span>{k as string}</span><span style={{ color: c as string }}>{v as string}</span>
                      </div>
                    ))}
                  </div>

                  {/* Bloque 3: Resultado Hidráulico */}
                  <div className="sim-hyd-block">
                    <div className="sim-hyd-block-title">RESULTADO HIDRÁULICO</div>
                    {(() => {
                      // Geometría real del tramo activo para cálculos en panel técnico
                      const tr = findTramo(activeCPResult.km, tramoGeom);
                      const yn = normalDepth(activeCPResult.q_sim ?? 0, tr.pendiente_s0, tr.plantilla_m, tr.talud_z, tr.rugosidad_n);
                      return [
                      ['Plantilla / Talud / n',  `${tr.plantilla_m}m · ${tr.talud_z}:1 · n=${tr.rugosidad_n}`, '#475569'],
                      ['Tirante normal y_n',     `${yn.toFixed(3)} m`, '#38bdf8'],
                      ['Tirante simulado y_sim', `${(activeCPResult.y_sim??0).toFixed(3)} m`, statusColor(activeCPResult.status)],
                      ['Δy  (variación escala)', `${(activeCPResult.delta_y??0) >= 0 ? '+' : ''}${(activeCPResult.delta_y??0).toFixed(4)} m  (${Math.round((activeCPResult.delta_y??0)*100)} cm)`, Math.abs(activeCPResult.delta_y??0)*100 > 5 ? ((activeCPResult.delta_y??0) > 0 ? '#fbbf24' : '#60a5fa') : '#94a3b8'],
                      ['Curva hidráulica',       activeCPResult.remanso_type === 'M1' ? 'M1 — Remanso positivo' : activeCPResult.remanso_type === 'M2' ? 'M2 — Descenso (drawdown)' : 'Normal (sin remanso)', '#a78bfa'],
                      ['Velocidad media V',      `${(activeCPResult.velocity_ms??0).toFixed(3)} m/s`, '#38bdf8'],
                      ['Celeridad de onda c',    `${(activeCPResult.celerity_ms??0).toFixed(3)} m/s`, '#2dd4bf'],
                      ['Número de Froude Fr',    `${(activeCPResult.froude_n??0).toFixed(4)}  ${(activeCPResult.froude_n??0) > 1 ? '⚠ Supercrítico' : 'Subcrítico'}`, (activeCPResult.froude_n??0) > 1 ? '#ef4444' : '#64748b'],
                      ['% Bordo libre',          `${(activeCPResult.bordo_libre_pct??0).toFixed(1)}%`, statusColor(activeCPResult.status)],
                      ['Estado hidráulico',      activeCPResult.status, statusColor(activeCPResult.status)],
                      ['Arribo de onda',         `${activeCPResult.arrival_time}  (T+${Math.round(activeCPResult.cumulative_min??0)} min)`, '#c084fc'],
                      ] as [string, string, string][];
                    })().map(([k, v, c]) => (
                      <div key={k} className="sim-tech-row">
                        <span>{k}</span><span style={{ color: c }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Balance hídrico */}
              <div className="sim-balance-wrap">
                <div className="sim-panel-title"><Droplets size={10} /> Balance Hídrico hasta K{activeCPResult.km}</div>
                {[
                  ['Entrada (Presa)',     `${qDam.toFixed(2)} m³/s`,                                '#38bdf8'],
                  ['Llegada a sección',  `${(activeCPResult.q_sim ?? 0).toFixed(2)} m³/s`,         '#2dd4bf'],
                  ['Pérdida en tramo',   `−${(qDam - (activeCPResult.q_sim ?? 0)).toFixed(2)} m³/s`, '#ef4444'],
                ].map(([k, v, c]) => (
                  <div key={k as string} className="sim-balance-row">
                    <span>{k as string}</span><span style={{ color: c as string }}>{v as string}</span>
                  </div>
                ))}
                <div className="sim-balance-eff">
                  <span>Eficiencia hasta K{activeCPResult.km}</span>
                  <span style={{ color: qDam > 0 ? (((activeCPResult.q_sim ?? 0) / qDam * 100) >= 90 ? '#10b981' : '#f59e0b') : '#64748b' }}>
                    {qDam > 0 ? ((activeCPResult.q_sim ?? 0) / qDam * 100).toFixed(1) : '—'}%
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="sim-no-sel">
              <Waves size={32} style={{ color: '#1e3a5f', marginBottom: 10 }} />
              <div>Selecciona un punto de control</div>
            </div>
          )}

          {/* ── FASE 3: MOTOR DE DECISIÓN ──────────────────────────── */}
          {decisions.length > 0 && (
            <div className="sim-decision-panel">
              <div className="sim-decision-hdr">
                <span className="sim-decision-title">
                  <Zap size={11} /> MOTOR DE DECISIÓN
                </span>
                <div className="sim-decision-badges">
                  {decisions.filter(d => d.prioridad === 'URGENTE').length > 0 && (
                    <span className="sim-dec-badge urgente">
                      {decisions.filter(d => d.prioridad === 'URGENTE').length} URGENTE
                    </span>
                  )}
                  {decisions.filter(d => d.prioridad === 'ALERTA').length > 0 && (
                    <span className="sim-dec-badge alerta">
                      {decisions.filter(d => d.prioridad === 'ALERTA').length} ALERTA
                    </span>
                  )}
                </div>
              </div>

              <div className="sim-decision-list">
                {decisions.map((d, i) => {
                  const isUrgente = d.prioridad === 'URGENTE';
                  const isAlerta  = d.prioridad === 'ALERTA';
                  const color = isUrgente ? '#ef4444' : isAlerta ? '#f59e0b' : '#10b981';
                  const Icon  = isUrgente ? AlertOctagon : isAlerta ? AlertTriangle : CheckCircle;
                  const TipoIcon =
                    d.tipo === 'APERTURA'      ? ArrowUp    :
                    d.tipo === 'CIERRE'        ? ArrowDown  :
                    d.tipo === 'CAUDAL_PRESA'  ? Waves      :
                    d.tipo === 'MONITOREO'     ? Eye        : Zap;
                  return (
                    <div key={i} className={`sim-dec-card ${d.prioridad.toLowerCase()}`}>
                      <div className="sim-dec-card-top">
                        <span className="sim-dec-icon"><Icon size={12} style={{ color }} /></span>
                        <div className="sim-dec-content">
                          <div className="sim-dec-accion" style={{ color }}>{d.accion}</div>
                          <div className="sim-dec-punto">
                            <TipoIcon size={8} /> {d.punto}{d.km > 0 ? ` · KM ${d.km}` : ''}
                          </div>
                        </div>
                      </div>
                      <div className="sim-dec-detalle">{d.detalle}</div>
                      {(d.valor_actual !== d.valor_meta && d.tipo !== 'OPERATIVO') && (
                        <div className="sim-dec-valores">
                          <span className="sim-dec-val-actual">{d.valor_actual}</span>
                          <span className="sim-dec-arrow">→</span>
                          <span className="sim-dec-val-meta" style={{ color }}>{d.valor_meta}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
};

export default ModelingDashboard;
