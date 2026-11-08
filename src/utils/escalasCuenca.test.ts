import { describe, it, expect } from 'vitest';
import { CUANTILES_LLUVIA, escalaDe, familiaLluvia, nivelesDeCuantiles, redondeaBonito } from './escalasCuenca';
import { colorBanda, nivelesDe } from './paletasClima';

describe('redondeaBonito', () => {
    it('1 por debajo de 2, enteros hasta 10, múltiplos de 5 hasta 100 y de 10 después', () => {
        expect([1.33, 2.286, 6.621, 12.844, 63.323, 130.75, 190.754].map(redondeaBonito)).toEqual([1, 2, 7, 15, 65, 130, 190]);
    });
    it('no inventa niveles: no positivos y no finitos dan 0', () => {
        expect([0, -3, NaN, Infinity].map(redondeaBonito)).toEqual([0, 0, 0, 0]);
    });
});

describe('nivelesDeCuantiles', () => {
    it('crecientes, sin repetir y con el máximo registrado como último corte', () => {
        for (const f of ['dia', 'sem', 'mes'] as const) {
            const n = nivelesDeCuantiles(CUANTILES_LLUVIA[f].q, CUANTILES_LLUVIA[f].max);
            expect(n.every((v, i) => i === 0 || v > n[i - 1])).toBe(true);
            expect(n[n.length - 1]).toBe(redondeaBonito(CUANTILES_LLUVIA[f].max));
        }
    });
    it('descarta duplicados tras el redondeo', () => {
        expect(nivelesDeCuantiles([1.1, 1.2, 1.4, 5], 5.2)).toEqual([1, 5]);
    });
});

describe('escalaDe', () => {
    it('lluvia: tres familias según los días que acumula el plano', () => {
        expect([1, 3, 7, 10, 30].map(familiaLluvia)).toEqual(['dia', 'sem', 'sem', 'sem', 'mes']);
        expect(escalaDe('lluvia', 1).niveles).toEqual([1, 2, 4, 7, 10, 15, 25, 30, 60, 80]);
        expect(escalaDe('lluvia', 7).niveles).toEqual([2, 5, 9, 15, 20, 30, 50, 65, 95, 130]);
        expect(escalaDe('lluvia', 30).niveles).toEqual([5, 15, 25, 40, 65, 85, 110, 130, 170, 190]);
    });
    it('cada escala cubre el máximo registrado de su familia', () => {
        expect(Math.max(...escalaDe('lluvia', 1).niveles)).toBeGreaterThanOrEqual(80);
        expect(Math.max(...escalaDe('lluvia', 7).niveles)).toBeGreaterThanOrEqual(130);
        expect(Math.max(...escalaDe('lluvia', 30).niveles)).toBeGreaterThanOrEqual(190);
    });
    it('temperatura, viento y humedad: escala fija, independiente del plano', () => {
        expect(escalaDe('temperatura').niveles[0]).toBe(2);
        expect(escalaDe('temperatura').niveles.at(-1)).toBe(34);
        expect(escalaDe('viento').niveles).toEqual([1, 2, 3, 4, 5, 6, 8, 10, 12, 14]);
        expect(escalaDe('humedad').niveles.at(-1)).toBe(90);
        expect(nivelesDe('temperatura', 5, 9)).toEqual(nivelesDe('temperatura', 20, 31)); // ya no depende del rango de cada plano
    });
    it('la base se declara y nunca habla de normal, anomalía ni percentil', () => {
        for (const v of ['lluvia', 'temperatura', 'viento', 'humedad'] as const) {
            const b = escalaDe(v, 7).base;
            expect(b).toMatch(/n = [\d,]+/);
            expect(b).not.toMatch(/normal|anomal|percentil/i);
        }
    });
    it('el mismo valor tiene el mismo color en cualquier plano de la misma escala', () => {
        const n = escalaDe('temperatura').niveles.length;
        expect(colorBanda('temperatura', 5, n)).toBe(colorBanda('temperatura', 5, n));
        expect(colorBanda('temperatura', 2, n)).not.toBe(colorBanda('temperatura', 12, n));
    });
});
