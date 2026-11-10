import type { TramoGeom } from '../modelingTypes';
import { PLANTILLA, TALUD_Z, MANNING_N, S0_CANAL, FREEBOARD } from '../modelingTypes';

// ── CONSTANTES HIDRÁULICAS ──────────────────────────────────────────────
export const G         = 9.81;

export const RIVER_KM  = 36;

// LÍMITES OPERATIVOS DE ESCALA (nivel del agua en metros)
// Cada sección del canal puede tener límites diferentes según su función.
// K-0 a K-80: [2.80, 3.50] — tomas laterales necesitan carga mínima de 2.80m para servicio.
// K-104 (cola): [2.40, 2.55] — final del canal, opera con tirante menor sin tomas críticas.
export function getOpLimits(km: number): { yMin: number; yMax: number } {
  if (km >= 100) return { yMin: 2.40, yMax: 2.55 };  // K-104 final del canal
  return { yMin: 2.80, yMax: 3.50 };                  // Red general
}

export type EventType   = 'INCREMENTO' | 'DECREMENTO' | 'CORTE' | 'LLENADO';

export type CPStatus    = 'ESTABLE' | 'ALERTA' | 'CRITICO';

export type RemansoType = 'M1' | 'M2' | 'NORMAL';

export interface CPResult {
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
  // Fuente del ancla: 'AFORO' = gasto_calculado_m3s de SICA, 'ORIFICIO' = cálculo Cd·A·√(2g·H)
  gate_source:  'AFORO' | 'ORIFICIO' | null;
  // Propagación temporal del frente de onda
  wave_pct:        number;
  wave_arrived:    boolean;
  maniobra_time:   string;
  // Evaluación de restricción de nivel para este tramo (null si no aplica restricción)
  evaluacion_nivel: EvaluacionNivelTramo | null;
}

// Campos sobreescribibles en el panel de condicionantes (sesión-only, no persisten en BD)
export type RestriccionOverrideMap = Partial<Pick<
  RestriccionNivelTramo,
  'nivel_max_permitido_m' | 'nivel_min_deseable_m' | 'tipo_limite_max' | 'tolerancia_transitoria_m'
>>;

// ── RESTRICCIONES DE NIVEL POR TRAMO ─────────────────────────────────────
export type TipoLimite       = 'duro' | 'blando';

type CriterioOperativo =
  | 'seguridad_infraestructura'
  | 'bordo_libre'
  | 'operacion_tomas'
  | 'control_remanso'
  | 'transicion'
  | 'sifon'
  | 'criterio_local';

type EstadoOperacionTramo =
  | 'operacion_aceptable'
  | 'alerta_operativa'
  | 'riesgo_insuficiencia_operativa'
  | 'requiere_maniobra_preventiva';

export interface RestriccionNivelTramo {
  tramo_id:                string;
  km_inicio:               number;
  km_fin:                  number;
  nivel_max_permitido_m:   number;
  nivel_min_deseable_m?:   number | null;
  tipo_limite_max:         TipoLimite;
  tolerancia_transitoria_m?: number | null;
  criterio_operativo:      CriterioOperativo;
  observaciones?:          string;
}

interface EvaluacionNivelTramo {
  tramo_id:             string;
  nivel_proyectado_m:   number;
  estado:               EstadoOperacionTramo;
  exceso_sobre_max_m:   number;
  deficit_bajo_min_m:   number;
  nivel_max_m:          number;
  nivel_min_m:          number | null;
  mensaje:              string;
}

// ── CONFIGURACIÓN DE RESTRICCIONES DE NIVEL ──────────────────────────────
// Fuente primaria: definición operativa por criterio hidráulico y de infraestructura.
// Futura extensión: cargar desde tabla `restricciones_nivel_tramos` en Supabase.
export const RESTRICCIONES_NIVEL: RestriccionNivelTramo[] = [
  {
    tramo_id: 'K-0+000',   km_inicio: 0.000,   km_fin: 0.000,
    nivel_max_permitido_m: 3.50, nivel_min_deseable_m: 2.80,
    tipo_limite_max: 'duro',  tolerancia_transitoria_m: 0.00,
    criterio_operativo: 'seguridad_infraestructura',
    observaciones: 'Compuerta de cabeza — bordo libre máximo 3.50 m',
  },
  {
    tramo_id: 'K-23',      km_inicio: 23.000,  km_fin: 23.000,
    nivel_max_permitido_m: 3.50, nivel_min_deseable_m: 3.20,
    tipo_limite_max: 'duro',  tolerancia_transitoria_m: 0.00,
    criterio_operativo: 'seguridad_infraestructura',
    observaciones: 'No rebasar 3.50 m por criterio de bordo libre operativo',
  },
  {
    tramo_id: 'K-29',      km_inicio: 29.000,  km_fin: 29.000,
    nivel_max_permitido_m: 3.45, nivel_min_deseable_m: 3.10,
    tipo_limite_max: 'blando', tolerancia_transitoria_m: 0.03,
    criterio_operativo: 'control_remanso',
    observaciones: 'Tramo intermedio SEC-001',
  },
  {
    tramo_id: 'K-34',      km_inicio: 34.000,  km_fin: 34.000,
    nivel_max_permitido_m: 3.45, nivel_min_deseable_m: 3.10,
    tipo_limite_max: 'blando', tolerancia_transitoria_m: 0.03,
    criterio_operativo: 'control_remanso',
    observaciones: 'Se acepta pequeña sobre elevación transitoria',
  },
  {
    tramo_id: 'K-44',      km_inicio: 44.000,  km_fin: 44.000,
    nivel_max_permitido_m: 3.40, nivel_min_deseable_m: 3.00,
    tipo_limite_max: 'blando', tolerancia_transitoria_m: 0.03,
    criterio_operativo: 'operacion_tomas',
    observaciones: 'Final SEC-001 — tomas laterales activas',
  },
  {
    tramo_id: 'K-54',      km_inicio: 54.000,  km_fin: 54.000,
    nivel_max_permitido_m: 3.35, nivel_min_deseable_m: 2.95,
    tipo_limite_max: 'blando', tolerancia_transitoria_m: 0.03,
    criterio_operativo: 'operacion_tomas',
    observaciones: 'Inicio SEC-002',
  },
  {
    tramo_id: 'K-62',      km_inicio: 62.000,  km_fin: 62.000,
    nivel_max_permitido_m: 3.30, nivel_min_deseable_m: 2.90,
    tipo_limite_max: 'blando', tolerancia_transitoria_m: 0.03,
    criterio_operativo: 'control_remanso',
    observaciones: 'SEC-003 — zona de transición hidráulica',
  },
  {
    tramo_id: 'K-64',      km_inicio: 64.000,  km_fin: 64.000,
    nivel_max_permitido_m: 3.30, nivel_min_deseable_m: 2.90,
    tipo_limite_max: 'blando', tolerancia_transitoria_m: 0.03,
    criterio_operativo: 'control_remanso',
    observaciones: 'Final SEC-002',
  },
  {
    tramo_id: 'K-68',      km_inicio: 68.000,  km_fin: 68.000,
    nivel_max_permitido_m: 3.25, nivel_min_deseable_m: 2.85,
    tipo_limite_max: 'blando', tolerancia_transitoria_m: 0.03,
    criterio_operativo: 'control_remanso',
    observaciones: 'Aguas arriba del sifón K-68+720 — vigilar nivel máximo',
  },
  {
    tramo_id: 'K-79+025',  km_inicio: 79.025,  km_fin: 79.025,
    nivel_max_permitido_m: 3.20, nivel_min_deseable_m: 2.80,
    tipo_limite_max: 'blando', tolerancia_transitoria_m: 0.02,
    criterio_operativo: 'operacion_tomas',
    observaciones: 'Inicio SEC-004',
  },
  {
    tramo_id: 'K-87+549',  km_inicio: 87.549,  km_fin: 87.549,
    nivel_max_permitido_m: 3.10, nivel_min_deseable_m: 2.70,
    tipo_limite_max: 'blando', tolerancia_transitoria_m: 0.02,
    criterio_operativo: 'operacion_tomas',
    observaciones: 'Tramo medio SEC-004',
  },
  {
    tramo_id: 'K-94+057',  km_inicio: 94.057,  km_fin: 94.057,
    nivel_max_permitido_m: 3.00, nivel_min_deseable_m: 2.60,
    tipo_limite_max: 'blando', tolerancia_transitoria_m: 0.02,
    criterio_operativo: 'operacion_tomas',
    observaciones: 'SEC-004 — tramo final antes de K-104',
  },
  {
    tramo_id: 'K-94+200',  km_inicio: 94.200,  km_fin: 94.200,
    nivel_max_permitido_m: 3.00, nivel_min_deseable_m: 2.60,
    tipo_limite_max: 'blando', tolerancia_transitoria_m: 0.02,
    criterio_operativo: 'operacion_tomas',
    observaciones: 'SEC-004 — paralela a K-94+057',
  },
  {
    tramo_id: 'K-104',     km_inicio: 104.000, km_fin: 104.000,
    nivel_max_permitido_m: 2.55, nivel_min_deseable_m: 2.40,
    tipo_limite_max: 'duro',  tolerancia_transitoria_m: 0.00,
    criterio_operativo: 'seguridad_infraestructura',
    observaciones: 'Nivel final de control — cola del canal',
  },
];

/** Devuelve la restricción de nivel activa para un km dado.
 *  Primero busca rangos (km_inicio < km_fin — sifón); luego coincidencia puntual (±1 km).
 *  Acepta una lista explícita para soportar overrides temporales de simulación. */
export function findRestriccion(
  km: number,
  lista: RestriccionNivelTramo[] = RESTRICCIONES_NIVEL,
): RestriccionNivelTramo | undefined {
  const rangeMatch = lista.find(
    r => r.km_fin > r.km_inicio && km >= r.km_inicio && km <= r.km_fin,
  );
  if (rangeMatch) return rangeMatch;
  // Closest-match within ±1 km — needed when two escalas are <1 km apart (K-94+057 / K-94+200)
  let best: RestriccionNivelTramo | undefined;
  let bestDist = 1.0;
  for (const r of lista) {
    const dist = Math.abs(km - r.km_inicio);
    if (dist < bestDist) { bestDist = dist; best = r; }
  }
  return best;
}

/** Evalúa el nivel proyectado contra la restricción del tramo.
 *  Implementa las 5 reglas de decisión del sistema de condicionantes. */
export function evaluarRestriccionNivelTramo(
  restriccion: RestriccionNivelTramo,
  nivelProyectadoM: number,
): EvaluacionNivelTramo {
  const tolerancia = restriccion.tipo_limite_max === 'blando'
    ? (restriccion.tolerancia_transitoria_m ?? 0)
    : 0;
  const max    = restriccion.nivel_max_permitido_m;
  const min    = restriccion.nivel_min_deseable_m ?? null;
  const exceso = Math.max(0, nivelProyectadoM - max);
  const deficit = min !== null ? Math.max(0, min - nivelProyectadoM) : 0;
  const base    = { tramo_id: restriccion.tramo_id, nivel_proyectado_m: nivelProyectadoM,
                    exceso_sobre_max_m: exceso, deficit_bajo_min_m: deficit,
                    nivel_max_m: max, nivel_min_m: min };

  // Regla 1: límite DURO superado
  if (restriccion.tipo_limite_max === 'duro' && nivelProyectadoM > max) {
    return { ...base, estado: 'requiere_maniobra_preventiva',
      mensaje: `${restriccion.tramo_id} rebasa límite duro (${max.toFixed(2)} m). `
             + `Exceso: +${exceso.toFixed(3)} m — maniobra preventiva requerida.` };
  }
  // Regla 2: límite BLANDO superado pero dentro de tolerancia
  if (restriccion.tipo_limite_max === 'blando' && nivelProyectadoM > max && nivelProyectadoM <= max + tolerancia) {
    return { ...base, estado: 'alerta_operativa',
      mensaje: `${restriccion.tramo_id} supera máximo blando (${max.toFixed(2)} m) `
             + `dentro de tolerancia (±${tolerancia.toFixed(2)} m). Monitoreo intensivo.` };
  }
  // Regla 3: límite BLANDO + tolerancia superados
  if (restriccion.tipo_limite_max === 'blando' && nivelProyectadoM > max + tolerancia) {
    return { ...base, estado: 'requiere_maniobra_preventiva',
      mensaje: `${restriccion.tramo_id} supera máximo más tolerancia `
             + `(${(max + tolerancia).toFixed(2)} m). Maniobra preventiva requerida.` };
  }
  // Regla 4: por debajo del mínimo deseable
  if (min !== null && nivelProyectadoM < min) {
    return { ...base, estado: 'riesgo_insuficiencia_operativa',
      mensaje: `${restriccion.tramo_id} bajo nivel mínimo deseable (${min.toFixed(2)} m). `
             + `Déficit: −${deficit.toFixed(3)} m — riesgo de insuficiencia en tomas.` };
  }
  // Regla 5: dentro del rango permitido
  return { ...base, estado: 'operacion_aceptable',
    mensaje: `${restriccion.tramo_id} opera dentro del rango permitido `
           + `[${(min ?? 0).toFixed(2)}–${max.toFixed(2)} m].` };
}

/** Devuelve la geometría del tramo que contiene el km dado.
 *  Si no hay dato para ese km usa los fallbacks globales. */
export function findTramo(km: number, tramos: TramoGeom[]): TramoGeom {
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
export function normalDepth(Q: number, S = S0_CANAL, b = PLANTILLA, z = TALUD_Z, n = MANNING_N): number {
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
export function criticalDepth(Q: number, b = PLANTILLA, z = TALUD_Z): number {
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

export function waveCelerity(y: number, b = PLANTILLA, z = TALUD_Z): number {
  const A = (b + z * y) * y;
  const T = b + 2 * z * y;
  return Math.sqrt(G * A / T);
}

export function fmtTime(baseMin: number, addMin: number): string {
  const t = (baseMin + addMin) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}

export function transitLabel(min: number): string {
  if (min < 1) return 'Inmediatamente';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h === 0 ? `${m} min` : `${h}h ${m < 10 ? '0' : ''}${m}min`;
}

export function deltaLabel(dy: number): string {
  const cm = Math.abs((dy ?? 0) * 100);
  if (cm < 1.5) return 'Sin cambio';
  return `${(dy ?? 0) > 0 ? 'Sube' : 'Baja'} ${cm.toFixed(0)} cm`;
}

/** Estado que se muestra en la tarjeta. En vaciado/sin entrada, estar bajo el mínimo deseable de servicio
 *  es lo esperado: se rotula "BAJO MÍN." en tono neutro en vez de ALERTA ámbar (que implicaría un riesgo real). */
export type EstadoVista = CPStatus | 'BAJO_MIN';

export function estadoVistaCP(r: CPResult | undefined, suspendidas: boolean): EstadoVista {
  if (!r) return 'ESTABLE';
  const soloMinimo = r.status === 'ALERTA'
    && r.evaluacion_nivel?.estado === 'riesgo_insuficiencia_operativa'
    && Math.abs(r.delta_y) <= 0.5 && r.bordo_libre_pct <= 92;
  return suspendidas && soloMinimo ? 'BAJO_MIN' : r.status;
}

export function colorEstadoVista(e: EstadoVista): string { return e === 'BAJO_MIN' ? '#94a3b8' : statusColor(e); }

export const TXT_ESTADO: Record<EstadoVista, string> = { CRITICO: 'CRÍTICO', ALERTA: 'ALERTA', ESTABLE: 'ESTABLE', BAJO_MIN: 'BAJO MÍN.' };

export function statusColor(s: CPStatus): string {
  return s === 'CRITICO' ? '#ef4444' : s === 'ALERTA' ? '#f59e0b' : '#10b981';
}
