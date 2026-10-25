import { describe, expect, it } from 'vitest';
import { definicionNdviSrl, pesosSuperficie, promedioConBase, promedioPonderado, rotuloBase } from './ndviPromedio';

describe('ndviPromedio: una sola regla del NDVI de la SRL', () => {
    it('simple ignora pesos y módulos sin valor; sin ningún valor devuelve null (nunca 0)', () => {
        expect(promedioConBase('simple', [{ valor: 0.2, peso: 1 }, { valor: 0.4, peso: 99 }, { valor: null, peso: 5 }])).toBeCloseTo(0.3, 9);
        expect(promedioConBase('simple', [{ valor: null, peso: 1 }])).toBeNull();
        expect(promedioConBase('simple', [])).toBeNull();
    });
    it('ponderado usa la superficie; sin pesos utilizables no cae en silencio al simple', () => {
        expect(promedioConBase('ponderado', [{ valor: 0.2, peso: 100 }, { valor: 0.4, peso: 900 }])).toBeCloseTo(0.38, 9);
        expect(promedioConBase('ponderado', [{ valor: 0.2, peso: null }, { valor: 0.4, peso: 0 }])).toBeNull();
        expect(promedioPonderado([{ valor: null, peso: 5 }, { valor: 1, peso: null }])).toBeNull();
    });
    it('el peso de cada módulo es la superficie del registro más reciente con superficie', () => {
        const m = pesosSuperficie([
            { numero_modulo: 1, mes: '2025-09', superficie_ha: 100 }, { numero_modulo: 1, mes: '2026-09', superficie_ha: 120 },
            { numero_modulo: 1, mes: '2026-10', superficie_ha: null }, { numero_modulo: 2, mes: '2026-09', superficie_ha: 0 },
        ]);
        expect(m.get(1)).toBe(120);
        expect(m.has(2)).toBe(false);
    });
    it('rótulo y definición rotulada dicen qué se promedia', () => {
        expect(rotuloBase('simple')).toBe('simple');
        expect(rotuloBase('ponderado')).toBe('ponderado por superficie');
        expect(definicionNdviSrl('simple', 6)).toContain('promedio simple de 6 módulos');
        expect(definicionNdviSrl('ponderado', 1)).toContain('ponderado por la superficie de su polígono');
        expect(definicionNdviSrl('ponderado', 1)).toContain('1 módulo del periodo');
    });
});
