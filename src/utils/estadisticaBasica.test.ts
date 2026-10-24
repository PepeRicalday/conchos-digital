import { describe, expect, it } from 'vitest';
import { media, mesDe, soloValidos } from './estadisticaBasica';

describe('estadisticaBasica', () => {
    it('media ignora null/NaN y devuelve null (no 0) si no queda nada', () => {
        expect(media([1, null, 3, undefined, NaN])).toBe(2);
        expect(media([null, undefined])).toBeNull();
        expect(media([])).toBeNull();
        expect(media([0, 0])).toBe(0); // un 0 REAL sí cuenta
    });
    it('soloValidos y mesDe', () => {
        expect(soloValidos([1, null, Infinity, 2])).toEqual([1, 2]);
        expect(mesDe('2026-03-15')).toBe('2026-03');
        expect(mesDe(null)).toBe('');
    });
});
