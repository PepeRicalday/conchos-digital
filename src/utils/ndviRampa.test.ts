import { describe, expect, it } from 'vitest';
import { CLASES_NDVI, SD_FONDO, claseNdvi, colorClaseNdvi, colorNdvi, contraste, grisPercibido, luminancia, tintaSobre } from './ndviRampa';

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
        expect(colorNdvi(null)).toBe(SD_FONDO);
        expect(colorClaseNdvi(null)).toBeNull();
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
    it('colorClaseNdvi es discreto: un valor de cada clase devuelve exactamente el color de la leyenda', () => {
        [0.1, 0.2, 0.4, 0.6, 0.8].forEach((v, i) => expect(colorClaseNdvi(v)).toBe(CLASES_NDVI[i].color));
        expect(colorClaseNdvi(0.31)).toBe(colorClaseNdvi(0.49));
    });
    it('el texto sobre cada clase (negro o blanco) llega a contraste ≥ 4.5:1', () => {
        for (const c of CLASES_NDVI) expect(contraste(c.color, tintaSobre(c.color)), c.clave).toBeGreaterThanOrEqual(4.5);
    });
    it('en escala de grises cada clase se distingue de la vecina (clases adyacentes ≥ 18 niveles de gris y ≥ 1.15 de contraste)', () => {
        for (let i = 1; i < CLASES_NDVI.length; i++) {
            const a = CLASES_NDVI[i - 1].color, b = CLASES_NDVI[i].color;
            expect(grisPercibido(a) - grisPercibido(b), `${CLASES_NDVI[i - 1].clave}→${CLASES_NDVI[i].clave}`).toBeGreaterThanOrEqual(18);
            expect(contraste(a, b)).toBeGreaterThanOrEqual(1.15);
        }
        // Las no adyacentes se separan más que las vecinas.
        expect(grisPercibido(CLASES_NDVI[0].color) - grisPercibido(CLASES_NDVI[2].color)).toBeGreaterThan(40);
    });
});
