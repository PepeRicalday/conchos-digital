import { describe, expect, it } from 'vitest';
import { confirmarConCila, TOLERANCIA_CONFIRMACION_MM3 } from './confirmacionCila';

describe('confirmación de la captura con CILA', () => {
  it('los datos reales del 11-nov (827.53 vs 827.528; 182.67 vs 182.669) quedan confirmados', () => {
    const b = confirmarConCila(827.53, 827.528, 2846.782);
    expect(b.estado).toBe('confirmada');
    expect(b.difMm3).toBeCloseTo(0.002, 6);
    expect(b.texto).toMatch(/CILA confirma/);
    expect(confirmarConCila(182.67, 182.669, 333.32).estado).toBe('confirmada');
  });
  it('una diferencia mayor a la tolerancia no se confirma y dice cuánto', () => {
    const r = confirmarConCila(830, 827.528, 2846.782);
    expect(r.estado).toBe('difiere');
    expect(r.difMm3).toBeCloseTo(2.472, 3);
    expect(r.texto).toMatch(/Difiere de CILA: \+2[.,]472 hm³/);
    expect(r.difPuntos).toBeCloseTo(0.0868, 3);
  });
  it('en el límite de la tolerancia todavía confirma', () => {
    expect(confirmarConCila(100 + TOLERANCIA_CONFIRMACION_MM3, 100, 300).estado).toBe('confirmada');
    expect(confirmarConCila(100.06, 100, 300).estado).toBe('difiere');
  });
  it('sin CILA queda pendiente y sin captura lo dice; nunca inventa una diferencia', () => {
    const p = confirmarConCila(100, null, 300);
    expect(p.estado).toBe('pendiente'); expect(p.difMm3).toBeNull();
    const s = confirmarConCila(null, 100, 300);
    expect(s.estado).toBe('sin_captura'); expect(s.difMm3).toBeNull();
  });
  it('un 0 real se compara como 0 (no como S/D)', () => {
    expect(confirmarConCila(0, 0, 300).estado).toBe('confirmada');
  });
});
