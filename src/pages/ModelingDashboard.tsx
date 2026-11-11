
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Waves, Play, Pause, RotateCcw, FileText, AlertTriangle, AlertOctagon, CheckCircle, Clock, ArrowUp, ArrowDown, TrendingUp, TrendingDown, Droplets, Activity, Zap, Eye, EyeOff } from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import { supabase } from '../lib/supabase';
import { useRol } from '../lib/auth/roles';
import { formatDate } from '../utils/dateHelpers';
import SimulationReport from '../components/SimulationReport';
import { calcIEC } from '../utils/canalIndex';
import { useModelingTelemetry } from '../hooks/useModelingTelemetry';
import { useHydricEvents } from '../hooks/useHydricEvents';
import { PLANTILLA, FREEBOARD, CD_GATE, safeFloat } from '../utils/modelingTypes';
import './ModelingDashboard.css';
import type { RestriccionOverrideMap, EventType, RestriccionNivelTramo, CPResult, CPStatus, TipoLimite, EstadoVista } from '../utils/modelacion/hidraulicaCanal';
import { RESTRICCIONES_NIVEL, findTramo, criticalDepth, statusColor, RIVER_KM, fmtTime, estadoVistaCP, colorEstadoVista, TXT_ESTADO, deltaLabel, transitLabel, G, findRestriccion, getOpLimits, normalDepth } from '../utils/modelacion/hidraulicaCanal';
import { runSimulation } from '../utils/modelacion/simulacion';
import type { ModoOperativo, Decision, DecisionTipo } from '../utils/modelacion/decisiones';
import { Q_MIN_ENTRADA_M3S, generateDecisions, decisionModoOperativo, edadLectura } from '../utils/modelacion/decisiones';
import { CanalSection } from '../components/modelacion/CanalSection';
import { Kpi, DataTable } from '../components/ui/base';


































































// ── COMPONENTE PRINCIPAL ────────────────────────────────────────────────
const ModelingDashboard: React.FC = () => {
  const { puedeEscribir } = useRol();
  const [gateOverrides, setGateOverrides] = useState<Record<string, number>>({});
  // Aperturas REALES de SICA Capture (lectura original, no modificada)
  const [gateBase,      setGateBase]      = useState<Record<string, number>>({});

  // ── RESTRICCIONES DE NIVEL: overrides temporales por simulación ─────────
  const [restriccionOverrides, setRestriccionOverrides] = useState<Record<string, RestriccionOverrideMap>>({});
  const [showNivelPanel, setShowNivelPanel]             = useState(false);

  const [qDam,         setQDam]         = useState(0);
  const [qBase,        setQBase]        = useState(0);
  const [riverTransit, setRiverTransit] = useState(false);
  const [eventType,    setEventType]    = useState<EventType>('INCREMENTO');

  const [timeDelta,   setTimeDelta]  = useState(0);
  const [isPlaying,   setIsPlaying]  = useState(false);
  // T₀ = hora del ÚLTIMO movimiento de presa (no hora de apertura de la pantalla)
  const [simBaseMin,  setSimBaseMin] = useState(new Date().getHours() * 60 + new Date().getMinutes());
  // Override manual de hora inicio de simulación (null = automático desde último movimiento de presa)
  const [simStartOverride, setSimStartOverride] = useState<number | null>(null);
  // Hora actual del sistema en minutos — se actualiza cada minuto para propagación de onda
  const [currentTimeMin, setCurrentTimeMin] = useState(new Date().getHours() * 60 + new Date().getMinutes());

  const [activeCP,    setActiveCP]   = useState('');
  // Orden de la lista de puntos de control: por km (recorrido del canal, K-0 → K-104) o por severidad.
  const [ordenCP, setOrdenCP] = useState<'km' | 'severidad'>('km');
  const cpCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [showReport,  setShowReport] = useState(false);
  const [simpleMode,  setSimpleMode] = useState(true);

  // Badge de estado (header) → Motor de Decisión: al hacer clic, desplaza y
  // resalta brevemente el panel para que el operador no tenga que buscarlo.
  const decisionPanelRef = useRef<HTMLDivElement>(null);
  const perfilChartRef = useRef<ReactECharts>(null);
  const [decisionPanelPulse, setDecisionPanelPulse] = useState(false);
  const focusDecisionPanel = () => {
    decisionPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setDecisionPanelPulse(true);
    setTimeout(() => setDecisionPanelPulse(false), 1600);
  };

  // ── FETCH — Telemetría real: primer mov. del día como base hidráulica ──
  // Extraído a useModelingTelemetry — gateOverrides/gateBase/qDam/qBase/
  // activeCP/simBaseMin siguen siendo estado de este componente porque el
  // usuario los edita interactivamente (sliders, click en punto de control);
  // el hook solo los inicializa vía los setters que recibe.
  const {
    controlPoints, baseReadings, cpTelemetry, deliveryPoints,
    dataStatus, dataLoaded, tramoGeom, perfilRpc, balanceTramos,
  } = useModelingTelemetry({
    setGateBase, setGateOverrides, setQBase, setQDam, setSimBaseMin, setActiveCP,
  });

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

  // ── RESTRICCIONES ACTIVAS: defaults + overrides temporales de sesión ────
  const activeRestricciones = useMemo<RestriccionNivelTramo[]>(() =>
    RESTRICCIONES_NIVEL.map(r => ({ ...r, ...(restriccionOverrides[r.tramo_id] ?? {}) })),
  [restriccionOverrides]);

  // Hora efectiva de inicio de simulación: manual (operador) > automático (último movimiento presa)
  const simBaseMinEff = simStartOverride ?? simBaseMin;

  const simResults = useMemo<CPResult[]>(() => {
    if (!controlPoints.length || !dataLoaded) return [];
    return runSimulation(controlPoints, qDam, qBase, baseReadings, gateOverrides,
      gastoMedidoRecord, deliveryPoints, tramoGeom, riverTransit, simBaseMinEff, currentTimeMin, balanceTramos, activeRestricciones);
  }, [controlPoints, baseReadings, gateOverrides, gastoMedidoRecord, qDam, qBase, riverTransit, simBaseMinEff, currentTimeMin, deliveryPoints, dataLoaded, tramoGeom, balanceTramos, activeRestricciones]);

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
      gastoMedidoRecord, modDeliveries, tramoGeom, riverTransit, simBaseMinEff, currentTimeMin, balanceTramos, activeRestricciones);
  }, [showScenarioB, controlPoints, baseReadings, gateOverrides, gastoMedidoRecord, qDamB, qBase, riverTransit, simBaseMinEff, currentTimeMin, deliveryPoints, scenarioMods, dataLoaded, tramoGeom, balanceTramos, activeRestricciones]);

  // ── FASE 3: MOTOR DE DECISIÓN ─────────────────────────────────────────
  // Al activar un punto desde la tabla o el track del centro, la tarjeta puede quedar fuera de vista en la
  // columna izquierda: se desplaza solo esa columna (nunca la página).
  useEffect(() => {
    const el = cpCardRefs.current[activeCP];
    const left = el?.closest('.sim-left') as HTMLElement | null;
    if (!el || !left || left.scrollHeight <= left.clientHeight + 1) return;
    const head = (left.querySelector('.sim-cp-head') as HTMLElement | null)?.offsetHeight ?? 0;
    const lr = left.getBoundingClientRect(), er = el.getBoundingClientRect();
    if (er.top < lr.top + head) left.scrollTo({ top: left.scrollTop + er.top - lr.top - head - 6, behavior: 'smooth' });
    else if (er.bottom > lr.bottom) left.scrollTo({ top: left.scrollTop + er.bottom - lr.bottom + 6, behavior: 'smooth' });
  }, [activeCP]);

  // Modo operativo: las reglas del motor (abrir compuertas, mínimos deseables de servicio) solo
  // tienen sentido con el canal sirviendo riego. En VACIADO (presa cerrada, remanente) o sin
  // entrada de agua recomendarían acciones contrarias a la operación y generarían alertas falsas.
  const { activeEvent } = useHydricEvents();
  const modoOperativo: ModoOperativo =
    activeEvent?.evento_tipo === 'VACIADO' ? 'VACIADO'
    : activeEvent?.evento_tipo === 'LLENADO' ? 'LLENADO'
    : qDam < Q_MIN_ENTRADA_M3S ? 'SIN_ENTRADA'
    : 'RIEGO';
  const reglasRiegoSuspendidas = modoOperativo === 'VACIADO' || modoOperativo === 'SIN_ENTRADA';

  const decisions = useMemo<Decision[]>(() => {
    if (!simResults.length) return [];
    const todas = generateDecisions(simResults, qDam, qBase, gateBase, cpTelemetry, dataStatus, eventType, deliveryPoints);
    if (!reglasRiegoSuspendidas) return todas;
    return [decisionModoOperativo(modoOperativo, qDam), ...todas.filter(d => d.prioridad === 'INFO')];
  }, [simResults, qDam, qBase, gateBase, cpTelemetry, dataStatus, eventType, deliveryPoints, modoOperativo, reglasRiegoSuspendidas]);

  // ── FASE 3B: Persistir decisiones URGENTE → registro_alertas ──────────
  // Deduplicación por sesión: evita insertar la misma alerta en cada
  // re-render. La clave es `punto|accion` — se limpia cuando no hay URGENTEs.
  const _alertasPersitidasRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!puedeEscribir) return; // INVITADO/AUDITORIA no persisten alertas
    const urgentes = decisions.filter(d => d.prioridad === 'URGENTE');
    if (urgentes.length === 0) {
      // Sin URGENTEs activos → resetear el set para la próxima activación
      _alertasPersitidasRef.current.clear();
      return;
    }
    const nuevas = urgentes.filter(d => {
      const key = `${d.punto}|${d.accion}`;
      return !_alertasPersitidasRef.current.has(key);
    });
    if (nuevas.length === 0) return;

    const TIPO_MAP: Record<DecisionTipo, string> = {
      APERTURA:      'Operación',
      CIERRE:        'Operación',
      CAUDAL_PRESA:  'Presa',
      MONITOREO:     'Monitoreo',
      OPERATIVO:     'Operativo',
    };

    const rows = nuevas.map(d => ({
      tipo_riesgo:    'critical' as const,
      categoria:      TIPO_MAP[d.tipo] ?? 'Modelación',
      titulo:         `[URGENTE] ${d.accion}`,
      mensaje:        d.detalle,
      fecha_deteccion: new Date().toISOString(),
      resuelta:       false,
      coordenadas:    null,
      origen_id:      `modeling_${d.punto.replace(/\s+/g, '_')}_${d.tipo}`,
    }));

    supabase.from('registro_alertas').insert(rows).then(({ error }) => {
      if (!error) {
        nuevas.forEach(d => _alertasPersitidasRef.current.add(`${d.punto}|${d.accion}`));
      }
    });
  }, [decisions, puedeEscribir]);

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
      SIN_LECTURA:           '#8FA7C8',   // gris
      SIN_DATOS:             '#8FA7C8',
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
        const estadoClr   = estadoColorMap[estadoLabel] ?? '#8FA7C8';
        return `<div style="font-family:monospace;font-size:11px;line-height:1.9;min-width:200px">
          <div style="color:#94a3b8;font-size:9px;border-bottom:1px solid #1e3a5f;padding-bottom:3px;margin-bottom:5px">${r.nombre} · KM ${r.km}</div>
          <div>Nivel real SQL&nbsp;&nbsp;<b style="color:#f59e0b">${rpcRow && Number.isFinite(rpcRow.nivel) ? rpcRow.nivel.toFixed(2)+' m' : '—'}</b>&nbsp;<span style="color:${estadoClr};font-size:9px">${estadoLabel}</span></div>
          <div>Tirante actual &nbsp;&nbsp;<b style="color:#3FB2F3">${(r.y_base??0).toFixed(2)} m</b></div>
          <div>Tirante simulado<b style="color:${statusColor(r.status)}">&nbsp;${(r.y_sim??0).toFixed(2)} m</b></div>
          <div>Tirante crítico &nbsp;<b style="color:rgba(251,146,60,0.9)">${criticalDepth(r.q_sim, findTramo(r.km, tramoGeom).plantilla_m, findTramo(r.km, tramoGeom).talud_z).toFixed(2)} m</b>&nbsp;<span style="color:#8396ad;font-size:9px">(Fr=1)</span></div>
          <div>Variación &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<b style="color:${movClr}">${sign}${dCm} cm</b></div>
          <div>Q llegada &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<b style="color:#a78bfa">${(r.q_sim??0).toFixed(1)} m³/s</b></div>
          ${r.n_tomas_activas > 0 ? `<div style="color:#8396ad;font-size:9px">−${r.q_extraido.toFixed(2)} m³/s · ${r.n_tomas_activas} tomas activas</div>` : ''}
          <div style="margin-top:3px;padding-top:3px;border-top:1px solid #1e3a5f">Arribo: <b style="color:#c084fc">${r.arrival_time} &nbsp;(T+${Math.round(r.cumulative_min??0)} min)</b></div>
        </div>`;
      }
      return '';
    };

    // Tirante máximo dinámico (bordo libre del primer tramo u 4m mínimo)
    const yMax = Math.max(4, ...bordoData) * 1.05;
    const qMax = Math.max(1, ...qSimData) * 1.2;

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
          nameTextStyle: { color: '#8396ad', fontSize: 10 },
          axisLabel: { color: '#8396ad', fontSize: 10, formatter: 'K{value}' },
          axisLine: { lineStyle: { color: '#1e3a5f' } },
          axisTick: { lineStyle: { color: '#1e3a5f' } },
          splitLine: { lineStyle: { color: 'rgba(30,58,95,0.3)', type: 'dashed' } },
        },
        // Grid 1 — tiempo en horas
        {
          gridIndex: 1, type: 'value', min: 0, max: maxHr,
          name: 'Tiempo desde el evento (horas)', nameLocation: 'middle', nameGap: 28,
          nameTextStyle: { color: '#8396ad', fontSize: 10 },
          axisLabel: {
            color: '#8396ad', fontSize: 10,
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
          nameTextStyle: { color: '#8396ad', fontSize: 10, padding: [0, 0, 0, -22] },
          axisLabel: { color: '#8396ad', fontSize: 10, formatter: '{value}m' },
          splitLine: { lineStyle: { color: '#080f1c', type: 'dashed' } },
          axisLine: { lineStyle: { color: '#1e3a5f' } },
        },
        // Grid 0 der — caudal (m³/s)
        {
          gridIndex: 0, type: 'value', name: 'Q (m³/s)', min: 0, max: +qMax.toFixed(qMax < 10 ? 1 : 0),
          nameTextStyle: { color: '#7c3aed', fontSize: 10 },
          axisLabel: { color: '#7c3aed', fontSize: 10, formatter: (v: number) => `${v}` },
          splitLine: { show: false },
          axisLine: { lineStyle: { color: '#3730a3' } },
          position: 'right',
        },
        // Grid 1 — kilómetro del canal
        {
          gridIndex: 1, type: 'value', name: 'Kilómetro del Canal', min: 0, max: 110,
          nameTextStyle: { color: '#8396ad', fontSize: 10 },
          axisLabel: { color: '#8396ad', fontSize: 10, formatter: 'K{value}' },
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
          lineStyle: { color: '#3FB2F3', width: 2, type: 'dashed', opacity: 0.7 },
          areaStyle: {
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(63, 178, 243,0.18)' },
                { offset: 1, color: 'rgba(63, 178, 243,0.04)' },
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
              distance: 5, fontSize: 10, color: colors[i],
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
          lineStyle: { color: 'rgba(63, 178, 243,0.18)', width: 1.5, type: 'dashed' },
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
                distance: 7, fontSize: 10,
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
            fontSize: 10, fontWeight: 'bold', color: '#fbbf24',
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
    const qMax = Math.max(1, ...allQ) * 1.2;
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
        axisLabel: { color: '#8396ad', fontSize: 10, formatter: 'K{value}' },
        axisLine: { lineStyle: { color: '#1e3a5f' } },
        splitLine: { lineStyle: { color: 'rgba(30,58,95,0.3)', type: 'dashed' } },
      },
      yAxis: {
        type: 'value', name: 'Q (m³/s)', min: +yMin.toFixed(1), max: +qMax.toFixed(qMax < 10 ? 1 : 0),
        nameTextStyle: { color: '#8396ad', fontSize: 10 },
        axisLabel: { color: '#8396ad', fontSize: 10, formatter: (v: number) => v >= 0 ? `${v}` : '' },
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
            show: true, position: 'top', fontSize: 10, fontWeight: 'bold',
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

  // ── PUNTO DE CONTROL ACTIVO ──────────────────────────────────────────
  const activeCPResult = simResults.find(r => r.id === activeCP);
  const activeCPData   = controlPoints.find(c => c.id === activeCP);

  // ── GLOBALS ──────────────────────────────────────────────────────────
  const firstCP      = simResults[0];
  const lastCP       = simResults[simResults.length - 1];
  // Eficiencia de conducción = (Q que llega a cola + Q entregado en tomas) / Q entrada.
  // Sin reportes de tomas y con anclas AFORO activas, la caída de Q entre escalas
  // incluye extracciones no contabilizadas → el cociente NO mide conducción (S/D,
  // nunca un número falso — mismo principio que el panel SKILL del Monitor).
  const extraccionesSimM3s = simResults.reduce((s, r) => s + (r.q_extraido ?? 0), 0);
  const globalEff    = qDam > 0 && lastCP
    ? Math.min(100, (((lastCP.q_sim ?? 0) + extraccionesSimM3s) / qDam) * 100)
    : 0;
  // Sin gasto de entrada (presa cerrada / sin movimiento) la eficiencia no se mide: S/D, no un 0.0 % que arrastre el IEC.
  const globalEffMedible = qDam > 0 && !!lastCP;
  const globalEffConfiable = globalEffMedible && (dataStatus.deliveries
    || !simResults.some(r => r.gate_anchored && r.gate_source === 'AFORO'));
  const iecSim = simResults.length > 0 && globalEffConfiable ? calcIEC({
    eficiencia:       globalEff,
    n_coherentes:     simResults.filter(r => r.status === 'ESTABLE').length,
    total_puntos:     simResults.length,
    q_fuga_total:     null, // sin medición de fugas: el componente se excluye (antes: 0 = 25 pts gratis)
    q_entrada:        qDam,
    escalas_criticas: simResults.filter(r => r.status === 'CRITICO').length,
    total_escalas:    simResults.length,
  }) : null;

  // Perfil: si el contenedor cambia de tamaño (rotación del iPad, barra de Safari, primer layout tras cargar datos)
  // o llegan datos nuevos, se redibuja. Sin esto a veces el perfil quedaba con el tamaño del primer render.
  useEffect(() => {
    const inst = () => { try { return perfilChartRef.current?.getEchartsInstance(); } catch { return undefined; } };
    const redibujar = () => { const c = inst(); if (c && !c.isDisposed()) c.resize(); };
    const t1 = window.setTimeout(redibujar, 60);
    const t2 = window.setTimeout(redibujar, 600);
    const el = (perfilChartRef.current as any)?.ele?.parentElement as HTMLElement | undefined;
    const ro = el && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(redibujar) : null;
    if (ro && el) ro.observe(el);
    window.addEventListener('orientationchange', redibujar);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); ro?.disconnect(); window.removeEventListener('orientationchange', redibujar); };
  }, [opsChartOption]);

  const systemStatus: CPStatus = simResults.some(r => r.status === 'CRITICO')
    ? 'CRITICO' : simResults.some(r => r.status === 'ALERTA') ? 'ALERTA' : 'ESTABLE';
  // En modo VACIADO/SIN ENTRADA el chip no alarma por niveles bajos esperados: se muestra el modo en tono neutro.
  const chipStatus: CPStatus = reglasRiegoSuspendidas ? 'ESTABLE' : systemStatus;
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
            startTime:       fmtTime(simBaseMinEff, 0),
            movimientoTime:  fmtTime(simBaseMinEff, 0),
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
            <div className="sim-brand-title">Simulador hidráulico</div>
            <div className="sim-brand-sub">Canal Principal Conchos · DR-005 · SICA</div>
          </div>
        </div>

        <div className="sim-kpi-row">
          <Kpi densidad="cabecera" etiqueta="Extracción Presa" valor={qDam.toFixed(1)} unidad=" m³/s" tonoValor="info" />
          <Kpi densidad="cabecera" etiqueta="Nivel K-0" valor={firstCP ? (firstCP.y_sim ?? 0).toFixed(2) : '—'} unidad=" m" tonoValor="info" />
          <Kpi
            densidad="cabecera" etiqueta="Eficiencia Conducción"
            valor={globalEffConfiable ? (globalEff ?? 0).toFixed(1) : null} unidad="%" tonoValor={globalEff >= 90 ? 'ok' : globalEff >= 85 ? 'warn' : 'crit'}
            ayuda={globalEffConfiable ? undefined
              : !globalEffMedible ? 'Sin gasto de entrada (presa cerrada o sin movimiento): la eficiencia de conducción no aplica'
              : 'Tomas sin reporte del día con gasto anclado a aforos SICA: la caída de Q incluye extracciones no contabilizadas — la conducción no es medible'}
          />
          {!iecSim && simResults.length > 0 && (
            <Kpi densidad="cabecera" etiqueta="IEC Canal" valor={null}
              ayuda={globalEffMedible ? 'IEC no calculable: eficiencia de conducción sin dato confiable (tomas sin reporte del día)' : 'IEC no calculable: sin gasto de entrada (presa cerrada o sin movimiento)'} />
          )}
          {iecSim && (
            <Kpi
              densidad="cabecera" etiqueta="IEC Canal" valor={String(iecSim.iec)} unidad="/100"
              tonoValor={iecSim.semaforo === 'VERDE' ? 'ok' : iecSim.semaforo === 'AMARILLO' ? 'warn' : 'crit'}
              ayuda={`${iecSim.texto}
Eficiencia: ${iecSim.p_eficiencia}/30
Coherencia: ${iecSim.p_coherencia}/25
Fugas: ${iecSim.p_fugas}/25
Nivel canal: ${iecSim.p_criticos}/20`}
              extra={(
                <div className="ui-kpi__barras" data-tono-barras={iecSim.semaforo === 'VERDE' ? 'ok' : iecSim.semaforo === 'AMARILLO' ? 'warn' : 'crit'} aria-hidden="true">
                  <i style={{ width: `${(iecSim.p_eficiencia / 30) * 100}%` }} />
                  <i style={{ width: `${(iecSim.p_coherencia / 25) * 100}%` }} />
                  <i style={{ width: `${(iecSim.p_fugas / 25) * 100}%` }} />
                  <i style={{ width: `${(iecSim.p_criticos / 20) * 100}%` }} />
                </div>
              )}
            />
          )}
          <Kpi densidad="cabecera" etiqueta="Arribo K-104" valor={reglasRiegoSuspendidas ? null : (lastCP?.arrival_time ?? '—')} tonoValor="warn" />
          <button
            type="button"
            className="sim-kpi-status"
            style={{ background: `${statusColor(chipStatus)}1a`, borderColor: statusColor(chipStatus) }}
            onClick={decisions.length > 0 ? focusDecisionPanel : undefined}
            disabled={decisions.length === 0}
            title={reglasRiegoSuspendidas
              ? 'Reglas de riego suspendidas: los niveles bajos son esperados en este modo. Ir al Motor de Decisión'
              : decisions.length > 0 ? 'Ir al Motor de Decisión' : undefined}
          >
            <span style={{ color: statusColor(chipStatus) }}><StatusIcon s={chipStatus} /></span>
            <span style={{ color: statusColor(chipStatus), fontWeight: 700 }}>
              {reglasRiegoSuspendidas ? (modoOperativo === 'VACIADO' ? 'VACIADO' : 'SIN ENTRADA') : systemStatus}
            </span>
          </button>
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
          <div className="sim-ctrl-label">Tipo de maniobra</div>
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
          <div className="sim-ctrl-label">Gasto simulado · presa la Boquilla</div>
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
            <span style={{ color: 'var(--text-3)' }}>
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

        {/* Hora de inicio de simulación */}
        <div className="sim-start-time-row">
          <div className="sim-start-time-label">
            <Clock size={10} />
            <span>Hora inicio sim.</span>
            {simStartOverride === null && (
              <span className="sim-start-time-auto">AUTO · {fmtTime(simBaseMin, 0)}</span>
            )}
          </div>
          <div className="sim-start-time-controls">
            <input
              type="time"
              aria-label="Hora de inicio de simulación"
              title="Hora de inicio de simulación"
              className="sim-start-time-input"
              value={simStartOverride !== null
                ? `${String(Math.floor(simStartOverride / 60)).padStart(2, '0')}:${String(simStartOverride % 60).padStart(2, '0')}`
                : fmtTime(simBaseMin, 0)
              }
              onChange={e => {
                const [h, m] = e.target.value.split(':').map(Number);
                if (!isNaN(h) && !isNaN(m)) setSimStartOverride(h * 60 + m);
              }}
            />
            {simStartOverride !== null && (
              <button
                type="button"
                className="sim-start-time-reset"
                onClick={() => setSimStartOverride(null)}
                title="Restablecer a hora automática del último movimiento de presa"
              >
                ↺ AUTO
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── PANEL CONDICIONANTES DE NIVEL (TEMPORAL SIMULACIÓN) ─────── */}
      {(() => {
        const nMod = Object.keys(restriccionOverrides).length;
        return (
          <div className={`nivel-panel ${showNivelPanel ? 'expanded' : ''}`}>
            {/* Header colapsable */}
            <div className="nivel-panel-header" onClick={() => setShowNivelPanel(v => !v)}>
              <span className="nivel-panel-title">Condicionantes de nivel · simulación</span>
              {nMod > 0 && (
                <span className="nivel-panel-badge">
                  {nMod} MODIFICADO{nMod > 1 ? 'S' : ''}
                </span>
              )}
              <span className="nivel-panel-toggle">
                {showNivelPanel ? '▲ COLAPSAR' : '▼ EXPANDIR'}
              </span>
              {nMod > 0 && (
                <button
                  type="button"
                  className="nivel-panel-reset-all"
                  onClick={e => { e.stopPropagation(); setRestriccionOverrides({}); }}
                >
                  Restaurar defaults
                </button>
              )}
            </div>

            {/* Cuerpo expandido */}
            {showNivelPanel && (
              <div className="nivel-panel-body">
                <div className="nivel-panel-note">
                  Estos valores son <strong>temporales</strong> — solo aplican durante esta sesión de simulación. No se guardan en base de datos.
                </div>
                {/* Encabezado de columnas */}
                <div className="nivel-panel-cols-header">
                  <span>TRAMO</span>
                  <span>MÍN DESEABLE (m)</span>
                  <span>MÁX PERMITIDO (m)</span>
                  <span>Tipo límite</span>
                  <span>TOLERANCIA (m)</span>
                  <span />
                </div>
                {activeRestricciones.map(r => {
                  const isModified = !!restriccionOverrides[r.tramo_id];
                  const setField = (field: string, val: any) =>
                    setRestriccionOverrides(prev => ({
                      ...prev,
                      [r.tramo_id]: { ...prev[r.tramo_id], [field]: val },
                    }));
                  const resetRow = () =>
                    setRestriccionOverrides(prev => {
                      const next = { ...prev };
                      delete next[r.tramo_id];
                      return next;
                    });
                  return (
                    <div
                      key={r.tramo_id}
                      className={`nivel-panel-row ${isModified ? 'modified' : ''}`}
                    >
                      {/* Tramo ID */}
                      <div>
                        <div className={`nivel-row-id ${isModified ? 'modified' : ''}`}>{r.tramo_id}</div>
                        <div className="nivel-row-criterio">{r.criterio_operativo}</div>
                      </div>
                      {/* Mín deseable */}
                      <input
                        type="number" step="0.05" min="0" max="5"
                        title={`Nivel mínimo deseable para ${r.tramo_id}`}
                        placeholder="—"
                        className={`nivel-input ${isModified ? 'modified' : ''}`}
                        value={r.nivel_min_deseable_m ?? ''}
                        onChange={e => setField('nivel_min_deseable_m', e.target.value === '' ? null : +e.target.value)}
                      />
                      {/* Máx permitido */}
                      <input
                        type="number" step="0.05" min="0" max="5"
                        title={`Nivel máximo permitido para ${r.tramo_id}`}
                        placeholder="0.00"
                        className={`nivel-input ${isModified ? 'modified' : ''} ${r.tipo_limite_max}`}
                        value={r.nivel_max_permitido_m}
                        onChange={e => setField('nivel_max_permitido_m', +e.target.value)}
                      />
                      {/* Tipo límite */}
                      <select
                        title={`Tipo de límite para ${r.tramo_id}`}
                        className={`nivel-select ${isModified ? 'modified' : ''} ${r.tipo_limite_max}`}
                        value={r.tipo_limite_max}
                        onChange={e => setField('tipo_limite_max', e.target.value as TipoLimite)}
                      >
                        <option value="duro">Duro</option>
                        <option value="blando">Blando</option>
                      </select>
                      {/* Tolerancia */}
                      <input
                        type="number" step="0.01" min="0" max="0.5"
                        title={`Tolerancia transitoria para ${r.tramo_id}`}
                        placeholder="0.00"
                        disabled={r.tipo_limite_max !== 'blando'}
                        className={`nivel-input ${isModified ? 'modified' : ''} ${r.tipo_limite_max !== 'blando' ? 'disabled' : ''}`}
                        value={r.tipo_limite_max === 'blando' ? (r.tolerancia_transitoria_m ?? 0) : ''}
                        onChange={e => setField('tolerancia_transitoria_m', +e.target.value)}
                      />
                      {/* Reset fila */}
                      {isModified ? (
                        <button
                          type="button"
                          onClick={resetRow}
                          title="Restaurar valores default de este tramo"
                          className="nivel-row-reset"
                        >
                          ↺
                        </button>
                      ) : (
                        <span className="nivel-row-no-mod">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── BANDA DE ESTADO DE TELEMETRÍA ──────────────────────────── */}
      <div className="sim-datasource-strip">
        <div className={`sim-ds-pill ${dataStatus.dam ? 'live' : 'default'}`}>
          <span className="sim-ds-dot" />
          <span className="sim-ds-label">Presa · Boquilla</span>
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
          <span className="sim-ds-label">Aperturas</span>
          <span className="sim-ds-val">
            {dataStatus.gates ? 'SICA Capture' : 'Valores por defecto'}
          </span>
        </div>
        <div className={`sim-ds-pill ${dataStatus.levels ? 'live' : 'default'}`}>
          <span className="sim-ds-dot" />
          <span className="sim-ds-label">Escalas</span>
          <span className="sim-ds-val">
            {dataStatus.levels
              ? `${Object.keys(baseReadings).length}/${controlPoints.length} puntos`
              : 'Sin telemetría'}
          </span>
        </div>
        <div className={`sim-ds-pill ${dataStatus.deliveries ? 'live' : 'default'}`}>
          <span className="sim-ds-dot" />
          <span className="sim-ds-label">Tomas · entrega</span>
          <span className="sim-ds-val">
            {dataStatus.deliveries
              ? `${deliveryPoints.filter(d => d.is_active).length} activas · −${dataStatus.totalExtractionM3s.toFixed(2)} m³/s`
              : 'Sin reporte del día'}
          </span>
        </div>
        <div className={`sim-ds-pill ${dataStatus.qRealK0 !== undefined ? 'live' : 'default'}`}>
          <span className="sim-ds-dot" />
          <span className="sim-ds-label">Q entrada canal</span>
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
          {(() => {
            const vistas = controlPoints.map(cp => {
              const r = simResults.find(x => x.id === cp.id);
              return { cp, r, est: estadoVistaCP(r, reglasRiegoSuspendidas) };
            });
            const cuenta = (e: EstadoVista) => vistas.filter(v => v.est === e).length;
            const PESO: Record<EstadoVista, number> = { CRITICO: 0, ALERTA: 1, BAJO_MIN: 2, ESTABLE: 3 };
            const ordenadas = [...vistas].sort((x, y) => ordenCP === 'severidad'
              ? PESO[x.est] - PESO[y.est] || x.cp.km - y.cp.km
              : x.cp.km - y.cp.km);
            const kmMin = Math.min(...controlPoints.map(c => c.km));
            const kmMax = Math.max(...controlPoints.map(c => c.km));
            // Sin escenario (Q simulado = real) ACTUAL y SIMULADO son iguales: se muestra un solo valor.
            const hayEscenario = simResults.some(x => Math.abs(x.delta_y) >= 0.015);
            const resumen: [EstadoVista, string][] = [['CRITICO', 'crítico'], ['ALERTA', 'alerta'], ['BAJO_MIN', 'bajo mín.'], ['ESTABLE', 'estable']];
            return (
              <>
                <div className="sim-cp-head">
                  <div className="sim-panel-title"><Activity size={10} /> Puntos de control · {controlPoints.length}</div>
                  <div className="sim-cp-sort" role="group" aria-label="Orden de la lista">
                    <span>Orden</span>
                    <button type="button" className={ordenCP === 'km' ? 'on' : ''} aria-pressed={ordenCP === 'km'} onClick={() => setOrdenCP('km')}>Km</button>
                    <button type="button" className={ordenCP === 'severidad' ? 'on' : ''} aria-pressed={ordenCP === 'severidad'} onClick={() => setOrdenCP('severidad')}>Severidad</button>
                  </div>
                  <div className="sim-cp-summary">
                    {resumen.filter(([e]) => cuenta(e) > 0).map(([e, txt]) => (
                      <span key={e} className="sim-cp-chip" style={{ color: colorEstadoVista(e), borderColor: `${colorEstadoVista(e)}55`, background: `${colorEstadoVista(e)}14` }}>
                        {cuenta(e)} {txt}
                      </span>
                    ))}
                  </div>
                </div>
                {!hayEscenario && simResults.length > 0 && (
                  <div className="sim-cp-banner">Sin escenario: nivel simulado = nivel actual</div>
                )}
                <div className="sim-cp-list">
                  {controlPoints.length === 0 && <div className="sim-cp-empty">Sin puntos de control cargados</div>}
                  {ordenadas.map(({ cp, r, est }) => {
                    const dy = r?.delta_y ?? 0;
                    const sc = colorEstadoVista(est);
                    const isActive = activeCP === cp.id;
                    const sinLectura = !(baseReadings[cp.id] > 0.05);
                    const niv = (v: number | undefined) => (sinLectura || v === undefined ? 'S/D' : v.toFixed(2));
                    const extremo = cp.km === kmMin ? ' · origen' : cp.km === kmMax ? ' · fin del canal' : '';
                    return (
                      <div
                        key={cp.id}
                        ref={el => { cpCardRefs.current[cp.id] = el; }}
                        className={`sim-cp-card ${isActive ? 'active' : ''}`}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isActive}
                        style={{
                          ...(isActive ? { borderColor: sc, background: `${sc}1f` } : {}),
                          ...(est !== 'ESTABLE' ? { borderLeft: `3px solid ${sc}` } : {}),
                        }}
                        onClick={() => setActiveCP(cp.id)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveCP(cp.id); } }}
                      >
                        <div className="sim-cp-card-top">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <div className="sim-cp-dot" style={{ background: sc, boxShadow: `0 0 7px ${sc}` }} />
                            <div>
                              <div className="sim-cp-name">{cp.nombre}</div>
                              <div className="sim-cp-km">KM {cp.km}{extremo}{hayEscenario ? ` · ${r?.remanso_type ?? 'NORMAL'}` : ''}</div>
                              {(() => {
                                const edad = edadLectura(dataStatus.lecturaFecha?.[cp.id], baseReadings[cp.id]);
                                return edad ? <div className="sim-cp-age" style={{ color: edad.color }} title={edad.title}>{edad.texto}</div> : null;
                              })()}
                            </div>
                          </div>
                          <div className="sim-cp-status" style={{ color: sc, borderColor: `${sc}55`, background: `${sc}1f` }}
                            title={est === 'BAJO_MIN' ? 'Bajo el mínimo deseable de servicio: esperado con el canal en vaciado o sin entrada de agua.' : undefined}>
                            {r ? TXT_ESTADO[est] : '—'}
                          </div>
                        </div>

                        {simpleMode ? (
                          <div className="sim-card-simple">
                            <div className="sim-card-levels">
                              <div>
                                <div className="sim-lvl-label">{hayEscenario ? 'ACTUAL' : 'NIVEL'}</div>
                                <div className={`sim-lvl-val ${hayEscenario ? 'secondary' : ''}`} style={hayEscenario ? undefined : { color: sinLectura ? '#f59e0b' : sc }}>{niv(r?.y_base)}<span>{sinLectura ? '' : 'm'}</span></div>
                              </div>
                              {hayEscenario && (
                                <>
                                  <div className={`sim-arrow ${dy > 0.015 ? 'up' : dy < -0.015 ? 'down' : 'flat'}`}>
                                    {dy > 0.015 ? <ArrowUp size={20} /> : dy < -0.015 ? <ArrowDown size={20} /> : <span style={{ fontSize: 16 }}>—</span>}
                                  </div>
                                  <div>
                                    <div className="sim-lvl-label">Simulado</div>
                                    <div className="sim-lvl-val" style={{ color: sc }}>{niv(r?.y_sim)}<span>{sinLectura ? '' : 'm'}</span></div>
                                  </div>
                                </>
                              )}
                            </div>
                            {hayEscenario && (
                              <div className="sim-card-info-row">
                                <span className="sim-delta-txt" style={{ color: Math.abs(dy) * 100 > 5 ? (dy > 0 ? '#fbbf24' : '#60a5fa') : '#94a3b8' }}>
                                  {deltaLabel(dy)}
                                </span>
                                <span className="sim-transit-txt"
                                  title={qDam < 5 ? 'Tiempo extrapolado: la velocidad de onda está calibrada para gastos de 5 m³/s o más.' : undefined}>
                                  <Clock size={10} /> {qDam < 5 && (r?.cumulative_min ?? 0) >= 1 ? '≈ ' : ''}{transitLabel(r?.cumulative_min ?? 0)}
                                </span>
                              </div>
                            )}
                            <div className="sim-pct-row">
                              <div className="sim-pct-bar">
                                <div className="sim-pct-fill" style={{
                                  width: `${Math.min(100, r?.bordo_libre_pct ?? 0)}%`,
                                  background: (r?.bordo_libre_pct ?? 0) > 92 ? '#ef4444' : (r?.bordo_libre_pct ?? 0) > 75 ? '#f59e0b' : '#10b981',
                                }} />
                              </div>
                              <div className="sim-pct-lbl">{sinLectura ? 'S/D' : `${(r?.bordo_libre_pct ?? 0).toFixed(0)}%`} del tirante máx.</div>
                            </div>
                            {/* Extracción real en este tramo */}
                            {(r?.n_tomas_activas ?? 0) > 0 && (
                              <div className="sim-delivery-chip">
                                <Droplets size={9} />
                                {r!.n_tomas_activas} toma{r!.n_tomas_activas > 1 ? 's' : ''} ·
                                −{r!.q_extraido.toFixed(2)} m³/s entregado
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="sim-card-tech">
                            {[
                              ['y_base / y_sim', sinLectura ? 'S/D' : `${(r?.y_base ?? 0).toFixed(2)} / ${(r?.y_sim ?? 0).toFixed(2)} m`],
                              ['Δy (Remanso)',   `${(dy ?? 0) >= 0 ? '+' : ''}${(dy ?? 0).toFixed(3)} m`],
                              ['Q · V · Fr',    `${(r?.q_sim ?? 0).toFixed(1)} m³/s · ${(r?.velocity_ms ?? 0).toFixed(2)} · ${(r?.froude_n ?? 0).toFixed(3)}`],
                              ['Tomas activas',  `${r?.n_tomas_activas ?? 0} · −${(r?.q_extraido ?? 0).toFixed(2)} m³/s`],
                              ['Arribo',        reglasRiegoSuspendidas ? 'S/D' : (r?.arrival_time ?? '—')],
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
              </>
            );
          })()}
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
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: 'var(--st-info)', borderRadius: 0 }} /> Tirante Actual</span>
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: 'var(--st-info)' }} /> Tirante Simulado</span>
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: 'var(--sc-violet)', borderRadius: 0 }} /> Caudal Q</span>
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: 'var(--st-crit)', borderRadius: 0, opacity: 0.5 }} /> Bordo Libre</span>
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: 'var(--st-warn)', borderRadius: '50%' }} /> Frente de Onda</span>
                {simResults.some(r => r.remanso_type === 'M1') && <span className="sim-leg-tag tag-m1">▲ Incremento</span>}
                {simResults.some(r => r.remanso_type === 'M2') && <span className="sim-leg-tag tag-m2">▼ Decremento</span>}
              </div>
            </div>
            <div className="sim-chart-wrap">
              <ReactECharts ref={perfilChartRef} option={opsChartOption} style={{ position: 'absolute', inset: 0, height: '100%', width: '100%' }} notMerge={true} />
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
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: 'var(--st-warn)', borderRadius: 2 }} /> Q Real SQL</span>
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: 'var(--st-info)', borderRadius: 0 }} /> Q Simulado</span>
                <span className="sim-leg"><span className="sim-leg-dot" style={{ background: 'color-mix(in srgb, var(--st-warn) 55%, transparent)', borderRadius: 1 }} /> Extracciones</span>
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

          {/* La sección transversal vive solo en el panel derecho (CanalSection): antes estaba duplicada aquí. */}

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
                    <span className="sim-compare-scen-lbl">A · actual</span>
                    <span className="sim-compare-scen-val">{qDam.toFixed(1)} m³/s</span>
                  </div>
                  <span className="sim-compare-vs">VS</span>
                  <div className="sim-compare-scen scen-b">
                    <span className="sim-compare-scen-lbl">B · hipotético</span>
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
              <DataTable
                className="sim-compare-table"
                clave={(f) => f.rA.id} filas={simResults.map((rA, i) => ({ rA, rB: simResultsB[i] }))}
                filaProps={({ rA }) => ({ className: activeCP === rA.id ? 'active-row' : '', onClick: () => setActiveCP(rA.id) })}
                columnas={[
                    { id: 'sec', titulo: 'Sección', className: 'sim-compare-name', render: ({ rA }) => rA.nombre.replace(/^(K-\d+)\s+/, '$1 ') },
                    { id: 'qa', titulo: 'Q · Esc A', className: 'scen-a-col', claseTh: 'scen-a-col', render: ({ rA }) => rA.q_sim.toFixed(1) },
                    {
                        id: 'qb', titulo: 'Q · Esc B', className: 'scen-b-col', claseTh: 'scen-b-col',
                        render: ({ rA, rB }) => {
                            const dq = rB ? rB.q_sim - rA.q_sim : 0;
                            return <>{rB ? rB.q_sim.toFixed(1) : '—'}{rB && Math.abs(dq) > 0.1 && <span className={`sim-compare-diff ${dq > 0 ? 'pos' : 'neg'}`}> {dq > 0 ? '+' : ''}{dq.toFixed(1)}</span>}</>;
                        },
                    },
                    { id: 'ya', titulo: 'Escala A', className: 'scen-a-col', claseTh: 'scen-a-col', estilo: ({ rA }) => ({ color: statusColor(rA.status) }), render: ({ rA }) => `${rA.y_sim.toFixed(2)}m` },
                    { id: 'yb', titulo: 'Escala B', className: 'scen-b-col', claseTh: 'scen-b-col', estilo: ({ rB }) => ({ color: rB ? statusColor(rB.status) : 'var(--text-3)' }), render: ({ rB }) => rB ? `${rB.y_sim.toFixed(2)}m` : '—' },
                    {
                        id: 'dy', titulo: 'Δ Escala',
                        estilo: ({ rA, rB }) => { const dy = rB ? rB.y_sim - rA.y_sim : 0; return { color: Math.abs(dy) < 0.005 ? 'var(--text-3)' : dy > 0 ? 'var(--st-warn)' : 'var(--st-info)', fontWeight: 600 }; },
                        render: ({ rA, rB }) => { const dy = rB ? rB.y_sim - rA.y_sim : 0; return rB ? `${dy >= 0 ? '+' : ''}${Math.round(dy * 100)} cm` : '—'; },
                    },
                    { id: 'aa', titulo: 'Arribo A', className: 'scen-a-col', claseTh: 'scen-a-col', render: ({ rA }) => rA.arrival_time },
                    { id: 'ab', titulo: 'Arribo B', className: 'scen-b-col', claseTh: 'scen-b-col', render: ({ rB }) => rB?.arrival_time ?? '—' },
                    {
                        id: 'est', titulo: 'Estado A/B',
                        render: ({ rA, rB }) => (
                            <>
                                <span className="sim-compare-status" style={{ color: statusColor(rA.status) }}>{rA.status[0]}</span>
                                {rB && <span className="sim-compare-status-sep">/</span>}
                                {rB && <span className="sim-compare-status" style={{ color: statusColor(rB.status) }}>{rB.status[0]}</span>}
                            </>
                        ),
                    },
                ]}
              />

              {/* ── Modificar tomas para el escenario ── */}
              {deliveryPoints.filter(d => d.is_active).length > 0 && (
                <div className="sim-mods-section">
                  <div className="sim-mods-hdr">
                    <span>Modificar extracciones · escenario B</span>
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
                  <DataTable
                    className="sim-compare-table"
                    clave={(r) => String(r.i)} filas={scenarioRpcRows.map((row: any, i: number) => ({ row, i }))}
                    filaProps={({ row }) => ({ className: row.tipo_punto === 'k104' ? 'active-row' : '' })}
                    columnas={[
                        { id: 'tramo', titulo: 'Tramo', className: 'sim-rpc-tramo-name', claseTh: 'sim-rpc-th-left', render: ({ row }) => (row.nombre_tramo ?? '').split(' (')[0] },
                        { id: 'q', titulo: 'Q sal.', className: 'sim-rpc-q', render: ({ row }) => (row.q_salida_m3s ?? 0).toFixed(1) },
                        { id: 'y', titulo: 'Tirante', render: ({ row }) => `${(row.y_normal_m ?? 0).toFixed(2)}m` },
                        {
                            id: 'dy', titulo: 'Δ cm',
                            claseFila: ({ row }) => { const dy = row.delta_y_cm ?? 0; return `sim-rpc-dy ${dy > 5 ? 'up' : dy < -5 ? 'dn' : ''}`; },
                            render: ({ row }) => `${(row.delta_y_cm ?? 0) >= 0 ? '+' : ''}${row.delta_y_cm ?? '—'}`,
                        },
                        { id: 'arr', titulo: 'Arribo', className: 'sim-rpc-arribo', render: ({ row }) => row.hora_arribo ?? '—' },
                        {
                            id: 'fr', titulo: 'Fr',
                            claseFila: ({ row }) => { const fr = row.froude ?? 0; return `sim-rpc-fr ${fr > 0.8 ? 'crit' : fr > 0.5 ? 'warn' : 'ok'}`; },
                            render: ({ row }) => (row.froude ?? 0).toFixed(2),
                        },
                    ]}
                  />
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
                  t+{timeDelta}min <span style={{ color: 'var(--st-warn)' }}>({(timeDelta / 60).toFixed(1)}h)</span>
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
                    <div className="sim-track-time" style={{ color: arrived ? '#fbbf24' : '#8396ad' }}>{r.arrival_time}</div>
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
                  <span><span style={{ display: 'inline-block', width: 10, height: 2, background: 'var(--st-info)', verticalAlign: 'middle', marginRight: 4 }} />Simulado</span>
                  <span><span style={{ display: 'inline-block', width: 10, height: 2, background: 'var(--st-info)', opacity: 0.6, verticalAlign: 'middle', marginRight: 4 }} />Actual</span>
                  <span><span style={{ display: 'inline-block', width: 10, height: 2, background: 'var(--st-crit)', opacity: 0.6, verticalAlign: 'middle', marginRight: 4 }} />Bordo L.</span>
                </div>
              </div>

              {/* Apertura de compuerta — actual SICA vs requerida por simulación */}
              <div className="sim-gate-wrap">
                <div className="sim-gate-hdr">
                  <span>Apertura Radial</span>
                  <div className="sim-gate-badges">
                    {/* Indicador de ancla activa — distingue fuente: aforo vs orificio */}
                    {activeCPResult.gate_anchored && activeCPResult.gate_source === 'AFORO' && (
                      <span className="sim-gate-anchored-badge sim-gate-anchored-aforo"
                        title="Gasto anclado al aforo medido por SICA Capture (gasto_calculado_m3s). El motor capó el flujo simulado al valor real medido.">
                        ⚓ AFORO SICA
                      </span>
                    )}
                    {activeCPResult.gate_anchored && activeCPResult.gate_source === 'ORIFICIO' && (
                      <span className="sim-gate-anchored-badge sim-gate-anchored-orificio"
                        title="Sin aforo SICA disponible — el caudal fue calculado por fórmula de orificio (Cd·n·b·apertura·√(2g·y)). Basado en apertura real y tirante medido.">
                        ⚙ ORIFICIO
                      </span>
                    )}
                    {gateBase[activeCP] != null && (
                      <span className="sim-gate-base-badge">
                        SICA: {gateBase[activeCP].toFixed(2)}m
                      </span>
                    )}
                    <span className="sim-gate-val">{(gateOverrides[activeCP] ?? activeCPResult.h_radial ?? 0).toFixed(2)} m</span>
                  </div>
                </div>
                {/* Comparativa Q orificio — el desglose técnico solo en modo Técnico;
                    la alerta de incoherencia se muestra siempre (también en Operativo):
                    es la señal de "algo está mal", no un detalle a esconder. */}
                {activeCPResult.q_gate_m3s != null && (() => {
                  const qOrificio = CD_GATE * activeCPResult.area_gate
                    * Math.sqrt(2 * G * Math.max(0.01, activeCPResult.y_base));
                  const isAforo    = activeCPResult.gate_source === 'AFORO';
                  const isOrificio = activeCPResult.gate_source === 'ORIFICIO';
                  const ratio      = isAforo && qOrificio > 0
                    ? activeCPResult.q_gate_m3s / qOrificio : 1;
                  const incoherente = isAforo && (ratio < 0.6 || ratio > 1.4);
                  if (simpleMode && !incoherente) return null;
                  return (
                    <div className="sim-gate-orificio"
                      style={{ borderColor: incoherente ? '#ef4444' : isOrificio ? 'rgba(167,139,250,0.4)' : 'var(--sim-border)' }}>
                      {!simpleMode && isAforo && (
                        <div className="sim-gate-orif-row">
                          <span>Q orificio teórico</span>
                          <span style={{ color: 'var(--text-3)' }}>{qOrificio.toFixed(2)} m³/s</span>
                        </div>
                      )}
                      {!simpleMode && (
                        <div className="sim-gate-orif-row">
                          <span>{isAforo ? 'Q aforo SICA (ancla)' : 'Q calculado orificio'}</span>
                          <span style={{ color: isOrificio ? '#a78bfa' : '#3FB2F3' }}>
                            {activeCPResult.q_gate_m3s.toFixed(2)} m³/s
                          </span>
                        </div>
                      )}
                      {!simpleMode && isOrificio && (
                        <div className="sim-gate-orif-row" style={{ color: 'var(--text-3)', fontSize: '8px' }}>
                          <span>Cd·{activeCPResult.area_gate.toFixed(1)}m²·√(2g·{activeCPResult.y_base.toFixed(2)}m)</span>
                          <span style={{ color: 'var(--text-3)' }}>sin aforo</span>
                        </div>
                      )}
                      {incoherente && (
                        <div className="sim-gate-orif-alert">
                          <AlertOctagon size={14} />
                          <span>Q_aforo = {(ratio * 100).toFixed(0)}% del teórico — verificar apertura o calibración Cd</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
                <input type="range" min={0.1} max={3} step={0.05}
                  value={gateOverrides[activeCP] ?? activeCPResult.h_radial}
                  onChange={e => setGateOverrides({ ...gateOverrides, [activeCP]: +e.target.value })}
                  className="sim-slider" title="Apertura de compuerta" />
                <div className="sim-gate-hints">
                  <span>0.1 m</span>
                  <span>{activeCPData.pzas_radiales} pzas · ancho {activeCPData.ancho}m · A={activeCPResult.area_gate.toFixed(1)}m²</span>
                  <span>3.0 m</span>
                </div>
                {/* ── BLOQUE APERTURA OPERATIVA ─────────────────────────────────
                    Semántica diferenciada por DIRECCIÓN del cambio:
                    • INCREMENTO → pregunta: ¿puede la compuerta pasar el nuevo Q?
                      Si capacidad física > Q_sim → "Suficiente, sin acción"
                      Si capacidad < Q_sim (cuello botella) → "ABRIR"
                      NUNCA mostrar "CERRAR" durante INCREMENT (físicamente contrario)
                    • DECREMENTO / CORTE → pregunta: ¿qué apertura mantiene el nivel?
                      apertura_req vs apertura_actual → CERRAR válido aquí
                ─────────────────────────────────────────────────────────────── */}
                {(Math.abs(qDam - qBase) > 0.5 || activeCPResult.km >= 100) && (() => {
                  const isIncrement   = qDam > qBase + 0.5;
                  const aperBase      = gateBase[activeCP] ?? activeCPResult.h_radial ?? 0;
                  const aperReq       = Math.min(3.0, Math.max(0.1, activeCPResult.apertura_requerida));
                  // Capacidad física de la compuerta al tirante actual
                  const qCapacidad    = activeCPResult.cd_used * activeCPResult.area_gate
                    * Math.sqrt(2 * G * Math.max(0.01, activeCPResult.y_sim));
                  const qProyectado   = activeCPResult.q_sim ?? 0;
                  const esSuficiente  = isIncrement && qCapacidad >= qProyectado * 0.90;

                  // Etiqueta de encabezado
                  const labelHead =
                    activeCPResult.gate_anchored && activeCPResult.gate_source === 'AFORO'
                      ? '⚓ AFORO SICA — limita el Q simulado'
                    : activeCPResult.gate_anchored && activeCPResult.gate_source === 'ORIFICIO'
                      ? '⚙ ORIFICIO — Q calculado por compuerta'
                    : isIncrement
                      ? '▲ INCREMENTO'
                      : '▼ DECREMENTO';

                  return (
                    <div className={`sim-gate-required${esSuficiente ? ' gate-ok' : ''}`}>
                      <div className="sim-gate-req-label">
                        {labelHead} · {esSuficiente
                          ? 'Compuerta con capacidad suficiente'
                          : 'Ajuste operativo requerido'}
                      </div>

                      {esSuficiente ? (
                        /* INCREMENTO — compuerta no es cuello de botella */
                        <>
                          <div className="sim-gate-ok-body">
                            <div className="sim-gate-ok-row">
                              <span>Apertura actual</span>
                              <span className="sim-gate-ok-val">{aperBase.toFixed(2)} m</span>
                            </div>
                            <div className="sim-gate-ok-row">
                              <span>Capacidad compuerta</span>
                              <span className="sim-gate-ok-cap">{qCapacidad.toFixed(1)} m³/s</span>
                            </div>
                            <div className="sim-gate-ok-row">
                              <span>Q proyectado</span>
                              <span className="sim-gate-ok-q">{qProyectado.toFixed(1)} m³/s</span>
                            </div>
                          </div>
                          <div className="sim-gate-req-note sim-gate-ok-note">
                            ✓ Sin acción en compuerta — el volumen incremental pasará sin restricción
                          </div>
                        </>
                      ) : (
                        /* DECREMENTO o INCREMENTO cuello de botella */
                        <>
                          <div className="sim-gate-req-row">
                            <div className="sim-gate-req-item">
                              <span className="sim-gate-req-key">Apertura actual (SICA)</span>
                              <span className="sim-gate-req-val current">{aperBase.toFixed(2)} m</span>
                            </div>
                            <div className="sim-gate-req-arrow" style={{
                              color: isIncrement ? '#f59e0b' : aperReq > aperBase ? '#f59e0b' : '#60a5fa',
                            }}>
                              {/* Durante INCREMENT solo puede ser ABRIR (cuello de botella) */}
                              {isIncrement || aperReq > aperBase ? '→ ABRIR →' : '→ CERRAR →'}
                            </div>
                            <div className="sim-gate-req-item">
                              <span className="sim-gate-req-key">
                                {isIncrement ? 'Apertura mínima requerida' : 'Apertura requerida'}
                              </span>
                              <span className="sim-gate-req-val required">{aperReq.toFixed(2)} m</span>
                            </div>
                          </div>
                          <div className="sim-gate-req-note">
                            {isIncrement
                              ? `Compuerta limita el paso · Cap. actual: ${qCapacidad.toFixed(1)} m³/s < Q proyectado: ${qProyectado.toFixed(1)} m³/s`
                              : `Para mantener escala ${activeCPResult.y_base.toFixed(2)}m con Q=${qProyectado.toFixed(1)}m³/s`}
                          </div>
                          {activeCPResult.apertura_requerida > 3.0 && (
                            <div className="sim-gate-req-overflow">
                              <AlertOctagon size={9} /> Apertura calculada {activeCPResult.apertura_requerida.toFixed(2)}m excede límite físico (3.0m) — Q no puede mantenerse en esta escala
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()}
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
                      [<Droplets size={13} />, 'Gasto en sección',    `${(activeCPResult.q_sim??0).toFixed(2)} m³/s`, '#3FB2F3'],
                      [<Clock    size={13} />, 'Agua llega en',        transitLabel(activeCPResult.cumulative_min),     '#fbbf24'],
                      [dy > 0.01 ? <ArrowUp size={13}/> : dy < -0.01 ? <ArrowDown size={13}/> : <Activity size={13}/>,
                       'Variación de escala', deltaLabel(dy), movClr],
                      [<StatusIcon s={activeCPResult.status} />, 'Estado', activeCPResult.status, sc],
                      [<Waves size={13}/>, '% Profundidad usada', `${(activeCPResult.bordo_libre_pct??0).toFixed(1)}%`, sc],
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
                          dataStatus.levels ? '#3FB2F3' : '#8FA7C8'],
                        ['Apertura real radiales', gateBase[activeCP] != null
                          ? `${gateBase[activeCP].toFixed(3)} m  ×${activeCPData.pzas_radiales} pzas`
                          : 'Sin dato telemetría', gateBase[activeCP] != null ? '#3FB2F3' : '#6b7280'],
                        ['Gasto medido SICA',      tel?.gasto_medido != null
                          ? `${tel.gasto_medido.toFixed(3)} m³/s`
                          : 'Sin dato telemetría', tel?.gasto_medido != null ? '#3FB2F3' : '#6b7280'],
                        ['Lectura AM / PM',
                          tel?.lectura_am != null || tel?.lectura_pm != null
                          ? `${tel?.lectura_am?.toFixed(2) ?? '—'} / ${tel?.lectura_pm?.toFixed(2) ?? '—'} m`
                          : 'Sin lecturas del día', '#8396ad'],
                        ['Tendencia 12h Δ',
                          tel?.delta_12h != null && Math.abs(tel.delta_12h) > 0.001
                          ? `${tel.delta_12h > 0 ? '+' : ''}${(tel.delta_12h * 100).toFixed(0)} cm`
                          : 'Estable (< 1 cm)', tel?.delta_12h && Math.abs(tel.delta_12h) > 0.001
                            ? (tel.delta_12h > 0 ? '#fbbf24' : '#60a5fa') : '#8FA7C8'],
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
                      ['Motor hidráulico',    'Saint-Venant 1D + Orificio',  '#8FA7C8'],
                      ['Fórmula',            'Δy = Q²/(Cd²·A²·2g) − Q₀²/(…)', '#8396ad'],
                      ['Q₀ (base presa)',    `${qBase.toFixed(3)} m³/s`,      '#3FB2F3'],
                      ['Q (simulado)',       `${(activeCPResult.q_sim??0).toFixed(3)} m³/s`, '#2dd4bf'],
                      ['Cd (descarga)',      `${activeCPResult.cd_used.toFixed(3)}${activeCPData.coeficiente_descarga ? ' (real BD)' : ' (global)'}`, '#94a3b8'],
                      ['Área compuerta A',   `${activeCPResult.area_gate.toFixed(3)} m²`,    '#94a3b8'],
                      ['Carga base H₀',      `${(activeCPResult.head_base??0).toFixed(4)} m`, '#8396ad'],
                      ['Carga simulada H',   `${(activeCPResult.head_sim??0).toFixed(4)} m`,  '#8FA7C8'],
                      ['ΔH (carga orificio)',`${(activeCPResult.head_delta??0) >= 0 ? '+' : ''}${(activeCPResult.head_delta??0).toFixed(4)} m`, '#fbbf24'],
                      ['── Lógica operativa ──', '────────────────', '#1e3a5f'],
                      ['Nivel objetivo (y_target)', (() => {
                        const rst  = findRestriccion(activeCPResult.km, activeRestricciones);
                        const yMin = rst?.nivel_min_deseable_m ?? getOpLimits(activeCPResult.km).yMin;
                        const yMax = rst?.nivel_max_permitido_m ?? getOpLimits(activeCPResult.km).yMax;
                        return `${(activeCPResult.y_target??0).toFixed(3)} m  [${yMin.toFixed(2)} – ${yMax.toFixed(2)}]`;
                      })(), '#a78bfa'],
                      ['Apertura actual SICA', `${(activeCPResult.apertura_base??gateBase[activeCP]??activeCPResult.h_radial).toFixed(3)} m`, '#3FB2F3'],
                      ['Apertura requerida',  `${activeCPResult.apertura_requerida.toFixed(3)} m`, '#fbbf24'],
                      ['Δ Apertura',          `${(activeCPResult.delta_apertura??0) >= 0 ? '+' : ''}${(activeCPResult.delta_apertura??0).toFixed(3)} m  ${(activeCPResult.delta_apertura??0) > 0.03 ? '▲ ABRIR' : (activeCPResult.delta_apertura??0) < -0.03 ? '▼ CERRAR' : 'Sin ajuste'}`, (activeCPResult.delta_apertura??0) > 0.03 ? '#f59e0b' : (activeCPResult.delta_apertura??0) < -0.03 ? '#3b82f6' : '#8FA7C8'],
                    ].map(([k, v, c]) => (
                      <div key={k as string} className="sim-tech-row">
                        <span>{k as string}</span><span style={{ color: c as string }}>{v as string}</span>
                      </div>
                    ))}
                  </div>

                  {/* Bloque 3: Resultado Hidráulico */}
                  <div className="sim-hyd-block">
                    <div className="sim-hyd-block-title">Resultado hidráulico</div>
                    {(() => {
                      // Geometría real del tramo activo para cálculos en panel técnico
                      const tr = findTramo(activeCPResult.km, tramoGeom);
                      const yn = normalDepth(activeCPResult.q_sim ?? 0, tr.pendiente_s0, tr.plantilla_m, tr.talud_z, tr.rugosidad_n);
                      return [
                      ['Plantilla / Talud / n',  `${tr.plantilla_m}m · ${tr.talud_z}:1 · n=${tr.rugosidad_n}`, '#8396ad'],
                      ['Tirante normal y_n',     `${yn.toFixed(3)} m`, '#3FB2F3'],
                      // Modelo perturbacional: y_sim = y_base + [y_n(Q_sim) − y_n(Q_base)]
                      ...((() => {
                        const ynBase = normalDepth(activeCPResult.q_base ?? 0,
                          tr.pendiente_s0, tr.plantilla_m, tr.talud_z, tr.rugosidad_n);
                        const dManning = yn - ynBase;
                        const rows: [string, string, string][] = [
                          ['Δy Manning (perturbación)',
                            `${dManning >= 0 ? '+' : ''}${dManning.toFixed(3)} m  (y_sim = y_base + Δy_n)`,
                            '#a78bfa'],
                        ];
                        // A5.4: mostrar piso de servicio cuando acota la proyección
                        const rst    = findRestriccion(activeCPResult.km, activeRestricciones);
                        const yMinOp = rst?.nivel_min_deseable_m ?? getOpLimits(activeCPResult.km).yMin;
                        const yB     = activeCPResult.y_base;
                        const yFloor = yB >= yMinOp ? Math.max(yMinOp, yB * 0.90) : yB * 0.90;
                        if (yB + dManning < yFloor) {
                          rows.push(['Piso de servicio',
                            `${yFloor.toFixed(3)} m — proyección Manning bajo piso (máx −10% o mín operativo)`,
                            '#a78bfa']);
                        }
                        return rows;
                      })()),
                      ['Tirante simulado y_sim', `${(activeCPResult.y_sim??0).toFixed(3)} m`, statusColor(activeCPResult.status)],
                      ['Δy  (variación escala)', `${(activeCPResult.delta_y??0) >= 0 ? '+' : ''}${(activeCPResult.delta_y??0).toFixed(4)} m  (${Math.round((activeCPResult.delta_y??0)*100)} cm)`, Math.abs(activeCPResult.delta_y??0)*100 > 5 ? ((activeCPResult.delta_y??0) > 0 ? '#fbbf24' : '#60a5fa') : '#94a3b8'],
                      ['Curva hidráulica',       activeCPResult.remanso_type === 'M1' ? 'M1 — Remanso positivo' : activeCPResult.remanso_type === 'M2' ? 'M2 — Descenso (drawdown)' : 'Normal (sin remanso)', '#a78bfa'],
                      ['Velocidad media V',      `${(activeCPResult.velocity_ms??0).toFixed(3)} m/s`, '#3FB2F3'],
                      ['Celeridad de onda c',    `${(activeCPResult.celerity_ms??0).toFixed(3)} m/s`, '#2dd4bf'],
                      ['Número de Froude Fr',    `${(activeCPResult.froude_n??0).toFixed(4)}  ${(activeCPResult.froude_n??0) > 1 ? '⚠ Supercrítico' : 'Subcrítico'}`, (activeCPResult.froude_n??0) > 1 ? '#ef4444' : '#8FA7C8'],
                      ['% Profundidad usada',     `${(activeCPResult.bordo_libre_pct??0).toFixed(1)}%`, statusColor(activeCPResult.status)],
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
              {/* A5.3: En delta-sim usar qDam (simulado) como referencia de entrada.
                        qRealK0 es la medición del instante presente, no del escenario futuro. */}
              <div className="sim-balance-wrap">
                <div className="sim-panel-title"><Droplets size={10} /> Balance Hídrico hasta K{activeCPResult.km}</div>
                {(() => {
                  const isDeltaBalance = Math.abs(qDam - qBase) > 0.5;
                  const qEntrada = isDeltaBalance ? qDam : (dataStatus.qRealK0 ?? qDam);
                  const qLlegada = activeCPResult.q_sim ?? 0;
                  const etiqueta = isDeltaBalance
                    ? `Entrada (Presa — sim. ${qDam > qBase ? '+' : ''}${(qDam - qBase).toFixed(1)} m³/s)`
                    : (dataStatus.qRealK0 != null ? 'Entrada (Canal K-0 SICA)' : 'Entrada (Presa — estimado)');
                  // Extracciones contabilizadas aguas arriba del punto activo
                  const extraidoHasta = simResults
                    .filter(r => r.km <= activeCPResult.km)
                    .reduce((s, r) => s + (r.q_extraido ?? 0), 0);
                  // Sin reporte de tomas + Q anclado a aforos aguas arriba:
                  // la diferencia incluye extracciones no contabilizadas → S/D
                  const ancladoSinTomas = !dataStatus.deliveries && simResults.some(
                    r => r.km <= activeCPResult.km && r.gate_anchored && r.gate_source === 'AFORO');
                  const perdida = Math.max(0, qEntrada - qLlegada - extraidoHasta);
                  const efic    = qEntrada > 0
                    ? Math.min(100, (qLlegada + extraidoHasta) / qEntrada * 100) : 0;
                  return (
                    <>
                      {[
                        [etiqueta,            `${qEntrada.toFixed(2)} m³/s`, '#3FB2F3'],
                        ['Llegada a sección', `${qLlegada.toFixed(2)} m³/s`, '#2dd4bf'],
                        ...(extraidoHasta > 0.005
                          ? [['Extraído en tomas', `−${extraidoHasta.toFixed(2)} m³/s`, '#fbbf24']]
                          : []),
                        [ancladoSinTomas ? 'Δ no contabilizado (fugas + tomas s/reporte)' : 'Pérdida en tramo',
                          perdida > 0.005 ? `−${perdida.toFixed(2)} m³/s` : '0.00 m³/s', '#ef4444'],
                      ].map(([k, v, c]) => (
                        <div key={k as string} className="sim-balance-row">
                          <span>{k as string}</span><span style={{ color: c as string }}>{v as string}</span>
                        </div>
                      ))}
                      <div className="sim-balance-eff">
                        <span>Eficiencia hasta K{activeCPResult.km}</span>
                        <span
                          title={ancladoSinTomas ? 'No medible: la caída de Q incluye extracciones sin reporte del día' : undefined}
                          style={{ color: ancladoSinTomas ? '#8FA7C8' : qEntrada > 0 ? (efic >= 90 ? '#10b981' : '#f59e0b') : '#8FA7C8' }}
                        >
                          {ancladoSinTomas ? 'S/D' : qEntrada > 0 ? `${efic.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                    </>
                  );
                })()}
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
            <div className={`sim-decision-panel ${decisionPanelPulse ? 'sim-decision-panel-pulse' : ''}`} ref={decisionPanelRef}>
              <div className="sim-decision-hdr">
                <span className="sim-decision-title">
                  <Zap size={11} /> Motor de decisión
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
