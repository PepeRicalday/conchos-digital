import { describe, expect, it } from 'vitest';
import { calcIEC } from './canalIndex';

const base = { eficiencia: 90, n_coherentes: 8, total_puntos: 10, q_entrada: 40, escalas_criticas: 0, total_escalas: 14 };

describe('calcIEC — S/D nunca regala puntos', () => {
    it('sin medición de fugas (null) se excluye y el índice se reescala sobre 75', () => {
        const r = calcIEC({ ...base, q_fuga_total: null });
        expect(r.sin_dato).toEqual(['fugas']);
        expect(r.max_evaluado).toBe(75);
        expect(r.p_fugas).toBe(0);
        // (27 + 20 + 20) / 75 · 100 = 89
        expect(r.iec).toBe(89);
        expect(r.inputs.fuga_pct).toBeNull();
    });
    it('con fuga medida de 0 m³/s sí otorga los 25 puntos (medición real)', () => {
        const r = calcIEC({ ...base, q_fuga_total: 0 });
        expect(r.sin_dato).toEqual([]);
        expect(r.p_fugas).toBe(25);
        expect(r.max_evaluado).toBe(100);
    });
    it('sin puntos de coherencia ni escalas, tampoco puntúan', () => {
        const r = calcIEC({ ...base, total_puntos: 0, n_coherentes: 0, total_escalas: 0, q_fuga_total: 2 });
        expect(r.sin_dato).toEqual(['coherencia', 'criticos']);
        expect(r.max_evaluado).toBe(55);
    });
    it('sin gasto de entrada la fuga no es medible', () => {
        expect(calcIEC({ ...base, q_entrada: 0, q_fuga_total: 1 }).sin_dato).toContain('fugas');
    });
});
