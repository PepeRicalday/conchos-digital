import { describe, it, expect } from 'vitest';
import { compararOjinaga, PARES_MIN_COMPARACION } from './hidroComparacion';

const T0 = Date.UTC(2026, 10, 6, 0, 0);
const serie = (n: number, f: (i: number) => number, desfaseMs = 0) =>
    Array.from({ length: n }, (_, i) => ({ t: T0 + i * 15 * 60000 + desfaseMs, v: f(i) }));

describe('compararOjinaga', () => {
    it('detecta el caso real: nivel +7 cm pero gasto ~56× el de IBWC', () => {
        const c = compararOjinaga(
            { nivel: serie(48, () => 1.575), gasto: serie(48, () => 89.9) },
            { nivel: serie(48, () => 1.505), gasto: serie(48, () => 1.6) },
        );
        expect(c.offsetNivelM).toBeCloseTo(0.07, 3);
        expect(c.razonGasto).toBeCloseTo(56.19, 1);
        expect(c.difGastoM3s).toBeCloseTo(88.3, 1);
        expect(c.suficiente).toBe(true);
        expect(c.discrepante).toBe(true);
    });

    it('fuentes coherentes: no hay discrepancia', () => {
        const c = compararOjinaga({ gasto: serie(48, () => 1.7) }, { gasto: serie(48, () => 1.6) });
        expect(c.discrepante).toBe(false);
    });

    it('alinea instantes con pequeño desfase (±2 min) y no inventa pares', () => {
        const c = compararOjinaga({ gasto: serie(30, () => 2, 2 * 60000) }, { gasto: serie(30, () => 2) });
        expect(c.pares).toBe(30);
        const sin = compararOjinaga({ gasto: serie(30, () => 2) }, { gasto: [{ t: T0 + 100 * 3600000, v: 2 }] });
        expect(sin.pares).toBe(0);
        expect(sin.razonGasto).toBeNull();
    });

    it('con pocos pares no concluye (evita falsa alarma)', () => {
        const n = PARES_MIN_COMPARACION - 1;
        const c = compararOjinaga({ gasto: serie(n, () => 90) }, { gasto: serie(n, () => 1.6) });
        expect(c.suficiente).toBe(false);
        expect(c.discrepante).toBe(false);
    });

    it('gasto IBWC ~0 no produce razón (división) y vacío devuelve null, nunca 0', () => {
        const c = compararOjinaga({ gasto: serie(48, () => 5) }, { gasto: serie(48, () => 0) });
        expect(c.razonGasto).toBeNull();
        expect(c.discrepante).toBe(false);
        const v = compararOjinaga({}, {});
        expect(v.offsetNivelM).toBeNull();
        expect(v.difGastoM3s).toBeNull();
    });
});
