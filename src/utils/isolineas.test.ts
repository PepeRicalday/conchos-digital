import { describe, it, expect } from 'vitest';
import { regionMayorQue, suavizaAnillo, rotuloEnAnillos, anillosAPath, type Malla, type Anillo } from './isolineas';

const area = (a: Anillo) => { let s = 0; for (let i = 0, j = a.length - 1; i < a.length; j = i++) s += a[j][0] * a[i][1] - a[i][0] * a[j][1]; return Math.abs(s / 2); };
/** Malla n×n con margen de 3 celdas; paso 1, así las coordenadas son "celdas". */
function malla(n: number, f: (x: number, y: number) => number): Malla {
    const v = new Float64Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v[j * n + i] = f(i, n - 1 - j);
    return { nx: n, ny: n, lon0: 0, lat1: n - 1, paso: 1, valores: v };
}

describe('regionMayorQue (marching squares)', () => {
    it('un disco: un solo anillo cerrado con el área de π r²', () => {
        const m = malla(41, (x, y) => -Math.hypot(x - 20, y - 20));
        const r = regionMayorQue(m, -10);
        expect(r).toHaveLength(1);
        expect(area(r[0])).toBeGreaterThan(Math.PI * 100 * 0.97);
        expect(area(r[0])).toBeLessThan(Math.PI * 100 * 1.03);
        expect(r[0][0][0]).toBeCloseTo(r[0][r[0].length - 1][0], 6); // cerrado
    });
    it('dos discos separados: dos anillos', () => {
        const m = malla(61, (x, y) => Math.max(-Math.hypot(x - 15, y - 30), -Math.hypot(x - 45, y - 30)));
        expect(regionMayorQue(m, -6)).toHaveLength(2);
    });
    it('una corona: el anillo exterior y el hueco', () => {
        const m = malla(41, (x, y) => -Math.abs(Math.hypot(x - 20, y - 20) - 10));
        const r = regionMayorQue(m, -3).map(area).sort((a, b) => b - a);
        expect(r).toHaveLength(2);
        expect(r[0]).toBeGreaterThan(r[1]);
    });
    it('un nivel por encima de todo el campo no genera nada; por debajo de todo, tampoco (el borde se rellena aparte)', () => {
        const m = malla(21, (x, y) => x + y);
        expect(regionMayorQue(m, 1000)).toEqual([]);
        // por debajo de todo: la región es toda la malla, cuyo borde cae en el margen de relleno y es un único anillo exterior
        expect(regionMayorQue(m, -1000).length).toBeLessThanOrEqual(1);
    });
    it('las celdas NaN cuentan como por debajo de todo', () => {
        const m = malla(21, () => 10);
        m.valores[10 * 21 + 10] = NaN;
        const r = regionMayorQue(m, 5).map(area).sort((a, b) => b - a);
        expect(r).toHaveLength(2); // exterior y el hueco de la celda NaN
        expect(r[1]).toBeGreaterThan(0);
    });
    it('un plano inclinado: la isolínea es una recta (anillo largo y delgado en la región)', () => {
        const m = malla(31, (x) => x);
        const r = regionMayorQue(m, 15.5);
        expect(r).toHaveLength(1);
        const xs = r[0].map((p) => p[0]);
        expect(Math.min(...xs)).toBeCloseTo(15.5, 1);
    });
});

describe('suavizaAnillo / rotuloEnAnillos / anillosAPath', () => {
    const m = malla(41, (x, y) => -Math.hypot(x - 20, y - 20));
    const [disco] = regionMayorQue(m, -10);
    it('suavizar conserva el área aproximada y suma vértices', () => {
        const s = suavizaAnillo(disco, 2);
        expect(s.length).toBeGreaterThan(disco.length);
        expect(area(s)).toBeGreaterThan(area(disco) * 0.95);
        expect(area(s)).toBeLessThan(area(disco) * 1.01);
    });
    it('el rótulo cae sobre la línea y su ángulo queda en [-90, 90]', () => {
        const r = rotuloEnAnillos([disco], () => true, 28)!;
        expect(r).not.toBeNull();
        expect(Math.hypot(r.lon - 20, r.lat - 20)).toBeGreaterThan(9);
        expect(Math.hypot(r.lon - 20, r.lat - 20)).toBeLessThan(11);
        expect(Math.abs(r.angulo)).toBeLessThanOrEqual(90);
    });
    it('sin puntos válidos no hay rótulo', () => {
        expect(rotuloEnAnillos([disco], () => false, 28)).toBeNull();
        expect(rotuloEnAnillos([], () => true, 28)).toBeNull();
    });
    it('anillosAPath produce un path cerrado por anillo', () => {
        const d = anillosAPath([disco], (x) => x * 2, (y) => 100 - y);
        expect(d).toMatch(/^M[\d.]+,[\d.]+L/);
        expect(d.endsWith('Z')).toBe(true);
        expect((d.match(/Z/g) ?? []).length).toBe(1);
    });
});
