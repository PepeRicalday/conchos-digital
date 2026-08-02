import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  agregarAlmacenamiento,
  porcentajeLlenadoPresa,
  calcularFrescura,
  lecturaMasReciente,
  type PresaLike,
} from './presaMetrics';

const presa = (over: Partial<PresaLike> & { capacidad_max_mm3: number }): PresaLike => ({
  lectura: null,
  ...over,
});

describe('agregarAlmacenamiento — regla "S/D nunca cero"', () => {
  it('retorna null (no 0) cuando ninguna presa tiene lectura válida', () => {
    const presas = [
      presa({ capacidad_max_mm3: 100, lectura: null }),
      presa({ capacidad_max_mm3: 200, lectura: { almacenamiento_mm3: null } }),
    ];
    const r = agregarAlmacenamiento(presas);
    expect(r.totalMm3).toBeNull();
    expect(r.porcentaje).toBeNull();
    expect(r.parcial).toBe(true);
  });

  it('excluye presas sin lectura del denominador — no las cuenta como capacidad con 0%', () => {
    const presas = [
      presa({ capacidad_max_mm3: 100, lectura: { almacenamiento_mm3: 50 } }),
      presa({ capacidad_max_mm3: 3000, lectura: null }), // sin dato: NO debe hundir el %
    ];
    const r = agregarAlmacenamiento(presas);
    expect(r.totalMm3).toBe(50);
    expect(r.capacidadContabilizadaMm3).toBe(100);
    expect(r.porcentaje).toBe(50); // no 50/3100 — la presa sin dato queda fuera
    expect(r.presasConDato).toBe(1);
    expect(r.parcial).toBe(true);
  });

  it('agrega correctamente cuando todas las presas tienen lectura', () => {
    const presas = [
      presa({ capacidad_max_mm3: 100, lectura: { almacenamiento_mm3: 80 } }),
      presa({ capacidad_max_mm3: 100, lectura: { almacenamiento_mm3: 20 } }),
    ];
    const r = agregarAlmacenamiento(presas);
    expect(r.totalMm3).toBe(100);
    expect(r.porcentaje).toBe(50);
    expect(r.parcial).toBe(false);
  });

  it('capacidadCatalogoMm3 siempre suma el catálogo completo, con o sin dato', () => {
    const presas = [
      presa({ capacidad_max_mm3: 100, lectura: { almacenamiento_mm3: 50 } }),
      presa({ capacidad_max_mm3: 200, lectura: null }),
    ];
    const r = agregarAlmacenamiento(presas);
    expect(r.capacidadCatalogoMm3).toBe(300);
  });
});

describe('porcentajeLlenadoPresa — prioriza cálculo derivado sobre valor grabado', () => {
  it('calcula desde almacenamiento/capacidad cuando hay almacenamiento válido', () => {
    const p = presa({ capacidad_max_mm3: 200, lectura: { almacenamiento_mm3: 50, porcentaje_llenado: 99 } });
    // Debe ignorar el 99 grabado y usar el derivado: 50/200 = 25%
    expect(porcentajeLlenadoPresa(p)).toBe(25);
  });

  it('cae al porcentaje grabado si no hay almacenamiento numérico', () => {
    const p = presa({ capacidad_max_mm3: 200, lectura: { almacenamiento_mm3: null, porcentaje_llenado: 42 } });
    expect(porcentajeLlenadoPresa(p)).toBe(42);
  });

  it('retorna null (no 0) cuando no hay ningún dato utilizable', () => {
    const p = presa({ capacidad_max_mm3: 200, lectura: null });
    expect(porcentajeLlenadoPresa(p)).toBeNull();
  });

  it('retorna null si la capacidad de catálogo es 0 (evita división por cero)', () => {
    const p = presa({ capacidad_max_mm3: 0, lectura: { almacenamiento_mm3: 50 } });
    expect(porcentajeLlenadoPresa(p)).toBeNull();
  });
});

describe('calcularFrescura — vigencia de una lectura', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('retorna null cuando no hay fecha', () => {
    expect(calcularFrescura(null)).toBeNull();
    expect(calcularFrescura(undefined)).toBeNull();
  });

  it('marca stale=false dentro del umbral por defecto (24h)', () => {
    const f = calcularFrescura('2026-07-20T06:00:00Z'); // 6h antes
    expect(f?.stale).toBe(false);
    expect(f?.texto).toContain('hace 6 h');
  });

  it('marca stale=true fuera del umbral', () => {
    const f = calcularFrescura('2026-07-18T12:00:00Z', 24); // 48h antes
    expect(f?.stale).toBe(true);
    expect(f?.texto).toContain('hace 2 días');
  });

  it('acepta fecha simple YYYY-MM-DD (ancla a mediodía local)', () => {
    const f = calcularFrescura('2026-07-20');
    expect(f).not.toBeNull();
    expect(f?.horas).not.toBeNull();
  });
});

describe('lecturaMasReciente', () => {
  it('retorna la fecha más reciente entre varias presas', () => {
    const presas = [
      presa({ capacidad_max_mm3: 1, lectura: { fecha: '2026-07-18' } }),
      presa({ capacidad_max_mm3: 1, lectura: { fecha: '2026-07-20' } }),
      presa({ capacidad_max_mm3: 1, lectura: { fecha: '2026-07-15' } }),
    ];
    expect(lecturaMasReciente(presas)).toBe('2026-07-20');
  });

  it('retorna null cuando ninguna presa tiene fecha', () => {
    const presas = [presa({ capacidad_max_mm3: 1, lectura: null })];
    expect(lecturaMasReciente(presas)).toBeNull();
  });
});
