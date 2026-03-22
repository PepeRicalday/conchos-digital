import React, { useState, useEffect, useMemo } from 'react';
import {
  Waves, Play, Pause, RotateCcw, FileText,
  AlertTriangle, AlertOctagon, CheckCircle,
  Clock, ArrowUp, ArrowDown, TrendingUp, TrendingDown,
  Droplets, Activity, Zap, Eye, EyeOff,
} from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import { supabase } from '../lib/supabase';
import { getTodayString, addDays, formatTime, formatDate } from '../utils/dateHelpers';
import SimulationReport from '../components/SimulationReport';
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
const WAVE_K    = 1.3;

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
  // Apertura requerida para pasar Q_sim al MISMO tirante actual (lógica operativa canal)
  apertura_requerida: number;
  // Extracción real por puntos de entrega en este tramo (de reportes_diarios)
  q_extraido:      number;   // m³/s siendo extraídos en tomas activas de este tramo
  n_tomas_activas: number;   // cantidad de tomas activas en el tramo
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
    y = Math.max(0.05, Math.min(y - (Qc - Q) / dQ, FREEBOARD - 0.1));
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

// ── SECCIÓN TRANSVERSAL SVG ─────────────────────────────────────────────
const CanalSection: React.FC<{ yBase: number; ySim: number }> = ({ yBase, ySim }) => {
  const W = 240, H = 130;
  const CX = W / 2, BY = H - 18;
  const VPM = (H - 32) / FREEBOARD;
  const HPM = (W - 40) / (PLANTILLA + 2 * TALUD_Z * FREEBOARD);

  const bxL = CX - (PLANTILLA / 2) * HPM;
  const bxR = CX + (PLANTILLA / 2) * HPM;
  const fbY  = BY - FREEBOARD * VPM;
  const fbxL = bxL - TALUD_Z * FREEBOARD * HPM;
  const fbxR = bxR + TALUD_Z * FREEBOARD * HPM;

  const sY   = Math.max(0.05, Math.min(ySim,  FREEBOARD));
  const bY   = Math.max(0.05, Math.min(yBase, FREEBOARD));
  const swY  = BY - sY * VPM;
  const swxL = CX - (PLANTILLA / 2 + TALUD_Z * sY) * HPM;
  const swxR = CX + (PLANTILLA / 2 + TALUD_Z * sY) * HPM;
  const bwY  = BY - bY * VPM;
  const bwxL = CX - (PLANTILLA / 2 + TALUD_Z * bY) * HPM;
  const bwxR = CX + (PLANTILLA / 2 + TALUD_Z * bY) * HPM;

  const sc = statusColor(ySim / FREEBOARD > 0.92 ? 'CRITICO' : ySim / FREEBOARD > 0.75 ? 'ALERTA' : 'ESTABLE');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: H }}>
      <rect width={W} height={H} fill="#050e1a" rx="6" />
      {/* Taludes */}
      <polygon points={`${fbxL},${fbY} ${bxL},${BY} ${bxR},${BY} ${fbxR},${fbY}`}
        fill="none" stroke="#334155" strokeWidth="2" />
      {/* Plantilla */}
      <rect x={bxL} y={BY} width={bxR - bxL} height={5} fill="#1e293b" />
      {/* Agua simulada */}
      <polygon points={`${swxL},${swY} ${swxR},${swY} ${bxR},${BY} ${bxL},${BY}`}
        fill="rgba(14,165,233,0.28)" />
      {/* Superficie simulada */}
      <line x1={swxL} y1={swY} x2={swxR} y2={swY} stroke={sc} strokeWidth="2.5" />
      {/* Nivel base (punteado) */}
      <line x1={bwxL} y1={bwY} x2={bwxR} y2={bwY} stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="5,3" opacity="0.6" />
      {/* Bordo libre */}
      <line x1={fbxL} y1={fbY} x2={fbxR} y2={fbY} stroke="#ef4444" strokeWidth="1" strokeDasharray="6,4" opacity="0.55" />
      {/* Etiquetas */}
      <text x={swxR + 3} y={swY + 4} fill={sc} fontSize="9" fontFamily="monospace">{ySim.toFixed(2)}m</text>
      <text x={bwxR + 3} y={bwY + 4} fill="#38bdf8" fontSize="8" fontFamily="monospace">{yBase.toFixed(2)}m</text>
      <text x={4} y={fbY + 9} fill="#ef4444" fontSize="8" fontFamily="monospace">BL {FREEBOARD}m</text>
      <text x={CX} y={H - 4} fill="#475569" fontSize="8" fontFamily="monospace" textAnchor="middle">
        Plantilla {PLANTILLA}m · Talud {TALUD_Z}:1
      </text>
    </svg>
  );
};

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
    damBaseValue: 62.4, damCurrentValue: 62.4,
    damNivel: '—', damFuente: 'estimado',
    totalExtractionM3s: 0,
  });

  const [qDam,         setQDam]         = useState(62.4);
  const [qBase,        setQBase]        = useState(62.4);
  const [riverTransit, setRiverTransit] = useState(false);
  const [eventType,    setEventType]    = useState<EventType>('INCREMENTO');

  const [timeDelta,   setTimeDelta]  = useState(0);
  const [isPlaying,   setIsPlaying]  = useState(false);
  const [simBaseMin]                 = useState(new Date().getHours() * 60 + new Date().getMinutes());

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

      // 2. Todas las fuentes en paralelo — 8 queries simultáneas
      const [
        { data: summary },
        { data: rawAM },        // turno AM de hoy = estado base del canal
        { data: rawLatest },    // lecturas más recientes = estado actual
        { data: firstMovPresa },// PRIMER movimiento de presa del día → qBase
        { data: lastMovPresa }, // ÚLTIMO movimiento de presa del día → qDam inicial
        { data: lecturaHoy },   // lecturas_presas hoy (respaldo)
        { data: rawReportes },  // reportes_diarios hoy → volúmenes puntos de entrega
        { data: rawPuntos },    // puntos_entrega → km de cada toma/lateral
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

        // ÚLTIMO movimiento de presa hoy = Q actual (punto de partida del slider)
        supabase.from('movimientos_presas')
          .select('gasto_m3s, fecha_hora, fuente_dato')
          .gte('fecha_hora', `${today}T00:00:00`)
          .lt('fecha_hora',  `${tomorrow}T00:00:00`)
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
      setBaseReadings(rm);
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
      const totalExtractionM3s = deliveries
        .filter(d => d.is_active)
        .reduce((s, d) => s + d.caudal_m3s, 0);

      // 8. ── GASTO PRESA — safeFloat + validación isFinite ─────────────
      const ts = formatTime(new Date());
      let qBaseVal = 62.4, qDamVal = 62.4;
      let damNivel = '—', damFuente = 'estimado';
      let damLive  = false;

      if (firstMovPresa?.gasto_m3s != null) {
        const base = safeFloat(firstMovPresa.gasto_m3s, 0);
        const curr = safeFloat(lastMovPresa?.gasto_m3s,  base);
        if (base > 0) {
          qBaseVal  = base;
          qDamVal   = curr > 0 ? curr : base;
          damFuente = 'movimientos_presas';
          damLive   = true;
          damNivel  = firstMovPresa.fecha_hora
            ? formatTime(firstMovPresa.fecha_hora)
            : '—';
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
      if (!damLive) {
        const q0 = safeFloat(summary?.find(r => r.escala_id === cps[0]?.id)?.gasto_calculado_m3s, 0);
        if (q0 > 0) { qBaseVal = q0; qDamVal = q0; }
        damFuente = 'estimado';
      }

      setQBase(qBaseVal);
      setQDam(qDamVal);
      setDataStatus({
        dam: damLive, gates: hasGates, levels: hasLevels, deliveries: hasDeliveries,
        timestamp: ts,
        damBaseValue:    qBaseVal,
        damCurrentValue: qDamVal,
        damNivel, damFuente,
        totalExtractionM3s,
      });
    };
    fetchData();
  }, []);

  // ── TIMELINE PLAYER ──────────────────────────────────────────────────
  useEffect(() => {
    let t: ReturnType<typeof setInterval>;
    if (isPlaying) {
      t = setInterval(() => setTimeDelta(p => p >= 480 ? 0 : p + 2), 80);
    }
    return () => clearInterval(t);
  }, [isPlaying]);

  // ── MOTOR HIDRÁULICO ─────────────────────────────────────────────────
  const simResults = useMemo<CPResult[]>(() => {
    if (!controlPoints.length) return [];
    let qCur = qDam, cumMin = 0;

    if (riverTransit) {
      const vRio = 0.5 * Math.pow(Math.max(qDam, 1), 0.4) + 0.5;
      cumMin += (RIVER_KM * 1000 / vRio) / 60;
    }

    return controlPoints.map((cp, idx) => {
      // ── safeFloat en todos los campos del CP — blindaje total contra NaN ──
      // Si cp.km llega null de Supabase: null - number = NaN → dist = NaN → todo se rompe
      const kmCp   = safeFloat(cp.km, idx * 17);   // fallback: espaciado uniforme estimado
      const kmPrev = idx === 0 ? 0 : safeFloat(controlPoints[idx - 1].km, (idx - 1) * 17);
      const dist   = Math.max(1, idx === 0 ? kmCp : kmCp - kmPrev);

      // y_base: nivel actual medido. || en vez de ?? para que 0 también use el fallback
      const y_base = (baseReadings[cp.id] && baseReadings[cp.id] > 0.05)
        ? baseReadings[cp.id]
        : Math.max(0.3, 2.2 - idx * 0.04);

      const y_n = normalDepth(qCur);
      const c   = waveCelerity(y_n) * WAVE_K;
      const A_n = (PLANTILLA + TALUD_Z * y_n) * y_n;
      const v_n = A_n > 0 ? qCur / A_n : 0;
      const Fr  = v_n / Math.max(0.001, Math.sqrt(G * Math.max(0.01, y_n)));

      // ── Geometría de compuerta — safeFloat en campos que pueden venir null de BD ──
      const cd_used  = safeFloat(cp.coeficiente_descarga, CD_GATE) || CD_GATE;
      const pzas     = Math.max(1, safeFloat(cp.pzas_radiales, 1));
      const ancho    = Math.max(1, safeFloat(cp.ancho, 8));
      // apertura: usa override del slider (>0), o SICA Capture (gateOverrides), o default
      const h_gate   = (safeFloat(gateOverrides[cp.id], 0) > 0)
        ? safeFloat(gateOverrides[cp.id], 1.25)
        : Math.max(0.3, pzas > 0 ? 1.25 : 1.0);
      const area_gate = Math.max(0.01, ancho * pzas * h_gate);

      // ── Fórmula de orificio: H = Q² / (Cd² · A² · 2g) ──────────────────
      // Δy = ΔH → variación en tirante aguas arriba de la compuerta (backwater)
      const head_base  = Math.pow(Math.max(qBase, 0.1) / (cd_used * area_gate), 2) / (2 * G);
      const head_sim   = Math.pow(Math.max(qCur, 0.1)  / (cd_used * area_gate), 2) / (2 * G);
      const head_delta = head_sim - head_base;
      const y_sim      = Math.max(0.1, Math.min(y_base + head_delta, FREEBOARD - 0.08));

      // ── Apertura REQUERIDA para pasar Q_sim al MISMO tirante actual ────────
      // Principio operativo del canal: el operador ABRE la compuerta en vez de dejar subir la escala.
      // Inv. fórmula orificio: Q = Cd · (ancho · pzas · h_ap) · √(2g·h)
      //   → h_ap = Q / (Cd · ancho · pzas · √(2g·y_base))
      const sqrtHead         = Math.sqrt(2 * G * Math.max(0.01, y_base));
      const apertura_requerida = qCur / Math.max(0.001, cd_used * ancho * pzas * sqrtHead);

      const delta_y      = y_sim - y_base;
      const remanso_type: RemansoType = delta_y > 0.08 ? 'M1' : delta_y < -0.08 ? 'M2' : 'NORMAL';
      const pct          = y_sim / FREEBOARD;
      const status: CPStatus = pct > 0.92 ? 'CRITICO' : pct > 0.75 ? 'ALERTA' : 'ESTABLE';

      const travelSpd   = Math.max(0.5, v_n + c);
      const transit_min = (dist * 1000) / travelSpd / 60;
      cumMin += transit_min;

      // ── Extracción por puntos de entrega activos en este tramo ──────────
      // Cuando hay datos reales de reportes_diarios, el motor usa:
      //   k_conduccion = 0.00012/km (infiltración pura) + extracción real medida
      // Sin datos reales: k = 0.00038/km (estimado total, incluye distribución típica)
      const hasDelivData = deliveryPoints.length > 0;
      const conductionK  = hasDelivData ? 0.00012 : 0.00038;
      const conductionFloor = hasDelivData ? 0.97 : 0.85;
      const conductionFactor = Math.max(conductionFloor, 1 - dist * conductionK);

      // Tomas activas en el tramo (km_previo < km_toma ≤ km_actual)
      const tomasEnTramo = deliveryPoints.filter(
        dp => dp.is_active && dp.caudal_m3s > 0 && dp.km > kmPrev && dp.km <= kmCp,
      );
      const q_extraido     = tomasEnTramo.reduce((s, dp) => s + safeFloat(dp.caudal_m3s, 0), 0);
      const n_tomas_activas = tomasEnTramo.length;

      qCur = Math.max(0.1, qCur * conductionFactor - q_extraido);

      return {
        id: cp.id, nombre: cp.nombre, km: kmCp,
        y_base, q_base: qBase, y_sim, q_sim: qCur,
        delta_y, remanso_type, status,
        transit_min, cumulative_min: cumMin,
        arrival_time: fmtTime(simBaseMin, cumMin),
        celerity_ms: c, velocity_ms: v_n, froude_n: Fr,
        bordo_libre_pct: pct * 100, h_radial: h_gate,
        head_base, head_sim, head_delta, cd_used, area_gate,
        apertura_requerida,
        q_extraido, n_tomas_activas,
      };
    });
  }, [controlPoints, baseReadings, gateOverrides, qDam, qBase, riverTransit, simBaseMin, deliveryPoints]);

  // ── CUADRO DE MANIOBRA: Barras de Escala + Diagrama Espacio-Tiempo ────
  const opsChartOption = useMemo(() => {
    if (!simResults.length) return {};

    // ── Datos gráfico superior (barras) ──────────────────────────────
    const shortName = (n: string) => n.replace(/^(K-\d+)\s+/, '$1\n');
    const names  = simResults.map(r => shortName(r.nombre));
    const yBase  = simResults.map(r => +(r.y_base ?? 0).toFixed(2));
    const ySim   = simResults.map(r => +(r.y_sim  ?? 0).toFixed(2));
    const deltas = simResults.map(r => r.delta_y ?? 0);
    const colors = simResults.map(r => statusColor(r.status));

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

    // ── Tooltip ─────────────────────────────────────────────────────
    const fmtTooltip = (params: any[]) => {
      if (!params?.length) return '';
      const p0 = params[0];
      // Grid superior: barras por índice de categoría
      if (['Nivel Actual', 'Nivel Simulado'].includes(p0.seriesName)) {
        const i = p0.dataIndex as number;
        const r = simResults[i];
        if (!r) return '';
        const dCm = Math.round((r.delta_y ?? 0) * 100);
        const sign = dCm >= 0 ? '+' : '';
        const movTxt = dCm > 2 ? '▲ INCREMENTO' : dCm < -2 ? '▼ DECREMENTO' : '● SIN CAMBIO';
        const movClr = dCm > 2 ? '#fbbf24' : dCm < -2 ? '#60a5fa' : '#94a3b8';
        return `<div style="font-family:monospace;font-size:11px;line-height:1.9;min-width:185px">
          <div style="color:#94a3b8;font-size:9px;border-bottom:1px solid #1e3a5f;padding-bottom:3px;margin-bottom:5px;letter-spacing:0.05em">${r.nombre}</div>
          <div>Escala actual &nbsp;&nbsp;<b style="color:#38bdf8">${(r.y_base??0).toFixed(2)} m</b></div>
          <div>Escala simulada <b style="color:${statusColor(r.status)}">${(r.y_sim??0).toFixed(2)} m</b></div>
          <div>Variación &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<b style="color:${movClr}">${sign}${dCm} cm &nbsp;${movTxt}</b></div>
          <div style="margin-top:3px;padding-top:3px;border-top:1px solid #1e3a5f">Arribo: <b style="color:#c084fc">${r.arrival_time} &nbsp;(T+${Math.round(r.cumulative_min??0)} min)</b></div>
        </div>`;
      }
      return '';
    };

    return {
      animation: false,  // Sin animación → sin parpadeo al mover el slider
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(4,11,22,0.97)',
        borderColor: '#1e3a5f', borderWidth: 1,
        textStyle: { color: '#e2e8f0', fontSize: 11 },
        formatter: fmtTooltip,
      },
      grid: [
        { top: 36, height: '40%', left: 68, right: 18 },
        { top: '56%', bottom: 50, left: 68, right: 18 },
      ],
      xAxis: [
        // Grid 0 — puntos de control (categorías)
        {
          gridIndex: 0, type: 'category', data: names,
          axisLabel: { color: '#64748b', fontSize: 8, interval: 0, lineHeight: 13 },
          axisLine: { lineStyle: { color: '#1e3a5f' } },
          axisTick: { alignWithLabel: true, lineStyle: { color: '#1e3a5f' } },
          splitLine: { show: false },
        },
        // Grid 1 — tiempo en horas
        {
          gridIndex: 1, type: 'value', min: 0, max: maxHr,
          name: 'Tiempo desde el evento (horas)', nameLocation: 'middle', nameGap: 30,
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
        // Grid 0 — tirante en metros
        {
          gridIndex: 0, type: 'value', name: 'Tirante (m)', min: 0, max: 3.8,
          nameTextStyle: { color: '#334155', fontSize: 8, padding: [0, 0, 0, -22] },
          axisLabel: { color: '#64748b', fontSize: 8, formatter: '{value}m' },
          splitLine: { lineStyle: { color: '#080f1c', type: 'dashed' } },
          axisLine: { lineStyle: { color: '#1e3a5f' } },
        },
        // Grid 1 — kilómetro del canal, K-0 en la parte superior
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
        // ── GRID 0: Barras de escala ─────────────────────────────────

        // Barra — Nivel Actual
        {
          name: 'Nivel Actual', type: 'bar', xAxisIndex: 0, yAxisIndex: 0,
          data: yBase, barMaxWidth: 22, z: 3,
          itemStyle: {
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(56,189,248,0.65)' },
                { offset: 1, color: 'rgba(56,189,248,0.10)' },
              ],
            },
            borderColor: '#38bdf8', borderWidth: 1, borderRadius: [3, 3, 0, 0],
          },
          label: {
            show: true, position: 'top', fontSize: 8, color: '#64748b',
            formatter: (p: any) => `${p.value}m`,
          },
        },

        // Barra — Nivel Simulado (con colores por estatus)
        {
          name: 'Nivel Simulado', type: 'bar', xAxisIndex: 0, yAxisIndex: 0,
          data: ySim.map((v, i) => ({
            value: v,
            itemStyle: {
              color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: colors[i] },
                  { offset: 1, color: colors[i].replace(')', ',0.12)').replace('rgb', 'rgba') },
                ],
              },
              borderColor: colors[i], borderWidth: 1.5, borderRadius: [3, 3, 0, 0],
            },
          })),
          barMaxWidth: 22, barGap: '10%', z: 4,
          label: {
            show: true, position: 'top', fontSize: 8, fontWeight: 'bold',
            formatter: (p: any) => {
              const d = deltas[p.dataIndex] ?? 0;
              const cm = Math.round(d * 100);
              if (Math.abs(cm) < 2) return `${p.value}m`;
              return `${p.value}m\n${cm > 0 ? '▲' : '▼'}${Math.abs(cm)}cm`;
            },
            color: (p: any) => colors[p.dataIndex] ?? '#2dd4bf',
          },
          markLine: {
            silent: true, symbol: 'none', z: 10,
            data: [
              { yAxis: FREEBOARD * 0.75,
                lineStyle: { color: '#d97706', width: 1, type: 'dashed', opacity: 0.6 },
                label: { formatter: '⚠ ALERTA 75%', color: '#d97706', fontSize: 7, position: 'insideEndTop' } },
              { yAxis: FREEBOARD * 0.92,
                lineStyle: { color: '#dc2626', width: 1, type: 'dashed', opacity: 0.6 },
                label: { formatter: '🔴 CRÍTICO 92%', color: '#dc2626', fontSize: 7, position: 'insideEndTop' } },
              { yAxis: FREEBOARD,
                lineStyle: { color: '#374151', width: 1, type: 'dotted', opacity: 0.5 },
                label: { formatter: 'BORDO LIBRE', color: '#4b5563', fontSize: 7, position: 'insideEndTop' } },
            ],
          },
        },

        // ── GRID 1: Diagrama Espacio-Tiempo ──────────────────────────

        // Línea de trayectoria PREVISTA (segmento pendiente, tenue)
        {
          name: 'Trayectoria Prevista', type: 'line',
          xAxisIndex: 1, yAxisIndex: 1,
          data: wavePath,
          smooth: false, z: 3, showSymbol: false,
          lineStyle: { color: 'rgba(56,189,248,0.18)', width: 1.5, type: 'dashed' },
        },

        // Línea de trayectoria COMPLETADA (segmento recorrido, brillante)
        {
          name: 'Recorrido Completado', type: 'line',
          xAxisIndex: 1, yAxisIndex: 1,
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
          name: 'Puntos de Control', type: 'scatter',
          xAxisIndex: 1, yAxisIndex: 1,
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
          xAxisIndex: 1, yAxisIndex: 1,
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
  }, [simResults, timeDelta]);

  // ── GLOBALS ──────────────────────────────────────────────────────────
  const firstCP      = simResults[0];
  const lastCP       = simResults[simResults.length - 1];
  const globalEff    = qDam > 0 && lastCP ? ((lastCP.q_sim ?? 0) / qDam) * 100 : 0;
  const systemStatus: CPStatus = simResults.some(r => r.status === 'CRITICO')
    ? 'CRITICO' : simResults.some(r => r.status === 'ALERTA') ? 'ALERTA' : 'ESTABLE';
  const riverLagMin  = riverTransit
    ? (RIVER_KM * 1000 / (0.5 * Math.pow(Math.max(qDam, 1), 0.4) + 0.5)) / 60 : 0;
  const activeCPResult = simResults.find(r => r.id === activeCP);
  const activeCPData   = controlPoints.find(c => c.id === activeCP);

  const StatusIcon = ({ s }: { s: CPStatus }) =>
    s === 'CRITICO' ? <AlertOctagon size={14} /> :
    s === 'ALERTA'  ? <AlertTriangle size={14} /> :
    <CheckCircle size={14} />;

  // ── RENDER ───────────────────────────────────────────────────────────
  return (
    <div className="sim-root">

      {showReport && (
        <SimulationReport
          scenario={{
            q_base:          qBase,
            q_sim:           qDam,
            isRiver:         riverTransit,
            startTime:       fmtTime(simBaseMin, 0),
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
          <button className="sim-report-btn" onClick={() => setShowReport(true)} disabled={simResults.length === 0}>
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
                {simpleMode ? 'Escalas y Llegada del Agua · Puntos de Control' : 'Cuadro de Maniobra · Escala y Tránsito de Onda'}
              </span>
              <div className="sim-profile-legend">
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: '#38bdf8' }} /> Nivel Actual</span>
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: '#2dd4bf' }} /> Simulado</span>
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: '#fbbf24', borderRadius: '50%' }} /> Frente de Onda</span>
                {simResults.some(r => r.remanso_type === 'M1') && <span className="sim-leg-tag tag-m1">▲ Incremento</span>}
                {simResults.some(r => r.remanso_type === 'M2') && <span className="sim-leg-tag tag-m2">▼ Decremento</span>}
              </div>
            </div>
            <div className="sim-chart-wrap">
              <ReactECharts option={opsChartOption} style={{ height: '100%', width: '100%' }} notMerge={true} />
            </div>
          </div>

          {/* Timeline de tránsito */}
          <div className="sim-timeline-card">
            <div className="sim-tl-header">
              <div className="sim-player">
                <button className={`sim-play-btn ${isPlaying ? 'playing' : ''}`} onClick={() => setIsPlaying(!isPlaying)}>
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
                <CanalSection yBase={activeCPResult.y_base} ySim={activeCPResult.y_sim} />
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
                      ['Apertura actual SICA', gateBase[activeCP] != null ? `${gateBase[activeCP].toFixed(3)} m` : `${activeCPResult.h_radial.toFixed(3)} m`, '#38bdf8'],
                      ['Apertura requerida',  `${Math.min(3.0, Math.max(0.1, activeCPResult.apertura_requerida)).toFixed(3)} m  ${activeCPResult.apertura_requerida > (gateBase[activeCP] ?? activeCPResult.h_radial) ? '▲ ABRIR' : '▼ CERRAR'}`, '#fbbf24'],
                    ].map(([k, v, c]) => (
                      <div key={k as string} className="sim-tech-row">
                        <span>{k as string}</span><span style={{ color: c as string }}>{v as string}</span>
                      </div>
                    ))}
                  </div>

                  {/* Bloque 3: Resultado Hidráulico */}
                  <div className="sim-hyd-block">
                    <div className="sim-hyd-block-title">RESULTADO HIDRÁULICO</div>
                    {[
                      ['Tirante normal y_n',    `${(normalDepth(activeCPResult.q_sim??0)??0).toFixed(3)} m`, '#38bdf8'],
                      ['Tirante simulado y_sim', `${(activeCPResult.y_sim??0).toFixed(3)} m`, statusColor(activeCPResult.status)],
                      ['Δy  (variación escala)', `${(activeCPResult.delta_y??0) >= 0 ? '+' : ''}${(activeCPResult.delta_y??0).toFixed(4)} m  (${Math.round((activeCPResult.delta_y??0)*100)} cm)`, Math.abs(activeCPResult.delta_y??0)*100 > 5 ? ((activeCPResult.delta_y??0) > 0 ? '#fbbf24' : '#60a5fa') : '#94a3b8'],
                      ['Curva hidráulica',       activeCPResult.remanso_type === 'M1' ? 'M1 — Remanso positivo' : activeCPResult.remanso_type === 'M2' ? 'M2 — Descenso (drawdown)' : 'Normal (sin remanso)', '#a78bfa'],
                      ['Velocidad media V',      `${(activeCPResult.velocity_ms??0).toFixed(3)} m/s`, '#38bdf8'],
                      ['Celeridad de onda c',    `${(activeCPResult.celerity_ms??0).toFixed(3)} m/s`, '#2dd4bf'],
                      ['Número de Froude Fr',    `${(activeCPResult.froude_n??0).toFixed(4)}  ${(activeCPResult.froude_n??0) > 1 ? '⚠ Supercrítico' : 'Subcrítico'}`, (activeCPResult.froude_n??0) > 1 ? '#ef4444' : '#64748b'],
                      ['% Bordo libre',          `${(activeCPResult.bordo_libre_pct??0).toFixed(1)}%`, statusColor(activeCPResult.status)],
                      ['Estado hidráulico',      activeCPResult.status, statusColor(activeCPResult.status)],
                      ['Arribo de onda',         `${activeCPResult.arrival_time}  (T+${Math.round(activeCPResult.cumulative_min??0)} min)`, '#c084fc'],
                    ].map(([k, v, c]) => (
                      <div key={k as string} className="sim-tech-row">
                        <span>{k as string}</span><span style={{ color: c as string }}>{v as string}</span>
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
        </aside>
      </main>
    </div>
  );
};

export default ModelingDashboard;
