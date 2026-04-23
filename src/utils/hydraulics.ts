/**
 * Hydra Engine - Core Hydraulics Logic
 * Implements the "Hidro-Sincronía" directive.
 * 
 * v2.0 — Extended with:
 *  - Section Balance (Entrada-Salida-Tomas-Pérdidas)
 *  - Manning Equation
 *  - Canal Profile integration
 */

// Constants
export const GRAVITY = 9.81; // m/s^2
export const MANNING_DEFAULT_N = 0.015; // Roughness for concrete-lined canals

// ─── Interfaces ────────────────────────────────────

export interface PerfilTramo {
  km_inicio: number;
  km_fin: number;
  nombre_tramo: string;
  plantilla_m: number;
  talud_z: number;
  rugosidad_n: number;
  pendiente_s0: number;
  tirante_diseno_m: number;
  capacidad_diseno_m3s: number;
  velocidad_diseno_ms: number;
  bordo_libre_m: number;
  ancho_corona_m: number;
}

export interface BalanceTramo {
  seccion_nombre: string;
  km_inicio: number;
  km_fin: number;
  q_entrada: number;       // m³/s
  q_salida: number;        // m³/s
  q_tomas: number;         // Sum of tomas in between
  q_perdidas: number;      // Unaccounted losses
  eficiencia: number;      // %
  estado: 'optimo' | 'atencion' | 'alerta' | 'critico';
  perfil?: PerfilTramo;    // Canal design data
}

// ─── Core Functions ────────────────────────────────

/**
 * Calculates flow rate (Q) for a Long-Throated Flume or Weir.
 * Formula: Q = Cd * H^n
 */
export const calculateFlowRate = (head: number, coefficient: number, exponent: number): number => {
  if (head < 0) return 0;
  const q = coefficient * Math.pow(head, exponent);
  return Number(q.toFixed(3));
};

/**
 * Calculates Conduction Efficiency (Ec).
 * Formula: Ec = (V_net / V_gross) * 100
 */
export const calculateEfficiency = (volumeIn: number, volumeOut: number): number => {
  if (volumeIn <= 0) return 0;
  const efficiency = (volumeOut / volumeIn) * 100;
  return Number(efficiency.toFixed(2));
};

/**
 * Validates if the input flow exceeds the Maximum Design Capacity.
 */
export const validateFlowCapacity = (flow: number, maxCapacity: number): boolean => {
  return flow <= maxCapacity;
};

/**
 * Determines if a section has a potential leak (efficiency drop > 10%).
 */
export const isCriticalLoss = (efficiency: number): boolean => {
  return efficiency < 90.0;
};

// ─── NEW: Balance & Modeling Functions ────────────

/**
 * Calculates the hydraulic balance for a canal section.
 * Q_entrada = Q_salida + Q_tomas + Q_pérdidas
 * 
 * @returns BalanceTramo with efficiency and operational state
 */
export const calculateSectionBalance = (
  seccionNombre: string,
  kmInicio: number,
  kmFin: number,
  qEntrada: number,
  qSalida: number,
  qTomas: number,
  perfil?: PerfilTramo
): BalanceTramo => {
  const qContabilizado = qSalida + qTomas;
  // Anómalo: más salidas que entradas (error de medición o aportación lateral)
  const isAnomalous = qContabilizado > qEntrada && qEntrada > 0;
  const qPerdidas = isAnomalous ? 0 : Math.max(0, qEntrada - qContabilizado);
  const eficienciaRaw = qEntrada > 0 ? (qContabilizado / qEntrada) * 100 : 0;
  // Limitar a 100% — valores > 100% indican anomalía de medición, no ganancia real
  const eficiencia = Math.min(100, eficienciaRaw);

  let estado: BalanceTramo['estado'] = 'optimo';
  if (isAnomalous) estado = 'alerta'; // Marcar tramos con datos anómalos
  else if (eficiencia < 80) estado = 'critico';
  else if (eficiencia < 90) estado = 'alerta';
  else if (eficiencia < 95) estado = 'atencion';

  return {
    seccion_nombre: seccionNombre,
    km_inicio: kmInicio,
    km_fin: kmFin,
    q_entrada: qEntrada,
    q_salida: qSalida,
    q_tomas: qTomas,
    q_perdidas: Number(qPerdidas.toFixed(3)),
    eficiencia: Number(eficiencia.toFixed(2)),
    estado,
    perfil
  };
};

/**
 * Manning Equation for trapezoidal channels.
 * Q = (1/n) * A * R^(2/3) * S^(1/2)
 * 
 * Where for trapezoidal section:
 *   A = (b + z*y) * y
 *   P = b + 2*y*√(1 + z²)
 *   R = A / P
 */
export const manningFlow = (
  b: number,    // Bottom width (plantilla)
  z: number,    // Side slope (talud)
  y: number,    // Water depth (tirante)
  S: number,    // Bed slope (pendiente)
  n: number = MANNING_DEFAULT_N
): { Q: number; V: number; A: number; P: number; R: number; T: number; Fr: number } => {
  if (y <= 0 || b <= 0 || S <= 0) {
    return { Q: 0, V: 0, A: 0, P: 0, R: 0, T: 0, Fr: 0 };
  }

  const A = (b + z * y) * y;                          // Area hidráulica
  const P = b + 2 * y * Math.sqrt(1 + z * z);         // Perímetro mojado
  const R = A / P;                                      // Radio hidráulico
  const T = b + 2 * z * y;                             // Espejo de agua
  const V = (1 / n) * Math.pow(R, 2 / 3) * Math.pow(S, 0.5); // Velocidad
  const Q = A * V;                                      // Gasto
  const Fr = V / Math.sqrt(GRAVITY * (A / T));          // Froude

  return {
    Q: Number(Q.toFixed(3)),
    V: Number(V.toFixed(3)),
    A: Number(A.toFixed(3)),
    P: Number(P.toFixed(3)),
    R: Number(R.toFixed(4)),
    T: Number(T.toFixed(3)),
    Fr: Number(Fr.toFixed(4))
  };
};

/**
 * Validates an aforo measurement against design parameters.
 * Returns an array of validation warnings.
 */
export const validateAforoVsDesign = (
  gastoMedido: number,
  velocidadMedida: number,
  tiranteMedido: number,
  perfil: PerfilTramo
): { tipo: 'exceso' | 'velocidad' | 'tirante' | 'info'; mensaje: string }[] => {
  const warnings: { tipo: 'exceso' | 'velocidad' | 'tirante' | 'info'; mensaje: string }[] = [];

  // 1. Gasto vs Capacidad
  if (gastoMedido > perfil.capacidad_diseno_m3s) {
    warnings.push({
      tipo: 'exceso',
      mensaje: `Q medido (${gastoMedido.toFixed(2)} m³/s) EXCEDE capacidad de diseño (${perfil.capacidad_diseno_m3s.toFixed(2)} m³/s).`
    });
  }

  // 2. Velocidad real vs diseño (±30%)
  if (perfil.velocidad_diseno_ms > 0) {
    const ratio = velocidadMedida / perfil.velocidad_diseno_ms;
    if (ratio > 1.3) {
      warnings.push({
        tipo: 'velocidad',
        mensaje: `Velocidad (${velocidadMedida.toFixed(2)} m/s) un ${((ratio - 1) * 100).toFixed(0)}% superior al diseño. Riesgo de erosión.`
      });
    } else if (ratio < 0.5 && velocidadMedida > 0) {
      warnings.push({
        tipo: 'velocidad',
        mensaje: `Velocidad (${velocidadMedida.toFixed(2)} m/s) muy baja vs diseño (${perfil.velocidad_diseno_ms.toFixed(2)}). Posible sedimentación.`
      });
    }
  }

  // 3. Tirante vs bordo libre
  if (perfil.tirante_diseno_m > 0 && perfil.bordo_libre_m > 0) {
    const tiranteMaxSeguro = perfil.tirante_diseno_m + (perfil.bordo_libre_m * 0.5);
    if (tiranteMedido > tiranteMaxSeguro) {
      warnings.push({
        tipo: 'tirante',
        mensaje: `¡PELIGRO! Tirante (${tiranteMedido.toFixed(2)}m) invade el bordo libre (diseño: ${perfil.tirante_diseno_m.toFixed(2)}m + BL: ${perfil.bordo_libre_m.toFixed(2)}m).`
      });
    }
  }

  // 4. Informativa: Manning teórico
  const manning = manningFlow(perfil.plantilla_m, perfil.talud_z, tiranteMedido, perfil.pendiente_s0, perfil.rugosidad_n);
  if (manning.Q > 0) {
    const diff = Math.abs(gastoMedido - manning.Q);
    const pctDiff = (diff / manning.Q) * 100;
    if (pctDiff > 15) {
      warnings.push({
        tipo: 'info',
        mensaje: `Manning teórico: ${manning.Q.toFixed(2)} m³/s (diferencia ${pctDiff.toFixed(0)}% vs medido). Revisar calibración o rugosidad.`
      });
    }
  }

  return warnings;
};

/**
 * Gets operational status color/label based on efficiency.
 */
export const getEfficiencyStatus = (eficiencia: number): { color: string; label: string; bg: string } => {
  if (eficiencia >= 95) return { color: '#10b981', label: 'Óptimo', bg: 'rgba(16, 185, 129, 0.1)' };
  if (eficiencia >= 90) return { color: '#f59e0b', label: 'Atención', bg: 'rgba(245, 158, 11, 0.1)' };
  // A partir de 10% de pérdidas (eficiencia < 90%), se considera alerta crítica (Rojo) por directiva técnica.
  if (eficiencia >= 85) return { color: '#ef4444', label: 'Alerta Roja', bg: 'rgba(239, 68, 68, 0.1)' };
  return { color: '#991b1b', label: 'Crítico (Fuga)', bg: 'rgba(153, 27, 27, 0.1)' };
};

/**
 * Standard Step Method (Paso Estándar) for Gradually Varied Flow.
 * Solves the energy equation between two sections (dx from 1 to 2).
 * Note: For subcritical flow, we usually compute from downstream to upstream (negative dx).
 */
export const calculateStandardStep = (
  y1: number,
  Q: number,
  dx: number,
  b: number,
  z: number,
  n: number,
  S0: number
): number => {
  const g = GRAVITY;
  const alpha = 1.0; 

  const getE = (y: number): number => {
    if (y <= 0) return 0;
    const A = (b + z * y) * y;
    const v = Q / A;
    return y + (alpha * Math.pow(v, 2)) / (2 * g);
  };

  const getSf = (y: number): number => {
    if (y <= 0) return 1e-10;
    const A = (b + z * y) * y;
    const P = b + 2 * y * Math.sqrt(1 + z * z);
    const R = A / P;
    return Math.pow((Q * n) / (A * Math.pow(R, 2/3)), 2);
  };

  const E1 = getE(y1);
  const Sf1 = getSf(y1);

  let y2 = y1;
  const maxIter = 15;
  const tolerance = 0.001;

  for (let i = 0; i < maxIter; i++) {
    const E2 = getE(y2);
    const Sf2 = getSf(y2);
    // f(y2) = E2 - E1 + (Sf_avg - S0) * dx = 0 
    // where dx is positive going downstream.
    const f = E2 - E1 + ((Sf1 + Sf2) / 2 - S0) * dx;
    
    // Simple numerical derivative
    const dy = 0.001;
    const Sf_plus = getSf(y2 + dy);
    const f_plus = getE(y2 + dy) - E1 + ((Sf1 + Sf_plus) / 2 - S0) * dx;
    const df = (f_plus - f) / dy;

    if (Math.abs(df) < 1e-8) break;
    const step = f / df;
    y2 = y2 - step;

    if (Math.abs(step) < tolerance) break;
    if (y2 < 0.05) { y2 = 0.05; break; }
    if (y2 > 10) { y2 = 10; break; }
  }

  return Number(y2.toFixed(3));
};

/**
 * Calculates Normal Depth (yn) using Manning Equation for trapezoidal sections.
 * Uses iterative method (Maning: Q = (1/n) * A * R^(2/3) * S^(1/2))
 */
export const calculateNormalDepth = (
  Q: number,
  b: number,
  z: number,
  n: number,
  S0: number
): number => {
  if (Q <= 0 || b <= 0 || S0 <= 0) return 0;
  
  let y = Math.pow((Q * n) / (b * Math.sqrt(S0)), 0.6); // Initial guess
  const maxIter = 20;
  
  for (let i = 0; i < maxIter; i++) {
    const A = (b + z * y) * y;
    const P = b + 2 * y * Math.sqrt(1 + z * z);
    const R = A / P;
    const Q_calc = (1 / n) * A * Math.pow(R, 2/3) * Math.sqrt(S0);
    
    // Newton-Raphson-like step
    const f = Q_calc - Q;
    const dy = 0.001;
    const A_plus = (b + z * (y + dy)) * (y + dy);
    const P_plus = b + 2 * (y + dy) * Math.sqrt(1 + z * z);
    const R_plus = A_plus / P_plus;
    const Q_plus = (1 / n) * A_plus * Math.pow(R_plus, 2/3) * Math.sqrt(S0);
    const df = (Q_plus - Q_calc) / dy;
    
    const step = f / df;
    y = y - step;
    if (Math.abs(step) < 0.001) break;
    if (y < 0.01) { y = 0.01; break; }
  }
  
  return Number(y.toFixed(3));
};

// ─── Radial Gate Flow (M1-calibrated) ─────────────────────────────────────

const RADIAL_Cd  = 0.62;
const RADIAL_Cv  = 1.84;
const RADIAL_g   = 9.81;
const RADIAL_MIN = 0.01;

/** M1 correction factors calibrated 23/04/2026 via mass balance. */
export const M1_FACTORS: Record<string, number> = {
    'K-23':     2.0978,
    'K-29':     1.3589,
    'K-34':     1.3821,
    'K-44':     0.9838,
    'K-54':     1.0823,
    'K-62':     1.1294,
    'K-64':     1.3305,
    'K-68':     1.1112,
    'K-79+025': 2.8549,
    'K-87+549': 1.2530,
    'K-94+057': 1.1883,
    'K-94+200': 1.2851,
    'K-104':    0.7714,
};

const _M1_KM: Record<string, number> = {
    'K-23': 23, 'K-29': 29, 'K-34': 34, 'K-44': 44, 'K-54': 54,
    'K-62': 62, 'K-64': 64, 'K-68': 68, 'K-79+025': 79.025,
    'K-87+549': 87.549, 'K-94+057': 94.057, 'K-94+200': 94.2, 'K-104': 104,
};

export function getM1Factor(nombre?: string, km?: number): number {
    if (nombre) {
        const key = nombre.trim().toUpperCase();
        for (const [k, v] of Object.entries(M1_FACTORS)) {
            if (k.toUpperCase() === key) return v;
        }
        for (const [k, v] of Object.entries(M1_FACTORS)) {
            if (key.includes(k.toUpperCase()) || k.toUpperCase().includes(key)) return v;
        }
    }
    if (km !== undefined && km !== null) {
        let bestName = '';
        let bestDist = 2.0;
        for (const [name, nomKm] of Object.entries(_M1_KM)) {
            const dist = Math.abs(km - nomKm);
            if (dist < bestDist) { bestDist = dist; bestName = name; }
        }
        if (bestName) return M1_FACTORS[bestName];
    }
    return 1.0;
}

/**
 * Recalculates gate flow from raw reading data using M1-calibrated factors.
 * Mirrors sica-capture/src/lib/hydraulicCalculations.ts calculateFlow().
 *
 * @param hArriba      - Upstream level (m)
 * @param hAbajo       - Downstream level (m)
 * @param radialesJson - JSON array from DB: [{index, apertura_m}, ...]
 * @param anchoRadial  - Gate width (m) — esc.ancho
 * @param pzasRadiales - Gate count — esc.pzas_radiales
 * @param nombre       - Checkpoint name for M1 lookup (e.g. "K-29")
 * @param km           - Kilometre position as fallback for M1 lookup
 */
export function calcRadialFlow(
    hArriba: number,
    hAbajo: number,
    radialesJson: any,
    anchoRadial: number,
    pzasRadiales: number,
    nombre?: string,
    km?: number
): number {
    if (!anchoRadial || !pzasRadiales || pzasRadiales <= 0 || hArriba <= 0) {
        // Garganta larga fallback
        return hArriba > 0 ? 1.84 * Math.pow(hArriba, 1.52) : 0;
    }

    let aperturas: number[] = [];
    if (Array.isArray(radialesJson)) {
        // [{index: 0, apertura_m: 0.5}, ...]
        aperturas = Array.from({ length: pzasRadiales }, (_, i) => {
            const gate = radialesJson.find((g: any) => g.index === i || g.index === i + 1);
            return gate ? (gate.apertura_m || 0) : 0;
        });
    }
    if (aperturas.length === 0) aperturas = Array(pzasRadiales).fill(0);

    const fcm1 = getM1Factor(nombre, km);
    const carga = Math.max(0, hArriba - hAbajo);
    let q_total = 0;

    for (let i = 0; i < pzasRadiales; i++) {
        const ap = aperturas[i] || 0;
        if (ap > 0 && hArriba > RADIAL_MIN) {
            const area = anchoRadial * ap;
            // Opción A: if Δh ≤ 0 (backwater, h_abajo ≥ h_arriba) use h_arriba as absolute head
            const cargaEfectiva = carga > RADIAL_MIN ? carga : hArriba;
            if (ap < hArriba) {
                q_total += RADIAL_Cd * area * Math.sqrt(2 * RADIAL_g * cargaEfectiva) * fcm1;
            } else {
                q_total += RADIAL_Cv * anchoRadial * Math.pow(cargaEfectiva, 1.5) * fcm1;
            }
        }
    }

    return q_total;
}
