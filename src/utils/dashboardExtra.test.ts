import { describe, it, expect } from 'vitest';
import { resumenPronostico, resumenNdvi, segmentosSpark, serieAlmacenamiento, serieHoraria48, demanda24h, estadoDemanda24h, type FilaPronostico } from './dashboardExtra';

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

describe('demanda24h', () => {
    const AHORA = Date.parse('2026-11-01T12:00:00Z');
    // 24 horas (13:00 → 12:00 siguiente) de una estación con ETo por hora y lluvia opcional
    const dia = (id: string, etoHora: number, extra: Partial<FilaPronostico> = {}, horas = 24): FilaPronostico[] =>
        Array.from({ length: horas }, (_, i) => h(id, { valido_en: new Date(AHORA + (i + 1) * 3_600_000).toISOString(), eto_fc_mm: etoHora, corrida_en: '2026-11-01T11:00:00Z', viento_ms: 2, ...extra }));

    it('ETo de 24 h menos lluvia efectiva; la lluvia solo cuenta con probabilidad ≥ 60 %', () => {
        const sinProb = demanda24h(dia('A', 0.2, { precip_mm: 0.5, precip_prob_pct: 30 }), AHORA);
        expect(sinProb.netaMm).toBeCloseTo(4.8);          // 24·0.2, lluvia ignorada por prob < 60
        const conProb = demanda24h(dia('A', 0.2, { precip_mm: 0.5, precip_prob_pct: 80 }), AHORA);
        expect(conProb.lluvia24Mm).toBeCloseTo(12);       // 24·0.5
        expect(conProb.lluviaEfectivaMm).toBeCloseTo(9.6); // 80 % de 12 (≥ 5 mm)
        expect(conProb.netaMm).toBeCloseTo(0);             // 4.8 − 9.6 → 0
    });
    it('lluvia bajo 5 mm no descuenta aunque la probabilidad sea alta', () => {
        const d = demanda24h(dia('A', 0.2, { precip_mm: 0.1, precip_prob_pct: 90 }), AHORA);
        expect(d.lluviaEfectivaMm).toBe(0);
        expect(d.netaMm).toBeCloseTo(4.8);
    });
    it('una estación con menos de 22 horas de ETo es S/D y no entra al agregado', () => {
        const d = demanda24h([...dia('A', 0.2), ...dia('B', 0.5, {}, 20)], AHORA);
        expect(d.estacionesUsadas).toBe(1);
        expect(d.estacionesTotal).toBe(2);
        expect(d.netaMm).toBeCloseTo(4.8);
    });
    it('mediana con 3 estaciones, promedio con 2, y rango min–máx', () => {
        const tres = demanda24h([...dia('A', 0.1), ...dia('B', 0.2), ...dia('C', 0.4)], AHORA);
        expect(tres.netaMm).toBeCloseTo(4.8);              // mediana de 2.4, 4.8, 9.6
        expect(tres.rangoMm).toEqual({ min: expect.closeTo(2.4), max: expect.closeTo(9.6) });
        const dos = demanda24h([...dia('A', 0.1), ...dia('B', 0.3)], AHORA);
        expect(dos.netaMm).toBeCloseTo(4.8);               // promedio de 2.4 y 7.2
    });
    it('estaciones excluidas (sospechosas / sin señal) no cuentan', () => {
        const d = demanda24h([...dia('A', 0.1), ...dia('B', 0.4)], AHORA, ['B']);
        expect(d.estacionesUsadas).toBe(1);
        expect(d.excluidas).toEqual(['B']);
        expect(d.netaMm).toBeCloseTo(2.4);
    });
    it('pronóstico viejo (> 3 h) → S/D con texto, no un número viejo', () => {
        const filas = dia('A', 0.2).map((f) => ({ ...f, corrida_en: '2026-11-01T06:00:00Z' }));
        const d = demanda24h(filas, AHORA);
        expect(d.viejo).toBe(true);
        expect(d.netaMm).toBeNull();
        expect(estadoDemanda24h(d)).toEqual({ tipo: 'sd', texto: 'Pronóstico viejo' });
    });
    it('sin filas → S/D; estados por umbral', () => {
        const d = demanda24h([], AHORA);
        expect(d.netaMm).toBeNull();
        expect(estadoDemanda24h(d).tipo).toBe('sd');
        expect(estadoDemanda24h(demanda24h(dia('A', 0.05), AHORA)).texto).toBe('Baja');   // 1.2 mm
        expect(estadoDemanda24h(demanda24h(dia('A', 0.15), AHORA)).texto).toBe('Media');  // 3.6 mm
        expect(estadoDemanda24h(demanda24h(dia('A', 0.3), AHORA)).texto).toBe('Alta');    // 7.2 mm
    });
    it('ventana libre: horas con viento bajo y sin lluvia; null si no hay viento prevista', () => {
        expect(demanda24h(dia('A', 0.2), AHORA).ventanaLibreHoras).toBe(24);
        expect(demanda24h(dia('A', 0.2, { viento_ms: 9 }), AHORA).ventanaLibreHoras).toBe(0);
        expect(demanda24h(dia('A', 0.2, { viento_ms: null }), AHORA).ventanaLibreHoras).toBeNull();
    });
    it('usa el ETo corregido por estación cuando existe y lo señala', () => {
        const cruda = demanda24h(dia('A', 0.2), AHORA);
        expect(cruda.eto24Mm).toBeCloseTo(4.8);
        expect(cruda.etoCorregido).toBe(false);
        const corr = demanda24h(dia('A', 0.2, { eto_fc_mm_corr: 0.18 }), AHORA);
        expect(corr.eto24Mm).toBeCloseTo(4.32);
        expect(corr.etoCorregido).toBe(true);
        // factor 1 (corr = crudo) no cuenta como corrección
        expect(demanda24h(dia('A', 0.2, { eto_fc_mm_corr: 0.2 }), AHORA).etoCorregido).toBe(false);
    });
});
