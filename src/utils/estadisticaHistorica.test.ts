import { describe, expect, it } from 'vitest';
import { anomaliaVsPromedio, huecos, percentil, percentilesHistoricos, resumenSerie, semaforo, tendenciaLineal } from './estadisticaHistorica';

describe('estadisticaHistorica — S/D nunca cero', () => {
    it('entradas vacías o todo null devuelven null', () => {
        expect(resumenSerie([])).toBeNull();
        expect(resumenSerie([null, null])).toBeNull();
        expect(percentil([null], 50)).toBeNull();
        expect(percentilesHistoricos([1])).toBeNull();
        expect(anomaliaVsPromedio(5, [])).toBeNull();
        expect(anomaliaVsPromedio(null, [1, 2])).toBeNull();
        expect(tendenciaLineal([{ x: 1, y: null }, { x: 2, y: 3 }])).toBeNull();
    });

    it('resumen y percentil con interpolación lineal', () => {
        const r = resumenSerie([10, null, 20, 30, 40])!;
        expect(r).toMatchObject({ n: 4, media: 25, mediana: 25, min: 10, max: 40 });
        expect(percentil([10, 20, 30, 40, 50], 25)).toBe(20);
        expect(percentil([10, 20], 50)).toBe(15);
    });

    it('percentiles con pocos años se marcan frágiles', () => {
        const p = percentilesHistoricos([1, 2, 3, 4, 5])!;
        expect(p.fragil).toBe(true);
        expect(p.p50).toBe(3);
    });

    it('anomalía contra el promedio', () => {
        const a = anomaliaVsPromedio(120, [100, 100])!;
        expect(a.abs).toBe(20);
        expect(a.pct).toBeCloseTo(20);
    });

    it('tendencia lineal exacta: R² = 1 y exige 3 puntos', () => {
        const t = tendenciaLineal([{ x: 2021, y: 10 }, { x: 2022, y: 12 }, { x: 2023, y: 14 }])!;
        expect(t.pendiente).toBeCloseTo(2);
        expect(t.r2).toBeCloseTo(1);
        expect(tendenciaLineal([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull();
    });

    it('semáforo por terciles de posición histórica', () => {
        expect(semaforo({ posicion: 1, de: 6 })).toBe('rojo');
        expect(semaforo({ posicion: 3, de: 6 })).toBe('ambar');
        expect(semaforo({ posicion: 6, de: 6 })).toBe('verde');
        expect(semaforo({ posicion: 1, de: 2 })).toBe('sd');
        expect(semaforo(null)).toBe('sd');
    });

    it('huecos agrupa tramos consecutivos sin dato', () => {
        const dias = ['01', '02', '03', '04', '05', '06'].map((d, i) => ({ fecha: `2022-03-${d}`, hayDato: ![1, 2, 5].includes(i) }));
        expect(huecos(dias)).toEqual([
            { desde: '2022-03-02', hasta: '2022-03-03', dias: 2 },
            { desde: '2022-03-06', hasta: '2022-03-06', dias: 1 },
        ]);
    });
});
