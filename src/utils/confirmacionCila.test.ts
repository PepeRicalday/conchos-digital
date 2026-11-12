import { describe, expect, it } from 'vitest';
import { capturaEsVigente, confirmarConCila, TOLERANCIA_CONFIRMACION_MM3 } from './confirmacionCila';

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

describe('regla de respaldo: sin captura vigente manda CILA', () => {
  it('captura del mismo día que CILA o más reciente → se usa la captura', () => {
    expect(capturaEsVigente('2026-11-11', '2026-11-11')).toBe(true);
    expect(capturaEsVigente('2026-11-12', '2026-11-11')).toBe(true);
  });
  it('una semana sin capturar (CILA más nuevo) → la captura NO es vigente y se publica CILA', () => {
    expect(capturaEsVigente('2026-11-04', '2026-11-11')).toBe(false);
    expect(capturaEsVigente('2026-11-10', '2026-11-11')).toBe(false);
  });
  it('sin captura → CILA; sin CILA alguno → la captura es la única lectura', () => {
    expect(capturaEsVigente(null, '2026-11-11')).toBe(false);
    expect(capturaEsVigente(null, null)).toBe(false);
    expect(capturaEsVigente('2026-11-11', null)).toBe(true);
  });
  it('el texto de «sin captura» dice que se publica CILA', () => {
    expect(confirmarConCila(null, 100, 300).texto).toMatch(/se publica el dato de CILA/);
  });
});
