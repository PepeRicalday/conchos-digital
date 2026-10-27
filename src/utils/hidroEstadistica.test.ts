import { describe, it, expect } from 'vitest';
import {
    comparaPresaRio, cobertura, estadisticaEstacion, pendientePorDia, resumenEstacion, sinCerosSospechosos, variacion, volumenMm3,
} from './hidroEstadistica';
import type { PuntoHidro } from './hidroEstaciones';

const MIN = 60000;
const T0 = Date.parse('2026-10-20T00:00:00Z');
const serie = (vals: (number | null)[], pasoMin = 15, t0 = T0): PuntoHidro[] =>
    vals.flatMap((v, i) => (v == null ? [] : [{ t: t0 + i * pasoMin * MIN, v }]));

describe('resumenEstacion', () => {
    it('media, mín/máx con su hora, p10/p90', () => {
        const r = resumenEstacion(serie([10, 20, 30, 40, 50]))!;
        expect(r.n).toBe(5);
        expect(r.media).toBe(30);
        expect(r.min).toBe(10);
        expect(r.tMin).toBe(T0);
        expect(r.max).toBe(50);
        expect(r.tMax).toBe(T0 + 4 * 15 * MIN);
        expect(r.p10).toBeCloseTo(14);
        expect(r.p90).toBeCloseTo(46);
    });
    it('sin datos = null, nunca 0', () => {
        expect(resumenEstacion([])).toBeNull();
    });
});

describe('sinCerosSospechosos (Babisas)', () => {
    const nivel = serie([6.2, 6.2, 6.2, 5.0]);
    const gasto = serie([0, 0, 12, 0]);
    it('excluye el 0 con nivel ≥ 5.7 m y lo cuenta aparte', () => {
        const { validos, excluidas } = sinCerosSospechosos('C6301416', gasto, nivel);
        expect(excluidas).toBe(2);
        expect(validos.map(p => p.v)).toEqual([12, 0]); // el último 0 es con nivel bajo: no es la anomalía
    });
    it('otras estaciones conservan sus ceros', () => {
        expect(sinCerosSospechosos('C6301AC4', gasto, nivel).excluidas).toBe(0);
    });
});

describe('cobertura', () => {
    it('lecturas recibidas frente a las esperadas', () => {
        const s = serie(Array.from({ length: 72 }, (_, i) => (i % 2 === 0 ? 1 : null)), 20); // 36 de 72 en 24 h
        const c = cobertura(s, 20, T0, T0 + 24 * 60 * MIN)!;
        expect(c.esperadas).toBe(72);
        expect(c.recibidas).toBe(36);
        expect(c.pct).toBeCloseTo(50);
        expect(c.confiable).toBe(false);
    });
    it('serie completa = 100 % y confiable', () => {
        const s = serie(Array.from({ length: 96 }, () => 1), 15);
        const c = cobertura(s, 15, T0, T0 + 24 * 60 * MIN)!;
        expect(c.pct).toBe(100);
        expect(c.confiable).toBe(true);
    });
});

describe('volumenMm3', () => {
    it('gasto constante 10 m³/s durante 1 h = 0.036 Mm³', () => {
        const s = serie([10, 10, 10, 10, 10], 15); // 0..60 min
        const v = volumenMm3(s, T0, T0 + 60 * MIN)!;
        expect(v.mm3).toBeCloseTo(0.036, 5);
        expect(v.pctIntegrado).toBeCloseTo(100);
        expect(v.gastoMedio).toBeCloseTo(10);
    });
    it('no integra sobre huecos mayores a 45 min', () => {
        const s = [...serie([10, 10]), ...serie([10, 10], 15, T0 + 3 * 60 * MIN)]; // hueco de 2 h
        const v = volumenMm3(s, T0, T0 + 4 * 60 * MIN)!;
        expect(v.mm3).toBeCloseTo((10 * 15 * 60 * 2) / 1e6, 6); // solo los dos tramos de 15 min
        expect(v.pctIntegrado).toBeLessThan(15);
    });
    it('sin tramos integrables = null (no 0)', () => {
        expect(volumenMm3(serie([5]), T0, T0 + 60 * MIN)).toBeNull();
        expect(volumenMm3([], T0, T0 + 60 * MIN)).toBeNull();
    });
});

describe('variación y pendiente', () => {
    it('variación 24 h del último punto contra hace 24 h', () => {
        const s = serie(Array.from({ length: 97 }, (_, i) => 100 + i * 0.5), 15); // +0.5 por 15 min
        const v = variacion(s, 1);
        expect(v.h24?.dir).toBe('sube');
        expect(v.h24?.delta).toBeCloseTo(48, 0);
        expect(v.d7).toBeNull(); // no hay 7 días de base
    });
    it('estación apagada (último dato más viejo que 3 h): variación S/D, no un delta de otro periodo', () => {
        const s = serie(Array.from({ length: 97 }, (_, i) => 100 + i * 0.5), 15);
        const ult = s[s.length - 1].t;
        expect(variacion(s, 1, ult + 60 * MIN).h24).not.toBeNull();
        expect(variacion(s, 1, ult + 4 * 60 * MIN)).toEqual({ h24: null, d7: null });
    });
    it('pendiente por día con Theil-Sen', () => {
        const s = serie(Array.from({ length: 96 }, (_, i) => 10 + i * 0.25), 15); // +1 m³/s por hora = +24 por día
        expect(pendientePorDia(s)).toBeCloseTo(24, 0);
        expect(pendientePorDia(serie([1, 2, 3]))).toBeNull();
    });
});

describe('estadisticaEstacion', () => {
    const ahora = T0 + 24 * 60 * MIN;
    const n = 96;
    const nivel = serie(Array.from({ length: n }, () => 6.2), 15, T0 + 15 * MIN);
    const gasto = serie(Array.from({ length: n }, (_, i) => (i < 48 ? 0 : 20)), 15, T0 + 15 * MIN);
    it('Babisas: los ceros sospechosos no entran a gasto ni a volumen y se declaran', () => {
        const e = estadisticaEstacion('C6301416', 15, { nivel_m: nivel, gasto_m3s: gasto }, '24h', ahora);
        expect(e.excluidas).toBe(48);
        expect(e.gasto?.media).toBe(20);
        expect(e.gasto?.min).toBe(20);
        expect(e.volumen?.gastoMedio).toBeCloseTo(20);
        // La cola de 60 min (latencia del último mensaje) no cuenta como faltante.
        expect(e.cobertura?.pct).toBeGreaterThan(95);
        expect(e.gastoRecibidas).toBe(96);
        expect(e.pctExcluidas).toBe(50);
        expect(e.gastoRepresentativo).toBe(true);
    });
    it('Babisas con más de la mitad excluida: la cifra no es representativa', () => {
        const g = serie(Array.from({ length: n }, (_, i) => (i % 4 === 0 ? 20 : 0)), 15, T0 + 15 * MIN);
        const e = estadisticaEstacion('C6301416', 15, { nivel_m: nivel, gasto_m3s: g }, '24h', ahora);
        expect(e.pctExcluidas).toBe(75);
        expect(e.gastoRepresentativo).toBe(false);
    });
    it('el volumen no puentea los ceros excluidos (patrón alternado 0/20 a 20 min)', () => {
        const nv = serie(Array.from({ length: 72 }, () => 6.2), 20);
        const g = serie(Array.from({ length: 72 }, (_, i) => (i % 2 === 0 ? 0 : 20)), 20);
        const e = estadisticaEstacion('C6301416', 20, { nivel_m: nv, gasto_m3s: g }, '24h', T0 + 24 * 60 * MIN);
        // Todos los tramos tocan un cero excluido: no hay nada integrable (antes se fabricaban tramos de 40 min).
        expect(e.volumen).toBeNull();
        expect(e.gasto?.media).toBe(20);
    });
    it('sin series no inventa nada', () => {
        const e = estadisticaEstacion('C6300760', 15, {}, '24h', ahora);
        expect(e.nivel).toBeNull();
        expect(e.gasto).toBeNull();
        expect(e.volumen).toBeNull();
        expect(e.cobertura).toBeNull();
        expect(e.pendienteGastoDia).toBeNull();
    });
});

describe('comparaPresaRio', () => {
    it('diferencia río − presa con desfase de tránsito', () => {
        const presa = serie(Array.from({ length: 8 }, () => 100), 60);
        const rio = serie(Array.from({ length: 12 }, () => 80), 60, T0 + 5 * 60 * MIN);
        const c = comparaPresaRio(presa, rio, T0, T0 + 7 * 60 * MIN, 5)!;
        expect(c.gastoPresa).toBe(100);
        expect(c.gastoRio).toBe(80);
        expect(c.diferencia).toBe(-20);
        expect(c.pct).toBeCloseTo(-20);
    });
    it('presa sin extracción: % = null; sin datos = null', () => {
        const presa = serie([0, 0, 0], 60);
        const rio = serie([5, 5, 5], 60);
        expect(comparaPresaRio(presa, rio, T0, T0 + 3 * 60 * MIN, 0)?.pct).toBeNull();
        expect(comparaPresaRio([], rio, T0, T0 + 3 * 60 * MIN, 0)).toBeNull();
    });
});
