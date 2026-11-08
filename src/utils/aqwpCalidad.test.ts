import { describe, it, expect } from 'vitest';
import { filtrarAtipicos, atrasoDias, estadoFrescura, balanceAlerta, type PuntoDia } from './aqwpCalidad';

const p = (fecha: string, valor: number | null): PuntoDia => ({ fecha, valor });
const serie = (inicio: string, vals: (number | null)[]): PuntoDia[] =>
  vals.map((v, i) => p(new Date(Date.parse(`${inicio}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), v));

describe('filtrarAtipicos · casos REALES de la base', () => {
  it('Madero 2026-04-06: 319.5 entre 229.3 y 228.8 → pico aislado', () => {
    const s = [p('2026-04-03', 229.343), p('2026-04-06', 319.462), p('2026-04-07', 228.808)];
    const r = filtrarAtipicos(s, 333.318);
    expect(r.descartadas).toHaveLength(1);
    expect(r.descartadas[0]).toMatchObject({ fecha: '2026-04-06', valor: 319.462, motivo: 'pico_aislado', previo: 229.343, siguiente: 228.808 });
    expect(r.limpias.map((x) => x.fecha)).toEqual(['2026-04-03', '2026-04-07']);
  });

  it('2020-09-08 Madero 1385.5 (NAMO 333) entre 116.7 y 113.1 → descartado', () => {
    const r = filtrarAtipicos([p('2020-09-07', 116.675), p('2020-09-08', 1385.480957), p('2020-09-09', 113.065)], 333.318);
    expect(r.descartadas.map((d) => d.fecha)).toEqual(['2020-09-08']);
  });

  it('2020-09-08 Boquilla 216.7 entre 899.8 y 888.5 (hacia ABAJO) → descartado', () => {
    const r = filtrarAtipicos([p('2020-09-07', 899.839), p('2020-09-08', 216.660995), p('2020-09-09', 888.506)], 2846.78);
    expect(r.descartadas).toHaveLength(1);
    expect(r.descartadas[0].valor).toBeCloseTo(216.66, 1);
  });

  it('2020-09-08 Luis L. León 655.4 entre 100.5 y 101.0 → descartado', () => {
    const r = filtrarAtipicos([p('2020-09-07', 100.459), p('2020-09-08', 655.411011), p('2020-09-09', 100.967)], 284.382);
    expect(r.descartadas.map((d) => d.fecha)).toEqual(['2020-09-08']);
  });

  it('Pico del Águila 2023-05-31: 21.7 entre 36.7 y 31.5 (vecinos que difieren 14 %) → descartado', () => {
    const r = filtrarAtipicos([p('2023-05-30', 36.716), p('2023-05-31', 21.727), p('2023-06-01', 31.516)], 48.276);
    expect(r.descartadas).toHaveLength(1);
    expect(r.descartadas[0].motivo).toBe('pico_aislado');
  });
});

describe('filtrarAtipicos · lo legítimo NO se toca', () => {
  it('llenado real monótono (queda ENTRE sus vecinos) se conserva aunque sea fuerte', () => {
    const s = serie('2026-07-01', [100, 140, 210, 330, 480, 700]);
    expect(filtrarAtipicos(s, 2846.78).descartadas).toHaveLength(0);
  });

  it('vertido legítimo de Luis L. León sobre su NAMO, con vecinos parecidos, se conserva', () => {
    const s = serie('2022-09-01', [410.2, 418.9, 422.6, 421.0, 415.3]);
    const r = filtrarAtipicos(s, 292.5);
    expect(r.descartadas).toHaveLength(0);
    expect(r.limpias).toHaveLength(5);
  });

  it('un escalón sostenido (la fuente actualiza por tramos) no es pico', () => {
    const s = serie('2026-01-01', [231.754, 231.754, 231.754, 231.486, 231.486, 231.486]);
    expect(filtrarAtipicos(s, 333.318).descartadas).toHaveLength(0);
  });

  it('serie corta, extremos y S/D: no descarta ni inventa', () => {
    expect(filtrarAtipicos([], 100).limpias).toEqual([]);
    expect(filtrarAtipicos([p('2026-01-01', 5), p('2026-01-02', 999)], 100).descartadas).toHaveLength(0); // sin vecino
    const conNull = [p('2026-01-01', 50), p('2026-01-02', null), p('2026-01-03', 52), p('2026-01-04', 51)];
    const r = filtrarAtipicos(conNull, 100);
    expect(r.descartadas).toHaveLength(0);
    expect(r.limpias).toHaveLength(4); // conserva el S/D en su lugar
  });

  it('un cambio relativo chico no es pico (umbral 25 %)', () => {
    const s = [p('2026-01-01', 100), p('2026-01-02', 115), p('2026-01-03', 100)];
    expect(filtrarAtipicos(s, 1000).descartadas).toHaveLength(0);
  });

  it('imposible físico: >1.5×NAMO sin respaldo de vecinos se descarta; con vecinos parecidos se conserva', () => {
    const solo = filtrarAtipicos([p('2026-01-01', 100), p('2026-01-02', 600), p('2026-01-03', 105), p('2026-01-04', 104)], 300);
    expect(solo.descartadas.map((d) => d.valor)).toEqual([600]);
    const respaldado = filtrarAtipicos([p('2026-01-01', 590), p('2026-01-02', 600), p('2026-01-03', 610)], 300);
    expect(respaldado.descartadas).toHaveLength(0);
  });

  it('desordenada: la ordena por fecha antes de evaluar', () => {
    const r = filtrarAtipicos([p('2026-04-07', 228.808), p('2026-04-06', 319.462), p('2026-04-03', 229.343)], 333.318);
    expect(r.descartadas).toHaveLength(1);
  });
});

describe('atrasoDias / estadoFrescura', () => {
  it('cuenta días calendario', () => {
    expect(atrasoDias('2026-11-05', '2026-11-07')).toBe(2);
    expect(atrasoDias('2026-11-07', '2026-11-07')).toBe(0);
    expect(atrasoDias('2026-11-08', '2026-11-07')).toBe(0);
    expect(atrasoDias(null, '2026-11-07')).toBeNull();
  });
  it('con días hábiles, un viernes visto el domingo NO está atrasado (Boquilla y Madero reportan lun-vie)', () => {
    // 2026-11-06 es viernes, 2026-11-08 es domingo
    expect(atrasoDias('2026-11-06', '2026-11-08', true)).toBe(0);
    expect(atrasoDias('2026-11-06', '2026-11-08', false)).toBe(2);
    expect(atrasoDias('2026-11-06', '2026-11-10', true)).toBe(2); // lun y mar
  });
  it('estado: ≤2 al día, >2 atrasada, null sin dato', () => {
    expect(estadoFrescura(0)).toBe('al_dia');
    expect(estadoFrescura(2)).toBe('al_dia');
    expect(estadoFrescura(3)).toBe('atrasada');
    expect(estadoFrescura(null)).toBe('sd');
  });
});

describe('balanceAlerta (solo diagnóstico, nunca "evaporación")', () => {
  it('residuo positivo grande = alerta de calidad (caso Boquilla)', () => {
    const r = balanceAlerta(4.33, 3.67, 0)!;
    expect(r.residuoMm3Dia).toBeCloseTo(0.66, 2);
    expect(r.alerta).toBe(true);
  });
  it('residuo negativo (evaporación plausible) no alerta', () => {
    expect(balanceAlerta(0.5, 0.6, 0)!.alerta).toBe(false);
  });
  it('sin algún dato: null (no se inventa)', () => {
    expect(balanceAlerta(null, 1, 0)).toBeNull();
    expect(balanceAlerta(1, null, 0)).toBeNull();
    expect(balanceAlerta(1, 1, null)).toBeNull();
  });
});
