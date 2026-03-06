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
  const qPerdidas = Math.max(0, qEntrada - qSalida - qTomas);
  const qContabilizado = qSalida + qTomas;
  const eficiencia = qEntrada > 0 ? (qContabilizado / qEntrada) * 100 : 100;

  let estado: BalanceTramo['estado'] = 'optimo';
  if (eficiencia < 80) estado = 'critico';
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
