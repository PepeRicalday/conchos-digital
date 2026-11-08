import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { interpretaContorno, dentroDeCuenca, zonaDeEstacion, proyectorCuenca, anilloAPath, type ContornoCuenca } from './geoCuenca';

const c = interpretaContorno(JSON.parse(readFileSync('public/geo/cuenca_conchos.geojson', 'utf8'))) as ContornoCuenca;

describe('contorno oficial de la cuenca del Conchos', () => {
    it('se interpreta, con área cercana a la oficial (68,387 km², INEGI) y un solo exterior', () => {
        expect(c).not.toBeNull();
        expect(c.poligonos.length).toBe(1);
        expect(c.areaKm2!).toBeGreaterThan(66000);
        expect(c.areaKm2!).toBeLessThan(69500);
        expect(c.fuente).toMatch(/INEGI/);
    });

    it('estaciones conocidas: Parral, Camargo, Chihuahua y Balleza dentro; Juárez, Cuauhtémoc y Madera fuera', () => {
        expect(dentroDeCuenca(c, -105.69, 26.93)).toBe(true);   // Parral
        expect(dentroDeCuenca(c, -105.17, 27.7)).toBe(true);    // Camargo
        expect(dentroDeCuenca(c, -106.08, 28.64)).toBe(true);   // Chihuahua
        expect(dentroDeCuenca(c, -106.35, 26.95)).toBe(true);   // Balleza
        expect(dentroDeCuenca(c, -106.43, 31.68)).toBe(false);  // Juárez
        expect(dentroDeCuenca(c, -106.88, 28.39)).toBe(false);  // Cuauhtémoc (Río Papigochic)
        expect(dentroDeCuenca(c, -108.14, 29.19)).toBe(false);  // Madera
    });

    it('Boquilla y Madero (presas del distrito) quedan dentro', () => {
        expect(dentroDeCuenca(c, -105.4375, 27.5517)).toBe(true);
        expect(dentroDeCuenca(c, -105.5278, 28.3364)).toBe(true);
    });

    it('Ojinaga está en el borde del polígono: se reconoce como "salida" con cualquier redondeo de coordenadas', () => {
        expect(zonaDeEstacion(c, -104.406, 29.566)).toBe('salida');
        expect(zonaDeEstacion(c, -104.41, 29.57)).toBe('salida');
        expect(zonaDeEstacion(c, -103.907, 29.107)).toBe('fuera'); // Manuel Benavides, sobre el río Bravo aguas abajo
        expect(zonaDeEstacion(c, -105.69, 26.93)).toBe('cuenca');
        expect(zonaDeEstacion(c, -106.43, 31.68)).toBe('fuera');
    });

    it('S/D (null, NaN) nunca es "dentro" ni "salida"', () => {
        expect(dentroDeCuenca(c, null, 27)).toBe(false);
        expect(dentroDeCuenca(c, -105.5, undefined)).toBe(false);
        expect(zonaDeEstacion(c, NaN, 27)).toBe('fuera');
    });

    it('interpretaContorno rechaza geometrías vacías o inválidas', () => {
        expect(interpretaContorno(null)).toBeNull();
        expect(interpretaContorno({ features: [] })).toBeNull();
        expect(interpretaContorno({ features: [{ geometry: { type: 'Point', coordinates: [0, 0] } }] })).toBeNull();
        expect(interpretaContorno({ features: [{ geometry: { type: 'MultiPolygon', coordinates: [] } }] })).toBeNull();
    });

    it('el proyector mantiene el contorno dentro del lienzo', () => {
        const p = proyectorCuenca(c.bbox, 800);
        expect(p.ancho).toBe(800);
        expect(p.alto).toBeGreaterThan(0);
        for (const [lo, la] of c.poligonos[0][0]) {
            expect(p.x(lo)).toBeGreaterThanOrEqual(0);
            expect(p.x(lo)).toBeLessThanOrEqual(800);
            expect(p.y(la)).toBeGreaterThanOrEqual(0);
            expect(p.y(la)).toBeLessThanOrEqual(p.alto);
        }
        expect(anilloAPath(c.poligonos[0][0], p)).toMatch(/^M[\d.]+,[\d.]+L.*Z$/);
    });
});
