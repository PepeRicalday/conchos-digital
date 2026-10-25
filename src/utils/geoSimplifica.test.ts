import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { desviacionMaximaM, simplificarAnillosDP, simplificarLineaDP, type Punto } from './geoSimplifica';
import { contornosAAnillos, TOLERANCIA_CONTORNO_M } from './informeNdviSvg';
import { MODULOS_SRL_IDS } from './modulosSRL';

const GEO = JSON.parse(fs.readFileSync(new URL('../../public/geo/modulos.geojson', import.meta.url), 'utf-8')) as GeoJSON.FeatureCollection;

describe('Douglas-Peucker en metros', () => {
    it('quita los puntos alineados y conserva los extremos y las esquinas', () => {
        const l: Punto[] = [[0, 0], [0.001, 0], [0.002, 0], [0.003, 0], [0.003, 0.003]];
        expect(simplificarLineaDP(l, 5)).toEqual([[0, 0], [0.003, 0], [0.003, 0.003]]);
    });
    it('una desviación menor a la tolerancia se descarta y una mayor se conserva', () => {
        const mitad = (dy: number): Punto[] => [[0, 0], [0.005, dy], [0.01, 0]];
        expect(simplificarLineaDP(mitad(0.0002), 40)).toHaveLength(2); // ≈ 22 m
        expect(simplificarLineaDP(mitad(0.0006), 40)).toHaveLength(3); // ≈ 67 m
    });
    it('los vértices compartidos entre dos anillos se conservan como anclas', () => {
        const a: Punto[] = [[0, 0], [0.002, 0.00001], [0.004, 0], [0.004, 0.004], [0, 0.004], [0, 0]];
        const b: Punto[] = [[0.004, 0], [0.006, 0], [0.006, 0.004], [0.004, 0.004], [0.004, 0]];
        const [sa] = simplificarAnillosDP([a, b], 40);
        const llaves = sa.map((p) => p.join(','));
        expect(llaves).toContain('0.004,0');
        expect(llaves).toContain('0.004,0.004');
        expect(llaves).not.toContain('0.002,0.00001'); // el punto casi alineado sí se va
    });
    it('anillos reales: cerrados, ≥ 4 puntos, mucho más ligeros y a menos de la tolerancia del original', () => {
        const mod = GEO.features.find((f) => Number(f.properties?.numero_modulo) === 5)!;
        const original = (mod.geometry as GeoJSON.Polygon).coordinates[0] as Punto[];
        const [s] = simplificarAnillosDP([original], TOLERANCIA_CONTORNO_M);
        expect(s[0]).toEqual(s[s.length - 1]);
        expect(s.length).toBeGreaterThanOrEqual(4);
        expect(s.length).toBeLessThan(original.length * 0.3);
        expect(desviacionMaximaM(original, s)).toBeLessThanOrEqual(TOLERANCIA_CONTORNO_M + 1);
    });
    it('contornosAAnillos entrega los 6 módulos SRL con anillos cerrados', () => {
        const c = contornosAAnillos(GEO);
        expect(Object.keys(c).map(Number).sort((x, y) => x - y)).toEqual([...MODULOS_SRL_IDS].sort((x, y) => x - y));
        for (const n of MODULOS_SRL_IDS) for (const a of c[n]) { expect(a[0]).toEqual(a[a.length - 1]); expect(a.length).toBeGreaterThanOrEqual(4); }
        expect(contornosAAnillos(null)).toEqual({});
    });
});
