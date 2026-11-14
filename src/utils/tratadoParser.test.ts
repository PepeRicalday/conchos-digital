import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fechaIngles, parseCorte, textoDePdf } from '../../supabase/functions/tratado-sync/parser';

describe('corte oficial del IBWC (Current_Cycle.pdf)', () => {
  it('fechaIngles', () => {
    expect(fechaIngles('November 7, 2026')).toBe('2026-11-07');
    expect(fechaIngles('October 25, 2025')).toBe('2025-10-25');
    expect(fechaIngles('sin fecha')).toBeNull();
  });

  it('lee el acumulado, la deuda y el inicio del ciclo del PDF real', async () => {
    const pdf = new Uint8Array(readFileSync('supabase/functions/tratado-sync/Current_Cycle.fixture.pdf'));
    const corte = parseCorte(await textoDePdf(pdf));
    expect(corte).not.toBeNull();
    expect(corte!.fechaCorte).toBe('2026-11-07');
    expect(corte!.acumuladoAf).toBe(363679);
    expect(corte!.acumuladoMcm).toBe(449);
    expect(corte!.deudaRemanenteAf).toBe(861980);
    expect(corte!.deficitCicloAnteriorAf).toBe(865139);
    expect(corte!.cicloInicio).toBe('2025-10-25');
  });

  it('si el PDF cambia de formato devuelve null (no inventa cifras)', () => {
    expect(parseCorte('Reporte sin acumulado')).toBeNull();
  });

  it('tolera los escapes que deja Excel en el paréntesis', () => {
    const c = parseCorte('Current Cycle: October 25, 2025 thru December 5, 2026\n400,000 AF (493 MCM ) as of December 5, 2026');
    expect(c?.acumuladoAf).toBe(400000);
    expect(c?.fechaCorte).toBe('2026-12-05');
  });
});
