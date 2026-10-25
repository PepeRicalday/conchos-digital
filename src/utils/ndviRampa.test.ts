import { describe, expect, it } from 'vitest';
import { CLASES_NDVI, SD_FONDO, SUELO_CONTORNO, claseNdvi, colorClaseNdvi, colorNdvi, contraste, grisPercibido, luminancia, luminosidadL, tintaSobre } from './ndviRampa';

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
        expect(colorNdvi(0.0)).toBe('rgb(245,235,205)');
        expect(colorNdvi(0.95)).toBe('rgb(20,83,45)');
        expect(colorNdvi(0.31)).not.toBe(colorNdvi(0.4));
    });
    it('colorClaseNdvi es discreto: un valor de cada clase devuelve exactamente el color de la leyenda', () => {
        [0.1, 0.2, 0.4, 0.6, 0.8].forEach((v, i) => expect(colorClaseNdvi(v)).toBe(CLASES_NDVI[i].color));
        expect(colorClaseNdvi(0.31)).toBe(colorClaseNdvi(0.49));
    });
    it('clases adyacentes: ΔL* ≥ 12 y razón de luminancia ≥ 1.25, y la luminancia es monótona (suelo más claro, vigor muy alto más oscuro)', () => {
        for (let i = 1; i < CLASES_NDVI.length; i++) {
            const a = CLASES_NDVI[i - 1].color, b = CLASES_NDVI[i].color, par = `${CLASES_NDVI[i - 1].clave}→${CLASES_NDVI[i].clave}`;
            expect(luminosidadL(a) - luminosidadL(b), par).toBeGreaterThanOrEqual(12);
            expect(contraste(a, b), par).toBeGreaterThanOrEqual(1.25);
        }
    });
    it('Suelo desnudo sigue siendo arena/crema (tono cálido: R ≥ G > B) y su contorno se ve sobre su propio relleno', () => {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(CLASES_NDVI[0].color.slice(i, i + 2), 16));
        expect(r).toBeGreaterThanOrEqual(g);
        expect(g).toBeGreaterThan(b);
        expect(contraste(CLASES_NDVI[0].color, SUELO_CONTORNO)).toBeGreaterThanOrEqual(3);
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
