import { describe, it, expect } from 'vitest';
import {
    estadoNivel, promedioONull, normalizaRadiales, resumenCompuertas, porcentajeTubo, maxEjeTubo, estadoCuentaEnPromedio,
} from './controlEscalas';

const AHORA = Date.UTC(2026, 9, 18, 18, 0, 0);
const base = { nombre: 'K-23', km: 23, nivelM: 3.0, minOperativo: 2.8, maxOperativo: 3.4, telemetriaMs: AHORA - 60_000, confirmada: true, vaciado: false, ahoraMs: AHORA };

describe('estadoNivel', () => {
    it('sin nivel => S/D, nunca alerta (antes 0 m < mínimo)', () => {
        expect(estadoNivel({ ...base, nivelM: null })).toEqual({ estado: 'sd', desviacionM: null, alerta: false });
    });
    it('fila autogenerada (confirmada=false) => arrastre, sin alerta', () => {
        expect(estadoNivel({ ...base, nivelM: 0.15, confirmada: false }).estado).toBe('arrastre');
    });
    it('lectura vieja => stale', () => {
        expect(estadoNivel({ ...base, telemetriaMs: AHORA - 5 * 3_600_000 }).estado).toBe('stale');
    });
    it('K-64 y K-94+200 son referencia: sin alerta aunque estén fuera de rango', () => {
        expect(estadoNivel({ ...base, nombre: 'K-64', km: 64, nivelM: 1 }).estado).toBe('referencia');
        expect(estadoNivel({ ...base, nombre: 'K-94+200', km: 94.2, nivelM: 1 }).alerta).toBe(false);
    });
    it('en vaciado el rango de riego no aplica', () => {
        expect(estadoNivel({ ...base, nivelM: 0.2, vaciado: true })).toMatchObject({ estado: 'vaciado', alerta: false });
    });
    it('bajo/alto con magnitud', () => {
        const b = estadoNivel({ ...base, nivelM: 2.5 });
        expect(b.estado).toBe('bajo'); expect(b.desviacionM).toBeCloseTo(-0.3);
        const a = estadoNivel({ ...base, nivelM: 3.55 });
        expect(a.estado).toBe('alto'); expect(a.desviacionM).toBeCloseTo(0.15);
        expect(estadoNivel(base).estado).toBe('en_rango');
    });
    it('promedio solo cuenta estados con medición vigente', () => {
        expect(estadoCuentaEnPromedio('sd')).toBe(false);
        expect(estadoCuentaEnPromedio('arrastre')).toBe(false);
        expect(estadoCuentaEnPromedio('referencia')).toBe(false);
        expect(estadoCuentaEnPromedio('en_rango')).toBe(true);
    });
});

describe('promedioONull', () => {
    it('ignora null y devuelve null si no hay datos', () => {
        expect(promedioONull([null, undefined])).toBeNull();
        expect(promedioONull([1, null, 3])).toBe(2);
    });
    it('un 0 real sí cuenta', () => { expect(promedioONull([0, 2])).toBe(1); });
});

describe('normalizaRadiales', () => {
    it('null/basura => todo S/D (null), no ceros', () => {
        expect(normalizaRadiales(null, 3)).toEqual([null, null, null]);
        expect(normalizaRadiales('{no json', 2)).toEqual([null, null]);
        expect(normalizaRadiales([], 2)).toEqual([null, null]);
    });
    it('índices base 0, base 1 y desordenados', () => {
        expect(normalizaRadiales([{ index: 0, apertura_m: 1 }, { index: 1, apertura_m: 0 }], 2)).toEqual([1, 0]);
        expect(normalizaRadiales([{ index: 2, apertura_m: 0.5 }, { index: 1, apertura_m: 0 }], 2)).toEqual([0, 0.5]);
    });
    it('acepta string JSON', () => {
        expect(normalizaRadiales('[{"index":1,"apertura_m":0.3}]', 2)).toEqual([0.3, null]);
    });
});

describe('resumenCompuertas', () => {
    it('sin aperturas => S/D, no CERRADAS', () => {
        expect(resumenCompuertas([null, null]).estado).toBe('S/D');
        expect(resumenCompuertas([0, 0]).estado).toBe('CERRADAS');
        expect(resumenCompuertas([0, 0.4])).toMatchObject({ estado: 'ABIERTAS', abiertas: 1 });
    });
});

describe('tubo', () => {
    it('porcentaje acotado y null sin nivel', () => {
        expect(porcentajeTubo(null, 4)).toBeNull();
        expect(porcentajeTubo(5, 4)).toBe(100);
        expect(porcentajeTubo(2, 4)).toBe(50);
    });
    it('eje cubre el nivel actual', () => {
        expect(maxEjeTubo(3.4, 4.5)).toBeGreaterThanOrEqual(4.5);
        expect(maxEjeTubo(null, null)).toBe(1);
        expect(maxEjeTubo(3.4, 0.2)).toBe(4);   // nunca el gasto de capacidad_max (35–70) como nivel
    });
});
