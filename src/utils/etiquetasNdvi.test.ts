import { describe, it, expect } from 'vitest';
import { separarEtiquetasFinales } from './ndviGrafica';
import { separarRotulos } from './informeNdviSvg';

const RANGO = [0, 0.8] as const;
const ALTO = 300; // px de trazado → 375 px por unidad de NDVI

describe('separarEtiquetasFinales (gráfica)', () => {
    it('valores casi iguales (2021 y 2024 a 0.42) quedan a ≥ gap píxeles', () => {
        const dy = separarEtiquetasFinales([0.4231, 0.4221, 0.55], RANGO, ALTO, 15);
        const y = [0.4231, 0.4221, 0.55].map((v, i) => ((0.8 - v) / 0.8) * ALTO + dy[i]).sort((a, b) => a - b);
        expect(y[1] - y[0]).toBeGreaterThanOrEqual(15 - 1e-9);
        expect(y[2] - y[1]).toBeGreaterThanOrEqual(15 - 1e-9);
    });

    it('series sin dato (null) no ocupan lugar y reciben 0', () => {
        const dy = separarEtiquetasFinales([null, 0.3, null], RANGO, ALTO);
        expect(dy).toEqual([0, 0, 0]);
    });

    it('etiquetas ya separadas no se mueven', () => {
        const dy = separarEtiquetasFinales([0.1, 0.4, 0.7], RANGO, ALTO, 15);
        dy.forEach((d) => expect(Math.abs(d)).toBeLessThan(1e-9));
    });

    it('el grupo no se sale del área de trazado (cerca del borde inferior)', () => {
        const vals = [0.01, 0.012, 0.011, 0.013];
        const dy = separarEtiquetasFinales(vals, RANGO, ALTO, 15);
        vals.forEach((v, i) => {
            const y = ((0.8 - v) / 0.8) * ALTO + dy[i];
            expect(y).toBeLessThanOrEqual(ALTO + 1e-9);
            expect(y).toBeGreaterThanOrEqual(-1e-9);
        });
    });
});

describe('separarRotulos (plano del informe)', () => {
    const solapan = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
        Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

    it('dos rótulos casi en el mismo punto dejan de solaparse', () => {
        const cajas = [{ x: 200, y: 100, w: 60, h: 36 }, { x: 205, y: 108, w: 60, h: 36 }, { x: 300, y: 300, w: 60, h: 36 }];
        const p = separarRotulos(cajas, 520, 500);
        const mov = cajas.map((c, i) => ({ ...c, x: p[i].x, y: p[i].y }));
        expect(solapan(mov[0], mov[1])).toBe(false);
        expect(p[2]).toEqual({ x: 300, y: 300 });
    });

    it('cuatro rótulos amontonados quedan sin solape y dentro del lienzo', () => {
        const cajas = [0, 1, 2, 3].map((k) => ({ x: 250 + k * 4, y: 200 + k * 3, w: 62, h: 36 }));
        const p = separarRotulos(cajas, 520, 500);
        const mov = cajas.map((c, i) => ({ ...c, x: p[i].x, y: p[i].y }));
        for (let i = 0; i < mov.length; i++) {
            expect(mov[i].x - mov[i].w / 2).toBeGreaterThanOrEqual(0);
            expect(mov[i].x + mov[i].w / 2).toBeLessThanOrEqual(520);
            expect(mov[i].y + mov[i].h / 2).toBeLessThanOrEqual(500);
            for (let j = i + 1; j < mov.length; j++) expect(solapan(mov[i], mov[j])).toBe(false);
        }
    });

    it('sin solapes no mueve nada', () => {
        const cajas = [{ x: 100, y: 100, w: 60, h: 36 }, { x: 300, y: 300, w: 60, h: 36 }];
        expect(separarRotulos(cajas, 520, 500)).toEqual([{ x: 100, y: 100 }, { x: 300, y: 300 }]);
    });
});
