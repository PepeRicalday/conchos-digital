import { describe, expect, it } from 'vitest';
import { anioDelCiclo, resumenCultivosCiclo } from './cultivosCiclo';
import type { FilaSupVol } from './ndviInteranual';

const f = (anio: number, modulo: number, cultivo: string, ha: number | null, miles: number | null): FilaSupVol => ({ anio, numero_modulo: modulo, cultivo, superficie_ha: ha, volumen_miles_m3: miles, atipico: false } as unknown as FilaSupVol);

describe('cultivosCiclo', () => {
    it('toma el año en que termina el ciclo', () => {
        expect(anioDelCiclo('2026-09-29')).toBe(2026);
        expect(anioDelCiclo(null)).toBe(2026);
    });
    it('suma el distrito y ordena por volumen con «Otros»', () => {
        const filas = [f(2026, 1, 'Maíz', 100, 5000), f(2026, 2, 'Maíz', 50, 3000), f(2026, 1, 'Alfalfa', 40, 4000), f(2026, 1, 'Nogal', 30, 1000), f(2026, 1, 'Trigo', 20, 500), f(2026, 1, 'Sorgo', 10, 500)];
        const r = resumenCultivosCiclo(filas, 2026);
        expect(r.estado).toBe('ok');
        expect(r.superficieHa).toBe(250);
        expect(r.volumenHm3).toBeCloseTo(14, 5);
        expect(r.lider?.nombre).toBe('Maíz');
        expect(r.lider?.pct).toBeCloseTo((8 / 14) * 100, 3);
        expect(r.partes).toHaveLength(4);
        expect(r.partes[3].esOtros).toBe(true);
    });
    it('2025 es sin ciclo, no S/D ni 0', () => {
        expect(resumenCultivosCiclo([], 2025).estado).toBe('sin-ciclo');
    });
    it('sin filas del año es S/D, no 0', () => {
        const r = resumenCultivosCiclo([f(2024, 1, 'Maíz', 1, 1)], 2026);
        expect(r.estado).toBe('sd');
        expect(r.volumenHm3).toBeNull();
    });
    it('sin carga es S/D', () => { expect(resumenCultivosCiclo(null, 2026).estado).toBe('sd'); });
});
