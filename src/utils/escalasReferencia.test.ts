import { describe, it, expect } from 'vitest';
import { esEscalaReferencia, soloEscalasDeControl, tramoTocaReferencia } from './escalasReferencia';
import { construyeBalance, normalizaEscalas } from './balanceTramos';

describe('escalas de referencia (K-64 y K-94+200)', () => {
    it('se identifican por km o por nombre', () => {
        expect(esEscalaReferencia({ nombre: 'K-64', km: 64 })).toBe(true);
        expect(esEscalaReferencia({ nombre: 'K-94+200', km: 94.2 })).toBe(true);
        expect(esEscalaReferencia({ km: '94.200' })).toBe(true);
        expect(esEscalaReferencia({ nombre: 'k-64' })).toBe(true);
        expect(esEscalaReferencia({ nombre: 'K94+200' })).toBe(true);
    });
    it('no confunde escalas de control parecidas', () => {
        for (const e of [{ nombre: 'K-62', km: 62 }, { nombre: 'K-68', km: 68 }, { nombre: 'K-94+057', km: 94.057 }, { nombre: 'K-0+000', km: 0 }, { nombre: 'K-104', km: 104 }, { nombre: 'K-640', km: 640 }]) {
            expect(esEscalaReferencia(e), e.nombre).toBe(false);
        }
    });
    it('el filtro deja solo escalas de control', () => {
        const r = soloEscalasDeControl([{ nombre: 'K-62', km: 62 }, { nombre: 'K-64', km: 64 }, { nombre: 'K-68', km: 68 }, { nombre: 'K-94+057', km: 94.057 }, { nombre: 'K-94+200', km: 94.2 }, { nombre: 'K-104', km: 104 }]);
        expect(r.map((e) => e.nombre)).toEqual(['K-62', 'K-68', 'K-94+057', 'K-104']);
    });
    it('un tramo que toca una referencia se detecta por nombre', () => {
        expect(tramoTocaReferencia('K-64', 'K-68')).toBe(true);
        expect(tramoTocaReferencia('K-94+200', 'K-104')).toBe(true);
        expect(tramoTocaReferencia('K-62', 'K-68')).toBe(false);
    });
});

describe('el balance ya no parte el canal en las referencias', () => {
    it('con K-64 y K-94+200 filtradas los tramos reales son K-62→K-68 y K-94+057→K-104', () => {
        const filas = [
            { escala_id: 'a', nombre: 'K-62', km: 62, gasto_calculado_m3s: 5 },
            { escala_id: 'b', nombre: 'K-64', km: 64, gasto_calculado_m3s: 53.277 }, // artefacto compuertas_m1
            { escala_id: 'c', nombre: 'K-68', km: 68, gasto_calculado_m3s: 4.8 },
            { escala_id: 'd', nombre: 'K-94+057', km: 94.057, gasto_calculado_m3s: 4.5 },
            { escala_id: 'e', nombre: 'K-94+200', km: 94.2, gasto_calculado_m3s: 0 },
            { escala_id: 'f', nombre: 'K-104', km: 104, gasto_calculado_m3s: 4.4 },
        ];
        const { escalas } = normalizaEscalas(filas);
        const tramos = construyeBalance(soloEscalasDeControl(escalas), [], []);
        expect(tramos.map((t) => t.seccion_nombre)).toEqual(['K-62 → K-68', 'K-68 → K-94+057', 'K-94+057 → K-104']);
        // sin el filtro habría salido el falso "fuga" de 53 m³/s en K-64 → K-68
        const sinFiltro = construyeBalance(escalas, [], []);
        expect(sinFiltro.some((t) => t.seccion_nombre === 'K-64 → K-68' && t.q_perdidas > 40)).toBe(true);
    });
});
