import { describe, it, expect } from 'vitest';
import {
  calculateFlowRate,
  calculateEfficiency,
  isCriticalLoss,
  getEfficiencyStatus,
  calculateSectionBalance,
  manningFlow,
  transitTimeMin,
  predictDeltaQ,
  getM1Factor,
  propagarQSifon,
  esSifon,
  calcQSobrepaso,
  WAVE_CELERITY_MS,
  F_ATEN_GT40,
} from './hydraulics';

describe('calculateFlowRate', () => {
  it('calcula Q = Cd * H^n', () => {
    expect(calculateFlowRate(1, 1.84, 1.5)).toBeCloseTo(1.84, 2);
  });

  it('retorna 0 para carga negativa (no invierte flujo)', () => {
    expect(calculateFlowRate(-0.5, 1.84, 1.5)).toBe(0);
  });
});

describe('calculateEfficiency', () => {
  it('calcula % de conducción', () => {
    expect(calculateEfficiency(100, 95)).toBe(95);
  });

  it('retorna 0 cuando no hay volumen de entrada (evita división por cero)', () => {
    expect(calculateEfficiency(0, 50)).toBe(0);
    expect(calculateEfficiency(-10, 50)).toBe(0);
  });
});

describe('isCriticalLoss', () => {
  it('marca pérdida crítica bajo 90% de eficiencia', () => {
    expect(isCriticalLoss(89.9)).toBe(true);
    expect(isCriticalLoss(90)).toBe(false);
  });
});

describe('getEfficiencyStatus — clasificación única de estado', () => {
  it('clasifica óptimo desde 95%', () => {
    expect(getEfficiencyStatus(95).nivel).toBe('optimo');
    expect(getEfficiencyStatus(100).nivel).toBe('optimo');
  });

  it('clasifica atención entre 90% y 95%', () => {
    expect(getEfficiencyStatus(90).nivel).toBe('atencion');
    expect(getEfficiencyStatus(94.9).nivel).toBe('atencion');
  });

  it('clasifica alerta roja entre 80% y 90% (directiva técnica)', () => {
    expect(getEfficiencyStatus(80).nivel).toBe('alerta');
    expect(getEfficiencyStatus(89.9).nivel).toBe('alerta');
  });

  it('clasifica crítico (fuga) bajo 80%', () => {
    expect(getEfficiencyStatus(79.9).nivel).toBe('critico');
    expect(getEfficiencyStatus(0).nivel).toBe('critico');
  });

  it('un dato anómalo siempre es alerta, sin importar el % — no es fuga real', () => {
    const status = getEfficiencyStatus(50, true);
    expect(status.nivel).toBe('alerta');
    expect(status.label).toBe('Dato Anómalo');
  });
});

describe('calculateSectionBalance — balance hidráulico de tramo', () => {
  it('calcula pérdidas cuando entrada > salida + tomas', () => {
    const balance = calculateSectionBalance('Tramo A', 0, 10, 10, 8, 1);
    expect(balance.q_perdidas).toBeCloseTo(1, 3);
    expect(balance.eficiencia).toBeCloseTo(90, 1);
    expect(balance.sinDato).toBe(false);
    expect(balance.anomalo).toBe(false);
  });

  it('marca sinDato cuando no hay entrada confiable (q_entrada <= 0)', () => {
    const balance = calculateSectionBalance('Tramo B', 0, 10, 0, 5, 2);
    expect(balance.sinDato).toBe(true);
    expect(balance.estado).toBe('sin_dato');
    expect(balance.q_perdidas).toBe(0);
  });

  it('marca anómalo cuando salida+tomas superan la entrada, sin reportar pérdidas negativas', () => {
    const balance = calculateSectionBalance('Tramo C', 0, 10, 5, 4, 3);
    expect(balance.anomalo).toBe(true);
    expect(balance.q_perdidas).toBe(0);
    // Eficiencia se limita a 100% — un excedente de medición no es "más eficiente que perfecto"
    expect(balance.eficiencia).toBeLessThanOrEqual(100);
  });

  it('nunca reporta pérdidas negativas cuando el balance es exacto', () => {
    const balance = calculateSectionBalance('Tramo D', 0, 10, 5, 5, 0);
    expect(balance.q_perdidas).toBe(0);
    expect(balance.eficiencia).toBe(100);
  });
});

describe('manningFlow — ecuación de Manning para sección trapezoidal', () => {
  it('calcula Q, V, A, P, R, T, Fr para una sección válida', () => {
    const r = manningFlow(2, 1.5, 1, 0.001, 0.015);
    expect(r.Q).toBeGreaterThan(0);
    expect(r.V).toBeGreaterThan(0);
    expect(r.A).toBeCloseTo((2 + 1.5 * 1) * 1, 3);
  });

  it('retorna todo en cero para tirante nulo o negativo (evita NaN/Infinity)', () => {
    const r = manningFlow(2, 1.5, 0, 0.001, 0.015);
    expect(r).toEqual({ Q: 0, V: 0, A: 0, P: 0, R: 0, T: 0, Fr: 0 });
  });

  it('retorna todo en cero para pendiente nula (evita división por cero en Sf)', () => {
    const r = manningFlow(2, 1.5, 1, 0, 0.015);
    expect(r).toEqual({ Q: 0, V: 0, A: 0, P: 0, R: 0, T: 0, Fr: 0 });
  });
});

describe('transitTimeMin — tiempo de tránsito de onda', () => {
  it('usa la celeridad calibrada BC-07 (0.80 m/s)', () => {
    const distM = 10_000; // 10 km
    const expectedMin = Math.round(distM / WAVE_CELERITY_MS / 60);
    expect(transitTimeMin(0, 10)).toBe(expectedMin);
  });

  it('es simétrico respecto a la dirección (usa distancia absoluta)', () => {
    expect(transitTimeMin(0, 10)).toBe(transitTimeMin(10, 0));
  });

  it('retorna 0 para el mismo punto', () => {
    expect(transitTimeMin(23, 23)).toBe(0);
  });
});

describe('predictDeltaQ — atenuación de onda BC-06', () => {
  it('no atenúa antes de K-23 (tramo presa→K-0, factor no calibrado ahí)', () => {
    expect(predictDeltaQ(10, 20)).toBe(10);
  });

  it('aplica el factor de atenuación 0.27 desde K-23 en adelante', () => {
    const result = predictDeltaQ(10, 54);
    expect(result).toBeCloseTo(10 * (1 - F_ATEN_GT40), 5);
  });

  it('el corte de atenuación es exactamente en km 23 (límite inclusivo)', () => {
    expect(predictDeltaQ(10, 23)).toBeCloseTo(10 * (1 - F_ATEN_GT40), 5);
  });
});

describe('getM1Factor — factor de corrección calibrado por punto', () => {
  it('encuentra el factor por coincidencia exacta de nombre', () => {
    expect(getM1Factor('K-0+000')).toBeCloseTo(1.2365, 4);
    expect(getM1Factor('K-104')).toBeCloseTo(0.7714, 4);
  });

  it('encuentra el factor por proximidad de km cuando no hay nombre exacto', () => {
    expect(getM1Factor(undefined, 34)).toBeCloseTo(1.5199, 4);
  });

  it('retorna 1.0 (neutro) cuando no hay coincidencia de nombre ni km cercano', () => {
    expect(getM1Factor('PUNTO-INEXISTENTE', 9999)).toBe(1.0);
  });
});

describe('propagarQSifon / esSifon — K-23 por propagación, no fórmula radial', () => {
  it('identifica K-23 como sifón', () => {
    expect(esSifon('K-23')).toBe(true);
    expect(esSifon('K-34')).toBe(false);
  });

  it('propaga Q desde K-0+000 restando el delta calibrado', () => {
    expect(propagarQSifon('K-23', 20)).toBeCloseTo(20 - 0.650, 3);
  });

  it('nunca retorna un caudal negativo por propagación', () => {
    expect(propagarQSifon('K-23', 0.1)).toBe(0);
  });
});

describe('calcQSobrepaso — vertedor de sobrepaso en K-68', () => {
  it('retorna 0 cuando el nivel no supera H_crit', () => {
    expect(calcQSobrepaso('K-68', 3.0)).toBe(0);
  });

  it('calcula caudal de sobrepaso cuando el nivel excede H_crit', () => {
    const q = calcQSobrepaso('K-68', 3.66); // 0.10 m sobre h_crit=3.56
    expect(q).toBeGreaterThan(0);
  });

  it('retorna 0 para puntos sin configuración de sobrepaso', () => {
    expect(calcQSobrepaso('K-34', 100)).toBe(0);
  });
});
