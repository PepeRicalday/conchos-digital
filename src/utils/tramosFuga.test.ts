import { describe, expect, it } from 'vitest';
import { normalizaTramoFuga } from './tramosFuga';

const fila = (o: object) => ({ escala_inicio_nombre: 'K-29', escala_fin_nombre: 'K-34', km_inicio: '29.000', km_fin: '34.000', ...o });

describe('normalizaTramoFuga', () => {
    it('lee las columnas reales de la vista (con sufijo _m3s)', () => {
        const s = normalizaTramoFuga(fila({ q_entrada_m3s: '0.4035', q_salida_m3s: '0.2051', q_extracciones_m3s: '0.1', q_perdida_m3s: '0.1984', eficiencia_pct: '50.83', estatus_hidraulico: 'PREVENTIVA' }));
        expect(s.q_entrada).toBeCloseTo(0.4035);
        // Sin verificar frescura de las lecturas, la pérdida en m³/s no se publica (S/D).
        expect(s.q_perdida).toBeNull();
        expect(normalizaTramoFuga(fila({ q_entrada_m3s: '0.4035', q_perdida_m3s: '0.1984', eficiencia_pct: '50.83' }), { perdidaVerificada: true }).q_perdida).toBeCloseTo(0.1984);
        expect(s.eficiencia_pct).toBeCloseTo(50.83);
        expect(s.estatus).toBe('PREVENTIVA');
        expect(s.tramo_inicio).toBe('K-29');
        expect(s.km_fin).toBe(34);
    });
    it('eficiencia > 100 % (ganancia no medida) → S/D', () => {
        const s = normalizaTramoFuga(fila({ q_entrada_m3s: '0.2051', q_salida_m3s: '0.628', q_perdida_m3s: '-0.4229', eficiencia_pct: '306.19' }));
        expect(s.eficiencia_pct).toBeNull();
        expect(s.q_perdida).toBeNull();
    });
    it('sin gasto de entrada: 100 % con gasto 0 no es un balance', () => {
        const s = normalizaTramoFuga(fila({ q_entrada_m3s: '0', q_salida_m3s: '0', q_perdida_m3s: '0', eficiencia_pct: '100' }));
        expect(s.eficiencia_pct).toBeNull();
        expect(s.q_perdida).toBeNull();
    });
    it('eficiencia 0 % con entrada y salida 0 → S/D', () => {
        expect(normalizaTramoFuga(fila({ q_entrada_m3s: '53.277', q_salida_m3s: '0', q_perdida_m3s: '53.277', eficiencia_pct: '0.00' })).eficiencia_pct).toBeNull();
    });
    it('valores nulos no se vuelven 0', () => {
        const s = normalizaTramoFuga(fila({}));
        expect(s.q_entrada).toBeNull();
        expect(s.q_perdida).toBeNull();
    });
});
