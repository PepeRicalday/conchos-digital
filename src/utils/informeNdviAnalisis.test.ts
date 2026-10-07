import { describe, expect, it } from 'vitest';
import { compararModulos, compararPeriodos, compararVsSrl, construirAnalisis, tendenciaDeSerie, tendenciasDelPeriodo, type FilaAnalisis } from './informeNdviAnalisis';
import { configPorDefecto, validarConfig, type ConfigInformeNdvi } from './informeNdviConfig';

const MESES = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const MODS = [1, 2, 3, 4, 5, 12];
const SUP = [5000, 6000, 6500, 9000, 11000, 2500];
const fila = (m: number, mes: string, v: number): FilaAnalisis => ({
    numero_modulo: m, nombre_modulo: `Módulo ${m}`, mes, ndvi_medio: v, ndvi_desv: 0.08, kc_estimado: 0.15 + 1.1 * v,
    superficie_ha: SUP[MODS.indexOf(m)], fraccion_cobertura_activa: 0.6,
});
// Módulo 1 crece 0.10 → 0.40 (+0.05/mes); M2 = M1 + 0.1; resto = M1 + 0.02·i
const FILAS = MODS.flatMap((m, i) => MESES.map((mes, k) => fila(m, mes, 0.1 + 0.05 * k + (m === 2 ? 0.1 : 0.02 * i))));
const cfg = (o: Partial<ConfigInformeNdvi> = {}): ConfigInformeNdvi => ({ ...configPorDefecto(MESES), ...o });

describe('tendenciaDeSerie', () => {
    it('serie lineal creciente: pendiente 0.05/mes, R² 1, tendencia clara al alza', () => {
        const t = tendenciaDeSerie(MESES, MESES.map((_, k) => 0.1 + 0.05 * k));
        expect(t.pendiente).toBeCloseTo(0.05, 6);
        expect(t.r2).toBeCloseTo(1, 6);
        expect(t.confianza).toBe('clara');
        expect(t.direccion).toBe('sube');
        expect(t.n).toBe(7);
        expect(t.variacion).toBeCloseTo(0.3, 6);
        expect(t.pico?.mes).toBe('2026-09');
        expect(t.minimo?.mes).toBe('2026-03');
    });
    it('con menos de 4 meses la pendiente es solo descriptiva; con menos de 3 no hay pendiente', () => {
        expect(tendenciaDeSerie(MESES.slice(0, 3), [0.1, 0.2, 0.3]).confianza).toBe('descriptiva');
        expect(tendenciaDeSerie(MESES.slice(0, 3), [0.1, 0.2, 0.3]).direccion).toBeNull();
        const dos = tendenciaDeSerie(MESES.slice(0, 2), [0.1, 0.2]);
        expect(dos.pendiente).toBeNull();
        expect(dos.confianza).toBe('sd');
        expect(tendenciaDeSerie(MESES, MESES.map(() => null)).confianza).toBe('sd');
    });
    it('serie plana o ruidosa: sin tendencia clara (estable)', () => {
        const t = tendenciaDeSerie(MESES, [0.3, 0.31, 0.3, 0.29, 0.3, 0.31, 0.3]);
        expect(t.confianza).toBe('sin-tendencia');
        expect(t.direccion).toBe('estable');
        const picoCaida = tendenciaDeSerie(MESES, [0.1, 0.3, 0.5, 0.6, 0.5, 0.3, 0.1]);
        expect(picoCaida.confianza).toBe('sin-tendencia'); // campana: R² bajo aunque se mueva mucho
        expect(picoCaida.pico?.mes).toBe('2026-06');
    });
    it('un hueco no distorsiona la pendiente: el eje es el mes calendario, no la posición', () => {
        const sinMayo = tendenciaDeSerie(MESES, [0.10, 0.15, null, 0.25, 0.30, 0.35, 0.40]);
        expect(sinMayo.n).toBe(6);
        expect(sinMayo.pendiente).toBeCloseTo(0.05, 6);
    });
    it('baja: dirección y variación negativas', () => {
        const t = tendenciaDeSerie(MESES, MESES.map((_, k) => 0.5 - 0.04 * k));
        expect(t.direccion).toBe('baja');
        expect(t.variacion).toBeLessThan(0);
    });
});

describe('tendencias del periodo', () => {
    it('una fila por módulo + promedio SRL con la base elegida', () => {
        const t = tendenciasDelPeriodo(FILAS, cfg(), MESES);
        expect(t).toHaveLength(7);
        expect(t[t.length - 1].id).toBe('srl');
        expect(t[0].pendiente).toBeCloseTo(0.05, 6);
        expect(tendenciasDelPeriodo(FILAS, cfg({ modulos: [3] }), MESES)).toHaveLength(1); // un módulo: sin promedio SRL
    });
});

describe('comparaciones', () => {
    it('periodos (mitad 1 vs mitad 2): delta por módulo, promedio y % de cambio; sin traslape', () => {
        const c = cfg({ modo: 'comparativo', comparacion: { tipo: 'periodos', a: { desde: '2026-03', hasta: '2026-06' }, b: { desde: '2026-07', hasta: '2026-09' }, moduloA: 1, moduloB: 2 } });
        const r = compararPeriodos(FILAS, c);
        expect(r.traslapados).toBe(false);
        expect(r.mesesA).toHaveLength(4); expect(r.mesesB).toHaveLength(3);
        const m1 = r.filas[0];
        expect(m1.a).toBeCloseTo((0.10 + 0.15 + 0.20 + 0.25) / 4, 6);
        expect(m1.b).toBeCloseTo((0.30 + 0.35 + 0.40) / 3, 6);
        expect(m1.delta).toBeCloseTo(m1.b! - m1.a!, 9);
        expect(m1.pct).toBeCloseTo((m1.delta! / m1.a!) * 100, 6);
        expect(r.delta).toBeGreaterThan(0);
        expect(r.mejor?.delta).toBeGreaterThanOrEqual(r.peor?.delta ?? 0);
    });
    it('mes contra mes y detección de traslape', () => {
        const c = cfg({ modo: 'comparativo', comparacion: { tipo: 'mesVsMes', a: { desde: '2026-08', hasta: '2026-08' }, b: { desde: '2026-09', hasta: '2026-09' }, moduloA: 1, moduloB: 2 } });
        const r = compararPeriodos(FILAS, c);
        expect(r.kind).toBe('mesVsMes');
        expect(r.filas[0].delta).toBeCloseTo(0.05, 9);
        const solapa = cfg({ modo: 'comparativo', comparacion: { tipo: 'periodos', a: { desde: '2026-03', hasta: '2026-06' }, b: { desde: '2026-05', hasta: '2026-09' }, moduloA: 1, moduloB: 2 } });
        expect(compararPeriodos(FILAS, solapa).traslapados).toBe(true);
    });
    it('un lado sin datos queda S/D (nunca 0) y no inventa delta ni %', () => {
        const c = cfg({ modo: 'comparativo', modulos: [1], comparacion: { tipo: 'periodos', a: { desde: '2025-01', hasta: '2025-06' }, b: { desde: '2026-07', hasta: '2026-09' }, moduloA: 1, moduloB: 2 } });
        const r = compararPeriodos(FILAS, c);
        expect(r.filas[0].a).toBeNull();
        expect(r.filas[0].delta).toBeNull();
        expect(r.filas[0].pct).toBeNull();
        expect(r.delta).toBeNull();
    });
    it('% de cambio con base 0 es S/D', () => {
        const filasCero = [fila(1, '2026-03', 0), fila(1, '2026-04', 0.2)];
        const c = cfg({ modulos: [1], modo: 'comparativo', comparacion: { tipo: 'mesVsMes', a: { desde: '2026-03', hasta: '2026-03' }, b: { desde: '2026-04', hasta: '2026-04' }, moduloA: 1, moduloB: 2 } });
        const r = compararPeriodos(filasCero, c);
        expect(r.filas[0].delta).toBeCloseTo(0.2, 9);
        expect(r.filas[0].pct).toBeNull();
    });
    it('módulo contra módulo: serie, indicadores y meses en que A supera a B', () => {
        const c = cfg({ modo: 'comparativo', comparacion: { tipo: 'modulos', a: { desde: '', hasta: '' }, b: { desde: '', hasta: '' }, moduloA: 1, moduloB: 2 } });
        const r = compararModulos(FILAS, c, MESES);
        expect(r.delta).toBeCloseTo(0.1, 9); // M2 = M1 + 0.1
        expect(r.mesesAMayor).toBe(0);
        expect(r.mesesComunes).toBe(7);
        expect(r.indicadores.map((i) => i.clave)).toEqual(['ndvi', 'icv', 'ihr', 'kc']);
        expect(r.indicadores[0].b! > r.indicadores[0].a!).toBe(true);
    });
    it('módulo contra el promedio SRL de los 6 módulos', () => {
        const c = cfg({ modo: 'comparativo', comparacion: { tipo: 'vsSRL', a: { desde: '', hasta: '' }, b: { desde: '', hasta: '' }, moduloA: 1, moduloB: 2 } });
        const r = compararVsSrl(FILAS, c, MESES);
        expect(r.mesesComunes).toBe(7);
        expect(r.difMedia).toBeLessThan(0); // M1 es el más bajo
        expect(r.mesesPorEncima).toBe(0);
        expect(r.srl[0]).toBeCloseTo((0.10 + 0.20 + 0.14 + 0.16 + 0.18 + 0.20) / 6 - 0.0 + 0, 1);
    });
});

describe('construirAnalisis y validación por modo', () => {
    it('modo resumen no produce análisis; tendencia y comparativo sí', () => {
        expect(construirAnalisis(FILAS, cfg(), MESES)).toBeNull();
        expect(construirAnalisis(FILAS, cfg({ modo: 'tendencia' }), MESES)?.modo).toBe('tendencia');
        expect(construirAnalisis(FILAS, cfg({ modo: 'comparativo' }), MESES)?.modo).toBe('comparativo');
    });
    it('tendencia exige ≥ 3 meses en el periodo', () => {
        const corto = cfg({ modo: 'tendencia', preset: 'personalizado', desde: '2026-08', hasta: '2026-09' });
        expect(validarConfig(corto, FILAS).join(' ')).toMatch(/necesita al menos 3 meses/);
        expect(validarConfig(cfg({ modo: 'tendencia' }), FILAS)).toEqual([]);
    });
    it('comparativo valida lados iguales, módulos iguales y lados sin datos', () => {
        const base = { a: { desde: '2026-03', hasta: '2026-05' }, b: { desde: '2026-03', hasta: '2026-05' }, moduloA: 1, moduloB: 1 };
        expect(validarConfig(cfg({ modo: 'comparativo', comparacion: { ...base, tipo: 'periodos' } }), FILAS).join(' ')).toMatch(/iguales/);
        expect(validarConfig(cfg({ modo: 'comparativo', comparacion: { ...base, tipo: 'modulos' } }), FILAS).join(' ')).toMatch(/módulos distintos/);
        expect(validarConfig(cfg({ modo: 'comparativo', comparacion: { ...base, tipo: 'periodos', b: { desde: '2025-01', hasta: '2025-03' } } }), FILAS).join(' ')).toMatch(/Sin lecturas/);
        expect(validarConfig(cfg({ modo: 'comparativo', comparacion: { ...base, tipo: 'periodos', b: { desde: '2026-06', hasta: '2026-09' } } }), FILAS)).toEqual([]);
    });
});
