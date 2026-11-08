import { describe, it, expect } from 'vitest';
import { consensoPorPunto, valorPronosticoPeriodo, resumenConfiabilidad, corrigeSesgo, type FilaPronostico, type FilaVerificacion } from './cuencaPronostico';

const f = (modelo: string, fecha: string, mm: number | null, t = 15, h = 60, v = 8): FilaPronostico => ({ punto_id: 'jcas:5', modelo, fecha, precip_mm: mm, temp_media_c: t, hum_media_pct: h, viento_medio_kmh: v });
const modelos = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless'];

describe('consensoPorPunto', () => {
    it('mediana de 3 modelos, con el rango entre ellos y la proporción que da lluvia', () => {
        const d = consensoPorPunto([f(modelos[0], '2026-11-08', 7.3), f(modelos[1], '2026-11-08', 27.8), f(modelos[2], '2026-11-08', 4.5)], 'jcas:5', '2026-11-08');
        expect(d).toHaveLength(1);
        expect(d[0].mm).toBe(7.3);
        expect(d[0].mmMin).toBe(4.5);
        expect(d[0].mmMax).toBe(27.8);
        expect(d[0].probPct).toBe(100);
        expect(d[0].nModelos).toBe(3);
    });
    it('un 0 pronosticado es 0 y una ausencia es null (no se mezclan)', () => {
        const d = consensoPorPunto([f(modelos[0], '2026-11-09', 0), f(modelos[1], '2026-11-09', 0), f(modelos[2], '2026-11-09', null)], 'jcas:5', '2026-11-08');
        expect(d[0].mm).toBe(0);
        expect(d[0].probPct).toBe(0);
        const sd = consensoPorPunto([f(modelos[0], '2026-11-09', null)], 'jcas:5', '2026-11-08');
        expect(sd[0].mm).toBeNull();
        expect(sd[0].probPct).toBeNull();
    });
    it('descarta otros puntos y fechas anteriores, y ordena por fecha', () => {
        const filas = [f(modelos[0], '2026-11-10', 1), f(modelos[0], '2026-11-08', 2), f(modelos[0], '2026-11-07', 3), { ...f(modelos[0], '2026-11-08', 9), punto_id: 'jcas:6' }];
        expect(consensoPorPunto(filas, 'jcas:5', '2026-11-08').map((d) => d.fecha)).toEqual(['2026-11-08', '2026-11-10']);
    });
});

describe('valorPronosticoPeriodo', () => {
    const dias = ['2026-11-08', '2026-11-09', '2026-11-10'].map((fecha, i) => ({ fecha, mm: [7, 1, 0][i], mmMin: [4, 0, 0][i], mmMax: [28, 2, 0][i], probPct: 50, temp: 10 + i, hum: 80, viento: 6, nModelos: 3 }));
    it('lluvia = suma de la mediana diaria y de los extremos', () => {
        expect(valorPronosticoPeriodo(dias, 'lluvia', '2026-11-08', 3)).toEqual({ valor: 8, min: 4, max: 30 });
    });
    it('lluvia exige todos los días: con uno faltante es S/D, no una suma parcial', () => {
        expect(valorPronosticoPeriodo(dias, 'lluvia', '2026-11-08', 4).valor).toBeNull();
        expect(valorPronosticoPeriodo([{ ...dias[0], mm: null }, dias[1], dias[2]], 'lluvia', '2026-11-08', 3).valor).toBeNull();
    });
    it('temperatura = media; con ≥ 80 % de los días alcanza', () => {
        expect(valorPronosticoPeriodo(dias, 'temperatura', '2026-11-08', 3).valor).toBe(11);
        expect(valorPronosticoPeriodo(dias, 'temperatura', '2026-11-08', 4).valor).toBeNull(); // 3 de 4 = 75 %
        expect(valorPronosticoPeriodo(dias, 'temperatura', '2026-11-08', 3).min).toBeNull();
    });
});

describe('confiabilidad', () => {
    const v = (o: Partial<FilaVerificacion>): FilaVerificacion => ({
        punto_id: 'jcas:5', nombre: 'Camargo', n_dias: 10, aciertos: 3, omisiones: 1, falsas_alarmas: 1, correctos_negativos: 5, pod: 0.75, far: 0.25, brier: 0.1,
        mm_fc_medio: 1, mm_obs_medio: 1, n_temp: 10, temp_mae: 1.5, temp_sesgo: 0.5, n_viento: 10, viento_mae: 2, viento_sesgo: -1, ...o,
    });
    it('con pocos pares: "en construcción", sin afirmar acierto', () => {
        const c = resumenConfiabilidad([v({}), v({ punto_id: 'jcas:6' })]);
        expect(c.estado).toBe('construccion');
        expect(c.texto).toMatch(/En construcción: 20 días-estación/);
        expect(c.texto).not.toMatch(/acierta \d+ %/);
    });
    it('con suficientes pares: POD, FAR y errores ponderados por n', () => {
        const filas = Array.from({ length: 7 }, (_, i) => v({ punto_id: `jcas:${i}` }));
        const c = resumenConfiabilidad(filas);
        expect(c.estado).toBe('medida');
        expect(c.pod).toBe(0.75);
        expect(c.far).toBe(0.25);
        expect(c.tempMae).toBe(1.5);
        expect(c.texto).toMatch(/acierta 75 %/);
    });
    it('sin filas: construcción con 0 días y todo S/D (null)', () => {
        const c = resumenConfiabilidad([]);
        expect(c.estado).toBe('construccion');
        expect(c.pod).toBeNull();
        expect(c.tempMae).toBeNull();
    });
});

describe('corrigeSesgo', () => {
    it('solo corrige con ≥ 30 pares y sesgo apreciable, y lo declara', () => {
        expect(corrigeSesgo(20, 2, 40, 0.5)).toEqual({ valor: 18, corregido: true });
        expect(corrigeSesgo(20, 2, 29, 0.5)).toEqual({ valor: 20, corregido: false });
        expect(corrigeSesgo(20, 0.2, 40, 0.5)).toEqual({ valor: 20, corregido: false });
        expect(corrigeSesgo(null, 2, 40, 0.5)).toEqual({ valor: null, corregido: false });
    });
});
