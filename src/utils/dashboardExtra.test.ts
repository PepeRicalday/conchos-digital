import { describe, it, expect } from 'vitest';
import { resumenPronostico, resumenNdvi, segmentosSpark, serieAlmacenamiento, serieHoraria48, type FilaPronostico } from './dashboardExtra';

const h = (estacion_id: string, o: Partial<FilaPronostico> = {}): FilaPronostico => ({
    estacion_id, valido_en: '2026-11-01T00:00:00Z', precip_mm: null, precip_prob_pct: null, temp_c: null, temp_c_corr: null,
    viento_ms: null, viento_ms_corr: null, eto_fc_mm: null, ...o,
});

describe('resumenPronostico', () => {
    it('sin filas todo es S/D (null), nunca 0', () => {
        expect(resumenPronostico([])).toMatchObject({ estaciones: 0, tMax: null, tMin: null, vientoMax: null, lluviaMm: null, probMax: null, etoMm: null });
    });
    it('la lluvia promedia la suma de cada estación (no suma entre estaciones)', () => {
        const r = resumenPronostico([h('A', { precip_mm: 2 }), h('A', { precip_mm: 2 }), h('B', { precip_mm: 8 })]);
        expect(r.lluviaMm).toBe(6); // (4 + 8) / 2
    });
    it('usa el valor corregido por sesgo cuando existe y cae al crudo si no', () => {
        const r = resumenPronostico([h('A', { temp_c: 30, temp_c_corr: 28, viento_ms: 5, viento_ms_corr: null }), h('B', { temp_c: 10 })]);
        expect(r).toMatchObject({ tMax: 28, tMin: 10, vientoMax: 5 });
    });
    it('una estación sin lluvia reportada no entra al promedio (no cuenta como 0)', () => {
        expect(resumenPronostico([h('A', { precip_mm: 4 }), h('B', { precip_mm: null })]).lluviaMm).toBe(4);
    });
});

describe('resumenNdvi', () => {
    it('sin serie: todo null', () => {
        expect(resumenNdvi([])).toMatchObject({ mes: null, valor: null, anomalia: null });
        expect(resumenNdvi([{ numero_modulo: 1, mes: '2026-09', ndvi_mediana: null }]).mes).toBeNull();
    });
    it('toma el último mes con dato, promedia módulos y calcula anomalía contra el mismo mes de años previos', () => {
        const r = resumenNdvi([
            { numero_modulo: 1, mes: '2026-09', ndvi_mediana: 0.4 }, { numero_modulo: 2, mes: '2026-09', ndvi_mediana: 0.6 },
            { numero_modulo: 1, mes: '2025-09', ndvi_mediana: 0.5 }, { numero_modulo: 2, mes: '2025-09', ndvi_mediana: 0.7 },
            { numero_modulo: 1, mes: '2025-10', ndvi_mediana: 0.9 },
        ]);
        expect(r.mes).toBe('2026-09');
        expect(r.valor).toBeCloseTo(0.5);
        expect(r.anomalia).toBeCloseTo(-0.1);
        expect(r.aniosRef).toBe(1);
        expect(r.peor).toEqual({ modulo: 1, valor: 0.4 });
        expect(r.mejor).toEqual({ modulo: 2, valor: 0.6 });
    });
    it('sin año previo comparable la anomalía es S/D', () => {
        expect(resumenNdvi([{ numero_modulo: 1, mes: '2026-09', ndvi_mediana: 0.5 }]).anomalia).toBeNull();
    });
});

describe('serieAlmacenamiento', () => {
    const r = (fecha: string, presa_id: string, almacenamiento_mm3: number | null) => ({ fecha, presa_id, almacenamiento_mm3 });
    it('suma solo los días con todas las presas; los incompletos son hueco (no 0)', () => {
        const s = serieAlmacenamiento([r('2026-10-30', 'A', 10), r('2026-10-30', 'B', 5), r('2026-10-31', 'A', 11)], '2026-10-31', 3, 2);
        expect(s).toEqual([null, 15, null]);
    });
    it('sin presas esperadas todo es S/D', () => {
        expect(serieAlmacenamiento([], '2026-10-31', 2, 0)).toEqual([null, null]);
    });
});

describe('segmentosSpark', () => {
    it('un hueco (null) corta la línea y no se dibuja como 0', () => {
        const r = segmentosSpark([1, 2, null, 4], 100, 20);
        expect(r.segmentos).toHaveLength(2);
        expect(r.min).toBe(1); expect(r.max).toBe(4);
    });
    it('serie vacía o toda S/D: sin segmentos', () => {
        expect(segmentosSpark([null, null], 100, 20).segmentos).toHaveLength(0);
    });
    it('serie constante se centra y no divide por cero', () => {
        const r = segmentosSpark([5, 5, 5], 100, 20);
        expect(r.segmentos[0].every((p) => p.y === 10)).toBe(true);
    });
});

describe('serieHoraria48', () => {
    it('promedia lluvia y temperatura entre estaciones y toma la probabilidad máxima', () => {
        const s = serieHoraria48([
            h('A', { valido_en: '2026-11-01T01:00:00Z', precip_mm: 2, temp_c: 10, precip_prob_pct: 30 }),
            h('B', { valido_en: '2026-11-01T01:00:00Z', precip_mm: 4, temp_c: 14, temp_c_corr: 12, precip_prob_pct: 60 }),
            h('A', { valido_en: '2026-11-01T00:00:00Z', precip_mm: null }),
        ]);
        expect(s.map((p) => p.t)).toEqual([Date.parse('2026-11-01T00:00:00Z'), Date.parse('2026-11-01T01:00:00Z')]);
        expect(s[1]).toMatchObject({ lluviaMm: 3, tempC: 11, probPct: 60 });
        expect(s[0]).toMatchObject({ lluviaMm: null, tempC: null, probPct: null });
    });
    it('sin filas → serie vacía', () => { expect(serieHoraria48([])).toEqual([]); });
});

describe('resumenNdvi.serieMensual', () => {
    it('12 meses terminando en el último con dato; los meses sin dato son hueco', () => {
        const r = resumenNdvi([
            { numero_modulo: 1, mes: '2026-09', ndvi_mediana: 0.4 }, { numero_modulo: 2, mes: '2026-09', ndvi_mediana: 0.6 },
            { numero_modulo: 1, mes: '2026-07', ndvi_mediana: 0.3 },
        ]);
        expect(r.serieMensual).toHaveLength(12);
        expect(r.serieMensual[11]).toBeCloseTo(0.5);
        expect(r.serieMensual[10]).toBeNull();
        expect(r.serieMensual[9]).toBeCloseTo(0.3);
    });
});
