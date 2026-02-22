/**
 * Hydra Engine - Core Hydraulics Logic
 * Implements the "Hidro-Sincronía" directive.
 */

// Constants
export const GRAVITY = 9.81; // m/s^2

/**
 * Calculates flow rate (Q) for a Long-Throated Flume or Weir.
 * Formula: Q = Cd * H^n
 * 
 * @param head - H: Hydraulic head (meters)
 * @param coefficient - Cd: Discharge coefficient (specific to the structure)
 * @param exponent - n: Flow exponent (specific to the structure, usually ~1.5 - 2.5)
 * @returns Flow rate Q in m^3/s
 */
export const calculateFlowRate = (head: number, coefficient: number, exponent: number): number => {
  if (head < 0) return 0;
  const q = coefficient * Math.pow(head, exponent);
  return Number(q.toFixed(3)); // Precision to 3 decimal places
};

/**
 * Calculates Conduction Efficiency (Ec).
 * Formula: Ec = (V_net / V_gross) * 100
 * 
 * @param volumeIn - Volume entering the section (Gross)
 * @param volumeOut - Volume leaving the section / delivered (Net)
 * @returns Efficiency percentage (0-100)
 */
export const calculateEfficiency = (volumeIn: number, volumeOut: number): number => {
  if (volumeIn <= 0) return 0;
  const efficiency = (volumeOut / volumeIn) * 100;
  return Number(efficiency.toFixed(2));
};

/**
 * Validates if the input flow exceeds the Maximum Design Capacity.
 * "Validación de Negocio en Base de Datos" - Rule 2A.
 * 
 * @param flow - Current flow rate to validate
 * @param maxCapacity - Maximum design capacity of the canal section
 * @returns boolean - True if valid (within capacity), False if exceeds
 */
export const validateFlowCapacity = (flow: number, maxCapacity: number): boolean => {
  return flow <= maxCapacity;
};

/**
 * Determines if a section has a potential leak (efficiency drop).
 * Rule 2C: "Dashboard de Control de Pérdidas" - >10% difference
 * 
 * @param efficiency - Calculated efficiency percentage
 * @returns boolean - True if critical (efficiency < 90%)
 */
export const isCriticalLoss = (efficiency: number): boolean => {
  return efficiency < 90.0;
};
