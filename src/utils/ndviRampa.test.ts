import { describe, expect, it } from 'vitest';
import { CLASES_NDVI, claseNdvi, colorNdvi, luminancia } from './ndviRampa';

describe('ndviRampa', () => {
    it('clasifica los valores del 2026-09 (M1 0.20, M5 0.34, M3 0.52)', () => {
        expect(claseNdvi(0.202)?.clave).toBe('bajo');
        expect(claseNdvi(0.343)?.clave).toBe('medio');
        expect(claseNdvi(0.519)?.clave).toBe('alto');
    });
    it('los límites pertenecen a la clase superior', () => {
        expect(claseNdvi(0.15)?.clave).toBe('bajo');
        expect(claseNdvi(0.3)?.clave).toBe('medio');
        expect(claseNdvi(0.7)?.clave).toBe('muyalto');
        expect(claseNdvi(-0.2)?.clave).toBe('suelo');
    });
    it('S/D nunca es "suelo desnudo"', () => {
        expect(claseNdvi(null)).toBeNull();
        expect(claseNdvi(undefined)).toBeNull();
        expect(claseNdvi(NaN)).toBeNull();
        expect(colorNdvi(null)).toBe('#334155');
    });
    it('la luminosidad baja de forma monótona (apta para daltonismo): más vegetación = más oscuro', () => {
        const l = CLASES_NDVI.map((c) => luminancia(c.color));
        for (let i = 1; i < l.length; i++) expect(l[i]).toBeLessThan(l[i - 1]);
    });
    it('el color continuo coincide con la clase en las paradas y se interpola entre ellas', () => {
        expect(colorNdvi(0.4)).toBe('rgb(111,177,90)');
        expect(colorNdvi(0.0)).toBe('rgb(217,201,160)');
        expect(colorNdvi(0.95)).toBe('rgb(20,83,45)');
        expect(colorNdvi(0.31)).not.toBe(colorNdvi(0.4));
    });
});
