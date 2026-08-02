// Tipos y constantes compartidos entre ModelingDashboard.tsx y
// useModelingTelemetry.ts — extraídos para no mezclar exports de utilidades
// con el export de componente en un archivo de página (rompe Fast Refresh).

// ── CONSTANTES HIDRÁULICAS ──────────────────────────────────────────────
export const MANNING_N = 0.015;
export const PLANTILLA = 20;       // m — plantilla Canal Principal Conchos
export const TALUD_Z   = 1.5;
export const FREEBOARD = 3.2;      // m — bordo libre operativo
export const CD_GATE   = 0.70;
export const S0_CANAL  = 0.00016;

export const DEFAULT_CPS = [
  { id: 'k0',   nombre: 'K-0  Inicio Canal',  km: 0,   pzas_radiales: 4, ancho: 12 },
  { id: 'k23',  nombre: 'K-23 Derivadora',    km: 23,  pzas_radiales: 3, ancho: 10 },
  { id: 'k34',  nombre: 'K-34 Compuerta',     km: 34,  pzas_radiales: 3, ancho: 10 },
  { id: 'k57',  nombre: 'K-57 Sección S3',    km: 57,  pzas_radiales: 2, ancho: 8  },
  { id: 'k80',  nombre: 'K-80 Sección S4',    km: 80,  pzas_radiales: 2, ancho: 8  },
  { id: 'k104', nombre: 'K-104 Final Canal',  km: 104, pzas_radiales: 1, ancho: 6  },
];

// Convierte cualquier valor a número seguro. Si es null/undefined/"NaN"/Infinity
// devuelve el fallback para que nunca llegue un NaN al motor hidráulico ni a la UI.
export function safeFloat(val: unknown, fallback = 0): number {
  const n = typeof val === 'number' ? val : parseFloat(String(val ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

export interface ControlPoint {
  id: string; nombre: string; km: number;
  pzas_radiales: number; ancho: number;
  coeficiente_descarga?: number;  // Cd real por escala (de tabla escalas)
  nivel_max_op?: number;           // Nivel máximo operativo
}

// Datos de telemetría base por punto de control (de SICA Capture)
export interface CPTelemetry {
  delta_12h:    number;
  lectura_am:   number | null;
  lectura_pm:   number | null;
  hora_am:      string | null;
  hora_pm:      string | null;
  gasto_medido: number | null;
  apertura_real: number | null;   // apertura_radiales_m de lecturas_escalas
}

// Punto de entrega activo con volumen del día (de reportes_diarios + puntos_entrega)
export interface DeliveryData {
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
export interface DataStatus {
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
export interface BalanceTramo {
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
export interface TramoGeom {
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
